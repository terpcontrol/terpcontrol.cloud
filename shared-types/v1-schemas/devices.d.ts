import { z } from 'zod';
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
export declare const firmwareChannel: z.ZodEnum<{
    alpha: "alpha";
    beta: "beta";
    manual: "manual";
    stable: "stable";
}>;
/**
 * The device's own configuration document, passed through untouched.
 *
 * Its schema belongs to the firmware of that device type, not to this package:
 * every type has its own keys, an older build has fewer of them, and the server
 * never interprets one. Typing it here would date the moment a firmware adds a
 * field.
 */
export declare const deviceConfiguration: z.ZodRecord<z.ZodString, z.ZodAny>;
export declare const deviceFirmwareTarget: z.ZodObject<{
    channel: z.ZodEnum<{
        alpha: "alpha";
        beta: "beta";
        manual: "manual";
        stable: "stable";
    }>;
    targetId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * The two derived measures the cloud computes rather than the device: leaf
 * temperature offsets give VPD, the lux factor gives PPFD. They sit on the device
 * because they describe its sensor's placement, not what is grown under it.
 */
export declare const deviceSettings: z.ZodObject<{
    vpdLeafOffsetDay: z.ZodNumber;
    vpdLeafOffsetNight: z.ZodNumber;
    ppfdLuxFactor: z.ZodNumber;
}, z.core.$strip>;
export declare const deviceState: z.ZodObject<{
    lastSeenAt: z.ZodNullable<z.ZodISODateTime>;
    claimedAt: z.ZodNullable<z.ZodISODateTime>;
    firmwareId: z.ZodNullable<z.ZodString>;
    updateStartedAt: z.ZodNullable<z.ZodISODateTime>;
    updateEndedAt: z.ZodNullable<z.ZodISODateTime>;
    updateFailedAt: z.ZodNullable<z.ZodISODateTime>;
    maintenanceUntil: z.ZodNullable<z.ZodISODateTime>;
    hardware: z.ZodRecord<z.ZodString, z.ZodString>;
    socketStateChangedAt: z.ZodRecord<z.ZodString, z.ZodISODateTime>;
    socketsReportedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * A device as the API serves it. The broker credentials the device signs in with
 * have no field here: they are a secret, this contract is what crosses the wire,
 * and where they are stored is the mongoose schema's business.
 */
export declare const device: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    type: z.ZodString;
    classId: z.ZodNullable<z.ZodString>;
    serialNumber: z.ZodNullable<z.ZodNumber>;
    ownerId: z.ZodNullable<z.ZodString>;
    spaceId: z.ZodNullable<z.ZodString>;
    name: z.ZodNullable<z.ZodString>;
    firmware: z.ZodObject<{
        channel: z.ZodEnum<{
            alpha: "alpha";
            beta: "beta";
            manual: "manual";
            stable: "stable";
        }>;
        targetId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    configuration: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodAny>>;
    settings: z.ZodObject<{
        vpdLeafOffsetDay: z.ZodNumber;
        vpdLeafOffsetNight: z.ZodNumber;
        ppfdLuxFactor: z.ZodNumber;
    }, z.core.$strip>;
    isDemo: z.ZodBoolean;
    state: z.ZodObject<{
        lastSeenAt: z.ZodNullable<z.ZodISODateTime>;
        claimedAt: z.ZodNullable<z.ZodISODateTime>;
        firmwareId: z.ZodNullable<z.ZodString>;
        updateStartedAt: z.ZodNullable<z.ZodISODateTime>;
        updateEndedAt: z.ZodNullable<z.ZodISODateTime>;
        updateFailedAt: z.ZodNullable<z.ZodISODateTime>;
        maintenanceUntil: z.ZodNullable<z.ZodISODateTime>;
        hardware: z.ZodRecord<z.ZodString, z.ZodString>;
        socketStateChangedAt: z.ZodRecord<z.ZodString, z.ZodISODateTime>;
        socketsReportedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const devicePage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        type: z.ZodString;
        classId: z.ZodNullable<z.ZodString>;
        serialNumber: z.ZodNullable<z.ZodNumber>;
        ownerId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        name: z.ZodNullable<z.ZodString>;
        firmware: z.ZodObject<{
            channel: z.ZodEnum<{
                alpha: "alpha";
                beta: "beta";
                manual: "manual";
                stable: "stable";
            }>;
            targetId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        configuration: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodAny>>;
        settings: z.ZodObject<{
            vpdLeafOffsetDay: z.ZodNumber;
            vpdLeafOffsetNight: z.ZodNumber;
            ppfdLuxFactor: z.ZodNumber;
        }, z.core.$strip>;
        isDemo: z.ZodBoolean;
        state: z.ZodObject<{
            lastSeenAt: z.ZodNullable<z.ZodISODateTime>;
            claimedAt: z.ZodNullable<z.ZodISODateTime>;
            firmwareId: z.ZodNullable<z.ZodString>;
            updateStartedAt: z.ZodNullable<z.ZodISODateTime>;
            updateEndedAt: z.ZodNullable<z.ZodISODateTime>;
            updateFailedAt: z.ZodNullable<z.ZodISODateTime>;
            maintenanceUntil: z.ZodNullable<z.ZodISODateTime>;
            hardware: z.ZodRecord<z.ZodString, z.ZodString>;
            socketStateChangedAt: z.ZodRecord<z.ZodString, z.ZodISODateTime>;
            socketsReportedAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `PATCH /devices/{id}`: what a person decides about a device. What it is, who
 * owns it and everything under `state` are not a client's to write, and the
 * configuration document is replaced whole by its own route rather than patched
 * here, because the server does not read enough of it to merge one.
 */
export declare const deviceUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    firmware: z.ZodOptional<z.ZodObject<{
        channel: z.ZodEnum<{
            alpha: "alpha";
            beta: "beta";
            manual: "manual";
            stable: "stable";
        }>;
        targetId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    settings: z.ZodOptional<z.ZodObject<{
        vpdLeafOffsetDay: z.ZodNumber;
        vpdLeafOffsetNight: z.ZodNumber;
        ppfdLuxFactor: z.ZodNumber;
    }, z.core.$strip>>;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * `PUT /devices/{id}/configuration`, and what it answers: a `PUT` replaces the
 * document whole because the server does not read enough of it to merge one.
 *
 * The document travels in a field of its own rather than as the bare body: its
 * keys belong to the firmware and this contract does not know them, so one of
 * them could otherwise collide with a key of the envelope the day the envelope
 * gains one.
 */
export declare const deviceConfigurationEnvelope: z.ZodObject<{
    configuration: z.ZodRecord<z.ZodString, z.ZodAny>;
}, z.core.$strip>;
/**
 * `GET /devices/{id}/configuration`: the same envelope, with the document null
 * where the device has never reported one - exactly as `Device.configuration`
 * says it. Answered as an empty document, a device that never sent its
 * settings read like one whose settings are empty, and only a refused write
 * told the two apart.
 */
export declare const deviceConfigurationReading: z.ZodObject<{
    configuration: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, z.core.$strip>;
/**
 * `POST /admin/devices`. A device normally creates itself by registering with
 * its own firmware; this is the row made by hand, for hardware that has not been
 * flashed yet or that has to be put back after it was removed. It is unclaimed
 * until somebody claims it, like every other device.
 */
export declare const adminDeviceCreate: z.ZodObject<{
    type: z.ZodString;
    id: z.ZodString;
    classId: z.ZodNullable<z.ZodString>;
    serialNumber: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/** Which build each channel points at; null where a class has nothing on that channel yet. */
export declare const deviceClassFirmwareIds: z.ZodObject<{
    stable: z.ZodNullable<z.ZodString>;
    beta: z.ZodNullable<z.ZodString>;
    alpha: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** A staged rollout: `percent` of the class takes the build, and `paused` stops it where it is. */
export declare const deviceClassRollout: z.ZodObject<{
    paused: z.ZodBoolean;
    percent: z.ZodNumber;
}, z.core.$strip>;
export declare const deviceClass: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    concurrentUpdates: z.ZodNumber;
    maxFailures: z.ZodNumber;
    firmwareIds: z.ZodObject<{
        stable: z.ZodNullable<z.ZodString>;
        beta: z.ZodNullable<z.ZodString>;
        alpha: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    rollout: z.ZodObject<{
        paused: z.ZodBoolean;
        percent: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const deviceClassPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        concurrentUpdates: z.ZodNumber;
        maxFailures: z.ZodNumber;
        firmwareIds: z.ZodObject<{
            stable: z.ZodNullable<z.ZodString>;
            beta: z.ZodNullable<z.ZodString>;
            alpha: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        rollout: z.ZodObject<{
            paused: z.ZodBoolean;
            percent: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /admin/device-classes`. Pausing a rollout and staging it at a percentage
 * are changes to the class, which is why `rollout` is written here and has no
 * route of its own: there is one rollout per class and it is never anything but
 * the state this object describes.
 */
export declare const deviceClassCreate: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    firmwareIds: z.ZodObject<{
        stable: z.ZodNullable<z.ZodString>;
        beta: z.ZodNullable<z.ZodString>;
        alpha: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    rollout: z.ZodObject<{
        paused: z.ZodBoolean;
        percent: z.ZodNumber;
    }, z.core.$strip>;
    concurrentUpdates: z.ZodNumber;
    maxFailures: z.ZodNumber;
}, z.core.$strip>;
/** `PATCH /admin/device-classes/{id}`: the same fields, each only if it changes. */
export declare const deviceClassUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    firmwareIds: z.ZodOptional<z.ZodObject<{
        stable: z.ZodNullable<z.ZodString>;
        beta: z.ZodNullable<z.ZodString>;
        alpha: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    rollout: z.ZodOptional<z.ZodObject<{
        paused: z.ZodBoolean;
        percent: z.ZodNumber;
    }, z.core.$strip>>;
    concurrentUpdates: z.ZodOptional<z.ZodNumber>;
    maxFailures: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const firmware: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    classId: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    version: z.ZodString;
    wasStable: z.ZodBoolean;
}, z.core.$strip>;
export declare const firmwarePage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        classId: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        version: z.ZodString;
        wasStable: z.ZodBoolean;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /admin/firmwares`: the build itself, without its files - a build is
 * several of them and each is uploaded on its own. `wasStable` is the rollout's
 * record of where the build has been and is never set by hand.
 */
export declare const firmwareCreate: z.ZodObject<{
    name: z.ZodNullable<z.ZodString>;
    version: z.ZodString;
    classId: z.ZodString;
}, z.core.$strip>;
/**
 * `PATCH /admin/firmwares/{id}`. Relabelling is what this is for: a build's
 * version is the uuid its build container stamped it with, and a human name is
 * how it is told apart in a list.
 */
export declare const firmwareUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    version: z.ZodOptional<z.ZodString>;
    classId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** One file of a build. The bytes are what OTA streams; no listing carries them. */
export declare const firmwareBinary: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    firmwareId: z.ZodString;
    name: z.ZodString;
    data: z.ZodCustom<Buffer<ArrayBufferLike>, Buffer<ArrayBufferLike>>;
}, z.core.$strip>;
/**
 * `PUT /admin/firmwares/{id}/binaries/{name}`. The build and the file name are
 * the path, so the body is the bytes and nothing else.
 */
export declare const firmwareBinaryUpload: z.ZodObject<{
    data: z.ZodCustom<Buffer<ArrayBufferLike>, Buffer<ArrayBufferLike>>;
}, z.core.$strip>;
/** What the display shows and a claim is made with. One code per device. */
export declare const claimCode: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    code: z.ZodString;
    deviceId: z.ZodString;
}, z.core.$strip>;
/**
 * `POST /devices/claims`. The code the device shows is the whole proof and it
 * names the device, so nothing else identifies one. A device that belongs to no
 * space has no card to appear on, so a claim always ends in one: `spaceId` puts
 * it into a space that exists, and its absence makes one.
 */
export declare const deviceClaimCreate: z.ZodObject<{
    code: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    spaceId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * What a claim answers. The device carries the space it now sits in, so the one
 * thing left to say is whether that space was made by this claim: a new space is
 * offered for naming, an existing one is left alone.
 */
export declare const deviceClaimResult: z.ZodObject<{
    device: z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        type: z.ZodString;
        classId: z.ZodNullable<z.ZodString>;
        serialNumber: z.ZodNullable<z.ZodNumber>;
        ownerId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
        name: z.ZodNullable<z.ZodString>;
        firmware: z.ZodObject<{
            channel: z.ZodEnum<{
                alpha: "alpha";
                beta: "beta";
                manual: "manual";
                stable: "stable";
            }>;
            targetId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        configuration: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodAny>>;
        settings: z.ZodObject<{
            vpdLeafOffsetDay: z.ZodNumber;
            vpdLeafOffsetNight: z.ZodNumber;
            ppfdLuxFactor: z.ZodNumber;
        }, z.core.$strip>;
        isDemo: z.ZodBoolean;
        state: z.ZodObject<{
            lastSeenAt: z.ZodNullable<z.ZodISODateTime>;
            claimedAt: z.ZodNullable<z.ZodISODateTime>;
            firmwareId: z.ZodNullable<z.ZodString>;
            updateStartedAt: z.ZodNullable<z.ZodISODateTime>;
            updateEndedAt: z.ZodNullable<z.ZodISODateTime>;
            updateFailedAt: z.ZodNullable<z.ZodISODateTime>;
            maintenanceUntil: z.ZodNullable<z.ZodISODateTime>;
            hardware: z.ZodRecord<z.ZodString, z.ZodString>;
            socketStateChangedAt: z.ZodRecord<z.ZodString, z.ZodISODateTime>;
            socketsReportedAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    spaceCreated: z.ZodBoolean;
}, z.core.$strip>;
/**
 * The state a smart socket's row reports. `unknown` is what a device that
 * reports the older three-column row gives: it names the socket but not whether
 * it is on.
 */
export declare const socketState: z.ZodEnum<{
    off: "off";
    unknown: "unknown";
    on: "on";
}>;
/** An override forces a socket; `auto` hands it back to its role's control law. */
export declare const socketOverrideState: z.ZodEnum<{
    auto: "auto";
    off: "off";
    on: "on";
}>;
/**
 * An override lives in the device's RAM with an expiry and dies with a reboot,
 * which is the failsafe: nothing outside the firmware can hold a socket on.
 */
export declare const socketOverride: z.ZodObject<{
    state: z.ZodEnum<{
        auto: "auto";
        off: "off";
        on: "on";
    }>;
    validUntil: z.ZodISODateTime;
}, z.core.$strip>;
/**
 * What a `pump` or a `custom_timer` socket repeats: on for so long, that often.
 * The bounds are the firmware's, which refuses a cycle that is on for at least
 * as long as its period and one longer than an override may hold.
 */
export declare const socketTimer: z.ZodObject<{
    onSeconds: z.ZodNumber;
    everySeconds: z.ZodNumber;
}, z.core.$strip>;
/**
 * One socket, as the API serves it: a typed view of `devices.state.hardware`,
 * never stored twice. The decoder's vocabulary is kept - `slot` is the position
 * in the device's table and how a command addresses it, `hardwareId` the MAC the
 * device finds the socket by, `address` its host or IP.
 */
export declare const socket: z.ZodObject<{
    slot: z.ZodNumber;
    role: z.ZodEnum<{
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
    hardwareId: z.ZodString;
    address: z.ZodString;
    state: z.ZodEnum<{
        off: "off";
        unknown: "unknown";
        on: "on";
    }>;
    override: z.ZodNullable<z.ZodObject<{
        state: z.ZodEnum<{
            auto: "auto";
            off: "off";
            on: "on";
        }>;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>>;
    timer: z.ZodNullable<z.ZodObject<{
        onSeconds: z.ZodNumber;
        everySeconds: z.ZodNumber;
    }, z.core.$strip>>;
    stateChangedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * What the device announced it understands. The server sends a command or a role
 * only to a device that named it, because a firmware version cannot be compared
 * (it is the build's uuid) and an old build drops an unknown command silently.
 * A device that announces nothing gets nothing new and its switches are drawn
 * disabled.
 */
export declare const deviceCapabilities: z.ZodObject<{
    socketOverride: z.ZodBoolean;
    socketTimer: z.ZodBoolean;
    lightOverride: z.ZodBoolean;
    roles: z.ZodArray<z.ZodEnum<{
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
    }>>;
    pulseSeconds: z.ZodRecord<z.ZodEnum<{
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
    }> & z.core.$partial, z.ZodNumber>;
}, z.core.$strip>;
/** The list carries the capabilities, because a socket row is drawn from both. */
export declare const socketPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        slot: z.ZodNumber;
        role: z.ZodEnum<{
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
        hardwareId: z.ZodString;
        address: z.ZodString;
        state: z.ZodEnum<{
            off: "off";
            unknown: "unknown";
            on: "on";
        }>;
        override: z.ZodNullable<z.ZodObject<{
            state: z.ZodEnum<{
                auto: "auto";
                off: "off";
                on: "on";
            }>;
            validUntil: z.ZodISODateTime;
        }, z.core.$strip>>;
        timer: z.ZodNullable<z.ZodObject<{
            onSeconds: z.ZodNumber;
            everySeconds: z.ZodNumber;
        }, z.core.$strip>>;
        stateChangedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
    capabilities: z.ZodObject<{
        socketOverride: z.ZodBoolean;
        socketTimer: z.ZodBoolean;
        lightOverride: z.ZodBoolean;
        roles: z.ZodArray<z.ZodEnum<{
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
        }>>;
        pulseSeconds: z.ZodRecord<z.ZodEnum<{
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
        }> & z.core.$partial, z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * What a client asks a device to do right now. A discriminated union rather than
 * a free action string, so the route can never publish something the firmware
 * does not know; `kind` is `snake_case` like every other enum value here.
 *
 * None of these is stored or retried: the caller is waiting for the answer.
 *
 * The firmware's `test`/`stoptest` bench mode is deliberately not among them.
 * Only the fridge acts on it - the fan hears it and reads nothing, the
 * controller, plug and light drop it - and there it holds for about ten seconds
 * per command, switches off every output it is not given and bypasses every
 * safeguard the control loop keeps, the compressor's included. That is an
 * assembly check, not something to offer beside a grower's climate.
 */
export declare const rebootCommand: z.ZodObject<{
    kind: z.ZodLiteral<"reboot">;
}, z.core.$strip>;
export declare const maintenanceCommand: z.ZodObject<{
    kind: z.ZodLiteral<"maintenance">;
    forSeconds: z.ZodNumber;
}, z.core.$strip>;
/** Asks for a still now. A controller answers for the one Terp Cam it pairs, so it names no camera. */
export declare const captureStillCommand: z.ZodObject<{
    kind: z.ZodLiteral<"capture_still">;
}, z.core.$strip>;
/**
 * Forces one socket, or the controller's own light output, for a while. The
 * subject is `{ type, id }` because the two are addressed differently: a socket
 * by its slot, an output by its name.
 */
export declare const socketOverrideCommand: z.ZodObject<{
    kind: z.ZodLiteral<"socket_override">;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            output: "output";
            socket: "socket";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    state: z.ZodEnum<{
        auto: "auto";
        off: "off";
        on: "on";
    }>;
    forSeconds: z.ZodNumber;
}, z.core.$strip>;
/**
 * The socket's own web credentials, on their way to the device. They travel in
 * this direction only: a command carries them, and `Socket` answers none back.
 * Left out, the device keeps the pair it has.
 */
export declare const socketCredentials: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
/** Pairs a socket, re-addresses one, or gives it a role and a timer. */
export declare const socketSetCommand: z.ZodObject<{
    kind: z.ZodLiteral<"socket_set">;
    slot: z.ZodNullable<z.ZodNumber>;
    role: z.ZodEnum<{
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
    address: z.ZodString;
    credentials: z.ZodNullable<z.ZodObject<{
        username: z.ZodString;
        password: z.ZodString;
    }, z.core.$strip>>;
    timer: z.ZodNullable<z.ZodObject<{
        onSeconds: z.ZodNumber;
        everySeconds: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const deviceCommand: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"reboot">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"maintenance">;
    forSeconds: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"capture_still">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"socket_override">;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            output: "output";
            socket: "socket";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    state: z.ZodEnum<{
        auto: "auto";
        off: "off";
        on: "on";
    }>;
    forSeconds: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"socket_set">;
    slot: z.ZodNullable<z.ZodNumber>;
    role: z.ZodEnum<{
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
    address: z.ZodString;
    credentials: z.ZodNullable<z.ZodObject<{
        username: z.ZodString;
        password: z.ZodString;
    }, z.core.$strip>>;
    timer: z.ZodNullable<z.ZodObject<{
        onSeconds: z.ZodNumber;
        everySeconds: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>], "kind">;
/**
 * What `POST /devices/{id}/commands` answers. MQTT hands back no receipt and a
 * device that is offline is simply not there to hear the command, so the answer
 * says when it went out and whether anyone was listening, and never claims the
 * device did what it was told.
 */
export declare const deviceCommandResult: z.ZodObject<{
    publishedAt: z.ZodISODateTime;
    deviceOnline: z.ZodBoolean;
}, z.core.$strip>;
/** `PUT /devices/{id}/sockets/{slot}`: pair a socket, re-address one, or give it a role and a timer. */
export declare const socketUpdate: z.ZodObject<{
    address: z.ZodString;
    role: z.ZodEnum<{
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
    timer: z.ZodNullable<z.ZodObject<{
        onSeconds: z.ZodNumber;
        everySeconds: z.ZodNumber;
    }, z.core.$strip>>;
    credentials: z.ZodNullable<z.ZodObject<{
        username: z.ZodString;
        password: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** `PUT /devices/{id}/sockets/{slot}/override`. `DELETE` on the same path hands the socket back to its role. */
export declare const socketOverrideUpdate: z.ZodObject<{
    state: z.ZodEnum<{
        auto: "auto";
        off: "off";
        on: "on";
    }>;
    forSeconds: z.ZodNumber;
}, z.core.$strip>;
/**
 * `POST /devices/{id}/sockets/{slot}/tests`. Switching a socket on for a moment
 * is how a person finds out which plug in the tent it is. The firmware puts it
 * back when the time is up, so a test that is never answered still ends.
 */
export declare const socketTestCreate: z.ZodObject<{
    forSeconds: z.ZodNumber;
}, z.core.$strip>;
/** The user's own unit is the fact here, so a step's duration keeps it rather than being seconds. */
export declare const durationUnit: z.ZodEnum<{
    weeks: "weeks";
    days: "days";
    hours: "hours";
    minutes: "minutes";
}>;
/**
 * `value` is not required to be whole. The old recipe screen took whatever
 * somebody typed, and a plan in the field holds a step of half a day - a tent is
 * running on it right now. The engine multiplies the value by its unit and never
 * cared, so the only thing a whole number would buy is that such a plan could be
 * read and not written back, and the step's length would have to be rounded
 * under a running tent to save the recipe it belongs to. Zero is the step with no
 * length, which runs until somebody moves it on.
 */
export declare const stepDuration: z.ZodObject<{
    value: z.ZodNumber;
    unit: z.ZodEnum<{
        weeks: "weeks";
        days: "days";
        hours: "hours";
        minutes: "minutes";
    }>;
}, z.core.$strip>;
export declare const planStep: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    stage: z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>;
    preset: z.ZodNullable<z.ZodString>;
    duration: z.ZodObject<{
        value: z.ZodNumber;
        unit: z.ZodEnum<{
            weeks: "weeks";
            days: "days";
            hours: "hours";
            minutes: "minutes";
        }>;
    }, z.core.$strip>;
    settings: z.ZodRecord<z.ZodString, z.ZodAny>;
    waitForConfirmation: z.ZodBoolean;
    confirmationMessage: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** `on_step` mails at every step change, `on_confirmation` only when the plan waits for a person. */
export declare const planNotifyMode: z.ZodEnum<{
    off: "off";
    on_step: "on_step";
    on_confirmation: "on_confirmation";
}>;
export declare const planNotify: z.ZodObject<{
    mode: z.ZodEnum<{
        off: "off";
        on_step: "on_step";
        on_confirmation: "on_confirmation";
    }>;
    email: z.ZodNullable<z.ZodString>;
    writeEntries: z.ZodBoolean;
}, z.core.$strip>;
export declare const planState: z.ZodObject<{
    status: z.ZodEnum<{
        stopped: "stopped";
        completed: "completed";
        paused: "paused";
        running: "running";
    }>;
    activeStepIndex: z.ZodNumber;
    stepStartedAt: z.ZodNullable<z.ZodISODateTime>;
    pausedElapsedMs: z.ZodNumber;
    pauseReason: z.ZodNullable<z.ZodString>;
    lastAppliedAt: z.ZodNullable<z.ZodISODateTime>;
    confirmationNotifiedAt: z.ZodNullable<z.ZodISODateTime>;
    confirmationAskedAt: z.ZodNullable<z.ZodISODateTime>;
    confirmationAskTriedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/** One plan per device: it is what the device is currently being run by. */
export declare const plan: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    deviceId: z.ZodString;
    templateId: z.ZodNullable<z.ZodString>;
    name: z.ZodString;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        duration: z.ZodObject<{
            value: z.ZodNumber;
            unit: z.ZodEnum<{
                weeks: "weeks";
                days: "days";
                hours: "hours";
                minutes: "minutes";
            }>;
        }, z.core.$strip>;
        settings: z.ZodRecord<z.ZodString, z.ZodAny>;
        waitForConfirmation: z.ZodBoolean;
        confirmationMessage: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    loop: z.ZodBoolean;
    notify: z.ZodObject<{
        mode: z.ZodEnum<{
            off: "off";
            on_step: "on_step";
            on_confirmation: "on_confirmation";
        }>;
        email: z.ZodNullable<z.ZodString>;
        writeEntries: z.ZodBoolean;
    }, z.core.$strip>;
    state: z.ZodObject<{
        status: z.ZodEnum<{
            stopped: "stopped";
            completed: "completed";
            paused: "paused";
            running: "running";
        }>;
        activeStepIndex: z.ZodNumber;
        stepStartedAt: z.ZodNullable<z.ZodISODateTime>;
        pausedElapsedMs: z.ZodNumber;
        pauseReason: z.ZodNullable<z.ZodString>;
        lastAppliedAt: z.ZodNullable<z.ZodISODateTime>;
        confirmationNotifiedAt: z.ZodNullable<z.ZodISODateTime>;
        confirmationAskedAt: z.ZodNullable<z.ZodISODateTime>;
        confirmationAskTriedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
}, z.core.$strip>;
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
export declare const planStepInput: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    stage: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        germination: "germination";
        seedling: "seedling";
        vegetative: "vegetative";
        flowering: "flowering";
        drying: "drying";
        curing: "curing";
    }>>>;
    preset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    duration: z.ZodObject<{
        value: z.ZodNumber;
        unit: z.ZodEnum<{
            weeks: "weeks";
            days: "days";
            hours: "hours";
            minutes: "minutes";
        }>;
    }, z.core.$strip>;
    settings: z.ZodRecord<z.ZodString, z.ZodAny>;
    waitForConfirmation: z.ZodBoolean;
    confirmationMessage: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `PUT /devices/{id}/plan`. A device runs one plan, so the route both writes the
 * first one and replaces the one that is there; where the plan stands is `state`
 * and moves only through a transition.
 */
export declare const planReplace: z.ZodObject<{
    name: z.ZodString;
    notify: z.ZodObject<{
        mode: z.ZodEnum<{
            off: "off";
            on_step: "on_step";
            on_confirmation: "on_confirmation";
        }>;
        email: z.ZodNullable<z.ZodString>;
        writeEntries: z.ZodBoolean;
    }, z.core.$strip>;
    templateId: z.ZodNullable<z.ZodString>;
    loop: z.ZodBoolean;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        stage: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>>;
        preset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodObject<{
            value: z.ZodNumber;
            unit: z.ZodEnum<{
                weeks: "weeks";
                days: "days";
                hours: "hours";
                minutes: "minutes";
            }>;
        }, z.core.$strip>;
        settings: z.ZodRecord<z.ZodString, z.ZodAny>;
        waitForConfirmation: z.ZodBoolean;
        confirmationMessage: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** A plan kept to start others from. It runs nothing, so it has no state. */
export declare const planTemplate: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    ownerId: z.ZodString;
    name: z.ZodString;
    isPublic: z.ZodBoolean;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        stage: z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>;
        preset: z.ZodNullable<z.ZodString>;
        duration: z.ZodObject<{
            value: z.ZodNumber;
            unit: z.ZodEnum<{
                weeks: "weeks";
                days: "days";
                hours: "hours";
                minutes: "minutes";
            }>;
        }, z.core.$strip>;
        settings: z.ZodRecord<z.ZodString, z.ZodAny>;
        waitForConfirmation: z.ZodBoolean;
        confirmationMessage: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const planTemplatePage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        ownerId: z.ZodString;
        name: z.ZodString;
        isPublic: z.ZodBoolean;
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            stage: z.ZodNullable<z.ZodEnum<{
                germination: "germination";
                seedling: "seedling";
                vegetative: "vegetative";
                flowering: "flowering";
                drying: "drying";
                curing: "curing";
            }>>;
            preset: z.ZodNullable<z.ZodString>;
            duration: z.ZodObject<{
                value: z.ZodNumber;
                unit: z.ZodEnum<{
                    weeks: "weeks";
                    days: "days";
                    hours: "hours";
                    minutes: "minutes";
                }>;
            }, z.core.$strip>;
            settings: z.ZodRecord<z.ZodString, z.ZodAny>;
            waitForConfirmation: z.ZodBoolean;
            confirmationMessage: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** `POST /plan-templates`. The owner is whoever is asking, so a template names no one. */
export declare const planTemplateCreate: z.ZodObject<{
    name: z.ZodString;
    isPublic: z.ZodBoolean;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        stage: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>>;
        preset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodObject<{
            value: z.ZodNumber;
            unit: z.ZodEnum<{
                weeks: "weeks";
                days: "days";
                hours: "hours";
                minutes: "minutes";
            }>;
        }, z.core.$strip>;
        settings: z.ZodRecord<z.ZodString, z.ZodAny>;
        waitForConfirmation: z.ZodBoolean;
        confirmationMessage: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** `PATCH /plan-templates/{id}`: the same fields, each only if it changes. */
export declare const planTemplateUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    isPublic: z.ZodOptional<z.ZodBoolean>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        stage: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            germination: "germination";
            seedling: "seedling";
            vegetative: "vegetative";
            flowering: "flowering";
            drying: "drying";
            curing: "curing";
        }>>>;
        preset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodObject<{
            value: z.ZodNumber;
            unit: z.ZodEnum<{
                weeks: "weeks";
                days: "days";
                hours: "hours";
                minutes: "minutes";
            }>;
        }, z.core.$strip>;
        settings: z.ZodRecord<z.ZodString, z.ZodAny>;
        waitForConfirmation: z.ZodBoolean;
        confirmationMessage: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/** What `POST /devices/{id}/plan/transitions` asks of a running plan. */
export declare const planTransition: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodEnum<{
        confirm: "confirm";
    }>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodEnum<{
        skip: "skip";
    }>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodEnum<{
        extend: "extend";
    }>;
    by: z.ZodObject<{
        value: z.ZodNumber;
        unit: z.ZodEnum<{
            weeks: "weeks";
            days: "days";
            hours: "hours";
            minutes: "minutes";
        }>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodEnum<{
        pause: "pause";
    }>;
    reason: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodEnum<{
        resume: "resume";
    }>;
}, z.core.$strip>], "kind">;
/**
 * Where a rule came from. `always` is a rule the cloud keeps for every device
 * (offline), `preset` one a stage applied, `device` one the firmware asked for
 * and `human` one somebody wrote.
 */
export declare const alarmOrigin: z.ZodEnum<{
    always: "always";
    human: "human";
    device: "device";
    preset: "preset";
}>;
/** `routing` sends by the person's notification settings; `custom` is this rule's own target. */
export declare const alarmDeliveryMode: z.ZodEnum<{
    custom: "custom";
    routing: "routing";
}>;
export declare const alarmWebhook: z.ZodObject<{
    method: z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
    }>;
    headers: z.ZodRecord<z.ZodString, z.ZodString>;
    triggeredPayload: z.ZodString;
    resolvedPayload: z.ZodString;
    reportErrors: z.ZodBoolean;
    tunnel: z.ZodBoolean;
}, z.core.$strip>;
/**
 * The two channels a rule may address itself, out of the four a person can be
 * reached on: a rule's own delivery predates routing and was only ever a mail
 * address or a URL.
 */
export declare const alarmDeliveryChannel: z.ZodEnum<{
    email: "email";
    webhook: "webhook";
}>;
/**
 * One rule's own delivery, kept from the per-alarm e-mail and webhook that
 * predate routing. Like the account's own webhook channel, `target` and the
 * headers can name an internal host and carry an authorisation header, so an
 * alarm rule is answered to whoever may manage the device and to nobody else.
 */
export declare const alarmDeliveryCustom: z.ZodObject<{
    channel: z.ZodEnum<{
        email: "email";
        webhook: "webhook";
    }>;
    target: z.ZodString;
    includeDetails: z.ZodBoolean;
    webhook: z.ZodNullable<z.ZodObject<{
        method: z.ZodEnum<{
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
        }>;
        headers: z.ZodRecord<z.ZodString, z.ZodString>;
        triggeredPayload: z.ZodString;
        resolvedPayload: z.ZodString;
        reportErrors: z.ZodBoolean;
        tunnel: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const alarmDelivery: z.ZodObject<{
    mode: z.ZodEnum<{
        custom: "custom";
        routing: "routing";
    }>;
    custom: z.ZodNullable<z.ZodObject<{
        channel: z.ZodEnum<{
            email: "email";
            webhook: "webhook";
        }>;
        target: z.ZodString;
        includeDetails: z.ZodBoolean;
        webhook: z.ZodNullable<z.ZodObject<{
            method: z.ZodEnum<{
                GET: "GET";
                POST: "POST";
                PUT: "PUT";
            }>;
            headers: z.ZodRecord<z.ZodString, z.ZodString>;
            triggeredPayload: z.ZodString;
            resolvedPayload: z.ZodString;
            reportErrors: z.ZodBoolean;
            tunnel: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * A band around a reading: the rule most alarms are. `upper` and `lower` may
 * both be null, which is a rule that watches without a bound - what `offline`
 * is, where the health loop rather than a threshold decides.
 */
export declare const readingWatch: z.ZodObject<{
    kind: z.ZodLiteral<"reading">;
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
    upper: z.ZodNullable<z.ZodNumber>;
    lower: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * A band around an output's level. `heater` and `fan` run at a rate and `light`
 * dims, so "the heater is working harder than half the time" is a rule about a
 * number like any other. The numbers are the ones the series carries: a
 * fraction where the device reports a fraction, never a percentage of its own.
 */
export declare const outputLevelWatch: z.ZodObject<{
    kind: z.ZodLiteral<"output_level">;
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
    upper: z.ZodNullable<z.ZodNumber>;
    lower: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * An output running at all: the fridge that has not stopped in an hour, the CO2
 * valve that is still open. Anything above zero is the output doing something,
 * so there is no band to give - and `forSeconds` is what makes it an alarm
 * rather than a fact of every cycle.
 */
export declare const outputRunningWatch: z.ZodObject<{
    kind: z.ZodLiteral<"output_running">;
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
}, z.core.$strip>;
/**
 * What a rule watches: a reading the device measures, or an output it drives.
 *
 * One union rather than a metric enum widened to hold both, because what trips
 * each of them differs - a band is meaningless on an output that is only ever on
 * or off, and an output name is not something a reading can carry. So a rule
 * that names an output and a threshold it ignores, or a reading with no metric,
 * cannot be written down at all.
 */
export declare const alarmWatch: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"reading">;
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
    upper: z.ZodNullable<z.ZodNumber>;
    lower: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"output_level">;
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
    upper: z.ZodNullable<z.ZodNumber>;
    lower: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"output_running">;
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
}, z.core.$strip>], "kind">;
export declare const alarmRuleState: z.ZodObject<{
    triggered: z.ZodBoolean;
    lastTriggeredAt: z.ZodNullable<z.ZodISODateTime>;
    lastResolvedAt: z.ZodNullable<z.ZodISODateTime>;
    extremeValue: z.ZodNullable<z.ZodNumber>;
    lastSampleAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
export declare const alarmRule: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    deviceId: z.ZodString;
    name: z.ZodString;
    watch: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"reading">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_level">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_running">;
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
    }, z.core.$strip>], "kind">;
    forSeconds: z.ZodNumber;
    severity: z.ZodEnum<{
        critical: "critical";
        warning: "warning";
        info: "info";
    }>;
    origin: z.ZodEnum<{
        always: "always";
        human: "human";
        device: "device";
        preset: "preset";
    }>;
    presetId: z.ZodNullable<z.ZodString>;
    enabled: z.ZodBoolean;
    cooldownSeconds: z.ZodNumber;
    repeatSeconds: z.ZodNumber;
    delivery: z.ZodObject<{
        mode: z.ZodEnum<{
            custom: "custom";
            routing: "routing";
        }>;
        custom: z.ZodNullable<z.ZodObject<{
            channel: z.ZodEnum<{
                email: "email";
                webhook: "webhook";
            }>;
            target: z.ZodString;
            includeDetails: z.ZodBoolean;
            webhook: z.ZodNullable<z.ZodObject<{
                method: z.ZodEnum<{
                    GET: "GET";
                    POST: "POST";
                    PUT: "PUT";
                }>;
                headers: z.ZodRecord<z.ZodString, z.ZodString>;
                triggeredPayload: z.ZodString;
                resolvedPayload: z.ZodString;
                reportErrors: z.ZodBoolean;
                tunnel: z.ZodBoolean;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    silencedUntil: z.ZodNullable<z.ZodISODateTime>;
    state: z.ZodObject<{
        triggered: z.ZodBoolean;
        lastTriggeredAt: z.ZodNullable<z.ZodISODateTime>;
        lastResolvedAt: z.ZodNullable<z.ZodISODateTime>;
        extremeValue: z.ZodNullable<z.ZodNumber>;
        lastSampleAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const alarmRulePage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        deviceId: z.ZodString;
        name: z.ZodString;
        watch: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"reading">;
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
            upper: z.ZodNullable<z.ZodNumber>;
            lower: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"output_level">;
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
            upper: z.ZodNullable<z.ZodNumber>;
            lower: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"output_running">;
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
        }, z.core.$strip>], "kind">;
        forSeconds: z.ZodNumber;
        severity: z.ZodEnum<{
            critical: "critical";
            warning: "warning";
            info: "info";
        }>;
        origin: z.ZodEnum<{
            always: "always";
            human: "human";
            device: "device";
            preset: "preset";
        }>;
        presetId: z.ZodNullable<z.ZodString>;
        enabled: z.ZodBoolean;
        cooldownSeconds: z.ZodNumber;
        repeatSeconds: z.ZodNumber;
        delivery: z.ZodObject<{
            mode: z.ZodEnum<{
                custom: "custom";
                routing: "routing";
            }>;
            custom: z.ZodNullable<z.ZodObject<{
                channel: z.ZodEnum<{
                    email: "email";
                    webhook: "webhook";
                }>;
                target: z.ZodString;
                includeDetails: z.ZodBoolean;
                webhook: z.ZodNullable<z.ZodObject<{
                    method: z.ZodEnum<{
                        GET: "GET";
                        POST: "POST";
                        PUT: "PUT";
                    }>;
                    headers: z.ZodRecord<z.ZodString, z.ZodString>;
                    triggeredPayload: z.ZodString;
                    resolvedPayload: z.ZodString;
                    reportErrors: z.ZodBoolean;
                    tunnel: z.ZodBoolean;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        silencedUntil: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodObject<{
            triggered: z.ZodBoolean;
            lastTriggeredAt: z.ZodNullable<z.ZodISODateTime>;
            lastResolvedAt: z.ZodNullable<z.ZodISODateTime>;
            extremeValue: z.ZodNullable<z.ZodNumber>;
            lastSampleAt: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /devices/{id}/alarm-rules`. The device is the path. Where a rule came
 * from is the server's to say - a rule written here is `human` by definition -
 * and a silence is something done to a rule rather than part of what it says,
 * so neither is here.
 */
export declare const alarmRuleCreate: z.ZodObject<{
    name: z.ZodString;
    delivery: z.ZodObject<{
        mode: z.ZodEnum<{
            custom: "custom";
            routing: "routing";
        }>;
        custom: z.ZodNullable<z.ZodObject<{
            channel: z.ZodEnum<{
                email: "email";
                webhook: "webhook";
            }>;
            target: z.ZodString;
            includeDetails: z.ZodBoolean;
            webhook: z.ZodNullable<z.ZodObject<{
                method: z.ZodEnum<{
                    GET: "GET";
                    POST: "POST";
                    PUT: "PUT";
                }>;
                headers: z.ZodRecord<z.ZodString, z.ZodString>;
                triggeredPayload: z.ZodString;
                resolvedPayload: z.ZodString;
                reportErrors: z.ZodBoolean;
                tunnel: z.ZodBoolean;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    severity: z.ZodEnum<{
        critical: "critical";
        warning: "warning";
        info: "info";
    }>;
    forSeconds: z.ZodNumber;
    watch: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"reading">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_level">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_running">;
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
    }, z.core.$strip>], "kind">;
    enabled: z.ZodBoolean;
    cooldownSeconds: z.ZodNumber;
    repeatSeconds: z.ZodNumber;
}, z.core.$strip>;
/**
 * `PATCH /alarm-rules/{id}`: the same fields, each only if it changes. `watch`
 * is given whole or not at all - half a watch is a rule watching two things.
 */
export declare const alarmRuleUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    delivery: z.ZodOptional<z.ZodObject<{
        mode: z.ZodEnum<{
            custom: "custom";
            routing: "routing";
        }>;
        custom: z.ZodNullable<z.ZodObject<{
            channel: z.ZodEnum<{
                email: "email";
                webhook: "webhook";
            }>;
            target: z.ZodString;
            includeDetails: z.ZodBoolean;
            webhook: z.ZodNullable<z.ZodObject<{
                method: z.ZodEnum<{
                    GET: "GET";
                    POST: "POST";
                    PUT: "PUT";
                }>;
                headers: z.ZodRecord<z.ZodString, z.ZodString>;
                triggeredPayload: z.ZodString;
                resolvedPayload: z.ZodString;
                reportErrors: z.ZodBoolean;
                tunnel: z.ZodBoolean;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    severity: z.ZodOptional<z.ZodEnum<{
        critical: "critical";
        warning: "warning";
        info: "info";
    }>>;
    forSeconds: z.ZodOptional<z.ZodNumber>;
    watch: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"reading">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_level">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_running">;
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
    }, z.core.$strip>], "kind">>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    cooldownSeconds: z.ZodOptional<z.ZodNumber>;
    repeatSeconds: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/**
 * `PUT /alarm-rules/{id}/silence`. A duration rather than the instant the rule
 * carries: the sheet offers "for an hour", and the server's clock decides when
 * that is over rather than the phone's. `DELETE` on the same path lifts the
 * silence, so there is nothing to spell for "not silenced".
 */
export declare const alarmSilence: z.ZodObject<{
    forSeconds: z.ZodNumber;
}, z.core.$strip>;
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
export declare const alertWatched: z.ZodObject<{
    name: z.ZodString;
    watch: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"reading">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_level">;
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
        upper: z.ZodNullable<z.ZodNumber>;
        lower: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"output_running">;
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
    }, z.core.$strip>], "kind">;
}, z.core.$strip>;
/**
 * One document from trigger to resolution, which is what the alerts inbox shows.
 * An open alert has `resolvedAt: null`.
 */
export declare const alert: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    ruleId: z.ZodNullable<z.ZodString>;
    deviceId: z.ZodNullable<z.ZodString>;
    cameraId: z.ZodNullable<z.ZodString>;
    spaceId: z.ZodNullable<z.ZodString>;
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
    resolvedAt: z.ZodNullable<z.ZodISODateTime>;
    value: z.ZodNullable<z.ZodNumber>;
    extremeValue: z.ZodNullable<z.ZodNumber>;
    watched: z.ZodNullable<z.ZodObject<{
        name: z.ZodString;
        watch: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"reading">;
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
            upper: z.ZodNullable<z.ZodNumber>;
            lower: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"output_level">;
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
            upper: z.ZodNullable<z.ZodNumber>;
            lower: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"output_running">;
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
        }, z.core.$strip>], "kind">;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const alertPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        ruleId: z.ZodNullable<z.ZodString>;
        deviceId: z.ZodNullable<z.ZodString>;
        cameraId: z.ZodNullable<z.ZodString>;
        spaceId: z.ZodNullable<z.ZodString>;
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
        resolvedAt: z.ZodNullable<z.ZodISODateTime>;
        value: z.ZodNullable<z.ZodNumber>;
        extremeValue: z.ZodNullable<z.ZodNumber>;
        watched: z.ZodNullable<z.ZodObject<{
            name: z.ZodString;
            watch: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"reading">;
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
                upper: z.ZodNullable<z.ZodNumber>;
                lower: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"output_level">;
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
                upper: z.ZodNullable<z.ZodNumber>;
                lower: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"output_running">;
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
            }, z.core.$strip>], "kind">;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * The controller's day and night targets, read from its configuration. Influx
 * stores sensors and outputs and never setpoints, so this is the only place a
 * target comes from.
 */
export declare const setpoints: z.ZodObject<{
    day: z.ZodRecord<z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }> & z.core.$partial, z.ZodNumber>;
    night: z.ZodRecord<z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }> & z.core.$partial, z.ZodNumber>;
    active: z.ZodEnum<{
        day: "day";
        night: "night";
    }>;
}, z.core.$strip>;
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
export declare const deviceLive: z.ZodObject<{
    deviceId: z.ZodString;
    metrics: z.ZodRecord<z.ZodEnum<{
        offline: "offline";
        co2: "co2";
        temperature: "temperature";
        humidity: "humidity";
        leafTemperature: "leafTemperature";
        lux: "lux";
        vpd: "vpd";
        ppfd: "ppfd";
    }> & z.core.$partial, z.ZodObject<{
        value: z.ZodNullable<z.ZodNumber>;
        measuredAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodEnum<{
            offline: "offline";
            live: "live";
            stale: "stale";
        }>;
    }, z.core.$strip>>;
    outputs: z.ZodRecord<z.ZodEnum<{
        dehumidifier: "dehumidifier";
        heater: "heater";
        light: "light";
        co2: "co2";
        fan: "fan";
        relais: "relais";
        fanInternal: "fanInternal";
        fanExternal: "fanExternal";
        fanBackwall: "fanBackwall";
    }> & z.core.$partial, z.ZodObject<{
        value: z.ZodNullable<z.ZodNumber>;
        measuredAt: z.ZodNullable<z.ZodISODateTime>;
        state: z.ZodEnum<{
            offline: "offline";
            live: "live";
            stale: "stale";
        }>;
    }, z.core.$strip>>;
    setpoints: z.ZodNullable<z.ZodObject<{
        day: z.ZodRecord<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }> & z.core.$partial, z.ZodNumber>;
        night: z.ZodRecord<z.ZodEnum<{
            offline: "offline";
            co2: "co2";
            temperature: "temperature";
            humidity: "humidity";
            leafTemperature: "leafTemperature";
            lux: "lux";
            vpd: "vpd";
            ppfd: "ppfd";
        }> & z.core.$partial, z.ZodNumber>;
        active: z.ZodEnum<{
            day: "day";
            night: "night";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const metricSeries: z.ZodObject<{
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
}, z.core.$strip>;
export declare const outputSeries: z.ZodObject<{
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
    points: z.ZodArray<z.ZodObject<{
        measuredAt: z.ZodISODateTime;
        value: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * What `GET /devices/{id}/series` is asked for. A request, so what a caller may
 * leave out is `.optional()` here rather than `.nullable()`: with no outputs it
 * gets none, and with no step the server picks one from the range.
 */
export declare const seriesQuery: z.ZodObject<{
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
    outputs: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        dehumidifier: "dehumidifier";
        heater: "heater";
        light: "light";
        co2: "co2";
        fan: "fan";
        relais: "relais";
        fanInternal: "fanInternal";
        fanExternal: "fanExternal";
        fanBackwall: "fanBackwall";
    }>>>;
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    stepSeconds: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** The range and step are answered back, because the server may have narrowed either. */
export declare const deviceSeries: z.ZodObject<{
    deviceId: z.ZodString;
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    stepSeconds: z.ZodNumber;
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
        points: z.ZodArray<z.ZodObject<{
            measuredAt: z.ZodISODateTime;
            value: z.ZodNullable<z.ZodNumber>;
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
        points: z.ZodArray<z.ZodObject<{
            measuredAt: z.ZodISODateTime;
            value: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * How one build is doing inside its class: how many devices run it, how many are
 * partway through taking it, how many gave up, and how long the update took.
 * `firmwareId` is null on the row that stands for devices running a build this
 * server has no record of, which is what a device flashed over USB reports.
 */
export declare const fleetFirmwareStats: z.ZodObject<{
    firmwareId: z.ZodNullable<z.ZodString>;
    version: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    total: z.ZodNumber;
    online: z.ZodNumber;
    updating: z.ZodNumber;
    failed: z.ZodNumber;
    averageUpdateMs: z.ZodNullable<z.ZodNumber>;
    maxUpdateMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/** One class of the fleet, with the rollout being staged across it. */
export declare const fleetClass: z.ZodObject<{
    classId: z.ZodString;
    name: z.ZodString;
    total: z.ZodNumber;
    online: z.ZodNumber;
    rollout: z.ZodObject<{
        paused: z.ZodBoolean;
        percent: z.ZodNumber;
    }, z.core.$strip>;
    firmwares: z.ZodArray<z.ZodObject<{
        firmwareId: z.ZodNullable<z.ZodString>;
        version: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        total: z.ZodNumber;
        online: z.ZodNumber;
        updating: z.ZodNumber;
        failed: z.ZodNumber;
        averageUpdateMs: z.ZodNullable<z.ZodNumber>;
        maxUpdateMs: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * `GET /admin/fleet`. Not a page: there are as many rows as there are device
 * classes, and the screen stages and pauses a rollout on each, which it can only
 * weigh with all of them in front of it.
 */
export declare const fleet: z.ZodObject<{
    classes: z.ZodArray<z.ZodObject<{
        classId: z.ZodString;
        name: z.ZodString;
        total: z.ZodNumber;
        online: z.ZodNumber;
        rollout: z.ZodObject<{
            paused: z.ZodBoolean;
            percent: z.ZodNumber;
        }, z.core.$strip>;
        firmwares: z.ZodArray<z.ZodObject<{
            firmwareId: z.ZodNullable<z.ZodString>;
            version: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            total: z.ZodNumber;
            online: z.ZodNumber;
            updating: z.ZodNumber;
            failed: z.ZodNumber;
            averageUpdateMs: z.ZodNullable<z.ZodNumber>;
            maxUpdateMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    unclassifiedDevices: z.ZodNumber;
}, z.core.$strip>;
export declare const adminUserStats: z.ZodObject<{
    total: z.ZodNumber;
    active: z.ZodNumber;
    admins: z.ZodNumber;
}, z.core.$strip>;
export declare const adminDeviceStats: z.ZodObject<{
    total: z.ZodNumber;
    claimed: z.ZodNumber;
    online: z.ZodNumber;
    updating: z.ZodNumber;
}, z.core.$strip>;
export declare const adminCameraStats: z.ZodObject<{
    total: z.ZodNumber;
    entitled: z.ZodNumber;
    stale: z.ZodNumber;
}, z.core.$strip>;
/** What is being grown and written on this install, which is what its size is felt as. */
export declare const adminContentStats: z.ZodObject<{
    spaces: z.ZodNumber;
    grows: z.ZodNumber;
    publicGrows: z.ZodNumber;
    plants: z.ZodNumber;
    entries: z.ZodNumber;
    media: z.ZodNumber;
    mediaBytes: z.ZodNumber;
}, z.core.$strip>;
/** The composer's queue, which is the one piece of work on an install that can quietly stop moving. */
export declare const adminRenderStats: z.ZodObject<{
    queued: z.ZodNumber;
    rendering: z.ZodNumber;
    failed: z.ZodNumber;
}, z.core.$strip>;
/**
 * The last pass of the climate retention sweep.
 *
 * It is the only background job on an install that deletes a grower's raw
 * samples, so whether it ran, how far it got and whether it is erroring is
 * something an operator has to be able to see. The pass is kept by the running
 * server and not stored, so this is null on a server that has not yet swept
 * since it came up; a screen says that rather than inventing an hour.
 */
export declare const adminRetentionRun: z.ZodObject<{
    ranAt: z.ZodISODateTime;
    reached: z.ZodNumber;
    devices: z.ZodNumber;
    days: z.ZodNumber;
    errors: z.ZodNumber;
}, z.core.$strip>;
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
export declare const adminAlarmWatch: z.ZodObject<{
    ranAt: z.ZodNullable<z.ZodISODateTime>;
    devices: z.ZodNumber;
    unjudged: z.ZodNumber;
    failures: z.ZodNumber;
    failedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * `GET /admin/stats`. Counting every collection is not free, so the answer may
 * be a cached pass and says when it was taken rather than implying "now".
 */
export declare const adminStats: z.ZodObject<{
    collectedAt: z.ZodISODateTime;
    users: z.ZodObject<{
        total: z.ZodNumber;
        active: z.ZodNumber;
        admins: z.ZodNumber;
    }, z.core.$strip>;
    devices: z.ZodObject<{
        total: z.ZodNumber;
        claimed: z.ZodNumber;
        online: z.ZodNumber;
        updating: z.ZodNumber;
    }, z.core.$strip>;
    cameras: z.ZodObject<{
        total: z.ZodNumber;
        entitled: z.ZodNumber;
        stale: z.ZodNumber;
    }, z.core.$strip>;
    content: z.ZodObject<{
        spaces: z.ZodNumber;
        grows: z.ZodNumber;
        publicGrows: z.ZodNumber;
        plants: z.ZodNumber;
        entries: z.ZodNumber;
        media: z.ZodNumber;
        mediaBytes: z.ZodNumber;
    }, z.core.$strip>;
    renders: z.ZodObject<{
        queued: z.ZodNumber;
        rendering: z.ZodNumber;
        failed: z.ZodNumber;
    }, z.core.$strip>;
    retention: z.ZodNullable<z.ZodObject<{
        ranAt: z.ZodISODateTime;
        reached: z.ZodNumber;
        devices: z.ZodNumber;
        days: z.ZodNumber;
        errors: z.ZodNumber;
    }, z.core.$strip>>;
    alarmWatch: z.ZodObject<{
        ranAt: z.ZodNullable<z.ZodISODateTime>;
        devices: z.ZodNumber;
        unjudged: z.ZodNumber;
        failures: z.ZodNumber;
        failedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const adminLogLevel: z.ZodEnum<{
    error: "error";
    info: "info";
    warn: "warn";
}>;
/**
 * One line of the server's own log, which is not a diary entry: the diary is
 * what happened to a grow, this is what happened inside the process, and a
 * hosted install has no shell to read it in. `context` is the module that wrote
 * the line, and the two ids are filled where a line is about one.
 */
export declare const adminLogLine: z.ZodObject<{
    id: z.ZodString;
    loggedAt: z.ZodISODateTime;
    level: z.ZodEnum<{
        error: "error";
        info: "info";
        warn: "warn";
    }>;
    context: z.ZodString;
    message: z.ZodString;
    deviceId: z.ZodNullable<z.ZodString>;
    userId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** `GET /admin/logs`. Paged like every list, because a log has no end. */
export declare const adminLogPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        loggedAt: z.ZodISODateTime;
        level: z.ZodEnum<{
            error: "error";
            info: "info";
            warn: "warn";
        }>;
        context: z.ZodString;
        message: z.ZodString;
        deviceId: z.ZodNullable<z.ZodString>;
        userId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
