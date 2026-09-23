import type { i18n as I18n } from 'i18next';
import {
  Bell,
  Camera,
  Cpu,
  Droplet,
  Flag,
  Leaf,
  ListChecks,
  MoveRight,
  Package,
  Pencil,
  Ruler,
  Scissors,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type { Entry, EntryKind, GrowReadingNames, Person, ReadingName } from '@fg2/shared-types/v1';
import { entryHeadline } from '@/i18n/device-message';

/**
 * What the grow a line belongs to calls its measurements, out of the table an
 * answer carries for every grow it draws lines of.
 *
 * Keyed by the line's own grow rather than by the screen's: a tent holds the
 * diary of every grow that has stood in it, so the grow the bands are of is not
 * the grow each line was written in. A line of no grow, and one of a grow the
 * answer does not name, get no names - which is what leaves a reading showing
 * its key, exactly as it did before.
 */
export const readingNamesOf = (named: GrowReadingNames[], growId: string | null): ReadingName[] =>
  (growId === null ? undefined : named.find(one => one.growId === growId)?.readings) ?? [];

/** One mark per kind of line, so a diary row and a mark on the timeline's rail draw the same thing the same way. */
export const KIND_ICON: Record<EntryKind, LucideIcon> = {
  water: Droplet,
  feed: Leaf,
  photo: Camera,
  note: Pencil,
  measurement: Ruler,
  training: Scissors,
  phase: Flag,
  move: MoveRight,
  harvest: Package,
  visit: Timer,
  alarm: Bell,
  plan: ListChecks,
  system: Cpu,
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Who a line is by, in one word: "you", a handle, or what wrote it when nobody
 * did - a device, the plan, an alarm. Every entry carries its author and every
 * answer carries the people it names, so no lookup is needed here.
 */
export const authorOf = (t: Translate, entry: Pick<Entry, 'source' | 'authorId'>, people: Person[], userId: string | undefined): string => {
  if (entry.source !== 'human') return t(`home.author.${entry.source}`);
  if (entry.authorId === userId) return t('home.author.you');
  return people.find(person => person.id === entry.authorId)?.handle ?? t('home.author.someone');
};

/**
 * What a row says: a person's own words, a device's line translated, or the
 * kind of thing that was done.
 *
 * Two kinds carry what they were about in their values and say it here: a phase
 * names the stage that was entered, and a harvest names what came off the line.
 * The weights are the ones the server served, which are already null for a
 * reader they are hidden from, so a shared diary says a harvest happened
 * without saying how much it was.
 *
 * A phase says its stage whatever words arrived with it, rather than falling
 * back to them. A line migrated from the old app carries that app's heading for
 * the change - the same sentence for every stage, in English however the grower
 * writes - which says strictly less than the stage does; a phase set in the app
 * today carries no words at all. Anything somebody typed under the heading
 * follows the stage rather than replacing it.
 */
export const headlineOf = (t: Translate, i18n: I18n, entry: Entry): string => {
  if (entry.values.kind === 'phase') {
    const entered = t('home.card.enteredPhase', { stage: t(`home.stage.${entry.values.stage}`) });
    return entry.text ? `${entered} · ${entry.text}` : entered;
  }

  const translated = entryHeadline(i18n, entry);
  if (translated) return translated;

  if (entry.values.kind === 'harvest') {
    const { wetWeightG, dryWeightG } = entry.values;
    return [
      t('home.entryKind.harvest'),
      wetWeightG === null ? '' : t('grow.report.wet', { grams: readingFigure(wetWeightG) }),
      dryWeightG === null ? '' : t('grow.report.dry', { grams: readingFigure(dryWeightG) }),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return t(`home.entryKind.${entry.kind}`, { defaultValue: entry.kind });
};

/**
 * A measured value as a grower would write it.
 *
 * A reading is typed by a person, but a change between two of them is
 * subtraction, and binary floating point turns 1.92 − 0.06 into a number with
 * seventeen digits. Rounding to three decimals and dropping what that leaves
 * trailing keeps every reading anybody takes - a pH to two, an EC to two, a
 * height to none - and never shows the arithmetic.
 */
export const readingFigure = (value: number): string => String(Number(value.toFixed(3)));
