import type { Device, GerminationChoices, GrowthStage, PhaseCreate } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { statesTargets } from '@/ui/climate-hardware';
import { writesClimate } from '@/ui/presets';

/** What a phase does to the climate where its plants stand: nothing, or one climate of the one list. */
export interface PhaseClimate {
  /** Whether the controllers are put on the stage's climate as the phase is written. */
  climate: boolean;
  /** Which refinement of the stage, where one was chosen; null is the stage's own climate. */
  preset: string | null;
  /** What germination is to do about the humidity, where the sheet changed it; the device's own stands otherwise. */
  germination?: Partial<GerminationChoices>;
}

export const KEEP_CLIMATE: PhaseClimate = { climate: false, preset: null };

/**
 * What the request says about it: nothing at all where the climate is kept, so
 * an older server reads it the same way. The choices of germination go with
 * its climate alone, which is the one that puts a device into germination.
 */
export const climateRequest = (pick: PhaseClimate, stage: GrowthStage): Pick<PhaseCreate, 'preset' | 'climate' | 'germinationChoices'> => {
  if (!pick.climate) return { preset: null };
  const choices = stage === 'germination' && pick.germination && Object.keys(pick.germination).length > 0 ? pick.germination : null;
  return { preset: pick.preset, climate: true, ...(choices ? { germinationChoices: choices } : {}) };
};

/** The device standing in a place that holds targets a climate could be written to, or null. */
export const usePlaceController = (spaceId: string | null): Device | null => {
  const devices = useDevices();
  return spaceId === null
    ? null
    : (devices.data?.items.find(device => device.spaceId === spaceId && device.configuration && statesTargets(device.configuration)) ?? null);
};

/** Whether a device germinates in the dark now. */
export const germinates = (device: Device | null): boolean =>
  Boolean(device?.control?.running && !device.control.drying && device.control.mode === 'germination');

/**
 * What a phase sheet starts on: the targets as they are - nothing is chosen for
 * the grower - except where the device germinates and the stage is another
 * with a climate. The light comes back with that stage, and its own climate is
 * the one it is owed.
 */
export const defaultPick = (stage: GrowthStage, controller: Device | null): PhaseClimate =>
  stage !== 'germination' && writesClimate(stage) && germinates(controller) ? { climate: true, preset: null } : KEEP_CLIMATE;
