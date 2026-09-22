import { z } from 'zod';
import {
  alertKind,
  anyValue,
  bytes,
  growthStage,
  id,
  instant,
  metric,
  metricValue,
  named,
  notificationChannel,
  outputMetric,
  page,
  planStatus,
  planTransitionKind,
  seriesPoint,
  severity,
  socketRole,
  subjectRef,
  webhookMethod,
} from './common.js';
import { SOCKET_ADDRESS_MAX_LEN, SOCKET_CREDENTIAL_MAX_LEN, SOCKET_HOLD_MAX_SECONDS } from './socket-report.js';

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
export const firmwareChannel = named('FirmwareChannel', z.enum(['stable', 'beta', 'alpha', 'manual']));

/**
 * The device's own configuration document, passed through untouched.
 *
 * Its schema belongs to the firmware of that device type, not to this package:
 * every type has its own keys, an older build has fewer of them, and the server
 * never interprets one. Typing it here would date the moment a firmware adds a
 * field.
 */
export const deviceConfiguration = named('DeviceConfiguration', z.record(z.string(), anyValue()));

export const deviceFirmwareTarget = named(
  'DeviceFirmwareTarget',
  z.object({
    channel: firmwareChannel,
    targetId: id().nullable().describe('The build this device should be running; null while it follows its channel.'),
  }),
);

/**
 * The two derived measures the cloud computes rather than the device: leaf
 * temperature offsets give VPD, the lux factor gives PPFD. They sit on the device
 * because they describe its sensor's placement, not what is grown under it.
 */
export const deviceSettings = named(
  'DeviceSettings',
  z.object({
    vpdLeafOffsetDay: z.number(),
    vpdLeafOffsetNight: z.number(),
    ppfdLuxFactor: z.number(),
  }),
);

export const deviceState = named(
  'DeviceState',
  z.object({
    lastSeenAt: instant().nullable().describe('Last sample or status; what `offline` is decided from.'),
    claimedAt: instant().nullable(),
    firmwareId: id().nullable().describe('What the device reports it is running, which is the build uuid.'),
    updateStartedAt: instant().nullable(),
    updateEndedAt: instant().nullable(),
    maintenanceUntil: instant().nullable().describe("The device suppresses its own alarms until then; the cloud's are silenced separately."),
    hardware: z.record(z.string(), z.string()).describe('The raw `hardware-info` report, flat as the device sends it.'),
    // Keyed by slot, because that is how a socket is addressed; the report says
    // a row changed but not when, so the ingest stamps it.
    socketStateChangedAt: z.record(z.string(), instant()),
    // An override's row carries the seconds it had left when the table was
    // sent, so the instant the table arrived is what turns them into a time of
    // day. Null for a build that reports no table.
    socketsReportedAt: instant().nullable(),
  }),
);

/**
 * A device as the API serves it. The broker credentials the device signs in with
 * have no field here: they are a secret, this contract is what crosses the wire,
 * and where they are stored is the mongoose schema's business.
 */
export const device = named(
  'Device',
  z.object({
    id: id().describe('The id the firmware was provisioned with.'),
    createdAt: instant(),
    // The firmware's own type name (`controller`, `fridge`, `plug`, ...). Not an
    // enum: the set grows with hardware, and a cloud that rejects an unknown one
    // would refuse to register a device newer than itself.
    type: z.string(),
    classId: id().nullable().describe('The update class; null until a firmware has been built for this device.'),
    serialNumber: z.number().int().nullable(),
    ownerId: id().nullable().describe('null while the device is unclaimed and claimable.'),
    spaceId: id().nullable(),
    name: z.string().nullable(),
    firmware: deviceFirmwareTarget,
    configuration: deviceConfiguration.nullable().describe('null before the device has reported one.'),
    settings: deviceSettings,
    isDemo: z.boolean(),
    state: deviceState,
  }),
);

export const devicePage = named('DevicePage', page(device));

/**
 * `PATCH /devices/{id}`: what a person decides about a device. What it is, who
 * owns it and everything under `state` are not a client's to write, and the
 * configuration document is replaced whole by its own route rather than patched
 * here, because the server does not read enough of it to merge one.
 */
export const deviceUpdate = named(
  'DeviceUpdate',
  device.pick({ name: true, spaceId: true, firmware: true, settings: true }).partial(),
);

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
export const deviceConfigurationEnvelope = named(
  'DeviceConfigurationEnvelope',
  z.object({ configuration: deviceConfiguration }),
);

/**
 * `POST /admin/devices`. A device normally creates itself by registering with
 * its own firmware; this is the row made by hand, for hardware that has not been
 * flashed yet or that has to be put back after it was removed. It is unclaimed
 * until somebody claims it, like every other device.
 */
export const adminDeviceCreate = named(
  'AdminDeviceCreate',
  device.pick({ id: true, type: true, classId: true, serialNumber: true }),
);

/** Which build each channel points at; null where a class has nothing on that channel yet. */
export const deviceClassFirmwareIds = named(
  'DeviceClassFirmwareIds',
  z.object({ stable: id().nullable(), beta: id().nullable(), alpha: id().nullable() }),
);

/** A staged rollout: `percent` of the class takes the build, and `paused` stops it where it is. */
export const deviceClassRollout = named('DeviceClassRollout', z.object({ paused: z.boolean(), percent: z.number().int().min(0).max(100) }));

export const deviceClass = named(
  'DeviceClass',
  z.object({
    id: id(),
    createdAt: instant(),
    name: z.string(),
    description: z.string().nullable(),
    concurrentUpdates: z.number().int().describe('How many devices of the class may be updating at once.'),
    maxFailures: z.number().int().describe('Failed updates after which the rollout stops by itself.'),
    firmwareIds: deviceClassFirmwareIds,
    rollout: deviceClassRollout,
  }),
);

export const deviceClassPage = named('DeviceClassPage', page(deviceClass));

/**
 * `POST /admin/device-classes`. Pausing a rollout and staging it at a percentage
 * are changes to the class, which is why `rollout` is written here and has no
 * route of its own: there is one rollout per class and it is never anything but
 * the state this object describes.
 */
export const deviceClassCreate = named(
  'DeviceClassCreate',
  deviceClass.pick({
    name: true,
    description: true,
    concurrentUpdates: true,
    maxFailures: true,
    firmwareIds: true,
    rollout: true,
  }),
);

/** `PATCH /admin/device-classes/{id}`: the same fields, each only if it changes. */
export const deviceClassUpdate = named('DeviceClassUpdate', deviceClassCreate.partial());

export const firmware = named(
  'Firmware',
  z.object({
    id: id(),
    createdAt: instant(),
    classId: id(),
    name: z.string().nullable(),
    version: z.string().describe("The build's uuid; builds are not ordered and cannot be compared."),
    wasStable: z.boolean().describe('Once true it stays true, so a build can be rolled back to knowingly.'),
  }),
);

export const firmwarePage = named('FirmwarePage', page(firmware));

/**
 * `POST /admin/firmwares`: the build itself, without its files - a build is
 * several of them and each is uploaded on its own. `wasStable` is the rollout's
 * record of where the build has been and is never set by hand.
 */
export const firmwareCreate = named('FirmwareCreate', firmware.pick({ classId: true, name: true, version: true }));

/**
 * `PATCH /admin/firmwares/{id}`. Relabelling is what this is for: a build's
 * version is the uuid its build container stamped it with, and a human name is
 * how it is told apart in a list.
 */
export const firmwareUpdate = named('FirmwareUpdate', firmwareCreate.partial());

/** One file of a build. The bytes are what OTA streams; no listing carries them. */
export const firmwareBinary = named(
  'FirmwareBinary',
  z.object({
    id: id(),
    createdAt: instant(),
    firmwareId: id(),
    name: z.string().describe('The file the device asks for by name.'),
    data: bytes(),
  }),
);

/**
 * `PUT /admin/firmwares/{id}/binaries/{name}`. The build and the file name are
 * the path, so the body is the bytes and nothing else.
 */
export const firmwareBinaryUpload = named('FirmwareBinaryUpload', firmwareBinary.pick({ data: true }));

/** What the display shows and a claim is made with. One code per device. */
export const claimCode = named('ClaimCode', z.object({ id: id(), createdAt: instant(), code: z.string(), deviceId: id() }));

/**
 * `POST /devices/claims`. The code the device shows is the whole proof and it
 * names the device, so nothing else identifies one. A device that belongs to no
 * space has no card to appear on, so a claim always ends in one: `spaceId` puts
 * it into a space that exists, and its absence makes one.
 */
export const deviceClaimCreate = named(
  'DeviceClaimCreate',
  claimCode.pick({ code: true }).extend({
    name: z.string().optional().describe('Absent names the device after its type.'),
    spaceId: id().optional(),
  }),
);

/**
 * What a claim answers. The device carries the space it now sits in, so the one
 * thing left to say is whether that space was made by this claim: a new space is
 * offered for naming, an existing one is left alone.
 */
export const deviceClaimResult = named('DeviceClaimResult', z.object({ device: device, spaceCreated: z.boolean() }));

/* ------------------------------------------------------------------ sockets */

/**
 * The state a smart socket's row reports. `unknown` is what a device that
 * reports the older three-column row gives: it names the socket but not whether
 * it is on.
 */
export const socketState = named('SocketState', z.enum(['on', 'off', 'unknown']));

/** An override forces a socket; `auto` hands it back to its role's control law. */
export const socketOverrideState = named('SocketOverrideState', z.enum(['on', 'off', 'auto']));

/**
 * An override lives in the device's RAM with an expiry and dies with a reboot,
 * which is the failsafe: nothing outside the firmware can hold a socket on.
 */
export const socketOverride = named('SocketOverride', z.object({ state: socketOverrideState, validUntil: instant() }));

/**
 * What a `pump` or a `custom_timer` socket repeats: on for so long, that often.
 * The bounds are the firmware's, which refuses a cycle that is on for at least
 * as long as its period and one longer than an override may hold.
 */
export const socketTimer = named(
  'SocketTimer',
  z
    .object({
      onSeconds: z.number().int().positive(),
      everySeconds: z.number().int().positive().max(SOCKET_HOLD_MAX_SECONDS),
    })
    .refine(timer => timer.onSeconds < timer.everySeconds, {
      message: 'A socket that is on for at least as long as its period never switches off',
      path: ['onSeconds'],
    }),
);

/**
 * One socket, as the API serves it: a typed view of `devices.state.hardware`,
 * never stored twice. The decoder's vocabulary is kept - `slot` is the position
 * in the device's table and how a command addresses it, `hardwareId` the MAC the
 * device finds the socket by, `address` its host or IP.
 */
export const socket = named(
  'Socket',
  z.object({
    slot: z.number().int().describe('-1 when the device reports no table, in which case its role addresses it.'),
    role: socketRole,
    hardwareId: z.string().describe('Empty on sockets paired before the firmware kept ids.'),
    address: z.string(),
    state: socketState,
    override: socketOverride.nullable(),
    timer: socketTimer.nullable(),
    stateChangedAt: instant().nullable().describe('When the row last changed state; null until it has been seen change.'),
  }),
);

/**
 * What the device announced it understands. The server sends a command or a role
 * only to a device that named it, because a firmware version cannot be compared
 * (it is the build's uuid) and an old build drops an unknown command silently.
 * A device that announces nothing gets nothing new and its switches are drawn
 * disabled.
 */
export const deviceCapabilities = named(
  'DeviceCapabilities',
  z.object({
    socketOverride: z.boolean(),
    socketTimer: z.boolean(),
    lightOverride: z.boolean().describe("Whether the controller's own light output takes an override."),
    roles: z.array(socketRole).describe('The roles this build knows; a role outside it is never sent.'),
    // The failsafe the device programs into each socket: how long after the
    // last command a socket switches itself off, so a controller that goes
    // quiet cannot leave a heater on. It is not a minimum on-time, and a screen
    // that reads it as one would tell a grower the opposite of what it means.
    // Keyed by role, and only the roles the device named.
    pulseSeconds: z.partialRecord(socketRole, z.number().int()),
  }),
);

/** The list carries the capabilities, because a socket row is drawn from both. */
export const socketPage = named('SocketPage', page(socket).extend({ capabilities: deviceCapabilities }));

/* ----------------------------------------------------------------- commands */

/**
 * What a client asks a device to do right now. A discriminated union rather than
 * a free action string, so the route can never publish something the firmware
 * does not know; `kind` is `snake_case` like every other enum value here.
 *
 * None of these is stored or retried: the caller is waiting for the answer.
 */

export const rebootCommand = named('RebootCommand', z.object({ kind: z.literal('reboot') }));

export const maintenanceCommand = named(
  'MaintenanceCommand',
  z.object({ kind: z.literal('maintenance'), forSeconds: z.number().int() }),
);

/**
 * Drives the controller's own outputs by hand for as long as the test runs.
 * Partial: an output left out keeps doing what it was doing. The value is the
 * output's level, which is on/off for a relay and a percentage for a fan.
 */
export const testCommand = named(
  'TestCommand',
  z.object({ kind: z.literal('test'), outputs: z.partialRecord(outputMetric, z.number()) }),
);

export const stopTestCommand = named('StopTestCommand', z.object({ kind: z.literal('stop_test') }));

/** Asks for a still now. A controller answers for the one Terp Cam it pairs, so it names no camera. */
export const captureStillCommand = named('CaptureStillCommand', z.object({ kind: z.literal('capture_still') }));

/**
 * Forces one socket, or the controller's own light output, for a while. The
 * subject is `{ type, id }` because the two are addressed differently: a socket
 * by its slot, an output by its name.
 */
export const socketOverrideCommand = named(
  'SocketOverrideCommand',
  z.object({
    kind: z.literal('socket_override'),
    subject: subjectRef(z.enum(['socket', 'output'])),
    state: socketOverrideState,
    forSeconds: z
      .number()
      .int()
      .min(0)
      .max(SOCKET_HOLD_MAX_SECONDS)
      .describe('The override expires after this; a reboot ends it too. Zero only with `auto`, which carries no duration.'),
  }),
);

/**
 * The socket's own web credentials, on their way to the device. They travel in
 * this direction only: a command carries them, and `Socket` answers none back.
 * Left out, the device keeps the pair it has.
 */
export const socketCredentials = named(
  'SocketCredentials',
  z.object({
    username: z.string().max(SOCKET_CREDENTIAL_MAX_LEN),
    password: z.string().max(SOCKET_CREDENTIAL_MAX_LEN),
  }),
);

/** Pairs a socket, re-addresses one, or gives it a role and a timer. */
export const socketSetCommand = named(
  'SocketSetCommand',
  z.object({
    kind: z.literal('socket_set'),
    slot: z.number().int().nullable().describe('null adds a socket to the role instead of configuring one it already has.'),
    role: socketRole,
    // Bounded as the firmware bounds it: a row reports its address, and one the
    // row cannot carry would be stored and then left out of the table.
    address: z
      .string()
      .min(1)
      .max(SOCKET_ADDRESS_MAX_LEN)
      .regex(/^\S+$/, 'An address the device can reach carries no spaces')
      .describe('Host or IP the device reaches the socket at, over plain HTTP on the local network.'),
    credentials: socketCredentials.nullable(),
    timer: socketTimer.nullable().describe('Only `pump` and `custom_timer` run on one.'),
  }),
);

export const deviceCommand = named(
  'DeviceCommand',
  z.discriminatedUnion('kind', [
    rebootCommand,
    maintenanceCommand,
    testCommand,
    stopTestCommand,
    captureStillCommand,
    socketOverrideCommand,
    socketSetCommand,
  ]),
);

/**
 * What `POST /devices/{id}/commands` answers. MQTT hands back no receipt and a
 * device that is offline is simply not there to hear the command, so the answer
 * says when it went out and whether anyone was listening, and never claims the
 * device did what it was told.
 */
export const deviceCommandResult = named(
  'DeviceCommandResult',
  z.object({
    publishedAt: instant(),
    deviceOnline: z.boolean().describe('Whether the device had been heard from inside the offline window when the command went out.'),
  }),
);

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
export const socketUpdate = named('SocketUpdate', socketSetCommand.omit({ kind: true, slot: true }));

/** `PUT /devices/{id}/sockets/{slot}/override`. `DELETE` on the same path hands the socket back to its role. */
export const socketOverrideUpdate = named(
  'SocketOverrideUpdate',
  socketOverrideCommand.pick({ state: true, forSeconds: true }),
);

/**
 * `POST /devices/{id}/sockets/{slot}/tests`. Switching a socket on for a moment
 * is how a person finds out which plug in the tent it is. The firmware puts it
 * back when the time is up, so a test that is never answered still ends.
 */
export const socketTestCreate = named(
  'SocketTestCreate',
  z.object({ forSeconds: z.number().int().positive() }),
);

/* --------------------------------------------------------------------- plan */

/** The user's own unit is the fact here, so a step's duration keeps it rather than being seconds. */
export const durationUnit = named('DurationUnit', z.enum(['minutes', 'hours', 'days', 'weeks']));

/**
 * `value` is not required to be whole. The old recipe screen took whatever
 * somebody typed, and a plan in the field holds a step of half a day - a tent is
 * running on it right now. The engine multiplies the value by its unit and never
 * cared, so the only thing a whole number would buy is that such a plan could be
 * read and not written back, and the step's length would have to be rounded
 * under a running tent to save the recipe it belongs to. Zero is the step with no
 * length, which runs until somebody moves it on.
 */
export const stepDuration = named('StepDuration', z.object({ value: z.number(), unit: durationUnit }));

export const planStep = named(
  'PlanStep',
  z.object({
    id: id().describe('Stable across edits, so `state.activeStepIndex` survives a step being inserted above it.'),
    name: z.string(),
    stage: growthStage.nullable().describe('The stage this step puts the grow in; null leaves the phase alone.'),
    preset: z.string().nullable().describe('The climate preset applied on top of the stage, such as `late_flowering`.'),
    duration: stepDuration,
    // A fragment of the device's own configuration document, so it is as untyped
    // as that document is.
    settings: deviceConfiguration,
    waitForConfirmation: z.boolean(),
    confirmationMessage: z.string().nullable(),
  }),
);

/** `on_step` mails at every step change, `on_confirmation` only when the plan waits for a person. */
export const planNotifyMode = named('PlanNotifyMode', z.enum(['off', 'on_step', 'on_confirmation']));

export const planNotify = named(
  'PlanNotify',
  z.object({
    mode: planNotifyMode,
    email: z.string().nullable().describe("Where the plan writes; null uses the owner's address."),
    writeEntries: z.boolean().describe('Whether a step change also lands in the diary.'),
  }),
);

export const planState = named(
  'PlanState',
  z.object({
    status: planStatus,
    activeStepIndex: z.number().int(),
    stepStartedAt: instant().nullable(),
    // A pause keeps what the step had already served, because the step resumes
    // where it stopped rather than starting over.
    pausedElapsedMs: z.number().int(),
    pauseReason: z.string().nullable(),
    lastAppliedAt: instant().nullable().describe('The engine re-applies the running step hourly.'),
    confirmationNotifiedAt: instant().nullable().describe("When the plan's own mail about the waiting step went out, which it does once."),
    // The ask that goes to the people who keep the tent is a fact of the waiting
    // step rather than of the pass that first noticed it: somebody whose night
    // the ask fell into is told once their night is over, so the two instants
    // below are kept apart from the mail above and from each other.
    confirmationAskedAt: instant()
      .nullable()
      .describe('When everybody who keeps the tent had been told the step is waiting; null while the ask is still outstanding.'),
    confirmationAskTriedAt: instant().nullable().describe('When that ask was last attempted; an outstanding ask is attempted again.'),
  }),
);

/** One plan per device: it is what the device is currently being run by. */
export const plan = named(
  'Plan',
  z.object({
    id: id(),
    createdAt: instant(),
    deviceId: id(),
    templateId: id().nullable().describe('What it was started from; null once it no longer matters.'),
    name: z.string(),
    steps: z.array(planStep),
    loop: z.boolean().describe('Start again at the first step instead of completing.'),
    notify: planNotify,
    state: planState,
  }),
);

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
export const planStepInput = named('PlanStepInput', planStep.partial({ id: true, stage: true, preset: true }));

/**
 * `PUT /devices/{id}/plan`. A device runs one plan, so the route both writes the
 * first one and replaces the one that is there; where the plan stands is `state`
 * and moves only through a transition.
 */
export const planReplace = named(
  'PlanReplace',
  plan.pick({ templateId: true, name: true, loop: true, notify: true }).extend({ steps: z.array(planStepInput) }),
);

/** A plan kept to start others from. It runs nothing, so it has no state. */
export const planTemplate = named(
  'PlanTemplate',
  z.object({
    id: id(),
    createdAt: instant(),
    ownerId: id(),
    name: z.string(),
    isPublic: z.boolean(),
    steps: z.array(planStep),
  }),
);

export const planTemplatePage = named('PlanTemplatePage', page(planTemplate));

/** `POST /plan-templates`. The owner is whoever is asking, so a template names no one. */
export const planTemplateCreate = named(
  'PlanTemplateCreate',
  planTemplate.pick({ name: true, isPublic: true }).extend({ steps: z.array(planStepInput) }),
);

/** `PATCH /plan-templates/{id}`: the same fields, each only if it changes. */
export const planTemplateUpdate = named('PlanTemplateUpdate', planTemplateCreate.partial());

/** What `POST /devices/{id}/plan/transitions` asks of a running plan. */
export const planTransition = named(
  'PlanTransition',
  z.discriminatedUnion('kind', [
    z.object({ kind: planTransitionKind.extract(['confirm']) }),
    z.object({ kind: planTransitionKind.extract(['skip']) }),
    z.object({ kind: planTransitionKind.extract(['extend']), by: stepDuration }),
    z.object({ kind: planTransitionKind.extract(['pause']), reason: z.string().nullable() }),
    z.object({ kind: planTransitionKind.extract(['resume']) }),
  ]),
);

/* ------------------------------------------------------------------- alarms */

/**
 * Where a rule came from. `always` is a rule the cloud keeps for every device
 * (offline), `preset` one a stage applied, `device` one the firmware asked for
 * and `human` one somebody wrote.
 */
export const alarmOrigin = named('AlarmOrigin', z.enum(['preset', 'always', 'device', 'human']));

/** `routing` sends by the person's notification settings; `custom` is this rule's own target. */
export const alarmDeliveryMode = named('AlarmDeliveryMode', z.enum(['routing', 'custom']));

export const alarmWebhook = named(
  'AlarmWebhook',
  z.object({
    method: webhookMethod,
    headers: z.record(z.string(), z.string()),
    triggeredPayload: z.string().describe('Body template sent when the rule triggers.'),
    resolvedPayload: z.string(),
    reportErrors: z.boolean().describe('Whether a failed call is written to the diary.'),
    tunnel: z.boolean().describe("Call through the device's tunnel, for a target on the local network."),
  }),
);

/**
 * The two channels a rule may address itself, out of the four a person can be
 * reached on: a rule's own delivery predates routing and was only ever a mail
 * address or a URL.
 */
export const alarmDeliveryChannel = named('AlarmDeliveryChannel', notificationChannel.extract(['email', 'webhook']));

/**
 * One rule's own delivery, kept from the per-alarm e-mail and webhook that
 * predate routing. Like the account's own webhook channel, `target` and the
 * headers can name an internal host and carry an authorisation header, so an
 * alarm rule is answered to whoever may manage the device and to nobody else.
 */
export const alarmDeliveryCustom = named(
  'AlarmDeliveryCustom',
  z.object({
    channel: alarmDeliveryChannel,
    target: z.string().describe('The address or the URL, by channel.'),
    includeDetails: z.boolean().describe('Whether the message carries the reading and the thresholds.'),
    webhook: alarmWebhook.nullable(),
  }),
);

export const alarmDelivery = named(
  'AlarmDelivery',
  z.object({ mode: alarmDeliveryMode, custom: alarmDeliveryCustom.nullable() }),
);

/**
 * A band around a reading: the rule most alarms are. `upper` and `lower` may
 * both be null, which is a rule that watches without a bound - what `offline`
 * is, where the health loop rather than a threshold decides.
 */
export const readingWatch = named(
  'ReadingWatch',
  z.object({
    kind: z.literal('reading'),
    metric: metric,
    upper: z.number().nullable(),
    lower: z.number().nullable(),
  }),
);

/**
 * A band around an output's level. `heater` and `fan` run at a rate and `light`
 * dims, so "the heater is working harder than half the time" is a rule about a
 * number like any other. The numbers are the ones the series carries: a
 * fraction where the device reports a fraction, never a percentage of its own.
 */
export const outputLevelWatch = named(
  'OutputLevelWatch',
  z.object({
    kind: z.literal('output_level'),
    output: outputMetric,
    upper: z.number().nullable(),
    lower: z.number().nullable(),
  }),
);

/**
 * An output running at all: the fridge that has not stopped in an hour, the CO2
 * valve that is still open. Anything above zero is the output doing something,
 * so there is no band to give - and `forSeconds` is what makes it an alarm
 * rather than a fact of every cycle.
 */
export const outputRunningWatch = named(
  'OutputRunningWatch',
  z.object({ kind: z.literal('output_running'), output: outputMetric }),
);

/**
 * What a rule watches: a reading the device measures, or an output it drives.
 *
 * One union rather than a metric enum widened to hold both, because what trips
 * each of them differs - a band is meaningless on an output that is only ever on
 * or off, and an output name is not something a reading can carry. So a rule
 * that names an output and a threshold it ignores, or a reading with no metric,
 * cannot be written down at all.
 */
export const alarmWatch = named('AlarmWatch', z.discriminatedUnion('kind', [readingWatch, outputLevelWatch, outputRunningWatch]));

export const alarmRuleState = named(
  'AlarmRuleState',
  z.object({
    triggered: z.boolean(),
    lastTriggeredAt: instant().nullable(),
    lastResolvedAt: instant().nullable(),
    extremeValue: z.number().nullable().describe('The worst reading of the open episode.'),
    lastSampleAt: instant().nullable().describe('The sample the rule was last evaluated against.'),
  }),
);

export const alarmRule = named(
  'AlarmRule',
  z.object({
    id: id(),
    createdAt: instant(),
    deviceId: id(),
    name: z.string(),
    watch: alarmWatch,
    forSeconds: z.number().int().describe('How long the watch has to be out of bounds before the rule triggers.'),
    severity: severity,
    origin: alarmOrigin,
    presetId: id().nullable().describe('The preset that wrote this rule, so applying it again can update it.'),
    enabled: z.boolean(),
    cooldownSeconds: z.number().int().describe('Silence after a trigger, so one bad hour is not one message a minute.'),
    repeatSeconds: z.number().int().describe('How often a rule that stays triggered says so again; 0 never repeats.'),
    delivery: alarmDelivery,
    silencedUntil: instant().nullable(),
    state: alarmRuleState,
  }),
);

export const alarmRulePage = named('AlarmRulePage', page(alarmRule));

/**
 * `POST /devices/{id}/alarm-rules`. The device is the path. Where a rule came
 * from is the server's to say - a rule written here is `human` by definition -
 * and a silence is something done to a rule rather than part of what it says,
 * so neither is here.
 */
export const alarmRuleCreate = named(
  'AlarmRuleCreate',
  alarmRule.pick({
    name: true,
    watch: true,
    forSeconds: true,
    severity: true,
    enabled: true,
    cooldownSeconds: true,
    repeatSeconds: true,
    delivery: true,
  }),
);

/**
 * `PATCH /alarm-rules/{id}`: the same fields, each only if it changes. `watch`
 * is given whole or not at all - half a watch is a rule watching two things.
 */
export const alarmRuleUpdate = named('AlarmRuleUpdate', alarmRuleCreate.partial());

/**
 * `PUT /alarm-rules/{id}/silence`. A duration rather than the instant the rule
 * carries: the sheet offers "for an hour", and the server's clock decides when
 * that is over rather than the phone's. `DELETE` on the same path lifts the
 * silence, so there is nothing to spell for "not silenced".
 */
export const alarmSilence = named('AlarmSilence', z.object({ forSeconds: z.number().int().positive() }));

/**
 * One document from trigger to resolution, which is what the alerts inbox shows.
 * An open alert has `resolvedAt: null`.
 */
export const alert = named(
  'Alert',
  z.object({
    id: id(),
    createdAt: instant(),
    ruleId: id().nullable().describe('null for an alert the health loop raised without a rule.'),
    deviceId: id().nullable(),
    cameraId: id().nullable(),
    spaceId: id().nullable(),
    kind: alertKind,
    severity: severity,
    startedAt: instant(),
    resolvedAt: instant().nullable(),
    value: z.number().nullable().describe('The reading that triggered it.'),
    extremeValue: z.number().nullable().describe('The worst reading while it was open.'),
  }),
);

export const alertPage = named('AlertPage', page(alert));

/* --------------------------------------------------------------- live, series */

/**
 * The controller's day and night targets, read from its configuration. Influx
 * stores sensors and outputs and never setpoints, so this is the only place a
 * target comes from.
 */
export const setpoints = named(
  'Setpoints',
  z.object({
    day: z.partialRecord(metric, z.number()),
    night: z.partialRecord(metric, z.number()),
    active: z.enum(['day', 'night']).describe('Which half of the cycle the device says it is in.'),
  }),
);

/** One device's newest reading of everything it measures: one `last()` per device. */
export const deviceLive = named(
  'DeviceLive',
  z.object({
    deviceId: id(),
    metrics: z.partialRecord(metric, metricValue),
    setpoints: setpoints.nullable().describe('null for a device that holds no targets, such as a plug.'),
  }),
);

export const metricSeries = named('MetricSeries', z.object({ metric: metric, points: z.array(seriesPoint) }));

export const outputSeries = named('OutputSeries', z.object({ output: outputMetric, points: z.array(seriesPoint) }));

/**
 * What `GET /devices/{id}/series` is asked for. A request, so what a caller may
 * leave out is `.optional()` here rather than `.nullable()`: with no outputs it
 * gets none, and with no step the server picks one from the range.
 */
export const seriesQuery = named(
  'SeriesQuery',
  z.object({
    metrics: z.array(metric),
    outputs: z.array(outputMetric).optional(),
    startsAt: instant(),
    endsAt: instant(),
    stepSeconds: z.number().int().optional().describe('The window each point summarises.'),
  }),
);

/** The range and step are answered back, because the server may have narrowed either. */
export const deviceSeries = named(
  'DeviceSeries',
  z.object({
    deviceId: id(),
    startsAt: instant(),
    endsAt: instant(),
    stepSeconds: z.number().int(),
    metrics: z.array(metricSeries),
    outputs: z.array(outputSeries),
  }),
);

/* -------------------------------------------------------------- fleet admin */

/**
 * How one build is doing inside its class: how many devices run it, how many are
 * partway through taking it, how many gave up, and how long the update took.
 * `firmwareId` is null on the row that stands for devices running a build this
 * server has no record of, which is what a device flashed over USB reports.
 */
export const fleetFirmwareStats = named(
  'FleetFirmwareStats',
  z.object({
    firmwareId: id().nullable(),
    version: z.string(),
    name: z.string().nullable(),
    total: z.number().int(),
    online: z.number().int(),
    updating: z.number().int(),
    failed: z.number().int(),
    averageUpdateMs: z.number().int().nullable().describe('null until an update to this build has finished.'),
    maxUpdateMs: z.number().int().nullable(),
  }),
);

/** One class of the fleet, with the rollout being staged across it. */
export const fleetClass = named(
  'FleetClass',
  z.object({
    classId: id(),
    name: z.string(),
    total: z.number().int(),
    online: z.number().int().describe('Heard from inside the offline window.'),
    rollout: deviceClassRollout,
    firmwares: z.array(fleetFirmwareStats),
  }),
);

/**
 * `GET /admin/fleet`. Not a page: there are as many rows as there are device
 * classes, and the screen stages and pauses a rollout on each, which it can only
 * weigh with all of them in front of it.
 */
export const fleet = named(
  'Fleet',
  z.object({
    classes: z.array(fleetClass),
    unclassifiedDevices: z.number().int().describe('Devices whose type has no class yet, so no rollout reaches them.'),
  }),
);

export const adminUserStats = named(
  'AdminUserStats',
  z.object({ total: z.number().int(), active: z.number().int(), admins: z.number().int() }),
);

export const adminDeviceStats = named(
  'AdminDeviceStats',
  z.object({
    total: z.number().int(),
    claimed: z.number().int(),
    online: z.number().int(),
    updating: z.number().int(),
  }),
);

export const adminCameraStats = named(
  'AdminCameraStats',
  z.object({
    total: z.number().int(),
    entitled: z.number().int().describe('Cameras whose entitlement has not run out, whatever granted it.'),
    stale: z.number().int().describe('Cameras that have stopped delivering stills.'),
  }),
);

/** What is being grown and written on this install, which is what its size is felt as. */
export const adminContentStats = named(
  'AdminContentStats',
  z.object({
    spaces: z.number().int(),
    grows: z.number().int(),
    publicGrows: z.number().int(),
    plants: z.number().int(),
    entries: z.number().int(),
    media: z.number().int(),
    mediaBytes: z.number().int().describe('What the picture bucket holds, which is nearly all of the disk.'),
  }),
);

/**
 * `GET /admin/stats`. Counting every collection is not free, so the answer may
 * be a cached pass and says when it was taken rather than implying "now".
 */
export const adminStats = named(
  'AdminStats',
  z.object({
    collectedAt: instant(),
    users: adminUserStats,
    devices: adminDeviceStats,
    cameras: adminCameraStats,
    content: adminContentStats,
  }),
);

export const adminLogLevel = named('AdminLogLevel', z.enum(['error', 'warn', 'info']));

/**
 * One line of the server's own log, which is not a diary entry: the diary is
 * what happened to a grow, this is what happened inside the process, and a
 * hosted install has no shell to read it in. `context` is the module that wrote
 * the line, and the two ids are filled where a line is about one.
 */
export const adminLogLine = named(
  'AdminLogLine',
  z.object({
    id: id().describe("What the list is paged by; the log is the process's own and not a collection of this model."),
    loggedAt: instant(),
    level: adminLogLevel,
    context: z.string(),
    message: z.string(),
    deviceId: id().nullable(),
    userId: id().nullable(),
  }),
);

/** `GET /admin/logs`. Paged like every list, because a log has no end. */
export const adminLogPage = named('AdminLogPage', page(adminLogLine));
