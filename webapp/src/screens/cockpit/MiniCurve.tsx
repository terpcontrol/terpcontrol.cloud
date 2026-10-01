import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimelinePanel, TimelineSpan } from '@fg2/shared-types/v1';
import { Term } from '@/ui/Help';
import { CLOCK, useZone, zonedAt } from '@/ui/zone';
import { at, stretchesOf } from '../timeline/window';
import styles from './Cockpit.module.css';

const WIDTH = 240;
const HEIGHT = 56;
/** An hour without a sample is a gap in the line; a missed sample is not. */
const GAP_MS = 60 * 60 * 1000;

export type Tone = 'temperature' | 'humidity' | 'co2' | 'leaf';

interface MiniCurveProps {
  panel: TimelinePanel | null;
  nights: TimelineSpan[];
  from: number;
  to: number;
  tone: Tone;
  label: string;
  /** The first curve of a page, whose caption says what a curve like it shows. */
  explain?: boolean;
}

/**
 * A day of one reading the size of a tile: the night shaded, behind the line
 * the band of whichever half of the cycle each stretch belonged to - so a night
 * held two degrees cooler reads as on target rather than as twelve hours out of
 * it - and the line on its own scale. No axis and no figures: the tile states
 * the value, and the Timeline is where the curve is read.
 *
 * A place that started reporting today would draw its few hours as a speck at
 * the right of an empty day, so the curve begins where the record does and
 * says since when - in place of the "24 h" an older curve is captioned with.
 */
export function MiniCurve({ panel, nights, from: windowFrom, to, tone, label, explain = false }: MiniCurveProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const clip = useId();
  const points = (panel?.points ?? []).filter(point => point.value !== null && at(point.measuredAt) >= windowFrom);
  if (!panel || points.length < 2 || to <= windowFrom) return <div className={styles.curve} aria-hidden />;

  const first = at(points[0].measuredAt);
  const young = first - windowFrom > (to - windowFrom) * 0.1;
  const from = young ? first : windowFrom;

  const stretches = stretchesOf(panel, nights, from, to);
  const values = points.map(point => point.value as number);
  const edges = stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]);
  let low = Math.min(...values, ...edges);
  let high = Math.max(...values, ...edges);
  const pad = Math.max((high - low) * 0.1, 0.2);
  low -= pad;
  high += pad;

  const x = (time: number) => ((time - from) / (to - from)) * WIDTH;
  const y = (value: number) => HEIGHT - ((value - low) / (high - low)) * HEIGHT;
  const path = points
    .map((point, index) => {
      const time = at(point.measuredAt);
      const move = index === 0 || time - at(points[index - 1].measuredAt) > GAP_MS ? 'M' : 'L';
      return `${move}${x(time).toFixed(1)},${y(point.value as number).toFixed(1)}`;
    })
    .join(' ');
  const last = points[points.length - 1];
  const since = t('cockpit.tile.since', { time: zonedAt(first, zone).toFormat(CLOCK) });

  return (
    <div className={styles.curve}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <clipPath id={clip}>
          <rect width={WIDTH} height={HEIGHT} />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          {nights.map(night => {
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
          <path className={styles.curveLine} data-tone={tone} d={path} vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <span
        className={styles.curveDot}
        data-tone={tone}
        style={{ left: `${(x(at(last.measuredAt)) / WIDTH) * 100}%`, top: `${(y(last.value as number) / HEIGHT) * 100}%` }}
        aria-hidden
      />
      {young ? (
        <span className={`mono ${styles.curveSince}`}>{explain ? <Term topic="dayCurve">{since}</Term> : since}</span>
      ) : explain ? (
        <span className={`mono ${styles.curveCaption}`}>
          <Term topic="dayCurve">{t('cockpit.tile.day')}</Term>
        </span>
      ) : null}
    </div>
  );
}
