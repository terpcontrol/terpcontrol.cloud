import { DateTime } from 'luxon';
import type { Entry, GrowDiaryDay, GrowDiaryWeek, GrowListItem, Metric, ReadingName } from '@fg2/shared-types/v1';
import type { i18n as I18n } from 'i18next';
import { alarmLineParts } from '@/i18n/alarm-line';
import type { Translate } from '@/i18n/i18n';
import { spanLabel } from '@/ui/age';
import { foldRepeats } from '@/ui/entries';
import { decimalFigure } from '@/ui/figures';
import { deviceName } from '@/ui/naming';
import { stageLabel } from '@/ui/presets';
import { DAY_IN_YEAR, WEEKDAY_DAY, clock } from '@/ui/zone';

/**
 * What a day of the diary says, worked out from what the server answered
 * about it. Nothing here counts a grow's days or judges a climate - the
 * server did - it only puts the answer into the words and the order a card
 * draws.
 */

/**
 * Who reads a diary, and what the diary gives them the way to. The grow's own
 * page hands a member the sheet that corrects a line and the curve of a
 * moment; a page anybody may open hands out neither.
 */
export interface DiaryReader {
  /** The zone the hours of the day are said in. */
  zone: string | null;
  /** What the grow calls its measurements. */
  readingNames: ReadingName[];
  /** Where a picture is fetched from; null where this reader has no way to it. */
  picture: (mediaId: string, width?: number) => string | null;
  /** Whether the day still running leads to its camera. */
  cameras: boolean;
  /** Whether a line says who wrote it: not where the reader is answered no authors - a page anybody may open, the demo. */
  byline: boolean;
  /** The sheet that corrects a line, where this reader may correct it. */
  correct: (entry: Entry, dayNumber: number | null) => (() => void) | undefined;
  /** The curve of a reading at a moment of the diary, where the reader has one to open. */
  curveOf: (metric: Metric | null, at: string) => string | null;
  /** The curves of one whole day, which its climate line leads to. */
  curvesOf: (day: Pick<GrowDiaryDay, 'startsAt' | 'endsAt'>) => string | null;
}

/** How many of the newest days stand open as cards; the days before them fold into their weeks. */
export const OPEN_DAYS = 3;

/** How long a weekday names one day: six dates back it is still its own, a week back it is today's again. */
const WEEKDAY_DAYS = 6;

/** "Heute · Tag 29", "Gestern · Tag 28", "Montag · Tag 27", and the date once a weekday would name two days. */
export const dayTitle = (t: Translate, day: Pick<GrowDiaryDay, 'date' | 'dayNumber'>, today: string | null): string => {
  const date = DateTime.fromISO(day.date);
  // A diary read from outside, or one that has ended, has no today to count back from: its days are dates.
  const back = today === null ? null : Math.round(DateTime.fromISO(today).diff(date, 'days').days);
  const named =
    back === 0
      ? t('grow.diary.today')
      : back === 1
        ? t('grow.diary.yesterday')
        : date.toFormat(back !== null && back > 0 && back <= WEEKDAY_DAYS ? 'cccc' : WEEKDAY_DAY);

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

/** One thing a day's card says happened. */
export interface DayLine {
  key: string;
  at: string;
  /** Somebody did it - wrote it, or switched maintenance: it is never folded behind what a device did by itself. */
  own: boolean;
  /** What a device does every day, its lamp, which gives its room to what is out of the ordinary. */
  routine: boolean;
  what:
    | { kind: 'entry'; entry: Entry; count: number; since: string }
    /** An alarm, named by its rule: how often it fired that day, and the reading and the edge it crossed. */
    | { kind: 'alarm'; entry: Entry; rule: string; count: number; since: string; limit: string | null; over: boolean }
    /**
     * Something worked out from the record: the lamp, a stretch outside the targets (`metric`), maintenance, another
     * device measuring. `moment` says the line leads to the curves of its moment where it names no reading of its own.
     */
    | { kind: 'said'; words: string; metric: Metric | null; moment?: true };
}

/**
 * The lines of a day, newest first.
 *
 * What people did stands as they wrote it, and maintenance somebody switched
 * as one line for on and off together. What the devices did by themselves is
 * said once each: the lamp as the hours it burned, a reading outside its
 * targets as one line however often it left them, an alarm as its rule with
 * how often it fired - a reading hovering at its threshold fires and clears a
 * hundred times a night. So a climate that swung all night is a sentence and
 * not a column. A controller replaced by another is one line at the moment the
 * new one came.
 */
export const dayLines = (t: Translate, i18n: I18n, day: Pick<GrowDiaryDay, 'entries' | 'events' | 'endsAt'>, zone: string | null): DayLine[] => {
  const alarms = alarmLines(i18n, day.entries);
  const written = foldRepeats(day.entries.filter(entry => !alarms.told.has(entry.id))).map(({ entry, count, since }) =>
    writtenLine(entry, count, since),
  );
  const said = (key: string, at: string, words: string, over: Partial<DayLine> = {}, metric: Metric | null = null, moment = false): DayLine => ({
    key,
    at,
    own: false,
    routine: false,
    ...over,
    what: { kind: 'said', words, metric, ...(moment ? { moment: true as const } : {}) },
  });

  const maintenance = day.events.flatMap(event =>
    event.kind === 'maintenance'
      ? [
          said(
            `maintenance-${event.at}`,
            event.at,
            event.endedAt
              ? t('grow.diary.maintenance', { span: spanLabel((Date.parse(event.endedAt) - Date.parse(event.at)) / 1000) })
              : t('grow.diary.maintenanceOn'),
            { own: true },
          ),
        ]
      : [],
  );

  // The lamp's day as one line that says only what happened: the stretch it burned, a switching without its other
  // end as that switching, and a lamp that came on last as on since then - only where it is known to be lit still.
  const lights = day.events.filter(event => event.kind === 'light');
  const off = lights.find(event => !event.on);
  const on = off ? lights.find(event => event.on && event.at < off.at) : undefined;
  const open = lights[lights.length - 1]?.on ? lights[lights.length - 1] : undefined;
  const closed =
    on && off
      ? t('grow.diary.light', { from: clock(on.at, zone), to: clock(off.at, zone) })
      : off
        ? t('grow.diary.lightOffAt', { at: clock(off.at, zone) })
        : null;
  // After a stretch that ended the lamp is on "again", and the line does not name it twice.
  const lit = open ? t(`grow.diary.light${closed ? 'Again' : 'On'}${open.still ? 'Since' : 'At'}`, { at: clock(open.at, zone) }) : null;
  const first = on ?? off ?? open;
  const lamp = first ? [said('light', (open ?? first).at, [closed, lit].filter(Boolean).join(' · '), { routine: true })] : [];

  const excursions = day.events.filter(event => event.kind === 'excursion');
  const outside = [...new Set(excursions.map(event => event.metric))].map(metric => {
    const runs = excursions.filter(event => event.metric === metric);
    const seconds = runs.reduce((sum, run) => sum + (Date.parse(run.endedAt ?? day.endsAt) - Date.parse(run.at)) / 1000, 0);
    const side = runs.every(run => run.above) ? 'above' : runs.every(run => !run.above) ? 'below' : 'outside';
    const words = t(`grow.diary.${side}${runs.length > 1 ? 'Often' : ''}`, {
      metric: t(`home.metric.${metric}`),
      span: spanLabel(seconds),
      count: runs.length,
    });

    return said(`outside-${metric}`, runs[0].at, words, {}, metric);
  });

  // The place's climate passed to another device: from then on the day's figures are that one's.
  const measuring = day.events.flatMap(event =>
    event.kind === 'device'
      ? // The moment the curves change hands is one to look at, as a stretch outside the targets is.
        [said(`device-${event.at}`, event.at, t('grow.diary.measuredBy', { name: deviceName(event, t) }), {}, null, true)]
      : [],
  );

  return [...written, ...alarms.lines, ...maintenance, ...lamp, ...outside, ...measuring].sort((one, other) => other.at.localeCompare(one.at));
};

/** An entry as a line of the diary, standing for `count` of its kind since `since` where a list folded them. */
export const writtenLine = (entry: Entry, count = 1, since = entry.occurredAt): DayLine => ({
  key: entry.id,
  at: entry.occurredAt,
  own: byAPerson(entry),
  routine: false,
  what: { kind: 'entry', entry, count, since },
});

/** How many lines of their own a card shows before it folds, and how many lines it shows at least. */
const OWN_SHOWN = 6;
const LINES_SHOWN = 4;

/**
 * The lines a card draws before the rest is asked for. The grower's own lines
 * come first and are never folded behind a device's; what the devices did
 * fills what is left of four lines, what is out of the ordinary - a reading
 * outside its targets, an alarm, a step of the plan - before the lamp.
 */
export const shownLines = (lines: DayLine[]): DayLine[] => {
  const own = lines.filter(line => line.own).slice(0, OWN_SHOWN);
  const devices = lines.filter(line => !line.own);
  const filled = [...devices.filter(line => !line.routine), ...devices.filter(line => line.routine)].slice(0, Math.max(0, LINES_SHOWN - own.length));

  const shown = lines.filter(line => own.includes(line) || filled.includes(line));
  // One line more is shown rather than folded behind a button as tall as itself.
  return lines.length - shown.length === 1 ? lines : shown;
};

/** Whether somebody did what a line says: a person wrote it, or confirmed the plan's step it records. */
const byAPerson = (entry: Entry): boolean => entry.source === 'human' || entry.authorId !== null;

const FIRED = 'message-alarm-triggered';
const CLEARED = 'message-alarm-resolved';

/**
 * A day's alarms as one line per rule: its newest firing, how often it fired
 * and since when. A rule that fired once keeps the line that says it is over;
 * one that fired again and again says how often, which says that as well.
 * `told` is every entry these lines stand for.
 */
const alarmLines = (i18n: I18n, entries: Entry[]): { lines: DayLine[]; told: Set<string> } => {
  const read = entries.flatMap(entry => {
    const key = entry.kind === 'alarm' ? entry.message?.key : null;
    const parts = key === FIRED || key === CLEARED ? alarmLineParts(i18n, entry.message!.params[0] ?? '', key === FIRED) : null;
    return parts ? [{ entry, parts, fired: key === FIRED }] : [];
  });
  const line = ({ entry, parts }: (typeof read)[number], count: number, since: string, over: boolean): DayLine => ({
    key: entry.id,
    at: entry.occurredAt,
    own: false,
    routine: false,
    what: { kind: 'alarm', entry, rule: parts.rule, count, since, limit: over ? null : parts.limit, over },
  });
  const often = foldSame(
    read.filter(one => one.fired),
    one => one.parts.rule,
    one => one.entry.occurredAt,
  ).filter(run => run.count > 1);
  const lines = [
    ...often.map(run => line(run.newest, run.count, run.since, false)),
    ...read.filter(one => !often.some(run => run.newest.parts.rule === one.parts.rule)).map(one => line(one, 1, one.entry.occurredAt, !one.fired)),
  ];

  return { lines, told: new Set(read.map(one => one.entry.id)) };
};

/**
 * What happened again and again, said once - an alarm's firings of a day, the
 * episodes of one alert: the newest of each kind, how many there were and
 * since when. Newest first, as the list it is handed.
 */
export const foldSame = <T>(things: T[], kindOf: (thing: T) => string, atOf: (thing: T) => string): { newest: T; count: number; since: string }[] =>
  [...new Set(things.map(kindOf))].map(kind => {
    const same = things.filter(thing => kindOf(thing) === kind);
    return { newest: same[0], count: same.length, since: atOf(same[same.length - 1]) };
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
  picture.entry === null || picture.cameraId !== null
    ? t('grow.pictures.camera')
    : t(picture.entry.authorId !== null && picture.entry.authorId === userId ? 'grow.pictures.yours' : 'grow.pictures.photo');
