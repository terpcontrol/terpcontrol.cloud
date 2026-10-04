import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { HUMIDIFIER_REST_BAND } from './class-rules';
import { withFigures } from './configuration-fields';

/**
 * What the server keeps beside a germinating device, and what becomes of it
 * when germination ends.
 *
 * Germination writes over the night (`beforeGermination`), may rest a
 * humidifier by widening its band (`restedHumidityBand`), and goes by what the
 * grower chose about the humidity (`germinationChoices`). All three belong to
 * the one germination. Ended by the cloud - a preset, a phase, a plan step, the
 * operating mode, a targets save - `DeviceConfigurationService` puts the night
 * and the band back and lets them go. Ended on the device itself, from its own
 * menu, the document arrives at the ingest instead, and this is the same return
 * for it: otherwise the memory stayed behind and the next write from the cloud,
 * whatever it was about, wrote the night from before germination over whatever
 * the grower had set on the device since.
 */

/** The work modes germination is left for: the standard ones, the fridge's temperature mode, and drying. */
const LEFT_FOR = ['small', 'full', 'temp', 'dry'];

/** Those of them that hold a day and a night again, which get the night from before germination back. */
const WITH_A_NIGHT = ['small', 'full', 'temp'];

export interface GerminationMemory {
  beforeGermination?: Record<string, number> | null;
  restedHumidityBand?: number | null;
}

/** Whether a write takes a device out of germination: from `breed` to a mode that regulates otherwise. Switched off it still germinates. */
export const leavesGermination = (before: unknown, after: unknown): boolean =>
  before === 'breed' && typeof after === 'string' && LEFT_FOR.includes(after);

/**
 * A document a device sent from its own menu, with what germination kept put
 * back where the device has left it: the night from before germination where
 * the device holds a day and a night again, and the humidifier's band where it
 * was rested (the firmware's own where none was kept, by `heldTo`). Null where
 * the device has not left germination, and there is nothing to return or let go.
 */
export const leftAtDevice = (
  stored: DeviceConfiguration | null,
  reported: DeviceConfiguration,
  memory: GerminationMemory,
): DeviceConfiguration | null => {
  if (!leavesGermination(stored?.workmode, reported.workmode)) return null;

  const night = WITH_A_NIGHT.includes(reported.workmode as string) ? Object.entries(memory.beforeGermination ?? {}) : [];
  const returned = withFigures(reported, night);
  const daynight = returned.daynight;
  const band = memory.restedHumidityBand ?? null;
  if (band === null || !isSection(daynight) || daynight.targetHumidityDiff !== HUMIDIFIER_REST_BAND) return returned;

  return { ...returned, daynight: { ...daynight, targetHumidityDiff: band } };
};

/** What the server lets go of once germination has ended: the night it kept, the band it rested, and the grower's choices for it. */
export const GERMINATION_FORGOTTEN = { beforeGermination: null, restedHumidityBand: null, germinationChoices: null } as const;

const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
