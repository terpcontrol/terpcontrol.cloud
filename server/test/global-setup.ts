import { MongoMemoryServer } from 'mongodb-memory-server';
import { HarnessContext, writeContext } from './support/context';
import { buildEnv, startApp } from './support/infra/app';
import { startFakeInflux } from './support/infra/influx';
import { startMqttBroker } from './support/infra/mqtt';
import { freePort } from './support/infra/ports';
import { startFakeSmtp } from './support/infra/smtp';
import { InfluxStore, MailStore } from './support/infra/stores';

const ROOT_USER = 'root';
const ROOT_PASSWORD = 'root-password';

// Deliberately not "admin": a deployment names the seeded account, and nothing
// in the server may assume what it is called.
const ADMIN = { username: 'operator@test.invalid', password: 'admin-password-1!' };
const MQTT_AUTH_SECRET = 'integration-mqtt-auth-secret';
const AUTOMATION_TOKEN = 'integration-automation-token';
const SELF_REGISTRATION_PASSWORD = 'let-me-in';

/** Give the app time to make its first broker connection before specs run. */
const waitForBrokerClient = (aedes: import('aedes').Aedes, timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('App under test never connected to the MQTT broker')), timeoutMs);
    aedes.on('client', () => {
      clearTimeout(timer);
      resolve();
    });
  });

export default async (): Promise<void> => {
  const influxStore = new InfluxStore();
  const mailStore = new MailStore();

  // Authenticated, like production - the app always connects with credentials.
  const mongo = await MongoMemoryServer.create({
    auth: { enable: true, customRootName: ROOT_USER, customRootPwd: ROOT_PASSWORD },
  });
  const mongoUri = mongo.getUri().replace('mongodb://', `mongodb://${ROOT_USER}:${ROOT_PASSWORD}@`);

  const broker = await startMqttBroker();
  const influx = await startFakeInflux({ influx: influxStore, mail: mailStore, bounceBroker: () => broker.bounce() });
  const smtp = await startFakeSmtp(mailStore);
  const port = await freePort();

  // Created before the app starts so the connection cannot be missed, and
  // observed straight away so a timeout here cannot surface as an unhandled
  // rejection that hides why the app failed to boot. The await below still
  // re-throws it.
  const brokerConnected = waitForBrokerClient(broker.aedes, 90_000);
  brokerConnected.catch(() => undefined);

  const appEnvironment = {
    port,
    mongoUri,
    mqttHost: '127.0.0.1',
    mqttPort: broker.port,
    influxUrl: influx.url,
    smtpPort: smtp.port,
    admin: ADMIN,
    mqttAuthSecret: MQTT_AUTH_SECRET,
    automationToken: AUTOMATION_TOKEN,
    selfRegistrationPassword: SELF_REGISTRATION_PASSWORD,
  };

  const app = await startApp(appEnvironment);

  await brokerConnected;

  const context: HarnessContext = {
    baseUrl: app.baseUrl,
    controlUrl: influx.url,
    mongoUri,
    mqttPort: broker.port,
    admin: ADMIN,
    mqttAuthSecret: MQTT_AUTH_SECRET,
    automationToken: AUTOMATION_TOKEN,
    selfRegistrationPassword: SELF_REGISTRATION_PASSWORD,
    // Only what the harness itself set; the parent process environment is
    // inherited by whoever spawns a server anyway.
    appEnv: Object.fromEntries(
      Object.entries(buildEnv(appEnvironment)).filter(([key, value]) => value !== undefined && process.env[key] !== value),
    ) as Record<string, string>,
  };
  writeContext(context);

  (globalThis as Record<string, unknown>).__HARNESS_TEARDOWN__ = async () => {
    await app.stop();
    await new Promise<void>(resolve => smtp.server.close(() => resolve()));
    await new Promise<void>(resolve => influx.server.close(() => resolve()));
    await broker.close();
    await mongo.stop();
  };
};
