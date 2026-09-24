"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planNotify = exports.planNotifyMode = exports.planStep = exports.stepDuration = exports.durationUnit = exports.socketTestCreate = exports.socketOverrideUpdate = exports.socketUpdate = exports.deviceCommandResult = exports.deviceCommand = exports.socketSetCommand = exports.socketCredentials = exports.socketOverrideCommand = exports.captureStillCommand = exports.stopTestCommand = exports.testCommand = exports.maintenanceCommand = exports.rebootCommand = exports.socketPage = exports.deviceCapabilities = exports.socket = exports.socketTimer = exports.socketOverride = exports.socketOverrideState = exports.socketState = exports.deviceClaimResult = exports.deviceClaimCreate = exports.claimCode = exports.firmwareBinaryUpload = exports.firmwareBinary = exports.firmwareUpdate = exports.firmwareCreate = exports.firmwarePage = exports.firmware = exports.deviceClassUpdate = exports.deviceClassCreate = exports.deviceClassPage = exports.deviceClass = exports.deviceClassRollout = exports.deviceClassFirmwareIds = exports.adminDeviceCreate = exports.deviceConfigurationEnvelope = exports.deviceUpdate = exports.devicePage = exports.device = exports.deviceState = exports.deviceSettings = exports.deviceFirmwareTarget = exports.deviceConfiguration = exports.firmwareChannel = void 0;
exports.adminLogPage = exports.adminLogLine = exports.adminLogLevel = exports.adminStats = exports.adminAlarmWatch = exports.adminRetentionRun = exports.adminRenderStats = exports.adminContentStats = exports.adminCameraStats = exports.adminDeviceStats = exports.adminUserStats = exports.fleet = exports.fleetClass = exports.fleetFirmwareStats = exports.deviceSeries = exports.seriesQuery = exports.outputSeries = exports.metricSeries = exports.deviceLive = exports.setpoints = exports.alertPage = exports.alert = exports.alertWatched = exports.alarmSilence = exports.alarmRuleUpdate = exports.alarmRuleCreate = exports.alarmRulePage = exports.alarmRule = exports.alarmRuleState = exports.alarmWatch = exports.outputRunningWatch = exports.outputLevelWatch = exports.readingWatch = exports.alarmDelivery = exports.alarmDeliveryCustom = exports.alarmDeliveryChannel = exports.alarmWebhook = exports.alarmDeliveryMode = exports.alarmOrigin = exports.planTransition = exports.planTemplateUpdate = exports.planTemplateCreate = exports.planTemplatePage = exports.planTemplate = exports.planReplace = exports.planStepInput = exports.plan = exports.planState = void 0;
const zod_1 = require("zod");
const common_js_1 = require("./common.js");
const socket_report_js_1 = require("./socket-report.js");
/**
 * The device half of the `/v1` contract: what a device is, what it runs and what
 * it is told, plus the read models the device screens are drawn from.
 *
 * Everything a device itself speaks - its HTTP routes, its MQTT payloads, its
 * snake_case keys and epoch seconds - is frozen and stays in the server's
 * `device-protocol` module. Nothing of that vocabulary leaks in here: these are
 * the shapes the app and the API agree on, and the protocol module translates.
 */
/**
 * Where a device takes its firmware from. `manual` is not a build channel but the
 * absence of one: the device stays on what an operator picked.
 */
exports.firmwareChannel = (0, common_js_1.named)('FirmwareChannel', zod_1.z.enum(['stable', 'beta', 'alpha', 'manual']));
/**
 * The device's own configuration document, passed through untouched.
 *
 * Its schema belongs to the firmware of that device type, not to this package:
 * every type has its own keys, an older build has fewer of them, and the server
 * never interprets one. Typing it here would date the moment a firmware adds a
 * field.
 */
exports.deviceConfiguration = (0, common_js_1.named)('DeviceConfiguration', zod_1.z.record(zod_1.z.string(), (0, common_js_1.anyValue)()));
exports.deviceFirmwareTarget = (0, common_js_1.named)('DeviceFirmwareTarget', zod_1.z.object({
    channel: exports.firmwareChannel,
    targetId: (0, common_js_1.id)().nullable().describe('The build this device should be running; null while it follows its channel.'),
}));
/**
 * The two derived measures the cloud computes rather than the device: leaf
 * temperature offsets give VPD, the lux factor gives PPFD. They sit on the device
 * because they describe its sensor's placement, not what is grown under it.
 */
exports.deviceSettings = (0, common_js_1.named)('DeviceSettings', zod_1.z.object({
    vpdLeafOffsetDay: zod_1.z.number(),
    vpdLeafOffsetNight: zod_1.z.number(),
    ppfdLuxFactor: zod_1.z.number(),
}));
exports.deviceState = (0, common_js_1.named)('DeviceState', zod_1.z.object({
    lastSeenAt: (0, common_js_1.instant)().nullable().describe('Last sample or status; what `offline` is decided from.'),
    claimedAt: (0, common_js_1.instant)().nullable(),
    firmwareId: (0, common_js_1.id)().nullable().describe('What the device reports it is running, which is the build uuid.'),
    updateStartedAt: (0, common_js_1.instant)().nullable().describe('When the device was last told which build to install, however it was told.'),
    updateEndedAt: (0, common_js_1.instant)().nullable(),
    updateFailedAt: (0, common_js_1.instant)()
        .nullable()
        .describe('When the cloud gave up waiting for that build and said so in the diary; null while an update is owed but not yet overdue.'),
    maintenanceUntil: (0, common_js_1.instant)().nullable().describe("The device suppresses its own alarms until then; the cloud's are silenced separately."),
    hardware: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).describe('The raw `hardware-info` report, flat as the device sends it.'),
    // Keyed by slot, because that is how a socket is addressed; the report says
    // a row changed but not when, so the ingest stamps it.
    socketStateChangedAt: zod_1.z.record(zod_1.z.string(), (0, common_js_1.instant)()),
    // An override's row carries the seconds it had left when the table was
    // sent, so the instant the table arrived is what turns them into a time of
    // day. Null for a build that reports no table.
    socketsReportedAt: (0, common_js_1.instant)().nullable(),
}));
/**
 * A device as the API serves it. The broker credentials the device signs in with
 * have no field here: they are a secret, this contract is what crosses the wire,
 * and where they are stored is the mongoose schema's business.
 */
exports.device = (0, common_js_1.named)('Device', zod_1.z.object({
    id: (0, common_js_1.id)().describe('The id the firmware was provisioned with.'),
    createdAt: (0, common_js_1.instant)(),
    // The firmware's own type name (`controller`, `fridge`, `plug`, ...). Not an
    // enum: the set grows with hardware, and a cloud that rejects an unknown one
    // would refuse to register a device newer than itself.
    type: zod_1.z.string(),
    classId: (0, common_js_1.id)().nullable().describe('The update class; null until a firmware has been built for this device.'),
    serialNumber: zod_1.z.number().int().nullable(),
    ownerId: (0, common_js_1.id)().nullable().describe('null while the device is unclaimed and claimable.'),
    spaceId: (0, common_js_1.id)().nullable(),
    name: zod_1.z.string().nullable(),
    firmware: exports.deviceFirmwareTarget,
    configuration: exports.deviceConfiguration.nullable().describe('null before the device has reported one.'),
    settings: exports.deviceSettings,
    isDemo: zod_1.z.boolean(),
    state: exports.deviceState,
}));
exports.devicePage = (0, common_js_1.named)('DevicePage', (0, common_js_1.page)(exports.device));
/**
 * `PATCH /devices/{id}`: what a person decides about a device. What it is, who
 * owns it and everything under `state` are not a client's to write, and the
 * configuration document is replaced whole by its own route rather than patched
 * here, because the server does not read enough of it to merge one.
 */
exports.deviceUpdate = (0, common_js_1.named)('DeviceUpdate', exports.device.pick({ name: true, spaceId: true, firmware: true, settings: true }).partial());
/**
 * `GET` and `PUT /devices/{id}/configuration`, which are one shape in both
 * directions: what a client reads is what it writes back, and a `PUT` replaces
 * the document whole because the server does not read enough of it to merge one.
 *
 * The document travels in a field of its own rather than as the bare body: its
 * keys belong to the firmware and this contract does not know them, so one of
 * them could otherwise collide with a key of the envelope the day the envelope
 * gains one.
 */
exports.deviceConfigurationEnvelope = (0, common_js_1.named)('DeviceConfigurationEnvelope', zod_1.z.object({ configuration: exports.deviceConfiguration }));
/**
 * `POST /admin/devices`. A device normally creates itself by registering with
 * its own firmware; this is the row made by hand, for hardware that has not been
 * flashed yet or that has to be put back after it was removed. It is unclaimed
 * until somebody claims it, like every other device.
 */
exports.adminDeviceCreate = (0, common_js_1.named)('AdminDeviceCreate', exports.device.pick({ id: true, type: true, classId: true, serialNumber: true }));
/** Which build each channel points at; null where a class has nothing on that channel yet. */
exports.deviceClassFirmwareIds = (0, common_js_1.named)('DeviceClassFirmwareIds', zod_1.z.object({ stable: (0, common_js_1.id)().nullable(), beta: (0, common_js_1.id)().nullable(), alpha: (0, common_js_1.id)().nullable() }));
/** A staged rollout: `percent` of the class takes the build, and `paused` stops it where it is. */
exports.deviceClassRollout = (0, common_js_1.named)('DeviceClassRollout', zod_1.z.object({ paused: zod_1.z.boolean(), percent: zod_1.z.number().int().min(0).max(100) }));
exports.deviceClass = (0, common_js_1.named)('DeviceClass', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    name: zod_1.z.string(),
    description: zod_1.z.string().nullable(),
    concurrentUpdates: zod_1.z.number().int().describe('How many devices of the class may be updating at once.'),
    maxFailures: zod_1.z.number().int().describe('Failed updates after which the rollout stops by itself.'),
    firmwareIds: exports.deviceClassFirmwareIds,
    rollout: exports.deviceClassRollout,
}));
exports.deviceClassPage = (0, common_js_1.named)('DeviceClassPage', (0, common_js_1.page)(exports.deviceClass));
/**
 * `POST /admin/device-classes`. Pausing a rollout and staging it at a percentage
 * are changes to the class, which is why `rollout` is written here and has no
 * route of its own: there is one rollout per class and it is never anything but
 * the state this object describes.
 */
exports.deviceClassCreate = (0, common_js_1.named)('DeviceClassCreate', exports.deviceClass.pick({
    name: true,
    description: true,
    concurrentUpdates: true,
    maxFailures: true,
    firmwareIds: true,
    rollout: true,
}));
/** `PATCH /admin/device-classes/{id}`: the same fields, each only if it changes. */
exports.deviceClassUpdate = (0, common_js_1.named)('DeviceClassUpdate', exports.deviceClassCreate.partial());
exports.firmware = (0, common_js_1.named)('Firmware', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    classId: (0, common_js_1.id)(),
    name: zod_1.z
        .string()
        .nullable()
        .describe('What the build was called when it was uploaded. Every build carried over from the old cloud is named after its device class, so it does not tell two builds of one class apart.'),
    version: zod_1.z.string().describe('What the build container stamped the build with - a commit and the branch it came from. Builds are not ordered and cannot be compared, but this is the one field that says which build a device is on.'),
    wasStable: zod_1.z.boolean().describe('Once true it stays true, so a build can be rolled back to knowingly.'),
}));
exports.firmwarePage = (0, common_js_1.named)('FirmwarePage', (0, common_js_1.page)(exports.firmware));
/**
 * `POST /admin/firmwares`: the build itself, without its files - a build is
 * several of them and each is uploaded on its own. `wasStable` is the rollout's
 * record of where the build has been and is never set by hand.
 */
exports.firmwareCreate = (0, common_js_1.named)('FirmwareCreate', exports.firmware.pick({ classId: true, name: true, version: true }));
/**
 * `PATCH /admin/firmwares/{id}`. Relabelling is what this is for: a build's
 * version is the uuid its build container stamped it with, and a human name is
 * how it is told apart in a list.
 */
exports.firmwareUpdate = (0, common_js_1.named)('FirmwareUpdate', exports.firmwareCreate.partial());
/** One file of a build. The bytes are what OTA streams; no listing carries them. */
exports.firmwareBinary = (0, common_js_1.named)('FirmwareBinary', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    firmwareId: (0, common_js_1.id)(),
    name: zod_1.z.string().describe('The file the device asks for by name.'),
    data: (0, common_js_1.bytes)(),
}));
/**
 * `PUT /admin/firmwares/{id}/binaries/{name}`. The build and the file name are
 * the path, so the body is the bytes and nothing else.
 */
exports.firmwareBinaryUpload = (0, common_js_1.named)('FirmwareBinaryUpload', exports.firmwareBinary.pick({ data: true }));
/** What the display shows and a claim is made with. One code per device. */
exports.claimCode = (0, common_js_1.named)('ClaimCode', zod_1.z.object({ id: (0, common_js_1.id)(), createdAt: (0, common_js_1.instant)(), code: zod_1.z.string(), deviceId: (0, common_js_1.id)() }));
/**
 * `POST /devices/claims`. The code the device shows is the whole proof and it
 * names the device, so nothing else identifies one. A device that belongs to no
 * space has no card to appear on, so a claim always ends in one: `spaceId` puts
 * it into a space that exists, and its absence makes one.
 */
exports.deviceClaimCreate = (0, common_js_1.named)('DeviceClaimCreate', exports.claimCode.pick({ code: true }).extend({
    name: zod_1.z.string().optional().describe('Absent names the device after its type.'),
    spaceId: (0, common_js_1.id)().optional(),
}));
/**
 * What a claim answers. The device carries the space it now sits in, so the one
 * thing left to say is whether that space was made by this claim: a new space is
 * offered for naming, an existing one is left alone.
 */
exports.deviceClaimResult = (0, common_js_1.named)('DeviceClaimResult', zod_1.z.object({ device: exports.device, spaceCreated: zod_1.z.boolean() }));
/* ------------------------------------------------------------------ sockets */
/**
 * The state a smart socket's row reports. `unknown` is what a device that
 * reports the older three-column row gives: it names the socket but not whether
 * it is on.
 */
exports.socketState = (0, common_js_1.named)('SocketState', zod_1.z.enum(['on', 'off', 'unknown']));
/** An override forces a socket; `auto` hands it back to its role's control law. */
exports.socketOverrideState = (0, common_js_1.named)('SocketOverrideState', zod_1.z.enum(['on', 'off', 'auto']));
/**
 * An override lives in the device's RAM with an expiry and dies with a reboot,
 * which is the failsafe: nothing outside the firmware can hold a socket on.
 */
exports.socketOverride = (0, common_js_1.named)('SocketOverride', zod_1.z.object({ state: exports.socketOverrideState, validUntil: (0, common_js_1.instant)() }));
/**
 * What a `pump` or a `custom_timer` socket repeats: on for so long, that often.
 * The bounds are the firmware's, which refuses a cycle that is on for at least
 * as long as its period and one longer than an override may hold.
 */
exports.socketTimer = (0, common_js_1.named)('SocketTimer', zod_1.z
    .object({
    onSeconds: zod_1.z.number().int().positive(),
    everySeconds: zod_1.z.number().int().positive().max(socket_report_js_1.SOCKET_HOLD_MAX_SECONDS),
})
    .refine(timer => timer.onSeconds < timer.everySeconds, {
    message: 'A socket that is on for at least as long as its period never switches off',
    path: ['onSeconds'],
}));
/**
 * One socket, as the API serves it: a typed view of `devices.state.hardware`,
 * never stored twice. The decoder's vocabulary is kept - `slot` is the position
 * in the device's table and how a command addresses it, `hardwareId` the MAC the
 * device finds the socket by, `address` its host or IP.
 */
exports.socket = (0, common_js_1.named)('Socket', zod_1.z.object({
    slot: zod_1.z.number().int().describe('-1 when the device reports no table, in which case its role addresses it.'),
    role: common_js_1.socketRole,
    hardwareId: zod_1.z.string().describe('Empty on sockets paired before the firmware kept ids.'),
    address: zod_1.z.string(),
    state: exports.socketState,
    override: exports.socketOverride.nullable(),
    timer: exports.socketTimer.nullable(),
    stateChangedAt: (0, common_js_1.instant)().nullable().describe('When the row last changed state; null until it has been seen change.'),
}));
/**
 * What the device announced it understands. The server sends a command or a role
 * only to a device that named it, because a firmware version cannot be compared
 * (it is the build's uuid) and an old build drops an unknown command silently.
 * A device that announces nothing gets nothing new and its switches are drawn
 * disabled.
 */
exports.deviceCapabilities = (0, common_js_1.named)('DeviceCapabilities', zod_1.z.object({
    socketOverride: zod_1.z.boolean(),
    socketTimer: zod_1.z.boolean(),
    lightOverride: zod_1.z.boolean().describe("Whether the controller's own light output takes an override."),
    roles: zod_1.z.array(common_js_1.socketRole).describe('The roles this build knows; a role outside it is never sent.'),
    // The failsafe the device programs into each socket: how long after the
    // last command a socket switches itself off, so a controller that goes
    // quiet cannot leave a heater on. It is not a minimum on-time, and a screen
    // that reads it as one would tell a grower the opposite of what it means.
    // Keyed by role, and only the roles the device named.
    pulseSeconds: zod_1.z.partialRecord(common_js_1.socketRole, zod_1.z.number().int()),
}));
/** The list carries the capabilities, because a socket row is drawn from both. */
exports.socketPage = (0, common_js_1.named)('SocketPage', (0, common_js_1.page)(exports.socket).extend({ capabilities: exports.deviceCapabilities }));
/* ----------------------------------------------------------------- commands */
/**
 * What a client asks a device to do right now. A discriminated union rather than
 * a free action string, so the route can never publish something the firmware
 * does not know; `kind` is `snake_case` like every other enum value here.
 *
 * None of these is stored or retried: the caller is waiting for the answer.
 */
exports.rebootCommand = (0, common_js_1.named)('RebootCommand', zod_1.z.object({ kind: zod_1.z.literal('reboot') }));
exports.maintenanceCommand = (0, common_js_1.named)('MaintenanceCommand', zod_1.z.object({ kind: zod_1.z.literal('maintenance'), forSeconds: zod_1.z.number().int() }));
/**
 * Drives the controller's own outputs by hand for as long as the test runs.
 * Partial: an output left out keeps doing what it was doing. The value is the
 * output's level, which is on/off for a relay and a percentage for a fan.
 */
exports.testCommand = (0, common_js_1.named)('TestCommand', zod_1.z.object({ kind: zod_1.z.literal('test'), outputs: zod_1.z.partialRecord(common_js_1.outputMetric, zod_1.z.number()) }));
exports.stopTestCommand = (0, common_js_1.named)('StopTestCommand', zod_1.z.object({ kind: zod_1.z.literal('stop_test') }));
/** Asks for a still now. A controller answers for the one Terp Cam it pairs, so it names no camera. */
exports.captureStillCommand = (0, common_js_1.named)('CaptureStillCommand', zod_1.z.object({ kind: zod_1.z.literal('capture_still') }));
/**
 * Forces one socket, or the controller's own light output, for a while. The
 * subject is `{ type, id }` because the two are addressed differently: a socket
 * by its slot, an output by its name.
 */
exports.socketOverrideCommand = (0, common_js_1.named)('SocketOverrideCommand', zod_1.z.object({
    kind: zod_1.z.literal('socket_override'),
    subject: (0, common_js_1.subjectRef)(zod_1.z.enum(['socket', 'output'])),
    state: exports.socketOverrideState,
    forSeconds: zod_1.z
        .number()
        .int()
        .min(0)
        .max(socket_report_js_1.SOCKET_HOLD_MAX_SECONDS)
        .describe('The override expires after this; a reboot ends it too. Zero only with `auto`, which carries no duration.'),
}));
/**
 * The socket's own web credentials, on their way to the device. They travel in
 * this direction only: a command carries them, and `Socket` answers none back.
 * Left out, the device keeps the pair it has.
 */
exports.socketCredentials = (0, common_js_1.named)('SocketCredentials', zod_1.z.object({
    username: zod_1.z.string().max(socket_report_js_1.SOCKET_CREDENTIAL_MAX_LEN),
    password: zod_1.z.string().max(socket_report_js_1.SOCKET_CREDENTIAL_MAX_LEN),
}));
/** Pairs a socket, re-addresses one, or gives it a role and a timer. */
exports.socketSetCommand = (0, common_js_1.named)('SocketSetCommand', zod_1.z.object({
    kind: zod_1.z.literal('socket_set'),
    slot: zod_1.z.number().int().nullable().describe('null adds a socket to the role instead of configuring one it already has.'),
    role: common_js_1.socketRole,
    // Bounded as the firmware bounds it: a row reports its address, and one the
    // row cannot carry would be stored and then left out of the table.
    address: zod_1.z
        .string()
        .min(1)
        .max(socket_report_js_1.SOCKET_ADDRESS_MAX_LEN)
        .regex(/^\S+$/, 'An address the device can reach carries no spaces')
        .describe('Host or IP the device reaches the socket at, over plain HTTP on the local network.'),
    credentials: exports.socketCredentials.nullable(),
    timer: exports.socketTimer.nullable().describe('Only `pump` and `custom_timer` run on one.'),
}));
exports.deviceCommand = (0, common_js_1.named)('DeviceCommand', zod_1.z.discriminatedUnion('kind', [
    exports.rebootCommand,
    exports.maintenanceCommand,
    exports.testCommand,
    exports.stopTestCommand,
    exports.captureStillCommand,
    exports.socketOverrideCommand,
    exports.socketSetCommand,
]));
/**
 * What `POST /devices/{id}/commands` answers. MQTT hands back no receipt and a
 * device that is offline is simply not there to hear the command, so the answer
 * says when it went out and whether anyone was listening, and never claims the
 * device did what it was told.
 */
exports.deviceCommandResult = (0, common_js_1.named)('DeviceCommandResult', zod_1.z.object({
    publishedAt: (0, common_js_1.instant)(),
    deviceOnline: zod_1.z.boolean().describe('Whether the device had been heard from inside the offline window when the command went out.'),
}));
/*
 * The socket routes are the REST face of the two socket commands, so their
 * bodies are those commands without the fields the path already carries. They
 * are derived here, below the union, rather than restated: a socket that can be
 * set two ways would otherwise drift into meaning two things.
 *
 * Each of them answers `DeviceCommandResult` rather than the `Socket` it acted
 * on, for the same reason a command does: a socket row is the device's own
 * report and does not change until the device sends the next one, so answering a
 * row here would be answering what was asked for rather than what is.
 */
/** `PUT /devices/{id}/sockets/{slot}`: pair a socket, re-address one, or give it a role and a timer. */
exports.socketUpdate = (0, common_js_1.named)('SocketUpdate', exports.socketSetCommand.omit({ kind: true, slot: true }));
/** `PUT /devices/{id}/sockets/{slot}/override`. `DELETE` on the same path hands the socket back to its role. */
exports.socketOverrideUpdate = (0, common_js_1.named)('SocketOverrideUpdate', exports.socketOverrideCommand.pick({ state: true, forSeconds: true }));
/**
 * `POST /devices/{id}/sockets/{slot}/tests`. Switching a socket on for a moment
 * is how a person finds out which plug in the tent it is. The firmware puts it
 * back when the time is up, so a test that is never answered still ends.
 */
exports.socketTestCreate = (0, common_js_1.named)('SocketTestCreate', zod_1.z.object({ forSeconds: zod_1.z.number().int().positive() }));
/* --------------------------------------------------------------------- plan */
/** The user's own unit is the fact here, so a step's duration keeps it rather than being seconds. */
exports.durationUnit = (0, common_js_1.named)('DurationUnit', zod_1.z.enum(['minutes', 'hours', 'days', 'weeks']));
/**
 * `value` is not required to be whole. The old recipe screen took whatever
 * somebody typed, and a plan in the field holds a step of half a day - a tent is
 * running on it right now. The engine multiplies the value by its unit and never
 * cared, so the only thing a whole number would buy is that such a plan could be
 * read and not written back, and the step's length would have to be rounded
 * under a running tent to save the recipe it belongs to. Zero is the step with no
 * length, which runs until somebody moves it on.
 */
exports.stepDuration = (0, common_js_1.named)('StepDuration', zod_1.z.object({ value: zod_1.z.number(), unit: exports.durationUnit }));
exports.planStep = (0, common_js_1.named)('PlanStep', zod_1.z.object({
    id: (0, common_js_1.id)().describe('Stable across edits, so `state.activeStepIndex` survives a step being inserted above it.'),
    name: zod_1.z.string(),
    stage: common_js_1.growthStage.nullable().describe('The stage this step puts the grow in; null leaves the phase alone.'),
    preset: zod_1.z.string().nullable().describe('The climate preset applied on top of the stage, such as `late_flowering`.'),
    duration: exports.stepDuration,
    // A fragment of the device's own configuration document, so it is as untyped
    // as that document is.
    settings: exports.deviceConfiguration,
    waitForConfirmation: zod_1.z.boolean(),
    confirmationMessage: zod_1.z.string().nullable(),
}));
/** `on_step` mails at every step change, `on_confirmation` only when the plan waits for a person. */
exports.planNotifyMode = (0, common_js_1.named)('PlanNotifyMode', zod_1.z.enum(['off', 'on_step', 'on_confirmation']));
exports.planNotify = (0, common_js_1.named)('PlanNotify', zod_1.z.object({
    mode: exports.planNotifyMode,
    email: zod_1.z.string().nullable().describe("Where the plan writes; null uses the owner's address."),
    writeEntries: zod_1.z.boolean().describe('Whether a step change also lands in the diary.'),
}));
exports.planState = (0, common_js_1.named)('PlanState', zod_1.z.object({
    status: common_js_1.planStatus,
    activeStepIndex: zod_1.z.number().int(),
    stepStartedAt: (0, common_js_1.instant)().nullable(),
    // A pause keeps what the step had already served, because the step resumes
    // where it stopped rather than starting over.
    pausedElapsedMs: zod_1.z.number().int(),
    pauseReason: zod_1.z.string().nullable(),
    lastAppliedAt: (0, common_js_1.instant)().nullable().describe('The engine re-applies the running step hourly.'),
    confirmationNotifiedAt: (0, common_js_1.instant)().nullable().describe("When the plan's own mail about the waiting step went out, which it does once."),
    // The ask that goes to the people who keep the tent is a fact of the waiting
    // step rather than of the pass that first noticed it: somebody whose night
    // the ask fell into is told once their night is over, so the two instants
    // below are kept apart from the mail above and from each other.
    confirmationAskedAt: (0, common_js_1.instant)()
        .nullable()
        .describe('When everybody who keeps the tent had been told the step is waiting; null while the ask is still outstanding.'),
    confirmationAskTriedAt: (0, common_js_1.instant)().nullable().describe('When that ask was last attempted; an outstanding ask is attempted again.'),
}));
/** One plan per device: it is what the device is currently being run by. */
exports.plan = (0, common_js_1.named)('Plan', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    deviceId: (0, common_js_1.id)(),
    templateId: (0, common_js_1.id)().nullable().describe('What it was started from; null once it no longer matters.'),
    name: zod_1.z.string(),
    steps: zod_1.z.array(exports.planStep),
    loop: zod_1.z.boolean().describe('Start again at the first step instead of completing.'),
    notify: exports.planNotify,
    state: exports.planState,
}));
/**
 * A step as a client writes one. Three fields the server fills in, and each for
 * a reason of its own.
 *
 * Its **id** is the server's because identity is: an edit sends back the ids of
 * the steps it kept, which is what lets the running step survive another being
 * inserted above it, and a step that is new arrives without one.
 *
 * Its **stage** and its **preset** default to `null` because saying nothing
 * about the grow is what nearly every recipe does. A recipe is a sequence of
 * climates, and only the guided onboarding's reference plans ever put a step's
 * name to a botanical stage - every recipe that came out of the old app carries
 * none at all. Demanding the two keys on every step would make a screen with no
 * stage picker unable to write a step without inventing a value for one, and a
 * climate-only recipe that came back from such a screen with a stage on it would
 * start driving phases its tent never had. The answer still carries both, always
 * present and `null` where a step says nothing, so what a client reads back is
 * what a client may write.
 */
exports.planStepInput = (0, common_js_1.named)('PlanStepInput', exports.planStep.partial({ id: true, stage: true, preset: true }));
/**
 * `PUT /devices/{id}/plan`. A device runs one plan, so the route both writes the
 * first one and replaces the one that is there; where the plan stands is `state`
 * and moves only through a transition.
 */
exports.planReplace = (0, common_js_1.named)('PlanReplace', exports.plan.pick({ templateId: true, name: true, loop: true, notify: true }).extend({ steps: zod_1.z.array(exports.planStepInput) }));
/** A plan kept to start others from. It runs nothing, so it has no state. */
exports.planTemplate = (0, common_js_1.named)('PlanTemplate', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    ownerId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    isPublic: zod_1.z.boolean(),
    steps: zod_1.z.array(exports.planStep),
}));
exports.planTemplatePage = (0, common_js_1.named)('PlanTemplatePage', (0, common_js_1.page)(exports.planTemplate));
/** `POST /plan-templates`. The owner is whoever is asking, so a template names no one. */
exports.planTemplateCreate = (0, common_js_1.named)('PlanTemplateCreate', exports.planTemplate.pick({ name: true, isPublic: true }).extend({ steps: zod_1.z.array(exports.planStepInput) }));
/** `PATCH /plan-templates/{id}`: the same fields, each only if it changes. */
exports.planTemplateUpdate = (0, common_js_1.named)('PlanTemplateUpdate', exports.planTemplateCreate.partial());
/** What `POST /devices/{id}/plan/transitions` asks of a running plan. */
exports.planTransition = (0, common_js_1.named)('PlanTransition', zod_1.z.discriminatedUnion('kind', [
    zod_1.z.object({ kind: common_js_1.planTransitionKind.extract(['confirm']) }),
    zod_1.z.object({ kind: common_js_1.planTransitionKind.extract(['skip']) }),
    zod_1.z.object({ kind: common_js_1.planTransitionKind.extract(['extend']), by: exports.stepDuration }),
    zod_1.z.object({ kind: common_js_1.planTransitionKind.extract(['pause']), reason: zod_1.z.string().nullable() }),
    zod_1.z.object({ kind: common_js_1.planTransitionKind.extract(['resume']) }),
]));
/* ------------------------------------------------------------------- alarms */
/**
 * Where a rule came from. `always` is a rule the cloud keeps for every device
 * (offline), `preset` one a stage applied, `device` one the firmware asked for
 * and `human` one somebody wrote.
 */
exports.alarmOrigin = (0, common_js_1.named)('AlarmOrigin', zod_1.z.enum(['preset', 'always', 'device', 'human']));
/** `routing` sends by the person's notification settings; `custom` is this rule's own target. */
exports.alarmDeliveryMode = (0, common_js_1.named)('AlarmDeliveryMode', zod_1.z.enum(['routing', 'custom']));
exports.alarmWebhook = (0, common_js_1.named)('AlarmWebhook', zod_1.z.object({
    method: common_js_1.webhookMethod,
    headers: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
    triggeredPayload: zod_1.z.string().describe('Body template sent when the rule triggers.'),
    resolvedPayload: zod_1.z.string(),
    reportErrors: zod_1.z.boolean().describe('Whether a failed call is written to the diary.'),
    tunnel: zod_1.z.boolean().describe("Call through the device's tunnel, for a target on the local network."),
}));
/**
 * The two channels a rule may address itself, out of the four a person can be
 * reached on: a rule's own delivery predates routing and was only ever a mail
 * address or a URL.
 */
exports.alarmDeliveryChannel = (0, common_js_1.named)('AlarmDeliveryChannel', common_js_1.notificationChannel.extract(['email', 'webhook']));
/**
 * One rule's own delivery, kept from the per-alarm e-mail and webhook that
 * predate routing. Like the account's own webhook channel, `target` and the
 * headers can name an internal host and carry an authorisation header, so an
 * alarm rule is answered to whoever may manage the device and to nobody else.
 */
exports.alarmDeliveryCustom = (0, common_js_1.named)('AlarmDeliveryCustom', zod_1.z.object({
    channel: exports.alarmDeliveryChannel,
    target: zod_1.z.string().describe('The address or the URL, by channel.'),
    includeDetails: zod_1.z.boolean().describe('Whether the message carries the reading and the thresholds.'),
    webhook: exports.alarmWebhook.nullable(),
}));
exports.alarmDelivery = (0, common_js_1.named)('AlarmDelivery', zod_1.z.object({ mode: exports.alarmDeliveryMode, custom: exports.alarmDeliveryCustom.nullable() }));
/**
 * A band around a reading: the rule most alarms are. `upper` and `lower` may
 * both be null, which is a rule that watches without a bound - what `offline`
 * is, where the health loop rather than a threshold decides.
 */
exports.readingWatch = (0, common_js_1.named)('ReadingWatch', zod_1.z.object({
    kind: zod_1.z.literal('reading'),
    metric: common_js_1.metric,
    upper: zod_1.z.number().nullable(),
    lower: zod_1.z.number().nullable(),
}));
/**
 * A band around an output's level. `heater` and `fan` run at a rate and `light`
 * dims, so "the heater is working harder than half the time" is a rule about a
 * number like any other. The numbers are the ones the series carries: a
 * fraction where the device reports a fraction, never a percentage of its own.
 */
exports.outputLevelWatch = (0, common_js_1.named)('OutputLevelWatch', zod_1.z.object({
    kind: zod_1.z.literal('output_level'),
    output: common_js_1.outputMetric,
    upper: zod_1.z.number().nullable(),
    lower: zod_1.z.number().nullable(),
}));
/**
 * An output running at all: the fridge that has not stopped in an hour, the CO2
 * valve that is still open. Anything above zero is the output doing something,
 * so there is no band to give - and `forSeconds` is what makes it an alarm
 * rather than a fact of every cycle.
 */
exports.outputRunningWatch = (0, common_js_1.named)('OutputRunningWatch', zod_1.z.object({ kind: zod_1.z.literal('output_running'), output: common_js_1.outputMetric }));
/**
 * What a rule watches: a reading the device measures, or an output it drives.
 *
 * One union rather than a metric enum widened to hold both, because what trips
 * each of them differs - a band is meaningless on an output that is only ever on
 * or off, and an output name is not something a reading can carry. So a rule
 * that names an output and a threshold it ignores, or a reading with no metric,
 * cannot be written down at all.
 */
exports.alarmWatch = (0, common_js_1.named)('AlarmWatch', zod_1.z.discriminatedUnion('kind', [exports.readingWatch, exports.outputLevelWatch, exports.outputRunningWatch]));
exports.alarmRuleState = (0, common_js_1.named)('AlarmRuleState', zod_1.z.object({
    triggered: zod_1.z.boolean(),
    lastTriggeredAt: (0, common_js_1.instant)().nullable(),
    lastResolvedAt: (0, common_js_1.instant)().nullable(),
    extremeValue: zod_1.z.number().nullable().describe('The worst reading of the open episode.'),
    lastSampleAt: (0, common_js_1.instant)().nullable().describe('The sample the rule was last evaluated against.'),
}));
exports.alarmRule = (0, common_js_1.named)('AlarmRule', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    deviceId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    watch: exports.alarmWatch,
    forSeconds: zod_1.z.number().int().describe('How long the watch has to be out of bounds before the rule triggers.'),
    severity: common_js_1.severity,
    origin: exports.alarmOrigin,
    presetId: (0, common_js_1.id)().nullable().describe('The preset that wrote this rule, so applying it again can update it.'),
    enabled: zod_1.z.boolean(),
    cooldownSeconds: zod_1.z.number().int().describe('Silence after a trigger, so one bad hour is not one message a minute.'),
    repeatSeconds: zod_1.z.number().int().describe('How often a rule that stays triggered says so again; 0 never repeats.'),
    delivery: exports.alarmDelivery,
    silencedUntil: (0, common_js_1.instant)().nullable(),
    state: exports.alarmRuleState,
}));
exports.alarmRulePage = (0, common_js_1.named)('AlarmRulePage', (0, common_js_1.page)(exports.alarmRule));
/**
 * `POST /devices/{id}/alarm-rules`. The device is the path. Where a rule came
 * from is the server's to say - a rule written here is `human` by definition -
 * and a silence is something done to a rule rather than part of what it says,
 * so neither is here.
 */
exports.alarmRuleCreate = (0, common_js_1.named)('AlarmRuleCreate', exports.alarmRule.pick({
    name: true,
    watch: true,
    forSeconds: true,
    severity: true,
    enabled: true,
    cooldownSeconds: true,
    repeatSeconds: true,
    delivery: true,
}));
/**
 * `PATCH /alarm-rules/{id}`: the same fields, each only if it changes. `watch`
 * is given whole or not at all - half a watch is a rule watching two things.
 */
exports.alarmRuleUpdate = (0, common_js_1.named)('AlarmRuleUpdate', exports.alarmRuleCreate.partial());
/**
 * `PUT /alarm-rules/{id}/silence`. A duration rather than the instant the rule
 * carries: the sheet offers "for an hour", and the server's clock decides when
 * that is over rather than the phone's. `DELETE` on the same path lifts the
 * silence, so there is nothing to spell for "not silenced".
 */
exports.alarmSilence = (0, common_js_1.named)('AlarmSilence', zod_1.z.object({ forSeconds: zod_1.z.number().int().positive() }));
/**
 * What the rule was called and what it watched, copied onto the episode as it
 * opens.
 *
 * A rule does not stay what it was when it raised an episode. Its band may be
 * moved while the episode is open, and a card that measured the episode's
 * reading against today's band printed crossings that never happened; it may be
 * deleted, and the episode - the account of something that really happened in
 * somebody's tent, worth reading after the rule that caught it is retired -
 * was left naming a rule nothing could resolve, so the inbox drew "alarm" and a
 * bare figure with no metric, no unit and no name. Neither can be answered by
 * looking the rule up afterwards, which is why the answer is written down here
 * at the moment the episode opens, when it is still the episode's own.
 */
exports.alertWatched = (0, common_js_1.named)('AlertWatched', zod_1.z.object({ name: zod_1.z.string(), watch: exports.alarmWatch }));
/**
 * One document from trigger to resolution, which is what the alerts inbox shows.
 * An open alert has `resolvedAt: null`.
 */
exports.alert = (0, common_js_1.named)('Alert', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    ruleId: (0, common_js_1.id)().nullable().describe('null for an alert the health loop raised without a rule.'),
    deviceId: (0, common_js_1.id)().nullable(),
    cameraId: (0, common_js_1.id)().nullable(),
    spaceId: (0, common_js_1.id)().nullable(),
    kind: common_js_1.alertKind,
    severity: common_js_1.severity,
    startedAt: (0, common_js_1.instant)(),
    resolvedAt: (0, common_js_1.instant)().nullable(),
    value: zod_1.z.number().nullable().describe('The reading that triggered it.'),
    extremeValue: zod_1.z.number().nullable().describe('The worst reading while it was open.'),
    watched: exports.alertWatched
        .nullable()
        .describe('What the rule was called and watched when this opened; null where no rule raised it, and on episodes older than the field.'),
}));
exports.alertPage = (0, common_js_1.named)('AlertPage', (0, common_js_1.page)(exports.alert));
/* --------------------------------------------------------------- live, series */
/**
 * The controller's day and night targets, read from its configuration. Influx
 * stores sensors and outputs and never setpoints, so this is the only place a
 * target comes from.
 */
exports.setpoints = (0, common_js_1.named)('Setpoints', zod_1.z.object({
    day: zod_1.z.partialRecord(common_js_1.metric, zod_1.z.number()),
    night: zod_1.z.partialRecord(common_js_1.metric, zod_1.z.number()),
    active: zod_1.z.enum(['day', 'night']).describe('Which half of the cycle the device says it is in.'),
}));
/**
 * One device's newest reading of everything it measures: one `last()` per
 * device.
 *
 * The outputs ride along with the metrics because they come out of the same
 * read. What a lamp is running at is the only word a controller gives on its
 * own light output - a brightness is never acknowledged and an override is
 * never reported back - so a screen that draws the dimmer needs it, and needs
 * it with the age and the state the server has already decided rather than as a
 * series it has to pick a window for.
 */
exports.deviceLive = (0, common_js_1.named)('DeviceLive', zod_1.z.object({
    deviceId: (0, common_js_1.id)(),
    metrics: zod_1.z.partialRecord(common_js_1.metric, common_js_1.metricValue),
    outputs: zod_1.z.partialRecord(common_js_1.outputMetric, common_js_1.metricValue).describe('The newest value of each output the device has reported driving.'),
    setpoints: exports.setpoints.nullable().describe('null for a device that holds no targets, such as a plug.'),
}));
exports.metricSeries = (0, common_js_1.named)('MetricSeries', zod_1.z.object({ metric: common_js_1.metric, points: zod_1.z.array(common_js_1.seriesPoint) }));
exports.outputSeries = (0, common_js_1.named)('OutputSeries', zod_1.z.object({ output: common_js_1.outputMetric, points: zod_1.z.array(common_js_1.seriesPoint) }));
/**
 * What `GET /devices/{id}/series` is asked for. A request, so what a caller may
 * leave out is `.optional()` here rather than `.nullable()`: with no outputs it
 * gets none, and with no step the server picks one from the range.
 */
exports.seriesQuery = (0, common_js_1.named)('SeriesQuery', zod_1.z.object({
    metrics: zod_1.z.array(common_js_1.metric),
    outputs: zod_1.z.array(common_js_1.outputMetric).optional(),
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    stepSeconds: zod_1.z.number().int().optional().describe('The window each point summarises.'),
}));
/** The range and step are answered back, because the server may have narrowed either. */
exports.deviceSeries = (0, common_js_1.named)('DeviceSeries', zod_1.z.object({
    deviceId: (0, common_js_1.id)(),
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    stepSeconds: zod_1.z.number().int(),
    metrics: zod_1.z.array(exports.metricSeries),
    outputs: zod_1.z.array(exports.outputSeries),
}));
/* -------------------------------------------------------------- fleet admin */
/**
 * How one build is doing inside its class: how many devices run it, how many are
 * partway through taking it, how many gave up, and how long the update took.
 * `firmwareId` is null on the row that stands for devices running a build this
 * server has no record of, which is what a device flashed over USB reports.
 */
exports.fleetFirmwareStats = (0, common_js_1.named)('FleetFirmwareStats', zod_1.z.object({
    firmwareId: (0, common_js_1.id)().nullable(),
    version: zod_1.z.string(),
    name: zod_1.z.string().nullable(),
    total: zod_1.z.number().int(),
    online: zod_1.z.number().int(),
    updating: zod_1.z.number().int(),
    failed: zod_1.z.number().int(),
    averageUpdateMs: zod_1.z.number().int().nullable().describe('null until an update to this build has finished.'),
    maxUpdateMs: zod_1.z.number().int().nullable(),
}));
/** One class of the fleet, with the rollout being staged across it. */
exports.fleetClass = (0, common_js_1.named)('FleetClass', zod_1.z.object({
    classId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    total: zod_1.z.number().int(),
    online: zod_1.z.number().int().describe('Heard from inside the offline window.'),
    rollout: exports.deviceClassRollout,
    firmwares: zod_1.z.array(exports.fleetFirmwareStats),
}));
/**
 * `GET /admin/fleet`. Not a page: there are as many rows as there are device
 * classes, and the screen stages and pauses a rollout on each, which it can only
 * weigh with all of them in front of it.
 */
exports.fleet = (0, common_js_1.named)('Fleet', zod_1.z.object({
    classes: zod_1.z.array(exports.fleetClass),
    unclassifiedDevices: zod_1.z.number().int().describe('Devices whose type has no class yet, so no rollout reaches them.'),
}));
exports.adminUserStats = (0, common_js_1.named)('AdminUserStats', zod_1.z.object({ total: zod_1.z.number().int(), active: zod_1.z.number().int(), admins: zod_1.z.number().int() }));
exports.adminDeviceStats = (0, common_js_1.named)('AdminDeviceStats', zod_1.z.object({
    total: zod_1.z.number().int(),
    claimed: zod_1.z.number().int(),
    online: zod_1.z.number().int(),
    updating: zod_1.z.number().int(),
}));
exports.adminCameraStats = (0, common_js_1.named)('AdminCameraStats', zod_1.z.object({
    total: zod_1.z.number().int(),
    entitled: zod_1.z.number().int().describe('Cameras whose entitlement has not run out, whatever granted it.'),
    stale: zod_1.z.number().int().describe('Cameras that have stopped delivering stills.'),
}));
/** What is being grown and written on this install, which is what its size is felt as. */
exports.adminContentStats = (0, common_js_1.named)('AdminContentStats', zod_1.z.object({
    spaces: zod_1.z.number().int(),
    grows: zod_1.z.number().int(),
    publicGrows: zod_1.z.number().int(),
    plants: zod_1.z.number().int(),
    entries: zod_1.z.number().int(),
    media: zod_1.z.number().int(),
    mediaBytes: zod_1.z.number().int().describe('What the picture bucket holds, which is nearly all of the disk.'),
}));
/** The composer's queue, which is the one piece of work on an install that can quietly stop moving. */
exports.adminRenderStats = (0, common_js_1.named)('AdminRenderStats', zod_1.z.object({
    queued: zod_1.z.number().int(),
    rendering: zod_1.z.number().int(),
    failed: zod_1.z.number().int().describe('Films the composer gave up on; each of them is a picture somebody asked for and did not get.'),
}));
/**
 * The last pass of the climate retention sweep.
 *
 * It is the only background job on an install that deletes a grower's raw
 * samples, so whether it ran, how far it got and whether it is erroring is
 * something an operator has to be able to see. The pass is kept by the running
 * server and not stored, so this is null on a server that has not yet swept
 * since it came up; a screen says that rather than inventing an hour.
 */
exports.adminRetentionRun = (0, common_js_1.named)('AdminRetentionRun', zod_1.z.object({
    ranAt: (0, common_js_1.instant)(),
    reached: zod_1.z.number().int().describe('Devices the pass looked at, which is how far round the rotation one pass gets.'),
    devices: zod_1.z.number().int().describe('Devices it summarised something of; the rest had nothing outside their window.'),
    days: zod_1.z.number().int().describe('Days of raw samples rolled into daily summaries.'),
    errors: zod_1.z.number().int().describe('Devices the pass left exactly as they were. It goes on to the next one.'),
}));
/**
 * How the alarm health loop itself is doing.
 *
 * It is the loop that raises "device offline" and "camera not delivering",
 * which are the alarms nothing else on the install can raise: every other rule
 * is answered by a reading arriving, and silence is not a reading. While it
 * cannot complete a pass there is no offline rule, no offline alert and no
 * camera-stale alert anywhere, and every alerts inbox on the install reads
 * "nothing has gone wrong" - which is indistinguishable, from every screen,
 * from a fleet where nothing is the matter. So the loop reports itself here
 * rather than only into the log, and it reports failures as well as passes:
 * `ranAt` is null on a server that has completed none, and `failures` is what
 * says whether that is because it has just started or because it has been
 * failing since it did.
 */
exports.adminAlarmWatch = (0, common_js_1.named)('AdminAlarmWatch', zod_1.z.object({
    ranAt: (0, common_js_1.instant)().nullable().describe('When the last pass that completed finished; null when none has since this server started.'),
    devices: zod_1.z.number().int().describe('Claimed devices that pass went round.'),
    unjudged: zod_1.z
        .number()
        .int()
        .describe('Devices it could not decide about, because the measurement store did not say whether they had written anything since.'),
    failures: zod_1.z.number().int().describe('Passes that have failed since the last one that completed.'),
    failedAt: (0, common_js_1.instant)().nullable().describe('When the most recent failure was, so a run that has stopped can be told from one that has not.'),
}));
/**
 * `GET /admin/stats`. Counting every collection is not free, so the answer may
 * be a cached pass and says when it was taken rather than implying "now".
 */
exports.adminStats = (0, common_js_1.named)('AdminStats', zod_1.z.object({
    collectedAt: (0, common_js_1.instant)(),
    users: exports.adminUserStats,
    devices: exports.adminDeviceStats,
    cameras: exports.adminCameraStats,
    content: exports.adminContentStats,
    renders: exports.adminRenderStats,
    retention: exports.adminRetentionRun.nullable().describe('Null when this server has not run a retention pass since it started.'),
    // Not nullable, unlike the retention pass: a loop that has never completed
    // one still has something to report, and it is the figure that matters most.
    alarmWatch: exports.adminAlarmWatch,
}));
exports.adminLogLevel = (0, common_js_1.named)('AdminLogLevel', zod_1.z.enum(['error', 'warn', 'info']));
/**
 * One line of the server's own log, which is not a diary entry: the diary is
 * what happened to a grow, this is what happened inside the process, and a
 * hosted install has no shell to read it in. `context` is the module that wrote
 * the line, and the two ids are filled where a line is about one.
 */
exports.adminLogLine = (0, common_js_1.named)('AdminLogLine', zod_1.z.object({
    id: (0, common_js_1.id)().describe("What the list is paged by; the log is the process's own and not a collection of this model."),
    loggedAt: (0, common_js_1.instant)(),
    level: exports.adminLogLevel,
    context: zod_1.z.string(),
    message: zod_1.z.string(),
    deviceId: (0, common_js_1.id)().nullable(),
    userId: (0, common_js_1.id)().nullable(),
}));
/** `GET /admin/logs`. Paged like every list, because a log has no end. */
exports.adminLogPage = (0, common_js_1.named)('AdminLogPage', (0, common_js_1.page)(exports.adminLogLine));
