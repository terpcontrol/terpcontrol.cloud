import { ChevronDown, LineChart } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SpaceTimeline, TimelineRange } from '@fg2/shared-types/v1';
import { fetchedAt } from '@/api/clock';
import { useGrow } from '@/api/grows';
import { rangeNeedsGrow, useTimeline } from '@/api/timeline';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { ageLabel } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { figure, UNIT } from '../home/units';
import { CameraFrame, Slider } from './CameraFrame';
import { Lanes } from './Lanes';
import { Panel } from './Panel';
import { at, pointAt, spans, stampOf } from './window';
import styles from './Timeline.module.css';

const RANGES: TimelineRange[] = ['24h', '7d', 'phase', 'grow'];

interface TimelineProps {
  spaceId: string;
  /** The title row, where this is the whole screen; inside the tent page the page's own header is the title. */
  heading?: React.ReactNode;
  /** Whether the top bar's "how old is this" line is this read's to answer; the page it sits in answers it otherwise. */
  reportsAge?: boolean;
}

/**
 * The Timeline, reached from the tab bar for the place last looked at and from
 * a tent's own Timeline tab. One screen either way: the frame at the cursor,
 * the stacked panels under it, the output lanes and the rail, all of one
 * window and all moved by one cursor.
 *
 * The state is keyed by the space, so picking another place starts it clean
 * rather than asking the new one about the old one's grow.
 */
export function Timeline({ spaceId, heading, reportsAge }: TimelineProps) {
  return <TimelineFor key={spaceId} spaceId={spaceId} heading={heading} reportsAge={reportsAge} />;
}

function TimelineFor({ spaceId, heading, reportsAge = false }: TimelineProps) {
  const { t } = useTranslation();
  const now = useNow();
  const [range, setRange] = useState<TimelineRange>('24h');
  /** Set only when a stretch chip is tapped: the two rolling ranges let the server pick the grow standing here. */
  const [pinned, setPinned] = useState<string | null>(null);
  /** Null is "the end of the window", so a refresh carries the cursor along with it rather than pinning it to an instant that has scrolled out. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const timeline = useTimeline(spaceId, range, pinned);
  const data = timeline.data;
  const growId = pinned ?? data?.growId ?? null;
  const grow = useGrow(growId);

  useReportFreshness(reportsAge && timeline.dataUpdatedAt ? fetchedAt(timeline.dataUpdatedAt) : null);

  const scrub = useScrub(fraction => {
    if (data) setCursor(at(data.startsAt) + fraction * (at(data.endsAt) - at(data.startsAt)));
  });

  const chips = (
    // Which days are drawn is the answer to the chips, not one of them, so it
    // stands beside the row rather than inside it: a phone cannot fit six chips
    // and would otherwise park the range past the end of a scroller that
    // advertises nothing, on the one screen where the window is not named
    // anywhere else.
    <div className={styles.rangeBar}>
      <div className={`${ui.scrollRow} ${styles.chips}`} role="group" aria-label={t('timeline.rangeLabel')}>
        {RANGES.map(one => (
          <button
            key={one}
            type="button"
            className={ui.chip}
            aria-pressed={one === range}
            // A stretch of a grow cannot be asked for where nothing is growing, so it is not offered there.
            disabled={rangeNeedsGrow(one) && growId === null}
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
        {data && data.grows.length > 1 ? (
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
            on the grow this row shows, and this row is where the window is
            chosen. With no grow shown there is nothing for it to open on: a
            chart is drawn about a grow, and the panels below already draw the
            place. */}
        {growId !== null ? (
          <Link to={`/charts?space=${spaceId}&grow=${growId}`} className={ui.chip}>
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

  const from = at(data.startsAt);
  const to = at(data.endsAt);
  const here = Math.min(to, Math.max(from, cursor ?? to));
  const frames = data.cameras.filter(camera => camera.frames.length > 0);

  return (
    // Busy while a chip's window is still on its way: what is drawn is the
    // window before it, which is worth saying without taking it off the screen.
    <div className={styles.screen} aria-busy={timeline.isPlaceholderData}>
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
          onScrub={setCursor}
        />
      ) : (
        // No camera here: the panels keep their scrubber, which is the one control a thumb has.
        <div className={ui.transport}>
          <Slider from={from} to={to} cursor={here} onScrub={setCursor} />
        </div>
      )}

      <ScrubHeader timeline={data} cursor={here} />

      {/* Two different states, and only the payload can tell them apart: a
          metric whose every point in the window is null has no panel, so an
          empty stack means "nothing was heard here" as often as it means
          "nothing measures here". `lastReadingAt` is the last time anything
          standing here measured at all, whenever that was. */}
      {data.panels.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note} ${styles.empty}`}>
          {data.lastReadingAt === null ? t('timeline.noPanels') : t('timeline.quietWindow', { age: ageLabel(data.lastReadingAt, now) })}
        </p>
      ) : null}
      {data.panels.map((panel, index) => (
        <Panel
          key={panel.metric}
          panel={panel}
          nights={data.nights}
          alarms={data.alarms}
          from={from}
          to={to}
          cursor={here}
          scrub={scrub}
          explain={index === 0}
        />
      ))}

      <Lanes timeline={data} from={from} to={to} cursor={here} now={now} selected={opened} onSelect={setOpened} onScrub={setCursor} scrub={scrub} />
    </div>
  );
}

/**
 * What was true at the cursor, written into a header that stays where it is.
 * A tooltip that follows the pointer cannot be read on a phone at all - the
 * thumb is over it - so the reading is pinned above the panels instead, and
 * sticks to the top of the screen while the stack is scrolled.
 */
function ScrubHeader({ timeline, cursor }: { timeline: SpaceTimeline; cursor: number }) {
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
      <span className={styles.scrubTime}>{stampOf(cursor, at(timeline.endsAt) - at(timeline.startsAt), zone)}</span>
      {timeline.panels.map(panel => {
        const value = pointAt(panel, cursor);
        return (
          <span key={panel.metric} className={styles.scrubValue} data-metric={panel.metric}>
            {value === null ? '—' : figure(value, panel.metric)} <span className={styles.scrubUnit}>{UNIT[panel.metric] ?? ''}</span>
          </span>
        );
      })}
      {/* A place with no outputs says nothing here rather than "everything off", which would be a claim about hardware it has not got - and neither does one whose outputs nobody has heard from at the cursor. */}
      {heard.length === 0 ? null : (
        <span className={styles.scrubOutputs}>
          {running.length === 0
            ? t('timeline.allOff')
            : running.map(lane => t('timeline.outputOn', { output: t(`timeline.output.${lane.output}`, { defaultValue: lane.output }) })).join(' · ')}
        </span>
      )}
    </p>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "day 34" over one day of a grow, "day 33–34" where the window straddles the turn, nothing at all without a grow. */
const dayLabel = (t: Translate, timeline: SpaceTimeline): string => {
  if (timeline.dayFrom === null || timeline.dayTo === null) return '';
  return timeline.dayFrom === timeline.dayTo
    ? t('timeline.dayN', { day: timeline.dayTo })
    : t('timeline.dayRange', { from: timeline.dayFrom, to: timeline.dayTo });
};

/**
 * Dragging across the stack moves the cursor. The surface only claims
 * horizontal gestures, so a thumb still scrolls the page vertically over it,
 * and the pointer is captured on the way down so a drag that wanders off the
 * panel keeps scrubbing.
 */
const useScrub = (onFraction: (fraction: number) => void): React.HTMLAttributes<HTMLDivElement> => {
  const dragging = useRef(false);
  const report = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) onFraction(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  };

  return {
    onPointerDown: event => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      report(event);
    },
    onPointerMove: event => {
      if (dragging.current || event.pointerType === 'mouse') report(event);
    },
    onPointerUp: event => {
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => {
      dragging.current = false;
    },
  };
};
