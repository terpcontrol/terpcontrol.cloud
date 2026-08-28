import { registerAs } from '@nestjs/config';

/**
 * The environment, read once and grouped by what it configures. Providers take
 * the namespace they need through `@Inject(mqttConfig.KEY)` and get a typed
 * object rather than a bag of strings.
 *
 * The values themselves are unchanged - same variable names, same defaults - so
 * an existing deployment needs no new settings.
 */

const flag = (value: string | undefined): boolean => value === 'true';

const number = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== '' ? parsed : fallback;
};

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: number(process.env.PORT, 3000),
  /** Published in the OpenAPI document as the server to call. */
  apiUrlExternal: process.env.API_URL_EXTERNAL,
  // Read by nothing today: the line that passed these to `cors()` has been
  // commented out since before this migration, so the plugin defaults apply.
  // They stay here because `.env.sample` still documents them.
  origin: process.env.ORIGIN,
  credentials: flag(process.env.CREDENTIALS),
  logFormat: process.env.LOG_FORMAT,
  logDir: process.env.LOG_DIR,
}));

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  name: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
}));

export const influxConfig = registerAs('influx', () => ({
  // A full URL wins; otherwise the host is assumed to serve the default port,
  // which is what the compose file provides.
  url: process.env.INFLUXDB_URL || `http://${process.env.INFLUXDB_HOST || 'influxdb'}:8086`,
  token: process.env.INFLUXDB_TOKEN,
  org: process.env.INFLUXDB_ORG,
  bucket: process.env.INFLUXDB_BUCKET,
}));

export const mqttConfig = registerAs('mqtt', () => ({
  url: process.env.MQTT_URL,
  port: number(process.env.MQTT_PORT, 1883),
  user: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
  /** The secret RabbitMQ puts in the path of every auth check. */
  authSharedSecret: process.env.MQTTAUTH_SHARED_SECRET,
}));

export const mailConfig = registerAs('mail', () => ({
  sender: process.env.SMTP_SENDER,
  user: process.env.SMTP_USER,
  server: process.env.SMTP_SERVER,
  port: number(process.env.SMTP_PORT, 587),
  password: process.env.SMTP_PASSWORD,
  secure: flag(process.env.SMTP_SECURE),
}));

export const authConfig = registerAs('auth', () => ({
  secretKey: process.env.SECRET_KEY,
  /** Trades for an admin session on `/tokenlogin`, for scripts and CI. */
  automationToken: process.env.AUTOMATION_TOKEN,
  requireActivation: flag(process.env.REQUIRE_ACTIVATION),
  enableSelfRegistration: flag(process.env.ENABLE_SELF_REGISTRATION),
  selfRegistrationPassword: process.env.SELF_REGISTRATION_PASSWORD,
  adminUsername: process.env.ADMINUSER_USERNAME,
  adminPassword: process.env.ADMINUSER_PASSWORD,
}));

export const configNamespaces = [appConfig, databaseConfig, influxConfig, mqttConfig, mailConfig, authConfig];
