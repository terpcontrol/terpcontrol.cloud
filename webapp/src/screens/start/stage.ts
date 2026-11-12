import { useState } from 'react';
import type { Device, GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useDevices } from '@/api/devices';
import { darkReasonOf, statesTargets } from '@/ui/climate-hardware';
import { draftOf } from '@/screens/control/targets/targets-draft';

/** The stages with a day and a night of their own, which a device's figures can be told apart by. */
const LIT: readonly GrowthStage[] = ['seedling', 'vegetative', 'flowering'];

/** Up to how many hours of light a day is a flowering one: 12/12 with room for a grower's own hour more or less. */
const FLOWERING_HOURS = 14;

/**
 * The stage a place is on, read off what its device was last set to. Nothing
 * stores the stage of a place without a grow - a climate preset leaves the
 * device's settings and nothing else - so the settings are what says it: the
 * work mode for germination and drying, then the stage whose climate the
 * day's and the night's figures are, and for figures somebody has moved since
 * the length of the day, which is what tells flower from growth.
 *
 * It is the answer a form opens on rather than a fact it states: "Was wächst
 * hier?" starts on it, so a tent just put on growth is not asked about seeds.
 * Null where no device here holds a climate.
 */
export const stageOn = (device: Device | null): GrowthStage | null => {
  if (!device?.configuration || !statesTargets(device.configuration)) return null;
  const dark = darkReasonOf(device);
  if (dark === 'germination' || dark === 'drying') return dark;

  const set = draftOf(device.configuration);
  const exact = LIT.find(stage => {
    const row = climatePreset(stage, null);
    return (
      row !== null &&
      row.dayTemperature === set.dayTemperature &&
      row.nightTemperature === set.nightTemperature &&
      row.dayHumidity === set.dayHumidity &&
      row.nightHumidity === set.nightHumidity
    );
  });

  return exact ?? (set.lightHours <= FLOWERING_HOURS ? 'flowering' : 'vegetative');
};

/**
 * The same for a place by its id: the first device standing there that holds a
 * climate. Undefined until the devices have answered - and an answer from
 * before this was asked, which is being read again, is not one yet: a device
 * claimed or set a moment ago is in the next. So a form that opens on the
 * stage opens on the same one on first arrival and after a reload. Once
 * answered, the stage follows the device without going back to undefined.
 */
export const usePlaceStage = (spaceId: string | null): GrowthStage | null | undefined => {
  const devices = useDevices(spaceId !== null);
  const [answered, setAnswered] = useState(false);
  // Adjusted from what has just been rendered, which React re-runs the render for.
  if (!answered && devices.data && !(devices.isStale && devices.isFetching)) setAnswered(true);
  if (spaceId === null) return null;
  if (!answered || !devices.data) return undefined;
  const here = devices.data.items.filter(device => device.spaceId === spaceId && device.configuration && statesTargets(device.configuration));

  return stageOn(here.find(device => device.type !== 'fan') ?? here[0] ?? null);
};
