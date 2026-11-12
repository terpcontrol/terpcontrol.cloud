import { DateTime } from 'luxon';
import type { Entry, GrowDayEvent, GrowDiaryDay, GrowDiaryWeek, GrowListItem, Metric } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { spanLabel } from '@/ui/age';
import { foldRepeats } from '@/ui/entries';
import { decimalFigure } from '@/ui/figures';
import { stageLabel } from '@/ui/presets';
import { DAY_IN_YEAR, WEEKDAY_DAY } from '@/ui/zone';

/**
 * What a day of the diary says, worked out from what the server answered
 * about it. Nothing here counts a grow's days or judges a climate - the
 * server did - it only puts the answer into the words and the order a card
 * draws.
 */

/** How many of the newest days stand open as cards; the days before them fold into their weeks. */
export const OPEN_DAYS = 3;

/** How many lines a card draws before the rest is asked for. */
export const LINES_SHOWN = 4;

/** How long a weekday names one day: six dates back it is still its own, a week back it is today's again. */
const WEEKDAY_DAYS = 6;

/** "Heute · Tag 29", "Gestern · Tag 28", "Montag · Tag 27", and the date once a weekday would name two days. */
export const dayTitle = (t: Translate, day: Pick<GrowDiaryDay, 'date' | 'dayNumber'>, today: string): string => {
  const date = DateTime.fromISO(day.date);
  const back = Math.round(DateTime.fromISO(today).diff(date, 'days').days);
  const named =
    back === 0
      ? t('grow.diary.today')
      : back === 1
        ? t('grow.diary.yesterday')
        : date.toFormat(back > 0 && back <= WEEKDAY_DAYS ? 'cccc' : WEEKDAY_DAY);

  return `${named} · ${t('home.card.dayN', { day: day.dayNumber })}`;
};

/** "Ø 25,3 °C · 57 %": the day's means, each only where it was measured. */
export const climateLine = (day: Pick<GrowDiaryDay, 'climate'>): string | null => {
  const said = [
    day.climate?.temperature != null ? `${decimalFigure(day.climate.temperature, 1)} °C` : null,
    day.climate?.humidity != null ? `${decimalFigure(day.climate.humidity, 0)} %` : null,
  ].filter(Boolean);

  return said.length > 0 ? `Ø ${said.join(' · ')}` : null;
};

/** The share of the day inside the targets as a whole percentage, and whether that is a day to be content with. */
export const shareOf = (day: Pick<GrowDiaryDay, 'climate'>): { percent: number; good: boolean } | null => {
  const fraction = day.climate?.inBandFraction ?? null;
  // The line the place's own verdict turns from "watch" to "poor" at.
  return fraction === null ? null : { percent: Math.round(fraction * 100), good: fraction > 0.8 };
};

/** "Blüte, Woche 2", or nothing before the first phase. */
export const stageOfWeek = (t: Translate, week: Pick<GrowDiaryWeek, 'stage' | 'preset' | 'stageWeek'>): string | null =>
  week.stage
    ? [stageLabel(t, week.stage, week.preset), week.stageWeek !== null ? t('grow.week', { week: week.stageWeek }) : null].filter(Boolean).join(', ')
    : null;

/** One thing a day's card says happened: a line somebody or something wrote, or what a device did unasked. */
export type DayLine =
  | { key: string; at: string; byItself: boolean; entry: Entry; count: number; since: string }
  | { key: string; at: string; byItself: true; event: GrowDayEvent; words: string; metric: Metric | null };

/**
 * The lines of a day, newest first: the entries - a run of the same machine
 * line and an alarm that fired over and over counted rather than stacked -
 * the lamp's switchings, and the stretches outside the targets, several of
 * one reading on one side said as one line. So a climate that swung all night
 * is a sentence and not a column, and what a person wrote stays in sight.
 */
export const dayLines = (t: Translate, day: GrowDiaryDay): DayLine[] => {
  const written: DayLine[] = [...oftenFired(day.entries), ...foldRepeats(day.entries.filter(entry => !firedOften(day.entries, entry)))].map(
    ({ entry, count, since }) => ({ key: entry.id, at: entry.occurredAt, byItself: entry.source !== 'human', entry, count, since }),
  );
  const lamp: DayLine[] = day.events.flatMap(event =>
    event.kind === 'light'
      ? [
          {
            key: `light-${event.at}`,
            at: event.at,
            byItself: true as const,
            event,
            words: t(event.on ? 'grow.diary.lightOn' : 'grow.diary.lightOff'),
            metric: null,
          },
        ]
      : [],
  );
  const excursions = day.events.filter(event => event.kind === 'excursion');
  const outside: DayLine[] = [...new Set(excursions.map(event => `${event.metric}-${event.above}`))].map(side => {
    const runs = excursions.filter(event => `${event.metric}-${event.above}` === side);
    const [first] = runs;
    const seconds = runs.reduce((sum, run) => sum + (Date.parse(run.endedAt ?? day.endsAt) - Date.parse(run.at)) / 1000, 0);
    const said = { metric: t(`home.metric.${first.metric}`), span: spanLabel(seconds), count: runs.length };

    return {
      key: `outside-${side}`,
      at: first.at,
      byItself: true as const,
      event: first,
      words: t(`grow.diary.${first.above ? 'above' : 'below'}${runs.length > 1 ? 'Often' : ''}`, said),
      metric: first.metric,
    };
  });

  return [...written, ...lamp, ...outside].sort((one, other) => other.at.localeCompare(one.at));
};

/** The rule an alarm's line is of, as the line names it; null for any other line. */
const ruleOf = (entry: Entry): string | null =>
  entry.kind === 'alarm' && entry.message ? (entry.message.params[0]?.split(', value=')[0] ?? null) : null;

const FIRED = 'message-alarm-triggered';

/** The lines of the day that say one rule fired, newest first. */
const firingsOf = (entries: Entry[], rule: string): Entry[] => entries.filter(entry => entry.message?.key === FIRED && ruleOf(entry) === rule);

/** Whether a line belongs to a rule that fired more than once that day, which is then said in one line. */
const firedOften = (entries: Entry[], entry: Entry): boolean => {
  const rule = ruleOf(entry);
  return rule !== null && firingsOf(entries, rule).length > 1;
};

/**
 * An alarm that fired again and again in one day - a reading hovering at its
 * threshold fires and clears a hundred times a night - as one line per rule:
 * its newest firing, how often it fired and since when. One firing keeps its
 * two lines, fired and cleared, which say when it began and when it was over.
 */
const oftenFired = (entries: Entry[]): { entry: Entry; count: number; since: string }[] =>
  [...new Set(entries.flatMap(entry => ruleOf(entry) ?? []))].flatMap(rule => {
    const firings = firingsOf(entries, rule);
    return firings.length > 1 ? [{ entry: firings[0], count: firings.length, since: firings[firings.length - 1].occurredAt }] : [];
  });

/** Whether a day has anything to show: a picture, a climate, or a line. */
export const hasSomething = (day: GrowDiaryDay): boolean =>
  day.still !== null || day.climate !== null || day.events.length > 0 || day.entries.length > 0;

/** One picture of a grow: the camera's of a day, or one somebody wrote into the diary. */
export interface GrowPicture {
  mediaId: string;
  takenAt: string;
  dayNumber: number;
  date: string;
  /** The camera that took it; null for a photo. */
  cameraId: string | null;
  /** The line it hangs on; null for the camera's own. */
  entry: Entry | null;
}

/** The pictures one line of a day carries, as the viewer steps through them. */
export const picturesOfLine = (day: Pick<GrowDiaryDay, 'dayNumber' | 'date'>, entry: Entry): GrowPicture[] =>
  entry.mediaIds.map(mediaId => ({ mediaId, takenAt: entry.occurredAt, dayNumber: day.dayNumber, date: day.date, cameraId: entry.cameraId, entry }));

/**
 * The pictures of one day, newest first: the camera's picture of the day and
 * what the lines of that day carry. A still somebody made a line of is one
 * picture, and is the line's.
 */
export const picturesOfDay = (day: GrowDiaryDay): GrowPicture[] => {
  const written = day.entries.flatMap(entry => picturesOfLine(day, entry));
  const camera =
    day.still && !written.some(picture => picture.mediaId === day.still!.mediaId)
      ? [
          {
            mediaId: day.still.mediaId,
            takenAt: day.still.capturedAt,
            dayNumber: day.dayNumber,
            date: day.date,
            cameraId: day.still.cameraId,
            entry: null,
          },
        ]
      : [];

  return [...camera, ...written].sort((one, other) => other.takenAt.localeCompare(one.takenAt));
};

/** The picture a day's card is headed by: the camera's, else the first photo written that day. */
export const headPicture = (day: GrowDiaryDay): GrowPicture | null => {
  const pictures = picturesOfDay(day);
  return pictures.find(picture => picture.entry === null) ?? pictures.at(-1) ?? null;
};

/** How many lines of these days people wrote, which is what "Einträge" counts: not the machines' own. */
export const writtenIn = (days: GrowDiaryDay[]): number =>
  days.reduce((sum, day) => sum + day.entries.filter(entry => entry.source === 'human').length, 0);

/** Where the grow stood at an instant, for a line that leads to the curve of that moment; null where it stood in no place. */
export const placeAt = (grow: Pick<GrowListItem, 'placements'>, at: string): string | null =>
  grow.placements.find(placement => placement.startedAt <= at && (placement.endedAt === null || placement.endedAt > at))?.spaceId ?? null;

/** A week that has its film. */
export type FilmedWeek = GrowDiaryWeek & { film: NonNullable<GrowDiaryWeek['film']> };

export const hasFilm = (week: GrowDiaryWeek): week is FilmedWeek => week.film !== null;

/** "Tag 28 · 11. Nov · Dein Foto · Erste Blüten": which day, which date, whose picture, and what was written with it. */
export const pictureCaption = (t: Translate, picture: GrowPicture, userId: string | null): string =>
  [
    t('home.card.dayN', { day: picture.dayNumber }),
    DateTime.fromISO(picture.date).toFormat(DAY_IN_YEAR),
    sourceOf(t, picture, userId),
    picture.entry?.text,
  ]
    .filter(Boolean)
    .join(' · ');

/** Whose picture it is: the camera's, the reader's own, or one somebody else wrote into the diary. */
export const sourceOf = (t: Translate, picture: GrowPicture, userId: string | null): string =>
  picture.entry === null
    ? t('grow.pictures.camera')
    : t(picture.entry.authorId !== null && picture.entry.authorId === userId ? 'grow.pictures.yours' : 'grow.pictures.photo');
