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
    // Required by the collection, but `required` only constrains new writes,
    // not the rows already stored - and whose link it is, is the server's own
    // bookkeeping rather than something a client reads.
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
    /**
     * A device's plan is stored with an update rather than a document save, so
     * mongoose validates none of it, and the step's fields are the webapp's to
     * add to - the server passes them through. Stored steps are therefore
     * missing whichever of these the app that wrote them did not send.
     *
     * The template collection validates all four, because a template is written
     * as a document rather than updated. `RecipeTemplateStep` stays derived
     * from this one regardless: the app moves steps between a plan and a
     * template, and a template type narrower than the plan's would not survive
     * the first such move.
     */
    // Whatever the device's configuration shape is; the server passes it through.
    settings: anyValue().optional(),
    durationUnit: durationUnit.optional(),
    duration: z.number().optional(),
    waitForConfirmation: z.boolean().optional(),
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
    /**
     * Optional from here on because the collection requires none of it: only
     * `device_id`, `username` and `password` are written for every device. One
     * exists before it is claimed, before it has reported a firmware or a
     * measurement, and before a field added later was backfilled onto it.
     */
    class_id: z.string().optional(),
    device_type: z.string().optional(),
    configuration: z.string().optional(),
    owner_id: z.string().optional(),
    serialnumber: z.number().optional(),
    lastseen: z.number().optional(),
    current_firmware: z.string().optional(),
    pending_firmware: z
      .string()
      .optional()
      .describe('@deprecated Use cloudSettings.pendingFirmware. Kept for reading legacy devices.'),
    fwupdate_start: z.number().optional(),
    fwupdate_end: z.number().optional(),
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
    // Neither is required by the collection: a class has no firmware until one
    // has been built for it, and a description is only ever a label.
    description: z.string().optional(),
    concurrent: z.number(),
    maxfails: z.number(),
    firmware_id: z.string().optional(),
    beta_firmware_id: z.string().optional(),
    alpha_firmware_id: z.string().optional(),
  }),
);

export const deviceClassCount = named('DeviceClassCount', z.object({ class: deviceClass, count: z.number() }));

/** Neither field is required by the collection, so a stored code may name no device. */
export const claimCode = named('ClaimCode', z.object({ claim_code: z.string().optional(), device_id: z.string().optional() }));

export const deviceFirmware = named(
  'DeviceFirmware',
  z.object({
    firmware_id: z.string(),
    // Not required by the collection; a row without one is told apart by its
    // version alone.
    name: z.string().optional(),
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
  // `name` is the file the device asks for; the collection does not require it.
  z.object({ firmware_id: z.string(), name: z.string().optional(), data: wireBytes() }),
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
    // Required by the collection, which only constrains pictures written since
    // the field existed; the ones stored before it do not carry one.
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
    // Only a self-registered account is given one; an account an admin creates,
    // and the configured admin itself, never has one.
    activation_code: z.string().optional(),
  }),
);

/**
 * What the account listing answers with: an account without its secrets. The
 * route projects exactly these three fields, so `User` - which also carries a
 * password hash and an activation code - does not describe it.
 */
export const userAccount = named('UserAccount', user.pick({ user_id: true, username: true, is_admin: true }));

export const passwordToken = named('PasswordToken', z.object({ user_id: z.string(), token: z.string() }));

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

export const chartPreset = named(
  'ChartPreset',
  z.object({
    preset_id: z.string(),
    // Required by the collection, optional here for the reason given on
    // `shareLink.owner_id`.
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
