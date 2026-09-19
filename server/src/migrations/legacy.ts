import { mongo } from 'mongoose';

/**
 * The collections and shapes this server writes today, as the transforms read
 * them.
 *
 * Every field is optional and nothing is enforced, because that is the truth of
 * the old database: the schemas beside `database/schemas/` mark fields required
 * that documents written years ago do not carry, updates went straight at the
 * collection without validation, and `owner_id: ''` means something that no type
 * says. A transform that believed the old schema would throw on the first row it
 * met; one that believes nothing decides what each absence means, which is the
 * whole job.
 */

export const LEGACY = {
  users: 'users',
  devices: 'devices',
  deviceLogs: 'devicelogs',
  images: 'images',
  shares: 'shares',
  chartPresets: 'chartpresets',
  recipeTemplates: 'recipetemplates',
  claimCodes: 'claimcodes',
  deviceClasses: 'deviceclasses',
  deviceFirmwares: 'devicefirmwares',
  deviceFirmwareBinaries: 'devicefirmwarebinaries',
  passwordTokens: 'passwordtokens',
} as const;

export interface LegacyDocument {
  _id: mongo.ObjectId;
}

export interface LegacyUser extends LegacyDocument {
  username?: string;
  password?: string;
  user_id?: string;
  is_admin?: boolean;
  is_active?: boolean;
  activation_code?: string;
}

export interface LegacyAlarm {
  alarmId?: string;
  name?: string;
  disabled?: boolean;
  sensorType?: string;
  upperThreshold?: number | null;
  lowerThreshold?: number | null;
  actionType?: 'email' | 'webhook' | 'info';
  actionTarget?: string;
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

export interface LegacyRecipeStep {
  /** Mixed: the plan engine hands it to the configure route, which takes the string a device is sent. */
  settings?: string | Record<string, unknown>;
  durationUnit?: 'minutes' | 'hours' | 'days' | 'weeks';
  duration?: number;
  waitForConfirmation?: boolean;
  name?: string;
  confirmationMessage?: string;
  lastTimeApplied?: number;
  notified?: boolean;
  stage?: string;
}

export interface LegacyRecipe {
  steps?: LegacyRecipeStep[];
  activeStepIndex?: number;
  activeSince?: number;
  loop?: boolean;
  notifications?: 'off' | 'onStep' | 'onConfirmation';
  additionalInfo?: boolean;
  email?: string;
}

export interface LegacyCloudSettings {
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
}

export interface LegacyDevice extends LegacyDocument {
  device_id?: string;
  username?: string;
  password?: string;
  class_id?: string;
  device_type?: string;
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
  firmwareSettings?: { autoUpdate?: boolean };
  cloudSettings?: LegacyCloudSettings;
  maintenance_mode_until?: number;
  recipe?: LegacyRecipe;
  /** Mixed, and every value a string: the device reports one `key=value` line at a time. */
  hardwareInfo?: Record<string, string>;
  demoDevice?: boolean;
}

export interface LegacyDeviceLog extends LegacyDocument {
  device_id?: string;
  message?: string;
  title?: string;
  raw?: boolean;
  severity?: number;
  time?: Date;
  categories?: string[];
  deleted?: boolean;
  data?: Record<string, unknown>;
  images?: string[];
}

export interface LegacyImage extends LegacyDocument {
  image_id?: string;
  device_id?: string;
  timestamp?: number;
  timestampEnd?: number;
  size?: number;
  format?: 'jpeg' | 'mp4' | 'user/jpeg';
  duration?: '1d' | '1w' | '1m';
  /** Only on pictures written before the image store existed; the first migration moves it into the bucket. */
  data?: mongo.Binary | Buffer;
}

export interface LegacyRecipeTemplate extends LegacyDocument {
  name?: string;
  owner_id?: string;
  public?: boolean;
  steps?: LegacyRecipeStep[];
  createdAt?: number;
}

export interface LegacyClaimCode extends LegacyDocument {
  claim_code?: string;
  device_id?: string;
}

export interface LegacyDeviceClass extends LegacyDocument {
  class_id?: string;
  name?: string;
  description?: string;
  concurrent?: number;
  maxfails?: number;
  firmware_id?: string;
  beta_firmware_id?: string;
  alpha_firmware_id?: string;
}

export interface LegacyDeviceFirmware extends LegacyDocument {
  firmware_id?: string;
  class_id?: string;
  name?: string;
  version?: string;
  createdAt?: number;
  wasStable?: boolean;
}

export interface LegacyDeviceFirmwareBinary extends LegacyDocument {
  firmware_id?: string;
  name?: string;
  data?: mongo.Binary | Buffer;
}

/**
 * When a document was written, for every migrated document that has no better
 * date: an ObjectId carries the second it was made in, which is the closest
 * thing the old database has to a creation time.
 */
export const createdAtOf = (document: LegacyDocument): Date => document._id.getTimestamp();

/** An instant the old database stores as epoch milliseconds. `0` is how it spells "never". */
export const instantOf = (value: number | null | undefined): Date | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value) : null;

/** A string field that is present, not empty, and means something. */
export const textOf = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
};

export const numberOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** What mongoose's boolean cast takes for set and unset, which is what every old document was read through. */
const CAST_TO_TRUE: unknown[] = [true, 'true', 1, '1', 'yes'];
const CAST_TO_FALSE: unknown[] = [false, 'false', 0, '0', 'no'];

/**
 * A stored flag, read the way the release that wrote it read it.
 *
 * Everything that ever read these documents read them through a mongoose model,
 * and mongoose casts to a boolean rather than comparing: `1`, `'1'`, `'true'`
 * and `'yes'` all arrived as `true`. A transform reads the collection through
 * the driver instead, where a strict comparison turns a flag the old release
 * treated as set into an unset one - an activated account that can no longer
 * sign in, an alarm that was switched off and starts mailing again. What an
 * account or a device could already do is the only definition of what it should
 * be able to do afterwards, so the flag is read by the same rule.
 *
 * A value the cast did not recognise is no answer at all and falls back to
 * `whenAbsent`, which is whatever the field defaulted to where it was declared.
 *
 * Non-booleans are not in a document the model wrote; they are in one written
 * past it, by a shell, an import or a release older than the schema.
 */
export const flagOf = (value: unknown, whenAbsent = false): boolean => {
  if (CAST_TO_TRUE.includes(value)) return true;
  if (CAST_TO_FALSE.includes(value)) return false;
  return whenAbsent;
};

/**
 * How a paired Terp Cam is stored today: in the field meant for an RTSP URL,
 * under a marker followed by the camera's own id. The live reader of it is
 * `modules/camera/terpcam-p2p.service.ts`; the marker is restated here because
 * this is the one place that reads the old field, and it goes with the rest of
 * the legacy layer rather than with the camera the model gives its own record.
 */
const TERPCAM_STREAM_PREFIXES = ['terpcam://', 'okam://'];

/** The camera's id, or null when the stored stream is not a Terp Cam at all. */
export const terpCamLabelOf = (stream: string | null): string | null => {
  const prefix = stream ? TERPCAM_STREAM_PREFIXES.find(candidate => stream.startsWith(candidate)) : undefined;
  return prefix && stream ? textOf(stream.slice(prefix.length)) : null;
};
