"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cameraCreate = exports.rtspCameraCreate = exports.standaloneCameraCreate = exports.controllerCameraCreate = exports.cameraPage = exports.camera = exports.cameraState = exports.cameraEntitlementUpdate = exports.cameraEntitlement = exports.entitlementTier = exports.cameraModel = exports.cameraTransport = exports.mediaUpload = exports.uploadMediaKind = exports.mediaPage = exports.exportAccepted = exports.media = exports.mediaExportJob = exports.exportScope = exports.mediaRender = exports.mediaRenderStatus = exports.mediaOverlays = exports.mediaAspect = exports.mediaQuality = exports.mediaWindow = exports.entryUpdate = exports.entryCreate = exports.entryValuesDraft = exports.humanEntryKind = exports.entryPage = exports.entry = exports.entryMessage = exports.entryValues = exports.planEntryValues = exports.harvestEntryValues = exports.moveEntryValues = exports.phaseEntryValues = exports.alarmEntryValues = exports.systemEntryValues = exports.visitEntryValues = exports.trainingEntryValues = exports.noteEntryValues = exports.photoEntryValues = exports.feedEntryValues = exports.waterEntryValues = exports.measurementEntryValues = exports.entryDose = exports.growReadingNames = exports.readingName = exports.entryReading = void 0;
exports.spaceLive = exports.spaceLiveCamera = exports.spaceLiveDevice = exports.spaceOverview = exports.overviewTargets = exports.overviewTask = exports.overviewGrow = exports.overviewCamera = exports.cameraStill = exports.climateVerdict = exports.actuatorRuns = exports.climateVerdictMetric = exports.climateExcursion = exports.targetBand = exports.verdictRating = exports.homeAnswer = exports.followedGrowCard = exports.homeSpaceCard = exports.growCard = exports.growCardStageGroup = exports.openAlert = exports.dueTask = exports.cardTrend = exports.latestStill = exports.cardSetpoint = exports.cardValue = exports.migrationPage = exports.migration = exports.shareLinkUpdate = exports.shareLinkCreate = exports.shareLinkPage = exports.shareLink = exports.shareLinkState = exports.chartViewUpdate = exports.chartViewCreate = exports.chartViewPage = exports.chartView = exports.chartViewDefinition = exports.chartViewLayout = exports.chartViewSpan = exports.timeRange = exports.schemeUpdate = exports.schemeCreate = exports.schemePage = exports.scheme = exports.schemeOrigin = exports.timelapseAccepted = exports.timelapseCreate = exports.testCaptureAnswer = exports.cameraUpdate = void 0;
exports.linkCard = exports.sharedResolution = exports.sharedSubject = exports.sharedSpace = exports.sharedGrow = exports.publicUserPage = exports.publicWeekPage = exports.publicGrowPage = exports.publicAuthor = exports.growSeries = exports.growSeriesRange = exports.growMeasurementSeries = exports.growSeriesPoint = exports.growReport = exports.growTotals = exports.growHarvest = exports.growReportPhase = exports.growWeekCardPage = exports.growWeekCard = exports.growWeekReading = exports.growWeekFeeding = exports.growWeekDay = exports.weekClimate = exports.spaceTimeline = exports.timelineCamera = exports.timelineGrow = exports.timelineMachineEvents = exports.timelineAlarm = exports.timelineOutputLane = exports.timelinePanel = exports.timelineTargets = exports.timelineTarget = exports.timelineSpan = exports.timelineRange = void 0;
const zod_1 = require("zod");
const common_js_1 = require("./common.js");
/**
 * The timeline and everything that is looked at: entries, pictures, cameras,
 * feeding schemes, chart views, share links - and the read models the screens
 * open on.
 *
 * Shapes that belong to another domain (a grow, a space, a device, a plant) are
 * referred to by `<resource>Id` only, so this file and its siblings can be read
 * and generated independently.
 */
// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------
/**
 * One reading of one measurement. `key` names a definition in the grow's
 * `measurements[]`, which is what gives it its name, its unit and its target;
 * nothing about the measurement is copied onto the reading.
 *
 * `plantId` is null when the reading is about whatever the entry is about - the
 * whole grow, or the plants the entry names - rather than one plant, which is
 * what a per-plant measurement records.
 */
exports.entryReading = (0, common_js_1.named)('EntryReading', zod_1.z.object({
    key: zod_1.z.string(),
    value: zod_1.z.number(),
    plantId: (0, common_js_1.id)().nullable(),
}));
/**
 * What a grow calls one of its measurements, as far as saying a reading out
 * loud needs: its key, the name it goes by and the unit it is in.
 *
 * Deliberately not the whole definition. The band a measurement is aimed at is
 * the grower's own business, and both answers that carry these are read through
 * share links and public pages as well, so what rides along is the wording and
 * nothing that was not already on the screen.
 */
exports.readingName = (0, common_js_1.named)('ReadingName', zod_1.z.object({
    key: zod_1.z.string(),
    name: zod_1.z.string(),
    unit: zod_1.z.string(),
}));
/**
 * The names one grow's readings go by, on an answer whose lines may belong to
 * several grows.
 *
 * A reading names its measurement by key alone, and the definition lives on the
 * grow - so a tent's latest lines and a tent's rail, which both carry the diary
 * of every grow that has stood there, would need a read per grow to put a name
 * and a unit on a figure. They ride on the same answer instead, keyed by the
 * grow each line belongs to, so one reading reads the same on the week card it
 * was written on and on the rail it shows up on.
 */
exports.growReadingNames = (0, common_js_1.named)('GrowReadingNames', zod_1.z.object({
    growId: (0, common_js_1.id)(),
    readings: zod_1.z.array(exports.readingName),
}));
/**
 * `values` is typed per kind and carries the entry's own `kind` again as its
 * discriminator, so that the object narrows on its own - a client that holds a
 * `values` narrows it without reaching back to the entry, and the server
 * validates the pair against each other.
 */
const plainValues = (kind) => zod_1.z.object({ kind: zod_1.z.literal(kind) });
const withReadings = (kind) => zod_1.z.object({ kind: zod_1.z.literal(kind), readings: zod_1.z.array(exports.entryReading) });
/**
 * One dose of one product, as it was actually given.
 *
 * Absolute, not per litre: the grid says `2 ml/l` and this says the 8 ml that
 * went into the can. The scheme a grow carries can be edited afterwards and a
 * grow can be fed without a scheme at all, so a line that had to be read back
 * through a grid would change meaning or lose it entirely.
 */
exports.entryDose = (0, common_js_1.named)('EntryDose', zod_1.z.object({
    productKey: zod_1.z.string(),
    name: zod_1.z.string(),
    amount: zod_1.z.number(),
    unit: zod_1.z.string().describe("The unit of `amount`, such as `ml`: the scheme's own `ml/l` with the per-litre taken off."),
}));
/** Measurements of the grow's own definitions, whatever the entry is otherwise about. */
exports.measurementEntryValues = (0, common_js_1.named)('MeasurementEntryValues', withReadings('measurement'));
/** Watering: how much water, and whatever was measured while pouring it. */
exports.waterEntryValues = (0, common_js_1.named)('WaterEntryValues', zod_1.z.object({
    kind: zod_1.z.literal('water'),
    litres: zod_1.z.number().nullable(),
    readings: zod_1.z.array(exports.entryReading),
}));
/**
 * Feeding: the water, the doses that went into it, and the readings taken with
 * it. `schemeWeek` records which row of the grid the doses came from, so the
 * line can say "week 5 of the scheme" without reading the grid again.
 */
exports.feedEntryValues = (0, common_js_1.named)('FeedEntryValues', zod_1.z.object({
    kind: zod_1.z.literal('feed'),
    litres: zod_1.z.number().nullable(),
    schemeWeek: zod_1.z.number().int().nullable().describe('The row of the grid the doses were read from; null when the grow feeds without a scheme.'),
    doses: zod_1.z.array(exports.entryDose),
    readings: zod_1.z.array(exports.entryReading),
}));
/** The picture is in `mediaIds`, the words in `text`: neither needs a value of its own. */
exports.photoEntryValues = (0, common_js_1.named)('PhotoEntryValues', plainValues('photo'));
exports.noteEntryValues = (0, common_js_1.named)('NoteEntryValues', plainValues('note'));
exports.trainingEntryValues = (0, common_js_1.named)('TrainingEntryValues', plainValues('training'));
exports.visitEntryValues = (0, common_js_1.named)('VisitEntryValues', plainValues('visit'));
/** The device's `message-key:param` line is already parsed into `message`. */
exports.systemEntryValues = (0, common_js_1.named)('SystemEntryValues', plainValues('system'));
/** The alert document holds the numbers and the life of the alarm; the entry points at it by `alertId`. */
exports.alarmEntryValues = (0, common_js_1.named)('AlarmEntryValues', plainValues('alarm'));
/** Written by the one phase writer, so it repeats what the phase it appended says. */
exports.phaseEntryValues = (0, common_js_1.named)('PhaseEntryValues', zod_1.z.object({
    kind: zod_1.z.literal('phase'),
    phaseId: (0, common_js_1.id)(),
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable().describe('The climate preset applied with the stage, such as `late_flowering`.'),
}));
exports.moveEntryValues = (0, common_js_1.named)('MoveEntryValues', zod_1.z.object({
    kind: zod_1.z.literal('move'),
    placementId: (0, common_js_1.id)(),
    spaceId: (0, common_js_1.id)().nullable().describe('Where the plants moved to; null is "no fixed place".'),
}));
/** Weights are the plant's; they are repeated here for the timeline and stripped from shared views with it. */
exports.harvestEntryValues = (0, common_js_1.named)('HarvestEntryValues', zod_1.z.object({
    kind: zod_1.z.literal('harvest'),
    wetWeightG: zod_1.z.number().nullable(),
    dryWeightG: zod_1.z.number().nullable(),
}));
exports.planEntryValues = (0, common_js_1.named)('PlanEntryValues', zod_1.z.object({
    kind: zod_1.z.literal('plan'),
    planId: (0, common_js_1.id)(),
    stepIndex: zod_1.z.number().int(),
    transition: common_js_1.planTransitionKind.nullable().describe('The transition that caused the entry; null when the engine simply moved on to the next step.'),
}));
exports.entryValues = (0, common_js_1.named)('EntryValues', zod_1.z.discriminatedUnion('kind', [
    exports.waterEntryValues,
    exports.feedEntryValues,
    exports.measurementEntryValues,
    exports.photoEntryValues,
    exports.noteEntryValues,
    exports.trainingEntryValues,
    exports.visitEntryValues,
    exports.systemEntryValues,
    exports.alarmEntryValues,
    exports.phaseEntryValues,
    exports.moveEntryValues,
    exports.harvestEntryValues,
    exports.planEntryValues,
]));
/** A device's log line, parsed once on the way in. The keys are the webapp's `message-*` catalogue. */
exports.entryMessage = (0, common_js_1.named)('EntryMessage', zod_1.z.object({
    key: zod_1.z.string(),
    params: zod_1.z.array(zod_1.z.string()),
}));
/**
 * One timeline. A human's watering, a device's log line and an alarm are all
 * entries, told apart by `kind` and `source`.
 *
 * Every reference is null when the entry is not about one: an entry exists
 * without a grow, without a space and without a device. `plantIds` empty means
 * the entry is about whatever it is attached to rather than about single plants.
 */
exports.entry = (0, common_js_1.named)('Entry', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    kind: common_js_1.entryKind,
    occurredAt: (0, common_js_1.instant)().describe('When the thing happened, which is not when it was written down.'),
    source: common_js_1.entrySource,
    authorId: (0, common_js_1.id)()
        .nullable()
        .describe('Who made this happen, whatever wrote it down. Null for what a device, an alarm or the plan engine\'s own clock did, and set for a plan line somebody drove: a transition carries the person who asked for it.'),
    growId: (0, common_js_1.id)().nullable(),
    spaceId: (0, common_js_1.id)().nullable(),
    deviceId: (0, common_js_1.id)().nullable(),
    plantIds: zod_1.z.array((0, common_js_1.id)()),
    cameraId: (0, common_js_1.id)().nullable(),
    taskId: (0, common_js_1.id)().nullable().describe('The derived task this entry completes; task ids are deterministic, not stored.'),
    alertId: (0, common_js_1.id)().nullable(),
    severity: common_js_1.severity.nullable(),
    text: zod_1.z.string().nullable().describe('What a human wrote.'),
    message: exports.entryMessage.nullable(),
    values: exports.entryValues,
    mediaIds: zod_1.z.array((0, common_js_1.id)()),
    undoUntil: (0, common_js_1.instant)().nullable().describe('Until when the author may still take the entry back.'),
}));
exports.entryPage = (0, common_js_1.named)('EntryPage', (0, common_js_1.page)(exports.entry));
/**
 * The kinds a person writes. Every other kind on the timeline belongs to the
 * route or the engine it is about - a phase to `POST /grows/{id}/phases`, a move
 * to a placement, a harvest to a harvest, an alarm to the alarm engine - so
 * writing one through the diary would be a second way to state the same fact.
 */
exports.humanEntryKind = (0, common_js_1.named)('HumanEntryKind', common_js_1.entryKind.extract(['water', 'feed', 'photo', 'note', 'measurement', 'training', 'visit']));
/**
 * What `POST /entries` takes for `values`: the same shapes with the parts the
 * server can work out left optional.
 *
 * "Log as planned" is a feed that names its water and nothing else - the doses
 * and the week they came from are resolved from the grow's grid at the moment
 * the feed happened, and stored resolved. A feed that names its own doses is
 * stored as given, because what went into the can is the fact.
 */
exports.entryValuesDraft = (0, common_js_1.named)('EntryValuesDraft', zod_1.z.discriminatedUnion('kind', [
    exports.waterEntryValues.partial({ litres: true, readings: true }),
    exports.feedEntryValues.partial({ litres: true, schemeWeek: true, doses: true, readings: true }),
    exports.measurementEntryValues.partial({ readings: true }),
    exports.photoEntryValues,
    exports.noteEntryValues,
    exports.trainingEntryValues,
    exports.visitEntryValues,
]));
/**
 * `POST /entries`. What the entry is about is the client's; who wrote it, when
 * it was written down, what raised it and how long it may still be taken back
 * are the server's, so none of those is asked for.
 *
 * Both `kind` and `values.kind` are given and have to agree. `values` narrows on
 * its own wherever it travels, and the server checks the pair against each other
 * rather than believing one of them.
 */
exports.entryCreate = (0, common_js_1.named)('EntryCreate', exports.entry
    .pick({
    occurredAt: true,
    growId: true,
    spaceId: true,
    deviceId: true,
    plantIds: true,
    cameraId: true,
    taskId: true,
    text: true,
    mediaIds: true,
})
    .partial()
    .extend({ kind: exports.humanEntryKind, values: exports.entryValuesDraft }));
/**
 * `PATCH /entries/{id}`: the same fields, each only if it changes. An entry's
 * `kind` is what the entry is and is not patched - correcting a reading is
 * `values`, whose own `kind` still has to be the entry's.
 */
exports.entryUpdate = (0, common_js_1.named)('EntryUpdate', exports.entryCreate.omit({ kind: true }).partial());
// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
/**
 * What a timelapse covers. `day`, `week` and `month` are the rolling films the
 * builder keeps by itself; `phase`, `grow` and `custom` are the composer's
 * ranges, and each of them names both of its ends, because only the client
 * knows where a phase or a grow began.
 */
exports.mediaWindow = (0, common_js_1.named)('MediaWindow', zod_1.z.enum(['day', 'week', 'month', 'phase', 'grow', 'custom']));
/** A render's resolution. `hd` and whole-grow renders need entitlement; a free render carries a watermark. */
exports.mediaQuality = (0, common_js_1.named)('MediaQuality', zod_1.z.enum(['sd', 'hd']));
/**
 * The shape a film is rendered to: landscape, the portrait one a reel is, or
 * square. Named by their ratios rather than by a platform, which outlives the
 * platform.
 */
exports.mediaAspect = (0, common_js_1.named)('MediaAspect', zod_1.z.enum(['16_9', '9_16', '1_1']));
/**
 * What is drawn over the frames. Each is off unless it is asked for, and each
 * needs something to draw from - a grow for its day counter, a controller for
 * its climate, entries for its captions - so one that has nothing simply draws
 * nothing rather than refusing the render.
 */
exports.mediaOverlays = (0, common_js_1.named)('MediaOverlays', zod_1.z.object({
    dayCounter: zod_1.z.boolean(),
    climate: zod_1.z.boolean().describe('The temperature and humidity of the span, with a cursor on the frame\'s own instant.'),
    entries: zod_1.z.boolean().describe('The diary lines of the span, each as a caption on the frames around it.'),
}));
/** Only `queued` is a fact of the model; the rest is how far the hourly builder has got. */
exports.mediaRenderStatus = (0, common_js_1.named)('MediaRenderStatus', zod_1.z.enum(['queued', 'rendering', 'ready', 'failed']));
/**
 * A render job. What the picture is of - the camera, the range, the window, the
 * quality - is the media row's own, so this adds only what the composer needs
 * and how the job is going.
 */
exports.mediaRender = (0, common_js_1.named)('MediaRender', zod_1.z.object({
    status: exports.mediaRenderStatus,
    framesPerSecond: zod_1.z.number().int(),
    watermark: zod_1.z.boolean(),
    aspect: exports.mediaAspect,
    overlays: exports.mediaOverlays,
    includeLightsOff: zod_1.z.boolean().describe('Whether the frames taken while the light was off are in the film.'),
    secondCameraId: (0, common_js_1.id)().nullable().describe('The camera shown beside the first one; null for a film of one camera.'),
    startedAt: (0, common_js_1.instant)().nullable(),
    endedAt: (0, common_js_1.instant)().nullable(),
    error: zod_1.z.string().nullable(),
}));
/** What an export is of: one grow, or everything the account has. */
exports.exportScope = (0, common_js_1.named)('ExportScope', zod_1.z.enum(['grow', 'account']));
/**
 * How far an export has got, on the media row that is the export.
 *
 * It carries the same four states a render does, because a zip is built by the
 * same kind of worker and watched in the same way. What it is an export of is
 * here rather than in the row's own `growId`, which stays null deliberately: an
 * export is the account's private copy of everything it can see, so it must not
 * hang off a grow that a link or a public address makes readable to somebody
 * else.
 */
exports.mediaExportJob = (0, common_js_1.named)('MediaExportJob', zod_1.z.object({
    status: exports.mediaRenderStatus,
    scope: exports.exportScope,
    growId: (0, common_js_1.id)().nullable().describe('The grow this is an export of; null for an export of the whole account.'),
    startedAt: (0, common_js_1.instant)().nullable(),
    endedAt: (0, common_js_1.instant)().nullable(),
    error: zod_1.z.string().nullable(),
}));
/**
 * A picture or a film. The bytes stay in the GridFS bucket, whose file id is
 * this resource's id, and are served by `GET /media/{id}/content`.
 *
 * A picture belongs to a camera, a grow or a space, never to a device.
 */
exports.media = (0, common_js_1.named)('Media', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    kind: common_js_1.mediaKind,
    mime: zod_1.z.string(),
    bytes: zod_1.z.number().int().describe('Size of the stored file.'),
    cameraId: (0, common_js_1.id)().nullable(),
    growId: (0, common_js_1.id)().nullable(),
    spaceId: (0, common_js_1.id)()
        .nullable()
        .describe('Null for what a camera delivered, and null to a reader outside the tent: which corner of somebody\'s flat a picture was taken in is not part of what a link shows.'),
    uploadedBy: (0, common_js_1.id)()
        .nullable()
        .describe('Null for what a camera delivered or the composer rendered, and null to a reader outside the tent: a shared diary says what happened rather than who by.'),
    capturedAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)().nullable().describe('The end of the span a film covers; null for a single picture.'),
    window: exports.mediaWindow.nullable(),
    quality: exports.mediaQuality.nullable(),
    lengthSeconds: zod_1.z.number().int().nullable(),
    render: exports.mediaRender.nullable(),
    exportJob: exports.mediaExportJob.nullable().describe('Set on an `export` row and on nothing else; it is what the export is polled by.'),
}));
/**
 * What `GET /grows/{id}/export` and `GET /me/export` answer. A zip of a diary,
 * its CSVs and its photos does not finish inside a request, so the media row
 * comes back with `exportJob.status: queued` and is polled through
 * `GET /media/{id}` until it is `ready`; its bytes then come from
 * `GET /media/{id}/content` like any other file.
 *
 * An export asked for while one is still being built, or while a fresh one is
 * still there, answers that one rather than starting a second. `queued` says
 * whether this request started the build; the status says whether there is a
 * file yet - 200 only for a finished one, 202 for one still to be waited for,
 * whoever started it.
 */
exports.exportAccepted = (0, common_js_1.named)('ExportAccepted', zod_1.z.object({ media: exports.media, queued: zod_1.z.boolean() }));
/**
 * `GET /cameras/{id}/frames` and `GET /cameras/{id}/timelapses` answer this, each
 * filtered to its kind: a frame is a `still` of that camera and a timelapse a
 * film built from them, and both are media rows like any other.
 */
exports.mediaPage = (0, common_js_1.named)('MediaPage', (0, common_js_1.page)(exports.media));
/**
 * Stills come from the camera pipeline and timelapses from the composer, so the
 * only kinds anybody uploads are a picture for the diary and an avatar.
 */
exports.uploadMediaKind = (0, common_js_1.named)('UploadMediaKind', common_js_1.mediaKind.extract(['photo', 'avatar']));
/**
 * `POST /media`, beside the bytes in the multipart body. The mime type, the size
 * and who uploaded it are read off the upload and the session rather than asked
 * for. A photo usually reaches its grow through the entry that carries it;
 * `growId` and `spaceId` are for the picture that is uploaded on its own.
 */
exports.mediaUpload = (0, common_js_1.named)('MediaUpload', exports.media.pick({ growId: true, spaceId: true, capturedAt: true }).partial().extend({ kind: exports.uploadMediaKind }));
// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------
/** How an RTSP stream is pulled. Null on a Terp Cam, which is not RTSP at all. */
exports.cameraTransport = (0, common_js_1.named)('CameraTransport', zod_1.z.enum(['tcp', 'udp']));
/** A hint for the URL template a stream was built from, never how it is read. */
exports.cameraModel = (0, common_js_1.named)('CameraModel', zod_1.z.enum(['terp_cam', 'tapo_c200', 'reolink', 'hikvision', 'custom']));
/** `free` is what an install with `PREMIUM_ENFORCED` unset never sees, because nothing is gated then. */
exports.entitlementTier = (0, common_js_1.named)('EntitlementTier', zod_1.z.enum(['free', 'premium']));
/**
 * Twelve months per camera, never renewed by this server: the admin route is the
 * only writer. `tier` is derived from `validUntil` and the install's
 * enforcement, and `renewalVisible` says whether the screen offers to extend,
 * so neither the client nor this server needs a billing system to draw it.
 */
exports.cameraEntitlement = (0, common_js_1.named)('CameraEntitlement', zod_1.z.object({
    validUntil: (0, common_js_1.instant)().nullable(),
    grant: common_js_1.grantKind.nullable(),
    tier: exports.entitlementTier,
    renewalVisible: zod_1.z.boolean(),
}));
/**
 * `PUT /admin/cameras/{id}/entitlement`, which is the only writer of one:
 * nothing renews on its own in this server. `tier` and `renewalVisible` are read
 * from `validUntil` and the install's configuration every time a camera is
 * serialised, so they are answered and never written.
 */
exports.cameraEntitlementUpdate = (0, common_js_1.named)('CameraEntitlementUpdate', exports.cameraEntitlement.pick({ validUntil: true, grant: true }));
exports.cameraState = (0, common_js_1.named)('CameraState', zod_1.z.object({
    lastStillAt: (0, common_js_1.instant)().nullable(),
    lastError: zod_1.z.string().nullable(),
    firmwareVersion: zod_1.z.string().nullable(),
}));
/**
 * A camera of its own, not a field on a device: a tent has the Terp Cam its
 * controller pairs, RTSP cameras pulled through that controller's tunnel, and
 * standalone Terp Cams the cloud reaches itself.
 *
 * The stored document also has the camera's `secret`, and its `url` carries the
 * credentials the stream is opened with. **Neither is ever serialised**, to the
 * owner no more than to anybody else: `secret` has no field here at all, and
 * `url` is answered with its credentials stripped.
 */
exports.camera = (0, common_js_1.named)('Camera', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    ownerId: (0, common_js_1.id)().nullable().describe('Null on a shared or public read, which is not told whose account the camera is on.'),
    kind: common_js_1.cameraKind,
    deviceId: (0, common_js_1.id)()
        .nullable()
        .describe('The controller that answers for this camera; null for one the cloud reaches itself, and on a shared or public read.'),
    spaceId: (0, common_js_1.id)().nullable(),
    name: zod_1.z.string(),
    looksAt: zod_1.z.string().nullable().describe('What it is pointed at, as a label beside the picture.'),
    plantIds: zod_1.z.array((0, common_js_1.id)()),
    did: zod_1.z.string().nullable().describe('A Terp Cam’s P2P device id.'),
    uid: zod_1.z.string().nullable(),
    ip: zod_1.z.string().nullable().describe('Last address on the local network, as the controller reported it.'),
    url: zod_1.z.string().nullable().describe('The stream URL with its credentials removed.'),
    transport: exports.cameraTransport.nullable(),
    tunnel: zod_1.z.boolean().describe('Pull the stream through the controller’s tunnel rather than reaching it directly.'),
    model: exports.cameraModel.nullable(),
    stillIntervalSeconds: zod_1.z.number().int(),
    nightOff: zod_1.z.boolean(),
    maintenanceOff: zod_1.z.boolean(),
    logErrors: zod_1.z.boolean(),
    staleWarning: zod_1.z
        .boolean()
        .describe('Warn when this camera stops delivering pictures. On unless it is turned off, which is what makes it opt-out.'),
    entitlement: exports.cameraEntitlement.describe('On a shared or public read only the tier the pictures are served at: `validUntil` and `grant` are null and `renewalVisible` false.'),
    isDemo: zod_1.z.boolean(),
    removedAt: (0, common_js_1.instant)().nullable().describe('A removed camera is a tombstone, so its pictures keep their link.'),
    state: exports.cameraState,
}));
exports.cameraPage = (0, common_js_1.named)('CameraPage', (0, common_js_1.page)(exports.camera));
/**
 * What every camera is given whatever kind it is: where it stands, what it is
 * called, what it is pointed at and how often it takes a picture. Deliberately
 * not registered - it is the base the three create bodies are built from, and no
 * route ever accepts or answers it on its own.
 */
const cameraSettings = exports.camera
    .pick({
    spaceId: true,
    name: true,
    looksAt: true,
    plantIds: true,
    stillIntervalSeconds: true,
    nightOff: true,
    maintenanceOff: true,
    logErrors: true,
    staleWarning: true,
})
    .partial({
    spaceId: true,
    looksAt: true,
    plantIds: true,
    stillIntervalSeconds: true,
    nightOff: true,
    maintenanceOff: true,
    logErrors: true,
    staleWarning: true,
});
/** How a stream is pulled, which is a question only an RTSP camera raises. */
const rtspStream = exports.camera.pick({ transport: true, tunnel: true, model: true }).partial();
/*
 * `POST /cameras` takes one of three bodies, discriminated by `kind`, because
 * what says which camera is meant differs per kind: the controller that pairs
 * it, the P2P id printed on it, or the address its stream is at.
 */
/**
 * The Terp Cam a controller pairs. The controller reports the pairing over MQTT
 * and the protocol module upserts the row from it, so this body adopts that one
 * camera by naming its controller instead of describing the hardware.
 */
exports.controllerCameraCreate = (0, common_js_1.named)('ControllerCameraCreate', cameraSettings.extend({
    kind: zod_1.z.literal('terpcam_controller'),
    deviceId: (0, common_js_1.id)(),
}));
/**
 * A Terp Cam the cloud reaches itself, addressed by the P2P id printed on it.
 * The model and the server-side path exist; the tab that would pair one says it
 * is coming, because the flow is unproven against a camera on a desk.
 */
exports.standaloneCameraCreate = (0, common_js_1.named)('StandaloneCameraCreate', cameraSettings.extend({
    kind: zod_1.z.literal('terpcam_standalone'),
    did: zod_1.z.string(),
}));
/**
 * Any other camera, by the address of its stream. Creating one is never refused:
 * whether the address answers is found out by the first capture, not here.
 *
 * `url` carries the credentials the stream is opened with, which is why it is
 * spelled out rather than picked off `Camera`: the resource answers the same URL
 * with them stripped, so the two fields do not mean the same thing.
 */
exports.rtspCameraCreate = (0, common_js_1.named)('RtspCameraCreate', cameraSettings.extend(rtspStream.shape).extend({
    kind: zod_1.z.literal('rtsp'),
    deviceId: (0, common_js_1.id)()
        .nullable()
        .optional()
        .describe('The controller whose tunnel the stream is pulled through; absent or null is one the cloud reaches itself.'),
    url: zod_1.z.string().describe('The whole stream URL, credentials included.'),
}));
exports.cameraCreate = (0, common_js_1.named)('CameraCreate', zod_1.z.discriminatedUnion('kind', [exports.controllerCameraCreate, exports.standaloneCameraCreate, exports.rtspCameraCreate]));
/**
 * `PATCH /cameras/{id}`: everything a camera is given at creation except what
 * says which camera it is. Its kind and its P2P id are what it is; a camera
 * that is not RTSP simply never carries the stream fields.
 *
 * The controller is here because for a stream it is not part of what the camera
 * is but of how it is reached: an RTSP camera moved to another tent is pulled
 * through whatever controller stands there, or through none. A Terp Cam's
 * controller is the one that paired it and is refused on this route.
 */
exports.cameraUpdate = (0, common_js_1.named)('CameraUpdate', exports.rtspCameraCreate.omit({ kind: true }).partial());
/**
 * What `POST /cameras/{id}/test-captures` answers: one picture, taken now, so
 * that whoever is setting a camera up learns whether it answers at all. The
 * picture is stored like any other still, which is why only its id comes back.
 *
 * A camera that could not be read is reported here rather than as an error,
 * because a wrong address is an ordinary outcome of this button and the reason
 * the camera gave is what the person needs to see.
 */
exports.testCaptureAnswer = (0, common_js_1.named)('TestCaptureAnswer', zod_1.z.object({
    succeeded: zod_1.z.boolean(),
    mediaId: (0, common_js_1.id)().nullable(),
    capturedAt: (0, common_js_1.instant)().nullable(),
    error: zod_1.z.string().nullable(),
}));
/**
 * `POST /cameras/{id}/timelapses`, which is the composer. `window` says which
 * span is meant: `day`, `week` and `month` are the calendar day, the Monday-to-
 * Monday week and the calendar month holding `startsAt`, in the zone of the
 * account that owns the camera, and `phase`, `grow` and `custom` each read both ends, because where a phase
 * or a grow began is the client's to say and not a span this server can guess.
 *
 * Everything below `quality` is what the board offers and is optional, so the
 * four one-tap buttons on the camera page send a window and nothing else.
 */
exports.timelapseCreate = (0, common_js_1.named)('TimelapseCreate', zod_1.z.object({
    window: exports.mediaWindow,
    startsAt: (0, common_js_1.instant)()
        .optional()
        .describe("For `day`, `week` and `month`, any instant inside the period meant, which is cut on the camera owner's calendar; defaults to the most recent complete one."),
    endsAt: (0, common_js_1.instant)().optional().describe('Read by `phase`, `grow` and `custom`, each of which needs both ends.'),
    quality: exports.mediaQuality.optional().describe('`hd` needs entitlement and is refused without it rather than quietly made `sd`.'),
    framesPerSecond: zod_1.z.number().int().positive().max(60).optional(),
    secondCameraId: (0, common_js_1.id)().optional().describe('A second camera of the same tent, shown beside the first one.'),
    overlays: exports.mediaOverlays.partial().optional(),
    includeLightsOff: zod_1.z.boolean().optional().describe('Defaults to leaving the frames taken in the dark out.'),
    aspect: exports.mediaAspect.optional(),
}));
/**
 * What that request is answered with. A render does not finish inside the
 * request, so the media row comes back with `render.status: queued` and is
 * polled through `GET /media/{id}`.
 *
 * Camera media is unique on its camera, kind, window and instant, so asking
 * twice for the same span answers the render that already exists rather than
 * making a second one: `queued` is what says which of the two happened, and with
 * it the 202 from the 200.
 */
exports.timelapseAccepted = (0, common_js_1.named)('TimelapseAccepted', zod_1.z.object({
    media: exports.media,
    queued: zod_1.z.boolean(),
}));
// ---------------------------------------------------------------------------
// Feeding schemes
// ---------------------------------------------------------------------------
/** Which shipped asset a scheme was made from, and at which version of it. */
exports.schemeOrigin = (0, common_js_1.named)('SchemeOrigin', zod_1.z.object({
    assetId: zod_1.z.string().nullable(),
    version: zod_1.z.string().nullable(),
}));
/**
 * A person's own feeding scheme. The grid is the same table a grow carries, so
 * that editing a scheme here and reading it back off a grow speak one language;
 * a grow keeps its own copy, which is what leaves its history alone when this
 * one is edited later.
 */
exports.scheme = (0, common_js_1.named)('Scheme', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    ownerId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    origin: exports.schemeOrigin,
    grid: zod_1.z.array(common_js_1.schemeWeek),
}));
exports.schemePage = (0, common_js_1.named)('SchemePage', (0, common_js_1.page)(exports.scheme));
/**
 * `POST /schemes`. `origin` is left out by somebody writing a scheme of their
 * own and filled in by a client that started from a shipped asset, which is the
 * only way the server learns of one: it never reads an asset itself.
 */
exports.schemeCreate = (0, common_js_1.named)('SchemeCreate', exports.scheme.pick({ name: true, origin: true, grid: true }).partial({ origin: true }));
/** `PATCH /schemes/{id}`: the same fields, each only if it changes. */
exports.schemeUpdate = (0, common_js_1.named)('SchemeUpdate', exports.schemeCreate.partial());
// ---------------------------------------------------------------------------
// Chart views
// ---------------------------------------------------------------------------
/**
 * A span. Either end may be open, which is what `null` says; a share link's
 * range and a saved chart view both use it.
 */
exports.timeRange = (0, common_js_1.named)('TimeRange', zod_1.z.object({
    startsAt: (0, common_js_1.instant)().nullable(),
    endsAt: (0, common_js_1.instant)().nullable(),
}));
/**
 * How far back a saved view looks. Four shapes rather than a pair of nullable
 * fields, because the chips above the charts are four separate choices and only
 * two of them carry a number at all: a fixed span and a rolling one written as
 * two fields that must never both be filled is an invariant nothing holds a
 * client to, while "this phase" and "the whole grow" have no dates of their own
 * and are read off the grow at the moment the chart is drawn - which is the
 * point of saving them, since a view saved in week three is still about week
 * nine when it is opened again.
 */
exports.chartViewSpan = (0, common_js_1.named)('ChartViewSpan', zod_1.z.discriminatedUnion('kind', [
    zod_1.z.object({ kind: zod_1.z.literal('last'), forSeconds: zod_1.z.number().int().positive() }),
    zod_1.z.object({ kind: zod_1.z.literal('fixed'), range: exports.timeRange }),
    zod_1.z.object({ kind: zod_1.z.literal('phase') }),
    zod_1.z.object({ kind: zod_1.z.literal('grow') }),
]));
/**
 * How the panels are drawn: one per series, all on shared axes, or counted in
 * days since the grow began rather than in dates, which is what makes two runs
 * of the same tent comparable.
 */
exports.chartViewLayout = (0, common_js_1.named)('ChartViewLayout', zod_1.z.enum(['stacked', 'overlay', 'day_of_grow']));
/**
 * What a saved chart draws, structured rather than the query string the old app
 * saved.
 *
 * Climate and outputs come out of the device's store and `measurements` out of
 * the diary, but a view names all three the same way: what somebody picked off
 * the chip bar is one list of series to them, and which store answers each is
 * the reader's business rather than the saved view's.
 */
exports.chartViewDefinition = (0, common_js_1.named)('ChartViewDefinition', zod_1.z.object({
    deviceIds: zod_1.z.array((0, common_js_1.id)()),
    growId: (0, common_js_1.id)().nullable(),
    metrics: zod_1.z.array(common_js_1.metric),
    outputs: zod_1.z.array(common_js_1.outputMetric),
    measurements: zod_1.z
        .array(zod_1.z.string())
        .describe("Keys of the grow's own measurement definitions. A key the grow no longer defines draws nothing."),
    span: exports.chartViewSpan,
    layout: exports.chartViewLayout,
    intervalSeconds: zod_1.z.number().int().describe('Width of one bucket, which is what decides how many points come back.'),
}));
exports.chartView = (0, common_js_1.named)('ChartView', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    ownerId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    definition: exports.chartViewDefinition,
}));
exports.chartViewPage = (0, common_js_1.named)('ChartViewPage', (0, common_js_1.page)(exports.chartView));
/** `POST /chart-views`. A view is its name and what it draws; nothing else is stored. */
exports.chartViewCreate = (0, common_js_1.named)('ChartViewCreate', exports.chartView.pick({ name: true, definition: true }));
/** `PATCH /chart-views/{id}`: the same two, each only if it changes. */
exports.chartViewUpdate = (0, common_js_1.named)('ChartViewUpdate', exports.chartViewCreate.partial());
// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------
exports.shareLinkState = (0, common_js_1.named)('ShareLinkState', zod_1.z.object({
    openCount: zod_1.z.number().int(),
    lastOpenedAt: (0, common_js_1.instant)().nullable(),
}));
/**
 * `token` is the secret the link is opened with and is separate from `id`, so
 * that a link can be listed, patched and revoked by an id that is not a secret.
 * It is on the wire for whoever may manage the link, because sharing the link is
 * the point of it; what is read *through* the link never carries it.
 *
 * Every read through a link is clamped to `range`.
 */
exports.shareLink = (0, common_js_1.named)('ShareLink', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    token: zod_1.z.string(),
    kind: common_js_1.shareKind,
    subject: common_js_1.growOrSpaceRef,
    range: exports.timeRange,
    includeCameras: zod_1.z.boolean().describe('Camera pictures are only ever visible through a link that includes them.'),
    createdBy: (0, common_js_1.id)(),
    expiresAt: (0, common_js_1.instant)().nullable(),
    revokedAt: (0, common_js_1.instant)().nullable(),
    state: exports.shareLinkState,
}));
exports.shareLinkPage = (0, common_js_1.named)('ShareLinkPage', (0, common_js_1.page)(exports.shareLink));
/**
 * `POST /share-links`. The token, the counters and who made the link are the
 * server's. A `range` with an open end is a link that keeps up with a grow as it
 * goes on, which is what sharing a running diary means.
 */
exports.shareLinkCreate = (0, common_js_1.named)('ShareLinkCreate', exports.shareLink
    .pick({ kind: true, subject: true, range: true, includeCameras: true, expiresAt: true })
    .partial({ range: true, includeCameras: true, expiresAt: true }));
/**
 * `PATCH /share-links/{id}`: what may still be changed once a link is out of the
 * house. Not `kind` and not `subject`: the address is in somebody else's hands,
 * and repointing it would show them something they were never sent. The range,
 * the cameras and the expiry can each be changed, wider as well as narrower;
 * ending the link altogether is `PUT /share-links/{id}/revocation`, and only a
 * link that has stopped may then be deleted.
 */
exports.shareLinkUpdate = (0, common_js_1.named)('ShareLinkUpdate', exports.shareLinkCreate.omit({ kind: true, subject: true }).partial());
// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------
/**
 * One migration that has run. The record is what makes a migration run once and
 * what an operator reads afterwards, so `stats` keeps whatever the migration
 * counted - rows moved, rows skipped - and is not typed here: every migration
 * counts something else.
 */
exports.migration = (0, common_js_1.named)('Migration', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    name: zod_1.z.string().describe('Unique; it is what says the migration has already run.'),
    appliedAt: (0, common_js_1.instant)(),
    durationMs: zod_1.z.number().int(),
    stats: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
}));
exports.migrationPage = (0, common_js_1.named)('MigrationPage', (0, common_js_1.page)(exports.migration));
// ---------------------------------------------------------------------------
// Read models
//
// What a screen opens on, assembled by the server from several collections.
// They are answers, never stored, so they carry the few embedded shapes they
// draw rather than referring to resources a client would have to fetch one by
// one.
// ---------------------------------------------------------------------------
/**
 * A metric as a card draws it: the one `MetricValue` with the metric it belongs
 * to written into it, because a card carries a list of them while a device read
 * answers a map keyed by metric.
 */
exports.cardValue = (0, common_js_1.named)('CardValue', zod_1.z.object({ metric: common_js_1.metric, ...common_js_1.metricValue.shape }));
/**
 * What the controller is aiming at right now, for the metrics it steers, and
 * how far a reading may stray from it and still count as on target. The band is
 * `TARGET_BAND` stated on the wire, so the figure beside a value and the
 * verdict's "in band" are judged by the same width and no client keeps a width
 * of its own.
 */
exports.cardSetpoint = (0, common_js_1.named)('CardSetpoint', zod_1.z.object({
    metric: common_js_1.metric,
    value: zod_1.z.number().nullable(),
    band: zod_1.z.number().nullable().describe('Half the width of the band around the target; null for a metric that has none.'),
}));
/** The newest picture of a space, as a card shows it. */
exports.latestStill = (0, common_js_1.named)('LatestStill', zod_1.z.object({
    mediaId: (0, common_js_1.id)(),
    cameraId: (0, common_js_1.id)(),
    capturedAt: (0, common_js_1.instant)(),
}));
/**
 * A day of one metric, the size of a stamp: what a card draws beside its figures
 * to say "steady" or "not". It rides on the card rather than being fetched per
 * card, so a club's home is one request however many places it has.
 */
exports.cardTrend = (0, common_js_1.named)('CardTrend', zod_1.z.object({
    metric: common_js_1.metric,
    stepSeconds: zod_1.z.number().int(),
    endsAt: (0, common_js_1.instant)(),
    points: zod_1.z.array(zod_1.z.number().nullable()).describe('One figure per window, oldest first; null where the window holds no sample.'),
}));
/**
 * A task as a card lists it. Tasks are derived from reminders, the scheme grid
 * and the plan rather than stored, and their ids are deterministic - which is
 * how completing one, an entry carrying that `taskId`, keeps it from coming back.
 *
 * What it is about is the same reference `Task` carries, so a card and the task
 * list say it one way.
 */
exports.dueTask = (0, common_js_1.named)('DueTask', zod_1.z.object({
    id: (0, common_js_1.id)(),
    kind: common_js_1.reminderKind,
    label: zod_1.z.string(),
    dueAt: (0, common_js_1.instant)(),
    subject: common_js_1.growOrSpaceRef,
    assigneeId: (0, common_js_1.id)().nullable(),
}));
/** An alert as a card lists it; `GET /alerts` answers the alert itself. */
exports.openAlert = (0, common_js_1.named)('OpenAlert', zod_1.z.object({
    alertId: (0, common_js_1.id)(),
    kind: common_js_1.alertKind,
    severity: common_js_1.severity,
    startedAt: (0, common_js_1.instant)(),
    value: zod_1.z.number().nullable(),
    metric: common_js_1.metric
        .nullable()
        .describe('The reading the rule watches, so "78 % RH" can be said; null for an alert raised without a rule, or by a rule watching an output.'),
    name: zod_1.z
        .string()
        .nullable()
        .describe('What the rule that raised it is called, or was called when the episode opened where it has since been deleted: what tells two alarms on one place apart. Null for an alert raised without a rule.'),
}));
/** One group of a split, as a card counts it: `GrowSummary.groups` names the plants instead. */
exports.growCardStageGroup = (0, common_js_1.named)('GrowCardStageGroup', zod_1.z.object({
    stage: common_js_1.growthStage,
    plantCount: zod_1.z.number().int().nullable().describe('Null where the owner hides counts.'),
}));
/**
 * The grow as a card draws it: the day counter, the phase headline and the "auto"
 * tag, all computed from `phases[]` in the grow serialiser. `stageGroups` is
 * filled only when the plants are not all in the same phase, which is what a
 * split leaves behind.
 */
exports.growCard = (0, common_js_1.named)('GrowCard', zod_1.z.object({
    growId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    type: common_js_1.growType,
    dayNumber: zod_1.z.number().int().nullable(),
    phaseDay: zod_1.z.number().int().nullable().describe('How many days the grow has stood in its current phase.'),
    stageWeek: zod_1.z
        .number()
        .int()
        .nullable()
        .describe('Which week of its stage the grow is in: 1 in the week the stage began, the same figure the grow page’s own header and week cards state.'),
    stage: common_js_1.growthStage.nullable(),
    stagesReached: zod_1.z
        .array(common_js_1.growthStage)
        .describe('The stages the grow as a whole has been through, oldest first, the one it is in included: what a phase bar fills. A grow started in veg never germinated here, so germination is not among them; a phase scoped to some plants is a split and is not either.'),
    preset: zod_1.z.string().nullable(),
    isAuto: zod_1.z.boolean().describe('The phase was set by a preset or the plan rather than by a person.'),
    plantCount: zod_1.z.number().int().nullable().describe('Null where the owner hides counts.'),
    strains: zod_1.z.array(zod_1.z.string()).describe('Each strain once, in the order it was planted.'),
    coverMediaId: (0, common_js_1.id)().nullable(),
    stageGroups: zod_1.z.array(exports.growCardStageGroup),
}));
/**
 * One space, with everything the home screen shows about it - or, where the
 * ids are null, one open grow that stands in no space at all. A grow is
 * first-class without a place, so "no fixed place" is a card rather than a
 * hole in the home, and the app opens it at the grow because there is no space
 * page to open.
 */
exports.homeSpaceCard = (0, common_js_1.named)('HomeSpaceCard', zod_1.z.object({
    spaceId: (0, common_js_1.id)().nullable().describe('Null is “no fixed place”: the card stands for the grow alone.'),
    name: zod_1.z.string().describe('The place’s name, or the grow’s own where the card stands for no place.'),
    kind: common_js_1.spaceKind.nullable().describe('Null where there is no place, and so no kind of one.'),
    roomId: (0, common_js_1.id)().nullable(),
    deviceIds: zod_1.z.array((0, common_js_1.id)()),
    values: zod_1.z.array(exports.cardValue),
    setpoints: zod_1.z.array(exports.cardSetpoint),
    trend: exports.cardTrend.nullable().describe('The last 24 hours of temperature, from the first device in the space that has any.'),
    grow: exports.growCard.nullable(),
    entries: zod_1.z.array(exports.entry).describe('The grow’s newest entries, newest first.'),
    latestStill: exports.latestStill.nullable(),
    dueTasks: zod_1.z.array(exports.dueTask),
    openAlerts: zod_1.z.array(exports.openAlert),
}));
/** A grow somebody follows: a public grow, so only what its public page shows. */
exports.followedGrowCard = (0, common_js_1.named)('FollowedGrowCard', zod_1.z.object({
    growId: (0, common_js_1.id)(),
    slug: zod_1.z.string(),
    name: zod_1.z.string(),
    handle: zod_1.z.string().describe('The owner’s handle, the only name others ever see.'),
    dayNumber: zod_1.z.number().int().nullable(),
    stage: common_js_1.growthStage.nullable(),
    endedAt: (0, common_js_1.instant)()
        .nullable()
        .describe('When the grow finished; null while it is running. `dayNumber` is then its final day rather than the day it is on.'),
    coverMediaId: (0, common_js_1.id)().nullable(),
    updatedAt: (0, common_js_1.instant)().describe('When the diary last moved: the newest line in it, or the day the grow started where nobody has written one yet.'),
}));
exports.homeAnswer = (0, common_js_1.named)('HomeAnswer', zod_1.z.object({
    spaces: zod_1.z.array(exports.homeSpaceCard),
    followedGrows: zod_1.z.array(exports.followedGrowCard),
    people: zod_1.z.array(common_js_1.person).describe('Everyone the cards name, so a card can say who wrote an entry without another read.'),
}));
exports.verdictRating = (0, common_js_1.named)('VerdictRating', zod_1.z.enum(['good', 'watch', 'poor']));
/** A target widened by `TARGET_BAND`: what a chart shades green and a verdict counts time inside. */
exports.targetBand = (0, common_js_1.named)('TargetBand', zod_1.z.object({ low: zod_1.z.number(), high: zod_1.z.number() }));
/**
 * One run outside the band, which is what "1 humidity excursion 02:10–05:30"
 * names. `endedAt` is null for a run that was still going when the window
 * ended - it has not ended, and saying so is not the same as ending it now.
 */
exports.climateExcursion = (0, common_js_1.named)('ClimateExcursion', zod_1.z.object({
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    above: zod_1.z.boolean().describe('Which edge it left over: true is above the band.'),
    extremeValue: zod_1.z.number().nullable().describe('The furthest the reading got while it was out.'),
}));
/**
 * How one metric did over the window, against the band its target sets. Day and
 * night are told apart by the light output and each half is judged against its
 * own band, which is why both are answered.
 *
 * The two counts are over the windows that held a reading: a device that was
 * quiet adds to neither, so together they are the time that is known about
 * rather than always the whole window.
 */
exports.climateVerdictMetric = (0, common_js_1.named)('ClimateVerdictMetric', zod_1.z.object({
    metric: common_js_1.metric,
    rating: exports.verdictRating.nullable().describe('Null where nothing here holds a target for this metric, so there is no band to judge it against.'),
    minValue: zod_1.z.number().nullable(),
    maxValue: zod_1.z.number().nullable(),
    averageValue: zod_1.z.number().nullable(),
    dayBand: exports.targetBand.nullable(),
    nightBand: exports.targetBand.nullable().describe('Null where the metric is not steered in that half at all: CO2 is only raised while the light is on.'),
    inBandSeconds: zod_1.z.number().int(),
    outOfBandSeconds: zod_1.z.number().int(),
    excursions: zod_1.z.array(exports.climateExcursion).describe('In the order they happened; empty where the metric has no band.'),
}));
/**
 * How often one output came on over the window, which is what "dehumidifier ran
 * 14×" counts. A run is one reading showing it on after one showed it off, so an
 * output stays what it was last reported to be across the windows that hold no
 * reading, and a device that reported nothing about an output at all has no row
 * here rather than a row of zeroes.
 */
exports.actuatorRuns = (0, common_js_1.named)('ActuatorRuns', zod_1.z.object({
    output: common_js_1.outputMetric,
    runCount: zod_1.z.number().int(),
    forSeconds: zod_1.z.number().int().describe('How long it was on altogether, over the windows that held a reading.'),
}));
/**
 * The 24 h verdict, from one aggregation over the window: the share of the time
 * inside the band, the runs that left it, and how often each actuator came on.
 *
 * `rating` is the worst of the metrics, which is what the headline says.
 * `stepSeconds` is the resolution the whole of it is stated at - an excursion
 * shorter than one window, and an actuator that switched twice inside one, are
 * not in the points that were read.
 */
exports.climateVerdict = (0, common_js_1.named)('ClimateVerdict', zod_1.z.object({
    deviceId: (0, common_js_1.id)().nullable().describe('The device the window was read from; null in a space that has none.'),
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    forSeconds: zod_1.z.number().int(),
    stepSeconds: zod_1.z.number().int(),
    rating: exports.verdictRating.nullable(),
    inBandFraction: zod_1.z
        .number()
        .nullable()
        .describe('0 to 1: the share of the measured time in which every steered metric that was measured stood in its band; the "91 % in band" of the headline. Null when nothing here is steered.'),
    metrics: zod_1.z.array(exports.climateVerdictMetric),
    actuators: zod_1.z.array(exports.actuatorRuns),
    trend: exports.cardTrend.nullable().describe('The same window as a line, coarsened; it comes out of the aggregation that was read anyway.'),
}));
/** One picture of a camera, as the day's strip draws it: the camera is the row it sits in. */
exports.cameraStill = (0, common_js_1.named)('CameraStill', zod_1.z.object({ mediaId: (0, common_js_1.id)(), capturedAt: (0, common_js_1.instant)() }));
/** A camera of the space and the day it has taken so far. */
exports.overviewCamera = (0, common_js_1.named)('OverviewCamera', zod_1.z.object({
    cameraId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    lastStillAt: (0, common_js_1.instant)().nullable(),
    stills: zod_1.z
        .array(exports.cameraStill)
        .describe("Today's, oldest first and at most one per slot of the day, so the strip spans the day rather than its last few minutes."),
}));
/**
 * A grow standing in this space. The card the home draws, and what is true of it
 * *here*: a grow moves between tents, so the day it arrived is not the day it
 * started.
 */
exports.overviewGrow = (0, common_js_1.named)('OverviewGrow', exports.growCard.extend({
    weekNumber: zod_1.z.number().int().nullable().describe("Counted like the day counter, so it lines up with the feeding scheme's grid."),
    placedAt: (0, common_js_1.instant)(),
    placedOnDay: zod_1.z
        .number()
        .int()
        .nullable()
        .describe('The grow’s own day counter on the day these plants arrived here, which is what "here since day 22" says.'),
}));
/**
 * A due task with what its completion would be written with, so the Done button
 * on the card needs nothing else read and can say what it is about to log.
 * `POST /tasks/{id}/completions` takes these same values, and a completion that
 * names none takes them from the task.
 */
exports.overviewTask = (0, common_js_1.named)('OverviewTask', exports.dueTask.extend({ defaults: (0, common_js_1.anyValue)().describe('Prefilled entry values for the completion; null when the task prefills nothing.') }));
/**
 * What the space's controller is aiming at in both halves of the cycle.
 * `SpaceOverview.setpoints` is the half it is in right now, which is what a
 * value is drawn against; this is the pair the header states, and the bands the
 * verdict judges against are these widened by `TARGET_BAND`.
 */
exports.overviewTargets = (0, common_js_1.named)('OverviewTargets', zod_1.z.object({
    day: zod_1.z.array(exports.cardSetpoint),
    night: zod_1.z.array(exports.cardSetpoint),
}));
/**
 * `GET /spaces/{id}/overview`, the tent page's landing tab: what is true here
 * now, what needs a human, what grows here, what the cameras saw today, how the
 * last 24 hours went and what was last written.
 *
 * It is the home card of that space with the four things a page has room for
 * that a card does not - the verdict, the day's pictures, every grow rather
 * than the headline one, and enough of a due task to tick it off.
 */
exports.spaceOverview = (0, common_js_1.named)('SpaceOverview', zod_1.z.object({
    spaceId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    kind: common_js_1.spaceKind,
    roomId: (0, common_js_1.id)().nullable().describe('Null where the space stands on its own, and on a shared or public read, which is not told how the place is arranged.'),
    deviceIds: zod_1.z.array((0, common_js_1.id)()).nullable().describe('Null on a shared or public read: what a reader is shown is the tent, not the hardware in it.'),
    values: zod_1.z.array(exports.cardValue).describe('Empty on a read through a window that has closed, which has no "now" to answer with.'),
    setpoints: zod_1.z.array(exports.cardSetpoint),
    targets: exports.overviewTargets.nullable().describe('Null in a space whose devices hold no targets at all, and on a read through a window that has closed.'),
    verdict: exports.climateVerdict,
    grows: zod_1.z.array(exports.overviewGrow).describe('Every grow with open plants here, newest first.'),
    cameras: zod_1.z.array(exports.overviewCamera),
    entries: zod_1.z.array(exports.entry).describe('The newest lines of this space and of the grows standing in it, newest first.'),
    readingNames: zod_1.z.array(exports.growReadingNames).describe('What the grows those lines belong to call their measurements, so a reading is named rather than keyed.'),
    dueTasks: zod_1.z.array(exports.overviewTask),
    openAlerts: zod_1.z.array(exports.openAlert),
    people: zod_1.z.array(common_js_1.person).describe('Everyone the answer names, so an entry can say who wrote it without another read.'),
}));
/** One device's newest values, as the space screen redraws them. */
exports.spaceLiveDevice = (0, common_js_1.named)('SpaceLiveDevice', zod_1.z.object({
    deviceId: (0, common_js_1.id)(),
    values: zod_1.z.array(exports.cardValue),
    setpoints: zod_1.z.array(exports.cardSetpoint),
}));
/**
 * When one camera of the space last delivered. A camera that has gone quiet is
 * dimmed like a value is, but against its own `stillIntervalSeconds` rather than
 * against `VALUE_AGE`, so the instant is answered and the state is not.
 */
exports.spaceLiveCamera = (0, common_js_1.named)('SpaceLiveCamera', zod_1.z.object({
    cameraId: (0, common_js_1.id)(),
    lastStillAt: (0, common_js_1.instant)().nullable(),
}));
/**
 * `GET /spaces/{id}/live`: what a space screen polls while it is open. The live
 * answer of each of its devices, grouped by the space they stand in, the
 * headline the space itself is drawn with - a tent with two controllers shows
 * one temperature above and both below - and when each of its cameras last
 * delivered.
 *
 * The values are the shapes the cards already use rather than the per-device
 * vocabulary of `DeviceLive`, because this is the refresh of a card that is on
 * the screen and not a device read.
 */
exports.spaceLive = (0, common_js_1.named)('SpaceLive', zod_1.z.object({
    spaceId: (0, common_js_1.id)(),
    values: zod_1.z.array(exports.cardValue),
    setpoints: zod_1.z.array(exports.cardSetpoint),
    devices: zod_1.z.array(exports.spaceLiveDevice),
    cameras: zod_1.z.array(exports.spaceLiveCamera),
}));
/**
 * What the Timeline tab is asked for. `24h` and `7d` are windows ending at the
 * instant the request names; `phase` and `grow` are stretches of one grow and so
 * cannot be answered without being told which.
 */
exports.timelineRange = (0, common_js_1.named)('TimelineRange', zod_1.z.enum(['24h', '7d', 'phase', 'grow']));
/**
 * A stretch of the window in which something was so: the light was off, an
 * output was running. Both ends are inside the window - a stretch still going
 * when the window ends is closed at its end rather than left open, because the
 * answer says nothing about what happened afterwards.
 */
exports.timelineSpan = (0, common_js_1.named)('TimelineSpan', zod_1.z.object({ startsAt: (0, common_js_1.instant)(), endsAt: (0, common_js_1.instant)() }));
/** What was aimed at in one half of the cycle: the dashed line, and the band drawn around it. */
exports.timelineTarget = (0, common_js_1.named)('TimelineTarget', zod_1.z.object({ setpoint: zod_1.z.number(), band: exports.targetBand }));
/**
 * One stretch of the window in which the same targets applied.
 *
 * The band moves with the phase, because a phase records the targets that were
 * running when it began and the store holds readings and never setpoints. So a
 * window spanning two phases carries two of these rather than one average, and a
 * tent with no grow in it carries one, from the controller's own configuration.
 */
exports.timelineTargets = (0, common_js_1.named)('TimelineTargets', zod_1.z.object({
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    phaseId: (0, common_js_1.id)().nullable().describe("Null where the targets are the controller's configuration rather than a phase's snapshot."),
    stage: common_js_1.growthStage.nullable(),
    day: exports.timelineTarget.nullable(),
    night: exports.timelineTarget.nullable().describe('Null where the metric is not steered in the dark half at all: CO2 is only raised while the light is on.'),
}));
/**
 * One stacked panel: a metric over the window, with the targets that applied
 * across it. A metric nothing in the space measured has no panel at all rather
 * than a panel of nulls, which is what "the CO2 panel only when there is a
 * sensor" means.
 */
exports.timelinePanel = (0, common_js_1.named)('TimelinePanel', zod_1.z.object({
    metric: common_js_1.metric,
    points: zod_1.z.array(common_js_1.seriesPoint),
    targets: zod_1.z.array(exports.timelineTargets).describe('In order, each ending where the next begins; empty where nothing held a target over the window.'),
}));
/** One output over the window, as the lanes under the panels draw it: when it was on, not what it measured. */
exports.timelineOutputLane = (0, common_js_1.named)('TimelineOutputLane', zod_1.z.object({
    output: common_js_1.outputMetric,
    deviceId: (0, common_js_1.id)()
        .nullable()
        .describe('Two controllers in one tent each drive their own outputs, so a lane names the device it belongs to. Null on a shared or public read: what a reader is shown is the tent, not the hardware in it.'),
    spans: zod_1.z.array(exports.timelineSpan),
    heardUntil: (0, common_js_1.instant)().describe('How far anything is known about this output: the last instant the device was heard from inside the window, or the window\'s own end where it is still reporting. A span ending here ended because nobody has said anything since, which is not the same claim as the output having been switched off - so a wave drawn from these spans stops here rather than running flat along the bottom to the edge.'),
}));
/**
 * One alarm as a span of the window. `endedAt` is null for an alert that is
 * still open - it has not ended, and closing it at the edge of the window would
 * say it had.
 */
exports.timelineAlarm = (0, common_js_1.named)('TimelineAlarm', zod_1.z.object({
    alertId: (0, common_js_1.id)(),
    kind: common_js_1.alertKind,
    severity: common_js_1.severity,
    metric: common_js_1.metric
        .nullable()
        .describe('The reading the rule watched; null for an alert the health loop raised without one, or one from a rule watching an output.'),
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    value: zod_1.z.number().nullable(),
    extremeValue: zod_1.z.number().nullable(),
}));
/**
 * How many of the machines' own lines the rail was given, and how many the
 * window actually held.
 *
 * They differ where the net over a device's own log and the plan's bookkeeping
 * cut a long window - a grow of four months in a chatty tent holds thousands of
 * them - and the two numbers exist so that the rail can say so. A screen that
 * only got the first would draw four months with no machine mark on them and
 * nothing to say why.
 */
exports.timelineMachineEvents = (0, common_js_1.named)('TimelineMachineEvents', zod_1.z.object({
    shown: zod_1.z.number().int().describe("How many are in `events`. Zero on a shared or public read, whose rail is the grow's diary and never a device's diagnostics."),
    total: zod_1.z.number().int().describe('How many the window held. Equal to `shown` wherever the net did not bite, which is every short window.'),
}));
/** One grow that has stood in this space, so a rail can be pointed at one that has since ended. */
exports.timelineGrow = (0, common_js_1.named)('TimelineGrow', zod_1.z.object({
    growId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
}));
/** One camera of the space over the window, thinned to what the slider above the panels steps through. */
exports.timelineCamera = (0, common_js_1.named)('TimelineCamera', zod_1.z.object({
    cameraId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    frames: zod_1.z.array(exports.cameraStill).describe('Oldest first, at most one per step, so the still above the panels is a lookup rather than a request per position.'),
}));
/**
 * `GET /spaces/{id}/timeline`, the whole Timeline tab in one answer: the frames
 * the slider steps through, a panel per metric with the bands that applied, the
 * night worked out from the light rather than from a clock, the alarms, the
 * output lanes and the event rail.
 *
 * It is one answer per range rather than six requests stitched together,
 * because every part of it is a view of the same window and a screen that
 * assembled them would draw parts of six different ones.
 *
 * A space with no controller answers the frames and the rail and nothing else:
 * `panels` is then empty, the way a week card of a grow with no controller
 * carries no climate. Nothing here is written to - the rail carries lines to
 * open and never a task to tick off - so a read-only link is served the same
 * answer as its owner, clamped to its window.
 */
exports.spaceTimeline = (0, common_js_1.named)('SpaceTimeline', zod_1.z.object({
    spaceId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    kind: common_js_1.spaceKind,
    range: exports.timelineRange,
    growId: (0, common_js_1.id)().nullable().describe('The grow the bands and the day counter are of; null in a space nothing grows in.'),
    dayFrom: zod_1.z.number().int().nullable().describe('The grow\'s own day counter at each end of the window, which is the "day 33–34" beside the range chips.'),
    dayTo: zod_1.z.number().int().nullable(),
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    stepSeconds: zod_1.z.number().int().describe('The window each point summarises; 0 in a space with no device to read, where there are no points at all.'),
    deviceIds: zod_1.z.array((0, common_js_1.id)()).nullable().describe('Null on a shared or public read: what a reader is shown is the tent, not the hardware in it.'),
    panels: zod_1.z.array(exports.timelinePanel),
    lastReadingAt: (0, common_js_1.instant)()
        .nullable()
        .describe('When a device standing here last measured one of the panels\' metrics, whenever that was - which is the only thing that tells a window nothing was heard in apart from a place where nothing measures, since `panels` is empty in both. Answered only where `panels` is empty, because that is the one question it settles; null there where nothing standing here has ever measured, and null beside panels that speak for themselves.'),
    nights: zod_1.z.array(exports.timelineSpan).describe('When the light was off, from the light output rather than from the clock; empty where no device reports one.'),
    alarms: zod_1.z.array(exports.timelineAlarm),
    outputs: zod_1.z.array(exports.timelineOutputLane),
    events: zod_1.z.array(exports.entry).describe('The rail: the diary of this space and of the grows standing in it, oldest first, as the marks are drawn.'),
    machineEvents: exports.timelineMachineEvents,
    grows: zod_1.z
        .array(exports.timelineGrow)
        .describe('Every grow that has stood in this space, newest first, which is what the two stretch chips may be pointed at - a grow that moved out in spring left its record behind and the rail is the only screen that carries it. Empty on a shared or public read, which is given one grow and is not told what else has stood in the room.'),
    readingNames: zod_1.z
        .array(exports.growReadingNames)
        .describe('What the grows those lines belong to call their measurements, so a reading is named rather than keyed. On a read through a link, only the grows that stood here inside its window.'),
    cameras: zod_1.z.array(exports.timelineCamera),
    people: zod_1.z.array(common_js_1.person).describe('Everyone the rail names, so a mark can say who wrote it without another read.'),
}));
/**
 * One metric aggregated over a stretch of a grow, which is one time-series query
 * per stretch and controller.
 *
 * Day and night are the controller's own cycle rather than hours of the clock:
 * they are told apart by its light output, so a device that drives no light -
 * a fridge drying, a tent lit from a socket nobody told the server about -
 * answers `averageValue` and neither half.
 */
exports.weekClimate = (0, common_js_1.named)('WeekClimate', zod_1.z.object({
    metric: common_js_1.metric,
    minValue: zod_1.z.number().nullable(),
    maxValue: zod_1.z.number().nullable(),
    averageValue: zod_1.z.number().nullable(),
    dayAverage: zod_1.z.number().nullable().describe('The mean over the windows in which the light was on.'),
    nightAverage: zod_1.z.number().nullable(),
}));
/**
 * One of the seven thumbnails a week card is drawn with: the still taken
 * nearest a fixed hour of that day, so the strip reads as one picture a day
 * rather than as whatever the camera last sent. Null where no camera was
 * watching, which is what leaves a slot empty.
 */
exports.growWeekDay = (0, common_js_1.named)('GrowWeekDay', zod_1.z.object({
    dayNumber: zod_1.z.number().int(),
    startsAt: (0, common_js_1.instant)(),
    stage: common_js_1.growthStage
        .nullable()
        .describe('The stage the grow entered on this day, where it entered one; null on a day it carried on in the stage before. A week is named after the stage it ended in, so this is the only place a card records a stage that began and was over inside it.'),
    mediaId: (0, common_js_1.id)().nullable(),
    cameraId: (0, common_js_1.id)().nullable(),
    capturedAt: (0, common_js_1.instant)().nullable(),
}));
/**
 * What the scheme says to feed this week, and how many feeds the week is
 * supposed to have. `amounts` is the grid's row for this week with the grow's
 * own strength already applied, so nobody multiplies it twice; how many of them
 * were done is the card's `feedCount`.
 *
 * No screen has a control for the rhythm, so `plannedCount` is read from the
 * grow's feed reminder, else its water reminder, else three.
 */
exports.growWeekFeeding = (0, common_js_1.named)('GrowWeekFeeding', zod_1.z.object({
    amounts: zod_1.z.array(common_js_1.schemeAmount),
    plannedCount: zod_1.z.number().int(),
}));
/**
 * Where one of the grow's own measurements stood at the end of the week, and by
 * how much it moved - "Height · 58 cm · +6". `change` is against the newest
 * reading before this week began and is null when there was none.
 *
 * `key` names a definition in the grow's `measurements[]`, which is where its
 * name, its unit and its target are; nothing about the measurement is copied
 * onto the reading.
 */
exports.growWeekReading = (0, common_js_1.named)('GrowWeekReading', zod_1.z.object({
    key: zod_1.z.string(),
    value: zod_1.z.number(),
    change: zod_1.z.number().nullable(),
    measuredAt: (0, common_js_1.instant)(),
}));
/**
 * A week of a grow, which is what the grow page is made of. `weekNumber` counts
 * from the grow's origin, like the day counter, so it lines up with the feeding
 * scheme's grid, and `dayFrom`/`dayTo` are the same count in days - always
 * seven of them, because "day 29-35" is what the week is of; `endsAt` is where
 * the week stops, which for the week a grow is in is now.
 *
 * `stageWeek` is which week of the current stage this is, so "Flower wk 2" can
 * be drawn from the card alone: the public page carries these cards without the
 * grow's phases beside them.
 */
exports.growWeekCard = (0, common_js_1.named)('GrowWeekCard', zod_1.z.object({
    weekNumber: zod_1.z.number().int(),
    dayFrom: zod_1.z.number().int(),
    dayTo: zod_1.z.number().int(),
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    stage: common_js_1.growthStage.nullable(),
    preset: zod_1.z.string().nullable(),
    stageWeek: zod_1.z.number().int().nullable().describe('1 in the week the stage began; null before the first phase.'),
    deviceIds: zod_1.z
        .array((0, common_js_1.id)())
        .nullable()
        .describe('The controllers the averages were read from. Empty where nothing measures in the places the grow stood, which a card says rather than drawing dashes; null on a shared or public read, where the averages are the diary and the hardware behind them is not.'),
    climate: zod_1.z.array(exports.weekClimate),
    lightHours: zod_1.z.number().nullable().describe('Hours of light per day over the week, from the controller’s light output.'),
    days: zod_1.z.array(exports.growWeekDay).describe('Seven; a day that has not happened yet carries no picture.'),
    feeding: exports.growWeekFeeding.nullable().describe('Null for a grow that is fed no scheme.'),
    readings: zod_1.z.array(exports.growWeekReading),
    waterCount: zod_1.z.number().int(),
    feedCount: zod_1.z.number().int(),
    entries: zod_1.z.array(exports.entry).describe('The week’s diary lines, newest first, capped; `entryCount` is how many there are.'),
    entryCount: zod_1.z.number().int(),
    timelapseMediaId: (0, common_js_1.id)().nullable(),
}));
/**
 * The week cards, page by page, with everyone they name. A page carries
 * `people` for the same reason the home answer does - a card says who watered -
 * and one Mongo read answers it for the whole page.
 */
exports.growWeekCardPage = (0, common_js_1.named)('GrowWeekCardPage', (0, common_js_1.page)(exports.growWeekCard).extend({ people: zod_1.z.array(common_js_1.person) }));
/**
 * One stretch of the grow at one stage, as the report tells its story: a
 * chapter with its cover, its day range, how it was kept and what was done to
 * the plants in it.
 */
exports.growReportPhase = (0, common_js_1.named)('GrowReportPhase', zod_1.z.object({
    phaseId: (0, common_js_1.id)(),
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable(),
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    dayFrom: zod_1.z.number().int(),
    dayTo: zod_1.z.number().int().nullable().describe('Null while the phase is the one the grow is in, which is what "→ today" says.'),
    dayCount: zod_1.z.number().int(),
    spaceIds: zod_1.z
        .array((0, common_js_1.id)())
        .nullable()
        .describe('Where the plants stood during it, in the order they arrived; null on a shared or public read, which is told the story and not the address.'),
    coverMediaId: (0, common_js_1.id)().nullable().describe('The still nearest the middle of the phase, which is the chapter’s picture.'),
    climate: zod_1.z.array(exports.weekClimate),
    lightHours: zod_1.z
        .number()
        .nullable()
        .describe('Hours of light per day over the phase, from the controller’s light output, as a week card states it for its own seven days; null over a stretch too short or too quiet to say.'),
    inBandPercent: zod_1.z
        .number()
        .nullable()
        .describe('The share of the phase in which every metric with a target sat inside `TARGET_BAND`; null where nothing held a target.'),
    waterCount: zod_1.z.number().int(),
    feedCount: zod_1.z.number().int(),
    training: zod_1.z.array(exports.entry).describe('What was done to the plants in this phase, oldest first - "topped d18 · LST d20".'),
}));
/** Stripped from every shared view when the owner hides weights, which is what `null` says here. */
exports.growHarvest = (0, common_js_1.named)('GrowHarvest', zod_1.z.object({
    harvestedAt: (0, common_js_1.instant)().nullable(),
    wetWeightG: zod_1.z.number().nullable(),
    dryWeightG: zod_1.z.number().nullable(),
}));
exports.growTotals = (0, common_js_1.named)('GrowTotals', zod_1.z.object({
    entryCount: zod_1.z.number().int(),
    waterCount: zod_1.z.number().int(),
    feedCount: zod_1.z.number().int(),
    photoCount: zod_1.z.number().int().describe('Pictures the diary’s lines point at, of whatever kind those lines are; a diary kept before there was a photo tile carries them on its notes.'),
}));
/**
 * `GET /grows/{id}/report`, the Report tab: the grow told as chapters, one per
 * phase.
 *
 * It carries no week cards. The Report tab sits beside the Weeks tab, which
 * reads `GET /grows/{id}/weeks`, and a week costs a time-series query per
 * controller - a report that repeated them would make opening the second tab
 * cost the first one twice over. The public page, which shows both, is a read
 * model of its own and assembles them once.
 */
exports.growReport = (0, common_js_1.named)('GrowReport', zod_1.z.object({
    growId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    description: zod_1.z.string().nullable(),
    type: common_js_1.growType,
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    dayCount: zod_1.z.number().int(),
    plantCount: zod_1.z.number().int().nullable(),
    strains: zod_1.z.array(zod_1.z.string()),
    coverMediaId: (0, common_js_1.id)().nullable(),
    filmMediaId: (0, common_js_1.id)().nullable(),
    phases: zod_1.z.array(exports.growReportPhase).describe('Newest first, which is the order the chapters are read in.'),
    harvest: exports.growHarvest.nullable(),
    totals: exports.growTotals,
    people: zod_1.z.array(common_js_1.person).describe('Everyone the chapters name, so an entry can say who wrote it without another read.'),
}));
/**
 * One reading, as a chart draws it. Unlike a climate point, which summarises a
 * window and is null where the window held nothing, this is the reading itself:
 * it carries the plant it was taken on and the entry it was written in, so a
 * point on the chart leads back to what was logged.
 */
exports.growSeriesPoint = (0, common_js_1.named)('GrowSeriesPoint', zod_1.z.object({
    measuredAt: (0, common_js_1.instant)(),
    value: zod_1.z.number(),
    plantId: (0, common_js_1.id)().nullable().describe('Null for a reading about the grow rather than about one plant.'),
    entryId: (0, common_js_1.id)(),
}));
/** Every reading of one of the grow's own measurements, oldest first. */
exports.growMeasurementSeries = (0, common_js_1.named)('GrowMeasurementSeries', zod_1.z.object({
    key: zod_1.z.string().describe('Names one of the grow’s `measurements[]`, which is where its name, its unit and its target are.'),
    points: zod_1.z.array(exports.growSeriesPoint),
}));
/**
 * What the Charts view is asked for as a range: the four chips the Timeline tab
 * already has, and `custom` for two instants somebody picked, which is the one
 * range no chip can name.
 */
exports.growSeriesRange = (0, common_js_1.named)('GrowSeriesRange', zod_1.z.enum(['24h', '7d', 'phase', 'grow', 'custom']));
/**
 * `GET /grows/{id}/series`: every line the Charts view draws over one range, in
 * one answer, because a screen that asked for them separately would draw
 * windows that disagree at their edges.
 *
 * Three kinds of line, and they are apart here because they are not the same
 * kind of thing. `climate` and `outputs` are bucketed at `stepSeconds`, which
 * the range decides, and are the same panels and lanes the Timeline tab draws -
 * with the same band, so a client draws one the same way in both places.
 * `measurements` are events somebody wrote down and are answered as they were
 * taken, at no step at all.
 *
 * The third mode of the view - two grows plotted by day rather than by date -
 * is arithmetic on `originAt`, which is the instant day 1 began: nothing about
 * the answer changes, and two grows are two reads the client lays over each
 * other.
 */
exports.growSeries = (0, common_js_1.named)('GrowSeries', zod_1.z.object({
    growId: (0, common_js_1.id)(),
    range: exports.growSeriesRange,
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    stepSeconds: zod_1.z.number().int().describe('The window each climate and output point summarises; 0 where no device was read at all.'),
    originAt: (0, common_js_1.instant)().describe('The instant day 1 of this grow began, which is what day-of-grow counts from.'),
    dayFrom: zod_1.z.number().int().nullable(),
    dayTo: zod_1.z.number().int().nullable(),
    deviceIds: zod_1.z
        .array((0, common_js_1.id)())
        .nullable()
        .describe('The devices the climate and the outputs were read from: whatever stood where the grow stood. Null on a shared or public read: what a reader is shown is the tent, not the hardware in it.'),
    climate: zod_1.z.array(exports.timelinePanel),
    lastReadingAt: (0, common_js_1.instant)()
        .nullable()
        .describe('When a device standing where this grow stood last measured one of the climate metrics, whenever that was - which is the only thing that tells a window nothing was heard in apart from a place where nothing measures, since `climate` is empty in both. The Timeline of the tent answers the same question the same way. Answered only where `climate` is empty, because that is the one question it settles; null there where nothing standing with the grow has ever measured, and null beside curves that speak for themselves.'),
    outputs: zod_1.z.array(exports.timelineOutputLane),
    nights: zod_1.z.array(exports.timelineSpan).describe('When the light was off, which is what every panel is shaded by.'),
    measurements: zod_1.z.array(exports.growMeasurementSeries),
}));
/** Who a public page is by. A handle, a line of text and a picture - never a real name. */
exports.publicAuthor = (0, common_js_1.named)('PublicAuthor', zod_1.z.object({
    handle: zod_1.z.string(),
    bio: zod_1.z.string().nullable(),
    avatarMediaId: (0, common_js_1.id)().nullable(),
}));
/**
 * A public diary, whether it was reached by its slug or through a share link.
 *
 * `range` is the window the reader is allowed to see and every week and entry
 * below is already clamped to it; `includeCameras` says whether camera pictures
 * were part of it. Harvest weights and plant counts are already stripped when
 * the owner's privacy settings say so.
 */
exports.publicGrowPage = (0, common_js_1.named)('PublicGrowPage', zod_1.z.object({
    slug: zod_1.z.string(),
    growId: (0, common_js_1.id)()
        .nullable()
        .describe('The grow itself, which is what a reader follows. Only a diary at its own public address carries it - the same id its author’s profile already lists - and a link onto a diary that is not public carries none, because a link is a window and not a subscription.'),
    name: zod_1.z.string(),
    description: zod_1.z.string().nullable(),
    type: common_js_1.growType,
    author: exports.publicAuthor,
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    dayNumber: zod_1.z.number().int().nullable(),
    stage: common_js_1.growthStage.nullable(),
    preset: zod_1.z.string().nullable(),
    stageWeek: zod_1.z
        .number()
        .int()
        .nullable()
        .describe('Which week of the stage above the diary is in, counted against the grow’s own weeks exactly as the week cards below count them - the same figure `summary.stageWeek` answers the owner. It is here because it cannot be worked out from `dayNumber`: that gives the week of the whole grow, which is the week cards’ own heading and a different number entirely once a grow has changed stage. Null where the grow has entered no phase, and, like the day number and the stage, counted up to the end of the reader’s window rather than to today.'),
    plantCount: zod_1.z.number().int().nullable(),
    strains: zod_1.z.array(zod_1.z.string()),
    coverMediaId: (0, common_js_1.id)().nullable(),
    filmMediaId: (0, common_js_1.id)().nullable(),
    range: exports.timeRange,
    includeCameras: zod_1.z.boolean(),
    weeks: zod_1.z.array(exports.growWeekCard),
    weeksCursor: zod_1.z
        .string()
        .nullable()
        .describe('Pass as `cursor` to the weeks route of the same address for the weeks before these; null where the page holds them all.'),
    harvest: exports.growHarvest.nullable(),
    totals: exports.growTotals,
}));
/**
 * The weeks before the ones a public page carried, a page at a time.
 *
 * The first page of a long diary comes with the diary itself, because a reader
 * opens on it; the earlier ones are asked for because each of them costs a
 * time-series read per week, and a grow that ran a year would otherwise be a
 * page nobody waits for. It carries no `people`, unlike the owner's own weeks:
 * a stranger reads a diary by one author and is told nobody's name.
 */
exports.publicWeekPage = (0, common_js_1.named)('PublicWeekPage', (0, common_js_1.page)(exports.growWeekCard));
/**
 * `GET /public/users/{handle}`: the public diaries of one person. A public grow
 * is drawn the same way wherever it is listed, so these are the cards the home
 * screen already uses for the grows somebody follows. Nothing else about the
 * account is public.
 */
exports.publicUserPage = (0, common_js_1.named)('PublicUserPage', zod_1.z.object({
    author: exports.publicAuthor,
    grows: zod_1.z.array(exports.followedGrowCard),
}));
/** A link onto a grow answers the same page the grow's own public address does. */
exports.sharedGrow = (0, common_js_1.named)('SharedGrow', zod_1.z.object({ type: zod_1.z.literal('grow'), grow: exports.publicGrowPage }));
/**
 * A link onto a space answers its tent page, already clamped to the link's range
 * and stripped for a reader who is neither the owner nor a member - which is
 * what leaves the tasks and the alerts of such a page empty.
 */
exports.sharedSpace = (0, common_js_1.named)('SharedSpace', zod_1.z.object({ type: zod_1.z.literal('space'), space: exports.spaceOverview }));
exports.sharedSubject = (0, common_js_1.named)('SharedSubject', zod_1.z.discriminatedUnion('type', [exports.sharedGrow, exports.sharedSpace]));
/**
 * `GET /shared/{token}`: what the token leads to. Never the `ShareLink` itself -
 * the token is the reader's only proof, and the link's counters, its owner and
 * the rest of its settings are none of their business - so this answers the
 * window the reader is inside and the thing they came to look at.
 */
exports.sharedResolution = (0, common_js_1.named)('SharedResolution', zod_1.z.object({
    kind: common_js_1.shareKind,
    range: exports.timeRange,
    includeCameras: zod_1.z.boolean(),
    expiresAt: (0, common_js_1.instant)().nullable(),
    subject: exports.sharedSubject,
}));
/**
 * What the small HTML shell puts in its Open Graph tags and what `card.png` is
 * drawn from, so the two cannot say different things.
 */
exports.linkCard = (0, common_js_1.named)('LinkCard', zod_1.z.object({
    title: zod_1.z.string(),
    description: zod_1.z.string(),
    pageUrl: zod_1.z.string(),
    imageUrl: zod_1.z.string().describe('Absolute URL of the rendered card, for `og:image`.'),
    handle: zod_1.z.string().nullable(),
    dayNumber: zod_1.z.number().int().nullable(),
    stage: common_js_1.growthStage.nullable(),
}));
