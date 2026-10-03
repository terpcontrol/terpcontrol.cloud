import type { Device, GrowthStage } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { statesTargets } from '@/ui/climate-hardware';
import { writesClimate } from '@/ui/presets';

/** What a phase does to the climate where its plants stand: nothing, or one climate of the one list. */
export interface PhaseClimate {
  /** Whether the controllers are put on the stage's climate as the phase is written. */
  climate: boolean;
  /** Which refinement of the stage, where one was chosen; null is the stage's own climate. */
  preset: string | null;
}

export const KEEP_CLIMATE: PhaseClimate = { climate: false, preset: null };

/** What the request says about it: nothing at all where the climate is kept, so an older server reads it the same way. */
export const climateRequest = (pick: PhaseClimate): { preset: string | null; climate?: true } =>
  pick.climate ? { preset: pick.preset, climate: true } : { preset: null };

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
