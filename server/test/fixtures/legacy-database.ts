import { mongo, type Connection } from 'mongoose';

/**
 * A whole database in the shapes this server writes today, for the migration
 * test to run the transforms over.
 *
 * Every collection is written through the driver rather than through mongoose,
 * because a fixture has to be able to store what the schemas would refuse - an
 * unparseable configuration, a picture whose bytes are still in its document,
 * two plan templates with one name. What mongoose does add is reproduced by
 * hand where a transform meets it: the `__v` on every document, and the `_id`
 * every nested object gets (alarms, plan steps, `cloudSettings`,
 * `firmwareSettings`).
 *
 * Nothing here is random and nothing is read from the clock: ids say what they
 * are, and every instant is an offset from the `at` the caller passes, so a
 * failing assertion names a document a reader can find and two runs produce the
 * same database.
 *
 * See README.md next to this file for the one rule these shapes follow.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The collections this server has today. `imagedata.*` is the GridFS bucket the pictures live in. */
const COLLECTIONS = [
  'users',
  'devices',
  'devicelogs',
  'images',
  'imagedata.files',
  'imagedata.chunks',
  'shares',
  'chartpresets',
  'recipetemplates',
  'claimcodes',
  'deviceclasses',
  'devicefirmwares',
  'devicefirmwarebinaries',
  'passwordtokens',
] as const;

export type LegacyCollection = (typeof COLLECTIONS)[number];

export const LEGACY_USER_IDS = {
  admin: 'user-admin',
  /** Owns the tent, the fridge, the fan and the demo controller. */
  ada: 'user-ada',
  /** Owns the balcony plug, and a plan template named like Ada's. */
  ben: 'user-ben',
  /** Signed up and never followed the link. */
  inactive: 'user-cleo',
  /** Activated, with the flag stored as the number mongoose casts to true. */
  activeAsNumber: 'user-dana',
  /** Activated, with the flag stored as the string mongoose casts to true. */
  activeAsString: 'user-eli',
  /** An administrator whose flag is a number, and who is still an administrator. */
  adminAsNumber: 'user-faye',
  /** Neither flag stored at all, which is what the schema's defaults answered for. */
  withoutFlags: 'user-gus',
} as const;

export const LEGACY_DEVICE_IDS = {
  controller: 'dev-controller-tent',
  /** Claimed and never named, which two thirds of the fleet turned out to be. */
  unnamed: 'dev-controller-unnamed',
  fridge: 'dev-fridge-cellar',
  plug: 'dev-plug-balcony',
  fan: 'dev-fan-attic',
  light: 'dev-light-shelf',
  demo: 'dev-controller-demo',
} as const;

export const LEGACY_CLASS_IDS = {
  controller: 'class-controller',
  fridge: 'class-fridge',
  plug: 'class-plug',
  fan: 'class-fan',
  light: 'class-light',
} as const;

/** What the lifecycle entries of one device add up to, for asserting the reconstructed grows. */
export interface LegacyGrow {
  deviceId: string;
  name: string;
  startedAt: number;
  /** Absent while the grow is still running - which is how the reconstruction reads it too. */
  endedAt?: number;
  /** Lifecycle entries the grow is built from. */
  stages: number;
}

export interface LegacyDatabase {
  /** The instant every timestamp in the fixture is measured back from. */
  at: number;
  users: Record<keyof typeof LEGACY_USER_IDS, string>;
  devices: Record<keyof typeof LEGACY_DEVICE_IDS, string>;
  /** Alarm ids on the tent controller: three on its readings, and one per output an alarm can watch. */
  alarms: {
    triggered: string;
    webhook: string;
    disabled: string;
    outputs: { running: string; valve: string; heater: string; fan: string; light: string };
  };
  grows: {
    /** Ended by the next cycle's rollback to germination. */
    finished: LegacyGrow;
    /** Still running: no stage after `vegetative`. */
    running: LegacyGrow;
    /** Two plantings of one strain that today's rule reads as a single grow. */
    merged: LegacyGrow;
  };
  images: {
    stills: string[];
    timelapses: Record<'1d' | '1w' | '1m', string>;
    photos: string[];
    /** Bytes still in the document, nothing in the bucket. */
    inline: string;
    /** Stills of a device that has no stream configured any more. */
    withoutCamera: string[];
  };
  shares: { chartsLink: string; diaryLink: string; expired: string; revoked: string };
  presets: { valid: string; unparseable: string };
  /** The plan template name two owners both use. */
  templates: { duplicateName: string };
  claimCodes: { forLightDevice: string; orphan: string };
  firmwares: { stable: string; beta: string; alpha: string; fridge: string };
  counts: Record<LegacyCollection, number>;
}

/**
 * A document's `_id` carries the second it was written in, because that is
 * where the migration reads a creation date from when a document has no better
 * one. `seq` only keeps two documents of the same collection apart.
 */
const idAt = (when: number, seq: number): mongo.ObjectId =>
  new mongo.ObjectId(
    Math.floor(when / 1000)
      .toString(16)
      .padStart(8, '0') +
      '0000000000' +
      seq.toString(16).padStart(6, '0'),
  );

/** Stand-ins for picture bytes. Nothing in a transform decodes a picture. */
const pictureBytes = (label: string): Buffer => Buffer.from(`picture:${label}`);

/** A bcrypt hash of nothing in particular, so no fixture row looks like a usable password. */
const PASSWORD_HASH = '$2b$10$5cX1KqZ7T0Vj0yH0dQ4dEu1F8sZ9Kk0oL2m4N6p8R0t2V4x6Z8b0C';

/** What a controller reports as its configuration: one JSON object, stored as the string it arrived as. */
const configurationJson = (dayTemperature: number, limit: number) =>
  `{"workmode":"small","daynight":{"day":21600,"night":64800},"day":{"temperature":${dayTemperature},"humidity":60},` +
  `"night":{"temperature":21,"humidity":55},"co2":{"target":900,"sunsetOff":true},` +
  `"lights":{"sunrise":15,"sunset":15,"limit":${limit},"maintenanceOn":false},"fans":{"internal":60,"external":40}}`;

type Json = Record<string, unknown>;

/**
 * `is_admin` and `is_active` are declared `Boolean` and are not always one.
 * Everything that ever read this collection read it through mongoose, which
 * casts rather than compares, so a row written past the model - by a shell, an
 * import, a release older than the schema - carries `1` or `'true'` and was
 * read as set for as long as the old app ran.
 */
interface LegacyUser {
  _id: mongo.ObjectId;
  username: string;
  password: string;
  user_id: string;
  is_admin?: unknown;
  is_active?: unknown;
  activation_code?: string;
  __v: number;
}

interface LegacyAlarm {
  _id: mongo.ObjectId;
  alarmId: string;
  sensorType: string;
  actionType: 'email' | 'webhook' | 'info';
  actionTarget: string;
  name?: string;
  disabled?: boolean;
  upperThreshold?: number | null;
  lowerThreshold?: number | null;
  cooldownSeconds?: number;
  isTriggered?: boolean;
  lastTriggeredAt?: number;
  lastResolvedAt?: number;
  retriggerSeconds?: number;
  thresholdSeconds?: number;
  additionalInfo?: boolean;
  extremeValue?: number;
  latestDataPointTime?: number;
  webhookMethod?: 'GET' | 'POST' | 'PUT';
  webhookHeaders?: Record<string, string>;
  webhookTriggeredPayload?: string;
  webhookResolvedPayload?: string;
  reportWebhookErrors?: boolean;
  tunnelWebhook?: boolean;
}

interface LegacyRecipeStep {
  _id?: mongo.ObjectId;
  /** Mixed: the plan engine hands it to the configure route, which takes the string a device is sent. */
  settings: string | Json;
  durationUnit: 'minutes' | 'hours' | 'days' | 'weeks';
  duration: number;
  waitForConfirmation: boolean;
  name?: string;
  confirmationMessage?: string;
  lastTimeApplied?: number;
  notified?: boolean;
  stage?: string;
}

interface LegacyDevice {
  _id: mongo.ObjectId;
  device_id: string;
  username: string;
  password: string;
  class_id?: string;
  device_type?: string;
  client_id?: string;
  owner_id?: string;
  configuration?: string;
  serialnumber?: number;
  name?: string;
  lastseen?: number;
  current_firmware?: string;
  pending_firmware?: string;
  fwupdate_start?: number;
  fwupdate_end?: number;
  alarms?: LegacyAlarm[];
  firmwareSettings?: { _id?: mongo.ObjectId; autoUpdate?: boolean };
  cloudSettings?: {
    _id?: mongo.ObjectId;
    autoFirmwareUpdate?: boolean;
    firmwareChannel?: 'stable' | 'beta' | 'alpha' | 'manual';
    pendingFirmware?: string;
    vpdLeafTempOffsetDay?: number;
    vpdLeafTempOffsetNight?: number;
    ppfdLuxFactor?: number;
    betaFeatures?: boolean;
    rtspStream?: string;
    logRtspStreamErrors?: boolean;
    rtspStreamTransport?: string;
    tunnelRtspStream?: boolean;
    maintenanceWebcamOff?: boolean;
    webcamModel?: string;
  };
  maintenance_mode_until?: number;
  recipe?: {
    _id?: mongo.ObjectId;
    steps: LegacyRecipeStep[];
    activeStepIndex: number;
    activeSince: number;
    loop?: boolean;
    notifications?: 'off' | 'onStep' | 'onConfirmation';
    additionalInfo?: boolean;
    email?: string;
  };
  /** Mixed, and every value a string: the device reports one `key=value` line at a time. */
  hardwareInfo?: Record<string, string>;
  demoDevice?: boolean;
  __v: number;
}

interface LegacyDeviceLog {
  _id?: mongo.ObjectId;
  device_id: string;
  message?: string;
  title?: string;
  raw?: boolean;
  severity: number;
  time: Date;
  categories?: string[];
  deleted?: boolean;
  data?: Json;
  images?: string[];
  __v: number;
}

interface LegacyImage {
  _id?: mongo.ObjectId;
  image_id: string;
  device_id: string;
  timestamp: number;
  timestampEnd?: number;
  size?: number;
  format: 'jpeg' | 'mp4' | 'user/jpeg';
  duration?: '1d' | '1w' | '1m';
  /** Only on pictures written before the image store existed. */
  data?: mongo.Binary;
  __v: number;
}

interface LegacyShare {
  _id: mongo.ObjectId;
  share_id: string;
  device_id: string;
  owner_id: string;
  page: 'charts' | 'diary';
  editable: boolean;
  webcam: boolean;
  charts?: boolean;
  query?: string;
  createdAt: number;
  expiresAt?: number | null;
  revokedAt?: number | null;
  openCount: number;
  lastOpenedAt?: number | null;
  __v: number;
}

/**
 * Inserts the fixture and answers what it wrote.
 *
 * `target` is a mongoose connection or a driver database handle; `at` is the
 * instant the fixture is dated against - a test passes a constant, never the
 * clock. The database is expected to be empty.
 */
export async function seedLegacyDatabase(target: Connection | mongo.Db, at: number | Date): Promise<LegacyDatabase> {
  // A connection reaches this open, so it carries the driver's handle.
  const database = 'db' in target ? target.db! : target;
  const now = typeof at === 'number' ? at : at.getTime();
  const ago = (days: number) => now - days * DAY;

  // Only `username` is unique on this collection. `user_id` is what every other
  // collection points at and has no index at all, let alone a unique one.
  const users: LegacyUser[] = [
    {
      _id: idAt(ago(900), 1),
      username: 'admin@terpcontrol.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.admin,
      is_admin: true,
      is_active: true,
      __v: 0,
    },
    {
      _id: idAt(ago(700), 2),
      username: 'ada@example.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.ada,
      is_admin: false,
      is_active: true,
      __v: 0,
    },
    {
      _id: idAt(ago(300), 3),
      username: 'ben@example.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.ben,
      is_admin: false,
      is_active: true,
      // An account that signed itself up keeps its code after activating.
      activation_code: 'activation-ben',
      __v: 0,
    },
    {
      _id: idAt(ago(9), 4),
      username: 'cleo@example.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.inactive,
      is_admin: false,
      is_active: false,
      activation_code: 'activation-cleo',
      __v: 0,
    },
    {
      _id: idAt(ago(650), 5),
      username: 'dana@example.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.activeAsNumber,
      is_admin: false,
      is_active: 1,
      __v: 0,
    },
    {
      _id: idAt(ago(640), 6),
      username: 'eli@example.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.activeAsString,
      is_admin: false,
      is_active: 'true',
      __v: 0,
    },
    {
      _id: idAt(ago(630), 7),
      username: 'faye@example.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.adminAsNumber,
      is_admin: 1,
      is_active: true,
      __v: 0,
    },
    {
      _id: idAt(ago(620), 8),
      username: 'gus@example.test',
      password: PASSWORD_HASH,
      user_id: LEGACY_USER_IDS.withoutFlags,
      __v: 0,
    },
  ];

  const tentAlarms: LegacyAlarm[] = [
    {
      _id: idAt(ago(220), 1),
      alarmId: 'alarm-tent-temperature',
      name: 'Tent too warm',
      sensorType: 'temperature',
      upperThreshold: 31,
      lowerThreshold: null,
      actionType: 'email',
      actionTarget: 'ada@example.test',
      cooldownSeconds: 900,
      retriggerSeconds: 3600,
      thresholdSeconds: 300,
      additionalInfo: true,
      isTriggered: true,
      lastTriggeredAt: now - 2 * HOUR,
      lastResolvedAt: ago(11),
      extremeValue: 33.4,
      latestDataPointTime: now - 5 * MINUTE,
    },
    {
      _id: idAt(ago(220), 2),
      alarmId: 'alarm-tent-humidity',
      name: 'Humidity out of band',
      sensorType: 'humidity',
      upperThreshold: 70,
      lowerThreshold: 35,
      actionType: 'webhook',
      actionTarget: 'https://hooks.example.test/terp/{{deviceId}}',
      webhookMethod: 'POST',
      webhookHeaders: { 'Content-Type': 'application/json', 'X-Api-Key': 'fixture-key' },
      webhookTriggeredPayload: '{"text":"{{alarmName}} on {{deviceName}}: {{value}}%"}',
      webhookResolvedPayload: '{"text":"{{alarmName}} back to {{value}}%"}',
      reportWebhookErrors: true,
      tunnelWebhook: true,
      cooldownSeconds: 600,
      isTriggered: false,
      lastResolvedAt: ago(3),
    },
    {
      _id: idAt(ago(180), 3),
      alarmId: 'alarm-tent-co2',
      name: 'CO2 running out',
      sensorType: 'co2',
      disabled: true,
      lowerThreshold: 400,
      actionType: 'info',
      actionTarget: '',
    },
    // One of each output an alarm can watch, which is what the real database
    // turned out to hold: the two that trip on the output running at all, and
    // the three that are bands on how hard it is working. The heater's
    // thresholds are percentages of a fraction, as the old engine read them.
    {
      _id: idAt(ago(170), 4),
      alarmId: 'alarm-tent-dehumidifier',
      name: 'Fridge never stops',
      sensorType: 'dehumidifier',
      upperThreshold: null,
      lowerThreshold: null,
      actionType: 'email',
      actionTarget: 'ada@example.test',
      cooldownSeconds: 7200,
      retriggerSeconds: 3600,
      thresholdSeconds: 3600,
      additionalInfo: true,
      isTriggered: false,
      extremeValue: 1,
      lastTriggeredAt: ago(9),
      lastResolvedAt: ago(8),
    },
    {
      _id: idAt(ago(170), 5),
      alarmId: 'alarm-tent-co2-valve',
      name: 'CO2 valve stuck open',
      sensorType: 'co2_valve',
      // A threshold nothing has ever read: the old engine tripped this one on
      // the valve being open, whatever stood here.
      upperThreshold: 500,
      lowerThreshold: null,
      actionType: 'info',
      actionTarget: '',
      thresholdSeconds: 600,
    },
    {
      _id: idAt(ago(170), 6),
      alarmId: 'alarm-tent-heater',
      name: 'Heater working too hard',
      sensorType: 'heater',
      upperThreshold: 80,
      lowerThreshold: null,
      actionType: 'email',
      actionTarget: 'ada@example.test',
      cooldownSeconds: 600,
      thresholdSeconds: 300,
      additionalInfo: true,
    },
    {
      _id: idAt(ago(170), 7),
      alarmId: 'alarm-tent-fan',
      name: 'Fan racing',
      sensorType: 'fan',
      upperThreshold: 11,
      lowerThreshold: null,
      actionType: 'email',
      actionTarget: 'ada@example.test',
      cooldownSeconds: 6000,
      retriggerSeconds: 3600,
      thresholdSeconds: 30,
      additionalInfo: true,
      // Standing triggered, so an output alarm brings its open alert across too.
      isTriggered: true,
      lastTriggeredAt: now - 3 * HOUR,
      extremeValue: 14,
      latestDataPointTime: now - 5 * MINUTE,
    },
    {
      _id: idAt(ago(170), 8),
      alarmId: 'alarm-tent-light',
      name: 'Light dimmed',
      sensorType: 'light',
      upperThreshold: 60,
      lowerThreshold: 40,
      actionType: 'info',
      actionTarget: '',
      cooldownSeconds: 600,
      retriggerSeconds: 3600,
    },
  ];

  const devices: LegacyDevice[] = [
    {
      _id: idAt(ago(240), 1),
      device_id: LEGACY_DEVICE_IDS.controller,
      username: `mqtt-${LEGACY_DEVICE_IDS.controller}`,
      password: PASSWORD_HASH,
      class_id: LEGACY_CLASS_IDS.controller,
      device_type: 'controller',
      owner_id: LEGACY_USER_IDS.ada,
      name: 'Tent',
      configuration: configurationJson(27, 100),
      serialnumber: 1,
      lastseen: now - 4 * MINUTE,
      current_firmware: 'fw-controller-1.4.2',
      fwupdate_start: ago(30),
      fwupdate_end: ago(30) + 6 * MINUTE,
      maintenance_mode_until: now + 20 * MINUTE,
      alarms: tentAlarms,
      cloudSettings: {
        _id: idAt(ago(240), 101),
        firmwareChannel: 'beta',
        pendingFirmware: '',
        betaFeatures: true,
        vpdLeafTempOffsetDay: -2,
        vpdLeafTempOffsetNight: -1.5,
        ppfdLuxFactor: 0.0185,
        // A Terp Control Cam: the device paired it locally and reported its id,
        // and the stream is that id rather than a URL.
        rtspStream: 'terpcam://TCAM0001',
        webcamModel: 'terp_cam',
      },
      recipe: {
        _id: idAt(ago(45), 102),
        activeStepIndex: 2,
        activeSince: ago(25),
        loop: false,
        notifications: 'onStep',
        additionalInfo: true,
        email: 'ada@example.test',
        steps: [
          {
            _id: idAt(ago(45), 103),
            name: 'Germination',
            settings: configurationJson(24, 20),
            durationUnit: 'days',
            duration: 4,
            waitForConfirmation: false,
            stage: 'germination',
            lastTimeApplied: ago(40),
            notified: true,
          },
          {
            _id: idAt(ago(45), 104),
            name: 'Seedling',
            settings: configurationJson(25, 40),
            durationUnit: 'days',
            duration: 11,
            waitForConfirmation: false,
            stage: 'seedling',
            lastTimeApplied: ago(36),
            notified: true,
          },
          {
            _id: idAt(ago(45), 105),
            name: 'Vegetative',
            settings: configurationJson(27, 100),
            durationUnit: 'weeks',
            duration: 4,
            waitForConfirmation: true,
            confirmationMessage: 'Top the plants before confirming.',
            stage: 'vegetative',
            lastTimeApplied: ago(25),
            notified: true,
          },
          {
            _id: idAt(ago(45), 106),
            name: 'Flowering',
            settings: configurationJson(26, 100),
            durationUnit: 'weeks',
            duration: 8,
            waitForConfirmation: false,
            stage: 'flowering',
          },
        ],
      },
      hardwareInfo: {
        firmware_version: '1.4.2',
        claimcode_auth: 'on',
        co2: 'on',
        leaf_temp: 'on',
        ppfd: 'on',
        webcam_did: 'TCAM0001',
        webcam_uid: 'UID0001TCAM',
        webcam_pwd: 'fixture-cam-password',
        webcam_url: 'rtsp://10.0.0.51:554/live/ch0',
        // The socket table as the firmware sends it: the roles, the per-role
        // summary that predates several sockets per role, the count, and the
        // table itself in chunks of three. Row 4 was paired before hardware ids
        // were kept, so its id is empty.
        sockets: 'light,light,heater,dehumidifier,co2',
        socket_ips: 'light@10.0.0.11,heater@10.0.0.13,dehumidifier@10.0.0.14,co2@10.0.0.15',
        sockets_n: '5',
        socket_list0: 'light|A4CF12000011|10.0.0.11,light|A4CF12000012|10.0.0.12,heater|A4CF12000013|10.0.0.13',
        socket_list1: 'dehumidifier||10.0.0.14,co2|A4CF12000015|10.0.0.15',
      },
      __v: 0,
    },
    {
      _id: idAt(ago(200), 2),
      device_id: LEGACY_DEVICE_IDS.fridge,
      username: `mqtt-${LEGACY_DEVICE_IDS.fridge}`,
      password: PASSWORD_HASH,
      class_id: LEGACY_CLASS_IDS.fridge,
      device_type: 'fridge',
      owner_id: LEGACY_USER_IDS.ada,
      name: 'Cellar fridge',
      configuration: configurationJson(25, 80),
      serialnumber: 2,
      lastseen: now - 7 * MINUTE,
      current_firmware: 'fw-fridge-2.0.1',
      fwupdate_start: 0,
      fwupdate_end: 0,
      cloudSettings: {
        _id: idAt(ago(200), 101),
        firmwareChannel: 'stable',
        pendingFirmware: '',
        // A camera of its own, reached over RTSP rather than through the device.
        rtspStream: 'rtsp://cam:secret@10.0.0.60:554/stream1',
        rtspStreamTransport: 'tcp',
        tunnelRtspStream: true,
        logRtspStreamErrors: true,
        maintenanceWebcamOff: true,
        webcamModel: 'tapo_c200',
      },
      // Ran to its end: `activeSince` 0 with the steps still there is how a
      // finished or never-started plan is stored.
      recipe: {
        _id: idAt(ago(150), 102),
        activeStepIndex: 0,
        activeSince: 0,
        loop: true,
        notifications: 'off',
        steps: [
          {
            _id: idAt(ago(150), 103),
            name: 'Drying',
            settings: configurationJson(20, 0),
            durationUnit: 'days',
            duration: 10,
            waitForConfirmation: false,
            stage: 'drying',
            lastTimeApplied: 0,
            notified: false,
          },
          {
            _id: idAt(ago(150), 104),
            name: 'Curing',
            settings: configurationJson(18, 0),
            durationUnit: 'weeks',
            duration: 3,
            waitForConfirmation: true,
            stage: 'curing',
          },
        ],
      },
      hardwareInfo: { firmware_version: '2.0.1', claimcode_auth: 'on', sockets: 'none', socket_ips: 'none', sockets_n: '0' },
      __v: 0,
    },
    {
      // Claimed, used, and never given a name. Most of the real fleet looks
      // like this, and the old screens showed its id wherever a name belonged.
      _id: idAt(ago(180), 7),
      device_id: LEGACY_DEVICE_IDS.unnamed,
      username: `mqtt-${LEGACY_DEVICE_IDS.unnamed}`,
      password: PASSWORD_HASH,
      class_id: LEGACY_CLASS_IDS.controller,
      device_type: 'controller',
      owner_id: LEGACY_USER_IDS.ada,
      name: '',
      configuration: configurationJson(24, 60),
      serialnumber: 7,
      lastseen: now - 9 * MINUTE,
      current_firmware: 'fw-controller-1.4.2',
      fwupdate_start: 0,
      fwupdate_end: 0,
      cloudSettings: {
        _id: idAt(ago(180), 121),
        firmwareChannel: 'stable',
        pendingFirmware: '',
        // A stream on a device nobody ever named: its camera has no name to
        // take, and the id it used to fall back to is not one either.
        rtspStream: 'rtsp://10.0.0.71:554/stream1',
        rtspStreamTransport: 'udp',
      },
      hardwareInfo: { firmware_version: '1.4.2', claimcode_auth: 'on', sockets: 'none', socket_ips: 'none', sockets_n: '0' },
      __v: 0,
    },
    {
      _id: idAt(ago(150), 3),
      device_id: LEGACY_DEVICE_IDS.plug,
      username: `mqtt-${LEGACY_DEVICE_IDS.plug}`,
      password: PASSWORD_HASH,
      class_id: LEGACY_CLASS_IDS.plug,
      device_type: 'plug',
      owner_id: LEGACY_USER_IDS.ben,
      name: 'Balcony plug',
      // No `configuration` at all: a device that has never been configured
      // since the field was added carries none.
      serialnumber: 3,
      lastseen: ago(2),
      current_firmware: 'fw-plug-1.1.0',
      // Both deprecated halves of the update settings, as a device that has not
      // been touched since they were replaced still carries them.
      pending_firmware: 'fw-plug-1.2.0',
      firmwareSettings: { _id: idAt(ago(150), 101), autoUpdate: false },
      cloudSettings: { _id: idAt(ago(150), 102), autoFirmwareUpdate: false, pendingFirmware: 'fw-plug-1.2.0' },
      fwupdate_start: ago(40),
      fwupdate_end: ago(40) + 4 * MINUTE,
      // A plan that is running and carries no stage on any of its steps, with
      // no lifecycle entry anywhere on this device. That is what a plan written
      // outside the guided onboarding looks like - the expert plan editor reads
      // the stage and has never written one - and it is the shape most plans in
      // a database that has been running are in. The old app ran it and made no
      // grow of it, because it wrote a lifecycle entry only for a step that
      // carried a stage.
      recipe: {
        _id: idAt(ago(60), 103),
        activeStepIndex: 1,
        activeSince: ago(12),
        loop: false,
        notifications: 'off',
        steps: [
          {
            _id: idAt(ago(60), 104),
            name: 'Woche 1',
            settings: configurationJson(24, 40),
            durationUnit: 'weeks',
            duration: 1,
            waitForConfirmation: false,
            lastTimeApplied: ago(19),
          },
          {
            _id: idAt(ago(60), 105),
            name: 'Woche 2',
            settings: configurationJson(26, 60),
            durationUnit: 'weeks',
            duration: 3,
            waitForConfirmation: false,
            lastTimeApplied: ago(12),
          },
        ],
      },
      // Firmware from before the socket table: the roles and one address each,
      // and no `sockets_n`.
      hardwareInfo: { firmware_version: '1.1.0', sockets: 'heater', socket_ips: 'heater@10.0.0.21' },
      __v: 0,
    },
    {
      _id: idAt(ago(120), 4),
      device_id: LEGACY_DEVICE_IDS.fan,
      username: `mqtt-${LEGACY_DEVICE_IDS.fan}`,
      password: PASSWORD_HASH,
      class_id: LEGACY_CLASS_IDS.fan,
      device_type: 'fan',
      owner_id: LEGACY_USER_IDS.ada,
      name: 'Attic fan',
      // Truncated on its way into the database and never rewritten. It has to
      // survive the transform as something, and the something is a decision.
      configuration: '{"workmode":"small","fans":{"internal":60,',
      serialnumber: 4,
      lastseen: ago(1),
      current_firmware: 'fw-fan-1.0.7',
      fwupdate_start: 0,
      fwupdate_end: 0,
      // No `cloudSettings`: no stream, no channel, nothing. Its stills below
      // are from a camera that was configured once and is gone.
      hardwareInfo: { firmware_version: '1.0.7', sockets: 'none', sockets_n: '0' },
      __v: 0,
    },
    {
      _id: idAt(ago(6), 5),
      device_id: LEGACY_DEVICE_IDS.light,
      username: `mqtt-${LEGACY_DEVICE_IDS.light}`,
      password: PASSWORD_HASH,
      class_id: LEGACY_CLASS_IDS.light,
      device_type: 'light',
      // Registered and never claimed. Unclaimed is the empty string, not an
      // absent field, and registration writes an empty configuration with it.
      owner_id: '',
      configuration: '',
      serialnumber: 5,
      lastseen: 0,
      current_firmware: '',
      fwupdate_start: 0,
      fwupdate_end: 0,
      cloudSettings: { _id: idAt(ago(6), 101), pendingFirmware: 'fw-light-1.0.0' },
      __v: 0,
    },
    {
      _id: idAt(ago(400), 6),
      device_id: LEGACY_DEVICE_IDS.demo,
      username: `mqtt-${LEGACY_DEVICE_IDS.demo}`,
      password: PASSWORD_HASH,
      class_id: LEGACY_CLASS_IDS.controller,
      device_type: 'controller',
      owner_id: LEGACY_USER_IDS.admin,
      name: 'Demo tent',
      configuration: configurationJson(26, 90),
      serialnumber: 6,
      lastseen: now - 2 * MINUTE,
      current_firmware: 'fw-controller-1.4.2',
      fwupdate_start: 0,
      fwupdate_end: 0,
      demoDevice: true,
      cloudSettings: { _id: idAt(ago(400), 101), firmwareChannel: 'manual', pendingFirmware: '', rtspStream: 'terpcam://TCAM0002' },
      hardwareInfo: {
        firmware_version: '1.4.2',
        co2: 'on',
        webcam_did: 'TCAM0002',
        sockets: 'light',
        socket_ips: 'light@10.0.0.31',
        sockets_n: '1',
        socket_list0: 'light|A4CF12000031|10.0.0.31',
      },
      __v: 0,
    },
  ];

  const photoIds = ['img-photo-topping', 'img-photo-trichomes'];

  /**
   * The finished and the running cycle of the tent, and the two plantings of
   * the fridge. A cycle ends where the next one starts, and the next one starts
   * on a rollback in stage order or on a changed name - so the fridge's second
   * planting, which shares its name and was only logged from `flowering` on,
   * starts no new cycle at all.
   */
  const lifecycle = (deviceId: string, days: number, stage: string, name: string, viaApp: boolean): LegacyDeviceLog => ({
    device_id: deviceId,
    title: 'message-diary-plant-lifecycle',
    message: '',
    severity: 0,
    time: new Date(ago(days)),
    // The app writes `['diary', <slug>]`; the plan engine writes the slug alone.
    categories: viaApp ? ['diary', 'diary-plant-lifecycle'] : ['diary-plant-lifecycle'],
    data: { newLifecycleStage: stage, lifecycleName: name },
    __v: 0,
  });

  /**
   * The same line as the app wrote it before it logged a key: its own English
   * heading in the title, whatever the grower typed underneath. The heading is
   * the app's and says the same thing for every stage, so what survives the
   * migration is the note alone.
   */
  const lifecycleUnderHeading = (deviceId: string, days: number, stage: string, name: string, note: string): LegacyDeviceLog => ({
    ...lifecycle(deviceId, days, stage, name, true),
    title: 'Plant phase change',
    message: note,
  });

  const tent = LEGACY_DEVICE_IDS.controller;
  const fridge = LEGACY_DEVICE_IDS.fridge;

  const devicelogsWithoutIds: LegacyDeviceLog[] = [
    // The tent's first grow, ended by the second one's rollback to germination.
    lifecycle(tent, 160, 'germination', 'Blue Dream', true),
    lifecycle(tent, 156, 'seedling', 'Blue Dream', false),
    lifecycle(tent, 145, 'vegetative', 'Blue Dream', false),
    lifecycle(tent, 115, 'flowering', 'Blue Dream', false),
    lifecycleUnderHeading(tent, 60, 'drying', 'Blue Dream', 'Am Freitag geerntet, hängt jetzt im Keller.'),
    lifecycle(tent, 53, 'curing', 'Blue Dream', true),
    // The tent's second grow, still running.
    lifecycle(tent, 40, 'germination', 'Purple Haze', true),
    lifecycle(tent, 36, 'seedling', 'Purple Haze', false),
    lifecycle(tent, 25, 'vegetative', 'Purple Haze', false),
    // The fridge: two plantings of one strain, the second logged from flowering
    // on. Same name and no rollback, so the reconstruction reads one grow.
    lifecycle(fridge, 120, 'germination', 'Northern Lights', true),
    lifecycle(fridge, 116, 'seedling', 'Northern Lights', true),
    lifecycle(fridge, 100, 'vegetative', 'Northern Lights', true),
    lifecycle(fridge, 70, 'flowering', 'Northern Lights', true),
    lifecycle(fridge, 35, 'drying', 'Northern Lights', true),
    lifecycle(fridge, 28, 'curing', 'Northern Lights', true),

    // A client that had already resolved the key wrote the English sentence in
    // its place. Thirty-three lines of the real database look like this.
    {
      device_id: tent,
      title: 'Plant log entry',
      message: 'Wurzel sichtbar, umgetopft in Jiffy',
      severity: 0,
      time: new Date(ago(23)),
      categories: ['diary', 'plant-log'],
      __v: 0,
    },
    // The other four diary slugs a client writes.
    {
      device_id: tent,
      title: 'message-diary-plant-log',
      message: 'Topped both plants and tied them down.',
      severity: 0,
      time: new Date(ago(22)),
      categories: ['diary', 'diary-plant-log'],
      images: photoIds,
      __v: 0,
    },
    {
      device_id: fridge,
      title: 'message-diary-fridge-log',
      message: 'Swapped the humidity packs.',
      severity: 0,
      time: new Date(ago(30)),
      categories: ['diary', 'diary-fridge-log'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-diary-co2-refill',
      message: '',
      severity: 0,
      time: new Date(ago(18)),
      categories: ['diary', 'diary-co2-refill'],
      data: { co2FillingRest: 35, co2FillingInitial: 425 },
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-diary-measurement',
      message: 'Weekly readings.',
      severity: 0,
      time: new Date(ago(14)),
      categories: ['diary', 'diary-measurement'],
      // Every key the legacy entry data has. A real entry carries whichever
      // readings were taken; this one carries all ten so the transform of each
      // is covered by one document.
      data: {
        co2FillingRest: 35,
        co2FillingInitial: 425,
        newLifecycleStage: 'vegetative',
        lifecycleName: 'Purple Haze',
        lightMeasurement: 640,
        distanceMeasurement: 45,
        tdsMeasurement: 780,
        ecMeasurement: 1.6,
        outsideTemperatureMeasurement: 18.5,
        phMeasurement: 6.2,
      },
      __v: 0,
    },
    // A diary entry with the flag the app sets on every one it writes; it is
    // still in the collection, so it is a line somebody kept.
    {
      device_id: tent,
      title: 'message-diary-plant-log',
      message: 'Wrong device.',
      severity: 0,
      time: new Date(ago(21)),
      categories: ['diary', 'diary-plant-log'],
      deleted: true,
      __v: 0,
    },
    // An entry a client saved without a category.
    {
      device_id: tent,
      title: 'message-diary-plant-log',
      message: 'Repotted.',
      severity: 0,
      time: new Date(ago(19)),
      categories: [],
      __v: 0,
    },

    // What a device says about itself, one category per mapped message key.
    {
      device_id: tent,
      title: 'message-device-booted',
      message: 'message-device-booted:POWERON',
      severity: 0,
      time: new Date(ago(30)),
      categories: ['device', 'device-boot'],
      images: [],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-maintenance-mode-activated-remote',
      message: 'message-maintenance-mode-activated-remote:20',
      severity: 0,
      time: new Date(now - 25 * MINUTE),
      categories: ['device', 'device-maintenance'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-smart-socket-connected',
      message: 'message-smart-socket-connected:light',
      severity: 0,
      time: new Date(ago(29)),
      categories: ['device', 'device-socket'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-co2-low',
      message: 'message-co2-low:380',
      severity: 1,
      time: new Date(ago(17)),
      categories: ['device', 'device-co2'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-ext-sensor-deviate',
      message: 'message-ext-sensor-deviate:2.4',
      severity: 1,
      time: new Date(ago(16)),
      categories: ['device', 'device-sensor'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-buffer-overflow',
      message: 'message-buffer-overflow:512',
      severity: 1,
      time: new Date(ago(15)),
      categories: ['device', 'device-connection'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-firmware-update-complete-with-ids',
      message: 'message-firmware-update-complete-with-ids:1.4.1 -> 1.4.2',
      severity: 0,
      time: new Date(ago(30) + 6 * MINUTE),
      categories: ['device', 'device-firmware'],
      __v: 0,
    },
    // Written by the server when settings change, and deleted on the way in:
    // the diary shows the diff only where the reader asks for it.
    {
      device_id: tent,
      title: 'message-device-configuration-updated',
      message: 'message-device-configuration-updated:day.temperature 26 -> 27',
      severity: 0,
      time: new Date(ago(25)),
      categories: ['device', 'device-configuration'],
      deleted: true,
      __v: 0,
    },
    // A message the device sent verbatim: shown as it is rather than translated.
    {
      device_id: LEGACY_DEVICE_IDS.plug,
      title: 'Relay stuck, retrying',
      message: 'Relay stuck, retrying',
      raw: true,
      severity: 1,
      time: new Date(ago(12)),
      categories: ['device'],
      __v: 0,
    },

    // The alarm state machine.
    {
      device_id: tent,
      title: 'message-alarm-triggered',
      message: 'message-alarm-triggered:Tent too warm (temperature), value=33.4, upper threshold=31, lower threshold=n/a',
      severity: 1,
      time: new Date(now - 2 * HOUR),
      categories: ['alarm', 'alarm-triggered'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-alarm-resolved',
      message: 'message-alarm-resolved:Humidity out of band (humidity), value=58, upper threshold=70, lower threshold=35, extreme value=74',
      severity: 0,
      time: new Date(ago(3)),
      categories: ['alarm', 'alarm-resolved'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-alarm-webhook-error',
      message: 'message-alarm-webhook-error:Humidity out of band - socket hang up',
      severity: 1,
      time: new Date(ago(4)),
      categories: ['alarm', 'alarm-error'],
      __v: 0,
    },

    // The plan engine.
    {
      device_id: tent,
      title: 'message-recipe-advanced',
      message: 'message-recipe-advanced:3 (Vegetative)',
      severity: 0,
      time: new Date(ago(25)),
      categories: ['recipe', 'recipe-step'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-recipe-step-awaiting-confirmation',
      message: 'message-recipe-step-awaiting-confirmation:3 (Vegetative) - Top the plants before confirming.',
      severity: 0,
      time: new Date(ago(24)),
      categories: ['recipe', 'recipe-confirmation'],
      __v: 0,
    },
    {
      device_id: fridge,
      title: 'message-recipe-looped',
      message: 'message-recipe-looped:Drying',
      severity: 0,
      time: new Date(ago(48)),
      categories: ['recipe', 'recipe-step', 'recipe-looped'],
      __v: 0,
    },
    {
      device_id: fridge,
      title: 'message-recipe-completed',
      message: 'message-recipe-completed',
      severity: 0,
      time: new Date(ago(27)),
      categories: ['recipe', 'recipe-step', 'recipe-completed'],
      __v: 0,
    },
    // Written by the settings route when a step is activated by hand, and
    // deleted on the way in like the configuration diff above.
    {
      device_id: tent,
      title: 'message-recipe-step-manually-activated',
      message: 'message-recipe-step-manually-activated:3 (Vegetative)',
      severity: 0,
      time: new Date(ago(25) + HOUR),
      categories: ['recipe'],
      deleted: true,
      __v: 0,
    },

    // The camera poller, which is the only writer of a `webcam` entry the
    // device did not send.
    {
      device_id: fridge,
      title: 'message-rtsp-stream-error',
      message: 'message-rtsp-stream-error:Connection timed out',
      severity: 1,
      time: new Date(ago(9)),
      categories: ['webcam', 'error'],
      __v: 0,
    },
    // The same poller quoting ffmpeg's command line back, which carries the
    // stream's address and therefore the camera's password. The credentials
    // here are invented; what matters is the shape, because that is what the
    // diary kept and what a migration has to take back out.
    {
      device_id: fridge,
      title: 'message-rtsp-stream-error',
      message: 'message-rtsp-stream-error:Error opening input rtsp://cam:sup3r-s3cret@10.0.0.60:554/stream1: Connection refused',
      severity: 1,
      time: new Date(ago(9) + HOUR),
      categories: ['webcam', 'error'],
      __v: 0,
    },
    // The same failure as the old app wrote it before it had a key for it: free
    // text, which is where the other half of these lines keep their password.
    {
      device_id: fridge,
      title: 'Webcam error',
      message: 'ffmpeg failed on rtsp://cam:sup3r-s3cret@10.0.0.60:554/stream1',
      severity: 1,
      time: new Date(ago(9) + 2 * HOUR),
      categories: ['webcam', 'error'],
      __v: 0,
    },
    {
      device_id: tent,
      title: 'message-cam-reset',
      message: 'message-cam-reset:1',
      severity: 0,
      time: new Date(ago(8)),
      categories: ['device', 'webcam'],
      __v: 0,
    },
  ];

  const devicelogs: LegacyDeviceLog[] = devicelogsWithoutIds.map((entry, index) => ({
    _id: idAt(entry.time.getTime(), index + 1),
    ...entry,
  }));

  const still = (imageId: string, deviceId: string, days: number): LegacyImage => ({
    image_id: imageId,
    device_id: deviceId,
    timestamp: ago(days),
    size: pictureBytes(imageId).length,
    format: 'jpeg',
    __v: 0,
  });

  const timelapse = (imageId: string, duration: '1d' | '1w' | '1m', fromDays: number, toDays: number): LegacyImage => ({
    image_id: imageId,
    device_id: tent,
    timestamp: ago(fromDays),
    timestampEnd: ago(toDays),
    size: pictureBytes(imageId).length,
    format: 'mp4',
    duration,
    __v: 0,
  });

  const photo = (imageId: string, days: number): LegacyImage => ({
    image_id: imageId,
    device_id: tent,
    timestamp: ago(days),
    size: pictureBytes(imageId).length,
    format: 'user/jpeg',
    __v: 0,
  });

  const stillIds = ['img-still-tent-1', 'img-still-tent-2', 'img-still-tent-3'];
  const withoutCameraIds = ['img-still-fan-1', 'img-still-fan-2'];
  const timelapseIds = { '1d': 'img-lapse-tent-1d', '1w': 'img-lapse-tent-1w', '1m': 'img-lapse-tent-1m' } as const;
  const inlineId = 'img-still-tent-inline';

  const imagesWithoutIds: LegacyImage[] = [
    still(stillIds[0], tent, 3),
    still(stillIds[1], tent, 2),
    still(stillIds[2], tent, 1),
    timelapse(timelapseIds['1d'], '1d', 1, 0.5),
    timelapse(timelapseIds['1w'], '1w', 7, 1),
    timelapse(timelapseIds['1m'], '1m', 30, 1),
    photo(photoIds[0], 22),
    photo(photoIds[1], 20),
    // Stills of a device that has no stream configured: the camera it had was
    // removed, and nothing points at the pictures any more.
    still(withoutCameraIds[0], LEGACY_DEVICE_IDS.fan, 40),
    still(withoutCameraIds[1], LEGACY_DEVICE_IDS.fan, 39),
    // Written before the image store existed: the bytes are the document's, and
    // it carries no `size` because that field came with the store.
    {
      image_id: inlineId,
      device_id: tent,
      timestamp: ago(150),
      format: 'jpeg',
      data: new mongo.Binary(pictureBytes(inlineId)),
      __v: 0,
    },
  ];

  const images: LegacyImage[] = imagesWithoutIds.map((image, index) => ({ _id: idAt(image.timestamp, index + 1), ...image }));

  // The bucket beside the collection: one file and one chunk per picture whose
  // bytes were written to the store, under the image_id the document names.
  const storedImageIds = images.filter(image => !image.data).map(image => image.image_id);
  const files = storedImageIds.map(imageId => ({
    _id: imageId,
    length: pictureBytes(imageId).length,
    chunkSize: 261120,
    // The ids come from `images` itself, so the picture is always found.
    uploadDate: new Date(images.find(image => image.image_id === imageId)!.timestamp),
    filename: imageId,
  }));
  const chunks = storedImageIds.map((imageId, index) => ({
    _id: idAt(ago(1), index + 1),
    files_id: imageId,
    n: 0,
    data: new mongo.Binary(pictureBytes(imageId)),
  }));

  const chartsQuery = 'measures=temperature%2Chumidity%2Cvpd&vpdMode=leaf&useCustom=false&timespan=7d&interval=15m';

  const shares: LegacyShare[] = [
    {
      _id: idAt(ago(20), 1),
      share_id: 'share-charts-tent',
      device_id: tent,
      owner_id: LEGACY_USER_IDS.ada,
      page: 'charts',
      editable: true,
      webcam: true,
      charts: false,
      query: chartsQuery,
      createdAt: ago(20),
      expiresAt: null,
      revokedAt: null,
      openCount: 12,
      lastOpenedAt: ago(1),
      __v: 0,
    },
    {
      _id: idAt(ago(60), 2),
      share_id: 'share-diary-tent',
      device_id: tent,
      owner_id: LEGACY_USER_IDS.ada,
      page: 'diary',
      editable: false,
      webcam: false,
      charts: true,
      query: 'growCategories=diary%2Crecipe&growCycle=' + ago(40),
      createdAt: ago(60),
      expiresAt: now + 30 * DAY,
      revokedAt: null,
      openCount: 3,
      lastOpenedAt: ago(5),
      __v: 0,
    },
    {
      _id: idAt(ago(45), 3),
      share_id: 'share-expired',
      device_id: fridge,
      owner_id: LEGACY_USER_IDS.ada,
      page: 'charts',
      editable: false,
      webcam: false,
      query: chartsQuery,
      createdAt: ago(45),
      expiresAt: ago(2),
      revokedAt: null,
      openCount: 8,
      lastOpenedAt: ago(3),
      __v: 0,
    },
    {
      _id: idAt(ago(35), 4),
      share_id: 'share-revoked',
      device_id: LEGACY_DEVICE_IDS.plug,
      owner_id: LEGACY_USER_IDS.ben,
      page: 'diary',
      editable: true,
      webcam: true,
      charts: false,
      createdAt: ago(35),
      expiresAt: null,
      revokedAt: ago(5),
      openCount: 0,
      lastOpenedAt: null,
      __v: 0,
    },
  ];

  const chartpresets = [
    {
      _id: idAt(ago(70), 1),
      preset_id: 'preset-tent-climate',
      owner_id: LEGACY_USER_IDS.ada,
      name: 'Climate',
      device_type: 'controller',
      query: chartsQuery,
      createdAt: ago(70),
      __v: 0,
    },
    {
      // Not a query string at all. `URLSearchParams` takes it without
      // complaining and answers one nonsense key, so a transform that assumes a
      // view can be read back out of it gets a preset made of noise.
      _id: idAt(ago(65), 2),
      preset_id: 'preset-broken-query',
      owner_id: LEGACY_USER_IDS.ben,
      name: 'Saved by an older app',
      query: '{"measures":["temperature","humidity"],"timespan":"24h"}',
      createdAt: ago(65),
      __v: 0,
    },
  ];

  const templateStep = (name: string, stage: string, duration: number, settings: string | Json): LegacyRecipeStep => ({
    name,
    settings,
    durationUnit: 'days',
    duration,
    waitForConfirmation: false,
    stage,
  });

  const duplicateTemplateName = 'Autoflower 60 days';

  // The collection declares `name` unique across every owner, so two rows with
  // one name exist only where that index was never built. They are here because
  // the transform has to say what it does with them.
  const recipetemplates = [
    {
      _id: idAt(ago(210), 1),
      name: duplicateTemplateName,
      owner_id: LEGACY_USER_IDS.ada,
      public: false,
      steps: [
        templateStep('Germination', 'germination', 4, configurationJson(24, 20)),
        templateStep('Vegetative', 'vegetative', 21, configurationJson(27, 100)),
        templateStep('Flowering', 'flowering', 35, configurationJson(26, 100)),
      ],
      createdAt: ago(210),
      updatedAt: ago(90),
      __v: 0,
    },
    {
      _id: idAt(ago(120), 2),
      name: duplicateTemplateName,
      owner_id: LEGACY_USER_IDS.ben,
      public: false,
      // The step settings are Mixed: an object is as valid a stored step as the
      // string the other rows carry.
      steps: [templateStep('Whole run', 'flowering', 60, { workmode: 'small', day: { temperature: 26, humidity: 55 } })],
      createdAt: ago(120),
      updatedAt: ago(120),
      __v: 0,
    },
    {
      _id: idAt(ago(300), 3),
      name: 'Photoperiod starter',
      // No owner and public: the templates that ship with the install.
      public: true,
      steps: [
        templateStep('Seedling', 'seedling', 11, configurationJson(25, 40)),
        templateStep('Vegetative', 'vegetative', 28, configurationJson(27, 100)),
      ],
      createdAt: ago(300),
      updatedAt: ago(300),
      __v: 0,
    },
  ];

  const claimcodes = [
    { _id: idAt(ago(6), 1), claim_code: 'CLAIM-LIGHT-01', device_id: LEGACY_DEVICE_IDS.light, __v: 0 },
    // Both fields are optional today, so a code can name no device.
    { _id: idAt(ago(4), 2), claim_code: 'CLAIM-ORPHAN-01', __v: 0 },
  ];

  const deviceclasses = [
    {
      _id: idAt(ago(900), 1),
      class_id: LEGACY_CLASS_IDS.controller,
      name: 'controller',
      description: 'FG Controller 2.0',
      concurrent: 5,
      maxfails: 10,
      firmware_id: 'fw-controller-1.4.2',
      beta_firmware_id: 'fw-controller-1.5.0-beta.1',
      alpha_firmware_id: 'fw-controller-1.6.0-alpha.3',
      __v: 0,
    },
    {
      _id: idAt(ago(900), 2),
      class_id: LEGACY_CLASS_IDS.fridge,
      name: 'fridge',
      description: 'Fridge Controller',
      concurrent: 5,
      maxfails: 10,
      firmware_id: 'fw-fridge-2.0.1',
      __v: 0,
    },
    // A class that has never had a firmware built for it carries an empty id.
    {
      _id: idAt(ago(900), 3),
      class_id: LEGACY_CLASS_IDS.plug,
      name: 'plug',
      description: 'Smart Socket',
      concurrent: 5,
      maxfails: 10,
      firmware_id: '',
      __v: 0,
    },
    {
      _id: idAt(ago(900), 4),
      class_id: LEGACY_CLASS_IDS.fan,
      name: 'fan',
      description: 'Fan Controller',
      concurrent: 5,
      maxfails: 10,
      firmware_id: '',
      __v: 0,
    },
    {
      _id: idAt(ago(900), 5),
      class_id: LEGACY_CLASS_IDS.light,
      name: 'light',
      description: 'Light Controller',
      concurrent: 5,
      maxfails: 10,
      firmware_id: '',
      __v: 0,
    },
  ];

  const devicefirmwares = [
    {
      _id: idAt(ago(80), 1),
      firmware_id: 'fw-controller-1.4.2',
      class_id: LEGACY_CLASS_IDS.controller,
      name: 'controller 1.4.2',
      version: '1.4.2',
      createdAt: ago(80),
      wasStable: true,
      __v: 0,
    },
    {
      _id: idAt(ago(20), 2),
      firmware_id: 'fw-controller-1.5.0-beta.1',
      class_id: LEGACY_CLASS_IDS.controller,
      version: '1.5.0-beta.1',
      createdAt: ago(20),
      wasStable: false,
      __v: 0,
    },
    {
      _id: idAt(ago(5), 3),
      firmware_id: 'fw-controller-1.6.0-alpha.3',
      class_id: LEGACY_CLASS_IDS.controller,
      name: 'controller 1.6.0-alpha.3',
      version: '1.6.0-alpha.3',
      createdAt: ago(5),
      __v: 0,
    },
    {
      _id: idAt(ago(150), 4),
      firmware_id: 'fw-fridge-2.0.1',
      class_id: LEGACY_CLASS_IDS.fridge,
      version: '2.0.1',
      createdAt: ago(150),
      wasStable: true,
      __v: 0,
    },
  ];

  // Several files per build, and a row from before the name was stored.
  const devicefirmwarebinaries = [
    { _id: idAt(ago(80), 1), firmware_id: 'fw-controller-1.4.2', name: 'firmware.bin', data: Buffer.from('controller-1.4.2-image'), __v: 0 },
    { _id: idAt(ago(80), 2), firmware_id: 'fw-controller-1.4.2', name: 'bootloader.bin', data: Buffer.from('controller-1.4.2-bootloader'), __v: 0 },
    { _id: idAt(ago(150), 3), firmware_id: 'fw-fridge-2.0.1', data: Buffer.from('fridge-2.0.1-image'), __v: 0 },
  ];

  const passwordtokens = [
    { _id: idAt(now - 10 * MINUTE, 1), user_id: LEGACY_USER_IDS.ada, token: 'reset-token-ada', createdAt: new Date(now - 10 * MINUTE), __v: 0 },
    // Long past its window, and still in the collection: nothing sweeps them.
    { _id: idAt(ago(2), 2), user_id: LEGACY_USER_IDS.ben, token: 'reset-token-ben', createdAt: new Date(ago(2)), __v: 0 },
  ];

  const contents: Record<LegacyCollection, unknown[]> = {
    users,
    devices,
    devicelogs,
    images,
    'imagedata.files': files,
    'imagedata.chunks': chunks,
    shares,
    chartpresets,
    recipetemplates,
    claimcodes,
    deviceclasses,
    devicefirmwares,
    devicefirmwarebinaries,
    passwordtokens,
  };

  const counts = {} as Record<LegacyCollection, number>;
  for (const collection of COLLECTIONS) {
    const documents = contents[collection];
    await database.collection(collection).insertMany(documents as mongo.Document[]);
    counts[collection] = documents.length;
  }

  return {
    at: now,
    users: { ...LEGACY_USER_IDS },
    devices: { ...LEGACY_DEVICE_IDS },
    alarms: {
      triggered: tentAlarms[0].alarmId,
      webhook: tentAlarms[1].alarmId,
      disabled: tentAlarms[2].alarmId,
      outputs: {
        running: tentAlarms[3].alarmId,
        valve: tentAlarms[4].alarmId,
        heater: tentAlarms[5].alarmId,
        fan: tentAlarms[6].alarmId,
        light: tentAlarms[7].alarmId,
      },
    },
    grows: {
      finished: { deviceId: tent, name: 'Blue Dream', startedAt: ago(160), endedAt: ago(40), stages: 6 },
      running: { deviceId: tent, name: 'Purple Haze', startedAt: ago(40), stages: 3 },
      merged: { deviceId: fridge, name: 'Northern Lights', startedAt: ago(120), stages: 6 },
    },
    images: { stills: stillIds, timelapses: { ...timelapseIds }, photos: photoIds, inline: inlineId, withoutCamera: withoutCameraIds },
    shares: { chartsLink: 'share-charts-tent', diaryLink: 'share-diary-tent', expired: 'share-expired', revoked: 'share-revoked' },
    presets: { valid: 'preset-tent-climate', unparseable: 'preset-broken-query' },
    templates: { duplicateName: duplicateTemplateName },
    claimCodes: { forLightDevice: 'CLAIM-LIGHT-01', orphan: 'CLAIM-ORPHAN-01' },
    firmwares: {
      stable: 'fw-controller-1.4.2',
      beta: 'fw-controller-1.5.0-beta.1',
      alpha: 'fw-controller-1.6.0-alpha.3',
      fridge: 'fw-fridge-2.0.1',
    },
    counts,
  };
}
