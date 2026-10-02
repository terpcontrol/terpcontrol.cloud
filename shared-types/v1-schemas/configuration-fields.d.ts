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
export interface NumberField {
    kind: 'number';
    path: string;
    min: number;
    max: number;
    step: number;
}
export interface SwitchField {
    kind: 'switch';
    path: string | null;
}
export interface ChoiceField {
    kind: 'choice';
    path: string | null;
    options: readonly string[];
    /**
     * What each option is stored as, in the order of `options`, where the
     * firmware keeps a number for it: a fan's mode is 0 to 3 in its document and
     * a word everywhere else.
     */
    codes?: readonly number[];
}
/**
 * A list of daily windows, each switching on at a time of day for so many
 * minutes: a smart socket's timer. Set whole, because a window is only
 * meaningful beside the others, and kept as the firmware keeps it.
 */
export interface WindowsField {
    kind: 'windows';
    path: string;
    /** The most windows a document may carry; the firmware parses it in a buffer of a fixed size. */
    most: number;
    /** The longest a window may run, in minutes. */
    longest: number;
}
/** One window of a timer: `ontime` in seconds past midnight UTC, `duration` in minutes. */
export interface TimerWindow {
    ontime: number;
    duration: number;
}
export type ConfigurationField = NumberField | SwitchField | ChoiceField | WindowsField;
/** What a field is set to: a figure, on or off, one of its options, or a list of windows. */
export type FieldSetting = number | boolean | string | readonly TimerWindow[];
export type ConfigurationFields = Readonly<Record<string, ConfigurationField>>;
/**
 * What a fridge or a controller is set to do as a whole, in a person's words:
 * the standard climate control, temperature only (the firmware's `temp`), or
 * dark germination held at the night temperature (`breed`).
 */
export declare const OPERATING_MODES: readonly ["standard", "greenhouse", "germination"];
export type OperatingMode = (typeof OPERATING_MODES)[number];
/** The least the compressor rests between two runs. Below this it is not protected, whatever an older app allowed. */
export declare const MIN_COMPRESSOR_REST_SECONDS = 240;
/**
 * What a stand-alone smart socket switches by, in the firmware's words: the
 * sensor it carries (heating, cooling, humidifying, dehumidifying, dosing CO2),
 * its timer, or nothing at all.
 */
export declare const PLUG_MODES: readonly ["off", "heater", "cooler", "humidify", "dehumidify", "co2", "timer"];
export type PlugMode = (typeof PLUG_MODES)[number];
/** The modes that switch at two points of a reading, each by day and by night. */
export declare const PLUG_SWITCHING: readonly ["heater", "cooler", "humidify", "dehumidify"];
export type PlugSwitching = (typeof PLUG_SWITCHING)[number];
/** The reading each switching mode follows, and the range its points are held to. */
export declare const SWITCH_POINT_RANGE: Readonly<Record<PlugSwitching, {
    min: number;
    max: number;
    step: number;
}>>;
/** The name of one switch point: `heaterDayOn` is the reading a heater switches on at by day. */
export declare const switchPointName: (mode: PlugSwitching, when: "day" | "night", edge: "on" | "off") => string;
/** Dosing CO2 the whole time below the switch-on point, or only in a window of every period. */
export declare const CO2_DOSINGS: readonly ["const", "periodic"];
/** How many windows a smart socket's timer holds at most. */
export declare const MOST_TIMER_WINDOWS = 8;
/**
 * What an AIR fan's speed follows: nothing (a fixed speed by day and by
 * night), the temperature, the humidity, or whichever of the two is further
 * over its target. The firmware keeps them as 0 to 3.
 */
export declare const FAN_MODES: readonly ["fixed", "temperature", "humidity", "both"];
export type FanMode = (typeof FAN_MODES)[number];
export declare const CONFIGURATION_FIELDS: Readonly<Record<string, ConfigurationFields>>;
/** The fields a type of device offers; none for a type this table does not know. */
export declare const configurationFieldsOf: (type: string) => ConfigurationFields;
type Document = Readonly<Record<string, unknown>> | null | undefined;
/**
 * The AIR fan a smart socket slows down while it doses CO2, and how far. The
 * socket keeps it under `fan` as a JSON string the firmware stores and never
 * reads, with `device_id` set to `none` where there is none; the fan is told
 * in a section of its own document, `co2inject`, which the server writes from
 * the socket's.
 */
export interface Co2Fan {
    fanId: string;
    /** Per cent: the most the fan runs at while the socket doses. */
    speed: number;
}
export declare const co2FanOf: (plug: Document) => Co2Fan | null;
/** The socket's `fan` key for a coupling, or for none. */
export declare const co2FanKey: (coupling: Co2Fan | null) => string;
/**
 * Whether the socket doses CO2 in windows of every period, which is the only
 * dosing a fan can be slowed for: the fan knows nothing of the socket and
 * simply runs slower in the same windows of the same period.
 */
export declare const dosesInWindows: (plug: Document) => boolean;
/**
 * The section a coupled fan is given: the socket's dosing windows, its day
 * and the speed to hold to - or an empty one, which is how a fan is told it is
 * slowed for nothing, while the socket does not dose in windows.
 */
export declare const co2InjectFor: (plugId: string, plug: Document, speed: number) => Record<string, unknown>;
/** The smart socket a fan is slowed for, as the fan's own document names it. */
export declare const co2PlugOf: (fan: Document) => string | null;
export {};
