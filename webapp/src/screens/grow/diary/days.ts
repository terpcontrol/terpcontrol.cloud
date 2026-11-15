import { DateTime } from 'luxon';
import type { Entry, GrowDiaryDay, GrowDiaryWeek, GrowHarvest, GrowListItem, Metric, Plant, ReadingName } from '@fg2/shared-types/v1';
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
  /** The grow's plants by name, where the reader is answered them: a line about some of them names those. */
  plants: readonly Pick<Plant, 'id' | 'growId' | 'label'>[];
  /** Whether a line draws the pictures it carries: for a reader from outside, who is shown the diary. A member's line counts them. */
  thumbnails: boolean;
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

/**
 * What a row of folded days is named by: the stage most of them lay in, with that stage's week at their middle. A
 * row holds a part of the week still running - its newest days stand open as cards - and the week's own stage is
 * today's. Days from a server that does not say their stage are named by their week.
 */
export const stageOfDays = (t: Translate, week: GrowDiaryWeek, days: GrowDiaryDay[]): string | null => {
  if (days.some(day => day.phase === undefined)) return stageOfWeek(t, week);
  const kindOf = (day: GrowDiaryDay) => (day.phase ? `${day.phase.stage}:${day.phase.preset ?? ''}` : '');
  // Newest first, so a tie goes to the newer stage.
  const most = days
    .map(kindOf)
    .reduce((best, kind, _, all) => (all.filter(one => one === kind).length > all.filter(one => one === best).length ? kind : best));
  const lay = days.filter(day => kindOf(day) === most);
  const middle = lay[Math.floor(lay.length / 2)].phase;

  return middle ? stageOfWeek(t, middle) : null;
};

/** "Geerntet", or the plants it is of while others still grow - "B2 geerntet": one plant of three cut is not the grow's harvest. */
export const harvestWord = (t: Translate, harvest: GrowHarvest, plants: readonly Pick<Plant, 'id' | 'label'>[]): string => {
  // A server that does not name the plants named none.
  const ids = harvest.plantIds ?? [];
  const named = plants.filter(plant => ids.includes(plant.id)).map(plant => plant.label);
  if (ids.length === 0) return t('grow.report.harvest');
  return named.length === ids.length ? t('grow.lifecycle.harvest.told', { plants: named.join(', ') }) : t('grow.report.harvestPart');
};

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
    /**
     * An alarm, named by its rule on its device: how often it fired that day, and the reading and the edge it
     * crossed. `over` is the line that says it ended; `stands`, that the rule's alarm was still open when the day's
     * lines end.
     */
    | {
        kind: 'alarm';
        entry: Entry;
        rule: string;
        count: number;
        since: string;
        limit: string | null;
        over: boolean;
        stands: boolean;
        /** Another device's rule of the same name has a line beside it: this one says its device. */
        twin: boolean;
        /** When the one silence this line stands at the start of ended. */
        until?: string;
        /** It fired as critical, which a card shows before a warning when it folds. */
        critical: boolean;
      }
    /**
     * Something worked out from the record: the lamp, a stretch outside the targets (`metric`), maintenance, another
     * device measuring. `moment` says the line leads to the curves of its moment where it names no reading of its own.
     */
    | { kind: 'said'; words: string; metric: Metric | null; moment?: true };
}

/**
 * The lines of a day, newest first, whatever order its entries are handed in.
 *
 * What people did stands as they wrote it, and maintenance or regulation off
 * somebody switched as one line for on and off together. What the devices did by themselves is
 * said once each: the lamp as the hours it burned, a reading outside its
 * targets as one line however often it left them, an alarm as its rule with
 * how often it fired - a reading hovering at its threshold fires and clears a
 * hundred times a night. So a climate that swung all night is a sentence and
 * not a column. A controller replaced by another is one line at the moment the
 * new one came, and a device gone silent one line from when it went quiet.
 */
export const dayLines = (
  t: Translate,
  i18n: I18n,
  day: Pick<GrowDiaryDay, 'entries' | 'events' | 'endsAt'>,
  zone: string | null,
  silentSince?: SilentSince,
): DayLine[] => {
  // The folds read the newest of a run first: Verlauf's entries came oldest first, and an alarm that was over read open.
  const entries = [...day.entries].sort((one, other) => other.occurredAt.localeCompare(one.occurredAt));
  const alarms = alarmLines(i18n, entries, silentSince);
  const written = foldRepeats(entries.filter(entry => !alarms.told.has(entry.id))).map(({ entry, count, since }) => writtenLine(entry, count, since));
  const said = (key: string, at: string, words: string, over: Partial<DayLine> = {}, metric: Metric | null = null, moment = false): DayLine => ({
    key,
    at,
    own: false,
    routine: false,
    ...over,
    what: { kind: 'said', words, metric, ...(moment ? { moment: true as const } : {}) },
  });

  // Maintenance and regulation switched off, each one line for on and off together - somebody's, as a line written is.
  const maintenance = day.events.flatMap(event =>
    event.kind === 'maintenance' || event.kind === 'controlOff'
      ? [
          said(
            `${event.kind}-${event.at}`,
            event.at,
            event.endedAt
              ? // Ended within its first minute it has no length worth stating: "Wartung · 0 s" said nothing.
                Date.parse(event.endedAt) - Date.parse(event.at) < 60_000
                ? t(`grow.diary.${event.kind}Brief`)
                : t(`grow.diary.${event.kind}`, { span: spanLabel((Date.parse(event.endedAt) - Date.parse(event.at)) / 1000) })
              : t(`grow.diary.${event.kind}On`),
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

  // Within one minute a critical alarm stands above the rest: a warning fired seconds later read as the worse of the two.
  const minute = (line: DayLine) => line.at.slice(0, 16);
  const worse = (line: DayLine) => (line.what.kind === 'alarm' && line.what.critical ? 0 : 1);
  return [...written, ...alarms.lines, ...maintenance, ...lamp, ...outside, ...measuring].sort(
    (one, other) => minute(other).localeCompare(minute(one)) || worse(one) - worse(other) || other.at.localeCompare(one.at),
  );
};

/**
 * Lines told oldest first, as Verlauf's curves run: a folded run stands at its first and says until when it went on,
 * an alarm over by its newest line all the same. An alarm still open has no end to say: it stands at its newest
 * firing, the one Meldungen says it stands open since, and says since when it fired - "bis" its newest read as over.
 */
export const forwardsOf = (lines: DayLine[]): DayLine[] =>
  lines
    .map(line =>
      line.what.kind === 'said' || line.what.count < 2 || (line.what.kind === 'alarm' && line.what.stands)
        ? line
        : { ...line, at: line.what.since, what: { ...line.what, since: line.at } },
    )
    .sort((one, other) => one.at.localeCompare(other.at));

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
 * An alarm that stands open: what the day's card never folds away. One that ended is a device's line like any other,
 * and its end, the newer line, is shown before its start is.
 */
const openAlarm = (line: DayLine): boolean => line.what.kind === 'alarm' && line.what.stands;

/** How many of these lines are an alarm's: what the row that unfolds a card says it hides. */
export const alarmsIn = (lines: DayLine[]): number => lines.filter(line => line.what.kind === 'alarm').length;

/** Which of a device's lines a card keeps first when it folds: a critical alarm, then a warning's, then the rest. */
const foldRank = (line: DayLine): number => (line.what.kind !== 'alarm' ? 2 : line.what.critical ? 0 : 1);

/**
 * The lines a card draws before the rest is asked for. The grower's own lines
 * come first and are never folded behind a device's, and an alarm that stands
 * open is never folded at all; what else the devices did fills what is left
 * of four lines, what is out of the ordinary - a critical alarm before a
 * warning's, then a reading outside its targets, an alarm that is over, a step
 * of the plan - before the lamp.
 */
export const shownLines = (lines: DayLine[]): DayLine[] => {
  const own = lines.filter(line => line.own).slice(0, OWN_SHOWN);
  const open = lines.filter(openAlarm);
  const devices = lines.filter(line => !line.own && !openAlarm(line));
  const room = Math.max(0, LINES_SHOWN - own.length - open.length);
  const unusual = devices.filter(line => !line.routine).sort((one, other) => foldRank(one) - foldRank(other));
  const filled = [...unusual, ...devices.filter(line => line.routine)].slice(0, room);

  const shown = lines.filter(line => own.includes(line) || open.includes(line) || filled.includes(line));
  // One line more is shown rather than folded behind a button as tall as itself.
  return lines.length - shown.length === 1 ? lines : shown;
};

/**
 * What a device writes when somebody did it: maintenance switched at the device or in the app, a restart asked for in
 * the app. Its line names no person, and is no device's doing either.
 */
const DONE_BY_SOMEBODY = ['message-maintenance-mode-activated', 'message-maintenance-mode-activated-remote', 'message-device-booted:REMOTE'];

/** Whether somebody did what a line says: a person wrote it, confirmed the plan's step it records, or switched the device. */
const byAPerson = (entry: Entry): boolean =>
  entry.source === 'human' ||
  entry.authorId !== null ||
  (entry.message !== null &&
    [entry.message.key, `${entry.message.key}:${entry.message.params[0] ?? ''}`].some(key => DONE_BY_SOMEBODY.includes(key)));

const FIRED = 'message-alarm-triggered';
const CLEARED = 'message-alarm-resolved';

/**
 * A day's alarms as one line per rule: its newest line, how often it fired and since when - its start and its end
 * one line, "Zu warm · behoben", as often as it fired. The rule is over where its newest line is the clearing. A
 * rule is its device's (`ruleKey`): every device carries "Gerät offline", and a controller and a socket share the
 * stage's rules, so one device's open alarm read "behoben" because another's of the same name was over. Where two
 * devices' lines share a name, each says its device (`twin`). A camera's silence is named as Meldungen names it,
 * "Terp Cam ohne Bild", and a silence counts from when it was last heard, as Meldungen counts it - to the second
 * where `silentSince` knows its alert -, one silence a line of its own (`silenceRuns`). `told` is every entry these
 * lines stand for.
 */
const alarmLines = (i18n: I18n, entries: Entry[], silentSince?: SilentSince): { lines: DayLine[]; told: Set<string> } => {
  const read = entries.flatMap((entry): AlarmRead[] => {
    const alarm = alarmOf(i18n, entry);
    if (!alarm) return [];
    const { parts, fired } = alarm;
    const rule = entry.cameraId ? i18n.t('alerts.title.camera', { what: parts.rule }) : parts.rule;
    const exact = parts.silentFor === undefined ? null : (silentSince?.(entry) ?? null);
    const began =
      exact ??
      (parts.silentFor === undefined ? entry.occurredAt : DateTime.fromISO(entry.occurredAt).minus({ seconds: parts.silentFor }).toUTC().toISO()!);
    return [{ entry, parts: { ...parts, rule }, fired, began, key: ruleKey(entry, rule), rough: exact ? 0 : (parts.roughBy ?? 0) }];
  });
  // Newest first: a rule whose newest line is its clearing is over, however often it fired before.
  const others = read.filter(one => !one.parts.silence);
  const runs: AlarmRun[] = [
    ...foldSame(
      others,
      one => one.key,
      one => one.began,
    ).map(({ newest }) => {
      const fired = others.filter(one => one.key === newest.key && one.fired);
      return { newest, at: newest.began, count: Math.max(1, fired.length), since: fired.at(-1)?.began ?? newest.began, fired };
    }),
    ...silenceRuns(read),
  ];
  const lines = runs.map(({ newest, at, count, since, fired, until, over = !newest.fired }): DayLine => ({
    key: newest.entry.id,
    at,
    own: false,
    routine: false,
    what: {
      kind: 'alarm',
      entry: newest.entry,
      rule: newest.parts.rule,
      count,
      since,
      ...(until ? { until } : {}),
      limit: over ? null : newest.parts.limit,
      over,
      stands: !over,
      twin: runs.some(({ newest: other }) => other.key !== newest.key && other.parts.rule === newest.parts.rule),
      critical: fired.some(one => one.entry.severity === 'critical'),
    },
  }));

  return { lines, told: new Set(read.map(one => one.entry.id)) };
};

/**
 * When a silence began, where the reader holds it to the second: the alert's own start and seconds, which a line
 * written before the seconds were (`silent=`) has only rounded down - "10 min" of 10 min 40 s.
 */
export type SilentSince = (entry: Entry) => string | null;

/** An alarm's line read into its parts: the rule it is of on its device, and when what it is about began - to within `rough` seconds. */
interface AlarmRead {
  entry: Entry;
  parts: NonNullable<ReturnType<typeof alarmLineParts>>;
  fired: boolean;
  began: string;
  key: string;
  rough: number;
}

/** One line of a day's alarms: the newest of what it stands for, where it stands, how often and since when, and until when one silence went on. */
interface AlarmRun {
  newest: AlarmRead;
  at: string;
  count: number;
  since: string;
  fired: AlarmRead[];
  until?: string;
  /** Whether it is over, where its newest line does not say so: a silence another one of its rule followed. */
  over?: boolean;
}

/** An alarm's line in its parts, and whether it says the alarm fired; null for every other line. */
const alarmOf = (i18n: I18n, entry: Entry): { parts: AlarmRead['parts']; fired: boolean } | null => {
  const key = entry.kind === 'alarm' ? entry.message?.key : null;
  const parts = key === FIRED || key === CLEARED ? alarmLineParts(i18n, entry.message!.params[0] ?? '', key === FIRED) : null;
  return parts ? { parts, fired: key === FIRED } : null;
};

/** Raises whose starts lie this close are one silence: a second one can only begin after the first was raised, ten minutes in. */
const ONE_SILENCE_MS = 60_000;

/**
 * A device's or a camera's silences as lines. A silence is one thing however often the cloud raised it - a restart
 * of the server closes an alert and raises it again a minute later, and Saturday read "8× seit 18:36" of one quiet
 * evening - so its raises are one, dated by the earliest start they give, and the line that says it ended (by its
 * alert) is its end. One still going stands alone at its start: "4× seit 18:35" of a silence since 09:46 lumped in
 * the one before a restart. One that is over stands at its start, "bis" its end; several of a rule over are one line
 * as an alarm's are, counted as silences.
 */
const silenceRuns = (read: AlarmRead[]): AlarmRun[] => {
  const silent = read.filter(one => one.parts.silence);
  // Each silence's raises, earliest start first, and the newest line that says it ended.
  const episodes: { firings: AlarmRead[]; end: AlarmRead | null }[] = [];
  const ms = (instant: string) => Date.parse(instant);
  for (const firing of silent.filter(one => one.fired).sort((one, other) => ms(one.began) - ms(other.began))) {
    const last = episodes.findLast(one => one.firings[0].key === firing.key);
    const close = Math.max(ONE_SILENCE_MS, firing.rough * 1000);
    if (last && ms(firing.began) - ms(last.firings.at(-1)!.began) <= close) last.firings.push(firing);
    else episodes.push({ firings: [firing], end: null });
  }
  const startOf = ({ firings, end }: (typeof episodes)[number]): string => firings[0]?.began ?? end!.began;
  // An end is its alert's; one that names none ends the last silence of its rule begun before it.
  for (const end of silent.filter(one => !one.fired).sort((one, other) => ms(one.entry.occurredAt) - ms(other.entry.occurredAt))) {
    const of =
      (end.entry.alertId ? episodes.find(({ firings }) => firings.some(one => one.entry.alertId === end.entry.alertId)) : undefined) ??
      episodes.findLast(one => one.firings[0]?.key === end.key && one.end === null && ms(startOf(one)) < ms(end.entry.occurredAt));
    if (!of) episodes.push({ firings: [], end });
    else if (!of.end || ms(end.entry.occurredAt) > ms(of.end.entry.occurredAt)) of.end = end;
  }

  // A silence followed by another of its rule is over, whether or not its end is among the lines.
  const lastOf = (one: (typeof episodes)[number]): AlarmRead =>
    one.end ?? one.firings.reduce((newest, other) => (ms(other.entry.occurredAt) > ms(newest.entry.occurredAt) ? other : newest));
  const going = episodes.filter(
    one =>
      one.end === null &&
      !episodes.some(other => other !== one && other.firings[0]?.key === one.firings[0].key && ms(startOf(other)) > ms(startOf(one))),
  );
  const over = episodes
    .filter(one => !going.includes(one))
    .sort((one, other) => ms(lastOf(other).entry.occurredAt) - ms(lastOf(one).entry.occurredAt));
  const ended = [...new Set(over.map(one => lastOf(one).key))].map((key): AlarmRun => {
    const same = over.filter(one => lastOf(one).key === key);
    const [last, first] = [same[0], same[same.length - 1]];
    const fired = same.flatMap(one => one.firings);
    // Alone it stands where it began and says when it ended; folded with others it is the rule's run of them.
    return same.length === 1 && last.firings.length > 0
      ? {
          newest: lastOf(last),
          at: startOf(last),
          count: 1,
          since: startOf(last),
          fired,
          over: true,
          ...(last.end ? { until: last.end.entry.occurredAt } : {}),
        }
      : { newest: lastOf(last), at: lastOf(last).began, count: same.length, since: startOf(first), fired, over: true };
  });

  return [...going.map(one => ({ newest: lastOf(one), at: startOf(one), count: 1, since: startOf(one), fired: one.firings, over: false })), ...ended];
};

/** Which rule an alarm's line is of: its name on its device or its camera, never its name alone. */
const ruleKey = (entry: Pick<Entry, 'deviceId' | 'cameraId'>, rule: string): string => [entry.deviceId ?? '', entry.cameraId ?? '', rule].join('|');

/**
 * Lines newest first, an alarm's only of the date its newest line stands on: what Start's newest lines count an alarm's
 * repeats by, as that day's card of the diary counts them - the server sends each shown alarm's other firings along.
 */
export const onTheirDay = (i18n: I18n, entries: Entry[], zone: string | null): Entry[] => {
  const days = new Map<string, string>();
  const kept = entries.filter(entry => {
    const parts = alarmOf(i18n, entry)?.parts;
    if (!parts) return true;
    const rule = ruleKey(entry, parts.rule);
    const day = DateTime.fromISO(entry.occurredAt, { zone: zone ?? 'UTC' }).toISODate()!;
    if (!days.has(rule)) days.set(rule, day);
    return days.get(rule) === day;
  });
  // A silence that ended today began on another day: its raise comes along, or its end would stand without its start.
  const alerts = new Set(kept.flatMap(entry => (entry.kind === 'alarm' && entry.alertId ? [entry.alertId] : [])));
  return entries.filter(entry => kept.includes(entry) || (entry.alertId !== null && alerts.has(entry.alertId)));
};

/**
 * The weeks with a silence's lines filed under the day it began, where that day is among them: a device quiet from
 * Friday evening was raised again on Saturday, and Saturday's card said "18:35 Gerät offline" of nothing that
 * happened that day. The line that says the silence ended goes with it, by its alert.
 */
export const filedBySilence = (i18n: I18n, weeks: GrowDiaryWeek[]): GrowDiaryWeek[] => {
  const days = weeks.flatMap(week => week.days);
  const dayAt = (instant: number) => days.find(day => Date.parse(day.startsAt) <= instant && instant < Date.parse(day.endsAt));
  const goes = new Map<string, GrowDiaryDay>();
  const byAlert = new Map<string, GrowDiaryDay>();
  const silenceOf = (entry: Entry) => {
    const parts = alarmOf(i18n, entry)?.parts;
    return parts?.silence ? parts : null;
  };
  for (const day of days)
    for (const entry of day.entries) {
      const silentFor = silenceOf(entry)?.silentFor;
      if (silentFor === undefined) continue;
      const began = dayAt(Date.parse(entry.occurredAt) - silentFor * 1000) ?? day;
      if (began !== day) goes.set(entry.id, began);
      if (entry.alertId) byAlert.set(entry.alertId, began);
    }
  for (const day of days)
    for (const entry of day.entries) {
      const parts = silenceOf(entry);
      const began = entry.alertId !== null && parts !== null && parts.silentFor === undefined ? byAlert.get(entry.alertId) : undefined;
      if (began && began !== day) goes.set(entry.id, began);
    }
  if (goes.size === 0) return weeks;

  const moved = days.flatMap(day => day.entries.filter(entry => goes.has(entry.id)));
  const filed = (day: GrowDiaryDay): GrowDiaryDay => ({
    ...day,
    entries: [...day.entries.filter(entry => !goes.has(entry.id)), ...moved.filter(entry => goes.get(entry.id) === day)],
  });
  return weeks.map(week => ({ ...week, days: week.days.map(filed) }));
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

/**
 * The picture a day's card is headed by: the camera's, else the first picture of the first line written with one
 * that day - a line's first, as a plant's page is headed by too.
 */
export const headPicture = (day: GrowDiaryDay): GrowPicture | null => {
  const pictures = picturesOfDay(day);
  const first = pictures.at(-1)?.entry;
  return pictures.find(picture => picture.entry === null) ?? pictures.find(picture => picture.entry === first) ?? null;
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
