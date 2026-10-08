import { ChevronDown, LineChart } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { GrowSeriesRange, MeasurementDefinition, SpaceTimeline, TimelineOutputLane, TimelineRange } from '@fg2/shared-types/v1';
import { useGrowSeries } from '@/api/charts';
import { serverNow } from '@/api/clock';
import { useGrow } from '@/api/grows';
import type { Picture } from '@/api/public';
import { rangeNeedsGrow, useTimeline } from '@/api/timeline';
import type { Translate } from '@/i18n/i18n';
import { useScrub } from '@/charts/scrub';
import { useCorrecting } from '@/log/corrections';
import { outputWord } from '@/ui/climate-hardware';
import { Term } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { ageLabel, sinceLabel } from '@/ui/age';
import { DAY_MS, HOUR_MS } from '@/ui/days';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { figure, UNIT } from '@/ui/units';
import { CameraFrame, Slider } from './CameraFrame';
import { Lanes } from './Lanes';
import { Panel } from './Panel';
import { ReadingPanel } from './ReadingPanel';
import { at, momentOf, pointAt, spans, stampOf } from './window';
import styles from './Timeline.module.css';

const RANGES: TimelineRange[] = ['24h', '7d', '30d', 'phase', 'grow'];

/** What a link is shown: the three rolling windows, which need no grow and no account to read. */
const SHARED_RANGES: TimelineRange[] = ['24h', '7d', '30d'];

/** Somebody reading through a link: its token, and where its pictures come from. */
interface SharedReader {
  token: string;
  picture: Picture;
}

interface TimelineProps {
  spaceId: string;
  /** The title row: the tab's name and the place it shows, with the switcher where there are several. */
  heading?: React.ReactNode;
}

/**
 * The Timeline of one place: the frame at the cursor, the stacked panels under
 * it, the output lanes and the rail, all of one window and all moved by one
 * cursor.
 *
 * The state is keyed by the space, so picking another place starts it clean
 * rather than asking the new one about the old one's grow.
 *
 * `?focus=` names the reading a tile was tapped on - a metric, or `light` for
 * the lamp's lane - and the screen opens scrolled to it with it marked, so the
 * tap lands on the curve it was about rather than at the top of the stack.
 */
export function Timeline({ spaceId, heading }: TimelineProps) {
  return <TimelineFor key={spaceId} spaceId={spaceId} heading={heading} shared={null} />;
}

/**
 * The same Timeline for somebody reading a place through a link: read only,
 * over the last day, week or month, through the link's own window, with no way
 * into the app's other screens - the reader has no account to open them with.
 */
export function SharedTimeline({ spaceId, shared }: { spaceId: string; shared: SharedReader }) {
  return <TimelineFor spaceId={spaceId} shared={shared} />;
}

/** The lanes of a signed-in reader, who may put right a line of their own from the rail. */
function CorrectableLanes(props: React.ComponentProps<typeof Lanes>) {
  return <Lanes {...props} correcting={useCorrecting()} />;
}

function TimelineFor({ spaceId, heading, shared }: TimelineProps & { shared: SharedReader | null }) {
  const Rail = shared ? Lanes : CorrectableLanes;
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const [params] = useSearchParams();
  const focus = params.get('focus');
  // A link that names a moment - an alert's "Verlauf öffnen" - opens on the
  // shortest window that holds it, with the cursor standing on it.
  const [moment] = useState(() => momentOf(params.get('at')));
  const [range, setRange] = useState<TimelineRange>(() => (moment === null ? '24h' : rangeHolding(moment, now.toMillis())));
  /** Set only when a stretch chip is tapped: the two rolling ranges let the server pick the grow standing here. */
  const [pinned, setPinned] = useState<string | null>(null);
  /** Null is "the end of the window", so a refresh carries the cursor along with it rather than pinning it to an instant that has scrolled out. */
  const [cursor, setCursor] = useState<number | null>(moment);
  const [opened, setOpened] = useState<string | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);

  const timeline = useTimeline(spaceId, range, pinned, shared?.token ?? null);
  const data = timeline.data;
  const nameOf = useOutputName();

  // Once per focus, when what it names has been drawn: scrolling again on every refresh would take the page from under a thumb.
  useEffect(() => {
    if (!focus || !data || focused.current === focus) return;
    const target = screen.current?.querySelector<HTMLElement>('[data-focus]');
    if (!target) return;
    focused.current = focus;
    target.scrollIntoView?.({ block: 'center' });
  }, [focus, data]);
  // A link is shown the place and not the grows that stood in it, which are
  // reads of an account it has not got.
  const growId = shared ? null : (pinned ?? data?.growId ?? null);
  const grow = useGrow(growId);
  const readings = useReadings(growId, grow.data?.measurements ?? [], range);

  const scrub = useScrub(fraction => {
    if (!data) return;
    const { from, to } = boundsOf(data);
    setCursor(from + fraction * (to - from));
  }).handlers;

  // The stretches of a grow are offered where a grow is, and a month where none
  // is: nothing is drawn greyed out for somebody who has never started one.
  const offered = shared
    ? SHARED_RANGES
    : RANGES.filter(one => (rangeNeedsGrow(one) ? growId !== null : one !== '30d' || growId === null || range === one));

  const chips = (
    // Which days are drawn is the answer to the chips, not one of them, so it
    // stands beside the row rather than inside it: a phone cannot fit six chips
    // and would otherwise park the range past the end of a scroller that
    // advertises nothing, on the one screen where the window is not named
    // anywhere else.
    <div className={styles.rangeBar}>
      <div className={`${ui.scrollRow} ${styles.chips}`} role="group" aria-label={t('timeline.rangeLabel')}>
        {offered.map(one => (
          <button
            key={one}
            type="button"
            className={ui.chip}
            aria-pressed={one === range}
            onClick={() => {
              setRange(one);
              setPinned(rangeNeedsGrow(one) ? growId : null);
              setCursor(null);
              setOpened(null);
            }}
          >
            {t(`timeline.range.${one}`)}
          </button>
        ))}
        {/* Which grow the two stretch chips are about, where more than one has
            stood here. A grow that moved out in spring left its whole record
            behind it and this rail is the only screen that draws it, so without
            this those months have no address at all: every other way in names
            the grow standing here now. */}
        {!shared && data && data.grows.length > 1 ? (
          <span className={`${ui.chip} ${styles.growChip}`}>
            <span className={styles.growName}>{data.grows.find(one => one.growId === growId)?.name ?? t('timeline.pickGrow')}</span>
            <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
            <select
              value={growId ?? ''}
              aria-label={t('timeline.pickGrow')}
              onChange={event => {
                setPinned(event.target.value);
                setRange(one => (rangeNeedsGrow(one) ? one : 'grow'));
                setCursor(null);
                setOpened(null);
              }}
            >
              {/* Nothing is growing here now, so the chips name no grow until one is chosen. */}
              {growId === null ? <option value="">{t('timeline.pickGrow')}</option> : null}
              {data.grows.map(one => (
                <option key={one.growId} value={one.growId}>
                  {one.name}
                </option>
              ))}
            </select>
          </span>
        ) : null}
        {/* The way into the Charts view. It is not a tab of its own - it opens
            on the place this row shows, and on the grow it shows where one is,
            with any window, any step and every line the place has. Not where
            nothing was ever measured here - by a device or by hand - which is
            a chart of nothing whatever the window. */}
        {!shared && (!data || data.panels.length > 0 || data.lastReadingAt !== null || readings.length > 0) ? (
          <Link to={growId !== null ? `/charts?space=${spaceId}&grow=${growId}` : `/charts?space=${spaceId}`} className={ui.chip}>
            <LineChart size={13} strokeWidth={1.75} aria-hidden />
            {t('charts.title')}
          </Link>
        ) : null}
      </div>
      {data ? <span className={`mono ${styles.days}`}>{dayLabel(t, data)}</span> : null}
    </div>
  );

  if (timeline.isPending) {
    return (
      <div className={styles.screen}>
        {heading}
        {chips}
        <Waiting lines={3} />
        <Waiting lines={4} />
      </div>
    );
  }
  if (!data) return <LoadFailed retry={() => void timeline.refetch()} />;

  const { from, to, recordingSince } = boundsOf(data);
  // At rest the cursor is at the end of the window, unless the place has gone
  // quiet: then it rests on the last thing measured, and says so, rather than
  // on a "now" nothing was heard at.
  const lastReading = rangeNeedsGrow(data.range) ? null : quietSince(data);
  const here = Math.min(to, Math.max(from, cursor ?? lastReading ?? to));
  // After the last thing heard nothing is known, the light schedule included:
  // the nights stop there with the band, so the stretch after it is drawn as
  // the blank it is rather than as a day that went on until now.
  const heardNights =
    lastReading === null
      ? data.nights
      : data.nights
          .filter(night => at(night.startsAt) < lastReading)
          .map(night => (at(night.endsAt) > lastReading ? { ...night, endsAt: DateTime.fromMillis(lastReading).toISO()! } : night));
  const frames = data.cameras.filter(camera => camera.frames.length > 0);

  return (
    // Busy while a chip's window is still on its way: what is drawn is the
    // window before it, which is worth saying without taking it off the screen.
    <div className={styles.screen} aria-busy={timeline.isPlaceholderData} ref={screen}>
      {heading}
      {grow.data ? (
        <Link to={`/grows/${grow.data.id}`} className={`mono ${styles.subject}`}>
          {grow.data.name}
        </Link>
      ) : null}
      {chips}
      <RefreshFailed failedAt={timeline.isError ? timeline.dataUpdatedAt : null} now={now} />

      {frames.length > 0 ? (
        <CameraFrame
          cameras={frames}
          from={from}
          to={to}
          cursor={here}
          day={data.dayFrom !== null && data.dayFrom === data.dayTo ? data.dayFrom : null}
          photos={data.events.flatMap(entry =>
            entry.cameraId === null ? entry.mediaIds.map(mediaId => ({ mediaId, takenAt: entry.occurredAt })) : [],
          )}
          onScrub={setCursor}
          picture={shared?.picture}
        />
      ) : (
        // No camera here: the panels keep their scrubber, which is the one control a thumb has.
        <div className={ui.transport}>
          <Slider from={from} to={to} cursor={here} onScrub={setCursor} />
        </div>
      )}

      <ScrubHeader timeline={data} cursor={here} resting={cursor === null && lastReading !== null} nameOf={nameOf} />

      {recordingSince !== null ? (
        <p className={`mono ${styles.recording}`} role="note">
          {t('timeline.recordingSince', { time: sinceLabel(DateTime.fromMillis(recordingSince).toISO()!, now, zone) })}
        </p>
      ) : null}

      {/* The grey under every curve, said once over them: which hours are the
          night, and that the band steps with it. */}
      {data.panels.length + readings.length > 0 && heardNights.some(night => at(night.startsAt) < to && at(night.endsAt) > from) ? (
        <p className={styles.legend}>
          <span className={styles.nightSwatch} aria-hidden />
          <Term topic="nightBand">{t('timeline.nightLegend')}</Term>
        </p>
      ) : data.panels.some(panel => panel.targets.some(row => row.held !== undefined && row.held !== 'schedule')) ? (
        // A drying room, a germination or a light that never changes has no
        // night to shade, which is said where the grey would otherwise be looked for.
        <p className={styles.legend}>
          <Term topic="nightBand">{t('timeline.legendNone')}</Term>
        </p>
      ) : null}

      {/* Two different states, and only the payload can tell them apart: a
          metric whose every point in the window is null has no panel, so an
          empty stack means "nothing was heard here" as often as it means
          "nothing measures here". `lastReadingAt` is the last time anything
          standing here measured at all, whenever that was. */}
      {data.panels.length === 0 && readings.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note} ${styles.empty}`}>
          {data.lastReadingAt === null ? t('timeline.noPanels') : t('timeline.quietWindow', { age: ageLabel(data.lastReadingAt, now) })}
        </p>
      ) : null}
      {data.panels.map((panel, index) => (
        <Panel
          key={panel.metric}
          panel={panel}
          nights={heardNights}
          transitions={data.transitions}
          alarms={data.alarms}
          from={from}
          to={to}
          heardUntil={lastReading}
          cursor={here}
          scrub={scrub}
          explain={index === 0}
          focused={panel.metric === focus}
        />
      ))}
      {readings.map(({ definition, points }) => (
        <ReadingPanel
          key={definition.key}
          definition={definition}
          points={points.filter(point => at(point.measuredAt) >= from && at(point.measuredAt) <= to)}
          nights={heardNights}
          from={from}
          to={to}
          cursor={here}
          scrub={scrub}
        />
      ))}

      <Rail
        timeline={data}
        from={from}
        to={to}
        cursor={here}
        now={now}
        selected={opened}
        onSelect={setOpened}
        onScrub={setCursor}
        scrub={scrub}
        events={data.events.length > 0}
        focus={focus}
        nameOf={nameOf}
        // Where nothing measures, what was written is the whole of the window, so it is listed rather than folded into marks.
        listAll={data.panels.length === 0 && data.outputs.length === 0 && data.lastReadingAt === null}
        picture={shared?.picture}
      />
    </div>
  );
}

/** The series range a Timeline window is read as; a month has no chip of the grow's own and is asked for by its two ends. */
const SERIES_RANGE: Record<TimelineRange, GrowSeriesRange> = { '24h': '24h', '7d': '7d', '30d': 'custom', phase: 'phase', grow: 'grow' };

/**
 * The grow's own measurements that are charted, with what was read of them
 * over the window - asked for only where there are any, because the same read
 * carries the climate the Timeline already has.
 */
const useReadings = (growId: string | null, measurements: MeasurementDefinition[], range: TimelineRange) => {
  const charted = measurements.filter(definition => definition.chart);
  const [month] = useState(() => {
    const hour = serverNow().startOf('hour');
    return { from: hour.minus({ days: 30 }).toUTC().toISO()!, to: hour.plus({ hours: 1 }).toUTC().toISO()! };
  });
  const series = useGrowSeries(charted.length > 0 ? growId : null, {
    range: SERIES_RANGE[range],
    ...(range === '30d' ? month : {}),
    measurements: charted.map(definition => definition.key),
  });
  const answered = series.data?.measurements ?? [];

  return charted.flatMap(definition => {
    const points = answered.find(one => one.key === definition.key)?.points ?? [];
    return points.length > 0 ? [{ definition, points }] : [];
  });
};

/** What an output lane is called. */
export type OutputName = (lane: Pick<TimelineOutputLane, 'output' | 'fridge'>) => string;

/**
 * The catalogue's name for each output, by the name the cockpit's tiles give
 * it, so a tap on "Kompressor läuft seit 12 Min" lands on a lane of the same
 * name. The lane says whose it is, a link's included, which is told no device
 * to look up.
 */
const useOutputName = (): OutputName => {
  const { t } = useTranslation();

  return lane => t(`timeline.output.${outputWord(lane.output, lane.fridge === true)}`, { defaultValue: lane.output });
};

/**
 * What was true at the cursor, written into a header that stays where it is.
 * A tooltip that follows the pointer cannot be read on a phone at all - the
 * thumb is over it - so the reading is pinned above the panels instead, and
 * sticks to the top of the screen while the stack is scrolled.
 */
function ScrubHeader({ timeline, cursor, resting, nameOf }: { timeline: SpaceTimeline; cursor: number; resting: boolean; nameOf: OutputName }) {
  const { t } = useTranslation();
  const zone = useZone();
  /**
   * The lanes anything is known about at the cursor. A lane carries how far it
   * was heard precisely because a run that stops where the device stopped
   * reporting looks exactly like one that stops because the output was switched
   * off - and a cursor past that instant is the second case for every lane at
   * once. Reading the spans alone said "everything off" about a fridge nothing
   * had heard from for four days, on the same line whose readings it had just
   * dashed, which is the claim about hardware this header is meant not to make.
   *
   * It is `heardUntil` and not the newest span's end: a live device whose
   * outputs have all been off for an hour has a newest span an hour old and is
   * still being heard, and saying nothing about it would be the same mistake
   * the other way round.
   */
  const heard = timeline.outputs.filter(lane => at(lane.heardUntil) >= cursor);
  const running = heard.filter(lane => spans(lane.spans, cursor));

  return (
    <p className={`mono ${styles.scrubHead}`} role="status">
      <span className={styles.scrubTime}>
        {/* Not the clock of the point it rests on: a point stands for the window it
            closes, and the pill above already dates the silence to the minute. */}
        {resting ? t('timeline.lastReading') : stampOf(cursor, at(timeline.endsAt) - at(timeline.startsAt), zone)}
      </span>
      {timeline.panels.map(panel => {
        const value = pointAt(panel, cursor);
        return (
          <span key={panel.metric} className={styles.scrubValue} data-metric={panel.metric}>
            {/* The leaf is the second °C in the line, told from the air's by more than its colour. */}
            {panel.metric === 'leafTemperature' ? <span className={styles.scrubUnit}>{t('timeline.leafShort')} </span> : null}
            {value === null ? '—' : figure(value, panel.metric)} <span className={styles.scrubUnit}>{UNIT[panel.metric] ?? ''}</span>
          </span>
        );
      })}
      {/* A place with no outputs says nothing here rather than "everything off", which would be a claim about hardware it has not got - and neither does one whose outputs nobody has heard from at the cursor. */}
      {heard.length === 0 ? null : (
        <span className={styles.scrubOutputs}>
          {running.length === 0 ? t('timeline.allOff') : running.map(lane => t('timeline.outputOn', { output: nameOf(lane) })).join(' · ')}
        </span>
      )}
    </p>
  );
}

/** The instants a panel's first and last readings in the window were taken at, or null where no panel has one. */
const readingsSpan = (timeline: SpaceTimeline): { first: number; last: number } | null => {
  const heard = timeline.panels.flatMap(panel => panel.points.filter(point => point.value !== null).map(point => at(point.measuredAt)));
  return heard.length === 0 ? null : { first: Math.min(...heard), last: Math.max(...heard) };
};

/**
 * The stretch the panels are drawn across. A place that started measuring well
 * inside the window - a device claimed this morning - is drawn from its first
 * reading, with a line saying since when, rather than as a flat band with a dot
 * at its far end that a new grower reads as a fault.
 */
const boundsOf = (timeline: SpaceTimeline): { from: number; to: number; recordingSince: number | null } => {
  const startsAt = at(timeline.startsAt);
  const to = at(timeline.endsAt);
  const first = readingsSpan(timeline)?.first ?? null;
  if (first === null || first - startsAt <= (to - startsAt) / 4) return { from: startsAt, to, recordingSince: null };

  // A little air before the first reading, so its dot is not on the edge.
  return { from: Math.max(startsAt, first - (to - first) / 20), to, recordingSince: first };
};

/**
 * When the place last measured, where it has been quiet since; null while it is
 * still reporting. The server closes every curve the place fell silent before
 * the end of with a break, by the same measure it breaks the curve anywhere
 * else, so a stack whose every panel ends in one is a place nobody is hearing.
 */
const quietSince = (timeline: SpaceTimeline): number | null =>
  timeline.panels.length > 0 && timeline.panels.every(panel => panel.points.at(-1)?.value === null) ? (readingsSpan(timeline)?.last ?? null) : null;

/** "day 34" over one day of a grow, "day 33–34" where the window straddles the turn, nothing at all without a grow. */
const dayLabel = (t: Translate, timeline: SpaceTimeline): string => {
  if (timeline.dayFrom === null || timeline.dayTo === null) return '';
  return timeline.dayFrom === timeline.dayTo
    ? t('timeline.dayN', { day: timeline.dayTo })
    : t('timeline.dayRange', { from: timeline.dayFrom, to: timeline.dayTo });
};

/** The shortest rolling window that still holds an instant, a month at most. */
const rangeHolding = (at: number, now: number): TimelineRange => {
  const age = now - at;
  if (age < 23 * HOUR_MS) return '24h';
  if (age < 6.5 * DAY_MS) return '7d';
  return '30d';
};
