import { z } from 'zod';

import {
  alertKind,
  anyValue,
  cameraKind,
  entryKind,
  entrySource,
  grantKind,
  growOrSpaceRef,
  growType,
  growthStage,
  id,
  instant,
  mediaKind,
  metric,
  metricValue,
  named,
  outputMetric,
  page,
  planTransitionKind,
  reminderKind,
  schemeAmount,
  schemeWeek,
  severity,
  shareKind,
  spaceKind,
} from './common.js';

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
export const entryReading = named(
  'EntryReading',
  z.object({
    key: z.string(),
    value: z.number(),
    plantId: id().nullable(),
  }),
);

/**
 * `values` is typed per kind and carries the entry's own `kind` again as its
 * discriminator, so that the object narrows on its own - a client that holds a
 * `values` narrows it without reaching back to the entry, and the server
 * validates the pair against each other.
 */
const plainValues = <K extends string>(kind: K) => z.object({ kind: z.literal(kind) });

const withReadings = <K extends string>(kind: K) =>
  z.object({ kind: z.literal(kind), readings: z.array(entryReading) });

/**
 * One dose of one product, as it was actually given.
 *
 * Absolute, not per litre: the grid says `2 ml/l` and this says the 8 ml that
 * went into the can. The scheme a grow carries can be edited afterwards and a
 * grow can be fed without a scheme at all, so a line that had to be read back
 * through a grid would change meaning or lose it entirely.
 */
export const entryDose = named(
  'EntryDose',
  z.object({
    productKey: z.string(),
    name: z.string(),
    amount: z.number(),
    unit: z.string().describe("The unit of `amount`, such as `ml`: the scheme's own `ml/l` with the per-litre taken off."),
  }),
);

/** Measurements of the grow's own definitions, whatever the entry is otherwise about. */
export const measurementEntryValues = named('MeasurementEntryValues', withReadings('measurement'));

/** Watering: how much water, and whatever was measured while pouring it. */
export const waterEntryValues = named(
  'WaterEntryValues',
  z.object({
    kind: z.literal('water'),
    litres: z.number().nullable(),
    readings: z.array(entryReading),
  }),
);

/**
 * Feeding: the water, the doses that went into it, and the readings taken with
 * it. `schemeWeek` records which row of the grid the doses came from, so the
 * line can say "week 5 of the scheme" without reading the grid again.
 */
export const feedEntryValues = named(
  'FeedEntryValues',
  z.object({
    kind: z.literal('feed'),
    litres: z.number().nullable(),
    schemeWeek: z.number().int().nullable().describe('The row of the grid the doses were read from; null when the grow feeds without a scheme.'),
    doses: z.array(entryDose),
    readings: z.array(entryReading),
  }),
);

/** The picture is in `mediaIds`, the words in `text`: neither needs a value of its own. */
export const photoEntryValues = named('PhotoEntryValues', plainValues('photo'));
export const noteEntryValues = named('NoteEntryValues', plainValues('note'));
export const trainingEntryValues = named('TrainingEntryValues', plainValues('training'));
export const visitEntryValues = named('VisitEntryValues', plainValues('visit'));

/** The device's `message-key:param` line is already parsed into `message`. */
export const systemEntryValues = named('SystemEntryValues', plainValues('system'));

/** The alert document holds the numbers and the life of the alarm; the entry points at it by `alertId`. */
export const alarmEntryValues = named('AlarmEntryValues', plainValues('alarm'));

/** Written by the one phase writer, so it repeats what the phase it appended says. */
export const phaseEntryValues = named(
  'PhaseEntryValues',
  z.object({
    kind: z.literal('phase'),
    phaseId: id(),
    stage: growthStage,
    preset: z.string().nullable().describe('The climate preset applied with the stage, such as `late_flowering`.'),
  }),
);

export const moveEntryValues = named(
  'MoveEntryValues',
  z.object({
    kind: z.literal('move'),
    placementId: id(),
    spaceId: id().nullable().describe('Where the plants moved to; null is "no fixed place".'),
  }),
);

/** Weights are the plant's; they are repeated here for the timeline and stripped from shared views with it. */
export const harvestEntryValues = named(
  'HarvestEntryValues',
  z.object({
    kind: z.literal('harvest'),
    wetWeightG: z.number().nullable(),
    dryWeightG: z.number().nullable(),
  }),
);

export const planEntryValues = named(
  'PlanEntryValues',
  z.object({
    kind: z.literal('plan'),
    planId: id(),
    stepIndex: z.number().int(),
    transition: planTransitionKind.nullable().describe('The transition that caused the entry; null when the engine simply moved on to the next step.'),
  }),
);

export const entryValues = named(
  'EntryValues',
  z.discriminatedUnion('kind', [
    waterEntryValues,
    feedEntryValues,
    measurementEntryValues,
    photoEntryValues,
    noteEntryValues,
    trainingEntryValues,
    visitEntryValues,
    systemEntryValues,
    alarmEntryValues,
    phaseEntryValues,
    moveEntryValues,
    harvestEntryValues,
    planEntryValues,
  ]),
);

/** A device's log line, parsed once on the way in. The keys are the webapp's `message-*` catalogue. */
export const entryMessage = named(
  'EntryMessage',
  z.object({
    key: z.string(),
    params: z.array(z.string()),
  }),
);

/**
 * One timeline. A human's watering, a device's log line and an alarm are all
 * entries, told apart by `kind` and `source`.
 *
 * Every reference is null when the entry is not about one: an entry exists
 * without a grow, without a space and without a device. `plantIds` empty means
 * the entry is about whatever it is attached to rather than about single plants.
 */
export const entry = named(
  'Entry',
  z.object({
    id: id(),
    createdAt: instant(),
    kind: entryKind,
    occurredAt: instant().describe('When the thing happened, which is not when it was written down.'),
    source: entrySource,
    authorId: id().nullable().describe('Null for what a device, the plan engine or an alarm wrote.'),
    growId: id().nullable(),
    spaceId: id().nullable(),
    deviceId: id().nullable(),
    plantIds: z.array(id()),
    cameraId: id().nullable(),
    taskId: id().nullable().describe('The derived task this entry completes; task ids are deterministic, not stored.'),
    alertId: id().nullable(),
    severity: severity.nullable(),
    text: z.string().nullable().describe('What a human wrote.'),
    message: entryMessage.nullable(),
    values: entryValues,
    mediaIds: z.array(id()),
    undoUntil: instant().nullable().describe('Until when the author may still take the entry back.'),
  }),
);

export const entryPage = named('EntryPage', page(entry));

/**
 * The kinds a person writes. Every other kind on the timeline belongs to the
 * route or the engine it is about - a phase to `POST /grows/{id}/phases`, a move
 * to a placement, a harvest to a harvest, an alarm to the alarm engine - so
 * writing one through the diary would be a second way to state the same fact.
 */
export const humanEntryKind = named(
  'HumanEntryKind',
  entryKind.extract(['water', 'feed', 'photo', 'note', 'measurement', 'training', 'visit']),
);

/**
 * What `POST /entries` takes for `values`: the same shapes with the parts the
 * server can work out left optional.
 *
 * "Log as planned" is a feed that names its water and nothing else - the doses
 * and the week they came from are resolved from the grow's grid at the moment
 * the feed happened, and stored resolved. A feed that names its own doses is
 * stored as given, because what went into the can is the fact.
 */
export const entryValuesDraft = named(
  'EntryValuesDraft',
  z.discriminatedUnion('kind', [
    waterEntryValues.partial({ litres: true, readings: true }),
    feedEntryValues.partial({ litres: true, schemeWeek: true, doses: true, readings: true }),
    measurementEntryValues.partial({ readings: true }),
    photoEntryValues,
    noteEntryValues,
    trainingEntryValues,
    visitEntryValues,
  ]),
);

/**
 * `POST /entries`. What the entry is about is the client's; who wrote it, when
 * it was written down, what raised it and how long it may still be taken back
 * are the server's, so none of those is asked for.
 *
 * Both `kind` and `values.kind` are given and have to agree. `values` narrows on
 * its own wherever it travels, and the server checks the pair against each other
 * rather than believing one of them.
 */
export const entryCreate = named(
  'EntryCreate',
  entry
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
    .extend({ kind: humanEntryKind, values: entryValuesDraft }),
);

/**
 * `PATCH /entries/{id}`: the same fields, each only if it changes. An entry's
 * `kind` is what the entry is and is not patched - correcting a reading is
 * `values`, whose own `kind` still has to be the entry's.
 */
export const entryUpdate = named('EntryUpdate', entryCreate.omit({ kind: true }).partial());

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** What a timelapse covers. `custom` is a range somebody asked the composer for. */
export const mediaWindow = named('MediaWindow', z.enum(['day', 'week', 'month', 'custom']));

/** A render's resolution. `hd` and whole-grow renders need entitlement; a free render carries a watermark. */
export const mediaQuality = named('MediaQuality', z.enum(['sd', 'hd']));

/** Only `queued` is a fact of the model; the rest is how far the hourly builder has got. */
export const mediaRenderStatus = named('MediaRenderStatus', z.enum(['queued', 'rendering', 'ready', 'failed']));

/**
 * A render job. What the picture is of - the camera, the range, the window, the
 * quality - is the media row's own, so this adds only what the composer needs
 * and how the job is going.
 */
export const mediaRender = named(
  'MediaRender',
  z.object({
    status: mediaRenderStatus,
    framesPerSecond: z.number().int(),
    watermark: z.boolean(),
    startedAt: instant().nullable(),
    endedAt: instant().nullable(),
    error: z.string().nullable(),
  }),
);

/**
 * A picture or a film. The bytes stay in the GridFS bucket, whose file id is
 * this resource's id, and are served by `GET /media/{id}/content`.
 *
 * A picture belongs to a camera, a grow or a space, never to a device.
 */
export const media = named(
  'Media',
  z.object({
    id: id(),
    createdAt: instant(),
    kind: mediaKind,
    mime: z.string(),
    bytes: z.number().int().describe('Size of the stored file.'),
    cameraId: id().nullable(),
    growId: id().nullable(),
    spaceId: id().nullable(),
    uploadedBy: id().nullable().describe('Null for what a camera delivered or the composer rendered.'),
    capturedAt: instant(),
    endsAt: instant().nullable().describe('The end of the span a film covers; null for a single picture.'),
    window: mediaWindow.nullable(),
    quality: mediaQuality.nullable(),
    lengthSeconds: z.number().int().nullable(),
    render: mediaRender.nullable(),
  }),
);

/**
 * `GET /cameras/{id}/frames` and `GET /cameras/{id}/timelapses` answer this, each
 * filtered to its kind: a frame is a `still` of that camera and a timelapse a
 * film built from them, and both are media rows like any other.
 */
export const mediaPage = named('MediaPage', page(media));

/**
 * Stills come from the camera pipeline and timelapses from the composer, so the
 * only kinds anybody uploads are a picture for the diary and an avatar.
 */
export const uploadMediaKind = named('UploadMediaKind', mediaKind.extract(['photo', 'avatar']));

/**
 * `POST /media`, beside the bytes in the multipart body. The mime type, the size
 * and who uploaded it are read off the upload and the session rather than asked
 * for. A photo usually reaches its grow through the entry that carries it;
 * `growId` and `spaceId` are for the picture that is uploaded on its own.
 */
export const mediaUpload = named(
  'MediaUpload',
  media.pick({ growId: true, spaceId: true, capturedAt: true }).partial().extend({ kind: uploadMediaKind }),
);

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

/** How an RTSP stream is pulled. Null on a Terp Cam, which is not RTSP at all. */
export const cameraTransport = named('CameraTransport', z.enum(['tcp', 'udp']));

/** A hint for the URL template a stream was built from, never how it is read. */
export const cameraModel = named('CameraModel', z.enum(['terp_cam', 'tapo_c200', 'reolink', 'hikvision', 'custom']));

/** `free` is what an install with `PREMIUM_ENFORCED` unset never sees, because nothing is gated then. */
export const entitlementTier = named('EntitlementTier', z.enum(['free', 'premium']));

/**
 * Twelve months per camera, never renewed by this server: the admin route is the
 * only writer. `tier` is derived from `validUntil` and the install's
 * enforcement, and `renewalVisible` says whether the screen offers to extend,
 * so neither the client nor this server needs a billing system to draw it.
 */
export const cameraEntitlement = named(
  'CameraEntitlement',
  z.object({
    validUntil: instant().nullable(),
    grant: grantKind.nullable(),
    tier: entitlementTier,
    renewalVisible: z.boolean(),
  }),
);

/**
 * `PUT /admin/cameras/{id}/entitlement`, which is the only writer of one:
 * nothing renews on its own in this server. `tier` and `renewalVisible` are read
 * from `validUntil` and the install's configuration every time a camera is
 * serialised, so they are answered and never written.
 */
export const cameraEntitlementUpdate = named(
  'CameraEntitlementUpdate',
  cameraEntitlement.pick({ validUntil: true, grant: true }),
);

export const cameraState = named(
  'CameraState',
  z.object({
    lastStillAt: instant().nullable(),
    lastError: z.string().nullable(),
    firmwareVersion: z.string().nullable(),
  }),
);

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
export const camera = named(
  'Camera',
  z.object({
    id: id(),
    createdAt: instant(),
    ownerId: id(),
    kind: cameraKind,
    deviceId: id().nullable().describe('The controller that answers for this camera; null for one the cloud reaches itself.'),
    spaceId: id().nullable(),
    name: z.string(),
    looksAt: z.string().nullable().describe('What it is pointed at, as a label beside the picture.'),
    plantIds: z.array(id()),
    did: z.string().nullable().describe('A Terp Cam’s P2P device id.'),
    uid: z.string().nullable(),
    ip: z.string().nullable().describe('Last address on the local network, as the controller reported it.'),
    url: z.string().nullable().describe('The stream URL with its credentials removed.'),
    transport: cameraTransport.nullable(),
    tunnel: z.boolean().describe('Pull the stream through the controller’s tunnel rather than reaching it directly.'),
    model: cameraModel.nullable(),
    stillIntervalSeconds: z.number().int(),
    nightOff: z.boolean(),
    maintenanceOff: z.boolean(),
    logErrors: z.boolean(),
    entitlement: cameraEntitlement,
    isDemo: z.boolean(),
    removedAt: instant().nullable().describe('A removed camera is a tombstone, so its pictures keep their link.'),
    state: cameraState,
  }),
);

export const cameraPage = named('CameraPage', page(camera));

/**
 * What every camera is given whatever kind it is: where it stands, what it is
 * called, what it is pointed at and how often it takes a picture. Deliberately
 * not registered - it is the base the three create bodies are built from, and no
 * route ever accepts or answers it on its own.
 */
const cameraSettings = camera
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
const rtspStream = camera.pick({ transport: true, tunnel: true, model: true }).partial();

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
export const controllerCameraCreate = named(
  'ControllerCameraCreate',
  cameraSettings.extend({
    kind: z.literal('terpcam_controller'),
    deviceId: id(),
  }),
);

/**
 * A Terp Cam the cloud reaches itself, addressed by the P2P id printed on it.
 * The model and the server-side path exist; the tab that would pair one says it
 * is coming, because the flow is unproven against a camera on a desk.
 */
export const standaloneCameraCreate = named(
  'StandaloneCameraCreate',
  cameraSettings.extend({
    kind: z.literal('terpcam_standalone'),
    did: z.string(),
  }),
);

/**
 * Any other camera, by the address of its stream. Creating one is never refused:
 * whether the address answers is found out by the first capture, not here.
 *
 * `url` carries the credentials the stream is opened with, which is why it is
 * spelled out rather than picked off `Camera`: the resource answers the same URL
 * with them stripped, so the two fields do not mean the same thing.
 */
export const rtspCameraCreate = named(
  'RtspCameraCreate',
  cameraSettings.extend(rtspStream.shape).extend({
    kind: z.literal('rtsp'),
    deviceId: id()
      .nullable()
      .optional()
      .describe('The controller whose tunnel the stream is pulled through; absent or null is one the cloud reaches itself.'),
    url: z.string().describe('The whole stream URL, credentials included.'),
  }),
);

export const cameraCreate = named(
  'CameraCreate',
  z.discriminatedUnion('kind', [controllerCameraCreate, standaloneCameraCreate, rtspCameraCreate]),
);

/**
 * `PATCH /cameras/{id}`: everything a camera is given at creation except what
 * says which camera it is. Its kind, its controller and its P2P id are what it
 * is; a camera that is not RTSP simply never carries the stream fields.
 */
export const cameraUpdate = named('CameraUpdate', rtspCameraCreate.omit({ kind: true, deviceId: true }).partial());

/**
 * What `POST /cameras/{id}/test-captures` answers: one picture, taken now, so
 * that whoever is setting a camera up learns whether it answers at all. The
 * picture is stored like any other still, which is why only its id comes back.
 *
 * A camera that could not be read is reported here rather than as an error,
 * because a wrong address is an ordinary outcome of this button and the reason
 * the camera gave is what the person needs to see.
 */
export const testCaptureAnswer = named(
  'TestCaptureAnswer',
  z.object({
    succeeded: z.boolean(),
    mediaId: id().nullable(),
    capturedAt: instant().nullable(),
    error: z.string().nullable(),
  }),
);

/**
 * `POST /cameras/{id}/timelapses`. `window` says which span is meant: `day`,
 * `week` and `month` are worked out around `startsAt`, and `custom` is the only
 * one that reads both ends.
 */
export const timelapseCreate = named(
  'TimelapseCreate',
  z.object({
    window: mediaWindow,
    startsAt: instant().optional().describe('Defaults to the most recent complete window.'),
    endsAt: instant().optional().describe('Only `custom` reads it.'),
    quality: mediaQuality.optional(),
    framesPerSecond: z.number().int().optional(),
  }),
);

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
export const timelapseAccepted = named(
  'TimelapseAccepted',
  z.object({
    media: media,
    queued: z.boolean(),
  }),
);

// ---------------------------------------------------------------------------
// Feeding schemes
// ---------------------------------------------------------------------------

/** Which shipped asset a scheme was made from, and at which version of it. */
export const schemeOrigin = named(
  'SchemeOrigin',
  z.object({
    assetId: z.string().nullable(),
    version: z.string().nullable(),
  }),
);

/**
 * A person's own feeding scheme. The grid is the same table a grow carries, so
 * that editing a scheme here and reading it back off a grow speak one language;
 * a grow keeps its own copy, which is what leaves its history alone when this
 * one is edited later.
 */
export const scheme = named(
  'Scheme',
  z.object({
    id: id(),
    createdAt: instant(),
    ownerId: id(),
    name: z.string(),
    origin: schemeOrigin,
    grid: z.array(schemeWeek),
  }),
);

export const schemePage = named('SchemePage', page(scheme));

/**
 * `POST /schemes`. `origin` is left out by somebody writing a scheme of their
 * own and filled in by a client that started from a shipped asset, which is the
 * only way the server learns of one: it never reads an asset itself.
 */
export const schemeCreate = named(
  'SchemeCreate',
  scheme.pick({ name: true, origin: true, grid: true }).partial({ origin: true }),
);

/** `PATCH /schemes/{id}`: the same fields, each only if it changes. */
export const schemeUpdate = named('SchemeUpdate', schemeCreate.partial());

// ---------------------------------------------------------------------------
// Chart views
// ---------------------------------------------------------------------------

/**
 * A span. Either end may be open, which is what `null` says; a share link's
 * range and a saved chart view both use it.
 */
export const timeRange = named(
  'TimeRange',
  z.object({
    startsAt: instant().nullable(),
    endsAt: instant().nullable(),
  }),
);

/**
 * What a saved chart draws, structured rather than the query string the old app
 * saved. A view is either a fixed `range` or the last `forSeconds`, never both.
 */
export const chartViewDefinition = named(
  'ChartViewDefinition',
  z.object({
    deviceIds: z.array(id()),
    growId: id().nullable(),
    metrics: z.array(metric),
    outputs: z.array(outputMetric),
    range: timeRange.nullable(),
    forSeconds: z.number().int().nullable(),
    intervalSeconds: z.number().int().describe('Width of one bucket, which is what decides how many points come back.'),
  }),
);

export const chartView = named(
  'ChartView',
  z.object({
    id: id(),
    createdAt: instant(),
    ownerId: id(),
    name: z.string(),
    definition: chartViewDefinition,
  }),
);

export const chartViewPage = named('ChartViewPage', page(chartView));

/** `POST /chart-views`. A view is its name and what it draws; nothing else is stored. */
export const chartViewCreate = named('ChartViewCreate', chartView.pick({ name: true, definition: true }));

/** `PATCH /chart-views/{id}`: the same two, each only if it changes. */
export const chartViewUpdate = named('ChartViewUpdate', chartViewCreate.partial());

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export const shareLinkState = named(
  'ShareLinkState',
  z.object({
    openCount: z.number().int(),
    lastOpenedAt: instant().nullable(),
  }),
);

/**
 * `token` is the secret the link is opened with and is separate from `id`, so
 * that a link can be listed, patched and revoked by an id that is not a secret.
 * It is on the wire for whoever may manage the link, because sharing the link is
 * the point of it; what is read *through* the link never carries it.
 *
 * Every read through a link is clamped to `range`.
 */
export const shareLink = named(
  'ShareLink',
  z.object({
    id: id(),
    createdAt: instant(),
    token: z.string(),
    kind: shareKind,
    subject: growOrSpaceRef,
    range: timeRange,
    includeCameras: z.boolean().describe('Camera pictures are only ever visible through a link that includes them.'),
    createdBy: id(),
    expiresAt: instant().nullable(),
    revokedAt: instant().nullable(),
    state: shareLinkState,
  }),
);

export const shareLinkPage = named('ShareLinkPage', page(shareLink));

/**
 * `POST /share-links`. The token, the counters and who made the link are the
 * server's. A `range` with an open end is a link that keeps up with a grow as it
 * goes on, which is what sharing a running diary means.
 */
export const shareLinkCreate = named(
  'ShareLinkCreate',
  shareLink
    .pick({ kind: true, subject: true, range: true, includeCameras: true, expiresAt: true })
    .partial({ range: true, includeCameras: true, expiresAt: true }),
);

/**
 * `PATCH /share-links/{id}`: what may still be changed once a link is out of the
 * house. Not `kind` and not `subject`: the address is in somebody else's hands,
 * and repointing it would show them something they were never sent. Narrowing
 * the range or taking the cameras back out is what this is for; ending the link
 * altogether is `PUT /share-links/{id}/revocation`.
 */
export const shareLinkUpdate = named('ShareLinkUpdate', shareLinkCreate.omit({ kind: true, subject: true }).partial());

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * One migration that has run. The record is what makes a migration run once and
 * what an operator reads afterwards, so `stats` keeps whatever the migration
 * counted - rows moved, rows skipped - and is not typed here: every migration
 * counts something else.
 */
export const migration = named(
  'Migration',
  z.object({
    id: id(),
    createdAt: instant(),
    name: z.string().describe('Unique; it is what says the migration has already run.'),
    appliedAt: instant(),
    durationMs: z.number().int(),
    stats: z.record(z.string(), z.number()),
  }),
);

export const migrationPage = named('MigrationPage', page(migration));

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
export const cardValue = named('CardValue', z.object({ metric: metric, ...metricValue.shape }));

/**
 * What the controller is aiming at right now, for the metrics it steers, and
 * how far a reading may stray from it and still count as on target. The band is
 * `TARGET_BAND` stated on the wire, so the figure beside a value and the
 * verdict's "in band" are judged by the same width and no client keeps a width
 * of its own.
 */
export const cardSetpoint = named(
  'CardSetpoint',
  z.object({
    metric: metric,
    value: z.number().nullable(),
    band: z.number().nullable().describe('Half the width of the band around the target; null for a metric that has none.'),
  }),
);

/** The newest picture of a space, as a card shows it. */
export const latestStill = named(
  'LatestStill',
  z.object({
    mediaId: id(),
    cameraId: id(),
    capturedAt: instant(),
  }),
);

/**
 * A day of one metric, the size of a stamp: what a card draws beside its figures
 * to say "steady" or "not". It rides on the card rather than being fetched per
 * card, so a club's home is one request however many places it has.
 */
export const cardTrend = named(
  'CardTrend',
  z.object({
    metric: metric,
    stepSeconds: z.number().int(),
    endsAt: instant(),
    points: z.array(z.number().nullable()).describe('One figure per window, oldest first; null where the window holds no sample.'),
  }),
);

/**
 * A task as a card lists it. Tasks are derived from reminders, the scheme grid
 * and the plan rather than stored, and their ids are deterministic - which is
 * how completing one, an entry carrying that `taskId`, keeps it from coming back.
 *
 * What it is about is the same reference `Task` carries, so a card and the task
 * list say it one way.
 */
export const dueTask = named(
  'DueTask',
  z.object({
    id: id(),
    kind: reminderKind,
    label: z.string(),
    dueAt: instant(),
    subject: growOrSpaceRef,
    assigneeId: id().nullable(),
  }),
);

/** An alert as a card lists it; `GET /alerts` answers the alert itself. */
export const openAlert = named(
  'OpenAlert',
  z.object({
    alertId: id(),
    kind: alertKind,
    severity: severity,
    startedAt: instant(),
    value: z.number().nullable(),
    metric: metric.nullable().describe('What the rule watches, so "78 % RH" can be said; null for an alert raised without a rule.'),
  }),
);

/** One group of a split, as a card counts it: `GrowSummary.groups` names the plants instead. */
export const growCardStageGroup = named(
  'GrowCardStageGroup',
  z.object({
    stage: growthStage,
    plantCount: z.number().int().nullable().describe('Null where the owner hides counts.'),
  }),
);

/**
 * The grow as a card draws it: the day counter, the phase headline and the "auto"
 * tag, all computed from `phases[]` in the grow serialiser. `stageGroups` is
 * filled only when the plants are not all in the same phase, which is what a
 * split leaves behind.
 */
export const growCard = named(
  'GrowCard',
  z.object({
    growId: id(),
    name: z.string(),
    type: growType,
    dayNumber: z.number().int().nullable(),
    phaseDay: z.number().int().nullable().describe('How many days the grow has stood in its current phase.'),
    stage: growthStage.nullable(),
    preset: z.string().nullable(),
    isAuto: z.boolean().describe('The phase was set by a preset or the plan rather than by a person.'),
    plantCount: z.number().int().nullable().describe('Null where the owner hides counts.'),
    strains: z.array(z.string()).describe('Each strain once, in the order it was planted.'),
    coverMediaId: id().nullable(),
    stageGroups: z.array(growCardStageGroup),
  }),
);

/** One space, with everything the home screen shows about it. */
export const homeSpaceCard = named(
  'HomeSpaceCard',
  z.object({
    spaceId: id(),
    name: z.string(),
    kind: spaceKind,
    roomId: id().nullable(),
    deviceIds: z.array(id()),
    values: z.array(cardValue),
    setpoints: z.array(cardSetpoint),
    trend: cardTrend.nullable().describe('The last 24 hours of temperature, from the first device in the space that has any.'),
    grow: growCard.nullable(),
    entries: z.array(entry).describe('The grow’s newest entries, newest first.'),
    latestStill: latestStill.nullable(),
    dueTasks: z.array(dueTask),
    openAlerts: z.array(openAlert),
  }),
);

/** A grow somebody follows: a public grow, so only what its public page shows. */
export const followedGrowCard = named(
  'FollowedGrowCard',
  z.object({
    growId: id(),
    slug: z.string(),
    name: z.string(),
    handle: z.string().describe('The owner’s handle, the only name others ever see.'),
    dayNumber: z.number().int().nullable(),
    stage: growthStage.nullable(),
    coverMediaId: id().nullable(),
    updatedAt: instant(),
  }),
);

/** Somebody a card names: the author of an entry, the assignee of a task. */
export const person = named('Person', z.object({ id: id(), handle: z.string() }));

export const homeAnswer = named(
  'HomeAnswer',
  z.object({
    spaces: z.array(homeSpaceCard),
    followedGrows: z.array(followedGrowCard),
    people: z.array(person).describe('Everyone the cards name, so a card can say who wrote an entry without another read.'),
  }),
);

export const verdictRating = named('VerdictRating', z.enum(['good', 'watch', 'poor']));

/** A target widened by `TARGET_BAND`: what a chart shades green and a verdict counts time inside. */
export const targetBand = named('TargetBand', z.object({ low: z.number(), high: z.number() }));

/**
 * One run outside the band, which is what "1 humidity excursion 02:10–05:30"
 * names. `endedAt` is null for a run that was still going when the window
 * ended - it has not ended, and saying so is not the same as ending it now.
 */
export const climateExcursion = named(
  'ClimateExcursion',
  z.object({
    startedAt: instant(),
    endedAt: instant().nullable(),
    above: z.boolean().describe('Which edge it left over: true is above the band.'),
    extremeValue: z.number().nullable().describe('The furthest the reading got while it was out.'),
  }),
);

/**
 * How one metric did over the window, against the band its target sets. Day and
 * night are told apart by the light output and each half is judged against its
 * own band, which is why both are answered.
 *
 * The two counts are over the windows that held a reading: a device that was
 * quiet adds to neither, so together they are the time that is known about
 * rather than always the whole window.
 */
export const climateVerdictMetric = named(
  'ClimateVerdictMetric',
  z.object({
    metric: metric,
    rating: verdictRating.nullable().describe('Null where nothing here holds a target for this metric, so there is no band to judge it against.'),
    minValue: z.number().nullable(),
    maxValue: z.number().nullable(),
    averageValue: z.number().nullable(),
    dayBand: targetBand.nullable(),
    nightBand: targetBand.nullable().describe('Null where the metric is not steered in that half at all: CO2 is only raised while the light is on.'),
    inBandSeconds: z.number().int(),
    outOfBandSeconds: z.number().int(),
    excursions: z.array(climateExcursion).describe('In the order they happened; empty where the metric has no band.'),
  }),
);

/**
 * How often one output came on over the window, which is what "dehumidifier ran
 * 14×" counts. A run is one reading showing it on after one showed it off, so an
 * output stays what it was last reported to be across the windows that hold no
 * reading, and a device that reported nothing about an output at all has no row
 * here rather than a row of zeroes.
 */
export const actuatorRuns = named(
  'ActuatorRuns',
  z.object({
    output: outputMetric,
    runCount: z.number().int(),
    forSeconds: z.number().int().describe('How long it was on altogether, over the windows that held a reading.'),
  }),
);

/**
 * The 24 h verdict, from one aggregation over the window: the share of the time
 * inside the band, the runs that left it, and how often each actuator came on.
 *
 * `rating` is the worst of the metrics, which is what the headline says.
 * `stepSeconds` is the resolution the whole of it is stated at - an excursion
 * shorter than one window, and an actuator that switched twice inside one, are
 * not in the points that were read.
 */
export const climateVerdict = named(
  'ClimateVerdict',
  z.object({
    deviceId: id().nullable().describe('The device the window was read from; null in a space that has none.'),
    startsAt: instant(),
    endsAt: instant(),
    forSeconds: z.number().int(),
    stepSeconds: z.number().int(),
    rating: verdictRating.nullable(),
    inBandFraction: z
      .number()
      .nullable()
      .describe('0 to 1 over every metric that has a band, of the time that was measured; the "91 % in band" of the headline. Null when nothing here is steered.'),
    metrics: z.array(climateVerdictMetric),
    actuators: z.array(actuatorRuns),
    trend: cardTrend.nullable().describe('The same window as a line, coarsened; it comes out of the aggregation that was read anyway.'),
  }),
);

/** One picture of a camera, as the day's strip draws it: the camera is the row it sits in. */
export const cameraStill = named('CameraStill', z.object({ mediaId: id(), capturedAt: instant() }));

/** A camera of the space and the day it has taken so far. */
export const overviewCamera = named(
  'OverviewCamera',
  z.object({
    cameraId: id(),
    name: z.string(),
    lastStillAt: instant().nullable(),
    stills: z
      .array(cameraStill)
      .describe("Today's, oldest first and at most one per slot of the day, so the strip spans the day rather than its last few minutes."),
  }),
);

/**
 * A grow standing in this space. The card the home draws, and what is true of it
 * *here*: a grow moves between tents, so the day it arrived is not the day it
 * started.
 */
export const overviewGrow = named(
  'OverviewGrow',
  growCard.extend({
    weekNumber: z.number().int().nullable().describe("Counted like the day counter, so it lines up with the feeding scheme's grid."),
    placedAt: instant(),
    placedOnDay: z
      .number()
      .int()
      .nullable()
      .describe('The grow’s own day counter on the day these plants arrived here, which is what "here since day 22" says.'),
  }),
);

/**
 * A due task with what its completion would be written with, so the Done button
 * on the card needs nothing else read and can say what it is about to log.
 * `POST /tasks/{id}/completions` takes these same values, and a completion that
 * names none takes them from the task.
 */
export const overviewTask = named(
  'OverviewTask',
  dueTask.extend({ defaults: anyValue().describe('Prefilled entry values for the completion; null when the task prefills nothing.') }),
);

/**
 * What the space's controller is aiming at in both halves of the cycle.
 * `SpaceOverview.setpoints` is the half it is in right now, which is what a
 * value is drawn against; this is the pair the header states, and the bands the
 * verdict judges against are these widened by `TARGET_BAND`.
 */
export const overviewTargets = named(
  'OverviewTargets',
  z.object({
    day: z.array(cardSetpoint),
    night: z.array(cardSetpoint),
  }),
);

/**
 * `GET /spaces/{id}/overview`, the tent page's landing tab: what is true here
 * now, what needs a human, what grows here, what the cameras saw today, how the
 * last 24 hours went and what was last written.
 *
 * It is the home card of that space with the four things a page has room for
 * that a card does not - the verdict, the day's pictures, every grow rather
 * than the headline one, and enough of a due task to tick it off.
 */
export const spaceOverview = named(
  'SpaceOverview',
  z.object({
    spaceId: id(),
    name: z.string(),
    kind: spaceKind,
    roomId: id().nullable(),
    deviceIds: z.array(id()),
    values: z.array(cardValue),
    setpoints: z.array(cardSetpoint),
    targets: overviewTargets.nullable().describe('Null in a space whose devices hold no targets at all.'),
    verdict: climateVerdict,
    grows: z.array(overviewGrow).describe('Every grow with open plants here, newest first.'),
    cameras: z.array(overviewCamera),
    entries: z.array(entry).describe('The newest lines of this space and of the grows standing in it, newest first.'),
    dueTasks: z.array(overviewTask),
    openAlerts: z.array(openAlert),
    people: z.array(person).describe('Everyone the answer names, so an entry can say who wrote it without another read.'),
  }),
);

/** One device's newest values, as the space screen redraws them. */
export const spaceLiveDevice = named(
  'SpaceLiveDevice',
  z.object({
    deviceId: id(),
    values: z.array(cardValue),
    setpoints: z.array(cardSetpoint),
  }),
);

/**
 * When one camera of the space last delivered. A camera that has gone quiet is
 * dimmed like a value is, but against its own `stillIntervalSeconds` rather than
 * against `VALUE_AGE`, so the instant is answered and the state is not.
 */
export const spaceLiveCamera = named(
  'SpaceLiveCamera',
  z.object({
    cameraId: id(),
    lastStillAt: instant().nullable(),
  }),
);

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
export const spaceLive = named(
  'SpaceLive',
  z.object({
    spaceId: id(),
    values: z.array(cardValue),
    setpoints: z.array(cardSetpoint),
    devices: z.array(spaceLiveDevice),
    cameras: z.array(spaceLiveCamera),
  }),
);

/**
 * One metric aggregated over a stretch of a grow, which is one time-series query
 * per stretch and controller.
 *
 * Day and night are the controller's own cycle rather than hours of the clock:
 * they are told apart by its light output, so a device that drives no light -
 * a fridge drying, a tent lit from a socket nobody told the server about -
 * answers `averageValue` and neither half.
 */
export const weekClimate = named(
  'WeekClimate',
  z.object({
    metric: metric,
    minValue: z.number().nullable(),
    maxValue: z.number().nullable(),
    averageValue: z.number().nullable(),
    dayAverage: z.number().nullable().describe('The mean over the windows in which the light was on.'),
    nightAverage: z.number().nullable(),
  }),
);

/**
 * One of the seven thumbnails a week card is drawn with: the still taken
 * nearest a fixed hour of that day, so the strip reads as one picture a day
 * rather than as whatever the camera last sent. Null where no camera was
 * watching, which is what leaves a slot empty.
 */
export const growWeekDay = named(
  'GrowWeekDay',
  z.object({
    dayNumber: z.number().int(),
    startsAt: instant(),
    mediaId: id().nullable(),
    cameraId: id().nullable(),
    capturedAt: instant().nullable(),
  }),
);

/**
 * What the scheme says to feed this week, and how many feeds the week is
 * supposed to have. `amounts` is the grid's row for this week with the grow's
 * own strength already applied, so nobody multiplies it twice; how many of them
 * were done is the card's `feedCount`.
 *
 * No screen has a control for the rhythm, so `plannedCount` is read from the
 * grow's feed reminder, else its water reminder, else three.
 */
export const growWeekFeeding = named(
  'GrowWeekFeeding',
  z.object({
    amounts: z.array(schemeAmount),
    plannedCount: z.number().int(),
  }),
);

/**
 * Where one of the grow's own measurements stood at the end of the week, and by
 * how much it moved - "Height · 58 cm · +6". `change` is against the newest
 * reading before this week began and is null when there was none.
 *
 * `key` names a definition in the grow's `measurements[]`, which is where its
 * name, its unit and its target are; nothing about the measurement is copied
 * onto the reading.
 */
export const growWeekReading = named(
  'GrowWeekReading',
  z.object({
    key: z.string(),
    value: z.number(),
    change: z.number().nullable(),
    measuredAt: instant(),
  }),
);

/**
 * A week of a grow, which is what the grow page is made of. `weekNumber` counts
 * from the first phase, like the day counter, so it lines up with the feeding
 * scheme's grid, and `dayFrom`/`dayTo` are the same count in days - always
 * seven of them, because "day 29-35" is what the week is of; `endsAt` is where
 * the week stops, which for the week a grow is in is now.
 *
 * `stageWeek` is which week of the current stage this is, so "Flower wk 2" can
 * be drawn from the card alone: the public page carries these cards without the
 * grow's phases beside them.
 */
export const growWeekCard = named(
  'GrowWeekCard',
  z.object({
    weekNumber: z.number().int(),
    dayFrom: z.number().int(),
    dayTo: z.number().int(),
    startsAt: instant(),
    endsAt: instant(),
    stage: growthStage.nullable(),
    preset: z.string().nullable(),
    stageWeek: z.number().int().nullable().describe('1 in the week the stage began; null before the first phase.'),
    deviceIds: z
      .array(id())
      .describe('The controllers the averages were read from. Empty where nothing measures in the places the grow stood, which a card says rather than drawing dashes.'),
    climate: z.array(weekClimate),
    lightHours: z.number().nullable().describe('Hours of light per day over the week, from the controller’s light output.'),
    days: z.array(growWeekDay).describe('Seven; a day that has not happened yet carries no picture.'),
    feeding: growWeekFeeding.nullable().describe('Null for a grow that is fed no scheme.'),
    readings: z.array(growWeekReading),
    waterCount: z.number().int(),
    feedCount: z.number().int(),
    entries: z.array(entry).describe('The week’s diary lines, newest first, capped; `entryCount` is how many there are.'),
    entryCount: z.number().int(),
    timelapseMediaId: id().nullable(),
  }),
);

/**
 * The week cards, page by page, with everyone they name. A page carries
 * `people` for the same reason the home answer does - a card says who watered -
 * and one Mongo read answers it for the whole page.
 */
export const growWeekCardPage = named('GrowWeekCardPage', page(growWeekCard).extend({ people: z.array(person) }));

/**
 * One stretch of the grow at one stage, as the report tells its story: a
 * chapter with its cover, its day range, how it was kept and what was done to
 * the plants in it.
 */
export const growReportPhase = named(
  'GrowReportPhase',
  z.object({
    phaseId: id(),
    stage: growthStage,
    preset: z.string().nullable(),
    startedAt: instant(),
    endedAt: instant().nullable(),
    dayFrom: z.number().int(),
    dayTo: z.number().int().nullable().describe('Null while the phase is the one the grow is in, which is what "→ today" says.'),
    dayCount: z.number().int(),
    spaceIds: z.array(id()).describe('Where the plants stood during it, in the order they arrived.'),
    coverMediaId: id().nullable().describe('The still nearest the middle of the phase, which is the chapter’s picture.'),
    climate: z.array(weekClimate),
    inBandPercent: z
      .number()
      .nullable()
      .describe('The share of the phase in which every metric with a target sat inside `TARGET_BAND`; null where nothing held a target.'),
    waterCount: z.number().int(),
    feedCount: z.number().int(),
    training: z.array(entry).describe('What was done to the plants in this phase, oldest first - "topped d18 · LST d20".'),
  }),
);

/** Stripped from every shared view when the owner hides weights, which is what `null` says here. */
export const growHarvest = named(
  'GrowHarvest',
  z.object({
    harvestedAt: instant().nullable(),
    wetWeightG: z.number().nullable(),
    dryWeightG: z.number().nullable(),
  }),
);

export const growTotals = named(
  'GrowTotals',
  z.object({
    entryCount: z.number().int(),
    waterCount: z.number().int(),
    feedCount: z.number().int(),
    photoCount: z.number().int(),
  }),
);

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
export const growReport = named(
  'GrowReport',
  z.object({
    growId: id(),
    name: z.string(),
    description: z.string().nullable(),
    type: growType,
    startedAt: instant(),
    endedAt: instant().nullable(),
    dayCount: z.number().int(),
    plantCount: z.number().int().nullable(),
    strains: z.array(z.string()),
    coverMediaId: id().nullable(),
    filmMediaId: id().nullable(),
    phases: z.array(growReportPhase).describe('Newest first, which is the order the chapters are read in.'),
    harvest: growHarvest.nullable(),
    totals: growTotals,
    people: z.array(person).describe('Everyone the chapters name, so an entry can say who wrote it without another read.'),
  }),
);

/**
 * One reading, as a chart draws it. Unlike a climate point, which summarises a
 * window and is null where the window held nothing, this is the reading itself:
 * it carries the plant it was taken on and the entry it was written in, so a
 * point on the chart leads back to what was logged.
 */
export const growSeriesPoint = named(
  'GrowSeriesPoint',
  z.object({
    measuredAt: instant(),
    value: z.number(),
    plantId: id().nullable().describe('Null for a reading about the grow rather than about one plant.'),
    entryId: id(),
  }),
);

/** Every reading of one of the grow's own measurements, oldest first. */
export const growMeasurementSeries = named(
  'GrowMeasurementSeries',
  z.object({
    key: z.string().describe('Names one of the grow’s `measurements[]`, which is where its name, its unit and its target are.'),
    points: z.array(growSeriesPoint),
  }),
);

/**
 * `GET /grows/{id}/series`: what this grow measures beyond climate, which is the
 * readings its entries carry, keyed by its own definitions.
 *
 * The range is answered back because the server may have clamped it. There is
 * no step: readings are events somebody wrote down, so they are answered as they
 * were taken rather than bucketed the way a climate series has to be.
 */
export const growSeries = named(
  'GrowSeries',
  z.object({
    growId: id(),
    startsAt: instant(),
    endsAt: instant(),
    series: z.array(growMeasurementSeries),
  }),
);

/** Who a public page is by. A handle, a line of text and a picture - never a real name. */
export const publicAuthor = named(
  'PublicAuthor',
  z.object({
    handle: z.string(),
    bio: z.string().nullable(),
    avatarMediaId: id().nullable(),
  }),
);

/**
 * A public diary, whether it was reached by its slug or through a share link.
 *
 * `range` is the window the reader is allowed to see and every week and entry
 * below is already clamped to it; `includeCameras` says whether camera pictures
 * were part of it. Harvest weights and plant counts are already stripped when
 * the owner's privacy settings say so.
 */
export const publicGrowPage = named(
  'PublicGrowPage',
  z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    type: growType,
    author: publicAuthor,
    startedAt: instant(),
    endedAt: instant().nullable(),
    dayNumber: z.number().int().nullable(),
    stage: growthStage.nullable(),
    preset: z.string().nullable(),
    plantCount: z.number().int().nullable(),
    strains: z.array(z.string()),
    coverMediaId: id().nullable(),
    filmMediaId: id().nullable(),
    range: timeRange,
    includeCameras: z.boolean(),
    weeks: z.array(growWeekCard),
    harvest: growHarvest.nullable(),
    totals: growTotals,
  }),
);

/**
 * `GET /public/users/{handle}`: the public diaries of one person. A public grow
 * is drawn the same way wherever it is listed, so these are the cards the home
 * screen already uses for the grows somebody follows. Nothing else about the
 * account is public.
 */
export const publicUserPage = named(
  'PublicUserPage',
  z.object({
    author: publicAuthor,
    grows: z.array(followedGrowCard),
  }),
);

/** A link onto a grow answers the same page the grow's own public address does. */
export const sharedGrow = named('SharedGrow', z.object({ type: z.literal('grow'), grow: publicGrowPage }));

/**
 * A link onto a space answers its tent page, already clamped to the link's range
 * and stripped for a reader who is neither the owner nor a member - which is
 * what leaves the tasks and the alerts of such a page empty.
 */
export const sharedSpace = named('SharedSpace', z.object({ type: z.literal('space'), space: spaceOverview }));

export const sharedSubject = named('SharedSubject', z.discriminatedUnion('type', [sharedGrow, sharedSpace]));

/**
 * `GET /shared/{token}`: what the token leads to. Never the `ShareLink` itself -
 * the token is the reader's only proof, and the link's counters, its owner and
 * the rest of its settings are none of their business - so this answers the
 * window the reader is inside and the thing they came to look at.
 */
export const sharedResolution = named(
  'SharedResolution',
  z.object({
    kind: shareKind,
    range: timeRange,
    includeCameras: z.boolean(),
    expiresAt: instant().nullable(),
    subject: sharedSubject,
  }),
);

/**
 * What the small HTML shell puts in its Open Graph tags and what `card.png` is
 * drawn from, so the two cannot say different things.
 */
export const linkCard = named(
  'LinkCard',
  z.object({
    title: z.string(),
    description: z.string(),
    pageUrl: z.string(),
    imageUrl: z.string().describe('Absolute URL of the rendered card, for `og:image`.'),
    handle: z.string().nullable(),
    dayNumber: z.number().int().nullable(),
    stage: growthStage.nullable(),
  }),
);
