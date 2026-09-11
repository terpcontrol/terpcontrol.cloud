import type {
  Alarm,
  ChartPreset,
  ClaimResult,
  CloudSettings,
  Device,
  DeviceAccessInfo,
  DeviceClassRollout,
  DeviceListEntry,
  DeviceLog,
  DiaryEntryData,
  FirmwareListEntry,
  ImageUploadResult,
  MeasureValue,
  Recipe,
  RecipeTemplate,
  SeriesPoint,
  Session,
  SessionTokens,
  SharePage,
  ShareLink,
  UserAccount,
  UserFirmwareList,
} from '@fg2/shared-types';
import { ApiCall } from './api.client';

/**
 * Every route the app calls, named once.
 *
 * Each entry says where a route lives, how it is asked, and what it answers
 * with - the answer drawn from `@fg2/shared-types`, which is generated from the
 * schemas the server documents its routes with (`ApiShape`). A route that
 * answers something else is a compile error at the call site rather than a
 * surprise in the browser.
 *
 * Two shapes of declaration deserve a word:
 *
 * - `ApiCall<void>` is a route whose answer carries nothing the app reads - the
 *   `{ status: 'ok' }` a write acknowledges itself with. Naming it `void` keeps
 *   a caller from reading a field out of it on the strength of a guess.
 * - Several routes deliberately send less than the entity they resemble.
 *   `GET /device` answers `DeviceListEntry`, not `Device`; the firmware listing
 *   answers `FirmwareListEntry`. The projection is what is named here.
 *
 * The request side is the parameter list: a body is built here, from arguments
 * typed the same way, so a call site cannot assemble one the route will refuse.
 */

/** Path segments come from device ids and tokens, so they are escaped. */
const segment = (value: string): string => encodeURIComponent(value);

/** Omits the parameters that carry nothing; the server reads an absent one as its default. */
const searchParams = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) {
      search.set(name, String(value));
    }
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
};

/** A diary entry as the app writes it. */
export interface DiaryEntryInput {
  title: string;
  message?: string;
  raw?: boolean;
  severity: number;
  categories: string[];
  time?: Date;
  data?: Partial<DiaryEntryData>;
  images?: string[];
  deleted?: boolean;
}

/** What the app asks a device to do with its outputs while test mode runs. */
export interface TestOutputs {
  heater: number;
  dehumidifier: number;
  co2: number;
  lights: number;
}

/** Everything a smart-socket command can carry beyond the role it addresses. */
export interface AuxCommandOptions {
  ip?: string;
  user?: string;
  password?: string;
  slot?: number;
  append?: boolean;
}

export const api = {
  session: {
    logIn: (username: string, password: string, stayLoggedIn: boolean): ApiCall<Session> => ({
      method: 'POST',
      path: '/login',
      body: { username, password, stayLoggedIn },
      anonymous: true,
    }),
    logInAsDemo: (): ApiCall<Session> => ({ method: 'POST', path: '/demologin', body: {}, anonymous: true }),
    // Answers with the tokens alone: the refresh token says who the caller is.
    refresh: (token: string): ApiCall<SessionTokens> => ({ method: 'POST', path: '/refresh', body: { token }, anonymous: true }),
    signUp: (username: string, password: string): ApiCall<void> => ({ method: 'POST', path: '/signup', body: { username, password } }),
    activate: (activation_code: string): ApiCall<void> => ({ method: 'POST', path: '/activate', body: { activation_code } }),
    changePassword: (password: string): ApiCall<void> => ({ method: 'POST', path: '/changepass', body: { username: '', password } }),
    requestPasswordReset: (username: string): ApiCall<void> => ({ method: 'POST', path: '/getreset', body: { username, password: '' } }),
    resetPassword: (password: string, token: string): ApiCall<void> => ({ method: 'POST', path: '/reset', body: { password, token } }),
  },

  devices: {
    /** A projection: the configuration blob and the hardware report, not the whole record. */
    mine: (): ApiCall<DeviceListEntry[]> => ({ method: 'GET', path: '/device' }),
    claim: (claim_code: string): ApiCall<ClaimResult> => ({ method: 'POST', path: '/device', body: { claim_code } }),
    unclaim: (device_id: string): ApiCall<void> => ({ method: 'DELETE', path: `/device/${segment(device_id)}` }),
    bySerial: (serialnumber: string): ApiCall<Device> => ({
      method: 'GET',
      path: `/device/byserial${searchParams({ serialnumber })}`,
    }),
    /** The device's own configuration document, handed over as the string it is stored as. */
    configuration: (device_id: string): ApiCall<string> => ({ method: 'GET', path: `/device/config/${segment(device_id)}` }),
    configure: (device_id: string, configuration: string): ApiCall<void> => ({
      method: 'POST',
      path: '/device/configure',
      body: { device_id, configuration },
    }),
    alarms: (device_id: string): ApiCall<Alarm[]> => ({ method: 'GET', path: `/device/alarms/${segment(device_id)}` }),
    setAlarms: (device_id: string, alarms: Alarm[]): ApiCall<void> => ({
      method: 'POST',
      path: '/device/alarms',
      body: { device_id, alarms },
    }),
    accessInfo: (device_id: string): ApiCall<DeviceAccessInfo> => ({
      method: 'GET',
      path: `/device/cloudsettings/${segment(device_id)}`,
    }),
    setCloudSettings: (device_id: string, cloud_settings: CloudSettings): ApiCall<void> => ({
      method: 'POST',
      path: '/device/cloudsettings',
      body: { device_id, cloud_settings },
    }),
    setName: (device_id: string, name: string): ApiCall<void> => ({ method: 'POST', path: '/device/setname', body: { device_id, name } }),
    test: (device_id: string, outputs: TestOutputs): ApiCall<void> => ({
      method: 'POST',
      path: `/device/test/${segment(device_id)}`,
      body: outputs,
    }),
    stopTest: (device_id: string): ApiCall<void> => ({ method: 'DELETE', path: `/device/test/${segment(device_id)}` }),
    maintenanceMode: (device_id: string, duration_minutes: number): ApiCall<void> => ({
      method: 'POST',
      path: '/device/maintenancemode',
      body: { device_id, duration_minutes },
    }),
    reboot: (device_id: string): ApiCall<void> => ({ method: 'POST', path: '/device/reboot', body: { device_id } }),
    auxCommand: (device_id: string, action: string, role: string, options: AuxCommandOptions = {}): ApiCall<void> => ({
      method: 'POST',
      path: '/device/auxcommand',
      body: { device_id, action, role, ...options },
    }),
    /** Always a plan: a device that was never given one answers with an empty plan. */
    recipe: (device_id: string): ApiCall<Recipe> => ({ method: 'GET', path: `/device/recipe/${segment(device_id)}` }),
    setRecipe: (device_id: string, recipe: Recipe): ApiCall<void> => ({ method: 'POST', path: '/device/recipe', body: { device_id, recipe } }),
    firmwares: (device_id: string): ApiCall<UserFirmwareList> => ({ method: 'GET', path: `/device/firmwares/${segment(device_id)}` }),
  },

  diary: {
    list: (
      device_id: string,
      window: { from?: number; to?: number; deleted?: boolean; categories?: string[] } = {},
    ): ApiCall<DeviceLog[]> => ({
      method: 'GET',
      path: `/device/logs/${segment(device_id)}${searchParams({
        from: Number(window.from ?? 0) || undefined,
        to: Number(window.to ?? 0) || undefined,
        deleted: window.deleted ? 1 : undefined,
        categories: window.categories?.join(','),
      })}`,
    }),
    add: (device_id: string, entry: DiaryEntryInput): ApiCall<void> => ({
      method: 'POST',
      path: `/device/logs/${segment(device_id)}`,
      body: entry,
    }),
    update: (device_id: string, log_id: string, entry: DiaryEntryInput): ApiCall<void> => ({
      method: 'PUT',
      path: `/device/logs/${segment(device_id)}/${segment(log_id)}`,
      body: entry,
    }),
    remove: (device_id: string, log_id: string): ApiCall<void> => ({
      method: 'DELETE',
      path: `/device/logs/${segment(device_id)}/${segment(log_id)}`,
    }),
    clear: (device_id: string): ApiCall<void> => ({ method: 'DELETE', path: `/device/logs/${segment(device_id)}` }),
  },

  images: {
    /**
     * Where a picture is read from. Not a call: this goes into an `<img>` or
     * `<video>` tag, which cannot set headers - hence the long-lived image token
     * and the share token in the query rather than in the request.
     */
    source: (
      device_id: string,
      params: { format: 'mp4' | 'jpeg' | 'user/jpeg'; timestamp?: number; duration?: string; image_id?: string; token?: string; share?: string },
    ): string => `/image/${segment(device_id)}${searchParams({ ...params })}`,
    /** The picture itself travels as multipart, so the body is the form. */
    upload: (device_id: string, form: FormData): ApiCall<ImageUploadResult> => ({
      method: 'POST',
      path: `/image/${segment(device_id)}`,
      body: form,
    }),
    testStream: (
      device_id: string,
      settings: { rtspStream: string; rtspStreamTransport?: string; tunnelRtspStream?: boolean },
    ): ApiCall<Blob> => ({ method: 'POST', path: `/image/test/${segment(device_id)}`, body: settings, binary: true }),
  },

  fleet: {
    /** Every device class with the firmwares built for it, and how each is doing. */
    rollouts: (): ApiCall<DeviceClassRollout[]> => ({ method: 'GET', path: '/device/firmwareversions' }),
    createClass: (deviceClass: {
      name: string;
      description: string;
      concurrent: number;
      maxfails: number;
      firmware_id: string;
      beta_firmware_id: string;
      alpha_firmware_id: string;
    }): ApiCall<void> => ({ method: 'POST', path: '/device/class', body: deviceClass }),
    updateClass: (
      class_id: string,
      deviceClass: {
        name: string;
        description: string;
        concurrent: number;
        maxfails: number;
        firmware_id: string;
        beta_firmware_id: string;
        alpha_firmware_id: string;
      },
    ): ApiCall<void> => ({ method: 'POST', path: `/device/class/${segment(class_id)}`, body: deviceClass }),
    /** The image travels as multipart next to the name and version. */
    createFirmware: (form: FormData): ApiCall<FirmwareListEntry> => ({ method: 'POST', path: '/device/firmware', body: form }),
    relabelFirmware: (firmware_id: string, version: string): ApiCall<FirmwareListEntry> => ({
      method: 'PUT',
      path: `/device/firmware/${segment(firmware_id)}`,
      body: { version },
    }),
    deleteFirmware: (firmware_id: string): ApiCall<void> => ({ method: 'DELETE', path: `/device/firmware/${segment(firmware_id)}` }),
  },

  recipeTemplates: {
    list: (): ApiCall<RecipeTemplate[]> => ({ method: 'GET', path: '/device/recipes' }),
    read: (template_id: string): ApiCall<RecipeTemplate> => ({ method: 'GET', path: `/device/recipes/${segment(template_id)}` }),
    create: (name: string, steps: RecipeTemplate['steps'], isPublic: boolean): ApiCall<RecipeTemplate> => ({
      method: 'POST',
      path: '/device/recipes',
      body: { name, steps, public: isPublic },
    }),
    remove: (template_id: string): ApiCall<void> => ({ method: 'DELETE', path: `/device/recipes/${segment(template_id)}` }),
  },

  shares: {
    /** Opened by a visitor who has no session of their own. */
    resolve: (share_id: string): ApiCall<DeviceAccessInfo> => ({
      method: 'GET',
      path: `/share/resolve/${segment(share_id)}`,
      anonymous: true,
    }),
    list: (): ApiCall<ShareLink[]> => ({ method: 'GET', path: '/share' }),
    create: (options: {
      device_id: string;
      page: SharePage;
      editable: boolean;
      webcam: boolean;
      charts?: boolean;
      expires_at: number | null;
      query?: string;
    }): ApiCall<ShareLink> => ({ method: 'POST', path: '/share', body: options }),
    revoke: (share_id: string): ApiCall<ShareLink> => ({ method: 'POST', path: `/share/${segment(share_id)}/revoke`, body: {} }),
    remove: (share_id: string): ApiCall<void> => ({ method: 'DELETE', path: `/share/${segment(share_id)}` }),
    removeInactive: (): ApiCall<void> => ({ method: 'DELETE', path: '/share/inactive' }),
  },

  chartPresets: {
    list: (): ApiCall<ChartPreset[]> => ({ method: 'GET', path: '/chartpresets' }),
    create: (name: string, query: string, device_type?: string): ApiCall<ChartPreset> => ({
      method: 'POST',
      path: '/chartpresets',
      body: { name, query, device_type },
    }),
    remove: (preset_id: string): ApiCall<void> => ({ method: 'DELETE', path: `/chartpresets/${segment(preset_id)}` }),
  },

  users: {
    /** A projection: an account without its password hash and activation code. */
    list: (): ApiCall<UserAccount[]> => ({ method: 'GET', path: '/users' }),
    create: (user: { username: string; password: string; is_admin: boolean }): ApiCall<void> => ({
      method: 'POST',
      path: '/users',
      body: user,
    }),
  },

  measurements: {
    latest: (device_id: string, measure: string): ApiCall<MeasureValue> => ({
      method: 'GET',
      path: `/data/latest/${segment(device_id)}/${segment(measure)}`,
    }),
    series: (
      device_id: string,
      measure: string,
      window: { from: string; to: string; interval: string; method?: string },
    ): ApiCall<SeriesPoint[]> => ({
      method: 'GET',
      path: `/data/series/${segment(device_id)}/${segment(measure)}${searchParams({ ...window })}`,
    }),
  },
};
