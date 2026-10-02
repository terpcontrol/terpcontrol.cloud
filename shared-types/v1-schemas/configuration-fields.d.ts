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
 * as 1 or 0, which is how the firmware reads every flag it has. A field whose
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
}
export type ConfigurationField = NumberField | SwitchField | ChoiceField;
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
export declare const CONFIGURATION_FIELDS: Readonly<Record<string, ConfigurationFields>>;
/** The fields a type of device offers; none for a type this table does not know. */
export declare const configurationFieldsOf: (type: string) => ConfigurationFields;
