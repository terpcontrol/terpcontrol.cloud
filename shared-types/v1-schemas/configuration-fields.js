"use strict";
/**
 * The settings of a device's own configuration document that a person changes
 * one at a time, by type of device: what `PATCH /devices/{id}/configuration`
 * accepts and what the screens offering them draw their controls from.
 *
 * The document itself stays the firmware's (`DeviceConfiguration`), and the
 * targets keep their own page that writes it whole. Everything beyond the
 * targets - a work mode, a fan's strength, a ramp - is named here once, with
 * the range the server holds it to, so that the slider and the check cannot
 * disagree. A key the table does not name is not refused by the document: the
 * server merges a change into what the device runs and keeps every key it was
 * not asked about.
 *
 * `path` is the dotted place of the figure in the document. A switch is written
 * as 1 or 0, which is how the firmware reads every flag it has; a choice the
 * firmware keeps as a number is written as its code; a list of windows is
 * written whole. A field whose
 * `path` is null is decided by the server rather than written as given: the
 * work mode is one key the firmware reads, and which value it takes depends on
 * three things a person decides separately and on the phase the grow is in.
 *
 * One table per type, so that settings for different hardware are added in
 * different places. No schema, so a client imports it without pulling zod in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_SETTING_RANGES = exports.co2PlugOf = exports.co2InjectFor = exports.dosesInWindows = exports.co2FanKey = exports.co2FanOf = exports.configurationFieldsOf = exports.CONFIGURATION_FIELDS = exports.FAN_MODES = exports.MOST_TIMER_WINDOWS = exports.CO2_DOSINGS = exports.switchPointName = exports.SWITCH_POINT_RANGE = exports.PLUG_SWITCHING = exports.PLUG_MODES = exports.MIN_COMPRESSOR_REST_SECONDS = exports.OPERATING_MODES = void 0;
/**
 * What a fridge or a controller is set to do as a whole, in a person's words:
 * the standard climate control, temperature only (the firmware's `temp`), or
 * dark germination held at the night temperature (`breed`).
 */
exports.OPERATING_MODES = ['standard', 'greenhouse', 'germination'];
/** Whether the device regulates at all. Off is the firmware's `workmode: off`, which is also how a device leaves the factory. */
const CONTROL = { control: { kind: 'switch', path: null } };
/** The least the compressor rests between two runs. Below this it is not protected, whatever an older app allowed. */
exports.MIN_COMPRESSOR_REST_SECONDS = 240;
/**
 * How long the lamp takes to come up in the morning and go down in the
 * evening, in minutes: both firmwares that dim a lamp ramp it over this rather
 * than switching it hard.
 */
const RAMPS = {
    sunrise: { kind: 'number', path: 'lights.sunrise', min: 0, max: 60, step: 1 },
    sunset: { kind: 'number', path: 'lights.sunset', min: 0, max: 60, step: 1 },
};
const FRIDGE = {
    ...CONTROL,
    // The back-wall fan stands still while the compressor is off: the firmware's `full`.
    energySaving: { kind: 'switch', path: null },
    mode: { kind: 'choice', path: null, options: exports.OPERATING_MODES },
    compressorRest: { kind: 'number', path: 'daynight.minimalDehumidifierOffTime', min: exports.MIN_COMPRESSOR_REST_SECONDS, max: 900, step: 30 },
    ...RAMPS,
    // The lamp stays at its working brightness through a maintenance window at night too.
    maintenanceLight: { kind: 'switch', path: 'lights.maintenanceOn' },
    // Per cent. The clip fan may stand still; the inner fans keep a tenth, which is the least the firmware runs them at.
    clipFan: { kind: 'number', path: 'fans.external', min: 0, max: 100, step: 5 },
    innerFans: { kind: 'number', path: 'fans.internal', min: 10, max: 100, step: 5 },
};
const CONTROLLER = { ...CONTROL, ...RAMPS };
/** A time of day as the firmware keeps every one: seconds past midnight UTC. The app writes whole minutes. */
const TIME_OF_DAY = { kind: 'number', min: 0, max: 86399, step: 60 };
/**
 * What a stand-alone smart socket switches by, in the firmware's words: the
 * sensor it carries (heating, cooling, humidifying, dehumidifying, dosing CO2),
 * its timer, or nothing at all.
 */
exports.PLUG_MODES = ['off', 'heater', 'cooler', 'humidify', 'dehumidify', 'co2', 'timer'];
/** The modes that switch at two points of a reading, each by day and by night. */
exports.PLUG_SWITCHING = ['heater', 'cooler', 'humidify', 'dehumidify'];
/** The reading each switching mode follows, and the range its points are held to. */
exports.SWITCH_POINT_RANGE = {
    heater: { min: 5, max: 40, step: 0.5 },
    cooler: { min: 5, max: 40, step: 0.5 },
    humidify: { min: 10, max: 90, step: 1 },
    dehumidify: { min: 10, max: 90, step: 1 },
};
const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);
/** The name of one switch point: `heaterDayOn` is the reading a heater switches on at by day. */
const switchPointName = (mode, when, edge) => `${mode}${capital(when)}${capital(edge)}`;
exports.switchPointName = switchPointName;
const SWITCH_POINTS = Object.fromEntries(exports.PLUG_SWITCHING.flatMap(mode => ['day', 'night'].flatMap(when => ['on', 'off'].map(edge => [
    (0, exports.switchPointName)(mode, when, edge),
    { kind: 'number', path: `${mode}.${when}.${edge}`, ...exports.SWITCH_POINT_RANGE[mode] },
]))));
/** Dosing CO2 the whole time below the switch-on point, or only in a window of every period. */
exports.CO2_DOSINGS = ['const', 'periodic'];
/** How many windows a smart socket's timer holds at most. */
exports.MOST_TIMER_WINDOWS = 8;
const PLUG = {
    plugMode: { kind: 'choice', path: 'workmode', options: exports.PLUG_MODES },
    // Separate switch points by night, and the day they are told apart by.
    dayNight: { kind: 'switch', path: 'usedaynight' },
    dayFrom: { ...TIME_OF_DAY, path: 'daynight.day' },
    nightFrom: { ...TIME_OF_DAY, path: 'daynight.night' },
    ...SWITCH_POINTS,
    co2On: { kind: 'number', path: 'co2.on', min: 100, max: 10000, step: 10 },
    co2Off: { kind: 'number', path: 'co2.off', min: 100, max: 10000, step: 10 },
    co2Dosing: { kind: 'choice', path: 'co2.mode', options: exports.CO2_DOSINGS },
    // Minutes; a period of nothing would have the firmware divide by zero.
    co2Every: { kind: 'number', path: 'co2.period', min: 1, max: 120, step: 1 },
    co2For: { kind: 'number', path: 'co2.duration', min: 1, max: 60, step: 1 },
    timerWindows: { kind: 'windows', path: 'timer.timeframes', most: exports.MOST_TIMER_WINDOWS, longest: 24 * 60 },
    overheatOff: { kind: 'switch', path: 'limits.overtemperature.enabled' },
    overheatAt: { kind: 'number', path: 'limits.overtemperature.limit', min: 5, max: 50, step: 0.5 },
    overheatBack: { kind: 'number', path: 'limits.overtemperature.hysteresis', min: 0.5, max: 10, step: 0.5 },
    coldOff: { kind: 'switch', path: 'limits.undertemperature.enabled' },
    coldAt: { kind: 'number', path: 'limits.undertemperature.limit', min: 0, max: 40, step: 0.5 },
    coldBack: { kind: 'number', path: 'limits.undertemperature.hysteresis', min: 0.5, max: 10, step: 0.5 },
    leastTimes: { kind: 'switch', path: 'limits.time.enabled' },
    leastOnSeconds: { kind: 'number', path: 'limits.time.min_on', min: 0, max: 1800, step: 10 },
    leastOffSeconds: { kind: 'number', path: 'limits.time.min_off', min: 0, max: 1800, step: 10 },
};
/**
 * What an AIR fan's speed follows: nothing (a fixed speed by day and by
 * night), the temperature, the humidity, or whichever of the two is further
 * over its target. The firmware keeps them as 0 to 3.
 */
exports.FAN_MODES = ['fixed', 'temperature', 'humidity', 'both'];
const SPEED = { kind: 'number', min: 0, max: 100, step: 1 };
const FAN = {
    fanMode: { kind: 'choice', path: 'mode', options: exports.FAN_MODES, codes: [0, 1, 2, 3] },
    fixedDay: { ...SPEED, path: 'day.fixed_speed' },
    fixedNight: { ...SPEED, path: 'night.fixed_speed' },
    mostDay: { ...SPEED, path: 'day.max_speed' },
    mostNight: { ...SPEED, path: 'night.max_speed' },
    least: { ...SPEED, path: 'min_speed' },
};
/**
 * A stand-alone LIGHT keeps everything at the top of its document: when it
 * comes on and goes off, how bright it gets, how many minutes it fades in and
 * out, and the temperature it starts dimming at to protect itself.
 */
const LIGHT = {
    lightsOn: { ...TIME_OF_DAY, path: 'day' },
    lightsOff: { ...TIME_OF_DAY, path: 'night' },
    brightness: { kind: 'number', path: 'limit', min: 0, max: 100, step: 1 },
    sunrise: { kind: 'number', path: 'sunrise', min: 0, max: 60, step: 1 },
    sunset: { kind: 'number', path: 'sunset', min: 0, max: 60, step: 1 },
    overheatAt: { kind: 'number', path: 'max_temperature', min: 5, max: 40, step: 1 },
};
exports.CONFIGURATION_FIELDS = {
    fridge: FRIDGE,
    controller: CONTROLLER,
    plug: PLUG,
    fan: FAN,
    light: LIGHT,
};
/** The fields a type of device offers; none for a type this table does not know. */
const configurationFieldsOf = (type) => exports.CONFIGURATION_FIELDS[type] ?? {};
exports.configurationFieldsOf = configurationFieldsOf;
const sectionIn = (document, key) => {
    const value = document?.[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
};
const co2FanOf = (plug) => {
    const raw = plug?.fan;
    if (typeof raw !== 'string' || raw === '')
        return null;
    try {
        const parsed = JSON.parse(raw);
        const fan = typeof parsed === 'object' && parsed !== null ? parsed : {};
        if (typeof fan.device_id !== 'string' || fan.device_id === '' || fan.device_id === 'none')
            return null;
        return { fanId: fan.device_id, speed: typeof fan.speed === 'number' ? fan.speed : 100 };
    }
    catch {
        return null;
    }
};
exports.co2FanOf = co2FanOf;
/** The socket's `fan` key for a coupling, or for none. */
const co2FanKey = (coupling) => JSON.stringify(coupling ? { device_id: coupling.fanId, speed: coupling.speed } : { device_id: 'none', speed: 100 });
exports.co2FanKey = co2FanKey;
/**
 * Whether the socket doses CO2 in windows of every period, which is the only
 * dosing a fan can be slowed for: the fan knows nothing of the socket and
 * simply runs slower in the same windows of the same period.
 */
const dosesInWindows = (plug) => plug?.workmode === 'co2' && sectionIn(plug, 'co2')?.mode === 'periodic';
exports.dosesInWindows = dosesInWindows;
/**
 * The section a coupled fan is given: the socket's dosing windows, its day
 * and the speed to hold to - or an empty one, which is how a fan is told it is
 * slowed for nothing, while the socket does not dose in windows.
 */
const co2InjectFor = (plugId, plug, speed) => {
    if (!(0, exports.dosesInWindows)(plug))
        return {};
    const co2 = sectionIn(plug, 'co2') ?? {};
    const daynight = sectionIn(plug, 'daynight') ?? {};
    return {
        device_id: plugId,
        speed,
        usedaynight: plug?.usedaynight === true || plug?.usedaynight === 1 ? 1 : 0,
        day: daynight.day,
        night: daynight.night,
        period: co2.period,
        duration: co2.duration,
    };
};
exports.co2InjectFor = co2InjectFor;
/** The smart socket a fan is slowed for, as the fan's own document names it. */
const co2PlugOf = (fan) => {
    const id = sectionIn(fan, 'co2inject')?.device_id;
    return typeof id === 'string' && id !== '' ? id : null;
};
exports.co2PlugOf = co2PlugOf;
/**
 * The cloud's own settings of a device (`Device.settings`), which no firmware
 * reads: how much cooler than the air a leaf is taken to be where no leaf
 * sensor measures it, which is what VPD is worked out with, and the factor
 * that turns the light sensor's lux into PPFD. The ranges are what
 * `PATCH /devices/{id}` holds them to and what the screens offer; a figure
 * outside them is a typing slip rather than a lamp or a leaf.
 */
exports.DEVICE_SETTING_RANGES = {
    vpdLeafOffsetDay: { min: -10, max: 5, step: 0.5 },
    vpdLeafOffsetNight: { min: -10, max: 5, step: 0.5 },
    ppfdLuxFactor: { min: 0.005, max: 0.05, step: 0.0001 },
};
