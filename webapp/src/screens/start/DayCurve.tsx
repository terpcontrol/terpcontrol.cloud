import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { OverviewTargets, SpaceTimeline, TimelinePanel } from '@fg2/shared-types/v1';
import { HOUR_MS } from '@/ui/days';
import { figureWithUnit } from '@/ui/units';
import { extremesOf } from '@/screens/timeline/model';
import { at, stretchesOf } from '@/screens/timeline/window';
import { dayOf, youngFrom, type CurveMetric } from './place';
import styles from './Tiles.module.css';

/** The size it is drawn at; the tile stretches it to its own width and height. */
const WIDTH = 240;
const HEIGHT = 48;
/** Air above and below the line: a reading held outside its band all day ran along the plot's edge and read as a rule. */
const INSET = 4;
/** An hour without a sample is a gap in the line; a missed sample is not. */
const GAP_MS = HOUR_MS;

/**
 * One reading's last day across its tile: the night shaded, behind the line
 * the band of whichever half each stretch belonged to - so a night held two
 * degrees cooler reads as on target rather than as twelve hours out of it -,
 * the line on its own scale and the newest value as a dot. No axis and no
 * figures: the tile states the value, and Verlauf is where a curve is read.
 * An empty frame where the day holds too little to draw, so the tiles of a row
 * keep one shape.
 */
export function DayCurve({
  timeline,
  targets,
  metric,
  label,
}: {
  timeline: SpaceTimeline | null;
  targets: OverviewTargets | null;
  metric: CurveMetric;
  /** The reading's name, which the curve is said by. */
  label: string;
}) {
  const { t } = useTranslation();
  const clip = useId();
  const day = timeline ? dayOf(timeline, targets, metric) : null;
  if (!timeline || !day?.panel || day.points.length < 2 || day.to <= day.from) return <div className={styles.curve} aria-hidden />;
  const { to, points } = day;
  const panel: TimelinePanel = day.panel;
  const young = youngFrom(timeline, metric);
  const from = young ? at(young) : day.from;

  const stretches = stretchesOf(panel, timeline.nights, from, to, timeline.transitions);
  const values = points.map(point => point.value as number);
  const edges = stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]);
  const pad = Math.max((Math.max(...values, ...edges) - Math.min(...values, ...edges)) * 0.1, 0.2);
  const low = Math.min(...values, ...edges) - pad;
  const high = Math.max(...values, ...edges) + pad;
  const x = (time: number) => ((time - from) / (to - from)) * WIDTH;
  const y = (value: number) => HEIGHT - INSET - ((value - low) / (high - low)) * (HEIGHT - 2 * INSET);
  const path = points
    .map((point, index) => {
      const time = at(point.measuredAt);
      const move = index === 0 || time - at(points[index - 1].measuredAt) > GAP_MS ? 'M' : 'L';
      return `${move}${x(time).toFixed(1)},${y(point.value as number).toFixed(1)}`;
    })
    .join(' ');
  const last = points[points.length - 1];
  // The lowest and highest sample of the day, as Verlauf's head says them: one figure for one thing.
  const reach = extremesOf(points.map(point => [0, point.value, point.min, point.max] as const));
  const said = t('start.curve', {
    metric: label,
    low: figureWithUnit(reach.low as number, panel.metric),
    high: figureWithUnit(reach.high as number, panel.metric),
  });

  return (
    <div className={styles.curve} data-tone={metric}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={said}>
        <clipPath id={clip}>
          <rect width={WIDTH} height={HEIGHT} />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          {timeline.nights.map(night => {
            const left = x(Math.max(from, at(night.startsAt)));
            const right = x(Math.min(to, at(night.endsAt)));
            return right > left ? <rect key={night.startsAt} className={styles.night} x={left} y={0} width={right - left} height={HEIGHT} /> : null;
          })}
          {stretches.map(stretch => (
            <rect
              key={stretch.from}
              className={styles.band}
              x={x(stretch.from)}
              y={y(stretch.target.band.high)}
              width={Math.max(0, x(stretch.to) - x(stretch.from))}
              height={Math.max(0, y(stretch.target.band.low) - y(stretch.target.band.high))}
            />
          ))}
          <path className={styles.path} d={path} vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <span
        className={styles.dot}
        style={{ left: `${(x(at(last.measuredAt)) / WIDTH) * 100}%`, top: `${(y(last.value as number) / HEIGHT) * 100}%` }}
        aria-hidden
      />
    </div>
  );
}
