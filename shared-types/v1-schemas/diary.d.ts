import { z } from 'zod';
/**
 * The timeline and everything that is looked at: entries, pictures, cameras,
 * feeding schemes, chart views, share links - and the read models the screens
 * open on.
 *
 * Shapes that belong to another domain (a grow, a space, a device, a plant) are
 * referred to by `<resource>Id` only, so this file and its siblings can be read
 * and generated independently.
 */
/**
 * One reading of one measurement. `key` names a definition in the grow's
 * `measurements[]`, which is what gives it its name, its unit and its target;
 * nothing about the measurement is copied onto the reading.
 *
 * `plantId` is null when the reading is about whatever the entry is about - the
 * whole grow, or the plants the entry names - rather than one plant, which is
 * what a per-plant measurement records.
 */
export declare const entryReading: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodNumber;
    plantId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * What a grow calls one of its measurements, as far as saying a reading out
 * loud needs: its key, the name it goes by and the unit it is in.
 *
 * Deliberately not the whole definition. The band a measurement is aimed at is
 * the grower's own business, and both answers that carry these are read through
 * share links and public pages as well, so what rides along is the wording and
 * nothing that was not already on the screen.
 */
export declare const readingName: z.ZodObject<{
    key: z.ZodString;
    name: z.ZodString;
    unit: z.ZodString;
}, z.core.$strip>;
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
export declare const growReadingNames: z.ZodObject<{
    growId: z.ZodString;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        name: z.ZodString;
        unit: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * One dose of one product, as it was actually given.
 *
 * Absolute, not per litre: the grid says `2 ml/l` and this says the 8 ml that
 * went into the can. The scheme a grow carries can be edited afterwards and a
 * grow can be fed without a scheme at all, so a line that had to be read back
 * through a grid would change meaning or lose it entirely.
 */
export declare const entryDose: z.ZodObject<{
    productKey: z.ZodString;
    name: z.ZodString;
    amount: z.ZodNumber;
    unit: z.ZodString;
}, z.core.$strip>;
/** Measurements of the grow's own definitions, whatever the entry is otherwise about. */
export declare const measurementEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"measurement">;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Watering: how much water, and whatever was measured while pouring it. */
export declare const waterEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"water">;
    litres: z.ZodNullable<z.ZodNumber>;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Feeding: the water, the doses that went into it, and the readings taken with
 * it. `schemeWeek` records which row of the grid the doses came from, so the
 * line can say "week 5 of the scheme" without reading the grid again.
 */
export declare const feedEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"feed">;
    litres: z.ZodNullable<z.ZodNumber>;
    schemeWeek: z.ZodNullable<z.ZodNumber>;
    doses: z.ZodArray<z.ZodObject<{
        productKey: z.ZodString;
        name: z.ZodString;
        amount: z.ZodNumber;
        unit: z.ZodString;
    }, z.core.$strip>>;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** The picture is in `mediaIds`, the words in `text`: neither needs a value of its own. */
export declare const photoEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"photo">;
}, z.core.$strip>;
export declare const noteEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"note">;
}, z.core.$strip>;
export declare const trainingEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"training">;
}, z.core.$strip>;
export declare const visitEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"visit">;
}, z.core.$strip>;
/** The device's `message-key:param` line is already parsed into `message`. */
export declare const systemEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"system">;
}, z.core.$strip>;
/** The alert document holds the numbers and the life of the alarm; the entry points at it by `alertId`. */
export declare const alarmEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"alarm">;
}, z.core.$strip>;
/** Written by the one phase writer, so it repeats what the phase it appended says. */
export declare const phaseEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"phase">;
    phaseId: z.ZodString;
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    preset: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const moveEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"move">;
    placementId: z.ZodString;
    spaceId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** Weights are the plant's; they are repeated here for the timeline and stripped from shared views with it. */
export declare const harvestEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"harvest">;
    wetWeightG: z.ZodNullable<z.ZodNumber>;
    dryWeightG: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const planEntryValues: z.ZodObject<{
    kind: z.ZodLiteral<"plan">;
    planId: z.ZodString;
    stepIndex: z.ZodNumber;
    transition: z.ZodNullable<z.ZodEnum<{
        pause: "pause";
        resume: "resume";
        confirm: "confirm";
        extend: "extend";
        skip: "skip";
    }>>;
}, z.core.$strip>;
export declare const entryValues: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"water">;
    litres: z.ZodNullable<z.ZodNumber>;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"feed">;
    litres: z.ZodNullable<z.ZodNumber>;
    schemeWeek: z.ZodNullable<z.ZodNumber>;
    doses: z.ZodArray<z.ZodObject<{
        productKey: z.ZodString;
        name: z.ZodString;
        amount: z.ZodNumber;
        unit: z.ZodString;
    }, z.core.$strip>>;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"measurement">;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"photo">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"note">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"training">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"visit">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"system">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"alarm">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"phase">;
    phaseId: z.ZodString;
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    preset: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"move">;
    placementId: z.ZodString;
    spaceId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"harvest">;
    wetWeightG: z.ZodNullable<z.ZodNumber>;
    dryWeightG: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"plan">;
    planId: z.ZodString;
    stepIndex: z.ZodNumber;
    transition: z.ZodNullable<z.ZodEnum<{
        pause: "pause";
        resume: "resume";
        confirm: "confirm";
        extend: "extend";
        skip: "skip";
    }>>;
}, z.core.$strip>], "kind">;
/** A device's log line, parsed once on the way in. The keys are the webapp's `message-*` catalogue. */
export declare const entryMessage: z.ZodObject<{
    key: z.ZodString;
    params: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/**
 * One timeline. A human's watering, a device's log line and an alarm are all
 * entries, told apart by `kind` and `source`.
 *
 * Every reference is null when the entry is not about one: an entry exists
 * without a grow, without a space and without a device. `plantIds` empty means
 * the entry is about whatever it is attached to rather than about single plants.
 */
export declare const entry: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    kind: z.ZodEnum<{
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
    occurredAt: z.ZodISODateTime;
    source: z.ZodEnum<{
        alarm: "alarm";
        plan: "plan";
        human: "human";
        device: "device";
        preset: "preset";
    }>;
    authorId: z.ZodNullable<z.ZodString>;
    growId: z.ZodNullable<z.ZodString>;
    spaceId: z.ZodNullable<z.ZodString>;
    deviceId: z.ZodNullable<z.ZodString>;
    plantIds: z.ZodArray<z.ZodString>;
    cameraId: z.ZodNullable<z.ZodString>;
    taskId: z.ZodNullable<z.ZodString>;
    alertId: z.ZodNullable<z.ZodString>;
    severity: z.ZodNullable<z.ZodEnum<{
        critical: "critical";
        warning: "warning";
        info: "info";
    }>>;
    text: z.ZodNullable<z.ZodString>;
    message: z.ZodNullable<z.ZodObject<{
        key: z.ZodString;
        params: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    values: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"water">;
        litres: z.ZodNullable<z.ZodNumber>;
        readings: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"feed">;
        litres: z.ZodNullable<z.ZodNumber>;
        schemeWeek: z.ZodNullable<z.ZodNumber>;
        doses: z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            amount: z.ZodNumber;
            unit: z.ZodString;
        }, z.core.$strip>>;
        readings: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"measurement">;
        readings: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"photo">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"note">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"training">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"visit">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"system">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"alarm">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"phase">;
        phaseId: z.ZodString;
        stage: z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>;
        preset: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"move">;
        placementId: z.ZodString;
        spaceId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"harvest">;
        wetWeightG: z.ZodNullable<z.ZodNumber>;
        dryWeightG: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"plan">;
        planId: z.ZodString;
        stepIndex: z.ZodNumber;
        transition: z.ZodNullable<z.ZodEnum<{
            pause: "pause";
            resume: "resume";
            confirm: "confirm";
            extend: "extend";
            skip: "skip";
        }>>;
    }, z.core.$strip>], "kind">;
    mediaIds: z.ZodArray<z.ZodString>;
    undoUntil: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
export declare const entryPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
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
        occurredAt: z.ZodISODateTime;
        source: z.ZodEnum<{
            alarm: "alarm";
            plan: "plan";
            human: "human";
            device: "device";
            preset: "preset";
        }>;
        authorId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        deviceId: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        taskId: z.ZodNullable<z.ZodString>;
        alertId: z.ZodNullable<z.ZodString>;
        severity: z.ZodNullable<z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>>;
        text: z.ZodNullable<z.ZodString>;
        message: z.ZodNullable<z.ZodObject<{
            key: z.ZodString;
            params: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        values: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"water">;
            litres: z.ZodNullable<z.ZodNumber>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"feed">;
            litres: z.ZodNullable<z.ZodNumber>;
            schemeWeek: z.ZodNullable<z.ZodNumber>;
            doses: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                amount: z.ZodNumber;
                unit: z.ZodString;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"measurement">;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"photo">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"note">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"training">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"visit">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"system">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"alarm">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
            phaseId: z.ZodString;
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            preset: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            placementId: z.ZodString;
            spaceId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"harvest">;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"plan">;
            planId: z.ZodString;
            stepIndex: z.ZodNumber;
            transition: z.ZodNullable<z.ZodEnum<{
                pause: "pause";
                resume: "resume";
                confirm: "confirm";
                extend: "extend";
                skip: "skip";
            }>>;
        }, z.core.$strip>], "kind">;
        mediaIds: z.ZodArray<z.ZodString>;
        undoUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * The kinds a person writes. Every other kind on the timeline belongs to the
 * route or the engine it is about - a phase to `POST /grows/{id}/phases`, a move
 * to a placement, a harvest to a harvest, an alarm to the alarm engine - so
 * writing one through the diary would be a second way to state the same fact.
 */
export declare const humanEntryKind: z.ZodEnum<{
    water: "water";
    feed: "feed";
    photo: "photo";
    note: "note";
    measurement: "measurement";
    training: "training";
    visit: "visit";
}>;
/**
 * What `POST /entries` takes for `values`: the same shapes with the parts the
 * server can work out left optional.
 *
 * "Log as planned" is a feed that names its water and nothing else - the doses
 * and the week they came from are resolved from the grow's grid at the moment
 * the feed happened, and stored resolved. A feed that names its own doses is
 * stored as given, because what went into the can is the fact.
 */
export declare const entryValuesDraft: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"water">;
    litres: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"feed">;
    litres: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    schemeWeek: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    doses: z.ZodOptional<z.ZodArray<z.ZodObject<{
        productKey: z.ZodString;
        name: z.ZodString;
        amount: z.ZodNumber;
        unit: z.ZodString;
    }, z.core.$strip>>>;
    readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"measurement">;
    readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"photo">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"note">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"training">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"visit">;
}, z.core.$strip>], "kind">;
/**
 * `POST /entries`. What the entry is about is the client's; who wrote it, when
 * it was written down, what raised it and how long it may still be taken back
 * are the server's, so none of those is asked for.
 *
 * Both `kind` and `values.kind` are given and have to agree. `values` narrows on
 * its own wherever it travels, and the server checks the pair against each other
 * rather than believing one of them.
 */
export declare const entryCreate: z.ZodObject<{
    text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    cameraId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    growId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    occurredAt: z.ZodOptional<z.ZodISODateTime>;
    taskId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    mediaIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodEnum<{
        water: "water";
        feed: "feed";
        photo: "photo";
        note: "note";
        measurement: "measurement";
        training: "training";
        visit: "visit";
    }>;
    values: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"water">;
        litres: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"feed">;
        litres: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        schemeWeek: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        doses: z.ZodOptional<z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            amount: z.ZodNumber;
            unit: z.ZodString;
        }, z.core.$strip>>>;
        readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"measurement">;
        readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"photo">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"note">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"training">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"visit">;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>;
/**
 * `PATCH /entries/{id}`: the same fields, each only if it changes. An entry's
 * `kind` is what the entry is and is not patched - correcting a reading is
 * `values`, whose own `kind` still has to be the entry's.
 */
export declare const entryUpdate: z.ZodObject<{
    values: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"water">;
        litres: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"feed">;
        litres: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        schemeWeek: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        doses: z.ZodOptional<z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            amount: z.ZodNumber;
            unit: z.ZodString;
        }, z.core.$strip>>>;
        readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"measurement">;
        readings: z.ZodOptional<z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"photo">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"note">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"training">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"visit">;
    }, z.core.$strip>], "kind">>;
    text: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    cameraId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    spaceId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    deviceId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    plantIds: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    growId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    occurredAt: z.ZodOptional<z.ZodOptional<z.ZodISODateTime>>;
    taskId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    mediaIds: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
}, z.core.$strip>;
/**
 * What a timelapse covers. `day`, `week` and `month` are the rolling films the
 * builder keeps by itself; `phase`, `grow` and `custom` are the composer's
 * ranges, and each of them names both of its ends, because only the client
 * knows where a phase or a grow began.
 */
export declare const mediaWindow: z.ZodEnum<{
    custom: "custom";
    day: "day";
    month: "month";
    week: "week";
    phase: "phase";
    grow: "grow";
}>;
/** A render's resolution. `hd` and whole-grow renders need entitlement; a free render carries a watermark. */
export declare const mediaQuality: z.ZodEnum<{
    sd: "sd";
    hd: "hd";
}>;
/**
 * The shape a film is rendered to: landscape, the portrait one a reel is, or
 * square. Named by their ratios rather than by a platform, which outlives the
 * platform.
 */
export declare const mediaAspect: z.ZodEnum<{
    "16_9": "16_9";
    "9_16": "9_16";
    "1_1": "1_1";
}>;
/**
 * What is drawn over the frames. Each is off unless it is asked for, and each
 * needs something to draw from - a grow for its day counter, a controller for
 * its climate, entries for its captions - so one that has nothing simply draws
 * nothing rather than refusing the render.
 */
export declare const mediaOverlays: z.ZodObject<{
    dayCounter: z.ZodBoolean;
    climate: z.ZodBoolean;
    entries: z.ZodBoolean;
}, z.core.$strip>;
/** Only `queued` is a fact of the model; the rest is how far the hourly builder has got. */
export declare const mediaRenderStatus: z.ZodEnum<{
    failed: "failed";
    ready: "ready";
    queued: "queued";
    rendering: "rendering";
}>;
/**
 * A render job. What the picture is of - the camera, the range, the window, the
 * quality - is the media row's own, so this adds only what the composer needs
 * and how the job is going.
 */
export declare const mediaRender: z.ZodObject<{
    status: z.ZodEnum<{
        failed: "failed";
        ready: "ready";
        queued: "queued";
        rendering: "rendering";
    }>;
    framesPerSecond: z.ZodNumber;
    watermark: z.ZodBoolean;
    aspect: z.ZodEnum<{
        "16_9": "16_9";
        "9_16": "9_16";
        "1_1": "1_1";
    }>;
    overlays: z.ZodObject<{
        dayCounter: z.ZodBoolean;
        climate: z.ZodBoolean;
        entries: z.ZodBoolean;
    }, z.core.$strip>;
    includeLightsOff: z.ZodBoolean;
    secondCameraId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodNullable<z.ZodISODateTime>;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    error: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** What an export is of: one grow, or everything the account has. */
export declare const exportScope: z.ZodEnum<{
    grow: "grow";
    account: "account";
}>;
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
export declare const mediaExportJob: z.ZodObject<{
    status: z.ZodEnum<{
        failed: "failed";
        ready: "ready";
        queued: "queued";
        rendering: "rendering";
    }>;
    scope: z.ZodEnum<{
        grow: "grow";
        account: "account";
    }>;
    growId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodNullable<z.ZodISODateTime>;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    error: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * A picture or a film. The bytes stay in the GridFS bucket, whose file id is
 * this resource's id, and are served by `GET /media/{id}/content`.
 *
 * A picture belongs to a camera, a grow or a space, never to a device.
 */
export declare const media: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    kind: z.ZodEnum<{
        photo: "photo";
        still: "still";
        timelapse: "timelapse";
        avatar: "avatar";
        export: "export";
    }>;
    mime: z.ZodString;
    bytes: z.ZodNumber;
    cameraId: z.ZodNullable<z.ZodString>;
    growId: z.ZodNullable<z.ZodString>;
    spaceId: z.ZodNullable<z.ZodString>;
    uploadedBy: z.ZodNullable<z.ZodString>;
    capturedAt: z.ZodISODateTime;
    endsAt: z.ZodNullable<z.ZodISODateTime>;
    window: z.ZodNullable<z.ZodEnum<{
        custom: "custom";
        day: "day";
        month: "month";
        week: "week";
        phase: "phase";
        grow: "grow";
    }>>;
    quality: z.ZodNullable<z.ZodEnum<{
        sd: "sd";
        hd: "hd";
    }>>;
    lengthSeconds: z.ZodNullable<z.ZodNumber>;
    render: z.ZodNullable<z.ZodObject<{
        status: z.ZodEnum<{
            failed: "failed";
            ready: "ready";
            queued: "queued";
            rendering: "rendering";
        }>;
        framesPerSecond: z.ZodNumber;
        watermark: z.ZodBoolean;
        aspect: z.ZodEnum<{
            "16_9": "16_9";
            "9_16": "9_16";
            "1_1": "1_1";
        }>;
        overlays: z.ZodObject<{
            dayCounter: z.ZodBoolean;
            climate: z.ZodBoolean;
            entries: z.ZodBoolean;
        }, z.core.$strip>;
        includeLightsOff: z.ZodBoolean;
        secondCameraId: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodNullable<z.ZodISODateTime>;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        error: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    exportJob: z.ZodNullable<z.ZodObject<{
        status: z.ZodEnum<{
            failed: "failed";
            ready: "ready";
            queued: "queued";
            rendering: "rendering";
        }>;
        scope: z.ZodEnum<{
            grow: "grow";
            account: "account";
        }>;
        growId: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodNullable<z.ZodISODateTime>;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        error: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * What `GET /grows/{id}/export` and `GET /me/export` answer. A zip of a diary,
 * its CSVs and its photos does not finish inside a request, so the media row
 * comes back with `exportJob.status: queued` and is polled through
 * `GET /media/{id}` until it is `ready`; its bytes then come from
 * `GET /media/{id}/content` like any other file.
 *
 * `queued` says which of the two happened, and with it the 202 from the 200: an
 * export asked for while one is still being built, or while a fresh one is
 * still there, answers that one rather than starting a second.
 */
export declare const exportAccepted: z.ZodObject<{
    media: z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
            photo: "photo";
            still: "still";
            timelapse: "timelapse";
            avatar: "avatar";
            export: "export";
        }>;
        mime: z.ZodString;
        bytes: z.ZodNumber;
        cameraId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        uploadedBy: z.ZodNullable<z.ZodString>;
        capturedAt: z.ZodISODateTime;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
        window: z.ZodNullable<z.ZodEnum<{
            custom: "custom";
            day: "day";
            month: "month";
            week: "week";
            phase: "phase";
            grow: "grow";
        }>>;
        quality: z.ZodNullable<z.ZodEnum<{
            sd: "sd";
            hd: "hd";
        }>>;
        lengthSeconds: z.ZodNullable<z.ZodNumber>;
        render: z.ZodNullable<z.ZodObject<{
            status: z.ZodEnum<{
                failed: "failed";
                ready: "ready";
                queued: "queued";
                rendering: "rendering";
            }>;
            framesPerSecond: z.ZodNumber;
            watermark: z.ZodBoolean;
            aspect: z.ZodEnum<{
                "16_9": "16_9";
                "9_16": "9_16";
                "1_1": "1_1";
            }>;
            overlays: z.ZodObject<{
                dayCounter: z.ZodBoolean;
                climate: z.ZodBoolean;
                entries: z.ZodBoolean;
            }, z.core.$strip>;
            includeLightsOff: z.ZodBoolean;
            secondCameraId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodNullable<z.ZodISODateTime>;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            error: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        exportJob: z.ZodNullable<z.ZodObject<{
            status: z.ZodEnum<{
                failed: "failed";
                ready: "ready";
                queued: "queued";
                rendering: "rendering";
            }>;
            scope: z.ZodEnum<{
                grow: "grow";
                account: "account";
            }>;
            growId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodNullable<z.ZodISODateTime>;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            error: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    queued: z.ZodBoolean;
}, z.core.$strip>;
/**
 * `GET /cameras/{id}/frames` and `GET /cameras/{id}/timelapses` answer this, each
 * filtered to its kind: a frame is a `still` of that camera and a timelapse a
 * film built from them, and both are media rows like any other.
 */
export declare const mediaPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
            photo: "photo";
            still: "still";
            timelapse: "timelapse";
            avatar: "avatar";
            export: "export";
        }>;
        mime: z.ZodString;
        bytes: z.ZodNumber;
        cameraId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        uploadedBy: z.ZodNullable<z.ZodString>;
        capturedAt: z.ZodISODateTime;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
        window: z.ZodNullable<z.ZodEnum<{
            custom: "custom";
            day: "day";
            month: "month";
            week: "week";
            phase: "phase";
            grow: "grow";
        }>>;
        quality: z.ZodNullable<z.ZodEnum<{
            sd: "sd";
            hd: "hd";
        }>>;
        lengthSeconds: z.ZodNullable<z.ZodNumber>;
        render: z.ZodNullable<z.ZodObject<{
            status: z.ZodEnum<{
                failed: "failed";
                ready: "ready";
                queued: "queued";
                rendering: "rendering";
            }>;
            framesPerSecond: z.ZodNumber;
            watermark: z.ZodBoolean;
            aspect: z.ZodEnum<{
                "16_9": "16_9";
                "9_16": "9_16";
                "1_1": "1_1";
            }>;
            overlays: z.ZodObject<{
                dayCounter: z.ZodBoolean;
                climate: z.ZodBoolean;
                entries: z.ZodBoolean;
            }, z.core.$strip>;
            includeLightsOff: z.ZodBoolean;
            secondCameraId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodNullable<z.ZodISODateTime>;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            error: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        exportJob: z.ZodNullable<z.ZodObject<{
            status: z.ZodEnum<{
                failed: "failed";
                ready: "ready";
                queued: "queued";
                rendering: "rendering";
            }>;
            scope: z.ZodEnum<{
                grow: "grow";
                account: "account";
            }>;
            growId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodNullable<z.ZodISODateTime>;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            error: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * Stills come from the camera pipeline and timelapses from the composer, so the
 * only kinds anybody uploads are a picture for the diary and an avatar.
 */
export declare const uploadMediaKind: z.ZodEnum<{
    photo: "photo";
    avatar: "avatar";
}>;
/**
 * `POST /media`, beside the bytes in the multipart body. The mime type, the size
 * and who uploaded it are read off the upload and the session rather than asked
 * for. A photo usually reaches its grow through the entry that carries it;
 * `growId` and `spaceId` are for the picture that is uploaded on its own.
 */
export declare const mediaUpload: z.ZodObject<{
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    growId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    capturedAt: z.ZodOptional<z.ZodISODateTime>;
    kind: z.ZodEnum<{
        photo: "photo";
        avatar: "avatar";
    }>;
}, z.core.$strip>;
/** How an RTSP stream is pulled. Null on a Terp Cam, which is not RTSP at all. */
export declare const cameraTransport: z.ZodEnum<{
    tcp: "tcp";
    udp: "udp";
}>;
/** A hint for the URL template a stream was built from, never how it is read. */
export declare const cameraModel: z.ZodEnum<{
    custom: "custom";
    terp_cam: "terp_cam";
    tapo_c200: "tapo_c200";
    reolink: "reolink";
    hikvision: "hikvision";
}>;
/** `free` is what an install with `PREMIUM_ENFORCED` unset never sees, because nothing is gated then. */
export declare const entitlementTier: z.ZodEnum<{
    free: "free";
    premium: "premium";
}>;
/**
 * Twelve months per camera, never renewed by this server: the admin route is the
 * only writer. `tier` is derived from `validUntil` and the install's
 * enforcement, and `renewalVisible` says whether the screen offers to extend,
 * so neither the client nor this server needs a billing system to draw it.
 */
export declare const cameraEntitlement: z.ZodObject<{
    validUntil: z.ZodNullable<z.ZodISODateTime>;
    grant: z.ZodNullable<z.ZodEnum<{
        included: "included";
        migration: "migration";
        purchase: "purchase";
    }>>;
    tier: z.ZodEnum<{
        free: "free";
        premium: "premium";
    }>;
    renewalVisible: z.ZodBoolean;
}, z.core.$strip>;
/**
 * `PUT /admin/cameras/{id}/entitlement`, which is the only writer of one:
 * nothing renews on its own in this server. `tier` and `renewalVisible` are read
 * from `validUntil` and the install's configuration every time a camera is
 * serialised, so they are answered and never written.
 */
export declare const cameraEntitlementUpdate: z.ZodObject<{
    validUntil: z.ZodNullable<z.ZodISODateTime>;
    grant: z.ZodNullable<z.ZodEnum<{
        included: "included";
        migration: "migration";
        purchase: "purchase";
    }>>;
}, z.core.$strip>;
export declare const cameraState: z.ZodObject<{
    lastStillAt: z.ZodNullable<z.ZodISODateTime>;
    lastError: z.ZodNullable<z.ZodString>;
    firmwareVersion: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
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
export declare const camera: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    ownerId: z.ZodString;
    kind: z.ZodEnum<{
        terpcam_controller: "terpcam_controller";
        terpcam_standalone: "terpcam_standalone";
        rtsp: "rtsp";
    }>;
    deviceId: z.ZodNullable<z.ZodString>;
    spaceId: z.ZodNullable<z.ZodString>;
    name: z.ZodString;
    looksAt: z.ZodNullable<z.ZodString>;
    plantIds: z.ZodArray<z.ZodString>;
    did: z.ZodNullable<z.ZodString>;
    uid: z.ZodNullable<z.ZodString>;
    ip: z.ZodNullable<z.ZodString>;
    url: z.ZodNullable<z.ZodString>;
    transport: z.ZodNullable<z.ZodEnum<{
        tcp: "tcp";
        udp: "udp";
    }>>;
    tunnel: z.ZodBoolean;
    model: z.ZodNullable<z.ZodEnum<{
        custom: "custom";
        terp_cam: "terp_cam";
        tapo_c200: "tapo_c200";
        reolink: "reolink";
        hikvision: "hikvision";
    }>>;
    stillIntervalSeconds: z.ZodNumber;
    nightOff: z.ZodBoolean;
    maintenanceOff: z.ZodBoolean;
    logErrors: z.ZodBoolean;
    staleWarning: z.ZodBoolean;
    entitlement: z.ZodObject<{
        validUntil: z.ZodNullable<z.ZodISODateTime>;
        grant: z.ZodNullable<z.ZodEnum<{
            included: "included";
            migration: "migration";
            purchase: "purchase";
        }>>;
        tier: z.ZodEnum<{
            free: "free";
            premium: "premium";
        }>;
        renewalVisible: z.ZodBoolean;
    }, z.core.$strip>;
    isDemo: z.ZodBoolean;
    removedAt: z.ZodNullable<z.ZodISODateTime>;
    state: z.ZodObject<{
        lastStillAt: z.ZodNullable<z.ZodISODateTime>;
        lastError: z.ZodNullable<z.ZodString>;
        firmwareVersion: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const cameraPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        ownerId: z.ZodString;
        kind: z.ZodEnum<{
            terpcam_controller: "terpcam_controller";
            terpcam_standalone: "terpcam_standalone";
            rtsp: "rtsp";
        }>;
        deviceId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        name: z.ZodString;
        looksAt: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
        did: z.ZodNullable<z.ZodString>;
        uid: z.ZodNullable<z.ZodString>;
        ip: z.ZodNullable<z.ZodString>;
        url: z.ZodNullable<z.ZodString>;
        transport: z.ZodNullable<z.ZodEnum<{
            tcp: "tcp";
            udp: "udp";
        }>>;
        tunnel: z.ZodBoolean;
        model: z.ZodNullable<z.ZodEnum<{
            custom: "custom";
            terp_cam: "terp_cam";
            tapo_c200: "tapo_c200";
            reolink: "reolink";
            hikvision: "hikvision";
        }>>;
        stillIntervalSeconds: z.ZodNumber;
        nightOff: z.ZodBoolean;
        maintenanceOff: z.ZodBoolean;
        logErrors: z.ZodBoolean;
        staleWarning: z.ZodBoolean;
        entitlement: z.ZodObject<{
            validUntil: z.ZodNullable<z.ZodISODateTime>;
            grant: z.ZodNullable<z.ZodEnum<{
                included: "included";
                migration: "migration";
                purchase: "purchase";
            }>>;
            tier: z.ZodEnum<{
                free: "free";
                premium: "premium";
            }>;
            renewalVisible: z.ZodBoolean;
        }, z.core.$strip>;
        isDemo: z.ZodBoolean;
        removedAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodObject<{
            lastStillAt: z.ZodNullable<z.ZodISODateTime>;
            lastError: z.ZodNullable<z.ZodString>;
            firmwareVersion: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * The Terp Cam a controller pairs. The controller reports the pairing over MQTT
 * and the protocol module upserts the row from it, so this body adopts that one
 * camera by naming its controller instead of describing the hardware.
 */
export declare const controllerCameraCreate: z.ZodObject<{
    name: z.ZodString;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    looksAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stillIntervalSeconds: z.ZodOptional<z.ZodNumber>;
    nightOff: z.ZodOptional<z.ZodBoolean>;
    maintenanceOff: z.ZodOptional<z.ZodBoolean>;
    logErrors: z.ZodOptional<z.ZodBoolean>;
    staleWarning: z.ZodOptional<z.ZodBoolean>;
    kind: z.ZodLiteral<"terpcam_controller">;
    deviceId: z.ZodString;
}, z.core.$strip>;
/**
 * A Terp Cam the cloud reaches itself, addressed by the P2P id printed on it.
 * The model and the server-side path exist; the tab that would pair one says it
 * is coming, because the flow is unproven against a camera on a desk.
 */
export declare const standaloneCameraCreate: z.ZodObject<{
    name: z.ZodString;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    looksAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stillIntervalSeconds: z.ZodOptional<z.ZodNumber>;
    nightOff: z.ZodOptional<z.ZodBoolean>;
    maintenanceOff: z.ZodOptional<z.ZodBoolean>;
    logErrors: z.ZodOptional<z.ZodBoolean>;
    staleWarning: z.ZodOptional<z.ZodBoolean>;
    kind: z.ZodLiteral<"terpcam_standalone">;
    did: z.ZodString;
}, z.core.$strip>;
/**
 * Any other camera, by the address of its stream. Creating one is never refused:
 * whether the address answers is found out by the first capture, not here.
 *
 * `url` carries the credentials the stream is opened with, which is why it is
 * spelled out rather than picked off `Camera`: the resource answers the same URL
 * with them stripped, so the two fields do not mean the same thing.
 */
export declare const rtspCameraCreate: z.ZodObject<{
    name: z.ZodString;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    looksAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stillIntervalSeconds: z.ZodOptional<z.ZodNumber>;
    nightOff: z.ZodOptional<z.ZodBoolean>;
    maintenanceOff: z.ZodOptional<z.ZodBoolean>;
    logErrors: z.ZodOptional<z.ZodBoolean>;
    staleWarning: z.ZodOptional<z.ZodBoolean>;
    transport: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        tcp: "tcp";
        udp: "udp";
    }>>>;
    tunnel: z.ZodOptional<z.ZodBoolean>;
    model: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        custom: "custom";
        terp_cam: "terp_cam";
        tapo_c200: "tapo_c200";
        reolink: "reolink";
        hikvision: "hikvision";
    }>>>;
    kind: z.ZodLiteral<"rtsp">;
    deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    url: z.ZodString;
}, z.core.$strip>;
export declare const cameraCreate: z.ZodDiscriminatedUnion<[z.ZodObject<{
    name: z.ZodString;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    looksAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stillIntervalSeconds: z.ZodOptional<z.ZodNumber>;
    nightOff: z.ZodOptional<z.ZodBoolean>;
    maintenanceOff: z.ZodOptional<z.ZodBoolean>;
    logErrors: z.ZodOptional<z.ZodBoolean>;
    staleWarning: z.ZodOptional<z.ZodBoolean>;
    kind: z.ZodLiteral<"terpcam_controller">;
    deviceId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    name: z.ZodString;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    looksAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stillIntervalSeconds: z.ZodOptional<z.ZodNumber>;
    nightOff: z.ZodOptional<z.ZodBoolean>;
    maintenanceOff: z.ZodOptional<z.ZodBoolean>;
    logErrors: z.ZodOptional<z.ZodBoolean>;
    staleWarning: z.ZodOptional<z.ZodBoolean>;
    kind: z.ZodLiteral<"terpcam_standalone">;
    did: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    name: z.ZodString;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    looksAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stillIntervalSeconds: z.ZodOptional<z.ZodNumber>;
    nightOff: z.ZodOptional<z.ZodBoolean>;
    maintenanceOff: z.ZodOptional<z.ZodBoolean>;
    logErrors: z.ZodOptional<z.ZodBoolean>;
    staleWarning: z.ZodOptional<z.ZodBoolean>;
    transport: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        tcp: "tcp";
        udp: "udp";
    }>>>;
    tunnel: z.ZodOptional<z.ZodBoolean>;
    model: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        custom: "custom";
        terp_cam: "terp_cam";
        tapo_c200: "tapo_c200";
        reolink: "reolink";
        hikvision: "hikvision";
    }>>>;
    kind: z.ZodLiteral<"rtsp">;
    deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    url: z.ZodString;
}, z.core.$strip>], "kind">;
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
export declare const cameraUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    transport: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        tcp: "tcp";
        udp: "udp";
    }>>>>;
    spaceId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    deviceId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    tunnel: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    plantIds: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    looksAt: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    model: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        custom: "custom";
        terp_cam: "terp_cam";
        tapo_c200: "tapo_c200";
        reolink: "reolink";
        hikvision: "hikvision";
    }>>>>;
    stillIntervalSeconds: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    nightOff: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    maintenanceOff: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    logErrors: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    staleWarning: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
/**
 * What `POST /cameras/{id}/test-captures` answers: one picture, taken now, so
 * that whoever is setting a camera up learns whether it answers at all. The
 * picture is stored like any other still, which is why only its id comes back.
 *
 * A camera that could not be read is reported here rather than as an error,
 * because a wrong address is an ordinary outcome of this button and the reason
 * the camera gave is what the person needs to see.
 */
export declare const testCaptureAnswer: z.ZodObject<{
    succeeded: z.ZodBoolean;
    mediaId: z.ZodNullable<z.ZodString>;
    capturedAt: z.ZodNullable<z.ZodISODateTime>;
    error: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /cameras/{id}/timelapses`, which is the composer. `window` says which
 * span is meant: `day`, `week` and `month` are worked out around `startsAt`,
 * and `phase`, `grow` and `custom` each read both ends, because where a phase
 * or a grow began is the client's to say and not a span this server can guess.
 *
 * Everything below `quality` is what the board offers and is optional, so the
 * four one-tap buttons on the camera page send a window and nothing else.
 */
export declare const timelapseCreate: z.ZodObject<{
    window: z.ZodEnum<{
        custom: "custom";
        day: "day";
        month: "month";
        week: "week";
        phase: "phase";
        grow: "grow";
    }>;
    startsAt: z.ZodOptional<z.ZodISODateTime>;
    endsAt: z.ZodOptional<z.ZodISODateTime>;
    quality: z.ZodOptional<z.ZodEnum<{
        sd: "sd";
        hd: "hd";
    }>>;
    framesPerSecond: z.ZodOptional<z.ZodNumber>;
    secondCameraId: z.ZodOptional<z.ZodString>;
    overlays: z.ZodOptional<z.ZodObject<{
        dayCounter: z.ZodOptional<z.ZodBoolean>;
        climate: z.ZodOptional<z.ZodBoolean>;
        entries: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    includeLightsOff: z.ZodOptional<z.ZodBoolean>;
    aspect: z.ZodOptional<z.ZodEnum<{
        "16_9": "16_9";
        "9_16": "9_16";
        "1_1": "1_1";
    }>>;
}, z.core.$strip>;
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
export declare const timelapseAccepted: z.ZodObject<{
    media: z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
            photo: "photo";
            still: "still";
            timelapse: "timelapse";
            avatar: "avatar";
            export: "export";
        }>;
        mime: z.ZodString;
        bytes: z.ZodNumber;
        cameraId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        uploadedBy: z.ZodNullable<z.ZodString>;
        capturedAt: z.ZodISODateTime;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
        window: z.ZodNullable<z.ZodEnum<{
            custom: "custom";
            day: "day";
            month: "month";
            week: "week";
            phase: "phase";
            grow: "grow";
        }>>;
        quality: z.ZodNullable<z.ZodEnum<{
            sd: "sd";
            hd: "hd";
        }>>;
        lengthSeconds: z.ZodNullable<z.ZodNumber>;
        render: z.ZodNullable<z.ZodObject<{
            status: z.ZodEnum<{
                failed: "failed";
                ready: "ready";
                queued: "queued";
                rendering: "rendering";
            }>;
            framesPerSecond: z.ZodNumber;
            watermark: z.ZodBoolean;
            aspect: z.ZodEnum<{
                "16_9": "16_9";
                "9_16": "9_16";
                "1_1": "1_1";
            }>;
            overlays: z.ZodObject<{
                dayCounter: z.ZodBoolean;
                climate: z.ZodBoolean;
                entries: z.ZodBoolean;
            }, z.core.$strip>;
            includeLightsOff: z.ZodBoolean;
            secondCameraId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodNullable<z.ZodISODateTime>;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            error: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        exportJob: z.ZodNullable<z.ZodObject<{
            status: z.ZodEnum<{
                failed: "failed";
                ready: "ready";
                queued: "queued";
                rendering: "rendering";
            }>;
            scope: z.ZodEnum<{
                grow: "grow";
                account: "account";
            }>;
            growId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodNullable<z.ZodISODateTime>;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            error: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    queued: z.ZodBoolean;
}, z.core.$strip>;
/** Which shipped asset a scheme was made from, and at which version of it. */
export declare const schemeOrigin: z.ZodObject<{
    assetId: z.ZodNullable<z.ZodString>;
    version: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * A person's own feeding scheme. The grid is the same table a grow carries, so
 * that editing a scheme here and reading it back off a grow speak one language;
 * a grow keeps its own copy, which is what leaves its history alone when this
 * one is edited later.
 */
export declare const scheme: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    ownerId: z.ZodString;
    name: z.ZodString;
    origin: z.ZodObject<{
        assetId: z.ZodNullable<z.ZodString>;
        version: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    grid: z.ZodArray<z.ZodObject<{
        week: z.ZodNumber;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        ecTarget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        amounts: z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            value: z.ZodNullable<z.ZodNumber>;
            unit: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const schemePage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        ownerId: z.ZodString;
        name: z.ZodString;
        origin: z.ZodObject<{
            assetId: z.ZodNullable<z.ZodString>;
            version: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        grid: z.ZodArray<z.ZodObject<{
            week: z.ZodNumber;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            ecTarget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            amounts: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                value: z.ZodNullable<z.ZodNumber>;
                unit: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /schemes`. `origin` is left out by somebody writing a scheme of their
 * own and filled in by a client that started from a shipped asset, which is the
 * only way the server learns of one: it never reads an asset itself.
 */
export declare const schemeCreate: z.ZodObject<{
    name: z.ZodString;
    origin: z.ZodOptional<z.ZodObject<{
        assetId: z.ZodNullable<z.ZodString>;
        version: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    grid: z.ZodArray<z.ZodObject<{
        week: z.ZodNumber;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        ecTarget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        amounts: z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            value: z.ZodNullable<z.ZodNumber>;
            unit: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** `PATCH /schemes/{id}`: the same fields, each only if it changes. */
export declare const schemeUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    origin: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        assetId: z.ZodNullable<z.ZodString>;
        version: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
    grid: z.ZodOptional<z.ZodArray<z.ZodObject<{
        week: z.ZodNumber;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        ecTarget: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        amounts: z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            value: z.ZodNullable<z.ZodNumber>;
            unit: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/**
 * A span. Either end may be open, which is what `null` says; a share link's
 * range and a saved chart view both use it.
 */
export declare const timeRange: z.ZodObject<{
    startsAt: z.ZodNullable<z.ZodISODateTime>;
    endsAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
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
export declare const chartViewSpan: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"last">;
    forSeconds: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"fixed">;
    range: z.ZodObject<{
        startsAt: z.ZodNullable<z.ZodISODateTime>;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"phase">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"grow">;
}, z.core.$strip>], "kind">;
/**
 * How the panels are drawn: one per series, all on shared axes, or counted in
 * days since the grow began rather than in dates, which is what makes two runs
 * of the same tent comparable.
 */
export declare const chartViewLayout: z.ZodEnum<{
    overlay: "overlay";
    stacked: "stacked";
    day_of_grow: "day_of_grow";
}>;
/**
 * What a saved chart draws, structured rather than the query string the old app
 * saved.
 *
 * Climate and outputs come out of the device's store and `measurements` out of
 * the diary, but a view names all three the same way: what somebody picked off
 * the chip bar is one list of series to them, and which store answers each is
 * the reader's business rather than the saved view's.
 */
export declare const chartViewDefinition: z.ZodObject<{
    deviceIds: z.ZodArray<z.ZodString>;
    growId: z.ZodNullable<z.ZodString>;
    metrics: z.ZodArray<z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>>;
    outputs: z.ZodArray<z.ZodEnum<{
        dehumidifier: "dehumidifier";
        heater: "heater";
        light: "light";
        co2: "co2";
        fan: "fan";
        relais: "relais";
        fanInternal: "fanInternal";
        fanExternal: "fanExternal";
        fanBackwall: "fanBackwall";
    }>>;
    measurements: z.ZodArray<z.ZodString>;
    span: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"last">;
        forSeconds: z.ZodNumber;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"fixed">;
        range: z.ZodObject<{
            startsAt: z.ZodNullable<z.ZodISODateTime>;
            endsAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"phase">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"grow">;
    }, z.core.$strip>], "kind">;
    layout: z.ZodEnum<{
        overlay: "overlay";
        stacked: "stacked";
        day_of_grow: "day_of_grow";
    }>;
    intervalSeconds: z.ZodNumber;
}, z.core.$strip>;
export declare const chartView: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    ownerId: z.ZodString;
    name: z.ZodString;
    definition: z.ZodObject<{
        deviceIds: z.ZodArray<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        metrics: z.ZodArray<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>>;
        outputs: z.ZodArray<z.ZodEnum<{
            dehumidifier: "dehumidifier";
            heater: "heater";
            light: "light";
            co2: "co2";
            fan: "fan";
            relais: "relais";
            fanInternal: "fanInternal";
            fanExternal: "fanExternal";
            fanBackwall: "fanBackwall";
        }>>;
        measurements: z.ZodArray<z.ZodString>;
        span: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"last">;
            forSeconds: z.ZodNumber;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"fixed">;
            range: z.ZodObject<{
                startsAt: z.ZodNullable<z.ZodISODateTime>;
                endsAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"grow">;
        }, z.core.$strip>], "kind">;
        layout: z.ZodEnum<{
            overlay: "overlay";
            stacked: "stacked";
            day_of_grow: "day_of_grow";
        }>;
        intervalSeconds: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const chartViewPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        ownerId: z.ZodString;
        name: z.ZodString;
        definition: z.ZodObject<{
            deviceIds: z.ZodArray<z.ZodString>;
            growId: z.ZodNullable<z.ZodString>;
            metrics: z.ZodArray<z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>>;
            outputs: z.ZodArray<z.ZodEnum<{
                dehumidifier: "dehumidifier";
                heater: "heater";
                light: "light";
                co2: "co2";
                fan: "fan";
                relais: "relais";
                fanInternal: "fanInternal";
                fanExternal: "fanExternal";
                fanBackwall: "fanBackwall";
            }>>;
            measurements: z.ZodArray<z.ZodString>;
            span: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"last">;
                forSeconds: z.ZodNumber;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"fixed">;
                range: z.ZodObject<{
                    startsAt: z.ZodNullable<z.ZodISODateTime>;
                    endsAt: z.ZodNullable<z.ZodISODateTime>;
                }, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"phase">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"grow">;
            }, z.core.$strip>], "kind">;
            layout: z.ZodEnum<{
                overlay: "overlay";
                stacked: "stacked";
                day_of_grow: "day_of_grow";
            }>;
            intervalSeconds: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** `POST /chart-views`. A view is its name and what it draws; nothing else is stored. */
export declare const chartViewCreate: z.ZodObject<{
    name: z.ZodString;
    definition: z.ZodObject<{
        deviceIds: z.ZodArray<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        metrics: z.ZodArray<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>>;
        outputs: z.ZodArray<z.ZodEnum<{
            dehumidifier: "dehumidifier";
            heater: "heater";
            light: "light";
            co2: "co2";
            fan: "fan";
            relais: "relais";
            fanInternal: "fanInternal";
            fanExternal: "fanExternal";
            fanBackwall: "fanBackwall";
        }>>;
        measurements: z.ZodArray<z.ZodString>;
        span: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"last">;
            forSeconds: z.ZodNumber;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"fixed">;
            range: z.ZodObject<{
                startsAt: z.ZodNullable<z.ZodISODateTime>;
                endsAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"grow">;
        }, z.core.$strip>], "kind">;
        layout: z.ZodEnum<{
            overlay: "overlay";
            stacked: "stacked";
            day_of_grow: "day_of_grow";
        }>;
        intervalSeconds: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
/** `PATCH /chart-views/{id}`: the same two, each only if it changes. */
export declare const chartViewUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    definition: z.ZodOptional<z.ZodObject<{
        deviceIds: z.ZodArray<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        metrics: z.ZodArray<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>>;
        outputs: z.ZodArray<z.ZodEnum<{
            dehumidifier: "dehumidifier";
            heater: "heater";
            light: "light";
            co2: "co2";
            fan: "fan";
            relais: "relais";
            fanInternal: "fanInternal";
            fanExternal: "fanExternal";
            fanBackwall: "fanBackwall";
        }>>;
        measurements: z.ZodArray<z.ZodString>;
        span: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"last">;
            forSeconds: z.ZodNumber;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"fixed">;
            range: z.ZodObject<{
                startsAt: z.ZodNullable<z.ZodISODateTime>;
                endsAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"grow">;
        }, z.core.$strip>], "kind">;
        layout: z.ZodEnum<{
            overlay: "overlay";
            stacked: "stacked";
            day_of_grow: "day_of_grow";
        }>;
        intervalSeconds: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const shareLinkState: z.ZodObject<{
    openCount: z.ZodNumber;
    lastOpenedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * `token` is the secret the link is opened with and is separate from `id`, so
 * that a link can be listed, patched and revoked by an id that is not a secret.
 * It is on the wire for whoever may manage the link, because sharing the link is
 * the point of it; what is read *through* the link never carries it.
 *
 * Every read through a link is clamped to `range`.
 */
export declare const shareLink: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    token: z.ZodString;
    kind: z.ZodEnum<{
        view: "view";
        public_page: "public_page";
    }>;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    range: z.ZodObject<{
        startsAt: z.ZodNullable<z.ZodISODateTime>;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
    includeCameras: z.ZodBoolean;
    createdBy: z.ZodString;
    expiresAt: z.ZodNullable<z.ZodISODateTime>;
    revokedAt: z.ZodNullable<z.ZodISODateTime>;
    state: z.ZodObject<{
        openCount: z.ZodNumber;
        lastOpenedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const shareLinkPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        token: z.ZodString;
        kind: z.ZodEnum<{
            view: "view";
            public_page: "public_page";
        }>;
        subject: z.ZodObject<{
            type: z.ZodEnum<{
                grow: "grow";
                space: "space";
            }>;
            id: z.ZodString;
        }, z.core.$strip>;
        range: z.ZodObject<{
            startsAt: z.ZodNullable<z.ZodISODateTime>;
            endsAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
        includeCameras: z.ZodBoolean;
        createdBy: z.ZodString;
        expiresAt: z.ZodNullable<z.ZodISODateTime>;
        revokedAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodObject<{
            openCount: z.ZodNumber;
            lastOpenedAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /share-links`. The token, the counters and who made the link are the
 * server's. A `range` with an open end is a link that keeps up with a grow as it
 * goes on, which is what sharing a running diary means.
 */
export declare const shareLinkCreate: z.ZodObject<{
    expiresAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    kind: z.ZodEnum<{
        view: "view";
        public_page: "public_page";
    }>;
    range: z.ZodOptional<z.ZodObject<{
        startsAt: z.ZodNullable<z.ZodISODateTime>;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    includeCameras: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * `PATCH /share-links/{id}`: what may still be changed once a link is out of the
 * house. Not `kind` and not `subject`: the address is in somebody else's hands,
 * and repointing it would show them something they were never sent. Narrowing
 * the range or taking the cameras back out is what this is for; ending the link
 * altogether is `PUT /share-links/{id}/revocation`.
 */
export declare const shareLinkUpdate: z.ZodObject<{
    expiresAt: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>>;
    range: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        startsAt: z.ZodNullable<z.ZodISODateTime>;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>>;
    includeCameras: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
/**
 * One migration that has run. The record is what makes a migration run once and
 * what an operator reads afterwards, so `stats` keeps whatever the migration
 * counted - rows moved, rows skipped - and is not typed here: every migration
 * counts something else.
 */
export declare const migration: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    name: z.ZodString;
    appliedAt: z.ZodISODateTime;
    durationMs: z.ZodNumber;
    stats: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strip>;
export declare const migrationPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        name: z.ZodString;
        appliedAt: z.ZodISODateTime;
        durationMs: z.ZodNumber;
        stats: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * A metric as a card draws it: the one `MetricValue` with the metric it belongs
 * to written into it, because a card carries a list of them while a device read
 * answers a map keyed by metric.
 */
export declare const cardValue: z.ZodObject<{
    value: z.ZodNullable<z.ZodNumber>;
    measuredAt: z.ZodNullable<z.ZodISODateTime>;
    state: z.ZodEnum<{
        offline: "offline";
        live: "live";
        stale: "stale";
    }>;
    metric: z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>;
}, z.core.$strip>;
/**
 * What the controller is aiming at right now, for the metrics it steers, and
 * how far a reading may stray from it and still count as on target. The band is
 * `TARGET_BAND` stated on the wire, so the figure beside a value and the
 * verdict's "in band" are judged by the same width and no client keeps a width
 * of its own.
 */
export declare const cardSetpoint: z.ZodObject<{
    metric: z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>;
    value: z.ZodNullable<z.ZodNumber>;
    band: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/** The newest picture of a space, as a card shows it. */
export declare const latestStill: z.ZodObject<{
    mediaId: z.ZodString;
    cameraId: z.ZodString;
    capturedAt: z.ZodISODateTime;
}, z.core.$strip>;
/**
 * A day of one metric, the size of a stamp: what a card draws beside its figures
 * to say "steady" or "not". It rides on the card rather than being fetched per
 * card, so a club's home is one request however many places it has.
 */
export declare const cardTrend: z.ZodObject<{
    metric: z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>;
    stepSeconds: z.ZodNumber;
    endsAt: z.ZodISODateTime;
    points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
/**
 * A task as a card lists it. Tasks are derived from reminders, the scheme grid
 * and the plan rather than stored, and their ids are deterministic - which is
 * how completing one, an entry carrying that `taskId`, keeps it from coming back.
 *
 * What it is about is the same reference `Task` carries, so a card and the task
 * list say it one way.
 */
export declare const dueTask: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        custom: "custom";
        water: "water";
        feed: "feed";
        chore: "chore";
    }>;
    label: z.ZodString;
    dueAt: z.ZodISODateTime;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    assigneeId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** An alert as a card lists it; `GET /alerts` answers the alert itself. */
export declare const openAlert: z.ZodObject<{
    alertId: z.ZodString;
    kind: z.ZodEnum<{
        threshold: "threshold";
        offline: "offline";
        camera_stale: "camera_stale";
    }>;
    severity: z.ZodEnum<{
        critical: "critical";
        warning: "warning";
        info: "info";
    }>;
    startedAt: z.ZodISODateTime;
    value: z.ZodNullable<z.ZodNumber>;
    metric: z.ZodNullable<z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>>;
}, z.core.$strip>;
/** One group of a split, as a card counts it: `GrowSummary.groups` names the plants instead. */
export declare const growCardStageGroup: z.ZodObject<{
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    plantCount: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * The grow as a card draws it: the day counter, the phase headline and the "auto"
 * tag, all computed from `phases[]` in the grow serialiser. `stageGroups` is
 * filled only when the plants are not all in the same phase, which is what a
 * split leaves behind.
 */
export declare const growCard: z.ZodObject<{
    growId: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>;
    dayNumber: z.ZodNullable<z.ZodNumber>;
    phaseDay: z.ZodNullable<z.ZodNumber>;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    preset: z.ZodNullable<z.ZodString>;
    isAuto: z.ZodBoolean;
    plantCount: z.ZodNullable<z.ZodNumber>;
    strains: z.ZodArray<z.ZodString>;
    coverMediaId: z.ZodNullable<z.ZodString>;
    stageGroups: z.ZodArray<z.ZodObject<{
        stage: z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>;
        plantCount: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * One space, with everything the home screen shows about it - or, where the
 * ids are null, one open grow that stands in no space at all. A grow is
 * first-class without a place, so "no fixed place" is a card rather than a
 * hole in the home, and the app opens it at the grow because there is no space
 * page to open.
 */
export declare const homeSpaceCard: z.ZodObject<{
    spaceId: z.ZodNullable<z.ZodString>;
    name: z.ZodString;
    kind: z.ZodNullable<z.ZodEnum<{
        other: "other";
        tent: "tent";
        fridge: "fridge";
        room: "room";
        balcony: "balcony";
    }>>;
    roomId: z.ZodNullable<z.ZodString>;
    deviceIds: z.ZodArray<z.ZodString>;
    values: z.ZodArray<z.ZodObject<{
        value: z.ZodNullable<z.ZodNumber>;
        measuredAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodEnum<{
            offline: "offline";
            live: "live";
            stale: "stale";
        }>;
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
    }, z.core.$strip>>;
    setpoints: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        value: z.ZodNullable<z.ZodNumber>;
        band: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    trend: z.ZodNullable<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        stepSeconds: z.ZodNumber;
        endsAt: z.ZodISODateTime;
        points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
    grow: z.ZodNullable<z.ZodObject<{
        growId: z.ZodString;
        name: z.ZodString;
        type: z.ZodEnum<{
            photoperiod: "photoperiod";
            autoflower: "autoflower";
        }>;
        dayNumber: z.ZodNullable<z.ZodNumber>;
        phaseDay: z.ZodNullable<z.ZodNumber>;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        isAuto: z.ZodBoolean;
        plantCount: z.ZodNullable<z.ZodNumber>;
        strains: z.ZodArray<z.ZodString>;
        coverMediaId: z.ZodNullable<z.ZodString>;
        stageGroups: z.ZodArray<z.ZodObject<{
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            plantCount: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
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
        occurredAt: z.ZodISODateTime;
        source: z.ZodEnum<{
            alarm: "alarm";
            plan: "plan";
            human: "human";
            device: "device";
            preset: "preset";
        }>;
        authorId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        deviceId: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        taskId: z.ZodNullable<z.ZodString>;
        alertId: z.ZodNullable<z.ZodString>;
        severity: z.ZodNullable<z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>>;
        text: z.ZodNullable<z.ZodString>;
        message: z.ZodNullable<z.ZodObject<{
            key: z.ZodString;
            params: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        values: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"water">;
            litres: z.ZodNullable<z.ZodNumber>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"feed">;
            litres: z.ZodNullable<z.ZodNumber>;
            schemeWeek: z.ZodNullable<z.ZodNumber>;
            doses: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                amount: z.ZodNumber;
                unit: z.ZodString;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"measurement">;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"photo">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"note">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"training">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"visit">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"system">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"alarm">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
            phaseId: z.ZodString;
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            preset: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            placementId: z.ZodString;
            spaceId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"harvest">;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"plan">;
            planId: z.ZodString;
            stepIndex: z.ZodNumber;
            transition: z.ZodNullable<z.ZodEnum<{
                pause: "pause";
                resume: "resume";
                confirm: "confirm";
                extend: "extend";
                skip: "skip";
            }>>;
        }, z.core.$strip>], "kind">;
        mediaIds: z.ZodArray<z.ZodString>;
        undoUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    latestStill: z.ZodNullable<z.ZodObject<{
        mediaId: z.ZodString;
        cameraId: z.ZodString;
        capturedAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    dueTasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            custom: "custom";
            water: "water";
            feed: "feed";
            chore: "chore";
        }>;
        label: z.ZodString;
        dueAt: z.ZodISODateTime;
        subject: z.ZodObject<{
            type: z.ZodEnum<{
                grow: "grow";
                space: "space";
            }>;
            id: z.ZodString;
        }, z.core.$strip>;
        assigneeId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    openAlerts: z.ZodArray<z.ZodObject<{
        alertId: z.ZodString;
        kind: z.ZodEnum<{
            threshold: "threshold";
            offline: "offline";
            camera_stale: "camera_stale";
        }>;
        severity: z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>;
        startedAt: z.ZodISODateTime;
        value: z.ZodNullable<z.ZodNumber>;
        metric: z.ZodNullable<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** A grow somebody follows: a public grow, so only what its public page shows. */
export declare const followedGrowCard: z.ZodObject<{
    growId: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
    handle: z.ZodString;
    dayNumber: z.ZodNullable<z.ZodNumber>;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    coverMediaId: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare const homeAnswer: z.ZodObject<{
    spaces: z.ZodArray<z.ZodObject<{
        spaceId: z.ZodNullable<z.ZodString>;
        name: z.ZodString;
        kind: z.ZodNullable<z.ZodEnum<{
            other: "other";
            tent: "tent";
            fridge: "fridge";
            room: "room";
            balcony: "balcony";
        }>>;
        roomId: z.ZodNullable<z.ZodString>;
        deviceIds: z.ZodArray<z.ZodString>;
        values: z.ZodArray<z.ZodObject<{
            value: z.ZodNullable<z.ZodNumber>;
            measuredAt: z.ZodNullable<z.ZodISODateTime>;
            state: z.ZodEnum<{
                offline: "offline";
                live: "live";
                stale: "stale";
            }>;
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
        }, z.core.$strip>>;
        setpoints: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            value: z.ZodNullable<z.ZodNumber>;
            band: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        trend: z.ZodNullable<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            stepSeconds: z.ZodNumber;
            endsAt: z.ZodISODateTime;
            points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strip>>;
        grow: z.ZodNullable<z.ZodObject<{
            growId: z.ZodString;
            name: z.ZodString;
            type: z.ZodEnum<{
                photoperiod: "photoperiod";
                autoflower: "autoflower";
            }>;
            dayNumber: z.ZodNullable<z.ZodNumber>;
            phaseDay: z.ZodNullable<z.ZodNumber>;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            preset: z.ZodNullable<z.ZodString>;
            isAuto: z.ZodBoolean;
            plantCount: z.ZodNullable<z.ZodNumber>;
            strains: z.ZodArray<z.ZodString>;
            coverMediaId: z.ZodNullable<z.ZodString>;
            stageGroups: z.ZodArray<z.ZodObject<{
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                plantCount: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        entries: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            createdAt: z.ZodISODateTime;
            kind: z.ZodEnum<{
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
            occurredAt: z.ZodISODateTime;
            source: z.ZodEnum<{
                alarm: "alarm";
                plan: "plan";
                human: "human";
                device: "device";
                preset: "preset";
            }>;
            authorId: z.ZodNullable<z.ZodString>;
            growId: z.ZodNullable<z.ZodString>;
            spaceId: z.ZodNullable<z.ZodString>;
            deviceId: z.ZodNullable<z.ZodString>;
            plantIds: z.ZodArray<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            taskId: z.ZodNullable<z.ZodString>;
            alertId: z.ZodNullable<z.ZodString>;
            severity: z.ZodNullable<z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>>;
            text: z.ZodNullable<z.ZodString>;
            message: z.ZodNullable<z.ZodObject<{
                key: z.ZodString;
                params: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"water">;
                litres: z.ZodNullable<z.ZodNumber>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"feed">;
                litres: z.ZodNullable<z.ZodNumber>;
                schemeWeek: z.ZodNullable<z.ZodNumber>;
                doses: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    amount: z.ZodNumber;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"measurement">;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"photo">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"note">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"training">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"visit">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"system">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"alarm">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"phase">;
                phaseId: z.ZodString;
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                preset: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                placementId: z.ZodString;
                spaceId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"harvest">;
                wetWeightG: z.ZodNullable<z.ZodNumber>;
                dryWeightG: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plan">;
                planId: z.ZodString;
                stepIndex: z.ZodNumber;
                transition: z.ZodNullable<z.ZodEnum<{
                    pause: "pause";
                    resume: "resume";
                    confirm: "confirm";
                    extend: "extend";
                    skip: "skip";
                }>>;
            }, z.core.$strip>], "kind">;
            mediaIds: z.ZodArray<z.ZodString>;
            undoUntil: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
        latestStill: z.ZodNullable<z.ZodObject<{
            mediaId: z.ZodString;
            cameraId: z.ZodString;
            capturedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
        dueTasks: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                custom: "custom";
                water: "water";
                feed: "feed";
                chore: "chore";
            }>;
            label: z.ZodString;
            dueAt: z.ZodISODateTime;
            subject: z.ZodObject<{
                type: z.ZodEnum<{
                    grow: "grow";
                    space: "space";
                }>;
                id: z.ZodString;
            }, z.core.$strip>;
            assigneeId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        openAlerts: z.ZodArray<z.ZodObject<{
            alertId: z.ZodString;
            kind: z.ZodEnum<{
                threshold: "threshold";
                offline: "offline";
                camera_stale: "camera_stale";
            }>;
            severity: z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>;
            startedAt: z.ZodISODateTime;
            value: z.ZodNullable<z.ZodNumber>;
            metric: z.ZodNullable<z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    followedGrows: z.ZodArray<z.ZodObject<{
        growId: z.ZodString;
        slug: z.ZodString;
        name: z.ZodString;
        handle: z.ZodString;
        dayNumber: z.ZodNullable<z.ZodNumber>;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        coverMediaId: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        handle: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const verdictRating: z.ZodEnum<{
    watch: "watch";
    good: "good";
    poor: "poor";
}>;
/** A target widened by `TARGET_BAND`: what a chart shades green and a verdict counts time inside. */
export declare const targetBand: z.ZodObject<{
    low: z.ZodNumber;
    high: z.ZodNumber;
}, z.core.$strip>;
/**
 * One run outside the band, which is what "1 humidity excursion 02:10–05:30"
 * names. `endedAt` is null for a run that was still going when the window
 * ended - it has not ended, and saying so is not the same as ending it now.
 */
export declare const climateExcursion: z.ZodObject<{
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    above: z.ZodBoolean;
    extremeValue: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * How one metric did over the window, against the band its target sets. Day and
 * night are told apart by the light output and each half is judged against its
 * own band, which is why both are answered.
 *
 * The two counts are over the windows that held a reading: a device that was
 * quiet adds to neither, so together they are the time that is known about
 * rather than always the whole window.
 */
export declare const climateVerdictMetric: z.ZodObject<{
    metric: z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>;
    rating: z.ZodNullable<z.ZodEnum<{
        watch: "watch";
        good: "good";
        poor: "poor";
    }>>;
    minValue: z.ZodNullable<z.ZodNumber>;
    maxValue: z.ZodNullable<z.ZodNumber>;
    averageValue: z.ZodNullable<z.ZodNumber>;
    dayBand: z.ZodNullable<z.ZodObject<{
        low: z.ZodNumber;
        high: z.ZodNumber;
    }, z.core.$strip>>;
    nightBand: z.ZodNullable<z.ZodObject<{
        low: z.ZodNumber;
        high: z.ZodNumber;
    }, z.core.$strip>>;
    inBandSeconds: z.ZodNumber;
    outOfBandSeconds: z.ZodNumber;
    excursions: z.ZodArray<z.ZodObject<{
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        above: z.ZodBoolean;
        extremeValue: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * How often one output came on over the window, which is what "dehumidifier ran
 * 14×" counts. A run is one reading showing it on after one showed it off, so an
 * output stays what it was last reported to be across the windows that hold no
 * reading, and a device that reported nothing about an output at all has no row
 * here rather than a row of zeroes.
 */
export declare const actuatorRuns: z.ZodObject<{
    output: z.ZodEnum<{
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
    runCount: z.ZodNumber;
    forSeconds: z.ZodNumber;
}, z.core.$strip>;
/**
 * The 24 h verdict, from one aggregation over the window: the share of the time
 * inside the band, the runs that left it, and how often each actuator came on.
 *
 * `rating` is the worst of the metrics, which is what the headline says.
 * `stepSeconds` is the resolution the whole of it is stated at - an excursion
 * shorter than one window, and an actuator that switched twice inside one, are
 * not in the points that were read.
 */
export declare const climateVerdict: z.ZodObject<{
    deviceId: z.ZodNullable<z.ZodString>;
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    forSeconds: z.ZodNumber;
    stepSeconds: z.ZodNumber;
    rating: z.ZodNullable<z.ZodEnum<{
        watch: "watch";
        good: "good";
        poor: "poor";
    }>>;
    inBandFraction: z.ZodNullable<z.ZodNumber>;
    metrics: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        rating: z.ZodNullable<z.ZodEnum<{
            watch: "watch";
            good: "good";
            poor: "poor";
        }>>;
        minValue: z.ZodNullable<z.ZodNumber>;
        maxValue: z.ZodNullable<z.ZodNumber>;
        averageValue: z.ZodNullable<z.ZodNumber>;
        dayBand: z.ZodNullable<z.ZodObject<{
            low: z.ZodNumber;
            high: z.ZodNumber;
        }, z.core.$strip>>;
        nightBand: z.ZodNullable<z.ZodObject<{
            low: z.ZodNumber;
            high: z.ZodNumber;
        }, z.core.$strip>>;
        inBandSeconds: z.ZodNumber;
        outOfBandSeconds: z.ZodNumber;
        excursions: z.ZodArray<z.ZodObject<{
            startedAt: z.ZodISODateTime;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            above: z.ZodBoolean;
            extremeValue: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    actuators: z.ZodArray<z.ZodObject<{
        output: z.ZodEnum<{
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
        runCount: z.ZodNumber;
        forSeconds: z.ZodNumber;
    }, z.core.$strip>>;
    trend: z.ZodNullable<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        stepSeconds: z.ZodNumber;
        endsAt: z.ZodISODateTime;
        points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One picture of a camera, as the day's strip draws it: the camera is the row it sits in. */
export declare const cameraStill: z.ZodObject<{
    mediaId: z.ZodString;
    capturedAt: z.ZodISODateTime;
}, z.core.$strip>;
/** A camera of the space and the day it has taken so far. */
export declare const overviewCamera: z.ZodObject<{
    cameraId: z.ZodString;
    name: z.ZodString;
    lastStillAt: z.ZodNullable<z.ZodISODateTime>;
    stills: z.ZodArray<z.ZodObject<{
        mediaId: z.ZodString;
        capturedAt: z.ZodISODateTime;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * A grow standing in this space. The card the home draws, and what is true of it
 * *here*: a grow moves between tents, so the day it arrived is not the day it
 * started.
 */
export declare const overviewGrow: z.ZodObject<{
    growId: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>;
    dayNumber: z.ZodNullable<z.ZodNumber>;
    phaseDay: z.ZodNullable<z.ZodNumber>;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    preset: z.ZodNullable<z.ZodString>;
    isAuto: z.ZodBoolean;
    plantCount: z.ZodNullable<z.ZodNumber>;
    strains: z.ZodArray<z.ZodString>;
    coverMediaId: z.ZodNullable<z.ZodString>;
    stageGroups: z.ZodArray<z.ZodObject<{
        stage: z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>;
        plantCount: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    weekNumber: z.ZodNullable<z.ZodNumber>;
    placedAt: z.ZodISODateTime;
    placedOnDay: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * A due task with what its completion would be written with, so the Done button
 * on the card needs nothing else read and can say what it is about to log.
 * `POST /tasks/{id}/completions` takes these same values, and a completion that
 * names none takes them from the task.
 */
export declare const overviewTask: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        custom: "custom";
        water: "water";
        feed: "feed";
        chore: "chore";
    }>;
    label: z.ZodString;
    dueAt: z.ZodISODateTime;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    assigneeId: z.ZodNullable<z.ZodString>;
    defaults: z.ZodAny;
}, z.core.$strip>;
/**
 * What the space's controller is aiming at in both halves of the cycle.
 * `SpaceOverview.setpoints` is the half it is in right now, which is what a
 * value is drawn against; this is the pair the header states, and the bands the
 * verdict judges against are these widened by `TARGET_BAND`.
 */
export declare const overviewTargets: z.ZodObject<{
    day: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        value: z.ZodNullable<z.ZodNumber>;
        band: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    night: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        value: z.ZodNullable<z.ZodNumber>;
        band: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * `GET /spaces/{id}/overview`, the tent page's landing tab: what is true here
 * now, what needs a human, what grows here, what the cameras saw today, how the
 * last 24 hours went and what was last written.
 *
 * It is the home card of that space with the four things a page has room for
 * that a card does not - the verdict, the day's pictures, every grow rather
 * than the headline one, and enough of a due task to tick it off.
 */
export declare const spaceOverview: z.ZodObject<{
    spaceId: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        other: "other";
        tent: "tent";
        fridge: "fridge";
        room: "room";
        balcony: "balcony";
    }>;
    roomId: z.ZodNullable<z.ZodString>;
    deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
    values: z.ZodArray<z.ZodObject<{
        value: z.ZodNullable<z.ZodNumber>;
        measuredAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodEnum<{
            offline: "offline";
            live: "live";
            stale: "stale";
        }>;
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
    }, z.core.$strip>>;
    setpoints: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        value: z.ZodNullable<z.ZodNumber>;
        band: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    targets: z.ZodNullable<z.ZodObject<{
        day: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            value: z.ZodNullable<z.ZodNumber>;
            band: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        night: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            value: z.ZodNullable<z.ZodNumber>;
            band: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    verdict: z.ZodObject<{
        deviceId: z.ZodNullable<z.ZodString>;
        startsAt: z.ZodISODateTime;
        endsAt: z.ZodISODateTime;
        forSeconds: z.ZodNumber;
        stepSeconds: z.ZodNumber;
        rating: z.ZodNullable<z.ZodEnum<{
            watch: "watch";
            good: "good";
            poor: "poor";
        }>>;
        inBandFraction: z.ZodNullable<z.ZodNumber>;
        metrics: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            rating: z.ZodNullable<z.ZodEnum<{
                watch: "watch";
                good: "good";
                poor: "poor";
            }>>;
            minValue: z.ZodNullable<z.ZodNumber>;
            maxValue: z.ZodNullable<z.ZodNumber>;
            averageValue: z.ZodNullable<z.ZodNumber>;
            dayBand: z.ZodNullable<z.ZodObject<{
                low: z.ZodNumber;
                high: z.ZodNumber;
            }, z.core.$strip>>;
            nightBand: z.ZodNullable<z.ZodObject<{
                low: z.ZodNumber;
                high: z.ZodNumber;
            }, z.core.$strip>>;
            inBandSeconds: z.ZodNumber;
            outOfBandSeconds: z.ZodNumber;
            excursions: z.ZodArray<z.ZodObject<{
                startedAt: z.ZodISODateTime;
                endedAt: z.ZodNullable<z.ZodISODateTime>;
                above: z.ZodBoolean;
                extremeValue: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        actuators: z.ZodArray<z.ZodObject<{
            output: z.ZodEnum<{
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
            runCount: z.ZodNumber;
            forSeconds: z.ZodNumber;
        }, z.core.$strip>>;
        trend: z.ZodNullable<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            stepSeconds: z.ZodNumber;
            endsAt: z.ZodISODateTime;
            points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    grows: z.ZodArray<z.ZodObject<{
        growId: z.ZodString;
        name: z.ZodString;
        type: z.ZodEnum<{
            photoperiod: "photoperiod";
            autoflower: "autoflower";
        }>;
        dayNumber: z.ZodNullable<z.ZodNumber>;
        phaseDay: z.ZodNullable<z.ZodNumber>;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        isAuto: z.ZodBoolean;
        plantCount: z.ZodNullable<z.ZodNumber>;
        strains: z.ZodArray<z.ZodString>;
        coverMediaId: z.ZodNullable<z.ZodString>;
        stageGroups: z.ZodArray<z.ZodObject<{
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            plantCount: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        weekNumber: z.ZodNullable<z.ZodNumber>;
        placedAt: z.ZodISODateTime;
        placedOnDay: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    cameras: z.ZodArray<z.ZodObject<{
        cameraId: z.ZodString;
        name: z.ZodString;
        lastStillAt: z.ZodNullable<z.ZodISODateTime>;
        stills: z.ZodArray<z.ZodObject<{
            mediaId: z.ZodString;
            capturedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
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
        occurredAt: z.ZodISODateTime;
        source: z.ZodEnum<{
            alarm: "alarm";
            plan: "plan";
            human: "human";
            device: "device";
            preset: "preset";
        }>;
        authorId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        deviceId: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        taskId: z.ZodNullable<z.ZodString>;
        alertId: z.ZodNullable<z.ZodString>;
        severity: z.ZodNullable<z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>>;
        text: z.ZodNullable<z.ZodString>;
        message: z.ZodNullable<z.ZodObject<{
            key: z.ZodString;
            params: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        values: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"water">;
            litres: z.ZodNullable<z.ZodNumber>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"feed">;
            litres: z.ZodNullable<z.ZodNumber>;
            schemeWeek: z.ZodNullable<z.ZodNumber>;
            doses: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                amount: z.ZodNumber;
                unit: z.ZodString;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"measurement">;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"photo">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"note">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"training">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"visit">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"system">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"alarm">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
            phaseId: z.ZodString;
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            preset: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            placementId: z.ZodString;
            spaceId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"harvest">;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"plan">;
            planId: z.ZodString;
            stepIndex: z.ZodNumber;
            transition: z.ZodNullable<z.ZodEnum<{
                pause: "pause";
                resume: "resume";
                confirm: "confirm";
                extend: "extend";
                skip: "skip";
            }>>;
        }, z.core.$strip>], "kind">;
        mediaIds: z.ZodArray<z.ZodString>;
        undoUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    readingNames: z.ZodArray<z.ZodObject<{
        growId: z.ZodString;
        readings: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            name: z.ZodString;
            unit: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    dueTasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            custom: "custom";
            water: "water";
            feed: "feed";
            chore: "chore";
        }>;
        label: z.ZodString;
        dueAt: z.ZodISODateTime;
        subject: z.ZodObject<{
            type: z.ZodEnum<{
                grow: "grow";
                space: "space";
            }>;
            id: z.ZodString;
        }, z.core.$strip>;
        assigneeId: z.ZodNullable<z.ZodString>;
        defaults: z.ZodAny;
    }, z.core.$strip>>;
    openAlerts: z.ZodArray<z.ZodObject<{
        alertId: z.ZodString;
        kind: z.ZodEnum<{
            threshold: "threshold";
            offline: "offline";
            camera_stale: "camera_stale";
        }>;
        severity: z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>;
        startedAt: z.ZodISODateTime;
        value: z.ZodNullable<z.ZodNumber>;
        metric: z.ZodNullable<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>>;
    }, z.core.$strip>>;
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        handle: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One device's newest values, as the space screen redraws them. */
export declare const spaceLiveDevice: z.ZodObject<{
    deviceId: z.ZodString;
    values: z.ZodArray<z.ZodObject<{
        value: z.ZodNullable<z.ZodNumber>;
        measuredAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodEnum<{
            offline: "offline";
            live: "live";
            stale: "stale";
        }>;
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
    }, z.core.$strip>>;
    setpoints: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        value: z.ZodNullable<z.ZodNumber>;
        band: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * When one camera of the space last delivered. A camera that has gone quiet is
 * dimmed like a value is, but against its own `stillIntervalSeconds` rather than
 * against `VALUE_AGE`, so the instant is answered and the state is not.
 */
export declare const spaceLiveCamera: z.ZodObject<{
    cameraId: z.ZodString;
    lastStillAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
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
export declare const spaceLive: z.ZodObject<{
    spaceId: z.ZodString;
    values: z.ZodArray<z.ZodObject<{
        value: z.ZodNullable<z.ZodNumber>;
        measuredAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodEnum<{
            offline: "offline";
            live: "live";
            stale: "stale";
        }>;
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
    }, z.core.$strip>>;
    setpoints: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        value: z.ZodNullable<z.ZodNumber>;
        band: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    devices: z.ZodArray<z.ZodObject<{
        deviceId: z.ZodString;
        values: z.ZodArray<z.ZodObject<{
            value: z.ZodNullable<z.ZodNumber>;
            measuredAt: z.ZodNullable<z.ZodISODateTime>;
            state: z.ZodEnum<{
                offline: "offline";
                live: "live";
                stale: "stale";
            }>;
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
        }, z.core.$strip>>;
        setpoints: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            value: z.ZodNullable<z.ZodNumber>;
            band: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    cameras: z.ZodArray<z.ZodObject<{
        cameraId: z.ZodString;
        lastStillAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * What the Timeline tab is asked for. `24h` and `7d` are windows ending at the
 * instant the request names; `phase` and `grow` are stretches of one grow and so
 * cannot be answered without being told which.
 */
export declare const timelineRange: z.ZodEnum<{
    phase: "phase";
    grow: "grow";
    "24h": "24h";
    "7d": "7d";
}>;
/**
 * A stretch of the window in which something was so: the light was off, an
 * output was running. Both ends are inside the window - a stretch still going
 * when the window ends is closed at its end rather than left open, because the
 * answer says nothing about what happened afterwards.
 */
export declare const timelineSpan: z.ZodObject<{
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
}, z.core.$strip>;
/** What was aimed at in one half of the cycle: the dashed line, and the band drawn around it. */
export declare const timelineTarget: z.ZodObject<{
    setpoint: z.ZodNumber;
    band: z.ZodObject<{
        low: z.ZodNumber;
        high: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * One stretch of the window in which the same targets applied.
 *
 * The band moves with the phase, because a phase records the targets that were
 * running when it began and the store holds readings and never setpoints. So a
 * window spanning two phases carries two of these rather than one average, and a
 * tent with no grow in it carries one, from the controller's own configuration.
 */
export declare const timelineTargets: z.ZodObject<{
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    phaseId: z.ZodNullable<z.ZodString>;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    day: z.ZodNullable<z.ZodObject<{
        setpoint: z.ZodNumber;
        band: z.ZodObject<{
            low: z.ZodNumber;
            high: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    night: z.ZodNullable<z.ZodObject<{
        setpoint: z.ZodNumber;
        band: z.ZodObject<{
            low: z.ZodNumber;
            high: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * One stacked panel: a metric over the window, with the targets that applied
 * across it. A metric nothing in the space measured has no panel at all rather
 * than a panel of nulls, which is what "the CO2 panel only when there is a
 * sensor" means.
 */
export declare const timelinePanel: z.ZodObject<{
    metric: z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>;
    points: z.ZodArray<z.ZodObject<{
        measuredAt: z.ZodISODateTime;
        value: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    targets: z.ZodArray<z.ZodObject<{
        startsAt: z.ZodISODateTime;
        endsAt: z.ZodISODateTime;
        phaseId: z.ZodNullable<z.ZodString>;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        day: z.ZodNullable<z.ZodObject<{
            setpoint: z.ZodNumber;
            band: z.ZodObject<{
                low: z.ZodNumber;
                high: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        night: z.ZodNullable<z.ZodObject<{
            setpoint: z.ZodNumber;
            band: z.ZodObject<{
                low: z.ZodNumber;
                high: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One output over the window, as the lanes under the panels draw it: when it was on, not what it measured. */
export declare const timelineOutputLane: z.ZodObject<{
    output: z.ZodEnum<{
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
    deviceId: z.ZodString;
    spans: z.ZodArray<z.ZodObject<{
        startsAt: z.ZodISODateTime;
        endsAt: z.ZodISODateTime;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * One alarm as a span of the window. `endedAt` is null for an alert that is
 * still open - it has not ended, and closing it at the edge of the window would
 * say it had.
 */
export declare const timelineAlarm: z.ZodObject<{
    alertId: z.ZodString;
    kind: z.ZodEnum<{
        threshold: "threshold";
        offline: "offline";
        camera_stale: "camera_stale";
    }>;
    severity: z.ZodEnum<{
        critical: "critical";
        warning: "warning";
        info: "info";
    }>;
    metric: z.ZodNullable<z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    value: z.ZodNullable<z.ZodNumber>;
    extremeValue: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/** One camera of the space over the window, thinned to what the slider above the panels steps through. */
export declare const timelineCamera: z.ZodObject<{
    cameraId: z.ZodString;
    name: z.ZodString;
    frames: z.ZodArray<z.ZodObject<{
        mediaId: z.ZodString;
        capturedAt: z.ZodISODateTime;
    }, z.core.$strip>>;
}, z.core.$strip>;
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
export declare const spaceTimeline: z.ZodObject<{
    spaceId: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        other: "other";
        tent: "tent";
        fridge: "fridge";
        room: "room";
        balcony: "balcony";
    }>;
    range: z.ZodEnum<{
        phase: "phase";
        grow: "grow";
        "24h": "24h";
        "7d": "7d";
    }>;
    growId: z.ZodNullable<z.ZodString>;
    dayFrom: z.ZodNullable<z.ZodNumber>;
    dayTo: z.ZodNullable<z.ZodNumber>;
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    stepSeconds: z.ZodNumber;
    deviceIds: z.ZodArray<z.ZodString>;
    panels: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        points: z.ZodArray<z.ZodObject<{
            measuredAt: z.ZodISODateTime;
            value: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        targets: z.ZodArray<z.ZodObject<{
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
            phaseId: z.ZodNullable<z.ZodString>;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            day: z.ZodNullable<z.ZodObject<{
                setpoint: z.ZodNumber;
                band: z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>>;
            night: z.ZodNullable<z.ZodObject<{
                setpoint: z.ZodNumber;
                band: z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nights: z.ZodArray<z.ZodObject<{
        startsAt: z.ZodISODateTime;
        endsAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    alarms: z.ZodArray<z.ZodObject<{
        alertId: z.ZodString;
        kind: z.ZodEnum<{
            threshold: "threshold";
            offline: "offline";
            camera_stale: "camera_stale";
        }>;
        severity: z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>;
        metric: z.ZodNullable<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        value: z.ZodNullable<z.ZodNumber>;
        extremeValue: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    outputs: z.ZodArray<z.ZodObject<{
        output: z.ZodEnum<{
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
        deviceId: z.ZodString;
        spans: z.ZodArray<z.ZodObject<{
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    events: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
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
        occurredAt: z.ZodISODateTime;
        source: z.ZodEnum<{
            alarm: "alarm";
            plan: "plan";
            human: "human";
            device: "device";
            preset: "preset";
        }>;
        authorId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        deviceId: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        taskId: z.ZodNullable<z.ZodString>;
        alertId: z.ZodNullable<z.ZodString>;
        severity: z.ZodNullable<z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>>;
        text: z.ZodNullable<z.ZodString>;
        message: z.ZodNullable<z.ZodObject<{
            key: z.ZodString;
            params: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        values: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"water">;
            litres: z.ZodNullable<z.ZodNumber>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"feed">;
            litres: z.ZodNullable<z.ZodNumber>;
            schemeWeek: z.ZodNullable<z.ZodNumber>;
            doses: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                amount: z.ZodNumber;
                unit: z.ZodString;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"measurement">;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"photo">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"note">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"training">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"visit">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"system">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"alarm">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
            phaseId: z.ZodString;
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            preset: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            placementId: z.ZodString;
            spaceId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"harvest">;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"plan">;
            planId: z.ZodString;
            stepIndex: z.ZodNumber;
            transition: z.ZodNullable<z.ZodEnum<{
                pause: "pause";
                resume: "resume";
                confirm: "confirm";
                extend: "extend";
                skip: "skip";
            }>>;
        }, z.core.$strip>], "kind">;
        mediaIds: z.ZodArray<z.ZodString>;
        undoUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    readingNames: z.ZodArray<z.ZodObject<{
        growId: z.ZodString;
        readings: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            name: z.ZodString;
            unit: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    cameras: z.ZodArray<z.ZodObject<{
        cameraId: z.ZodString;
        name: z.ZodString;
        frames: z.ZodArray<z.ZodObject<{
            mediaId: z.ZodString;
            capturedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        handle: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * One metric aggregated over a stretch of a grow, which is one time-series query
 * per stretch and controller.
 *
 * Day and night are the controller's own cycle rather than hours of the clock:
 * they are told apart by its light output, so a device that drives no light -
 * a fridge drying, a tent lit from a socket nobody told the server about -
 * answers `averageValue` and neither half.
 */
export declare const weekClimate: z.ZodObject<{
    metric: z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }>;
    minValue: z.ZodNullable<z.ZodNumber>;
    maxValue: z.ZodNullable<z.ZodNumber>;
    averageValue: z.ZodNullable<z.ZodNumber>;
    dayAverage: z.ZodNullable<z.ZodNumber>;
    nightAverage: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * One of the seven thumbnails a week card is drawn with: the still taken
 * nearest a fixed hour of that day, so the strip reads as one picture a day
 * rather than as whatever the camera last sent. Null where no camera was
 * watching, which is what leaves a slot empty.
 */
export declare const growWeekDay: z.ZodObject<{
    dayNumber: z.ZodNumber;
    startsAt: z.ZodISODateTime;
    mediaId: z.ZodNullable<z.ZodString>;
    cameraId: z.ZodNullable<z.ZodString>;
    capturedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * What the scheme says to feed this week, and how many feeds the week is
 * supposed to have. `amounts` is the grid's row for this week with the grow's
 * own strength already applied, so nobody multiplies it twice; how many of them
 * were done is the card's `feedCount`.
 *
 * No screen has a control for the rhythm, so `plannedCount` is read from the
 * grow's feed reminder, else its water reminder, else three.
 */
export declare const growWeekFeeding: z.ZodObject<{
    amounts: z.ZodArray<z.ZodObject<{
        productKey: z.ZodString;
        name: z.ZodString;
        value: z.ZodNullable<z.ZodNumber>;
        unit: z.ZodString;
    }, z.core.$strip>>;
    plannedCount: z.ZodNumber;
}, z.core.$strip>;
/**
 * Where one of the grow's own measurements stood at the end of the week, and by
 * how much it moved - "Height · 58 cm · +6". `change` is against the newest
 * reading before this week began and is null when there was none.
 *
 * `key` names a definition in the grow's `measurements[]`, which is where its
 * name, its unit and its target are; nothing about the measurement is copied
 * onto the reading.
 */
export declare const growWeekReading: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodNumber;
    change: z.ZodNullable<z.ZodNumber>;
    measuredAt: z.ZodISODateTime;
}, z.core.$strip>;
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
export declare const growWeekCard: z.ZodObject<{
    weekNumber: z.ZodNumber;
    dayFrom: z.ZodNumber;
    dayTo: z.ZodNumber;
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    preset: z.ZodNullable<z.ZodString>;
    stageWeek: z.ZodNullable<z.ZodNumber>;
    deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
    climate: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        minValue: z.ZodNullable<z.ZodNumber>;
        maxValue: z.ZodNullable<z.ZodNumber>;
        averageValue: z.ZodNullable<z.ZodNumber>;
        dayAverage: z.ZodNullable<z.ZodNumber>;
        nightAverage: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    lightHours: z.ZodNullable<z.ZodNumber>;
    days: z.ZodArray<z.ZodObject<{
        dayNumber: z.ZodNumber;
        startsAt: z.ZodISODateTime;
        mediaId: z.ZodNullable<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        capturedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    feeding: z.ZodNullable<z.ZodObject<{
        amounts: z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            value: z.ZodNullable<z.ZodNumber>;
            unit: z.ZodString;
        }, z.core.$strip>>;
        plannedCount: z.ZodNumber;
    }, z.core.$strip>>;
    readings: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodNumber;
        change: z.ZodNullable<z.ZodNumber>;
        measuredAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    waterCount: z.ZodNumber;
    feedCount: z.ZodNumber;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
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
        occurredAt: z.ZodISODateTime;
        source: z.ZodEnum<{
            alarm: "alarm";
            plan: "plan";
            human: "human";
            device: "device";
            preset: "preset";
        }>;
        authorId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        deviceId: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        taskId: z.ZodNullable<z.ZodString>;
        alertId: z.ZodNullable<z.ZodString>;
        severity: z.ZodNullable<z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>>;
        text: z.ZodNullable<z.ZodString>;
        message: z.ZodNullable<z.ZodObject<{
            key: z.ZodString;
            params: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        values: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"water">;
            litres: z.ZodNullable<z.ZodNumber>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"feed">;
            litres: z.ZodNullable<z.ZodNumber>;
            schemeWeek: z.ZodNullable<z.ZodNumber>;
            doses: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                amount: z.ZodNumber;
                unit: z.ZodString;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"measurement">;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"photo">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"note">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"training">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"visit">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"system">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"alarm">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
            phaseId: z.ZodString;
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            preset: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            placementId: z.ZodString;
            spaceId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"harvest">;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"plan">;
            planId: z.ZodString;
            stepIndex: z.ZodNumber;
            transition: z.ZodNullable<z.ZodEnum<{
                pause: "pause";
                resume: "resume";
                confirm: "confirm";
                extend: "extend";
                skip: "skip";
            }>>;
        }, z.core.$strip>], "kind">;
        mediaIds: z.ZodArray<z.ZodString>;
        undoUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    entryCount: z.ZodNumber;
    timelapseMediaId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * The week cards, page by page, with everyone they name. A page carries
 * `people` for the same reason the home answer does - a card says who watered -
 * and one Mongo read answers it for the whole page.
 */
export declare const growWeekCardPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        weekNumber: z.ZodNumber;
        dayFrom: z.ZodNumber;
        dayTo: z.ZodNumber;
        startsAt: z.ZodISODateTime;
        endsAt: z.ZodISODateTime;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        stageWeek: z.ZodNullable<z.ZodNumber>;
        deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        climate: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            minValue: z.ZodNullable<z.ZodNumber>;
            maxValue: z.ZodNullable<z.ZodNumber>;
            averageValue: z.ZodNullable<z.ZodNumber>;
            dayAverage: z.ZodNullable<z.ZodNumber>;
            nightAverage: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        lightHours: z.ZodNullable<z.ZodNumber>;
        days: z.ZodArray<z.ZodObject<{
            dayNumber: z.ZodNumber;
            startsAt: z.ZodISODateTime;
            mediaId: z.ZodNullable<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            capturedAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
        feeding: z.ZodNullable<z.ZodObject<{
            amounts: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                value: z.ZodNullable<z.ZodNumber>;
                unit: z.ZodString;
            }, z.core.$strip>>;
            plannedCount: z.ZodNumber;
        }, z.core.$strip>>;
        readings: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            change: z.ZodNullable<z.ZodNumber>;
            measuredAt: z.ZodISODateTime;
        }, z.core.$strip>>;
        waterCount: z.ZodNumber;
        feedCount: z.ZodNumber;
        entries: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            createdAt: z.ZodISODateTime;
            kind: z.ZodEnum<{
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
            occurredAt: z.ZodISODateTime;
            source: z.ZodEnum<{
                alarm: "alarm";
                plan: "plan";
                human: "human";
                device: "device";
                preset: "preset";
            }>;
            authorId: z.ZodNullable<z.ZodString>;
            growId: z.ZodNullable<z.ZodString>;
            spaceId: z.ZodNullable<z.ZodString>;
            deviceId: z.ZodNullable<z.ZodString>;
            plantIds: z.ZodArray<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            taskId: z.ZodNullable<z.ZodString>;
            alertId: z.ZodNullable<z.ZodString>;
            severity: z.ZodNullable<z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>>;
            text: z.ZodNullable<z.ZodString>;
            message: z.ZodNullable<z.ZodObject<{
                key: z.ZodString;
                params: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"water">;
                litres: z.ZodNullable<z.ZodNumber>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"feed">;
                litres: z.ZodNullable<z.ZodNumber>;
                schemeWeek: z.ZodNullable<z.ZodNumber>;
                doses: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    amount: z.ZodNumber;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"measurement">;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"photo">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"note">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"training">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"visit">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"system">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"alarm">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"phase">;
                phaseId: z.ZodString;
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                preset: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                placementId: z.ZodString;
                spaceId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"harvest">;
                wetWeightG: z.ZodNullable<z.ZodNumber>;
                dryWeightG: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plan">;
                planId: z.ZodString;
                stepIndex: z.ZodNumber;
                transition: z.ZodNullable<z.ZodEnum<{
                    pause: "pause";
                    resume: "resume";
                    confirm: "confirm";
                    extend: "extend";
                    skip: "skip";
                }>>;
            }, z.core.$strip>], "kind">;
            mediaIds: z.ZodArray<z.ZodString>;
            undoUntil: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
        entryCount: z.ZodNumber;
        timelapseMediaId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        handle: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * One stretch of the grow at one stage, as the report tells its story: a
 * chapter with its cover, its day range, how it was kept and what was done to
 * the plants in it.
 */
export declare const growReportPhase: z.ZodObject<{
    phaseId: z.ZodString;
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    preset: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    dayFrom: z.ZodNumber;
    dayTo: z.ZodNullable<z.ZodNumber>;
    dayCount: z.ZodNumber;
    spaceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
    coverMediaId: z.ZodNullable<z.ZodString>;
    climate: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        minValue: z.ZodNullable<z.ZodNumber>;
        maxValue: z.ZodNullable<z.ZodNumber>;
        averageValue: z.ZodNullable<z.ZodNumber>;
        dayAverage: z.ZodNullable<z.ZodNumber>;
        nightAverage: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    inBandPercent: z.ZodNullable<z.ZodNumber>;
    waterCount: z.ZodNumber;
    feedCount: z.ZodNumber;
    training: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        kind: z.ZodEnum<{
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
        occurredAt: z.ZodISODateTime;
        source: z.ZodEnum<{
            alarm: "alarm";
            plan: "plan";
            human: "human";
            device: "device";
            preset: "preset";
        }>;
        authorId: z.ZodNullable<z.ZodString>;
        growId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        deviceId: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        taskId: z.ZodNullable<z.ZodString>;
        alertId: z.ZodNullable<z.ZodString>;
        severity: z.ZodNullable<z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>>;
        text: z.ZodNullable<z.ZodString>;
        message: z.ZodNullable<z.ZodObject<{
            key: z.ZodString;
            params: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        values: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"water">;
            litres: z.ZodNullable<z.ZodNumber>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"feed">;
            litres: z.ZodNullable<z.ZodNumber>;
            schemeWeek: z.ZodNullable<z.ZodNumber>;
            doses: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                amount: z.ZodNumber;
                unit: z.ZodString;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"measurement">;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                plantId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"photo">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"note">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"training">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"visit">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"system">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"alarm">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"phase">;
            phaseId: z.ZodString;
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            preset: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            placementId: z.ZodString;
            spaceId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"harvest">;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"plan">;
            planId: z.ZodString;
            stepIndex: z.ZodNumber;
            transition: z.ZodNullable<z.ZodEnum<{
                pause: "pause";
                resume: "resume";
                confirm: "confirm";
                extend: "extend";
                skip: "skip";
            }>>;
        }, z.core.$strip>], "kind">;
        mediaIds: z.ZodArray<z.ZodString>;
        undoUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Stripped from every shared view when the owner hides weights, which is what `null` says here. */
export declare const growHarvest: z.ZodObject<{
    harvestedAt: z.ZodNullable<z.ZodISODateTime>;
    wetWeightG: z.ZodNullable<z.ZodNumber>;
    dryWeightG: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const growTotals: z.ZodObject<{
    entryCount: z.ZodNumber;
    waterCount: z.ZodNumber;
    feedCount: z.ZodNumber;
    photoCount: z.ZodNumber;
}, z.core.$strip>;
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
export declare const growReport: z.ZodObject<{
    growId: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    type: z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    dayCount: z.ZodNumber;
    plantCount: z.ZodNullable<z.ZodNumber>;
    strains: z.ZodArray<z.ZodString>;
    coverMediaId: z.ZodNullable<z.ZodString>;
    filmMediaId: z.ZodNullable<z.ZodString>;
    phases: z.ZodArray<z.ZodObject<{
        phaseId: z.ZodString;
        stage: z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>;
        preset: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        dayFrom: z.ZodNumber;
        dayTo: z.ZodNullable<z.ZodNumber>;
        dayCount: z.ZodNumber;
        spaceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        coverMediaId: z.ZodNullable<z.ZodString>;
        climate: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            minValue: z.ZodNullable<z.ZodNumber>;
            maxValue: z.ZodNullable<z.ZodNumber>;
            averageValue: z.ZodNullable<z.ZodNumber>;
            dayAverage: z.ZodNullable<z.ZodNumber>;
            nightAverage: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        inBandPercent: z.ZodNullable<z.ZodNumber>;
        waterCount: z.ZodNumber;
        feedCount: z.ZodNumber;
        training: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            createdAt: z.ZodISODateTime;
            kind: z.ZodEnum<{
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
            occurredAt: z.ZodISODateTime;
            source: z.ZodEnum<{
                alarm: "alarm";
                plan: "plan";
                human: "human";
                device: "device";
                preset: "preset";
            }>;
            authorId: z.ZodNullable<z.ZodString>;
            growId: z.ZodNullable<z.ZodString>;
            spaceId: z.ZodNullable<z.ZodString>;
            deviceId: z.ZodNullable<z.ZodString>;
            plantIds: z.ZodArray<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            taskId: z.ZodNullable<z.ZodString>;
            alertId: z.ZodNullable<z.ZodString>;
            severity: z.ZodNullable<z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>>;
            text: z.ZodNullable<z.ZodString>;
            message: z.ZodNullable<z.ZodObject<{
                key: z.ZodString;
                params: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"water">;
                litres: z.ZodNullable<z.ZodNumber>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"feed">;
                litres: z.ZodNullable<z.ZodNumber>;
                schemeWeek: z.ZodNullable<z.ZodNumber>;
                doses: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    amount: z.ZodNumber;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"measurement">;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"photo">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"note">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"training">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"visit">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"system">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"alarm">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"phase">;
                phaseId: z.ZodString;
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                preset: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                placementId: z.ZodString;
                spaceId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"harvest">;
                wetWeightG: z.ZodNullable<z.ZodNumber>;
                dryWeightG: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plan">;
                planId: z.ZodString;
                stepIndex: z.ZodNumber;
                transition: z.ZodNullable<z.ZodEnum<{
                    pause: "pause";
                    resume: "resume";
                    confirm: "confirm";
                    extend: "extend";
                    skip: "skip";
                }>>;
            }, z.core.$strip>], "kind">;
            mediaIds: z.ZodArray<z.ZodString>;
            undoUntil: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    harvest: z.ZodNullable<z.ZodObject<{
        harvestedAt: z.ZodNullable<z.ZodISODateTime>;
        wetWeightG: z.ZodNullable<z.ZodNumber>;
        dryWeightG: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    totals: z.ZodObject<{
        entryCount: z.ZodNumber;
        waterCount: z.ZodNumber;
        feedCount: z.ZodNumber;
        photoCount: z.ZodNumber;
    }, z.core.$strip>;
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        handle: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * One reading, as a chart draws it. Unlike a climate point, which summarises a
 * window and is null where the window held nothing, this is the reading itself:
 * it carries the plant it was taken on and the entry it was written in, so a
 * point on the chart leads back to what was logged.
 */
export declare const growSeriesPoint: z.ZodObject<{
    measuredAt: z.ZodISODateTime;
    value: z.ZodNumber;
    plantId: z.ZodNullable<z.ZodString>;
    entryId: z.ZodString;
}, z.core.$strip>;
/** Every reading of one of the grow's own measurements, oldest first. */
export declare const growMeasurementSeries: z.ZodObject<{
    key: z.ZodString;
    points: z.ZodArray<z.ZodObject<{
        measuredAt: z.ZodISODateTime;
        value: z.ZodNumber;
        plantId: z.ZodNullable<z.ZodString>;
        entryId: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * What the Charts view is asked for as a range: the four chips the Timeline tab
 * already has, and `custom` for two instants somebody picked, which is the one
 * range no chip can name.
 */
export declare const growSeriesRange: z.ZodEnum<{
    custom: "custom";
    phase: "phase";
    grow: "grow";
    "24h": "24h";
    "7d": "7d";
}>;
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
export declare const growSeries: z.ZodObject<{
    growId: z.ZodString;
    range: z.ZodEnum<{
        custom: "custom";
        phase: "phase";
        grow: "grow";
        "24h": "24h";
        "7d": "7d";
    }>;
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    stepSeconds: z.ZodNumber;
    originAt: z.ZodISODateTime;
    dayFrom: z.ZodNullable<z.ZodNumber>;
    dayTo: z.ZodNullable<z.ZodNumber>;
    deviceIds: z.ZodArray<z.ZodString>;
    climate: z.ZodArray<z.ZodObject<{
        metric: z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }>;
        points: z.ZodArray<z.ZodObject<{
            measuredAt: z.ZodISODateTime;
            value: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        targets: z.ZodArray<z.ZodObject<{
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
            phaseId: z.ZodNullable<z.ZodString>;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            day: z.ZodNullable<z.ZodObject<{
                setpoint: z.ZodNumber;
                band: z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>>;
            night: z.ZodNullable<z.ZodObject<{
                setpoint: z.ZodNumber;
                band: z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    outputs: z.ZodArray<z.ZodObject<{
        output: z.ZodEnum<{
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
        deviceId: z.ZodString;
        spans: z.ZodArray<z.ZodObject<{
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nights: z.ZodArray<z.ZodObject<{
        startsAt: z.ZodISODateTime;
        endsAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    measurements: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        points: z.ZodArray<z.ZodObject<{
            measuredAt: z.ZodISODateTime;
            value: z.ZodNumber;
            plantId: z.ZodNullable<z.ZodString>;
            entryId: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Who a public page is by. A handle, a line of text and a picture - never a real name. */
export declare const publicAuthor: z.ZodObject<{
    handle: z.ZodString;
    bio: z.ZodNullable<z.ZodString>;
    avatarMediaId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * A public diary, whether it was reached by its slug or through a share link.
 *
 * `range` is the window the reader is allowed to see and every week and entry
 * below is already clamped to it; `includeCameras` says whether camera pictures
 * were part of it. Harvest weights and plant counts are already stripped when
 * the owner's privacy settings say so.
 */
export declare const publicGrowPage: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    type: z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>;
    author: z.ZodObject<{
        handle: z.ZodString;
        bio: z.ZodNullable<z.ZodString>;
        avatarMediaId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    dayNumber: z.ZodNullable<z.ZodNumber>;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    preset: z.ZodNullable<z.ZodString>;
    plantCount: z.ZodNullable<z.ZodNumber>;
    strains: z.ZodArray<z.ZodString>;
    coverMediaId: z.ZodNullable<z.ZodString>;
    filmMediaId: z.ZodNullable<z.ZodString>;
    range: z.ZodObject<{
        startsAt: z.ZodNullable<z.ZodISODateTime>;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
    includeCameras: z.ZodBoolean;
    weeks: z.ZodArray<z.ZodObject<{
        weekNumber: z.ZodNumber;
        dayFrom: z.ZodNumber;
        dayTo: z.ZodNumber;
        startsAt: z.ZodISODateTime;
        endsAt: z.ZodISODateTime;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        stageWeek: z.ZodNullable<z.ZodNumber>;
        deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        climate: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            minValue: z.ZodNullable<z.ZodNumber>;
            maxValue: z.ZodNullable<z.ZodNumber>;
            averageValue: z.ZodNullable<z.ZodNumber>;
            dayAverage: z.ZodNullable<z.ZodNumber>;
            nightAverage: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        lightHours: z.ZodNullable<z.ZodNumber>;
        days: z.ZodArray<z.ZodObject<{
            dayNumber: z.ZodNumber;
            startsAt: z.ZodISODateTime;
            mediaId: z.ZodNullable<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            capturedAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
        feeding: z.ZodNullable<z.ZodObject<{
            amounts: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                value: z.ZodNullable<z.ZodNumber>;
                unit: z.ZodString;
            }, z.core.$strip>>;
            plannedCount: z.ZodNumber;
        }, z.core.$strip>>;
        readings: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodNumber;
            change: z.ZodNullable<z.ZodNumber>;
            measuredAt: z.ZodISODateTime;
        }, z.core.$strip>>;
        waterCount: z.ZodNumber;
        feedCount: z.ZodNumber;
        entries: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            createdAt: z.ZodISODateTime;
            kind: z.ZodEnum<{
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
            occurredAt: z.ZodISODateTime;
            source: z.ZodEnum<{
                alarm: "alarm";
                plan: "plan";
                human: "human";
                device: "device";
                preset: "preset";
            }>;
            authorId: z.ZodNullable<z.ZodString>;
            growId: z.ZodNullable<z.ZodString>;
            spaceId: z.ZodNullable<z.ZodString>;
            deviceId: z.ZodNullable<z.ZodString>;
            plantIds: z.ZodArray<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            taskId: z.ZodNullable<z.ZodString>;
            alertId: z.ZodNullable<z.ZodString>;
            severity: z.ZodNullable<z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>>;
            text: z.ZodNullable<z.ZodString>;
            message: z.ZodNullable<z.ZodObject<{
                key: z.ZodString;
                params: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"water">;
                litres: z.ZodNullable<z.ZodNumber>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"feed">;
                litres: z.ZodNullable<z.ZodNumber>;
                schemeWeek: z.ZodNullable<z.ZodNumber>;
                doses: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    amount: z.ZodNumber;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"measurement">;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"photo">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"note">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"training">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"visit">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"system">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"alarm">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"phase">;
                phaseId: z.ZodString;
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                preset: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                placementId: z.ZodString;
                spaceId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"harvest">;
                wetWeightG: z.ZodNullable<z.ZodNumber>;
                dryWeightG: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plan">;
                planId: z.ZodString;
                stepIndex: z.ZodNumber;
                transition: z.ZodNullable<z.ZodEnum<{
                    pause: "pause";
                    resume: "resume";
                    confirm: "confirm";
                    extend: "extend";
                    skip: "skip";
                }>>;
            }, z.core.$strip>], "kind">;
            mediaIds: z.ZodArray<z.ZodString>;
            undoUntil: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
        entryCount: z.ZodNumber;
        timelapseMediaId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    harvest: z.ZodNullable<z.ZodObject<{
        harvestedAt: z.ZodNullable<z.ZodISODateTime>;
        wetWeightG: z.ZodNullable<z.ZodNumber>;
        dryWeightG: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    totals: z.ZodObject<{
        entryCount: z.ZodNumber;
        waterCount: z.ZodNumber;
        feedCount: z.ZodNumber;
        photoCount: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * `GET /public/users/{handle}`: the public diaries of one person. A public grow
 * is drawn the same way wherever it is listed, so these are the cards the home
 * screen already uses for the grows somebody follows. Nothing else about the
 * account is public.
 */
export declare const publicUserPage: z.ZodObject<{
    author: z.ZodObject<{
        handle: z.ZodString;
        bio: z.ZodNullable<z.ZodString>;
        avatarMediaId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    grows: z.ZodArray<z.ZodObject<{
        growId: z.ZodString;
        slug: z.ZodString;
        name: z.ZodString;
        handle: z.ZodString;
        dayNumber: z.ZodNullable<z.ZodNumber>;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        coverMediaId: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** A link onto a grow answers the same page the grow's own public address does. */
export declare const sharedGrow: z.ZodObject<{
    type: z.ZodLiteral<"grow">;
    grow: z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        type: z.ZodEnum<{
            photoperiod: "photoperiod";
            autoflower: "autoflower";
        }>;
        author: z.ZodObject<{
            handle: z.ZodString;
            bio: z.ZodNullable<z.ZodString>;
            avatarMediaId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        dayNumber: z.ZodNullable<z.ZodNumber>;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        plantCount: z.ZodNullable<z.ZodNumber>;
        strains: z.ZodArray<z.ZodString>;
        coverMediaId: z.ZodNullable<z.ZodString>;
        filmMediaId: z.ZodNullable<z.ZodString>;
        range: z.ZodObject<{
            startsAt: z.ZodNullable<z.ZodISODateTime>;
            endsAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
        includeCameras: z.ZodBoolean;
        weeks: z.ZodArray<z.ZodObject<{
            weekNumber: z.ZodNumber;
            dayFrom: z.ZodNumber;
            dayTo: z.ZodNumber;
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            preset: z.ZodNullable<z.ZodString>;
            stageWeek: z.ZodNullable<z.ZodNumber>;
            deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
            climate: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                minValue: z.ZodNullable<z.ZodNumber>;
                maxValue: z.ZodNullable<z.ZodNumber>;
                averageValue: z.ZodNullable<z.ZodNumber>;
                dayAverage: z.ZodNullable<z.ZodNumber>;
                nightAverage: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            lightHours: z.ZodNullable<z.ZodNumber>;
            days: z.ZodArray<z.ZodObject<{
                dayNumber: z.ZodNumber;
                startsAt: z.ZodISODateTime;
                mediaId: z.ZodNullable<z.ZodString>;
                cameraId: z.ZodNullable<z.ZodString>;
                capturedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            feeding: z.ZodNullable<z.ZodObject<{
                amounts: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    value: z.ZodNullable<z.ZodNumber>;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                plannedCount: z.ZodNumber;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                change: z.ZodNullable<z.ZodNumber>;
                measuredAt: z.ZodISODateTime;
            }, z.core.$strip>>;
            waterCount: z.ZodNumber;
            feedCount: z.ZodNumber;
            entries: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                createdAt: z.ZodISODateTime;
                kind: z.ZodEnum<{
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
                occurredAt: z.ZodISODateTime;
                source: z.ZodEnum<{
                    alarm: "alarm";
                    plan: "plan";
                    human: "human";
                    device: "device";
                    preset: "preset";
                }>;
                authorId: z.ZodNullable<z.ZodString>;
                growId: z.ZodNullable<z.ZodString>;
                spaceId: z.ZodNullable<z.ZodString>;
                deviceId: z.ZodNullable<z.ZodString>;
                plantIds: z.ZodArray<z.ZodString>;
                cameraId: z.ZodNullable<z.ZodString>;
                taskId: z.ZodNullable<z.ZodString>;
                alertId: z.ZodNullable<z.ZodString>;
                severity: z.ZodNullable<z.ZodEnum<{
                    critical: "critical";
                    warning: "warning";
                    info: "info";
                }>>;
                text: z.ZodNullable<z.ZodString>;
                message: z.ZodNullable<z.ZodObject<{
                    key: z.ZodString;
                    params: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"water">;
                    litres: z.ZodNullable<z.ZodNumber>;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"feed">;
                    litres: z.ZodNullable<z.ZodNumber>;
                    schemeWeek: z.ZodNullable<z.ZodNumber>;
                    doses: z.ZodArray<z.ZodObject<{
                        productKey: z.ZodString;
                        name: z.ZodString;
                        amount: z.ZodNumber;
                        unit: z.ZodString;
                    }, z.core.$strip>>;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"measurement">;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"photo">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"note">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"training">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"visit">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"system">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"alarm">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"phase">;
                    phaseId: z.ZodString;
                    stage: z.ZodEnum<{
                        germination: "germination";
                        seedling: "seedling";
                        vegetative: "vegetative";
                        flowering: "flowering";
                        drying: "drying";
                        curing: "curing";
                    }>;
                    preset: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"move">;
                    placementId: z.ZodString;
                    spaceId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"harvest">;
                    wetWeightG: z.ZodNullable<z.ZodNumber>;
                    dryWeightG: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"plan">;
                    planId: z.ZodString;
                    stepIndex: z.ZodNumber;
                    transition: z.ZodNullable<z.ZodEnum<{
                        pause: "pause";
                        resume: "resume";
                        confirm: "confirm";
                        extend: "extend";
                        skip: "skip";
                    }>>;
                }, z.core.$strip>], "kind">;
                mediaIds: z.ZodArray<z.ZodString>;
                undoUntil: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            entryCount: z.ZodNumber;
            timelapseMediaId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        harvest: z.ZodNullable<z.ZodObject<{
            harvestedAt: z.ZodNullable<z.ZodISODateTime>;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        totals: z.ZodObject<{
            entryCount: z.ZodNumber;
            waterCount: z.ZodNumber;
            feedCount: z.ZodNumber;
            photoCount: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * A link onto a space answers its tent page, already clamped to the link's range
 * and stripped for a reader who is neither the owner nor a member - which is
 * what leaves the tasks and the alerts of such a page empty.
 */
export declare const sharedSpace: z.ZodObject<{
    type: z.ZodLiteral<"space">;
    space: z.ZodObject<{
        spaceId: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<{
            other: "other";
            tent: "tent";
            fridge: "fridge";
            room: "room";
            balcony: "balcony";
        }>;
        roomId: z.ZodNullable<z.ZodString>;
        deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        values: z.ZodArray<z.ZodObject<{
            value: z.ZodNullable<z.ZodNumber>;
            measuredAt: z.ZodNullable<z.ZodISODateTime>;
            state: z.ZodEnum<{
                offline: "offline";
                live: "live";
                stale: "stale";
            }>;
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
        }, z.core.$strip>>;
        setpoints: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            value: z.ZodNullable<z.ZodNumber>;
            band: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        targets: z.ZodNullable<z.ZodObject<{
            day: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                value: z.ZodNullable<z.ZodNumber>;
                band: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            night: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                value: z.ZodNullable<z.ZodNumber>;
                band: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        verdict: z.ZodObject<{
            deviceId: z.ZodNullable<z.ZodString>;
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
            forSeconds: z.ZodNumber;
            stepSeconds: z.ZodNumber;
            rating: z.ZodNullable<z.ZodEnum<{
                watch: "watch";
                good: "good";
                poor: "poor";
            }>>;
            inBandFraction: z.ZodNullable<z.ZodNumber>;
            metrics: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                rating: z.ZodNullable<z.ZodEnum<{
                    watch: "watch";
                    good: "good";
                    poor: "poor";
                }>>;
                minValue: z.ZodNullable<z.ZodNumber>;
                maxValue: z.ZodNullable<z.ZodNumber>;
                averageValue: z.ZodNullable<z.ZodNumber>;
                dayBand: z.ZodNullable<z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>>;
                nightBand: z.ZodNullable<z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>>;
                inBandSeconds: z.ZodNumber;
                outOfBandSeconds: z.ZodNumber;
                excursions: z.ZodArray<z.ZodObject<{
                    startedAt: z.ZodISODateTime;
                    endedAt: z.ZodNullable<z.ZodISODateTime>;
                    above: z.ZodBoolean;
                    extremeValue: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            actuators: z.ZodArray<z.ZodObject<{
                output: z.ZodEnum<{
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
                runCount: z.ZodNumber;
                forSeconds: z.ZodNumber;
            }, z.core.$strip>>;
            trend: z.ZodNullable<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                stepSeconds: z.ZodNumber;
                endsAt: z.ZodISODateTime;
                points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        grows: z.ZodArray<z.ZodObject<{
            growId: z.ZodString;
            name: z.ZodString;
            type: z.ZodEnum<{
                photoperiod: "photoperiod";
                autoflower: "autoflower";
            }>;
            dayNumber: z.ZodNullable<z.ZodNumber>;
            phaseDay: z.ZodNullable<z.ZodNumber>;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            preset: z.ZodNullable<z.ZodString>;
            isAuto: z.ZodBoolean;
            plantCount: z.ZodNullable<z.ZodNumber>;
            strains: z.ZodArray<z.ZodString>;
            coverMediaId: z.ZodNullable<z.ZodString>;
            stageGroups: z.ZodArray<z.ZodObject<{
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                plantCount: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            weekNumber: z.ZodNullable<z.ZodNumber>;
            placedAt: z.ZodISODateTime;
            placedOnDay: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        cameras: z.ZodArray<z.ZodObject<{
            cameraId: z.ZodString;
            name: z.ZodString;
            lastStillAt: z.ZodNullable<z.ZodISODateTime>;
            stills: z.ZodArray<z.ZodObject<{
                mediaId: z.ZodString;
                capturedAt: z.ZodISODateTime;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        entries: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            createdAt: z.ZodISODateTime;
            kind: z.ZodEnum<{
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
            occurredAt: z.ZodISODateTime;
            source: z.ZodEnum<{
                alarm: "alarm";
                plan: "plan";
                human: "human";
                device: "device";
                preset: "preset";
            }>;
            authorId: z.ZodNullable<z.ZodString>;
            growId: z.ZodNullable<z.ZodString>;
            spaceId: z.ZodNullable<z.ZodString>;
            deviceId: z.ZodNullable<z.ZodString>;
            plantIds: z.ZodArray<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            taskId: z.ZodNullable<z.ZodString>;
            alertId: z.ZodNullable<z.ZodString>;
            severity: z.ZodNullable<z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>>;
            text: z.ZodNullable<z.ZodString>;
            message: z.ZodNullable<z.ZodObject<{
                key: z.ZodString;
                params: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"water">;
                litres: z.ZodNullable<z.ZodNumber>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"feed">;
                litres: z.ZodNullable<z.ZodNumber>;
                schemeWeek: z.ZodNullable<z.ZodNumber>;
                doses: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    amount: z.ZodNumber;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"measurement">;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"photo">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"note">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"training">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"visit">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"system">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"alarm">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"phase">;
                phaseId: z.ZodString;
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                preset: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                placementId: z.ZodString;
                spaceId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"harvest">;
                wetWeightG: z.ZodNullable<z.ZodNumber>;
                dryWeightG: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plan">;
                planId: z.ZodString;
                stepIndex: z.ZodNumber;
                transition: z.ZodNullable<z.ZodEnum<{
                    pause: "pause";
                    resume: "resume";
                    confirm: "confirm";
                    extend: "extend";
                    skip: "skip";
                }>>;
            }, z.core.$strip>], "kind">;
            mediaIds: z.ZodArray<z.ZodString>;
            undoUntil: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
        readingNames: z.ZodArray<z.ZodObject<{
            growId: z.ZodString;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                name: z.ZodString;
                unit: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        dueTasks: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                custom: "custom";
                water: "water";
                feed: "feed";
                chore: "chore";
            }>;
            label: z.ZodString;
            dueAt: z.ZodISODateTime;
            subject: z.ZodObject<{
                type: z.ZodEnum<{
                    grow: "grow";
                    space: "space";
                }>;
                id: z.ZodString;
            }, z.core.$strip>;
            assigneeId: z.ZodNullable<z.ZodString>;
            defaults: z.ZodAny;
        }, z.core.$strip>>;
        openAlerts: z.ZodArray<z.ZodObject<{
            alertId: z.ZodString;
            kind: z.ZodEnum<{
                threshold: "threshold";
                offline: "offline";
                camera_stale: "camera_stale";
            }>;
            severity: z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>;
            startedAt: z.ZodISODateTime;
            value: z.ZodNullable<z.ZodNumber>;
            metric: z.ZodNullable<z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>>;
        }, z.core.$strip>>;
        people: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            handle: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const sharedSubject: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"grow">;
    grow: z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        type: z.ZodEnum<{
            photoperiod: "photoperiod";
            autoflower: "autoflower";
        }>;
        author: z.ZodObject<{
            handle: z.ZodString;
            bio: z.ZodNullable<z.ZodString>;
            avatarMediaId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        dayNumber: z.ZodNullable<z.ZodNumber>;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        plantCount: z.ZodNullable<z.ZodNumber>;
        strains: z.ZodArray<z.ZodString>;
        coverMediaId: z.ZodNullable<z.ZodString>;
        filmMediaId: z.ZodNullable<z.ZodString>;
        range: z.ZodObject<{
            startsAt: z.ZodNullable<z.ZodISODateTime>;
            endsAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
        includeCameras: z.ZodBoolean;
        weeks: z.ZodArray<z.ZodObject<{
            weekNumber: z.ZodNumber;
            dayFrom: z.ZodNumber;
            dayTo: z.ZodNumber;
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            preset: z.ZodNullable<z.ZodString>;
            stageWeek: z.ZodNullable<z.ZodNumber>;
            deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
            climate: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                minValue: z.ZodNullable<z.ZodNumber>;
                maxValue: z.ZodNullable<z.ZodNumber>;
                averageValue: z.ZodNullable<z.ZodNumber>;
                dayAverage: z.ZodNullable<z.ZodNumber>;
                nightAverage: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            lightHours: z.ZodNullable<z.ZodNumber>;
            days: z.ZodArray<z.ZodObject<{
                dayNumber: z.ZodNumber;
                startsAt: z.ZodISODateTime;
                mediaId: z.ZodNullable<z.ZodString>;
                cameraId: z.ZodNullable<z.ZodString>;
                capturedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            feeding: z.ZodNullable<z.ZodObject<{
                amounts: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    value: z.ZodNullable<z.ZodNumber>;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                plannedCount: z.ZodNumber;
            }, z.core.$strip>>;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodNumber;
                change: z.ZodNullable<z.ZodNumber>;
                measuredAt: z.ZodISODateTime;
            }, z.core.$strip>>;
            waterCount: z.ZodNumber;
            feedCount: z.ZodNumber;
            entries: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                createdAt: z.ZodISODateTime;
                kind: z.ZodEnum<{
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
                occurredAt: z.ZodISODateTime;
                source: z.ZodEnum<{
                    alarm: "alarm";
                    plan: "plan";
                    human: "human";
                    device: "device";
                    preset: "preset";
                }>;
                authorId: z.ZodNullable<z.ZodString>;
                growId: z.ZodNullable<z.ZodString>;
                spaceId: z.ZodNullable<z.ZodString>;
                deviceId: z.ZodNullable<z.ZodString>;
                plantIds: z.ZodArray<z.ZodString>;
                cameraId: z.ZodNullable<z.ZodString>;
                taskId: z.ZodNullable<z.ZodString>;
                alertId: z.ZodNullable<z.ZodString>;
                severity: z.ZodNullable<z.ZodEnum<{
                    critical: "critical";
                    warning: "warning";
                    info: "info";
                }>>;
                text: z.ZodNullable<z.ZodString>;
                message: z.ZodNullable<z.ZodObject<{
                    key: z.ZodString;
                    params: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"water">;
                    litres: z.ZodNullable<z.ZodNumber>;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"feed">;
                    litres: z.ZodNullable<z.ZodNumber>;
                    schemeWeek: z.ZodNullable<z.ZodNumber>;
                    doses: z.ZodArray<z.ZodObject<{
                        productKey: z.ZodString;
                        name: z.ZodString;
                        amount: z.ZodNumber;
                        unit: z.ZodString;
                    }, z.core.$strip>>;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"measurement">;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"photo">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"note">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"training">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"visit">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"system">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"alarm">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"phase">;
                    phaseId: z.ZodString;
                    stage: z.ZodEnum<{
                        germination: "germination";
                        seedling: "seedling";
                        vegetative: "vegetative";
                        flowering: "flowering";
                        drying: "drying";
                        curing: "curing";
                    }>;
                    preset: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"move">;
                    placementId: z.ZodString;
                    spaceId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"harvest">;
                    wetWeightG: z.ZodNullable<z.ZodNumber>;
                    dryWeightG: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"plan">;
                    planId: z.ZodString;
                    stepIndex: z.ZodNumber;
                    transition: z.ZodNullable<z.ZodEnum<{
                        pause: "pause";
                        resume: "resume";
                        confirm: "confirm";
                        extend: "extend";
                        skip: "skip";
                    }>>;
                }, z.core.$strip>], "kind">;
                mediaIds: z.ZodArray<z.ZodString>;
                undoUntil: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            entryCount: z.ZodNumber;
            timelapseMediaId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        harvest: z.ZodNullable<z.ZodObject<{
            harvestedAt: z.ZodNullable<z.ZodISODateTime>;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        totals: z.ZodObject<{
            entryCount: z.ZodNumber;
            waterCount: z.ZodNumber;
            feedCount: z.ZodNumber;
            photoCount: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"space">;
    space: z.ZodObject<{
        spaceId: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<{
            other: "other";
            tent: "tent";
            fridge: "fridge";
            room: "room";
            balcony: "balcony";
        }>;
        roomId: z.ZodNullable<z.ZodString>;
        deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        values: z.ZodArray<z.ZodObject<{
            value: z.ZodNullable<z.ZodNumber>;
            measuredAt: z.ZodNullable<z.ZodISODateTime>;
            state: z.ZodEnum<{
                offline: "offline";
                live: "live";
                stale: "stale";
            }>;
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
        }, z.core.$strip>>;
        setpoints: z.ZodArray<z.ZodObject<{
            metric: z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>;
            value: z.ZodNullable<z.ZodNumber>;
            band: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        targets: z.ZodNullable<z.ZodObject<{
            day: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                value: z.ZodNullable<z.ZodNumber>;
                band: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            night: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                value: z.ZodNullable<z.ZodNumber>;
                band: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        verdict: z.ZodObject<{
            deviceId: z.ZodNullable<z.ZodString>;
            startsAt: z.ZodISODateTime;
            endsAt: z.ZodISODateTime;
            forSeconds: z.ZodNumber;
            stepSeconds: z.ZodNumber;
            rating: z.ZodNullable<z.ZodEnum<{
                watch: "watch";
                good: "good";
                poor: "poor";
            }>>;
            inBandFraction: z.ZodNullable<z.ZodNumber>;
            metrics: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                rating: z.ZodNullable<z.ZodEnum<{
                    watch: "watch";
                    good: "good";
                    poor: "poor";
                }>>;
                minValue: z.ZodNullable<z.ZodNumber>;
                maxValue: z.ZodNullable<z.ZodNumber>;
                averageValue: z.ZodNullable<z.ZodNumber>;
                dayBand: z.ZodNullable<z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>>;
                nightBand: z.ZodNullable<z.ZodObject<{
                    low: z.ZodNumber;
                    high: z.ZodNumber;
                }, z.core.$strip>>;
                inBandSeconds: z.ZodNumber;
                outOfBandSeconds: z.ZodNumber;
                excursions: z.ZodArray<z.ZodObject<{
                    startedAt: z.ZodISODateTime;
                    endedAt: z.ZodNullable<z.ZodISODateTime>;
                    above: z.ZodBoolean;
                    extremeValue: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            actuators: z.ZodArray<z.ZodObject<{
                output: z.ZodEnum<{
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
                runCount: z.ZodNumber;
                forSeconds: z.ZodNumber;
            }, z.core.$strip>>;
            trend: z.ZodNullable<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                stepSeconds: z.ZodNumber;
                endsAt: z.ZodISODateTime;
                points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        grows: z.ZodArray<z.ZodObject<{
            growId: z.ZodString;
            name: z.ZodString;
            type: z.ZodEnum<{
                photoperiod: "photoperiod";
                autoflower: "autoflower";
            }>;
            dayNumber: z.ZodNullable<z.ZodNumber>;
            phaseDay: z.ZodNullable<z.ZodNumber>;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            preset: z.ZodNullable<z.ZodString>;
            isAuto: z.ZodBoolean;
            plantCount: z.ZodNullable<z.ZodNumber>;
            strains: z.ZodArray<z.ZodString>;
            coverMediaId: z.ZodNullable<z.ZodString>;
            stageGroups: z.ZodArray<z.ZodObject<{
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                plantCount: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            weekNumber: z.ZodNullable<z.ZodNumber>;
            placedAt: z.ZodISODateTime;
            placedOnDay: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        cameras: z.ZodArray<z.ZodObject<{
            cameraId: z.ZodString;
            name: z.ZodString;
            lastStillAt: z.ZodNullable<z.ZodISODateTime>;
            stills: z.ZodArray<z.ZodObject<{
                mediaId: z.ZodString;
                capturedAt: z.ZodISODateTime;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        entries: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            createdAt: z.ZodISODateTime;
            kind: z.ZodEnum<{
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
            occurredAt: z.ZodISODateTime;
            source: z.ZodEnum<{
                alarm: "alarm";
                plan: "plan";
                human: "human";
                device: "device";
                preset: "preset";
            }>;
            authorId: z.ZodNullable<z.ZodString>;
            growId: z.ZodNullable<z.ZodString>;
            spaceId: z.ZodNullable<z.ZodString>;
            deviceId: z.ZodNullable<z.ZodString>;
            plantIds: z.ZodArray<z.ZodString>;
            cameraId: z.ZodNullable<z.ZodString>;
            taskId: z.ZodNullable<z.ZodString>;
            alertId: z.ZodNullable<z.ZodString>;
            severity: z.ZodNullable<z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>>;
            text: z.ZodNullable<z.ZodString>;
            message: z.ZodNullable<z.ZodObject<{
                key: z.ZodString;
                params: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"water">;
                litres: z.ZodNullable<z.ZodNumber>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"feed">;
                litres: z.ZodNullable<z.ZodNumber>;
                schemeWeek: z.ZodNullable<z.ZodNumber>;
                doses: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    amount: z.ZodNumber;
                    unit: z.ZodString;
                }, z.core.$strip>>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"measurement">;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    plantId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"photo">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"note">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"training">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"visit">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"system">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"alarm">;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"phase">;
                phaseId: z.ZodString;
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                preset: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                placementId: z.ZodString;
                spaceId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"harvest">;
                wetWeightG: z.ZodNullable<z.ZodNumber>;
                dryWeightG: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plan">;
                planId: z.ZodString;
                stepIndex: z.ZodNumber;
                transition: z.ZodNullable<z.ZodEnum<{
                    pause: "pause";
                    resume: "resume";
                    confirm: "confirm";
                    extend: "extend";
                    skip: "skip";
                }>>;
            }, z.core.$strip>], "kind">;
            mediaIds: z.ZodArray<z.ZodString>;
            undoUntil: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>>;
        readingNames: z.ZodArray<z.ZodObject<{
            growId: z.ZodString;
            readings: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                name: z.ZodString;
                unit: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        dueTasks: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                custom: "custom";
                water: "water";
                feed: "feed";
                chore: "chore";
            }>;
            label: z.ZodString;
            dueAt: z.ZodISODateTime;
            subject: z.ZodObject<{
                type: z.ZodEnum<{
                    grow: "grow";
                    space: "space";
                }>;
                id: z.ZodString;
            }, z.core.$strip>;
            assigneeId: z.ZodNullable<z.ZodString>;
            defaults: z.ZodAny;
        }, z.core.$strip>>;
        openAlerts: z.ZodArray<z.ZodObject<{
            alertId: z.ZodString;
            kind: z.ZodEnum<{
                threshold: "threshold";
                offline: "offline";
                camera_stale: "camera_stale";
            }>;
            severity: z.ZodEnum<{
                critical: "critical";
                warning: "warning";
                info: "info";
            }>;
            startedAt: z.ZodISODateTime;
            value: z.ZodNullable<z.ZodNumber>;
            metric: z.ZodNullable<z.ZodEnum<{
                offline: "offline";
                co2: "co2";
                temperature: "temperature";
                humidity: "humidity";
                leafTemperature: "leafTemperature";
                lux: "lux";
                vpd: "vpd";
                ppfd: "ppfd";
            }>>;
        }, z.core.$strip>>;
        people: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            handle: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>], "type">;
/**
 * `GET /shared/{token}`: what the token leads to. Never the `ShareLink` itself -
 * the token is the reader's only proof, and the link's counters, its owner and
 * the rest of its settings are none of their business - so this answers the
 * window the reader is inside and the thing they came to look at.
 */
export declare const sharedResolution: z.ZodObject<{
    kind: z.ZodEnum<{
        view: "view";
        public_page: "public_page";
    }>;
    range: z.ZodObject<{
        startsAt: z.ZodNullable<z.ZodISODateTime>;
        endsAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
    includeCameras: z.ZodBoolean;
    expiresAt: z.ZodNullable<z.ZodISODateTime>;
    subject: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"grow">;
        grow: z.ZodObject<{
            slug: z.ZodString;
            name: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            type: z.ZodEnum<{
                photoperiod: "photoperiod";
                autoflower: "autoflower";
            }>;
            author: z.ZodObject<{
                handle: z.ZodString;
                bio: z.ZodNullable<z.ZodString>;
                avatarMediaId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>;
            startedAt: z.ZodISODateTime;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            dayNumber: z.ZodNullable<z.ZodNumber>;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            preset: z.ZodNullable<z.ZodString>;
            plantCount: z.ZodNullable<z.ZodNumber>;
            strains: z.ZodArray<z.ZodString>;
            coverMediaId: z.ZodNullable<z.ZodString>;
            filmMediaId: z.ZodNullable<z.ZodString>;
            range: z.ZodObject<{
                startsAt: z.ZodNullable<z.ZodISODateTime>;
                endsAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>;
            includeCameras: z.ZodBoolean;
            weeks: z.ZodArray<z.ZodObject<{
                weekNumber: z.ZodNumber;
                dayFrom: z.ZodNumber;
                dayTo: z.ZodNumber;
                startsAt: z.ZodISODateTime;
                endsAt: z.ZodISODateTime;
                stage: z.ZodNullable<z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>>;
                preset: z.ZodNullable<z.ZodString>;
                stageWeek: z.ZodNullable<z.ZodNumber>;
                deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
                climate: z.ZodArray<z.ZodObject<{
                    metric: z.ZodEnum<{
                        offline: "offline";
                        co2: "co2";
                        temperature: "temperature";
                        humidity: "humidity";
                        leafTemperature: "leafTemperature";
                        lux: "lux";
                        vpd: "vpd";
                        ppfd: "ppfd";
                    }>;
                    minValue: z.ZodNullable<z.ZodNumber>;
                    maxValue: z.ZodNullable<z.ZodNumber>;
                    averageValue: z.ZodNullable<z.ZodNumber>;
                    dayAverage: z.ZodNullable<z.ZodNumber>;
                    nightAverage: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                lightHours: z.ZodNullable<z.ZodNumber>;
                days: z.ZodArray<z.ZodObject<{
                    dayNumber: z.ZodNumber;
                    startsAt: z.ZodISODateTime;
                    mediaId: z.ZodNullable<z.ZodString>;
                    cameraId: z.ZodNullable<z.ZodString>;
                    capturedAt: z.ZodNullable<z.ZodISODateTime>;
                }, z.core.$strip>>;
                feeding: z.ZodNullable<z.ZodObject<{
                    amounts: z.ZodArray<z.ZodObject<{
                        productKey: z.ZodString;
                        name: z.ZodString;
                        value: z.ZodNullable<z.ZodNumber>;
                        unit: z.ZodString;
                    }, z.core.$strip>>;
                    plannedCount: z.ZodNumber;
                }, z.core.$strip>>;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    value: z.ZodNumber;
                    change: z.ZodNullable<z.ZodNumber>;
                    measuredAt: z.ZodISODateTime;
                }, z.core.$strip>>;
                waterCount: z.ZodNumber;
                feedCount: z.ZodNumber;
                entries: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    createdAt: z.ZodISODateTime;
                    kind: z.ZodEnum<{
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
                    occurredAt: z.ZodISODateTime;
                    source: z.ZodEnum<{
                        alarm: "alarm";
                        plan: "plan";
                        human: "human";
                        device: "device";
                        preset: "preset";
                    }>;
                    authorId: z.ZodNullable<z.ZodString>;
                    growId: z.ZodNullable<z.ZodString>;
                    spaceId: z.ZodNullable<z.ZodString>;
                    deviceId: z.ZodNullable<z.ZodString>;
                    plantIds: z.ZodArray<z.ZodString>;
                    cameraId: z.ZodNullable<z.ZodString>;
                    taskId: z.ZodNullable<z.ZodString>;
                    alertId: z.ZodNullable<z.ZodString>;
                    severity: z.ZodNullable<z.ZodEnum<{
                        critical: "critical";
                        warning: "warning";
                        info: "info";
                    }>>;
                    text: z.ZodNullable<z.ZodString>;
                    message: z.ZodNullable<z.ZodObject<{
                        key: z.ZodString;
                        params: z.ZodArray<z.ZodString>;
                    }, z.core.$strip>>;
                    values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                        kind: z.ZodLiteral<"water">;
                        litres: z.ZodNullable<z.ZodNumber>;
                        readings: z.ZodArray<z.ZodObject<{
                            key: z.ZodString;
                            value: z.ZodNumber;
                            plantId: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"feed">;
                        litres: z.ZodNullable<z.ZodNumber>;
                        schemeWeek: z.ZodNullable<z.ZodNumber>;
                        doses: z.ZodArray<z.ZodObject<{
                            productKey: z.ZodString;
                            name: z.ZodString;
                            amount: z.ZodNumber;
                            unit: z.ZodString;
                        }, z.core.$strip>>;
                        readings: z.ZodArray<z.ZodObject<{
                            key: z.ZodString;
                            value: z.ZodNumber;
                            plantId: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"measurement">;
                        readings: z.ZodArray<z.ZodObject<{
                            key: z.ZodString;
                            value: z.ZodNumber;
                            plantId: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"photo">;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"note">;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"training">;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"visit">;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"system">;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"alarm">;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"phase">;
                        phaseId: z.ZodString;
                        stage: z.ZodEnum<{
                            germination: "germination";
                            seedling: "seedling";
                            vegetative: "vegetative";
                            flowering: "flowering";
                            drying: "drying";
                            curing: "curing";
                        }>;
                        preset: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"move">;
                        placementId: z.ZodString;
                        spaceId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"harvest">;
                        wetWeightG: z.ZodNullable<z.ZodNumber>;
                        dryWeightG: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>, z.ZodObject<{
                        kind: z.ZodLiteral<"plan">;
                        planId: z.ZodString;
                        stepIndex: z.ZodNumber;
                        transition: z.ZodNullable<z.ZodEnum<{
                            pause: "pause";
                            resume: "resume";
                            confirm: "confirm";
                            extend: "extend";
                            skip: "skip";
                        }>>;
                    }, z.core.$strip>], "kind">;
                    mediaIds: z.ZodArray<z.ZodString>;
                    undoUntil: z.ZodNullable<z.ZodISODateTime>;
                }, z.core.$strip>>;
                entryCount: z.ZodNumber;
                timelapseMediaId: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            harvest: z.ZodNullable<z.ZodObject<{
                harvestedAt: z.ZodNullable<z.ZodISODateTime>;
                wetWeightG: z.ZodNullable<z.ZodNumber>;
                dryWeightG: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            totals: z.ZodObject<{
                entryCount: z.ZodNumber;
                waterCount: z.ZodNumber;
                feedCount: z.ZodNumber;
                photoCount: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"space">;
        space: z.ZodObject<{
            spaceId: z.ZodString;
            name: z.ZodString;
            kind: z.ZodEnum<{
                other: "other";
                tent: "tent";
                fridge: "fridge";
                room: "room";
                balcony: "balcony";
            }>;
            roomId: z.ZodNullable<z.ZodString>;
            deviceIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
            values: z.ZodArray<z.ZodObject<{
                value: z.ZodNullable<z.ZodNumber>;
                measuredAt: z.ZodNullable<z.ZodISODateTime>;
                state: z.ZodEnum<{
                    offline: "offline";
                    live: "live";
                    stale: "stale";
                }>;
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
            }, z.core.$strip>>;
            setpoints: z.ZodArray<z.ZodObject<{
                metric: z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>;
                value: z.ZodNullable<z.ZodNumber>;
                band: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            targets: z.ZodNullable<z.ZodObject<{
                day: z.ZodArray<z.ZodObject<{
                    metric: z.ZodEnum<{
                        offline: "offline";
                        co2: "co2";
                        temperature: "temperature";
                        humidity: "humidity";
                        leafTemperature: "leafTemperature";
                        lux: "lux";
                        vpd: "vpd";
                        ppfd: "ppfd";
                    }>;
                    value: z.ZodNullable<z.ZodNumber>;
                    band: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                night: z.ZodArray<z.ZodObject<{
                    metric: z.ZodEnum<{
                        offline: "offline";
                        co2: "co2";
                        temperature: "temperature";
                        humidity: "humidity";
                        leafTemperature: "leafTemperature";
                        lux: "lux";
                        vpd: "vpd";
                        ppfd: "ppfd";
                    }>;
                    value: z.ZodNullable<z.ZodNumber>;
                    band: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            verdict: z.ZodObject<{
                deviceId: z.ZodNullable<z.ZodString>;
                startsAt: z.ZodISODateTime;
                endsAt: z.ZodISODateTime;
                forSeconds: z.ZodNumber;
                stepSeconds: z.ZodNumber;
                rating: z.ZodNullable<z.ZodEnum<{
                    watch: "watch";
                    good: "good";
                    poor: "poor";
                }>>;
                inBandFraction: z.ZodNullable<z.ZodNumber>;
                metrics: z.ZodArray<z.ZodObject<{
                    metric: z.ZodEnum<{
                        offline: "offline";
                        co2: "co2";
                        temperature: "temperature";
                        humidity: "humidity";
                        leafTemperature: "leafTemperature";
                        lux: "lux";
                        vpd: "vpd";
                        ppfd: "ppfd";
                    }>;
                    rating: z.ZodNullable<z.ZodEnum<{
                        watch: "watch";
                        good: "good";
                        poor: "poor";
                    }>>;
                    minValue: z.ZodNullable<z.ZodNumber>;
                    maxValue: z.ZodNullable<z.ZodNumber>;
                    averageValue: z.ZodNullable<z.ZodNumber>;
                    dayBand: z.ZodNullable<z.ZodObject<{
                        low: z.ZodNumber;
                        high: z.ZodNumber;
                    }, z.core.$strip>>;
                    nightBand: z.ZodNullable<z.ZodObject<{
                        low: z.ZodNumber;
                        high: z.ZodNumber;
                    }, z.core.$strip>>;
                    inBandSeconds: z.ZodNumber;
                    outOfBandSeconds: z.ZodNumber;
                    excursions: z.ZodArray<z.ZodObject<{
                        startedAt: z.ZodISODateTime;
                        endedAt: z.ZodNullable<z.ZodISODateTime>;
                        above: z.ZodBoolean;
                        extremeValue: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                actuators: z.ZodArray<z.ZodObject<{
                    output: z.ZodEnum<{
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
                    runCount: z.ZodNumber;
                    forSeconds: z.ZodNumber;
                }, z.core.$strip>>;
                trend: z.ZodNullable<z.ZodObject<{
                    metric: z.ZodEnum<{
                        offline: "offline";
                        co2: "co2";
                        temperature: "temperature";
                        humidity: "humidity";
                        leafTemperature: "leafTemperature";
                        lux: "lux";
                        vpd: "vpd";
                        ppfd: "ppfd";
                    }>;
                    stepSeconds: z.ZodNumber;
                    endsAt: z.ZodISODateTime;
                    points: z.ZodArray<z.ZodNullable<z.ZodNumber>>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
            grows: z.ZodArray<z.ZodObject<{
                growId: z.ZodString;
                name: z.ZodString;
                type: z.ZodEnum<{
                    photoperiod: "photoperiod";
                    autoflower: "autoflower";
                }>;
                dayNumber: z.ZodNullable<z.ZodNumber>;
                phaseDay: z.ZodNullable<z.ZodNumber>;
                stage: z.ZodNullable<z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>>;
                preset: z.ZodNullable<z.ZodString>;
                isAuto: z.ZodBoolean;
                plantCount: z.ZodNullable<z.ZodNumber>;
                strains: z.ZodArray<z.ZodString>;
                coverMediaId: z.ZodNullable<z.ZodString>;
                stageGroups: z.ZodArray<z.ZodObject<{
                    stage: z.ZodEnum<{
                        germination: "germination";
                        seedling: "seedling";
                        vegetative: "vegetative";
                        flowering: "flowering";
                        drying: "drying";
                        curing: "curing";
                    }>;
                    plantCount: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                weekNumber: z.ZodNullable<z.ZodNumber>;
                placedAt: z.ZodISODateTime;
                placedOnDay: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            cameras: z.ZodArray<z.ZodObject<{
                cameraId: z.ZodString;
                name: z.ZodString;
                lastStillAt: z.ZodNullable<z.ZodISODateTime>;
                stills: z.ZodArray<z.ZodObject<{
                    mediaId: z.ZodString;
                    capturedAt: z.ZodISODateTime;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            entries: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                createdAt: z.ZodISODateTime;
                kind: z.ZodEnum<{
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
                occurredAt: z.ZodISODateTime;
                source: z.ZodEnum<{
                    alarm: "alarm";
                    plan: "plan";
                    human: "human";
                    device: "device";
                    preset: "preset";
                }>;
                authorId: z.ZodNullable<z.ZodString>;
                growId: z.ZodNullable<z.ZodString>;
                spaceId: z.ZodNullable<z.ZodString>;
                deviceId: z.ZodNullable<z.ZodString>;
                plantIds: z.ZodArray<z.ZodString>;
                cameraId: z.ZodNullable<z.ZodString>;
                taskId: z.ZodNullable<z.ZodString>;
                alertId: z.ZodNullable<z.ZodString>;
                severity: z.ZodNullable<z.ZodEnum<{
                    critical: "critical";
                    warning: "warning";
                    info: "info";
                }>>;
                text: z.ZodNullable<z.ZodString>;
                message: z.ZodNullable<z.ZodObject<{
                    key: z.ZodString;
                    params: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                values: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"water">;
                    litres: z.ZodNullable<z.ZodNumber>;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"feed">;
                    litres: z.ZodNullable<z.ZodNumber>;
                    schemeWeek: z.ZodNullable<z.ZodNumber>;
                    doses: z.ZodArray<z.ZodObject<{
                        productKey: z.ZodString;
                        name: z.ZodString;
                        amount: z.ZodNumber;
                        unit: z.ZodString;
                    }, z.core.$strip>>;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"measurement">;
                    readings: z.ZodArray<z.ZodObject<{
                        key: z.ZodString;
                        value: z.ZodNumber;
                        plantId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"photo">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"note">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"training">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"visit">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"system">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"alarm">;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"phase">;
                    phaseId: z.ZodString;
                    stage: z.ZodEnum<{
                        germination: "germination";
                        seedling: "seedling";
                        vegetative: "vegetative";
                        flowering: "flowering";
                        drying: "drying";
                        curing: "curing";
                    }>;
                    preset: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"move">;
                    placementId: z.ZodString;
                    spaceId: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"harvest">;
                    wetWeightG: z.ZodNullable<z.ZodNumber>;
                    dryWeightG: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"plan">;
                    planId: z.ZodString;
                    stepIndex: z.ZodNumber;
                    transition: z.ZodNullable<z.ZodEnum<{
                        pause: "pause";
                        resume: "resume";
                        confirm: "confirm";
                        extend: "extend";
                        skip: "skip";
                    }>>;
                }, z.core.$strip>], "kind">;
                mediaIds: z.ZodArray<z.ZodString>;
                undoUntil: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            readingNames: z.ZodArray<z.ZodObject<{
                growId: z.ZodString;
                readings: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    name: z.ZodString;
                    unit: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            dueTasks: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    custom: "custom";
                    water: "water";
                    feed: "feed";
                    chore: "chore";
                }>;
                label: z.ZodString;
                dueAt: z.ZodISODateTime;
                subject: z.ZodObject<{
                    type: z.ZodEnum<{
                        grow: "grow";
                        space: "space";
                    }>;
                    id: z.ZodString;
                }, z.core.$strip>;
                assigneeId: z.ZodNullable<z.ZodString>;
                defaults: z.ZodAny;
            }, z.core.$strip>>;
            openAlerts: z.ZodArray<z.ZodObject<{
                alertId: z.ZodString;
                kind: z.ZodEnum<{
                    threshold: "threshold";
                    offline: "offline";
                    camera_stale: "camera_stale";
                }>;
                severity: z.ZodEnum<{
                    critical: "critical";
                    warning: "warning";
                    info: "info";
                }>;
                startedAt: z.ZodISODateTime;
                value: z.ZodNullable<z.ZodNumber>;
                metric: z.ZodNullable<z.ZodEnum<{
                    offline: "offline";
                    co2: "co2";
                    temperature: "temperature";
                    humidity: "humidity";
                    leafTemperature: "leafTemperature";
                    lux: "lux";
                    vpd: "vpd";
                    ppfd: "ppfd";
                }>>;
            }, z.core.$strip>>;
            people: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                handle: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>], "type">;
}, z.core.$strip>;
/**
 * What the small HTML shell puts in its Open Graph tags and what `card.png` is
 * drawn from, so the two cannot say different things.
 */
export declare const linkCard: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
    pageUrl: z.ZodString;
    imageUrl: z.ZodString;
    handle: z.ZodNullable<z.ZodString>;
    dayNumber: z.ZodNullable<z.ZodNumber>;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
}, z.core.$strip>;
