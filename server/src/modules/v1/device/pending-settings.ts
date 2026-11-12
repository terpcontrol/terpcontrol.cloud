import type { PendingSetting } from '@fg2/shared-types/v1';
import { valueAt } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { cycleOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { GERMINATION_CHOICES, changeOf, figureOf, figureSaid } from '@modules/device-protocol/change-lines';
import { targetsOf } from '../phase/phase-targets';
import type { RecordedClimate } from './held-targets';

/**
 * What a device that fell silent has not been handed.
 *
 * A save is stored at once and published once. A device that was not listening
 * is answered the stored document when it next connects, and it acknowledges
 * nothing either way. So the one thing known is when it was last heard: what
 * it holds is what the cloud had stored by then, and whatever was stored after
 * is still to reach it.
 *
 * What stood then is read from what is kept anyway. The target record
 * (`target-record.ts`) says it for the targets and the cycle, whoever moved
 * them - a person, a plan step, a preset, the clocks changing. Any other
 * figure of the document is known only from the diary lines of the saves
 * people made since (`change-lines.ts`): the first to name it says what it was
 * before. A figure something else moved meanwhile is therefore not known.
 */

type Said = Pick<RecordedClimate, 'targets' | 'cycle'>;

/**
 * What a row of the record says of each setting it keeps. Undefined where it
 * says nothing of one: hardware that keeps no cycle, and a row written before
 * cycles were recorded.
 */
const RECORDED: Readonly<Record<string, (said: Said) => number | string | null | undefined>> = {
  'day.temperature': said => said.targets?.day.temperature ?? null,
  'day.humidity': said => said.targets?.day.humidity ?? null,
  'night.temperature': said => said.targets?.night.temperature ?? null,
  'night.humidity': said => said.targets?.night.humidity ?? null,
  'co2.target': said => said.targets?.co2 ?? null,
  'daynight.day': said => said.cycle?.day,
  'daynight.night': said => said.cycle?.night,
  workmode: said => said.cycle?.workmode,
  'lights.sunrise': said => said.cycle?.sunrise,
  'lights.sunset': said => said.cycle?.sunset,
};

/** The lines of one save's diary entry, and when it was written (epoch milliseconds). */
export interface SavedChange {
  at: number;
  lines: readonly string[];
}

/**
 * The settings stored since `heard` that differ from what the device held
 * then, by field. `record` is the row standing at `heard` and the rows after
 * it, `saves` the diary lines of the saves since, both oldest first.
 */
export const pendingSettingsOf = (
  heard: number,
  device: { type: string; configuration?: Record<string, unknown> | null },
  record: readonly RecordedClimate[],
  saves: readonly SavedChange[],
): PendingSetting[] => {
  const standing = record.filter(row => row.at <= heard).at(-1);
  const rows = [...(standing ? [standing] : []), ...record.filter(row => row.at > heard)];
  // The document as the record would write it down now, so a time the firmware
  // defaults reads the same on both sides.
  const now: Said = { targets: targetsOf(device.configuration), cycle: cycleOf(device.type, device.configuration) };
  const pending: PendingSetting[] = [];
  const recorded = new Set<string>();

  for (const [field, read] of Object.entries(RECORDED)) {
    const held = standing && read(standing);
    if (held === undefined) continue;
    recorded.add(field);

    const savedAt = rows.reduce<number | null>((last, row, index) => (index > 0 && read(row) !== read(rows[index - 1]) ? row.at : last), null);
    if (savedAt !== null && read(now) !== held) pending.push({ field, held, savedAt: new Date(savedAt).toISOString() });
  }

  const said = new Map<string, { held: string; savedAt: number }>();
  for (const save of saves.filter(one => one.at > heard)) {
    for (const change of save.lines.flatMap(line => changeOf(line) ?? [])) {
      // A light window is named whole when one of its times moved: the other is
      // written as itself on both sides and is no change.
      if (change.before === change.after || recorded.has(change.path) || change.path.startsWith(`${GERMINATION_CHOICES}.`)) continue;
      said.set(change.path, { held: said.get(change.path)?.held ?? change.before, savedAt: save.at });
    }
  }
  for (const [field, { held, savedAt }] of said) {
    if (figureOf(valueAt(device.configuration, field)) !== held) {
      pending.push({ field, held: figureSaid(held), savedAt: new Date(savedAt).toISOString() });
    }
  }

  return pending.sort((one, other) => (one.field < other.field ? -1 : 1));
};
