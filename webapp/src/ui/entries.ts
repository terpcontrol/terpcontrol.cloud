import type { i18n as I18n } from 'i18next';
import type { Entry, Person } from '@fg2/shared-types/v1';
import { entryHeadline } from '@/i18n/device-message';

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

/** What a row says: a person's own words, a device's line translated, or the kind of thing that was done. */
export const headlineOf = (t: Translate, i18n: I18n, entry: Entry): string =>
  entryHeadline(i18n, entry) ||
  (entry.values.kind === 'phase'
    ? t('home.card.enteredPhase', { stage: t(`home.stage.${entry.values.stage}`) })
    : t(`home.entryKind.${entry.kind}`, { defaultValue: entry.kind }));

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
