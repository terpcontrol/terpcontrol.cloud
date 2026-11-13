import type { GerminationChoices, GrowthStage, PhaseTargets } from '@fg2/shared-types/v1';

/**
 * Putting the controllers of a space on the climate a stage's preset asks for.
 *
 * The preset table and the write itself belong to the space slice, which serves
 * `POST /spaces/{id}/preset-applications` and reaches a device through the
 * protocol module. A grow needs two things back: whether a controller really
 * was put on the preset, which is what the alarms of the stage then follow, and
 * what it now runs, which the phase snapshots so a past phase can still draw
 * its target band.
 *
 * Optional, like every port between two slices here: until something is bound to
 * this token the phase is still written - by hand rather than by a preset - and
 * the tent's climate stays as it was.
 */
export interface AppliedPreset {
  deviceId: string;
  /** What the controller runs now, for the phase to snapshot. */
  targets: PhaseTargets | null;
}

export interface ClimatePresets {
  /**
   * Writes the preset to every controller standing in the space, and answers
   * the ones it reached. `choices` is what germination does about the humidity
   * there, read with the germination stage alone.
   */
  applyToSpace(spaceId: string, stage: GrowthStage, preset: string | null, choices?: Partial<GerminationChoices>): Promise<AppliedPreset[]>;
}

export const CLIMATE_PRESETS = Symbol('ClimatePresets');
