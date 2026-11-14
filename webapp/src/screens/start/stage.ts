import { useState } from 'react';
import type { Device, GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useDevices } from '@/api/devices';
import { draftOf } from '@/screens/control/targets/targets-draft';
import { usePlaceClimate } from '@/screens/grow/phase-climate';
import { darkReasonOf, statesTargets } from '@/ui/climate-hardware';

/** The stages with a day and a night of their own, which a device's figures can be told apart by. */
const LIT: readonly GrowthStage[] = ['seedling', 'vegetative', 'flowering'];

/**
 * The stage a place is on, read off what its device runs. Nothing stores the
 * stage of a place without a grow - a climate preset leaves the device's
 * settings and nothing else - so the settings are what says it, and only where
 * they are a stage's own: the work mode for germination and drying, else the
 * stage whose climate the day's and the night's figures are. Figures somebody
 * moved say no stage: a factory-fresh controller's twelve hours of light are
 * no flowering.
 *
 * It is the answer a form opens on rather than a fact it states: "Was wächst
 * hier?" starts on it, so a tent just put on growth is not asked about seeds.
 * Null where no device here holds a climate or runs a stage's.
 */
export const stageOn = (device: Device | null): GrowthStage | null => {
  if (!device?.configuration || !statesTargets(device.configuration)) return null;
  const dark = darkReasonOf(device);
  if (dark === 'germination' || dark === 'drying') return dark;

  const set = draftOf(device.configuration);
  return (
    LIT.find(stage => {
      const row = climatePreset(stage, null);
      return (
        row !== null &&
        row.dayTemperature === set.dayTemperature &&
        row.nightTemperature === set.nightTemperature &&
        row.dayHumidity === set.dayHumidity &&
        row.nightHumidity === set.nightHumidity
      );
    }) ?? null
  );
};

/**
 * The same for a place by its id: read off the device a climate is written to
 * there (`usePlaceClimate`). Undefined until the place has answered - and a
 * device list from before this was asked, which is being read again, is not an
 * answer yet: a device claimed or set a moment ago is in the next. So a form
 * that opens on the stage opens on the same one on first arrival and after a
 * reload. Once answered, the stage follows the device without going back to
 * undefined.
 */
export const usePlaceStage = (spaceId: string | null): GrowthStage | null | undefined => {
  const devices = useDevices(spaceId !== null);
  const { controller, known } = usePlaceClimate(spaceId);
  const [answered, setAnswered] = useState(false);
  // Adjusted from what has just been rendered, which React re-runs the render for.
  if (!answered && devices.data && !(devices.isStale && devices.isFetching)) setAnswered(true);
  if (spaceId === null) return null;

  return answered && known ? stageOn(controller) : undefined;
};
