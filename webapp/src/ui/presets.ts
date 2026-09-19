import type { GrowthStage } from '@fg2/shared-types/v1';

/**
 * The climate presets the screens offer on top of a stage.
 *
 * `preset` crosses the wire as a string rather than an enum exactly so that
 * this table can grow without the contract moving, so it ships with the client:
 * "Late flower" is the stage `flowering` refined by the preset
 * `late_flowering`, which is how the screens draw a seventh step without
 * inventing a seventh botanical stage.
 *
 * What a stored preset is *called* is a translation key of its own, and there
 * are names for presets this table no longer offers: a grow that was put on one
 * years ago still reads as what it was put on, which is not the same question
 * as what may be chosen today.
 *
 * The figures a preset writes are not here and are deliberately not copied: the
 * server holds one table of them, and a second one on this side would be a
 * second answer to what the tent is running. What a sheet says beforehand is
 * *which* settings a preset touches; what it is afterwards is the targets the
 * tent page reads back.
 */

const PRESETS: Partial<Record<GrowthStage, string[]>> = { flowering: ['late_flowering'] };

/**
 * The stages a tent's climate is written for.
 *
 * `curing` is not among them, and that is the whole reason this list exists:
 * jars are not steered, the server has no row for the stage, and applying it
 * leaves every controller exactly as it was. A screen that did not know would
 * report a change the tent never made.
 */
export const STAGES_WITH_CLIMATE: GrowthStage[] = ['germination', 'seedling', 'vegetative', 'flowering', 'drying'];

export const writesClimate = (stage: GrowthStage): boolean => STAGES_WITH_CLIMATE.includes(stage);

/** The presets that refine this stage, if any. The stage on its own is always an option and is not one of them. */
export const presetsOf = (stage: GrowthStage): string[] => PRESETS[stage] ?? [];
