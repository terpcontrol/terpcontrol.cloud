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
import type { Entry, EntryKind, GrowListItem, GrowReadingNames, GrowWeekCard, Person, ReadingName } from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf } from '@fg2/shared-types/v1-schemas/feeding.js';
import { looseFigure } from '@/ui/figures';
import { entryHeadline, machineLineParts } from '@/i18n/device-message';

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

/**
 * The kinds a diary is made of: every kind but the two a machine keeps for
 * itself. It is the same list the server calls `DIARY_KINDS` and counts a week
 * card's lines by, so a screen that asks for the rest of a week's diary asks for
 * exactly what the card said there was more of. Taken from the icons rather than
 * written out again, because that map is over every kind of the contract and a
 * kind added to it cannot be forgotten here.
 */
export const DIARY_KINDS: EntryKind[] = (Object.keys(KIND_ICON) as EntryKind[]).filter(kind => kind !== 'system' && kind !== 'plan');

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Who a line is by, in one word: "you", a handle, or what wrote it when nobody
 * did - a device, the plan, an alarm. Every entry carries its author and every
 * answer carries the people it names, so no lookup is needed here.
 *
 * The author is asked first and the source only after it, because a line the
 * plan engine wrote is not the same as a line the plan engine wrote because
 * somebody pressed a button. A transition carries the person who made it all the
 * way to the entry, and reading the source alone bylined the "Plan started" of
 * somebody pressing Start as "auto".
 * The engine's own moves are exactly the lines that carry no author, which is
 * what "auto" is drawn from: the word means nobody picked this, and where the
 * store knows who did, it says so.
 */
export const authorOf = (t: Translate, entry: Pick<Entry, 'source' | 'authorId'>, people: Person[], userId: string | undefined): string => {
  if (entry.source !== 'human' && entry.authorId === null) return t(`home.author.${entry.source}`);
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
 *
 * A machine's phase line is the one row that reaches its words without going
 * through `entryHeadline`, so it takes the same first paragraph that does: the
 * rest of such a line is drawn under the row as its detail, and putting the
 * whole of it here would print that paragraph twice.
 */
export const headlineOf = (t: Translate, i18n: I18n, entry: Entry): string => {
  if (entry.values.kind === 'phase') {
    const entered = t('home.card.enteredPhase', { stage: t(`home.stage.${entry.values.stage}`) });
    const said = machineLineParts(entry)?.headline ?? entry.text;
    return said ? `${entered} · ${said}` : entered;
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
export const readingFigure = (value: number): string => looseFigure(value);

/** Twenty-four hours, which is how long one of the grow's days is wherever it begins. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which of the grow's own days a line falls on, counted from the grow's origin
 * with the contract's own arithmetic - the same the server's week calendar
 * counts by, so a row and the card around it cannot drift apart.
 *
 * Null before the first phase: a grow that has not begun has no day 1 to count
 * from, and a line written against it is dated and nothing more.
 */
export const growDayOf = (grow: GrowListItem, occurredAt: string): number | null =>
  grow.summary.dayNumber === null ? null : growDayAt(growOriginOf(grow), occurredAt);

/**
 * The same figure where only a week card is at hand, which is all a public
 * diary is answered: a card begins on a day boundary of the grow and its seven
 * days are the grow's own, so the day is a subtraction. Clamped to the card,
 * because a line is only ever drawn on the card whose week it falls in.
 */
export const weekDayOf = (week: Pick<GrowWeekCard, 'dayFrom' | 'dayTo' | 'startsAt'>, occurredAt: string): number =>
  Math.min(week.dayTo, Math.max(week.dayFrom, week.dayFrom + Math.floor((Date.parse(occurredAt) - Date.parse(week.startsAt)) / DAY_MS)));

/** A line and how many identical machine lines just before it were folded into it. */
export interface FoldedEntry {
  entry: Entry;
  /** How many lines this one stands for, itself included. */
  count: number;
  /** When the oldest of them was written; the entry's own instant where it stands alone. */
  since: string;
}

/**
 * Runs of identical machine lines folded into one, newest first.
 *
 * A camera that times out writes "Picture not taken" and its advice every few
 * minutes, and a tent's latest lines were three or six of those one above the
 * other, pushing everything else off the list. A device's, the plan's or an
 * alarm's line that says exactly what the one before it said - same source,
 * same device, same key and parameters, no pictures - is the same thing
 * happening again, so it is counted rather than drawn again. What a person
 * wrote is never folded: two waterings are two waterings.
 */
export const foldRepeats = (entries: Entry[]): FoldedEntry[] => {
  const folded: FoldedEntry[] = [];

  for (const entry of entries) {
    const last = folded.at(-1);
    if (last && sameMachineLine(last.entry, entry)) {
      last.count += 1;
      last.since = entry.occurredAt;
    } else {
      folded.push({ entry, count: 1, since: entry.occurredAt });
    }
  }

  return folded;
};

const sameMachineLine = (one: Entry, other: Entry): boolean =>
  one.source !== 'human' &&
  one.source === other.source &&
  one.kind === other.kind &&
  one.deviceId === other.deviceId &&
  one.cameraId === other.cameraId &&
  one.mediaIds.length === 0 &&
  other.mediaIds.length === 0 &&
  (one.text ?? null) === (other.text ?? null) &&
  JSON.stringify(one.message ?? null) === JSON.stringify(other.message ?? null);
