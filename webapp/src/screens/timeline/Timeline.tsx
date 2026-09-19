import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SpaceTimeline, TimelineRange } from '@fg2/shared-types/v1';
import { useGrow } from '@/api/grows';
import { rangeNeedsGrow, useTimeline } from '@/api/timeline';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useReportFreshness } from '@/ui/freshness';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { figure, UNIT } from '../home/units';
import { CameraFrame, Slider } from './CameraFrame';
import { Lanes } from './Lanes';
import { GUTTER, Panel } from './Panel';
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

  useReportFreshness(reportsAge && timeline.dataUpdatedAt ? new Date(timeline.dataUpdatedAt).toISOString() : null);

  const scrub = useScrub(fraction => {
    if (data) setCursor(at(data.startsAt) + fraction * (at(data.endsAt) - at(data.startsAt)));
  });

  const chips = (
    <div className={styles.chips} role="group" aria-label={t('timeline.rangeLabel')}>
      {RANGES.map(one => (
        <button
          key={one}
          type="button"
          className={`${ui.chip} ${styles.chip}`}
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
    <div className={styles.screen} style={{ '--gutter': `${GUTTER}px` } as React.CSSProperties} aria-busy={timeline.isPlaceholderData}>
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
        <div className={styles.bareSlider}>
          <Slider from={from} to={to} cursor={here} onScrub={setCursor} />
        </div>
      )}

      <ScrubHeader timeline={data} cursor={here} />

      {data.panels.length === 0 ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('timeline.noPanels')}</p> : null}
      {data.panels.map(panel => (
        <Panel key={panel.metric} panel={panel} nights={data.nights} alarms={data.alarms} from={from} to={to} cursor={here} scrub={scrub} />
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
  const running = timeline.outputs.filter(lane => spans(lane.spans, cursor));

  return (
    <p className={`mono ${styles.scrubHead}`} role="status">
      <span className={styles.scrubTime}>{stampOf(cursor, at(timeline.endsAt) - at(timeline.startsAt))}</span>
      {timeline.panels.map(panel => {
        const value = pointAt(panel, cursor);
        return (
          <span key={panel.metric} className={styles.scrubValue} data-metric={panel.metric}>
            {value === null ? '—' : figure(value, panel.metric)} <span className={styles.scrubUnit}>{UNIT[panel.metric] ?? ''}</span>
          </span>
        );
      })}
      {/* A place with no outputs says nothing here rather than "everything off", which would be a claim about hardware it has not got. */}
      {timeline.outputs.length === 0 ? null : (
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
