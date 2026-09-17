"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_OUTPUT_METRIC = exports.FIELD_METRIC = exports.OUTPUT_METRIC_FIELD = exports.METRIC_FIELD = exports.outputMetric = exports.metric = exports.schemeWeek = exports.schemeAmount = exports.unitPreference = exports.volumeUnit = exports.weightUnit = exports.temperatureUnit = exports.growOrSpaceRef = exports.growOrSpaceType = exports.shareKind = exports.reminderKind = exports.growType = exports.spaceKind = exports.planStatus = exports.grantKind = exports.mediaKind = exports.cameraKind = exports.metricValue = exports.VALUE_AGE = exports.valueState = exports.socketRole = exports.planTransitionKind = exports.notificationChannel = exports.webhookMethod = exports.alertKind = exports.severity = exports.entrySource = exports.entryKind = exports.memberRole = exports.growthStage = exports.subjectRef = exports.problem = exports.problemError = exports.page = exports.bytes = exports.anyValue = exports.id = exports.instant = exports.named = exports.registry = void 0;
const zod_1 = require("zod");
/**
 * The base of the `/v1` wire contract: the registry, the scalar helpers, the
 * envelopes, and the enums and value objects more than one domain needs.
 *
 * `src/schemas.ts` beside this directory describes the API the Angular app
 * calls. It is not the same contract and not the same vocabulary, so nothing
 * here imports from it and the two registries stay separate: an id collision
 * between them would silently make one type overwrite the other in the
 * generated output.
 */
/** Named for the generated output: an entry's id becomes its exported type name. */
exports.registry = zod_1.z.registry();
/**
 * One id, one schema. The generator keys its output by id, so a second schema
 * registered under a name that is taken would replace the first without a word
 * and leave a type saying something nobody wrote.
 */
const takenIds = new Set();
const named = (id, schema) => {
    if (takenIds.has(id))
        throw new Error(`Two schemas are registered as '${id}'.`);
    takenIds.add(id);
    exports.registry.add(schema, { id });
    return schema;
};
exports.named = named;
/**
 * An instant on the wire.
 *
 * Unlike the legacy `wireDate`, which generates `Date` because the Angular app
 * is handed mongoose documents, this generates `string`: JSON is the contract
 * for `/v1`, and the server parses to a `Date` at its own boundary.
 *
 * Every instant is named `...At` or `...Until`, without exception.
 */
const instant = () => zod_1.z.iso.datetime();
exports.instant = instant;
/** Every resource has one, and every reference to one is `<resource>Id`. */
const id = () => zod_1.z.string().min(1);
exports.id = id;
/**
 * Presence, once, for the whole contract: a field that belongs to a resource is
 * always there, "none" is `null` and a list is `[]`. So absence is spelled
 * `.nullable()`, and `.optional()` is reserved for a field that a *request* body
 * may genuinely leave out.
 */
/** Deliberately unconstrained. `z.any()` alone would generate `unknown`. */
const anyValue = () => zod_1.z.any().meta({ tsType: 'any' });
exports.anyValue = anyValue;
/** Raw bytes. Only a firmware image carries them. */
const bytes = () => zod_1.z.custom().meta({ type: 'string', contentEncoding: 'base64', tsType: 'Buffer' });
exports.bytes = bytes;
/**
 * Every list answers this shape. Not registered itself - a domain file names the
 * page it returns (`named('GrowPage', page(grow))`), so the generator emits one
 * type per list rather than a generic the declaration file cannot express.
 */
const page = (item) => zod_1.z.object({
    items: zod_1.z.array(item),
    nextCursor: zod_1.z.string().nullable().describe('Pass back as `cursor` for the next page; null on the last one.'),
});
exports.page = page;
exports.problemError = (0, exports.named)('ProblemError', zod_1.z.object({
    field: zod_1.z.string().describe('Dotted path into the request body.'),
    code: zod_1.z.string(),
    detail: zod_1.z.string(),
}));
/** RFC 7807. Every error answer of `/v1` is one of these, as `application/problem+json`. */
exports.problem = (0, exports.named)('Problem', zod_1.z.object({
    status: zod_1.z.number().int(),
    code: zod_1.z.string().describe('Stable, machine-readable; what a client branches on.'),
    title: zod_1.z.string(),
    detail: zod_1.z.string(),
    errors: zod_1.z.array(exports.problemError).describe('Per-field validation failures; empty for every other error.'),
}));
/**
 * A reference to one of several kinds of resource, always as one object rather
 * than a row of fields of which exactly one is filled.
 */
const subjectRef = (type) => zod_1.z.object({ type, id: (0, exports.id)() });
exports.subjectRef = subjectRef;
/**
 * The six botanical stages. These cross the device protocol and the firmware's
 * own vocabulary, so the values are fixed and may not be renamed. What the
 * screens call "Late flower" is a climate preset on top of a stage, not a
 * seventh value.
 */
exports.growthStage = (0, exports.named)('GrowthStage', zod_1.z.enum(['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing']));
/** The owner is `spaces.ownerId` and never a membership row, so there is no `owner` role. */
exports.memberRole = (0, exports.named)('MemberRole', zod_1.z.enum(['can_log', 'can_manage']));
exports.entryKind = (0, exports.named)('EntryKind', zod_1.z.enum([
    'water',
    'feed',
    'photo',
    'note',
    'measurement',
    'training',
    'phase',
    'move',
    'harvest',
    'visit',
    'alarm',
    'plan',
    'system',
]));
/** Who put the entry in the timeline; a human's watering and a device's log line are both entries. */
exports.entrySource = (0, exports.named)('EntrySource', zod_1.z.enum(['human', 'device', 'plan', 'preset', 'alarm']));
exports.severity = (0, exports.named)('Severity', zod_1.z.enum(['critical', 'warning', 'info']));
/**
 * What raised the alert. `threshold` is a rule of its own, the other two are the
 * health loop: a device that stopped reporting and a camera that stopped
 * delivering stills, neither of which a reading can express.
 */
exports.alertKind = (0, exports.named)('AlertKind', zod_1.z.enum(['threshold', 'offline', 'camera_stale']));
/**
 * Shared by a person's own webhook channel and by an alarm rule's own delivery.
 * The values are HTTP's own and are spelled as HTTP spells them, which is the
 * one place this contract's `snake_case` enum rule gives way to a vocabulary it
 * does not own.
 */
exports.webhookMethod = (0, exports.named)('WebhookMethod', zod_1.z.enum(['GET', 'POST', 'PUT']));
/**
 * Where a message can go. Each is off until it is configured: `push` by a
 * subscription in `pushSubscriptions`, the other three by `NotificationChannels`.
 *
 * It is stated here rather than with the account because an alarm rule's own
 * delivery names two of these as well, and a person choosing where an alarm goes
 * must not be reading two vocabularies for the one question.
 */
exports.notificationChannel = (0, exports.named)('NotificationChannel', zod_1.z.enum(['email', 'push', 'telegram', 'webhook']));
/**
 * What can be asked of a running plan. Stated once: the plan routes take one of
 * these and the diary writes the one that caused a `plan` entry.
 */
exports.planTransitionKind = (0, exports.named)('PlanTransitionKind', zod_1.z.enum(['confirm', 'skip', 'extend', 'pause', 'resume']));
/**
 * What a smart socket drives. The first five are what deployed firmware already
 * knows; the rest arrive with the socket firmware change.
 *
 * The empty value is "unassigned": a socket that is paired but never driven.
 * A device is only ever sent a role it announced in `socket_roles`, so an old
 * build never sees one of the new ones.
 */
exports.socketRole = (0, exports.named)('SocketRole', zod_1.z.enum([
    '',
    'dehumidifier',
    'heater',
    'light',
    'secondary_light',
    'co2',
    'humidifier',
    'exhaust',
    'circulation',
    'fan',
    'pump',
    'custom_timer',
    'manual',
]));
/** How old a value is. Dimmed on the screens, never hidden. */
exports.valueState = (0, exports.named)('ValueState', zod_1.z.enum(['live', 'stale', 'offline']));
/**
 * The one place the ages are stated. The server decides `valueState` from these
 * and its own clock, so no client does the arithmetic.
 */
exports.VALUE_AGE = { liveSeconds: 120, staleSeconds: 600 };
/**
 * A measured value with its age. `state` is decided by the server from
 * `VALUE_AGE` and its own clock, so no client does the arithmetic; a value is
 * dimmed by its state, never hidden, which is why the value and its instant stay
 * in the answer when the device has been quiet for days.
 *
 * It sits here rather than with the device routes because the device reads and
 * the cards of the home and space screens answer the same triple, and one fact
 * described twice is how two vocabularies start.
 */
exports.metricValue = (0, exports.named)('MetricValue', zod_1.z.object({
    value: zod_1.z.number().nullable().describe('null when the device has never reported this metric.'),
    measuredAt: (0, exports.instant)().nullable(),
    state: exports.valueState,
}));
/**
 * `terpcam_controller` is the Terp Cam a controller pairs and answers for;
 * `terpcam_standalone` is one the cloud reaches itself; `rtsp` is any other
 * camera, pulled through the controller's tunnel.
 */
exports.cameraKind = (0, exports.named)('CameraKind', zod_1.z.enum(['terpcam_controller', 'terpcam_standalone', 'rtsp']));
exports.mediaKind = (0, exports.named)('MediaKind', zod_1.z.enum(['still', 'timelapse', 'photo', 'avatar']));
/**
 * Why a camera is entitled: `included` is the year a Terp Cam gets when it is
 * first claimed or paired, `migration` the year every camera that existed at the
 * migration got on migration day, `purchase` everything bought afterwards.
 */
exports.grantKind = (0, exports.named)('GrantKind', zod_1.z.enum(['included', 'migration', 'purchase']));
exports.planStatus = (0, exports.named)('PlanStatus', zod_1.z.enum(['running', 'paused', 'stopped', 'completed']));
/** `room` groups the others, one level deep; a grow needs no space at all. */
exports.spaceKind = (0, exports.named)('SpaceKind', zod_1.z.enum(['tent', 'fridge', 'room', 'balcony', 'other']));
exports.growType = (0, exports.named)('GrowType', zod_1.z.enum(['photoperiod', 'autoflower']));
exports.reminderKind = (0, exports.named)('ReminderKind', zod_1.z.enum(['water', 'feed', 'chore', 'custom']));
/** `view` is a link to the app's own read-only view; `public_page` is the shared diary page. */
exports.shareKind = (0, exports.named)('ShareKind', zod_1.z.enum(['view', 'public_page']));
/**
 * The two things a reminder, a derived task and a share link can each be about.
 * One enum, because the three answer the same question and a client that reads
 * two of them must not have to learn two vocabularies.
 */
exports.growOrSpaceType = (0, exports.named)('GrowOrSpaceType', zod_1.z.enum(['grow', 'space']));
/**
 * And the reference itself, named once. A reminder, a derived task and a share
 * link each point at a grow or a space, and all three say so with this object
 * rather than with a pair of ids of which one is filled.
 */
exports.growOrSpaceRef = (0, exports.named)('GrowOrSpaceRef', (0, exports.subjectRef)(exports.growOrSpaceType));
exports.temperatureUnit = (0, exports.named)('TemperatureUnit', zod_1.z.enum(['celsius', 'fahrenheit']));
exports.weightUnit = (0, exports.named)('WeightUnit', zod_1.z.enum(['grams', 'ounces']));
exports.volumeUnit = (0, exports.named)('VolumeUnit', zod_1.z.enum(['liters', 'gallons']));
/** Display only: everything is stored and served in the first value of each enum. */
exports.unitPreference = (0, exports.named)('UnitPreference', zod_1.z.object({ temperature: exports.temperatureUnit, weight: exports.weightUnit, volume: exports.volumeUnit }));
/**
 * A feeding grid, defined once: a person's own scheme and the effective grid a
 * grow carries are the same table, and only their origin differs.
 */
exports.schemeAmount = (0, exports.named)('SchemeAmount', zod_1.z.object({
    productKey: zod_1.z.string(),
    name: zod_1.z.string(),
    value: zod_1.z.number().nullable().describe('Null is "not this week".'),
    unit: zod_1.z.string().describe("The scheme's own unit, such as `ml/l`; never converted."),
}));
/** One row of the grid. */
exports.schemeWeek = (0, exports.named)('SchemeWeek', zod_1.z.object({
    week: zod_1.z.number().int().describe('1-based, counted from the start of the grow.'),
    stage: exports.growthStage.nullable(),
    amounts: zod_1.z.array(exports.schemeAmount),
}));
/**
 * The measurable series the API names.
 *
 * Values are `camelCase` rather than `snake_case` like every other enum here,
 * because a metric is also a key: it names a column in a chart definition and a
 * field in a `/live` answer, and those are `camelCase` throughout.
 *
 * `vpd` and `ppfd` are computed per device from temperature, humidity, leaf
 * temperature and lux with the device's own factors; `offline` is derived from
 * `devices.state.lastSeenAt` for the always-on alarm and the health loop.
 * Neither is stored, which is what a `null` field below says.
 */
exports.metric = (0, exports.named)('Metric', zod_1.z.enum(['temperature', 'humidity', 'co2', 'leafTemperature', 'lux', 'vpd', 'ppfd', 'offline']));
/** A controller's outputs, as a series. Their state is what the timeline draws under the climate charts. */
exports.outputMetric = (0, exports.named)('OutputMetric', zod_1.z.enum(['heater', 'dehumidifier', 'co2', 'light', 'fan', 'relais', 'fanInternal', 'fanExternal', 'fanBackwall']));
/**
 * The device's InfluxDB field names are frozen - they are written by firmware in
 * the field and by three years of stored points - so the translation lives here
 * and nowhere else. The device writes sensors under their bare name and outputs
 * with an `out_` prefix, three of them hyphenated.
 *
 * The remaining fields a device writes (`avg`, `p`, `i`, `d`, `rpm`, `day`,
 * `sensor_type`) are controller diagnostics that no screen asks for, so the API
 * names no metric for them; they keep being written and stay readable in Influx.
 */
exports.METRIC_FIELD = {
    temperature: 'temperature',
    humidity: 'humidity',
    co2: 'co2',
    leafTemperature: 'leaf_temperature',
    lux: 'lux',
    vpd: null,
    ppfd: null,
    offline: null,
};
exports.OUTPUT_METRIC_FIELD = {
    heater: 'out_heater',
    dehumidifier: 'out_dehumidifier',
    co2: 'out_co2',
    light: 'out_light',
    fan: 'out_fan',
    relais: 'out_relais',
    fanInternal: 'out_fan-internal',
    fanExternal: 'out_fan-external',
    fanBackwall: 'out_fan-backwall',
};
const byField = (fields) => {
    const map = {};
    for (const [name, field] of Object.entries(fields)) {
        if (field !== null)
            map[field] = name;
    }
    return map;
};
/** The other direction, for reading a point back out of Influx. Derived, so the two cannot drift. */
exports.FIELD_METRIC = byField(exports.METRIC_FIELD);
exports.FIELD_OUTPUT_METRIC = byField(exports.OUTPUT_METRIC_FIELD);
