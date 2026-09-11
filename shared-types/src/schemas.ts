import { z } from 'zod';

/**
 * Every shape that crosses the wire, defined once.
 *
 * These schemas are the source: the server validates against them, the API
 * document's `components.schemas` is generated from them, and so is the
 * `index.d.ts` this package's consumers import. Nothing restates them - a field
 * added here reaches the database layer, the document and the webapp's types
 * together, and `npm run generate` is what carries it.
 *
 * Two kinds of value have no JSON Schema of their own and say here how they
 * should be rendered in each output: see `wireDate` and `wireBytes`.
 */

/** Named for the generated output: an entry's id becomes its exported type name. */
export const registry = z.registry<{ id: string }>();

const named = <T extends z.ZodType>(id: string, schema: T): T => {
  registry.add(schema, { id });
  return schema;
};

/**
 * A real Date, not the string one would be serialised to. Mongoose hands these
 * back as Date objects and both halves of the app treat them as such, so the
 * document describes the serialised form while the generated type keeps `Date`.
 */
const wireDate = () => z.date().meta({ type: 'string', format: 'date-time', tsType: 'Date' });

/** Deliberately unconstrained. `z.any()` alone would generate `unknown`. */
const anyValue = () => z.any().meta({ tsType: 'any' });

/** Raw bytes. Only legacy rows and firmware images carry them. */
const wireBytes = () => z.custom<Buffer>().meta({ type: 'string', contentEncoding: 'base64', tsType: 'Buffer' });

export const alarm = named(
  'Alarm',
  z.object({
    name: z.string().optional(),
    disabled: z.boolean().optional(),
    alarmId: z.string(),
    sensorType: z.string(),
    upperThreshold: z.number().nullable().optional(),
    lowerThreshold: z.number().nullable().optional(),
    actionType: z.enum(['email', 'webhook', 'info']),
    additionalInfo: z.boolean().optional(),
    actionTarget: z.string(),
    cooldownSeconds: z.number().optional(),
    isTriggered: z.boolean().optional(),
    lastTriggeredAt: z.number().optional(),
    lastResolvedAt: z.number().optional(),
    retriggerSeconds: z.number().optional(),
    extremeValue: z.number().optional(),
    latestDataPointTime: z.number().optional(),
    webhookMethod: z.enum(['GET', 'POST', 'PUT']).optional(),
    webhookHeaders: z.record(z.string(), z.string()).optional(),
    webhookTriggeredPayload: z.string().optional(),
    webhookResolvedPayload: z.string().optional(),
    thresholdSeconds: z.number().optional(),
    reportWebhookErrors: z.boolean().optional(),
    tunnelWebhook: z.boolean().optional(),
  }),
);

export const firmwareSettings = named(
  'FirmwareSettings',
  z.object({
    autoUpdate: z.boolean().optional().describe('@deprecated'),
  }),
);

export const firmwareChannel = named('FirmwareChannel', z.enum(['stable', 'beta', 'alpha', 'manual']));

export const webcamModel = named(
  'WebcamModel',
  z
    .enum(['terp_cam', 'tapo_c200', 'reolink', 'hikvision', 'custom'])
    .describe(
      "Which camera the webcam stream URL was built for. 'terp_cam' is the Terp " +
        'Control Cam (URL reported by the device via hardware-info after local ' +
        "pairing); brand values are RTSP URL templates; 'custom' is a raw URL. " +
        'Only a presentation hint - the stream itself is always cloudSettings.rtspStream.',
    ),
);

export const cloudSettings = named(
  'CloudSettings',
  z.object({
    autoFirmwareUpdate: z
      .boolean()
      .optional()
      .describe("@deprecated Use firmwareChannel: 'manual' to disable automatic updates. Kept for reading legacy devices."),
    firmwareChannel: firmwareChannel.optional(),
    pendingFirmware: z.string().optional(),
    vpdLeafTempOffsetDay: z.number().optional(),
    vpdLeafTempOffsetNight: z.number().optional(),
    ppfdLuxFactor: z.number().optional(),
    betaFeatures: z.boolean().optional(),
    rtspStream: z.string().optional(),
    rtspStreamTransport: z.string().optional(),
    logRtspStreamErrors: z.boolean().optional(),
    tunnelRtspStream: z.boolean().optional(),
    maintenanceWebcamOff: z.boolean().optional(),
    webcamModel: webcamModel.optional(),
  }),
);

export const userFirmwareInfo = named(
  'UserFirmwareInfo',
  z.object({
    firmware_id: z.string(),
    version: z.string(),
    createdAt: z.number().optional(),
    channels: z.array(firmwareChannel),
    current: z.boolean(),
  }),
);

export const userFirmwareList = named(
  'UserFirmwareList',
  z.object({
    current_firmware: z.string(),
    firmwares: z.array(userFirmwareInfo),
  }),
);

export const sharePage = named('SharePage', z.enum(['charts', 'diary']));

export const shareLink = named(
  'ShareLink',
  z.object({
    share_id: z.string(),
    device_id: z.string(),
    owner_id: z.string().optional(),
    page: sharePage,
    editable: z.boolean().describe('Visitors may change the view (time frame, measures, filters, webcam).'),
    webcam: z.boolean().describe('Visitors may load webcam images/timelapses (diary photos are always visible).'),
    charts: z.boolean().optional().describe('Diary links: visitors may open the chart views linked from the grow report.'),
    query: z.string().optional().describe('Query string capturing the shared view (time frame, measures, filters).'),
    createdAt: z.number(),
    expiresAt: z.number().nullable().optional().describe('Epoch ms; null means the link never expires.'),
    revokedAt: z.number().nullable().optional(),
    openCount: z.number(),
    lastOpenedAt: z.number().nullable().optional(),
  }),
);

export const shareAccess = named(
  'ShareAccess',
  shareLink.pick({ share_id: true, page: true, editable: true, webcam: true, charts: true, query: true, expiresAt: true }),
);

export const deviceAccessInfo = named(
  'DeviceAccessInfo',
  z.object({
    device_id: z.string(),
    device_type: z.string(),
    name: z.string().optional(),
    isPublic: z.boolean(),
    cloudSettings: cloudSettings,
    // Set when access was granted through a share link. Described here rather
    // than with `.describe()`: a description on a named schema makes zod inline
    // it instead of referencing it, which generates a duplicate type.
    share: shareAccess.optional(),
  }),
);

export const diaryLifecycleStage = named(
  'DiaryLifecycleStage',
  z.enum(['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing']),
);

/**
 * Every reading a diary entry can carry. Always written as a subset - see
 * `diaryEntryValues` - but kept whole here because the webapp indexes the type
 * (`DiaryEntryData['newLifecycleStage']`, `keyof DiaryEntryData`), which an
 * all-optional shape would widen with `undefined`.
 */
export const diaryEntryData = named(
  'DiaryEntryData',
  z.object({
    co2FillingRest: z.number(),
    co2FillingInitial: z.number(),
    newLifecycleStage: diaryLifecycleStage,
    lifecycleName: z.string(),
    lightMeasurement: z.number(),
    distanceMeasurement: z.number(),
    tdsMeasurement: z.number(),
    ecMeasurement: z.number(),
    outsideTemperatureMeasurement: z.number(),
    phMeasurement: z.number(),
  }),
);

/**
 * What an entry actually carries: whichever readings were taken.
 *
 * The generated type is spelled `Partial<DiaryEntryData>` rather than emitted as
 * an interface of its own. The two are mutually assignable, but a mapped type
 * and an interface are not interchangeable to overload resolution - Angular's
 * `keyvalue` pipe infers the key union from the mapped type and gives up on the
 * interface, which costs the diary template its types.
 */
export const diaryEntryValues = diaryEntryData.partial().meta({ tsType: 'Partial<DiaryEntryData>' });

export const diaryEntry = named(
  'DiaryEntry',
  z.object({
    message: z.string().optional(),
    title: z.string(),
    time: wireDate(),
    category: z.string(),
    data: diaryEntryValues.optional(),
    images: z.array(z.string()).optional(),
  }),
);

export const durationUnit = named('DurationUnit', z.enum(['minutes', 'hours', 'days', 'weeks']));

export const recipeStep = named(
  'RecipeStep',
  z.object({
    name: z.string().optional(),
    // Whatever the device's configuration shape is; the server passes it through.
    settings: anyValue(),
    durationUnit: durationUnit,
    duration: z.number(),
    waitForConfirmation: z.boolean(),
    confirmationMessage: z.string().optional(),
    lastTimeApplied: z.number().optional(),
    notified: z.boolean().optional(),
    // Grow lifecycle stage this step represents; lets the app label steps and
    // log diary stage transitions. Not `.describe()`d, for the reason above.
    stage: diaryLifecycleStage.optional(),
  }),
);

export const recipe = named(
  'Recipe',
  z.object({
    steps: z.array(recipeStep),
    activeStepIndex: z.number(),
    activeSince: z.number(),
    loop: z.boolean().optional(),
    notifications: z.enum(['off', 'onStep', 'onConfirmation']).optional(),
    additionalInfo: z.boolean().optional(),
    email: z.string().optional(),
  }),
);

export const device = named(
  'Device',
  z.object({
    _id: z.string().optional(),
    name: z.string().optional(),
    device_id: z.string(),
    username: z.string(),
    password: z.string(),
    class_id: z.string(),
    device_type: z.string(),
    configuration: z.string(),
    owner_id: z.string(),
    serialnumber: z.number(),
    lastseen: z.number(),
    current_firmware: z.string(),
    pending_firmware: z
      .string()
      .optional()
      .describe('@deprecated Use cloudSettings.pendingFirmware. Kept for reading legacy devices.'),
    fwupdate_start: z.number(),
    fwupdate_end: z.number(),
    alarms: z.array(alarm).optional(),
    firmwareSettings: firmwareSettings.optional(),
    cloudSettings: cloudSettings.optional(),
    maintenance_mode_until: z.number().optional(),
    maintenance_mode_seconds_left: z
      .number()
      .optional()
      .describe(
        'Seconds left of the maintenance window, 0 when it is not running. Derived from `maintenance_mode_until` when the device is read, never stored.',
      ),
    recipe: recipe.optional(),
    hardwareInfo: z.record(z.string(), z.string()).optional(),
    demoDevice: z.boolean().optional().describe('Readable by everyone through the demo login, with all secrets stripped.'),
  }),
);

/**
 * What the owner's own device listing answers with. The route projects these
 * fields only - it is the list the app opens on, and a device carries a
 * configuration blob and a hardware report, so the rest is left for the routes
 * that are asked for one device. `Device` describes the stored document and the
 * admin listing, not this.
 */
export const deviceListEntry = named(
  'DeviceListEntry',
  device.pick({
    device_id: true,
    configuration: true,
    device_type: true,
    name: true,
    maintenance_mode_until: true,
    maintenance_mode_seconds_left: true,
    cloudSettings: true,
    hardwareInfo: true,
    lastseen: true,
  }),
);

export const deviceClass = named(
  'DeviceClass',
  z.object({
    class_id: z.string(),
    name: z.string(),
    description: z.string(),
    concurrent: z.number(),
    maxfails: z.number(),
    firmware_id: z.string(),
    beta_firmware_id: z.string().optional(),
    alpha_firmware_id: z.string().optional(),
  }),
);

export const deviceClassCount = named('DeviceClassCount', z.object({ class: deviceClass, count: z.number() }));

export const claimCode = named('ClaimCode', z.object({ claim_code: z.string(), device_id: z.string() }));

export const deviceFirmware = named(
  'DeviceFirmware',
  z.object({
    firmware_id: z.string(),
    name: z.string(),
    version: z.string(),
    class_id: z.string(),
    createdAt: z.number().optional(),
    wasStable: z.boolean().optional(),
  }),
);

/**
 * What the firmware listing answers with. The route projects these three fields;
 * `class_id` is required on the stored record but deliberately not sent, so
 * `DeviceFirmware` does not describe this answer.
 */
export const firmwareListEntry = named('FirmwareListEntry', deviceFirmware.pick({ firmware_id: true, name: true, version: true }));

export const deviceFirmwareBinary = named(
  'DeviceFirmwareBinary',
  z.object({ firmware_id: z.string(), name: z.string(), data: wireBytes() }),
);

export const deviceLog = named(
  'DeviceLog',
  z.object({
    _id: z.string(),
    device_id: z.string(),
    message: z.string().optional(),
    title: z.string().optional(),
    raw: z.boolean().optional(),
    severity: z.number(),
    time: wireDate(),
    categories: z.array(z.string()).optional(),
    deleted: z.boolean().optional(),
    data: diaryEntryValues.optional(),
    images: z.array(z.string()).optional(),
  }),
);

export const image = named(
  'Image',
  z.object({
    image_id: z.string(),
    device_id: z.string(),
    timestamp: z.number(),
    timestampEnd: z.number().optional(),
    data: wireBytes().optional().describe('Only on pictures written before the payload moved to the image store.'),
    size: z.number().optional().describe('Bytes of the stored picture.'),
    format: z.enum(['jpeg', 'mp4', 'user/jpeg']).optional(),
    duration: z.enum(['1d', '1w', '1m']).optional(),
  }),
);

export const user = named(
  'User',
  z.object({
    user_id: z.string(),
    password: z.string(),
    username: z.string(),
    is_admin: z.boolean(),
    is_active: z.boolean(),
    // Only an account that signed itself up is sent one; an account an
    // administrator created has none.
    activation_code: z.string().optional(),
  }),
);

/**
 * What the account listing answers with: an account without its secrets. The
 * route projects exactly these three fields, so `User` - which has a password
 * hash - does not describe it.
 */
export const userAccount = named('UserAccount', user.pick({ user_id: true, username: true, is_admin: true }));

/**
 * What the routes that answer one account answer with: the stored account
 * without its password hash, which every one of them projects away. `_id` is
 * mongoose's own, and is how the account routes address an account.
 */
export const userRecord = named('UserRecord', user.omit({ password: true }).extend({ _id: z.string().optional() }));

/**
 * The account routes wrap their answer in an envelope, and have since before
 * the app read them. Described rather than tidied away: the document says what
 * the server sends.
 */
export const accountResult = named('AccountResult', z.object({ data: userRecord, message: z.string() }));

export const passwordToken = named('PasswordToken', z.object({ user_id: z.string(), token: z.string() }));

/**
 * One signed token and how long it is good for. `secret` is minted with the
 * token and travels with it, so a client can tell two sessions of the same
 * account apart.
 */
export const authToken = named('AuthToken', z.object({ token: z.string(), expiresIn: z.number().describe('Seconds.'), secret: z.string() }));

/** The three tokens a session is made of: one to call with, one to renew it, one for picture URLs. */
export const sessionTokens = named(
  'SessionTokens',
  z.object({ userToken: authToken, refreshToken: authToken, imageToken: authToken }),
);

/**
 * Who a session belongs to, as the sign-in routes report it. The demo login
 * answers this without an account behind it, which is what `is_demo` says.
 */
export const sessionUser = named('SessionUser', userAccount.extend({ is_demo: z.boolean().optional() }));

export const loginResult = named('LoginResult', sessionTokens.extend({ user: sessionUser }));

/**
 * What the automation token buys: a short-lived administrator session and
 * nothing to renew it with, so a caller that needs longer asks again.
 */
export const automationSession = named('AutomationSession', sessionTokens.pick({ userToken: true }));

/**
 * What a sign-up is told about the account it just made. Never the password
 * hash, and never the activation code: the route is open, so anyone could
 * otherwise activate an address they do not own.
 */
export const signupAccount = named('SignupAccount', user.pick({ user_id: true, username: true, is_active: true }));

/** The envelope the sign-up route answers in, like the account routes. */
export const signupResult = named('SignupResult', z.object({ data: signupAccount, message: z.string() }));

export const recipeTemplateStep = named('RecipeTemplateStep', recipeStep.omit({ lastTimeApplied: true, notified: true }));

export const recipeTemplate = named(
  'RecipeTemplate',
  z.object({
    _id: z.string().optional(),
    name: z.string(),
    owner_id: z.string().optional(),
    public: z.boolean().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    steps: z.array(recipeTemplateStep),
  }),
);

/**
 * One point of a measurement series. `_value` is null where the window it covers
 * holds no reading: the series keeps empty windows so a chart draws the gap
 * rather than joining across it. A computed measure that cannot be worked out
 * for a window - VPD without a temperature, say - arrives the same way, because
 * the server has it as NaN and JSON has no such number.
 */
export const measurementPoint = named(
  'MeasurementPoint',
  z.object({ _time: z.string().meta({ format: 'date-time' }), _value: z.number().nullable() }),
);

export const chartPreset = named(
  'ChartPreset',
  z.object({
    preset_id: z.string(),
    owner_id: z.string().optional(),
    name: z.string(),
    device_type: z.string().optional().describe('Device type the preset was saved from; informational only.'),
    query: z.string().describe('Query string capturing the chart view (measures, timespan, interval, vpdMode).'),
    createdAt: z.number(),
  }),
);

/**
 * The smart-socket hardware report. Its reader lives in `index.js`, which is the
 * runtime half of this package: firmware, server and webapp all read the same
 * format from there.
 */
export const socketRole = named('SocketRole', z.enum(['dehumidifier', 'heater', 'light', 'secondary_light', 'co2']));

export const socketEntry = named(
  'SocketEntry',
  z.object({
    slot: z
      .number()
      .describe("Position in the device's socket table, and how a command addresses it; -1 when the device reports no table."),
    role: z.string(),
    id: z.string().describe('Hardware id (MAC) the device finds it by; empty on sockets paired before ids were kept.'),
    ip: z.string(),
  }),
);
