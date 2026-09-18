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

// The secret and the seed account are the settings `validateEnvironment` refuses
// to start without, so unlike the rest of the environment they are always set.
export const authConfig = registerAs('auth', () => ({
  secretKey: process.env.SECRET_KEY!,
  /** Trades for an admin session on `POST /v1/sessions/automation`, for scripts and CI. */
  automationToken: process.env.AUTOMATION_TOKEN,
  requireActivation: flag(process.env.REQUIRE_ACTIVATION),
  enableSelfRegistration: flag(process.env.ENABLE_SELF_REGISTRATION),
  selfRegistrationPassword: process.env.SELF_REGISTRATION_PASSWORD,
  adminUsername: process.env.ADMINUSER_USERNAME!,
  adminPassword: process.env.ADMINUSER_PASSWORD!,
}));

/**
 * The two facts an account screen needs before it can offer a notification
 * channel at all: the public half of the VAPID key pair a browser subscribes
 * with, and whether this install has a Telegram bot. Every channel is off until
 * it is configured, and the screen says so.
 */
export const notificationsConfig = registerAs('notifications', () => ({
  pushPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
}));

export const terpCamConfig = registerAs('terpcam', () => ({
  /** The manufacturer's lookup servers: configuration, never addresses in source. */
  rendezvousHosts: (process.env.TERPCAM_RENDEZVOUS_HOSTS ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean),
  /**
   * Address to tell a camera on this network to punch at. Only a private one is
   * used - announcing a public address stops the camera punching at all - which
   * the service checks; a hosted stack correctly advertises nothing.
   */
  advertiseAddress: (process.env.TERPCAM_ADVERTISE_ADDRESS ?? '').trim(),
  /**
   * UDP ports bound for captures, inclusive. One is held per camera served, so
   * the width of the range is how many cameras this server can reach at once.
   * It must be the range the host publishes: the camera answers to the port it
   * saw.
   */
  portsStart: number(process.env.TERPCAM_P2P_PORTS_START, 32200),
  portsEnd: number(process.env.TERPCAM_P2P_PORTS_END, 32209),
}));

/**
 * What Premium gates, and with which numbers. Unset gates nothing at all, which
 * is what a self-hosted install gets: the mechanism lives in this repository and
 * the numbers in the install that sells the thing.
 *
 * Nothing here touches control, charts, diary or alarms - it is the picture
 * pipeline and nothing else.
 */
export const premiumConfig = registerAs('premium', () => ({
  enforced: flag(process.env.PREMIUM_ENFORCED),
  /** What a free camera's stills are **served** at. The stored picture stays whole, so extending restores the history. */
  freeStillWidth: number(process.env.PREMIUM_FREE_STILL_WIDTH, 0),
  /**
   * Deleting a free camera's older pictures is a switch of its own and is off by
   * default: an install that says nothing keeps every picture as long as it
   * always has, and only the served resolution and the renders depend on a tier.
   */
  freeRetention: flag(process.env.PREMIUM_FREE_RETENTION),
  freeStillDays: number(process.env.PREMIUM_FREE_STILL_DAYS, 0),
  freeTimelapseDays: number(process.env.PREMIUM_FREE_TIMELAPSE_DAYS, 0),
  /** Where the renewal button goes. Without one there is nothing to offer, so no camera shows the notice. */
  extendUrl: (process.env.PREMIUM_EXTEND_URL ?? '').trim(),
  priceLabel: (process.env.PREMIUM_PRICE_LABEL ?? '').trim(),
}));

export const configNamespaces = [
  appConfig,
  databaseConfig,
  influxConfig,
  mqttConfig,
  mailConfig,
  authConfig,
  terpCamConfig,
  premiumConfig,
  notificationsConfig,
];
