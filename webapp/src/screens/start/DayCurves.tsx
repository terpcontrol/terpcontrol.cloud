import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OverviewTargets, SpaceTimeline } from '@fg2/shared-types/v1';
import { useTimeline } from '@/api/timeline';
import { timelinePath } from '@/app/places';
import { HOUR_MS } from '@/ui/days';
import { figure, figureWithUnit } from '@/ui/units';
import { at, stretchesOf } from '@/screens/timeline/window';
import { judgedPanel } from './place';
import styles from './Start.module.css';

/** The same read Verlauf opens on, so the page behind this card is already in hand. */
const LAST_DAY = { range: '24h' as const };

const WIDTH = 240;
const HEIGHT = 56;
/** An hour without a sample is a gap in the line; a missed sample is not. */
const GAP_MS = HOUR_MS;

/**
 * The last day of temperature and humidity as two small curves, where a
 * desktop has the room: the night shaded, the band each stretch was held to
 * behind the line. No axis and no figures - the readings state the values, and
 * the card leads to Verlauf, where a curve is read.
 */
export function DayCurves({ spaceId, targets }: { spaceId: string; targets: OverviewTargets | null }) {
  const { t } = useTranslation();
  const timeline = useTimeline(spaceId, LAST_DAY).data;
  if (!timeline) return null;

  return (
    <Link to={timelinePath(spaceId)} className={styles.day}>
      <span className={styles.cardTitle}>{t('start.day')}</span>
      <Curve timeline={timeline} targets={targets} metric="temperature" />
      <Curve timeline={timeline} targets={targets} metric="humidity" />
      <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
    </Link>
  );
}

function Curve({ timeline, targets, metric }: { timeline: SpaceTimeline; targets: OverviewTargets | null; metric: 'temperature' | 'humidity' }) {
  const { t } = useTranslation();
  const clip = useId();
  const from = Date.parse(timeline.startsAt);
  const to = Date.parse(timeline.endsAt);
  const panel = judgedPanel(timeline.panels.find(one => one.metric === metric) ?? null, targets, timeline.startsAt, timeline.endsAt);
  const points = (panel?.points ?? []).filter(point => point.value !== null && at(point.measuredAt) >= from);
  if (!panel || points.length < 2 || to <= from) return null;

  const stretches = stretchesOf(panel, timeline.nights, from, to, timeline.transitions);
  const values = points.map(point => point.value as number);
  const edges = stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]);
  const pad = Math.max((Math.max(...values, ...edges) - Math.min(...values, ...edges)) * 0.1, 0.2);
  const low = Math.min(...values, ...edges) - pad;
  const high = Math.max(...values, ...edges) + pad;
  const x = (time: number) => ((time - from) / (to - from)) * WIDTH;
  const y = (value: number) => HEIGHT - ((value - low) / (high - low)) * HEIGHT;
  const path = points
    .map((point, index) => {
      const time = at(point.measuredAt);
      const move = index === 0 || time - at(points[index - 1].measuredAt) > GAP_MS ? 'M' : 'L';
      return `${move}${x(time).toFixed(1)},${y(point.value as number).toFixed(1)}`;
    })
    .join(' ');
  const said = t('start.curve', {
    metric: t(`home.metric.${metric}`),
    low: figureWithUnit(Math.min(...values), metric),
    high: figureWithUnit(Math.max(...values), metric),
  });

  return (
    <span className={styles.curve}>
      {/* What the curve is of and what it ran between, so the shape is read as a reading. */}
      <span className={styles.curveLabel} data-tone={metric} aria-hidden>
        {t(`home.metric.${metric}`)}
        <small>{t('start.curveSpan', { low: figure(Math.min(...values), metric), high: figureWithUnit(Math.max(...values), metric) })}</small>
      </span>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={said}>
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
    </span>
  );
}
