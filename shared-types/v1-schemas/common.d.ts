import { z } from 'zod';
/**
 * The base of the `/v1` wire contract: the registry, the scalar helpers, the
 * envelopes, and the enums and value objects more than one domain needs.
 */
/** Named for the generated output: an entry's id becomes its exported type name. */
export declare const registry: z.core.$ZodRegistry<{
    id: string;
}, z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
export declare const named: <T extends z.ZodType>(id: string, schema: T) => T;
/**
 * An instant on the wire, as a string: JSON is the contract, and the server
 * parses to a `Date` at its own boundary rather than handing one out.
 *
 * Every instant is named `...At` or `...Until`, without exception.
 */
export declare const instant: () => z.ZodISODateTime;
/** Every resource has one, and every reference to one is `<resource>Id`. */
export declare const id: () => z.ZodString;
/**
 * Presence, once, for the whole contract: a field that belongs to a resource is
 * always there, "none" is `null` and a list is `[]`. So absence is spelled
 * `.nullable()`, and `.optional()` is reserved for a field that a *request* body
 * may genuinely leave out.
 */
/** Deliberately unconstrained. `z.any()` alone would generate `unknown`. */
export declare const anyValue: () => z.ZodAny;
/** Raw bytes. Only a firmware image carries them. */
export declare const bytes: () => z.ZodCustom<Buffer<ArrayBufferLike>, Buffer<ArrayBufferLike>>;
/**
 * Every list answers this shape. Not registered itself - a domain file names the
 * page it returns (`named('GrowPage', page(grow))`), so the generator emits one
 * type per list rather than a generic the declaration file cannot express.
 */
export declare const page: <T extends z.ZodType>(item: T) => z.ZodObject<{
    items: z.ZodArray<T>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const problemError: z.ZodObject<{
    field: z.ZodString;
    code: z.ZodString;
    detail: z.ZodString;
}, z.core.$strip>;
/** RFC 7807. Every error answer of `/v1` is one of these, as `application/problem+json`. */
export declare const problem: z.ZodObject<{
    status: z.ZodNumber;
    code: z.ZodString;
    title: z.ZodString;
    detail: z.ZodString;
    errors: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        code: z.ZodString;
        detail: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * A reference to one of several kinds of resource, always as one object rather
 * than a row of fields of which exactly one is filled.
 */
export declare const subjectRef: <T extends z.ZodType>(type: T) => z.ZodObject<{
    type: T;
    id: z.ZodString;
}, z.core.$strip>;
/**
 * The six botanical stages. These cross the device protocol and the firmware's
 * own vocabulary, so the values are fixed and may not be renamed. What the
 * screens call "Late flower" is a climate preset on top of a stage, not a
 * seventh value.
 */
export declare const growthStage: z.ZodEnum<{
    germination: "germination";
    seedling: "seedling";
    vegetative: "vegetative";
    flowering: "flowering";
    drying: "drying";
    curing: "curing";
}>;
/** The owner is `spaces.ownerId` and never a membership row, so there is no `owner` role. */
export declare const memberRole: z.ZodEnum<{
    can_log: "can_log";
    can_manage: "can_manage";
}>;
export declare const entryKind: z.ZodEnum<{
    move: "move";
    water: "water";
    feed: "feed";
    photo: "photo";
    note: "note";
    measurement: "measurement";
    training: "training";
    phase: "phase";
    harvest: "harvest";
    visit: "visit";
    alarm: "alarm";
    plan: "plan";
    system: "system";
}>;
/** Who put the entry in the timeline; a human's watering and a device's log line are both entries. */
export declare const entrySource: z.ZodEnum<{
    alarm: "alarm";
    plan: "plan";
    human: "human";
    device: "device";
    preset: "preset";
}>;
export declare const severity: z.ZodEnum<{
    critical: "critical";
    warning: "warning";
    info: "info";
}>;
/**
 * What raised the alert. `threshold` is a rule of its own, the other two are the
 * health loop: a device that stopped reporting and a camera that stopped
 * delivering stills, neither of which a reading can express.
 */
export declare const alertKind: z.ZodEnum<{
    threshold: "threshold";
    offline: "offline";
    camera_stale: "camera_stale";
}>;
/**
 * Shared by a person's own webhook channel and by an alarm rule's own delivery.
 * The values are HTTP's own and are spelled as HTTP spells them, which is the
 * one place this contract's `snake_case` enum rule gives way to a vocabulary it
 * does not own.
 */
export declare const webhookMethod: z.ZodEnum<{
    GET: "GET";
    POST: "POST";
    PUT: "PUT";
}>;
/**
 * Where a message can go. Each is off until it is configured: `push` by a
 * subscription in `pushSubscriptions`, the other three by `NotificationChannels`.
 *
 * It is stated here rather than with the account because an alarm rule's own
 * delivery names two of these as well, and a person choosing where an alarm goes
 * must not be reading two vocabularies for the one question.
 */
export declare const notificationChannel: z.ZodEnum<{
    push: "push";
    email: "email";
    telegram: "telegram";
    webhook: "webhook";
}>;
/**
 * What can be asked of a running plan. Stated once: the plan routes take one of
 * these and the diary writes the one that caused a `plan` entry.
 */
export declare const planTransitionKind: z.ZodEnum<{
    pause: "pause";
    resume: "resume";
    confirm: "confirm";
    extend: "extend";
    skip: "skip";
}>;
/**
 * What a smart socket drives. The first five are what deployed firmware already
 * knows; the rest arrive with the socket firmware change.
 *
 * The empty value is "unassigned": a socket that is paired but never driven.
 * A device is only ever sent a role it announced in `socket_roles`, so an old
 * build never sees one of the new ones.
 */
export declare const socketRole: z.ZodEnum<{
    "": "";
    manual: "manual";
    dehumidifier: "dehumidifier";
    heater: "heater";
    light: "light";
    secondary_light: "secondary_light";
    co2: "co2";
    humidifier: "humidifier";
    exhaust: "exhaust";
    circulation: "circulation";
    fan: "fan";
    pump: "pump";
    custom_timer: "custom_timer";
}>;
/** How old a value is. Dimmed on the screens, never hidden. */
export declare const valueState: z.ZodEnum<{
    offline: "offline";
    live: "live";
    stale: "stale";
}>;
/**
 * The one place the ages are stated. The server decides `valueState` from these
 * and its own clock, so no client does the arithmetic.
 */
export declare const VALUE_AGE: {
    readonly liveSeconds: 120;
    readonly staleSeconds: 600;
};
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
export declare const metricValue: z.ZodObject<{
    value: z.ZodNullable<z.ZodNumber>;
    measuredAt: z.ZodNullable<z.ZodISODateTime>;
    state: z.ZodEnum<{
        offline: "offline";
        live: "live";
        stale: "stale";
    }>;
}, z.core.$strip>;
/**
 * One window of a series. `value` is null where the window holds no reading, so
 * a chart draws the gap instead of joining across it; a computed metric that
 * cannot be worked out for a window arrives the same way.
 *
 * It sits here rather than with the device routes because a device's series and
 * the panels of the timeline are the same points read over different windows.
 */
export declare const seriesPoint: z.ZodObject<{
    measuredAt: z.ZodISODateTime;
    value: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * `terpcam_controller` is the Terp Cam a controller pairs and answers for;
 * `terpcam_standalone` is one the cloud reaches itself; `rtsp` is any other
 * camera, pulled through the controller's tunnel.
 */
export declare const cameraKind: z.ZodEnum<{
    terpcam_controller: "terpcam_controller";
    terpcam_standalone: "terpcam_standalone";
    rtsp: "rtsp";
}>;
export declare const mediaKind: z.ZodEnum<{
    photo: "photo";
    still: "still";
    timelapse: "timelapse";
    avatar: "avatar";
}>;
/**
 * Why a camera is entitled: `included` is the year a Terp Cam gets when it is
 * first claimed or paired, `migration` the year every camera that existed at the
 * migration got on migration day, `purchase` everything bought afterwards.
 */
export declare const grantKind: z.ZodEnum<{
    included: "included";
    migration: "migration";
    purchase: "purchase";
}>;
export declare const planStatus: z.ZodEnum<{
    stopped: "stopped";
    completed: "completed";
    paused: "paused";
    running: "running";
}>;
/** `room` groups the others, one level deep; a grow needs no space at all. */
export declare const spaceKind: z.ZodEnum<{
    other: "other";
    tent: "tent";
    fridge: "fridge";
    room: "room";
    balcony: "balcony";
}>;
export declare const growType: z.ZodEnum<{
    photoperiod: "photoperiod";
    autoflower: "autoflower";
}>;
export declare const reminderKind: z.ZodEnum<{
    custom: "custom";
    water: "water";
    feed: "feed";
    chore: "chore";
}>;
/** `view` is a link to the app's own read-only view; `public_page` is the shared diary page. */
export declare const shareKind: z.ZodEnum<{
    view: "view";
    public_page: "public_page";
}>;
/**
 * The two things a reminder, a derived task and a share link can each be about.
 * One enum, because the three answer the same question and a client that reads
 * two of them must not have to learn two vocabularies.
 */
export declare const growOrSpaceType: z.ZodEnum<{
    grow: "grow";
    space: "space";
}>;
/**
 * And the reference itself, named once. A reminder, a derived task and a share
 * link each point at a grow or a space, and all three say so with this object
 * rather than with a pair of ids of which one is filled.
 */
export declare const growOrSpaceRef: z.ZodObject<{
    type: z.ZodEnum<{
        grow: "grow";
        space: "space";
    }>;
    id: z.ZodString;
}, z.core.$strip>;
export declare const temperatureUnit: z.ZodEnum<{
    celsius: "celsius";
    fahrenheit: "fahrenheit";
}>;
export declare const weightUnit: z.ZodEnum<{
    grams: "grams";
    ounces: "ounces";
}>;
export declare const volumeUnit: z.ZodEnum<{
    liters: "liters";
    gallons: "gallons";
}>;
/** Display only: everything is stored and served in the first value of each enum. */
export declare const unitPreference: z.ZodObject<{
    temperature: z.ZodEnum<{
        celsius: "celsius";
        fahrenheit: "fahrenheit";
    }>;
    weight: z.ZodEnum<{
        grams: "grams";
        ounces: "ounces";
    }>;
    volume: z.ZodEnum<{
        liters: "liters";
        gallons: "gallons";
    }>;
}, z.core.$strip>;
/**
 * A feeding grid, defined once: a person's own scheme and the effective grid a
 * grow carries are the same table, and only their origin differs.
 */
export declare const schemeAmount: z.ZodObject<{
    productKey: z.ZodString;
    name: z.ZodString;
    value: z.ZodNullable<z.ZodNumber>;
    unit: z.ZodString;
}, z.core.$strip>;
/** One row of the grid. */
export declare const schemeWeek: z.ZodObject<{
    week: z.ZodNumber;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    amounts: z.ZodArray<z.ZodObject<{
        productKey: z.ZodString;
        name: z.ZodString;
        value: z.ZodNullable<z.ZodNumber>;
        unit: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
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
export declare const metric: z.ZodEnum<{
    offline: "offline";
    co2: "co2";
    temperature: "temperature";
    humidity: "humidity";
    leafTemperature: "leafTemperature";
    lux: "lux";
    vpd: "vpd";
    ppfd: "ppfd";
}>;
/** A controller's outputs, as a series. Their state is what the timeline draws under the climate charts. */
export declare const outputMetric: z.ZodEnum<{
    dehumidifier: "dehumidifier";
    heater: "heater";
    light: "light";
    co2: "co2";
    fan: "fan";
    relais: "relais";
    fanInternal: "fanInternal";
    fanExternal: "fanExternal";
    fanBackwall: "fanBackwall";
}>;
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
export declare const TARGET_BAND: Readonly<Partial<Record<z.infer<typeof metric>, number>>>;
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
export declare const METRIC_DECIMALS: Readonly<Record<z.infer<typeof metric>, number>>;
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
export declare const METRIC_FIELD: Readonly<Record<z.infer<typeof metric>, string | null>>;
export declare const OUTPUT_METRIC_FIELD: Readonly<Record<z.infer<typeof outputMetric>, string>>;
/** The other direction, for reading a point back out of Influx. Derived, so the two cannot drift. */
export declare const FIELD_METRIC: Readonly<Record<string, "offline" | "co2" | "temperature" | "humidity" | "leafTemperature" | "lux" | "vpd" | "ppfd">>;
export declare const FIELD_OUTPUT_METRIC: Readonly<Record<string, "dehumidifier" | "heater" | "light" | "co2" | "fan" | "relais" | "fanInternal" | "fanExternal" | "fanBackwall">>;
