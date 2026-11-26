import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { OverviewTargets, SpaceTimeline } from '@fg2/shared-types/v1';
import { HOUR_MS } from '@/ui/days';
import { figureWithUnit } from '@/ui/units';
import { extremesOf } from '@/screens/timeline/model';
import { at, stretchesOf } from '@/screens/timeline/window';
import { judgedPanel } from './place';
import styles from './Start.module.css';

/** The size it is drawn at, at most (`.curve`): narrower on a phone's share, and never stretched wider. */
const WIDTH = 140;
const HEIGHT = 26;
/** Air above and below the line: a reading held outside its band all day ran along the plot's edge and read as a rule. */
const INSET = 4;
/** An hour without a sample is a gap in the line; a missed sample is not. */
const GAP_MS = HOUR_MS;

/** The metrics a big figure carries the last day of. */
export type CurveMetric = 'temperature' | 'humidity' | 'vpd';

/**
 * One reading's last day under its figure: the night shaded, the band each
 * stretch was held to behind the line, and nothing else - no axis, no figures.
 * Small, so the figure over it is what is read first; the figure leads to
 * Verlauf, where a curve is read. Nothing where the day holds too little to
 * draw.
 */
export function DayCurve({ timeline, targets, metric }: { timeline: SpaceTimeline; targets: OverviewTargets | null; metric: CurveMetric }) {
  const { t } = useTranslation();
  const clip = useId();
  const from = Date.parse(timeline.startsAt);
  const to = Date.parse(timeline.endsAt);
  const panel = judgedPanel(timeline.panels.find(one => one.metric === metric) ?? null, targets, timeline.startsAt, timeline.endsAt);
  const points = (panel?.points ?? []).filter(point => point.value !== null && at(point.measuredAt) >= from);
  if (!panel || points.length < 2 || to <= from) return null;
  // The lowest and highest sample of the day, as Verlauf's head says them: one figure for one thing.
  const reach = extremesOf(points.map(point => [0, point.value, point.min, point.max] as const));

  const stretches = stretchesOf(panel, timeline.nights, from, to, timeline.transitions);
  const values = points.map(point => point.value as number);
  const edges = stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]);
  const pad = Math.max((Math.max(...values, ...edges) - Math.min(...values, ...edges)) * 0.1, metric === 'vpd' ? 0.02 : 0.2);
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
  const said = t('start.curve', {
    metric: t(`home.metric.${metric}`),
    low: figureWithUnit(reach.low as number, metric),
    high: figureWithUnit(reach.high as number, metric),
  });

  return (
    <svg className={styles.curve} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={said}>
      <clipPath id={clip}>
        <rect width={WIDTH} height={HEIGHT} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {timeline.nights.map(night => {
          const left = x(Math.max(from, at(night.startsAt)));
          const right = x(Math.min(to, at(night.endsAt)));
          return right > left ? (
            <rect key={night.startsAt} className={styles.curveNight} x={left} y={0} width={right - left} height={HEIGHT} />
          ) : null;
        })}
        {stretches.map(stretch => (
          <rect
            key={stretch.from}
            className={styles.curveBand}
            x={x(stretch.from)}
            y={y(stretch.target.band.high)}
            width={Math.max(0, x(stretch.to) - x(stretch.from))}
            height={Math.max(0, y(stretch.target.band.low) - y(stretch.target.band.high))}
          />
        ))}
        <path className={styles.curveLine} data-tone={metric} d={path} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}
