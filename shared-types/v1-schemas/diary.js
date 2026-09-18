"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeRange = exports.schemeUpdate = exports.schemeCreate = exports.schemePage = exports.scheme = exports.schemeOrigin = exports.timelapseAccepted = exports.timelapseCreate = exports.testCaptureAnswer = exports.cameraUpdate = exports.cameraCreate = exports.rtspCameraCreate = exports.standaloneCameraCreate = exports.controllerCameraCreate = exports.cameraPage = exports.camera = exports.cameraState = exports.cameraEntitlementUpdate = exports.cameraEntitlement = exports.entitlementTier = exports.cameraModel = exports.cameraTransport = exports.mediaUpload = exports.uploadMediaKind = exports.mediaPage = exports.media = exports.mediaRender = exports.mediaRenderStatus = exports.mediaQuality = exports.mediaWindow = exports.entryUpdate = exports.entryCreate = exports.entryPage = exports.entry = exports.entryMessage = exports.entryValues = exports.planEntryValues = exports.harvestEntryValues = exports.moveEntryValues = exports.phaseEntryValues = exports.alarmEntryValues = exports.systemEntryValues = exports.visitEntryValues = exports.trainingEntryValues = exports.noteEntryValues = exports.photoEntryValues = exports.measurementEntryValues = exports.feedEntryValues = exports.waterEntryValues = exports.entryReading = void 0;
exports.linkCard = exports.sharedResolution = exports.sharedSubject = exports.sharedSpace = exports.sharedGrow = exports.publicUserPage = exports.publicGrowPage = exports.publicAuthor = exports.growSeries = exports.growMeasurementSeries = exports.growSeriesPoint = exports.growReport = exports.growTotals = exports.growHarvest = exports.growReportPhase = exports.growWeekCardPage = exports.growWeekCard = exports.weekClimate = exports.spaceLive = exports.spaceLiveCamera = exports.spaceLiveDevice = exports.spaceOverview = exports.climateVerdict = exports.climateVerdictMetric = exports.verdictRating = exports.homeAnswer = exports.person = exports.followedGrowCard = exports.homeSpaceCard = exports.growCard = exports.growCardStageGroup = exports.openAlert = exports.dueTask = exports.cardTrend = exports.latestStill = exports.cardSetpoint = exports.cardValue = exports.migrationPage = exports.migration = exports.shareLinkUpdate = exports.shareLinkCreate = exports.shareLinkPage = exports.shareLink = exports.shareLinkState = exports.chartViewUpdate = exports.chartViewCreate = exports.chartViewPage = exports.chartView = exports.chartViewDefinition = void 0;
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
 * `values` is typed per kind and carries the entry's own `kind` again as its
 * discriminator, so that the object narrows on its own - a client that holds a
 * `values` narrows it without reaching back to the entry, and the server
 * validates the pair against each other.
 */
const plainValues = (kind) => zod_1.z.object({ kind: zod_1.z.literal(kind) });
const withReadings = (kind) => zod_1.z.object({ kind: zod_1.z.literal(kind), readings: zod_1.z.array(exports.entryReading) });
/** Water, feed and measurement differ in what they mean, not in what they record. */
exports.waterEntryValues = (0, common_js_1.named)('WaterEntryValues', withReadings('water'));
exports.feedEntryValues = (0, common_js_1.named)('FeedEntryValues', withReadings('feed'));
exports.measurementEntryValues = (0, common_js_1.named)('MeasurementEntryValues', withReadings('measurement'));
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
    authorId: (0, common_js_1.id)().nullable().describe('Null for what a device, the plan engine or an alarm wrote.'),
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
    kind: true,
    occurredAt: true,
    growId: true,
    spaceId: true,
    deviceId: true,
    plantIds: true,
    cameraId: true,
    taskId: true,
    text: true,
    values: true,
    mediaIds: true,
})
    .partial({
    occurredAt: true,
    growId: true,
    spaceId: true,
    deviceId: true,
    plantIds: true,
    cameraId: true,
    taskId: true,
    text: true,
    mediaIds: true,
}));
/**
 * `PATCH /entries/{id}`: the same fields, each only if it changes. An entry's
 * `kind` is what the entry is and is not patched - correcting a reading is
 * `values`, whose own `kind` still has to be the entry's.
 */
exports.entryUpdate = (0, common_js_1.named)('EntryUpdate', exports.entryCreate.omit({ kind: true }).partial());
// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
/** What a timelapse covers. `custom` is a range somebody asked the composer for. */
exports.mediaWindow = (0, common_js_1.named)('MediaWindow', zod_1.z.enum(['day', 'week', 'month', 'custom']));
/** A render's resolution. `hd` and whole-grow renders need entitlement; a free render carries a watermark. */
exports.mediaQuality = (0, common_js_1.named)('MediaQuality', zod_1.z.enum(['sd', 'hd']));
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
    spaceId: (0, common_js_1.id)().nullable(),
    uploadedBy: (0, common_js_1.id)().nullable().describe('Null for what a camera delivered or the composer rendered.'),
    capturedAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)().nullable().describe('The end of the span a film covers; null for a single picture.'),
    window: exports.mediaWindow.nullable(),
    quality: exports.mediaQuality.nullable(),
    lengthSeconds: zod_1.z.number().int().nullable(),
    render: exports.mediaRender.nullable(),
}));
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
    ownerId: (0, common_js_1.id)(),
    kind: common_js_1.cameraKind,
    deviceId: (0, common_js_1.id)().nullable().describe('The controller that answers for this camera; null for one the cloud reaches itself.'),
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
    entitlement: exports.cameraEntitlement,
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
})
    .partial({
    spaceId: true,
    looksAt: true,
    plantIds: true,
    stillIntervalSeconds: true,
    nightOff: true,
    maintenanceOff: true,
    logErrors: true,
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
 * says which camera it is. Its kind, its controller and its P2P id are what it
 * is; a camera that is not RTSP simply never carries the stream fields.
 */
exports.cameraUpdate = (0, common_js_1.named)('CameraUpdate', exports.rtspCameraCreate.omit({ kind: true, deviceId: true }).partial());
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
 * `POST /cameras/{id}/timelapses`. `window` says which span is meant: `day`,
 * `week` and `month` are worked out around `startsAt`, and `custom` is the only
 * one that reads both ends.
 */
exports.timelapseCreate = (0, common_js_1.named)('TimelapseCreate', zod_1.z.object({
    window: exports.mediaWindow,
    startsAt: (0, common_js_1.instant)().optional().describe('Defaults to the most recent complete window.'),
    endsAt: (0, common_js_1.instant)().optional().describe('Only `custom` reads it.'),
    quality: exports.mediaQuality.optional(),
    framesPerSecond: zod_1.z.number().int().optional(),
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
 * What a saved chart draws, structured rather than the query string the old app
 * saved. A view is either a fixed `range` or the last `forSeconds`, never both.
 */
exports.chartViewDefinition = (0, common_js_1.named)('ChartViewDefinition', zod_1.z.object({
    deviceIds: zod_1.z.array((0, common_js_1.id)()),
    growId: (0, common_js_1.id)().nullable(),
    metrics: zod_1.z.array(common_js_1.metric),
    outputs: zod_1.z.array(common_js_1.outputMetric),
    range: exports.timeRange.nullable(),
    forSeconds: zod_1.z.number().int().nullable(),
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
 * and repointing it would show them something they were never sent. Narrowing
 * the range or taking the cameras back out is what this is for; ending the link
 * altogether is `PUT /share-links/{id}/revocation`.
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
/** What the controller is aiming at right now, for the metrics it steers. */
exports.cardSetpoint = (0, common_js_1.named)('CardSetpoint', zod_1.z.object({
    metric: common_js_1.metric,
    value: zod_1.z.number().nullable(),
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
    metric: common_js_1.metric.nullable().describe('What the rule watches, so "78 % RH" can be said; null for an alert raised without a rule.'),
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
    stage: common_js_1.growthStage.nullable(),
    preset: zod_1.z.string().nullable(),
    isAuto: zod_1.z.boolean().describe('The phase was set by a preset or the plan rather than by a person.'),
    plantCount: zod_1.z.number().int().nullable().describe('Null where the owner hides counts.'),
    strains: zod_1.z.array(zod_1.z.string()).describe('Each strain once, in the order it was planted.'),
    coverMediaId: (0, common_js_1.id)().nullable(),
    stageGroups: zod_1.z.array(exports.growCardStageGroup),
}));
/** One space, with everything the home screen shows about it. */
exports.homeSpaceCard = (0, common_js_1.named)('HomeSpaceCard', zod_1.z.object({
    spaceId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    kind: common_js_1.spaceKind,
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
    coverMediaId: (0, common_js_1.id)().nullable(),
    updatedAt: (0, common_js_1.instant)(),
}));
/** Somebody a card names: the author of an entry, the assignee of a task. */
exports.person = (0, common_js_1.named)('Person', zod_1.z.object({ id: (0, common_js_1.id)(), handle: zod_1.z.string() }));
exports.homeAnswer = (0, common_js_1.named)('HomeAnswer', zod_1.z.object({
    spaces: zod_1.z.array(exports.homeSpaceCard),
    followedGrows: zod_1.z.array(exports.followedGrowCard),
    people: zod_1.z.array(exports.person).describe('Everyone the cards name, so a card can say who wrote an entry without another read.'),
}));
exports.verdictRating = (0, common_js_1.named)('VerdictRating', zod_1.z.enum(['good', 'watch', 'poor']));
/** How one metric did over the window, against the band the phase's targets set. */
exports.climateVerdictMetric = (0, common_js_1.named)('ClimateVerdictMetric', zod_1.z.object({
    metric: common_js_1.metric,
    rating: exports.verdictRating,
    minValue: zod_1.z.number().nullable(),
    maxValue: zod_1.z.number().nullable(),
    averageValue: zod_1.z.number().nullable(),
    targetLow: zod_1.z.number().nullable(),
    targetHigh: zod_1.z.number().nullable(),
    outOfBandSeconds: zod_1.z.number().int(),
}));
/** The 24 h verdict. `rating` is the worst of the metrics, which is what the headline says. */
exports.climateVerdict = (0, common_js_1.named)('ClimateVerdict', zod_1.z.object({
    forSeconds: zod_1.z.number().int(),
    rating: exports.verdictRating,
    metrics: zod_1.z.array(exports.climateVerdictMetric),
}));
/** The tent page: the home card of that space, plus its verdict and its cameras. */
exports.spaceOverview = (0, common_js_1.named)('SpaceOverview', zod_1.z.object({
    spaceId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    kind: common_js_1.spaceKind,
    roomId: (0, common_js_1.id)().nullable(),
    deviceIds: zod_1.z.array((0, common_js_1.id)()),
    cameraIds: zod_1.z.array((0, common_js_1.id)()),
    values: zod_1.z.array(exports.cardValue),
    setpoints: zod_1.z.array(exports.cardSetpoint),
    verdict: exports.climateVerdict,
    grow: exports.growCard.nullable(),
    entries: zod_1.z.array(exports.entry),
    latestStill: exports.latestStill.nullable(),
    dueTasks: zod_1.z.array(exports.dueTask),
    openAlerts: zod_1.z.array(exports.openAlert),
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
/** One metric aggregated over a week, which is one aggregate per week and controller. */
exports.weekClimate = (0, common_js_1.named)('WeekClimate', zod_1.z.object({
    metric: common_js_1.metric,
    minValue: zod_1.z.number().nullable(),
    maxValue: zod_1.z.number().nullable(),
    averageValue: zod_1.z.number().nullable(),
}));
/**
 * A week of a grow. `weekNumber` counts from the first phase, like the day
 * counter, so it lines up with the feeding scheme's grid.
 */
exports.growWeekCard = (0, common_js_1.named)('GrowWeekCard', zod_1.z.object({
    weekNumber: zod_1.z.number().int(),
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    stage: common_js_1.growthStage.nullable(),
    preset: zod_1.z.string().nullable(),
    climate: zod_1.z.array(exports.weekClimate),
    waterCount: zod_1.z.number().int(),
    feedCount: zod_1.z.number().int(),
    entries: zod_1.z.array(exports.entry),
    mediaIds: zod_1.z.array((0, common_js_1.id)()),
    timelapseMediaId: (0, common_js_1.id)().nullable(),
}));
exports.growWeekCardPage = (0, common_js_1.named)('GrowWeekCardPage', (0, common_js_1.page)(exports.growWeekCard));
/** One stretch of the grow at one stage, as the report tells its story. */
exports.growReportPhase = (0, common_js_1.named)('GrowReportPhase', zod_1.z.object({
    phaseId: (0, common_js_1.id)(),
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable(),
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    dayCount: zod_1.z.number().int(),
    climate: zod_1.z.array(exports.weekClimate),
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
    photoCount: zod_1.z.number().int(),
}));
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
    phases: zod_1.z.array(exports.growReportPhase),
    weeks: zod_1.z.array(exports.growWeekCard),
    harvest: exports.growHarvest.nullable(),
    totals: exports.growTotals,
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
 * `GET /grows/{id}/series`: what this grow measures beyond climate, which is the
 * readings its entries carry, keyed by its own definitions.
 *
 * The range is answered back because the server may have clamped it. There is
 * no step: readings are events somebody wrote down, so they are answered as they
 * were taken rather than bucketed the way a climate series has to be.
 */
exports.growSeries = (0, common_js_1.named)('GrowSeries', zod_1.z.object({
    growId: (0, common_js_1.id)(),
    startsAt: (0, common_js_1.instant)(),
    endsAt: (0, common_js_1.instant)(),
    series: zod_1.z.array(exports.growMeasurementSeries),
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
    name: zod_1.z.string(),
    description: zod_1.z.string().nullable(),
    type: common_js_1.growType,
    author: exports.publicAuthor,
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    dayNumber: zod_1.z.number().int().nullable(),
    stage: common_js_1.growthStage.nullable(),
    preset: zod_1.z.string().nullable(),
    plantCount: zod_1.z.number().int().nullable(),
    strains: zod_1.z.array(zod_1.z.string()),
    coverMediaId: (0, common_js_1.id)().nullable(),
    filmMediaId: (0, common_js_1.id)().nullable(),
    range: exports.timeRange,
    includeCameras: zod_1.z.boolean(),
    weeks: zod_1.z.array(exports.growWeekCard),
    harvest: exports.growHarvest.nullable(),
    totals: exports.growTotals,
}));
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
