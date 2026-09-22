/**
 * What each growth stage asks of a tent: the one table of the figures a climate
 * preset writes.
 *
 * It is shared rather than the server's alone because two things read it. The
 * server writes it to a controller when a stage is applied, and the manual
 * targets page prefills its sliders from it before a person adjusts anything -
 * and a client holding a copy of these numbers would be a second answer to
 * what the tent is being put on. Like `VALUE_AGE`, it carries no schema, so a
 * client imports this module on its own without pulling zod in.
 *
 * The figures are the ones the phase tiles have always written, and they are
 * deliberately conservative: they are what a beginner's tent is safe at rather
 * than what a competition is won with. The reasoning per row is kept with the
 * company documents.
 *
 * `stage` is the botanical fact and is the key; a preset refines one stage into
 * the step the screens draw - "Late flower" is `flowering` with the preset
 * `late_flowering`, and the two `autoflower` rows are veg and flower kept under
 * a long day, because an autoflower never gets the 12/12 flip that tells a
 * photoperiod plant to bloom. A preset this table has never heard of falls back
 * to its stage, and a stage with no row - curing - writes nothing at all.
 *
 * What is *not* here is as deliberate: the work mode, the heating and
 * dehumidifying behaviour, the fans and the dimming ramps are what the hardware
 * is tuned to and survive a phase change. A preset is a target climate, not a
 * decision about the machine.
 */
export interface ClimatePreset {
    dayTemperature: number;
    nightTemperature: number;
    dayHumidity: number;
    nightHumidity: number;
    /** How long the light is on, in hours. Null leaves the photoperiod where it is, which is what a stage kept dark does. */
    lightHours: number | null;
    /** Per cent of the light's own maximum. Zero is a stage that is kept dark. */
    lightLimit: number;
    /** Parts per million. The firmware forces it to zero where no CO2 sensor is fitted, so a tent without one opens no valve. */
    co2: number;
}
/** What outdoor air holds: the target a stage that does not enrich is written with. */
export declare const AMBIENT_CO2 = 400;
/** The presets that refine a stage, by the stage they refine. The stage on its own is always an option and is not one of them. */
export declare const PRESETS_OF_STAGE: Readonly<Partial<Record<string, readonly string[]>>>;
/** The stages that have a climate at all, in the order a grow passes through them. */
export declare const STAGES_WITH_CLIMATE: readonly string[];
/** The row for a stage and the preset on top of it, falling back to the stage's own; null for a stage with none. */
export declare const climatePreset: (stage: string, preset: string | null) => ClimatePreset | null;
