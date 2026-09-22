import { z } from 'zod';
/**
 * Places, people and grows: `spaces`, `memberships`, `invites`, `grows`,
 * `plants`, `follows` and `reminders`, the value objects they are built from,
 * and the shapes the API derives from them.
 *
 * A grow is the whole story of a set of plants: where they stand, what stage
 * they are in and what they are fed. None of that lives on a device - a grow
 * exists without one, and a device without a grow.
 */
/** Whether applying a climate preset to this space offers to set a grow's phase. */
export declare const presetPrompt: z.ZodEnum<{
    never: "never";
    ask: "ask";
}>;
export declare const spaceRetention: z.ZodObject<{
    climateDays: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const space: z.ZodObject<{
    id: z.ZodString;
    ownerId: z.ZodString;
    kind: z.ZodEnum<{
        other: "other";
        tent: "tent";
        fridge: "fridge";
        room: "room";
        balcony: "balcony";
    }>;
    name: z.ZodString;
    roomId: z.ZodNullable<z.ZodString>;
    presetPrompt: z.ZodEnum<{
        never: "never";
        ask: "ask";
    }>;
    retention: z.ZodObject<{
        climateDays: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    isDemo: z.ZodBoolean;
    archivedAt: z.ZodNullable<z.ZodISODateTime>;
    createdAt: z.ZodISODateTime;
}, z.core.$strip>;
/**
 * One row per person who is not the owner. The owner is `spaces.ownerId` and
 * never a row here, so there is no `owner` role; a membership on a room covers
 * every space in it.
 */
export declare const membership: z.ZodObject<{
    id: z.ZodString;
    spaceId: z.ZodString;
    userId: z.ZodString;
    role: z.ZodEnum<{
        can_log: "can_log";
        can_manage: "can_manage";
    }>;
    invitedBy: z.ZodNullable<z.ZodString>;
    inviteId: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodISODateTime;
}, z.core.$strip>;
/** Maintained by the server: what the link has done since it was made. */
export declare const inviteState: z.ZodObject<{
    useCount: z.ZodNumber;
    lastUsedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * One code serves the link, the typed code and the QR, so it is short enough to
 * read aloud. It is also the whole proof of the invitation, so it is answered
 * only to whoever may manage the space - a redemption is addressed by the code
 * itself and is told nothing about it.
 */
export declare const invite: z.ZodObject<{
    id: z.ZodString;
    code: z.ZodString;
    spaceId: z.ZodString;
    role: z.ZodEnum<{
        can_log: "can_log";
        can_manage: "can_manage";
    }>;
    createdBy: z.ZodString;
    expiresAt: z.ZodNullable<z.ZodISODateTime>;
    revokedAt: z.ZodNullable<z.ZodISODateTime>;
    state: z.ZodObject<{
        useCount: z.ZodNumber;
        lastUsedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
    createdAt: z.ZodISODateTime;
}, z.core.$strip>;
/** Who put the grow into this phase. `preset` and `plan` are what the "auto" tag is drawn from. */
export declare const phaseSource: z.ZodEnum<{
    plan: "plan";
    human: "human";
    preset: "preset";
}>;
/** Day and night, as the controller's configuration states them. */
export declare const climateTargets: z.ZodObject<{
    temperature: z.ZodNullable<z.ZodNumber>;
    humidity: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const phaseTargets: z.ZodObject<{
    day: z.ZodObject<{
        temperature: z.ZodNullable<z.ZodNumber>;
        humidity: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    night: z.ZodObject<{
        temperature: z.ZodNullable<z.ZodNumber>;
        humidity: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    co2: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * `stage` is the botanical fact and crosses the device protocol; `preset` is the
 * climate preset that was applied and is only a label. "Late flower" is
 * `flowering` with the preset `late_flowering`, which is how the screens draw a
 * seventh step without inventing a seventh stage. A preset table ships with the
 * client and may grow without the wire contract changing, so `preset` is a
 * string rather than an enum.
 */
export declare const phase: z.ZodObject<{
    id: z.ZodString;
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
    source: z.ZodEnum<{
        plan: "plan";
        human: "human";
        preset: "preset";
    }>;
    plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
    deviceId: z.ZodNullable<z.ZodString>;
    targets: z.ZodNullable<z.ZodObject<{
        day: z.ZodObject<{
            temperature: z.ZodNullable<z.ZodNumber>;
            humidity: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        night: z.ZodObject<{
            temperature: z.ZodNullable<z.ZodNumber>;
            humidity: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        co2: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    setBy: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** Where a set of plants stands, for a stretch of time. Overlapping placements are how a grow is in two places at once. */
export declare const placement: z.ZodObject<{
    id: z.ZodString;
    spaceId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/**
 * Where the grid came from. A shipped scheme is a JSON asset of the client, so
 * the server knows only which asset and which version; `own` points at the
 * user's own scheme, whose own origin is `SchemeOrigin`.
 */
export declare const growSchemeOrigin: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"asset">;
    assetId: z.ZodString;
    version: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"own">;
    schemeId: z.ZodString;
}, z.core.$strip>], "type">;
/**
 * The effective feeding grid of this grow. The server never reads a shipped
 * scheme, so the grow carries the grid itself: that is also what keeps a grow's
 * history stable when the scheme it came from is edited later.
 */
export declare const growScheme: z.ZodObject<{
    origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"asset">;
        assetId: z.ZodString;
        version: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"own">;
        schemeId: z.ZodString;
    }, z.core.$strip>], "type">;
    strength: z.ZodNumber;
    waterEc: z.ZodNullable<z.ZodNumber>;
    plantType: z.ZodString;
    flipWeek: z.ZodNullable<z.ZodNumber>;
    edited: z.ZodBoolean;
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
        amounts: z.ZodArray<z.ZodObject<{
            productKey: z.ZodString;
            name: z.ZodString;
            value: z.ZodNullable<z.ZodNumber>;
            unit: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** What this grow measures beyond climate. `entries.values.readings` is keyed by `key`. */
export declare const measurementDefinition: z.ZodObject<{
    key: z.ZodString;
    name: z.ZodString;
    unit: z.ZodString;
    perPlant: z.ZodBoolean;
    target: z.ZodNullable<z.ZodNumber>;
    chart: z.ZodBoolean;
}, z.core.$strip>;
export declare const growVisibility: z.ZodEnum<{
    private: "private";
    public: "public";
}>;
export declare const grow: z.ZodObject<{
    id: z.ZodString;
    ownerId: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    type: z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>;
    phases: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
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
        source: z.ZodEnum<{
            plan: "plan";
            human: "human";
            preset: "preset";
        }>;
        plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        deviceId: z.ZodNullable<z.ZodString>;
        targets: z.ZodNullable<z.ZodObject<{
            day: z.ZodObject<{
                temperature: z.ZodNullable<z.ZodNumber>;
                humidity: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            night: z.ZodObject<{
                temperature: z.ZodNullable<z.ZodNumber>;
                humidity: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            co2: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        setBy: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    placements: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        spaceId: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    scheme: z.ZodNullable<z.ZodObject<{
        origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"asset">;
            assetId: z.ZodString;
            version: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"own">;
            schemeId: z.ZodString;
        }, z.core.$strip>], "type">;
        strength: z.ZodNumber;
        waterEc: z.ZodNullable<z.ZodNumber>;
        plantType: z.ZodString;
        flipWeek: z.ZodNullable<z.ZodNumber>;
        edited: z.ZodBoolean;
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
            amounts: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                value: z.ZodNullable<z.ZodNumber>;
                unit: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    measurements: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        name: z.ZodString;
        unit: z.ZodString;
        perPlant: z.ZodBoolean;
        target: z.ZodNullable<z.ZodNumber>;
        chart: z.ZodBoolean;
    }, z.core.$strip>>;
    visibility: z.ZodEnum<{
        private: "private";
        public: "public";
    }>;
    slug: z.ZodString;
    coverMediaId: z.ZodNullable<z.ZodString>;
    filmMediaId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    isDemo: z.ZodBoolean;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare const plantStatus: z.ZodEnum<{
    active: "active";
    ended: "ended";
    harvested: "harvested";
}>;
/** Weights are stripped from every view but the owner's and a member's. */
export declare const plantHarvest: z.ZodObject<{
    harvestedAt: z.ZodISODateTime;
    wetWeightG: z.ZodNullable<z.ZodNumber>;
    dryWeightG: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * A plant is a document of its own, so a phase, a placement or a harvest can
 * name exactly these plants and a count is simply how many rows there are.
 */
export declare const plant: z.ZodObject<{
    id: z.ZodString;
    growId: z.ZodString;
    strain: z.ZodString;
    label: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        ended: "ended";
        harvested: "harvested";
    }>;
    harvest: z.ZodNullable<z.ZodObject<{
        harvestedAt: z.ZodISODateTime;
        wetWeightG: z.ZodNullable<z.ZodNumber>;
        dryWeightG: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    createdAt: z.ZodISODateTime;
}, z.core.$strip>;
/**
 * One person following one grow. `PUT /follows/{growId}` and its `DELETE` carry
 * no body - the grow is in the path and a follow has nothing else to say - and
 * the `PUT` answers this. What the home screen draws for a followed grow is a
 * read model of the diary half rather than a fatter follow, because a follower
 * sees a public grow and only what its public page shows.
 */
export declare const follow: z.ZodObject<{
    id: z.ZodString;
    userId: z.ZodString;
    growId: z.ZodString;
    createdAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare const reminder: z.ZodObject<{
    id: z.ZodString;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    kind: z.ZodEnum<{
        custom: "custom";
        water: "water";
        feed: "feed";
        chore: "chore";
    }>;
    label: z.ZodString;
    everyDays: z.ZodNullable<z.ZodNumber>;
    onceAt: z.ZodNullable<z.ZodISODateTime>;
    assigneeId: z.ZodNullable<z.ZodString>;
    defaults: z.ZodAny;
    createdBy: z.ZodString;
    createdAt: z.ZodISODateTime;
}, z.core.$strip>;
/** Where a derived task comes from: a reminder, the grow's scheme grid, the end of a plan step, or a plan's suggestion. */
export declare const taskSource: z.ZodEnum<{
    scheme: "scheme";
    reminder: "reminder";
    plan_step: "plan_step";
    plan_suggestion: "plan_suggestion";
}>;
/**
 * The entry that ticked a task off, as the list of what was done names it: a
 * task has nothing of its own to say when it was done, so it says which line
 * did and lets that line carry the instant and the author.
 */
export declare const taskCompletion: z.ZodObject<{
    entryId: z.ZodString;
    occurredAt: z.ZodISODateTime;
    authorId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * Derived on every read and never stored, which is why nothing has to be kept
 * in sync. "Done" is an entry carrying this `id` as its `taskId`.
 */
export declare const task: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodEnum<{
        scheme: "scheme";
        reminder: "reminder";
        plan_step: "plan_step";
        plan_suggestion: "plan_suggestion";
    }>;
    sourceId: z.ZodNullable<z.ZodString>;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    kind: z.ZodEnum<{
        custom: "custom";
        water: "water";
        feed: "feed";
        chore: "chore";
    }>;
    label: z.ZodString;
    dueAt: z.ZodISODateTime;
    assigneeId: z.ZodNullable<z.ZodString>;
    defaults: z.ZodAny;
    done: z.ZodBoolean;
    completion: z.ZodNullable<z.ZodObject<{
        entryId: z.ZodString;
        occurredAt: z.ZodISODateTime;
        authorId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One phase and the plants in it, for a grow whose plants are not all in the same phase. */
export declare const phaseGroup: z.ZodObject<{
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    preset: z.ZodNullable<z.ZodString>;
    phaseDay: z.ZodNumber;
    plantIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/** Where the plants are now, from the open placements. */
export declare const growLocation: z.ZodObject<{
    spaceId: z.ZodNullable<z.ZodString>;
    plantIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/**
 * What the grow's `phases[]` and `placements[]` mean, worked out once in the
 * serialiser so that no client counts days itself.
 */
export declare const growSummary: z.ZodObject<{
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
    phaseDay: z.ZodNullable<z.ZodNumber>;
    weekNumber: z.ZodNullable<z.ZodNumber>;
    isAuto: z.ZodBoolean;
    groups: z.ZodArray<z.ZodObject<{
        stage: z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>;
        preset: z.ZodNullable<z.ZodString>;
        phaseDay: z.ZodNumber;
        plantIds: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    locations: z.ZodArray<z.ZodObject<{
        spaceId: z.ZodNullable<z.ZodString>;
        plantIds: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * The grow with what its phases and placements mean worked out beside it. The
 * summary is computed in the serialiser, so it rides on every answer that
 * carries a grow - `GET /grows/{id}` as much as a page of them - and no client
 * counts days for itself.
 */
export declare const growListItem: z.ZodObject<{
    id: z.ZodString;
    ownerId: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    type: z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>;
    phases: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
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
        source: z.ZodEnum<{
            plan: "plan";
            human: "human";
            preset: "preset";
        }>;
        plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        deviceId: z.ZodNullable<z.ZodString>;
        targets: z.ZodNullable<z.ZodObject<{
            day: z.ZodObject<{
                temperature: z.ZodNullable<z.ZodNumber>;
                humidity: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            night: z.ZodObject<{
                temperature: z.ZodNullable<z.ZodNumber>;
                humidity: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            co2: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        setBy: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    placements: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        spaceId: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    scheme: z.ZodNullable<z.ZodObject<{
        origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"asset">;
            assetId: z.ZodString;
            version: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"own">;
            schemeId: z.ZodString;
        }, z.core.$strip>], "type">;
        strength: z.ZodNumber;
        waterEc: z.ZodNullable<z.ZodNumber>;
        plantType: z.ZodString;
        flipWeek: z.ZodNullable<z.ZodNumber>;
        edited: z.ZodBoolean;
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
            amounts: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                value: z.ZodNullable<z.ZodNumber>;
                unit: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    measurements: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        name: z.ZodString;
        unit: z.ZodString;
        perPlant: z.ZodBoolean;
        target: z.ZodNullable<z.ZodNumber>;
        chart: z.ZodBoolean;
    }, z.core.$strip>>;
    visibility: z.ZodEnum<{
        private: "private";
        public: "public";
    }>;
    slug: z.ZodString;
    coverMediaId: z.ZodNullable<z.ZodString>;
    filmMediaId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    isDemo: z.ZodBoolean;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    summary: z.ZodObject<{
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
        phaseDay: z.ZodNullable<z.ZodNumber>;
        weekNumber: z.ZodNullable<z.ZodNumber>;
        isAuto: z.ZodBoolean;
        groups: z.ZodArray<z.ZodObject<{
            stage: z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>;
            preset: z.ZodNullable<z.ZodString>;
            phaseDay: z.ZodNumber;
            plantIds: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        locations: z.ZodArray<z.ZodObject<{
            spaceId: z.ZodNullable<z.ZodString>;
            plantIds: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * `POST /spaces`. A space is little more than a name and a kind; the room it
 * hangs in and the two settings have defaults, so the sheet that creates one
 * asks for two fields.
 */
export declare const spaceCreate: z.ZodObject<{
    name: z.ZodString;
    retention: z.ZodOptional<z.ZodObject<{
        climateDays: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    kind: z.ZodEnum<{
        other: "other";
        tent: "tent";
        fridge: "fridge";
        room: "room";
        balcony: "balcony";
    }>;
    presetPrompt: z.ZodOptional<z.ZodEnum<{
        never: "never";
        ask: "ask";
    }>>;
    roomId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * `PATCH /spaces/{id}`: the same fields, each only if it changes. `archivedAt`
 * is not among them - archiving is a route of its own, so that ending a space's
 * life is never something a settings form does in passing.
 */
export declare const spaceUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    retention: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        climateDays: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>>;
    kind: z.ZodOptional<z.ZodEnum<{
        other: "other";
        tent: "tent";
        fridge: "fridge";
        room: "room";
        balcony: "balcony";
    }>>;
    presetPrompt: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
        never: "never";
        ask: "ask";
    }>>>;
    roomId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
}, z.core.$strip>;
/**
 * Placing a device in a space and taking it out again. The two ids are the whole
 * statement, so neither direction carries a body, and what comes back is this
 * pair rather than the device: `spaceId` is all that changed, and what a device
 * is belongs to the device routes.
 */
export declare const devicePlacement: z.ZodObject<{
    deviceId: z.ZodString;
    spaceId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * What a client may do about the grow when a preset is applied to a space that
 * has no open grow: start one here, move an existing one here, or leave grows
 * out of it and change the climate only.
 */
export declare const growDecision: z.ZodEnum<{
    start_grow: "start_grow";
    move_grow: "move_grow";
    climate_only: "climate_only";
}>;
/**
 * What applying a preset did to a plan running on the same space. The plan
 * engine re-applies its step hourly and would undo the preset, so the plan is
 * skipped forward when its next step carries the requested stage and paused when
 * it does not.
 */
export declare const presetPlanEffect: z.ZodEnum<{
    skipped: "skipped";
    none: "none";
    paused: "paused";
}>;
/**
 * `POST /spaces/{id}/preset-applications`. A preset is a climate preset on top
 * of a botanical stage, and applying one writes the space's controllers and,
 * where a grow is open there, its phase.
 *
 * `decision` is sent on the second attempt, after an answer came back asking for
 * one; `growId` goes with `move_grow` and is read with nothing else.
 */
export declare const presetApplicationCreate: z.ZodObject<{
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    preset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    decision: z.ZodOptional<z.ZodEnum<{
        start_grow: "start_grow";
        move_grow: "move_grow";
        climate_only: "climate_only";
    }>>;
    growId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * What applying a preset did. Nothing of it is stored - what lasts is the phase,
 * the devices' settings and the diary entry - so the answer states what happened
 * rather than a row that could be read back afterwards.
 *
 * `decisions` is empty unless `growDecisionNeeded` is true, and is then what the
 * client may offer. The climate has been written either way, so somebody who
 * closes that sheet has still changed the tent.
 */
export declare const presetApplication: z.ZodObject<{
    spaceId: z.ZodString;
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    preset: z.ZodNullable<z.ZodString>;
    appliedAt: z.ZodISODateTime;
    deviceIds: z.ZodArray<z.ZodString>;
    growId: z.ZodNullable<z.ZodString>;
    phaseId: z.ZodNullable<z.ZodString>;
    growDecisionNeeded: z.ZodBoolean;
    decisions: z.ZodArray<z.ZodEnum<{
        start_grow: "start_grow";
        move_grow: "move_grow";
        climate_only: "climate_only";
    }>>;
    planEffect: z.ZodEnum<{
        skipped: "skipped";
        none: "none";
        paused: "paused";
    }>;
}, z.core.$strip>;
/**
 * `POST /spaces/{id}/members`. A member is named by id, which is what an invite
 * produces. There is no directory to search, so adding somebody by hand is for
 * an account that is already known; everybody else arrives through a code.
 */
export declare const membershipCreate: z.ZodObject<{
    role: z.ZodEnum<{
        can_log: "can_log";
        can_manage: "can_manage";
    }>;
    userId: z.ZodString;
}, z.core.$strip>;
/**
 * `PATCH /spaces/{id}/members/{userId}`. The role is the only thing about a
 * membership that changes, and a change naming none would say nothing, so this
 * one is not partial.
 */
export declare const membershipUpdate: z.ZodObject<{
    role: z.ZodEnum<{
        can_log: "can_log";
        can_manage: "can_manage";
    }>;
}, z.core.$strip>;
/**
 * `POST /spaces/{id}/invites`. The code, the space and who made it are the
 * server's; what is asked for is what the link grants and how long it lives, and
 * an absent or null `expiresAt` is a link that does not expire by itself.
 */
export declare const inviteCreate: z.ZodObject<{
    role: z.ZodEnum<{
        can_log: "can_log";
        can_manage: "can_manage";
    }>;
    expiresAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
}, z.core.$strip>;
/**
 * `GET /invites/{code}`, the one route here that answers a stranger: whoever
 * holds a code sees what they are being invited to before signing in or signing
 * up. It carries no id at all - not the space's, not the inviter's - so a code
 * that was guessed discloses nothing that could be asked about afterwards, and
 * the inviter is named by handle, the only name others ever see.
 */
export declare const invitePreview: z.ZodObject<{
    spaceName: z.ZodString;
    spaceKind: z.ZodEnum<{
        other: "other";
        tent: "tent";
        fridge: "fridge";
        room: "room";
        balcony: "balcony";
    }>;
    role: z.ZodEnum<{
        can_log: "can_log";
        can_manage: "can_manage";
    }>;
    invitedByHandle: z.ZodString;
    expiresAt: z.ZodNullable<z.ZodISODateTime>;
    isValid: z.ZodBoolean;
}, z.core.$strip>;
/**
 * `POST /invites/{code}/acceptances`. The membership on its own would leave a
 * new member holding two ids and no name, and they have never seen this space
 * before, so what the code let them into comes back with it.
 */
export declare const inviteAcceptance: z.ZodObject<{
    membership: z.ZodObject<{
        id: z.ZodString;
        spaceId: z.ZodString;
        userId: z.ZodString;
        role: z.ZodEnum<{
            can_log: "can_log";
            can_manage: "can_manage";
        }>;
        invitedBy: z.ZodNullable<z.ZodString>;
        inviteId: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>;
    space: z.ZodObject<{
        id: z.ZodString;
        ownerId: z.ZodString;
        kind: z.ZodEnum<{
            other: "other";
            tent: "tent";
            fridge: "fridge";
            room: "room";
            balcony: "balcony";
        }>;
        name: z.ZodString;
        roomId: z.ZodNullable<z.ZodString>;
        presetPrompt: z.ZodEnum<{
            never: "never";
            ask: "ask";
        }>;
        retention: z.ZodObject<{
            climateDays: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        isDemo: z.ZodBoolean;
        archivedAt: z.ZodNullable<z.ZodISODateTime>;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * A row of the new-grow sheet: "Amnesia × 8" becomes eight plants labelled
 * "Amnesia 1" to "Amnesia 8".
 */
export declare const plantBatch: z.ZodObject<{
    strain: z.ZodString;
    count: z.ZodNumber;
}, z.core.$strip>;
export declare const growCreate: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    type: z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plants: z.ZodArray<z.ZodObject<{
        strain: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>;
    scheme: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"asset">;
            assetId: z.ZodString;
            version: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"own">;
            schemeId: z.ZodString;
        }, z.core.$strip>], "type">;
        strength: z.ZodNumber;
        waterEc: z.ZodNullable<z.ZodNumber>;
        plantType: z.ZodString;
        flipWeek: z.ZodNullable<z.ZodNumber>;
        edited: z.ZodBoolean;
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
            amounts: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                value: z.ZodNullable<z.ZodNumber>;
                unit: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    measurements: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        name: z.ZodString;
        unit: z.ZodString;
        perPlant: z.ZodBoolean;
        target: z.ZodNullable<z.ZodNumber>;
        chart: z.ZodBoolean;
    }, z.core.$strip>>>;
    visibility: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
    }>>;
}, z.core.$strip>;
/**
 * The manual stage picker and the plan write the same phase; `source`, the
 * targets and `setBy` are the server's to fill in, so a request carries neither.
 */
export declare const phaseCreate: z.ZodObject<{
    stage: z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>;
    preset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    plantIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
}, z.core.$strip>;
/** A move: the open placement of these plants is closed and a new one opened. */
export declare const placementCreate: z.ZodObject<{
    spaceId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    plantIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
}, z.core.$strip>;
export declare const harvestCreate: z.ZodObject<{
    plantIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    harvestedAt: z.ZodOptional<z.ZodISODateTime>;
    wetWeightG: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    dryWeightG: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
/**
 * What a harvest answers. There is no harvest resource to hand back: what a
 * harvest leaves behind is a weight on every plant it named and one entry in the
 * timeline, so the answer is those rows rather than something that could be read
 * again afterwards.
 */
export declare const harvestResult: z.ZodObject<{
    plants: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        growId: z.ZodString;
        strain: z.ZodString;
        label: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            ended: "ended";
            harvested: "harvested";
        }>;
        harvest: z.ZodNullable<z.ZodObject<{
            harvestedAt: z.ZodISODateTime;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    entryId: z.ZodString;
}, z.core.$strip>;
/**
 * These plants go their own way: they get their own phase, their own place, or
 * both, while the rest of the grow carries on. "4 drying in the fridge, 4 still
 * flowering" is one of these.
 */
export declare const splitCreate: z.ZodObject<{
    plantIds: z.ZodArray<z.ZodString>;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    stage: z.ZodOptional<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    preset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * What a split answers: what it appended to the grow. A split that names a stage
 * opens a phase scoped to those plants, and one that names a space opens a
 * placement for them, so either may be null - but never both, because a split
 * that does neither has not split anything.
 */
export declare const splitResult: z.ZodObject<{
    plantIds: z.ZodArray<z.ZodString>;
    phase: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
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
        source: z.ZodEnum<{
            plan: "plan";
            human: "human";
            preset: "preset";
        }>;
        plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        deviceId: z.ZodNullable<z.ZodString>;
        targets: z.ZodNullable<z.ZodObject<{
            day: z.ZodObject<{
                temperature: z.ZodNullable<z.ZodNumber>;
                humidity: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            night: z.ZodObject<{
                temperature: z.ZodNullable<z.ZodNumber>;
                humidity: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            co2: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        setBy: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    placement: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        spaceId: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * `PATCH /grows/{id}`. What a person edits about the grow itself: plants,
 * phases and placements each have their own routes, `slug` is fixed at creation
 * so that making a grow public never changes its address, and the rendered film
 * and `isDemo` are the server's.
 */
export declare const growUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<{
        photoperiod: "photoperiod";
        autoflower: "autoflower";
    }>>;
    visibility: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
    }>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    endedAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
    scheme: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"asset">;
            assetId: z.ZodString;
            version: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"own">;
            schemeId: z.ZodString;
        }, z.core.$strip>], "type">;
        strength: z.ZodNumber;
        waterEc: z.ZodNullable<z.ZodNumber>;
        plantType: z.ZodString;
        flipWeek: z.ZodNullable<z.ZodNumber>;
        edited: z.ZodBoolean;
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
            amounts: z.ZodArray<z.ZodObject<{
                productKey: z.ZodString;
                name: z.ZodString;
                value: z.ZodNullable<z.ZodNumber>;
                unit: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    measurements: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        name: z.ZodString;
        unit: z.ZodString;
        perPlant: z.ZodBoolean;
        target: z.ZodNullable<z.ZodNumber>;
        chart: z.ZodBoolean;
    }, z.core.$strip>>>;
    coverMediaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * `POST /grows/{id}/plants`. One plant: a whole row of the new-grow sheet is a
 * `PlantBatch` and is created with the grow, while what is added later is the
 * single plant that replaced a dead one. An absent `label` is made from the
 * strain and the next free number, as the sheet's rows are.
 */
export declare const plantCreate: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    strain: z.ZodString;
}, z.core.$strip>;
/**
 * `PATCH /plants/{id}`. `harvest` is editable here as well as writable through
 * `POST /grows/{id}/harvests`, because a dry weight is typed in days after the
 * harvest and corrected more than once.
 */
export declare const plantUpdate: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        ended: "ended";
        harvested: "harvested";
    }>>;
    harvest: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        harvestedAt: z.ZodISODateTime;
        wetWeightG: z.ZodNullable<z.ZodNumber>;
        dryWeightG: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>>;
    strain: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * `PATCH /grows/{id}/phases/{phaseId}`: a phase that was entered with the wrong
 * stage or on the wrong day. `source` and `setBy` are not corrected with it -
 * who put the grow into this phase did not change because the date was typed
 * wrongly.
 */
export declare const phaseUpdate: z.ZodObject<{
    stage: z.ZodOptional<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    preset: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    startedAt: z.ZodOptional<z.ZodOptional<z.ZodISODateTime>>;
    plantIds: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>>;
}, z.core.$strip>;
/**
 * `PATCH /grows/{id}/placements/{placementId}`. Moving the plants is what
 * `POST /grows/{id}/placements` does; this repairs a placement recorded wrongly, `endedAt` included, which is also how a
 * placement left open is closed on the day the plants really left.
 */
export declare const placementUpdate: z.ZodObject<{
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    endedAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
}, z.core.$strip>;
/**
 * `POST /reminders`. Exactly one of `everyDays` and `onceAt` is set, which the
 * route enforces: a rhythm and a date would each derive tasks of their own and
 * the same reminder would come due twice.
 */
export declare const reminderCreate: z.ZodObject<{
    label: z.ZodString;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    kind: z.ZodEnum<{
        custom: "custom";
        water: "water";
        feed: "feed";
        chore: "chore";
    }>;
    everyDays: z.ZodNullable<z.ZodNumber>;
    onceAt: z.ZodNullable<z.ZodISODateTime>;
    assigneeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    defaults: z.ZodOptional<z.ZodAny>;
}, z.core.$strip>;
/** `PATCH /reminders/{id}`: the same fields, each only if it changes. */
export declare const reminderUpdate: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    subject: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            grow: "grow";
            space: "space";
        }>;
        id: z.ZodString;
    }, z.core.$strip>>;
    kind: z.ZodOptional<z.ZodEnum<{
        custom: "custom";
        water: "water";
        feed: "feed";
        chore: "chore";
    }>>;
    everyDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    onceAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
    assigneeId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    defaults: z.ZodOptional<z.ZodOptional<z.ZodAny>>;
}, z.core.$strip>;
/**
 * `POST /tasks/{id}/completions`. "Done" is an entry carrying the task's id, so
 * this is what that entry is written with, and the answer is the entry itself: a
 * task is derived and has nothing of its own to store or to answer.
 *
 * `values` is the entry's own shape for the kind being logged, which the diary
 * half types per kind; left out, the task's `defaults` are used.
 */
export declare const taskCompletionCreate: z.ZodObject<{
    occurredAt: z.ZodOptional<z.ZodISODateTime>;
    text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    plantIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    values: z.ZodOptional<z.ZodAny>;
}, z.core.$strip>;
export declare const spacePage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        ownerId: z.ZodString;
        kind: z.ZodEnum<{
            other: "other";
            tent: "tent";
            fridge: "fridge";
            room: "room";
            balcony: "balcony";
        }>;
        name: z.ZodString;
        roomId: z.ZodNullable<z.ZodString>;
        presetPrompt: z.ZodEnum<{
            never: "never";
            ask: "ask";
        }>;
        retention: z.ZodObject<{
            climateDays: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        isDemo: z.ZodBoolean;
        archivedAt: z.ZodNullable<z.ZodISODateTime>;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const membershipPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        spaceId: z.ZodString;
        userId: z.ZodString;
        role: z.ZodEnum<{
            can_log: "can_log";
            can_manage: "can_manage";
        }>;
        invitedBy: z.ZodNullable<z.ZodString>;
        inviteId: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const invitePage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        code: z.ZodString;
        spaceId: z.ZodString;
        role: z.ZodEnum<{
            can_log: "can_log";
            can_manage: "can_manage";
        }>;
        createdBy: z.ZodString;
        expiresAt: z.ZodNullable<z.ZodISODateTime>;
        revokedAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodObject<{
            useCount: z.ZodNumber;
            lastUsedAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const growPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        ownerId: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        type: z.ZodEnum<{
            photoperiod: "photoperiod";
            autoflower: "autoflower";
        }>;
        phases: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
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
            source: z.ZodEnum<{
                plan: "plan";
                human: "human";
                preset: "preset";
            }>;
            plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
            deviceId: z.ZodNullable<z.ZodString>;
            targets: z.ZodNullable<z.ZodObject<{
                day: z.ZodObject<{
                    temperature: z.ZodNullable<z.ZodNumber>;
                    humidity: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                night: z.ZodObject<{
                    temperature: z.ZodNullable<z.ZodNumber>;
                    humidity: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                co2: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            setBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        placements: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            spaceId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodISODateTime;
            endedAt: z.ZodNullable<z.ZodISODateTime>;
            plantIds: z.ZodNullable<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        scheme: z.ZodNullable<z.ZodObject<{
            origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"asset">;
                assetId: z.ZodString;
                version: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"own">;
                schemeId: z.ZodString;
            }, z.core.$strip>], "type">;
            strength: z.ZodNumber;
            waterEc: z.ZodNullable<z.ZodNumber>;
            plantType: z.ZodString;
            flipWeek: z.ZodNullable<z.ZodNumber>;
            edited: z.ZodBoolean;
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
                amounts: z.ZodArray<z.ZodObject<{
                    productKey: z.ZodString;
                    name: z.ZodString;
                    value: z.ZodNullable<z.ZodNumber>;
                    unit: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        measurements: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            name: z.ZodString;
            unit: z.ZodString;
            perPlant: z.ZodBoolean;
            target: z.ZodNullable<z.ZodNumber>;
            chart: z.ZodBoolean;
        }, z.core.$strip>>;
        visibility: z.ZodEnum<{
            private: "private";
            public: "public";
        }>;
        slug: z.ZodString;
        coverMediaId: z.ZodNullable<z.ZodString>;
        filmMediaId: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodNullable<z.ZodISODateTime>;
        isDemo: z.ZodBoolean;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        summary: z.ZodObject<{
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
            phaseDay: z.ZodNullable<z.ZodNumber>;
            weekNumber: z.ZodNullable<z.ZodNumber>;
            isAuto: z.ZodBoolean;
            groups: z.ZodArray<z.ZodObject<{
                stage: z.ZodEnum<{
                    germination: "germination";
                    seedling: "seedling";
                    vegetative: "vegetative";
                    flowering: "flowering";
                    drying: "drying";
                    curing: "curing";
                }>;
                preset: z.ZodNullable<z.ZodString>;
                phaseDay: z.ZodNumber;
                plantIds: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            locations: z.ZodArray<z.ZodObject<{
                spaceId: z.ZodNullable<z.ZodString>;
                plantIds: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const plantPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        growId: z.ZodString;
        strain: z.ZodString;
        label: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            ended: "ended";
            harvested: "harvested";
        }>;
        harvest: z.ZodNullable<z.ZodObject<{
            harvestedAt: z.ZodISODateTime;
            wetWeightG: z.ZodNullable<z.ZodNumber>;
            dryWeightG: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const followPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        userId: z.ZodString;
        growId: z.ZodString;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const reminderPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        subject: z.ZodObject<{
            type: z.ZodEnum<{
                grow: "grow";
                space: "space";
            }>;
            id: z.ZodString;
        }, z.core.$strip>;
        kind: z.ZodEnum<{
            custom: "custom";
            water: "water";
            feed: "feed";
            chore: "chore";
        }>;
        label: z.ZodString;
        everyDays: z.ZodNullable<z.ZodNumber>;
        onceAt: z.ZodNullable<z.ZodISODateTime>;
        assigneeId: z.ZodNullable<z.ZodString>;
        defaults: z.ZodAny;
        createdBy: z.ZodString;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const taskPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        source: z.ZodEnum<{
            scheme: "scheme";
            reminder: "reminder";
            plan_step: "plan_step";
            plan_suggestion: "plan_suggestion";
        }>;
        sourceId: z.ZodNullable<z.ZodString>;
        subject: z.ZodObject<{
            type: z.ZodEnum<{
                grow: "grow";
                space: "space";
            }>;
            id: z.ZodString;
        }, z.core.$strip>;
        kind: z.ZodEnum<{
            custom: "custom";
            water: "water";
            feed: "feed";
            chore: "chore";
        }>;
        label: z.ZodString;
        dueAt: z.ZodISODateTime;
        assigneeId: z.ZodNullable<z.ZodString>;
        defaults: z.ZodAny;
        done: z.ZodBoolean;
        completion: z.ZodNullable<z.ZodObject<{
            entryId: z.ZodString;
            occurredAt: z.ZodISODateTime;
            authorId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
