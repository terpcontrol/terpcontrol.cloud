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
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Entry, EntryKind, GrowListItem, GrowReadingNames, Person, ReadingName } from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf } from '@fg2/shared-types/v1-schemas/feeding.js';
import type { Translate } from '@/i18n/i18n';
import { looseFigure } from '@/ui/figures';
import { entryHeadline, machineLineParts } from '@/i18n/device-message';

/**
 * What the grow a line belongs to calls its measurements, keyed by the line's
 * own grow: a tent's diary holds lines of every grow that stood in it. A line of
 * no grow, or of a grow the answer does not name, gets no names and shows its key.
 */
export const readingNamesOf = (named: GrowReadingNames[], growId: string | null): ReadingName[] =>
  (growId === null ? undefined : named.find(one => one.growId === growId)?.readings) ?? [];

/**
 * The readings the app writes itself rather than a grow's own measurements:
 * the two weights of a CO2 cylinder, written into a place's diary when one goes
 * in. A grow that defines them - every grow carried over from the old app does -
 * names them its own way; anywhere else they are named here, not by their key.
 */
const OWN_READINGS: Readonly<Record<string, string>> = { co2FillingInitial: 'g', co2FillingRest: 'g' };

export const ownReading = (t: (key: string) => string, key: string): ReadingName | undefined =>
  key in OWN_READINGS ? { key, name: t(`ownReading.${key}`), unit: OWN_READINGS[key] } : undefined;

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
  visit: Wrench,
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

/**
 * Who a line is by, in one word: "you", a handle, or what wrote it when nobody
 * did - a device, the plan, an alarm. The author is asked before the source,
 * because a plan move somebody pressed carries that person; "auto" is a line
 * with no author.
 */
export const authorOf = (t: Translate, entry: Pick<Entry, 'source' | 'authorId'>, people: Person[], userId: string | undefined): string => {
  if (entry.source !== 'human' && entry.authorId === null) return t(`home.author.${entry.source}`);
  if (entry.authorId === userId) return t('home.author.you');
  return people.find(person => person.id === entry.authorId)?.handle ?? t('home.author.someone');
};

/**
 * What a row says: a person's own words, a device's line translated, or the kind
 * of thing done. A phase names its stage before any heading it came with, and a
 * harvest the weights the server served (null where they are hidden). A machine's
 * phase line takes only `entryHeadline`'s first paragraph; the rest is the detail.
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
      wetWeightG === null ? '' : t('grow.report.wet', { grams: looseFigure(wetWeightG) }),
      dryWeightG === null ? '' : t('grow.report.dry', { grams: looseFigure(dryWeightG) }),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return t(`home.entryKind.${entry.kind}`, { defaultValue: entry.kind });
};

/**
 * What a person did, as the rest of a sentence their name opens - "you stepped
 * in", "du bist reingegangen" - for a row that would otherwise say only its kind,
 * whose label is a heading. German conjugates for "du", so one's own line has its
 * own form.
 */
export const doneByOf = (t: Translate, i18n: I18n, entry: Entry, byYou: boolean): string | null => {
  if (entry.source !== 'human' || entry.values.kind === 'phase' || entry.values.kind === 'harvest' || entryHeadline(i18n, entry)) return null;

  // A camera's still somebody made a line of was kept, not taken: nobody held a phone up.
  const done = entry.kind === 'photo' && entry.cameraId !== null ? 'still' : entry.kind;
  return t(`home.entryDone.${done}`, { context: byYou ? 'you' : undefined, defaultValue: '' }) || null;
};

/**
 * How much, for a line that poured something: the water, and for a feed the
 * week of the scheme its doses came from - "1,5 l", "5 l · Schema-Woche 5".
 * Null for a line that recorded neither.
 */
export const amountOf = (t: Translate, entry: Entry): string | null => {
  if (entry.values.kind !== 'water' && entry.values.kind !== 'feed') return null;
  // A line carried over from the old app may hold neither field at all.
  const litres = entry.values.litres ?? null;
  const week = entry.values.kind === 'feed' ? (entry.values.schemeWeek ?? null) : null;
  const said = [
    litres !== null ? t('log.litres', { litres: looseFigure(litres) }) : null,
    week !== null ? t('home.entrySchemeWeek', { week }) : null,
  ].filter(Boolean);

  return said.length > 0 ? said.join(' · ') : null;
};

/**
 * Which of the grow's own days a line falls on, counted from the grow's origin
 * with the contract's own arithmetic - the same the server's week calendar
 * counts by, so a row and the card around it cannot drift apart.
 *
 * Null before the first phase: a grow that has not begun has no day 1 to count
 * from, and a line written against it is dated and nothing more.
 */
export const growDayOf = (grow: GrowListItem, occurredAt: string): number | null =>
  grow.summary.dayNumber === null ? null : growDayAt(growOriginOf(grow), occurredAt, grow.summary.zone);

/**
 * Whether a line of a summary is drawn as a warning, and how grave: amber is
 * for what needs a person, which is an alarm that was raised - a connection
 * lost, a reading past its rule. That an alarm is over, a restart, a step of
 * the plan and maintenance going on and off are things that happened, and
 * stand as plain lines whatever severity the device sent them with.
 */
export const warningOf = (entry: Pick<Entry, 'kind' | 'severity'>): Entry['severity'] =>
  entry.kind === 'alarm' && entry.severity !== 'info' ? entry.severity : null;

/** A line and how many identical machine lines just before it were folded into it. */
interface FoldedEntry {
  entry: Entry;
  /** How many lines this one stands for, itself included. */
  count: number;
  /** When the oldest of them was written; the entry's own instant where it stands alone. */
  since: string;
}

/**
 * Runs of identical machine lines folded into one, newest first: a device's, the
 * plan's or an alarm's line that repeats the one before it (same source, device,
 * key and parameters, no pictures) is counted rather than drawn again. What a
 * person wrote is never folded.
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
