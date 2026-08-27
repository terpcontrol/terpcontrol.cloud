import { MongoMemoryServer } from 'mongodb-memory-server';
import { HarnessContext, Target, writeContext } from './support/context';
import { startApp } from './support/infra/app';
import { startFakeInflux } from './support/infra/influx';
import { startMqttBroker } from './support/infra/mqtt';
import { freePort } from './support/infra/ports';
import { startFakeSmtp } from './support/infra/smtp';
import { InfluxStore, MailStore } from './support/infra/stores';

const ROOT_USER = 'root';
const ROOT_PASSWORD = 'root-password';

const ADMIN = { username: 'admin', password: 'admin-password-1!' };
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
  const target = (process.env.TARGET as Target) ?? 'legacy';

  const influxStore = new InfluxStore();
  const mailStore = new MailStore();

  // Authenticated, like production - the app always connects with credentials.
  const mongo = await MongoMemoryServer.create({
    auth: { enable: true, customRootName: ROOT_USER, customRootPwd: ROOT_PASSWORD },
  });
  const mongoUri = mongo.getUri().replace('mongodb://', `mongodb://${ROOT_USER}:${ROOT_PASSWORD}@`);

  const broker = await startMqttBroker();
  const influx = await startFakeInflux({ influx: influxStore, mail: mailStore });
  const smtp = await startFakeSmtp(mailStore);
  const port = await freePort();

  const brokerConnected = waitForBrokerClient(broker.aedes, 90_000);

  const app = await startApp(target, {
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
  });

  await brokerConnected;

  const context: HarnessContext = {
    baseUrl: app.baseUrl,
    controlUrl: influx.url,
    mongoUri,
    mqttPort: broker.port,
    target,
    admin: ADMIN,
    mqttAuthSecret: MQTT_AUTH_SECRET,
    automationToken: AUTOMATION_TOKEN,
    selfRegistrationPassword: SELF_REGISTRATION_PASSWORD,
  };
  writeContext(context);

  (globalThis as Record<string, unknown>).__HARNESS_TEARDOWN__ = async () => {
    await app.stop();
    await new Promise<void>(resolve => smtp.server.close(() => resolve()));
    await new Promise<void>(resolve => influx.server.close(() => resolve()));
    await new Promise<void>(resolve => broker.aedes.close(() => resolve()));
    await new Promise<void>(resolve => broker.server.close(() => resolve()));
    await mongo.stop();
  };
};
