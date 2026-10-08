import { registerAs } from '@nestjs/config';

/**
 * The environment, read once and grouped by what it configures. Providers take
 * the namespace they need through `@Inject(mqttConfig.KEY)` and get a typed
 * object rather than a bag of strings.
 *
 * The values themselves are unchanged - same variable names, same defaults - so
 * an existing deployment needs no new settings.
 */

/** The file the server reads its settings from; the process environment wins over it. */
export const ENV_FILE = `.env.${process.env.NODE_ENV || 'development'}.local`;

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
  /**
   * Where the app itself is served, for the few messages that leave the server
   * carrying a link back into it. It is not the API's address - a hosted
   * install serves the two from different hosts - and it is not required, so a
   * message that would have linked somewhere says its piece without a link
   * rather than sending anybody to an address this install has never heard of.
   */
  appUrlExternal: (process.env.APP_URL_EXTERNAL ?? '').trim().replace(/\/+$/, '') || null,
  logFormat: process.env.LOG_FORMAT,
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
 * What this install can send at all. Every channel is off until it is
 * configured, and the screens say so: `/me` carries the public key a browser
 * subscribes with and whether there is a bot, so an account screen can offer
 * Web Push and Telegram or explain that this install does not have them.
 *
 * Mail and a person's own webhook need nothing here - they are addresses the
 * person gives - which is why only the two outward-facing surfaces appear.
 */
export const notificationsConfig = registerAs('notifications', () => ({
  pushPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  pushPrivateKey: process.env.VAPID_PRIVATE_KEY || null,
  /**
   * Whom a push service should complain to about this install, which the
   * standard wants as a `mailto:` or an address. It is part of the key pair's
   * identity, so Web Push is off until all three are set.
   */
  pushContact: process.env.VAPID_SUBJECT || null,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
  /** Without a name there is no link to start a chat at, so the bot is off until it has one. */
  telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') || null,
  /**
   * The path Telegram is told to deliver updates to. It is the only thing
   * guarding that route - anybody may post to it otherwise - so the webhook
   * does not exist until this is set.
   */
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
}));

export const terpCamConfig = registerAs('terpcam', () => ({
  /**
   * The controller-relay path: a controller is told to open `relayUrl` as an
   * HTTP upgrade and bridges the camera's P2P over the connection, so the cloud
   * runs the P2P client and pulls a full-resolution still. Empty turns the path
   * off, and the server reaches no Terp Cam then. The default (the API's own
   * URL) lives in docker-compose.yaml, not here.
   */
  relayUrl: (process.env.TERPCAM_RELAY_URL ?? '').trim(),
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

/**
 * How long raw climate points are kept where nobody has said otherwise.
 *
 * An account sets its own window and a tent may set a narrower one; this is the
 * figure a `null` window falls back to, and it is configuration for the same
 * reason the free picture windows are - the mechanism belongs in this
 * repository and the numbers in the install that runs it.
 *
 * Zero is "keep everything", and it is the default on purpose. The app offers
 * "keep everything" as a window of its own, and an install that has never said
 * a word about retention must not start summarising three years of somebody's
 * readings away the first time it is upgraded. An install that wants a window
 * says so. docker-compose.yaml defaults it to 0; the fallback here is for a
 * server started outside compose.
 */
export const retentionConfig = registerAs('retention', () => ({
  climateDays: number(process.env.RETENTION_CLIMATE_DAYS, 0),
}));

/**
 * What the one-off move from the old shapes needs to be told. The language is
 * the only thing the old database cannot answer for itself, and it decides what
 * a migrated grow's measurements are called and what each account's own
 * preference starts as. docker-compose.yaml defaults it to `en`; the fallback
 * here is for `npm run migrate`, which runs outside compose.
 *
 * `allowRejects` lets a boot leave behind the rows a transform could not take,
 * which is otherwise a refusal; nobody types a flag when a container starts.
 */
export const migrationConfig = registerAs('migration', () => ({
  locale: (process.env.MIGRATION_LOCALE ?? 'en').trim() || 'en',
  allowRejects: flag(process.env.MIGRATION_ALLOW_REJECTS),
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
  migrationConfig,
  retentionConfig,
  notificationsConfig,
];
