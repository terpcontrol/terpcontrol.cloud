export interface Alarm {
  name?: string;
  disabled?: boolean;
  alarmId: string;
  sensorType: string;
  upperThreshold?: number | null;
  lowerThreshold?: number | null;
  actionType: 'email' | 'webhook' | 'info';
  additionalInfo?: boolean;
  actionTarget: string;
  cooldownSeconds?: number;
  isTriggered?: boolean;
  lastTriggeredAt?: number;
  lastResolvedAt?: number;
  retriggerSeconds?: number;
  extremeValue?: number;
  latestDataPointTime?: number;
  webhookMethod?: 'GET' | 'POST' | 'PUT';
  webhookHeaders?: { [key: string]: string };
  webhookTriggeredPayload?: string;
  webhookResolvedPayload?: string;
  thresholdSeconds?: number;
  reportWebhookErrors?: boolean;
  tunnelWebhook?: boolean;
}

export interface FirmwareSettings {
  /** @deprecated */
  autoUpdate?: boolean;
}

export type FirmwareChannel = 'stable' | 'beta' | 'alpha' | 'manual';

/**
 * Which camera the webcam stream URL was built for. 'terp_cam' is the Terp
 * Control Cam (URL reported by the device via hardware-info after local
 * pairing); brand values are RTSP URL templates; 'custom' is a raw URL.
 * Only a presentation hint — the stream itself is always cloudSettings.rtspStream.
 */
export type WebcamModel = 'terp_cam' | 'tapo_c200' | 'reolink' | 'hikvision' | 'custom';

export interface CloudSettings {
  /** @deprecated Use firmwareChannel: 'manual' to disable automatic updates. Kept for reading legacy devices. */
  autoFirmwareUpdate?: boolean;
  firmwareChannel?: FirmwareChannel;
  pendingFirmware?: string;
  vpdLeafTempOffsetDay?: number;
  vpdLeafTempOffsetNight?: number;
  ppfdLuxFactor?: number;
  betaFeatures?: boolean;
  rtspStream?: string;
  rtspStreamTransport?: string;
  logRtspStreamErrors?: boolean;
  tunnelRtspStream?: boolean;
  maintenanceWebcamOff?: boolean;
  webcamModel?: WebcamModel;
}

export interface UserFirmwareInfo {
  firmware_id: string;
  version: string;
  createdAt?: number;
  channels: FirmwareChannel[];
  current: boolean;
}

export interface UserFirmwareList {
  current_firmware: string;
  firmwares: UserFirmwareInfo[];
}

export type SharePage = 'charts' | 'diary';

export interface ShareLink {
  share_id: string;
  device_id: string;
  owner_id?: string;
  page: SharePage;
  /** Visitors may change the view (time frame, measures, filters, webcam). */
  editable: boolean;
  /** Visitors may load webcam images/timelapses (diary photos are always visible). */
  webcam: boolean;
  /** Diary links: visitors may open the chart views linked from the grow report. */
  charts?: boolean;
  /** Query string capturing the shared view (time frame, measures, filters). */
  query?: string;
  createdAt: number;
  /** Epoch ms; null means the link never expires. */
  expiresAt?: number | null;
  revokedAt?: number | null;
  openCount: number;
  lastOpenedAt?: number | null;
}

export type ShareAccess = Pick<ShareLink, 'share_id' | 'page' | 'editable' | 'webcam' | 'charts' | 'query' | 'expiresAt'>;

export interface DeviceAccessInfo {
  device_id: string;
  device_type: string;
  name?: string;
  isPublic: boolean;
  cloudSettings: CloudSettings;
  /** Set when access was granted through a share link. */
  share?: ShareAccess;
}

export type DiaryLifecycleStage = 'germination' | 'seedling' | 'vegetative' | 'flowering' | 'drying' | 'curing';

export interface DiaryEntryData {
  co2FillingRest: number;
  co2FillingInitial: number;
  newLifecycleStage: DiaryLifecycleStage;
  lifecycleName: string;
  lightMeasurement: number;
  distanceMeasurement: number;
  tdsMeasurement: number;
  ecMeasurement: number;
  outsideTemperatureMeasurement: number;
  phMeasurement: number;
}

export interface DiaryEntry {
  message?: string;
  title: string;
  time: Date;
  category: string;
  data?: Partial<DiaryEntryData>;
  images?: string[];
}

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';

export interface RecipeStep {
  name?: string;
  settings: any;
  durationUnit: DurationUnit;
  duration: number;
  waitForConfirmation: boolean;
  confirmationMessage?: string;
  lastTimeApplied?: number;
  notified?: boolean;
  /** Grow lifecycle stage this step represents; lets the app label steps and log diary stage transitions. */
  stage?: DiaryLifecycleStage;
}

export interface Recipe {
  steps: RecipeStep[];
  activeStepIndex: number;
  activeSince: number;
  loop?: boolean;
  notifications?: 'off' | 'onStep' | 'onConfirmation';
  additionalInfo?: boolean;
  email?: string;
}

export interface Device {
  _id?: string;
  name?: string;
  device_id: string;
  username: string;
  password: string;
  class_id: string;
  device_type: string;
  configuration: string;
  owner_id: string;
  serialnumber: number;
  lastseen: number;
  current_firmware: string;
  /** @deprecated Use cloudSettings.pendingFirmware. Kept for reading legacy devices. */
  pending_firmware?: string;
  fwupdate_start: number;
  fwupdate_end: number;
  alarms?: [Alarm];
  firmwareSettings?: FirmwareSettings;
  cloudSettings?: CloudSettings;
  maintenance_mode_until?: number;
  /** Seconds left of the maintenance window, 0 when it is not running. Derived from
   * `maintenance_mode_until` when the device is read, never stored. */
  maintenance_mode_seconds_left?: number;
  recipe?: Recipe;
  hardwareInfo?: Record<string, string>;
  /** Readable by everyone through the demo login, with all secrets stripped. */
  demoDevice?: boolean;
}

export interface DeviceClass {
  class_id: string;
  name: string;
  description: string;
  concurrent: number;
  maxfails: number;
  firmware_id: string;
  beta_firmware_id?: string;
  alpha_firmware_id?: string;
}

export interface DeviceClassCount {
  class: DeviceClass;
  count: number;
}

export interface ClaimCode {
  claim_code: string;
  device_id: string;
}

export interface DeviceFirmware {
  firmware_id: string;
  name: string;
  version: string;
  class_id: string;
  createdAt?: number;
  wasStable?: boolean;
}

export interface DeviceFirmwareBinary {
  firmware_id: string;
  name: string;
  data: Buffer;
}

export interface DeviceLog {
  _id: string;
  device_id: string;
  message?: string;
  title?: string;
  raw?: boolean;
  severity: number;
  time: Date;
  categories?: string[];
  deleted?: boolean;
  data?: Partial<DiaryEntryData>;
  images?: string[];
}

export interface Image {
  image_id: string;
  device_id: string;
  timestamp: number;
  timestampEnd?: number;
  data: Buffer;
  format?: 'jpeg' | 'mp4' | 'user/jpeg';
  duration?: '1d' | '1w' | '1m';
}

export interface User {
  user_id: string;
  password: string;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  activation_code: string;
}

export interface PasswordToken {
  user_id: string;
  token: string;
}

export type RecipeTemplateStep = Omit<RecipeStep, 'lastTimeApplied' | 'notified'>;

export type RecipeTemplate = {
  _id?: string;
  name: string;
  owner_id?: string;
  public?: boolean;
  createdAt?: number;
  updatedAt?: number;
  steps: RecipeTemplateStep[];
};

export interface ChartPreset {
  preset_id: string;
  owner_id?: string;
  name: string;
  /** Device type the preset was saved from; informational only. */
  device_type?: string;
  /** Query string capturing the chart view (measures, timespan, interval, vpdMode). */
  query: string;
  createdAt: number;
}

/**
 * The smart-socket hardware report - see index.js, which implements it. The
 * declarations below are the runtime half of this package: firmware, server
 * and webapp all read the same format from here.
 */
export type SocketRole = 'dehumidifier' | 'heater' | 'light' | 'secondary_light' | 'co2';

export interface SocketEntry {
  /** Position in the device's socket table, and how a command addresses it; -1 when the device reports no table. */
  slot: number;
  role: string;
  /** Hardware id (MAC) the device finds it by; empty on sockets paired before ids were kept. */
  id: string;
  ip: string;
}

export const SOCKET_ROLES: SocketRole[];
export const MAX_SOCKETS: number;
export const SOCKETS_PER_REPORT_CHUNK: number;
export function socketListKey(chunk: number): string;
export function socketListChunk(key: string): number | null;
export function socketChunkCount(count: number): number;
export function parseSocketRoles(csv: string | undefined): string[];
export function socketIpFromCsv(csv: string | undefined, role: string): string | null;
export function reportedSocketCount(hardwareInfo: Record<string, string> | undefined): number | null;
export function parseSocketList(hardwareInfo: Record<string, string> | undefined): SocketEntry[] | null;
export function socketsReported(hardwareInfo: Record<string, string> | undefined): boolean;
export function readSockets(hardwareInfo: Record<string, string> | undefined): SocketEntry[];
export function socketRoles(hardwareInfo: Record<string, string> | undefined): string[];
export function socketKey(socket: SocketEntry): string;
export function socketReportKey(hardwareInfo: Record<string, string> | undefined): string;

/**
 * A device's membership in a tent. `seit` is the moment the device was bound,
 * `bis` the moment it was removed; a removed binding is kept so the tent's past
 * still resolves to the device that produced it.
 */
export interface GeraetBindung {
  geraet_id: string;
  seit: number;
  bis?: number;
}

export type ZeltMedium = 'erde' | 'light-mix' | 'all-mix' | 'coco' | 'floragard-light' | 'biotabs' | 'unbekannt';

/** Free-form tent facts. Everything here is optional and cloud-side only. */
export interface ZeltDaten {
  medium?: ZeltMedium;
  schema_id?: string;
  /** Advances on feed events, never on the clock. */
  schema_schritt?: number;
  /** mS/cm of the tap water, asked once the first time an EC is entered. */
  leitungswasser_ec?: number;
  /** Declared light schedule as seconds of day. A claim, not a measurement. */
  licht_plan?: { an: number; aus: number };
  kanne_l?: number;
  foto_zaehler?: number;
}

/**
 * The tent is the subject of the product: a grow that may or may not have
 * devices. `geraete: []` is the reference case, not an error state.
 */
export interface Zelt {
  zelt_id: string;
  besitzer_id: string;
  /** Empty when nobody has named the tent yet; the app renders a translated default. */
  name: string;
  geraete: GeraetBindung[];
  /** IANA zone; every day boundary of this tent is computed in it. */
  zeitzone: string;
  /** Day 1 of the grow, epoch ms. Written at creation and only ever changed by an explicit edit. */
  tag_null: number;
  /** Which device's camera leads when several have one. */
  kamera_leitgeraet?: string;
  erstellt_at: number;
  /** `<besitzer>:<geraet>` when the tent was derived from a claimed device. Unique. */
  migriert_aus?: string;
  d?: ZeltDaten;
}

/**
 * A measurement together with when it was taken, so a reader can tell a live
 * value from a stale one instead of guessing from the request time.
 */
export interface LatestValue {
  value: number;
  /** Epoch ms of the measurement itself; absent when no data point was found. */
  t?: number;
}
