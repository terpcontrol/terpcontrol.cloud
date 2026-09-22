import { z } from 'zod';

/**
 * The base of the `/v1` wire contract: the registry, the scalar helpers, the
 * envelopes, and the enums and value objects more than one domain needs.
 */

/** Named for the generated output: an entry's id becomes its exported type name. */
export const registry = z.registry<{ id: string }>();

/**
 * One id, one schema. The generator keys its output by id, so a second schema
 * registered under a name that is taken would replace the first without a word
 * and leave a type saying something nobody wrote.
 */
const takenIds = new Set<string>();

export const named = <T extends z.ZodType>(id: string, schema: T): T => {
  if (takenIds.has(id)) throw new Error(`Two schemas are registered as '${id}'.`);
  takenIds.add(id);
  registry.add(schema, { id });
  return schema;
};

/**
 * An instant on the wire, as a string: JSON is the contract, and the server
 * parses to a `Date` at its own boundary rather than handing one out.
 *
 * Every instant is named `...At` or `...Until`, without exception.
 */
export const instant = () => z.iso.datetime();

/** Every resource has one, and every reference to one is `<resource>Id`. */
export const id = () => z.string().min(1);

/**
 * Presence, once, for the whole contract: a field that belongs to a resource is
 * always there, "none" is `null` and a list is `[]`. So absence is spelled
 * `.nullable()`, and `.optional()` is reserved for a field that a *request* body
 * may genuinely leave out.
 */

/** Deliberately unconstrained. `z.any()` alone would generate `unknown`. */
export const anyValue = () => z.any().meta({ tsType: 'any' });

/** Raw bytes. Only a firmware image carries them. */
export const bytes = () => z.custom<Buffer>().meta({ type: 'string', contentEncoding: 'base64', tsType: 'Buffer' });

/**
 * Every list answers this shape. Not registered itself - a domain file names the
 * page it returns (`named('GrowPage', page(grow))`), so the generator emits one
 * type per list rather than a generic the declaration file cannot express.
 */
export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().describe('Pass back as `cursor` for the next page; null on the last one.'),
  });

export const problemError = named(
  'ProblemError',
  z.object({
    field: z.string().describe('Dotted path into the request body.'),
    code: z.string(),
    detail: z.string(),
  }),
);

/** RFC 7807. Every error answer of `/v1` is one of these, as `application/problem+json`. */
export const problem = named(
  'Problem',
  z.object({
    status: z.number().int(),
    code: z.string().describe('Stable, machine-readable; what a client branches on.'),
    title: z.string(),
    detail: z.string(),
    errors: z.array(problemError).describe('Per-field validation failures; empty for every other error.'),
  }),
);

/**
 * A reference to one of several kinds of resource, always as one object rather
 * than a row of fields of which exactly one is filled.
 */
export const subjectRef = <T extends z.ZodType>(type: T) => z.object({ type, id: id() });

/**
 * The six botanical stages. These cross the device protocol and the firmware's
 * own vocabulary, so the values are fixed and may not be renamed. What the
 * screens call "Late flower" is a climate preset on top of a stage, not a
 * seventh value.
 */
export const growthStage = named('GrowthStage', z.enum(['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing']));

/** The owner is `spaces.ownerId` and never a membership row, so there is no `owner` role. */
export const memberRole = named('MemberRole', z.enum(['can_log', 'can_manage']));

export const entryKind = named(
  'EntryKind',
  z.enum([
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
  ]),
);

/** Who put the entry in the timeline; a human's watering and a device's log line are both entries. */
export const entrySource = named('EntrySource', z.enum(['human', 'device', 'plan', 'preset', 'alarm']));

export const severity = named('Severity', z.enum(['critical', 'warning', 'info']));

/**
 * What raised the alert. `threshold` is a rule of its own, the other two are the
 * health loop: a device that stopped reporting and a camera that stopped
 * delivering stills, neither of which a reading can express.
 */
export const alertKind = named('AlertKind', z.enum(['threshold', 'offline', 'camera_stale']));

/**
 * Shared by a person's own webhook channel and by an alarm rule's own delivery.
 * The values are HTTP's own and are spelled as HTTP spells them, which is the
 * one place this contract's `snake_case` enum rule gives way to a vocabulary it
 * does not own.
 */
export const webhookMethod = named('WebhookMethod', z.enum(['GET', 'POST', 'PUT']));

/**
 * Where a message can go. Each is off until it is configured: `push` by a
 * subscription in `pushSubscriptions`, the other three by `NotificationChannels`.
 *
 * It is stated here rather than with the account because an alarm rule's own
 * delivery names two of these as well, and a person choosing where an alarm goes
 * must not be reading two vocabularies for the one question.
 */
export const notificationChannel = named('NotificationChannel', z.enum(['email', 'push', 'telegram', 'webhook']));

/**
 * What can be asked of a running plan. Stated once: the plan routes take one of
 * these and the diary writes the one that caused a `plan` entry.
 */
export const planTransitionKind = named('PlanTransitionKind', z.enum(['confirm', 'skip', 'extend', 'pause', 'resume']));

/**
 * What a smart socket drives. The first five are what deployed firmware already
 * knows; the rest arrive with the socket firmware change.
 *
 * The empty value is "unassigned": a socket that is paired but never driven.
 * A device is only ever sent a role it announced in `socket_roles`, so an old
 * build never sees one of the new ones.
 */
export const socketRole = named(
  'SocketRole',
  z.enum([
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
  ]),
);

/** How old a value is. Dimmed on the screens, never hidden. */
export const valueState = named('ValueState', z.enum(['live', 'stale', 'offline']));

// Stated in a module of its own, which carries no schema, so that a client can
// import the seconds without zod coming with them; re-exported here because
// this is where the rest of the contract reaches for it.
export { VALUE_AGE } from './value-age.js';

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
export const metricValue = named(
  'MetricValue',
  z.object({
    value: z.number().nullable().describe('null when the device has never reported this metric.'),
    measuredAt: instant().nullable(),
    state: valueState,
  }),
);

/**
 * One window of a series. `value` is null where the window holds no reading, so
 * a chart draws the gap instead of joining across it; a computed metric that
 * cannot be worked out for a window arrives the same way.
 *
 * It sits here rather than with the device routes because a device's series and
 * the panels of the timeline are the same points read over different windows.
 */
export const seriesPoint = named('SeriesPoint', z.object({ measuredAt: instant(), value: z.number().nullable() }));

/**
 * `terpcam_controller` is the Terp Cam a controller pairs and answers for;
 * `terpcam_standalone` is one the cloud reaches itself; `rtsp` is any other
 * camera, pulled through the controller's tunnel.
 */
export const cameraKind = named('CameraKind', z.enum(['terpcam_controller', 'terpcam_standalone', 'rtsp']));

/**
 * `export` is the odd one: a zip rather than a picture. It is a media row all
 * the same, because the bucket, the route that serves bytes and the sweep that
 * removes what nothing points at are exactly what an export wants, and a
 * collection of its own would be all three written a second time.
 */
export const mediaKind = named('MediaKind', z.enum(['still', 'timelapse', 'photo', 'avatar', 'export']));

/**
 * Why a camera is entitled: `included` is the year a Terp Cam gets when it is
 * first claimed or paired, `migration` the year every camera that existed at the
 * migration got on migration day, `purchase` everything bought afterwards.
 */
export const grantKind = named('GrantKind', z.enum(['included', 'migration', 'purchase']));

export const planStatus = named('PlanStatus', z.enum(['running', 'paused', 'stopped', 'completed']));

/** `room` groups the others, one level deep; a grow needs no space at all. */
export const spaceKind = named('SpaceKind', z.enum(['tent', 'fridge', 'room', 'balcony', 'other']));

export const growType = named('GrowType', z.enum(['photoperiod', 'autoflower']));

export const reminderKind = named('ReminderKind', z.enum(['water', 'feed', 'chore', 'custom']));

/** `view` is a link to the app's own read-only view; `public_page` is the shared diary page. */
export const shareKind = named('ShareKind', z.enum(['view', 'public_page']));

/**
 * The two things a reminder, a derived task and a share link can each be about.
 * One enum, because the three answer the same question and a client that reads
 * two of them must not have to learn two vocabularies.
 */
export const growOrSpaceType = named('GrowOrSpaceType', z.enum(['grow', 'space']));

/**
 * And the reference itself, named once. A reminder, a derived task and a share
 * link each point at a grow or a space, and all three say so with this object
 * rather than with a pair of ids of which one is filled.
 */
export const growOrSpaceRef = named('GrowOrSpaceRef', subjectRef(growOrSpaceType));

export const temperatureUnit = named('TemperatureUnit', z.enum(['celsius', 'fahrenheit']));
export const weightUnit = named('WeightUnit', z.enum(['grams', 'ounces']));
export const volumeUnit = named('VolumeUnit', z.enum(['liters', 'gallons']));

/** Display only: everything is stored and served in the first value of each enum. */
export const unitPreference = named(
  'UnitPreference',
  z.object({ temperature: temperatureUnit, weight: weightUnit, volume: volumeUnit }),
);

/**
 * A feeding grid, defined once: a person's own scheme and the effective grid a
 * grow carries are the same table, and only their origin differs.
 */
export const schemeAmount = named(
  'SchemeAmount',
  z.object({
    productKey: z.string(),
    name: z.string(),
    value: z.number().nullable().describe('Null is "not this week".'),
    unit: z.string().describe("The scheme's own unit, such as `ml/l`; never converted."),
  }),
);

/** One row of the grid. */
export const schemeWeek = named(
  'SchemeWeek',
  z.object({
    week: z.number().int().describe('1-based, counted from the start of the grow.'),
    stage: growthStage.nullable(),
    amounts: z.array(schemeAmount),
  }),
);

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
export const metric = named('Metric', z.enum(['temperature', 'humidity', 'co2', 'leafTemperature', 'lux', 'vpd', 'ppfd', 'offline']));

/** A controller's outputs, as a series. Their state is what the timeline draws under the climate charts. */
export const outputMetric = named(
  'OutputMetric',
  z.enum(['heater', 'dehumidifier', 'co2', 'light', 'fan', 'relais', 'fanInternal', 'fanExternal', 'fanBackwall']),
);

/**
 * How far either side of its target a reading still counts as on target: the
 * green band a chart draws, and what "in band" means in a verdict.
 *
 * It is one tolerance per metric rather than the controller's own hysteresis,
 * which differs per output, per hardware type and per firmware: a band read off
 * the control laws would mean something different on every device, and none of
 * them is what a grower means by "the humidity held". A metric that is not named
 * here is not steered and has no band. Stated once, like `VALUE_AGE`, so the
 * server decides and no client works it out.
 */
export const TARGET_BAND: Readonly<Partial<Record<z.infer<typeof metric>, number>>> = { temperature: 1, humidity: 5, co2: 200 };

/**
 * How many decimals a reading of a metric is worth.
 *
 * A window of a series is a mean of what a device reported, and the mean of two
 * readings is a number with seventeen digits of which one is a measurement. A
 * value is rounded to what the sensor can actually say before it goes on the
 * wire, so nothing downstream has to decide how much of it is real. Stated once,
 * like `TARGET_BAND`; how many of those decimals a screen then draws is the
 * screen's own business.
 */
export const METRIC_DECIMALS: Readonly<Record<z.infer<typeof metric>, number>> = {
  temperature: 1,
  humidity: 1,
  co2: 0,
  leafTemperature: 1,
  lux: 0,
  vpd: 2,
  ppfd: 0,
  offline: 0,
};

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
export const METRIC_FIELD: Readonly<Record<z.infer<typeof metric>, string | null>> = {
  temperature: 'temperature',
  humidity: 'humidity',
  co2: 'co2',
  leafTemperature: 'leaf_temperature',
  lux: 'lux',
  vpd: null,
  ppfd: null,
  offline: null,
};

export const OUTPUT_METRIC_FIELD: Readonly<Record<z.infer<typeof outputMetric>, string>> = {
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

const byField = <M extends string>(fields: Readonly<Record<M, string | null>>): Readonly<Record<string, M>> => {
  const map: Record<string, M> = {};
  for (const [name, field] of Object.entries(fields) as [M, string | null][]) {
    if (field !== null) map[field] = name;
  }
  return map;
};

/** The other direction, for reading a point back out of Influx. Derived, so the two cannot drift. */
export const FIELD_METRIC = byField(METRIC_FIELD);
export const FIELD_OUTPUT_METRIC = byField(OUTPUT_METRIC_FIELD);
