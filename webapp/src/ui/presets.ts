import type { GrowthStage } from '@fg2/shared-types/v1';
import { PRESETS_OF_STAGE, STAGES_WITH_CLIMATE as CLIMATE_STAGES } from '@fg2/shared-types/v1-schemas/climate-presets.js';

/**
 * The climate presets the screens offer on top of a stage.
 *
 * `preset` crosses the wire as a string rather than an enum exactly so that
 * the table can grow without the contract moving. "Late flower" is the stage
 * `flowering` refined by the preset `late_flowering`, which is how the screens
 * draw a seventh step without inventing a seventh botanical stage.
 *
 * Which presets exist is the shared table's answer and not a list kept here:
 * the targets page and the preset sheet used to read two different lists, so
 * one offered "Auto · Flower" and the other did not know the word. Every
 * screen that offers a climate reads it from here, and this reads it from the
 * table the server writes the figures from.
 *
 * What a stored preset is *called* is a translation key of its own, and there
 * are names for presets the table no longer offers: a grow that was put on one
 * years ago still reads as what it was put on, which is not the same question
 * as what may be chosen today.
 */

/**
 * The stages a tent's climate is written for.
 *
 * `curing` is not among them, and that is the whole reason this list exists:
 * jars are not steered, the server has no row for the stage, and applying it
 * leaves every controller exactly as it was. A screen that did not know would
 * report a change the tent never made.
 */
export const STAGES_WITH_CLIMATE: readonly GrowthStage[] = CLIMATE_STAGES;

export const writesClimate = (stage: GrowthStage): boolean => STAGES_WITH_CLIMATE.includes(stage);

/** The presets that refine this stage, if any. The stage on its own is always an option and is not one of them. */
export const presetsOf = (stage: GrowthStage): string[] => [...(PRESETS_OF_STAGE[stage] ?? [])];

/** A climate a screen offers in one tap: a stage on its own, or a preset refining one. */
export interface ClimateChoice {
  stage: GrowthStage;
  preset: string | null;
}

/**
 * Every climate as one list, in the order the targets page draws its chips:
 * each stage with its own presets beside it, and the autoflower rows at the
 * end - they are the same stages kept under a long day, and read as one group.
 * Germination comes first, dark, and the seedling climate with light after it.
 */
export const CLIMATE_CHOICES: readonly ClimateChoice[] = (() => {
  const choices: ClimateChoice[] = [];
  for (const stage of STAGES_WITH_CLIMATE) {
    choices.push({ stage, preset: null });
    for (const preset of presetsOf(stage)) if (preset !== 'autoflower') choices.push({ stage, preset });
  }
  for (const stage of STAGES_WITH_CLIMATE) if (presetsOf(stage).includes('autoflower')) choices.push({ stage, preset: 'autoflower' });
  return choices;
})();

/**
 * The stages whose name alone does not say what they do to a place: germination
 * is dark - the device's germination mode, no light and no CO2 - and the
 * seedling stage the first climate with light. Wherever one is chosen it says
 * which, so "Keimung" means one thing on every screen.
 */
const NAMED_BY_LIGHT: readonly GrowthStage[] = ['germination', 'seedling'];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Keimung · dunkel", "Sämling · mit Licht", "Blüte": a stage as it is offered wherever one is chosen. */
export const stageChoiceName = (t: Translate, stage: GrowthStage): string =>
  t(NAMED_BY_LIGHT.includes(stage) ? `home.stageChoice.${stage}` : `home.stage.${stage}`);

/** "Keimung · dunkel", "Late flower", "Auto · Flower": what a climate is called wherever it is offered. */
export const climateChoiceName = (t: Translate, choice: ClimateChoice): string => {
  if (choice.preset === null) return stageChoiceName(t, choice.stage);
  const preset = t(`grow.presetName.${choice.preset}`, { defaultValue: choice.preset });
  return choice.preset === 'autoflower' ? `${preset} · ${t(`home.stage.${choice.stage}`)}` : preset;
};
