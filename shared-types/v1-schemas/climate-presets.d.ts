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
 *
 * The alarm bands at the end are derived from the same rows, so that what a
 * stage watches for cannot drift from what it asks for.
 */
import type { z } from 'zod';
import type { growthStage } from './common.js';
type GrowthStage = z.infer<typeof growthStage>;
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
export declare const PRESETS_OF_STAGE: Readonly<Partial<Record<GrowthStage, readonly string[]>>>;
/** The stages that have a climate at all, in the order a grow passes through them. */
export declare const STAGES_WITH_CLIMATE: readonly GrowthStage[];
/** The row for a stage and the preset on top of it, falling back to the stage's own; null for a stage with none. */
export declare const climatePreset: (stage: GrowthStage, preset: string | null) => ClimatePreset | null;
/**
 * One alarm threshold a stage binds, derived from its climate row so that the
 * rules a tent is watched by move with the stage the way its targets do.
 *
 * `key` is what a rule written from a band is found by again when the next
 * stage moves it, whatever it has been renamed to since. The watch is the
 * contract's own `ReadingWatch`, so the server stores it as it is.
 */
export interface StageAlarmBand {
    key: 'too_hot' | 'too_humid' | 'too_cold' | 'co2_high';
    watch: {
        kind: 'reading';
        metric: 'temperature' | 'humidity' | 'co2';
        upper: number | null;
        lower: number | null;
    };
    forSeconds: number;
    severity: 'critical' | 'warning';
}
/**
 * Above this, enriched air is wasted gas and most likely a valve that has stuck
 * open. It is the same in every stage because it is about the valve, not the
 * plants; the firmware forces the target to zero where no sensor is fitted, so
 * the rule can only ever trip on a tent that measures it.
 */
export declare const CO2_ALARM_PPM = 1500;
/**
 * The four rules a stage implies, or null for a stage with no climate: curing
 * happens in a jar, and a rule watching a flowering band there is noise.
 *
 * Each margin is what tells a failure from weather. Five degrees over the day
 * target is a cooler that has failed rather than a warm afternoon, and it is
 * critical because heat stress sets in within the hour. Ten points of humidity
 * over the higher of the two targets is where mould starts, and it is given
 * twenty minutes because a watering or a door opened for a look pushes the
 * reading up for a while. Four degrees under the night target is a heater that
 * has given up, and at night nobody is looking. Like the climate table these
 * come from, the figures are deliberately conservative: they are the bands a
 * beginner's tent is safe inside, and a grower who knows better moves them on
 * the rule.
 */
export declare const stageAlarmBands: (stage: GrowthStage, preset: string | null) => StageAlarmBand[] | null;
export {};
