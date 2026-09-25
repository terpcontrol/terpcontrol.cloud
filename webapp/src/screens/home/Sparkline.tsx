import { useId } from 'react';
import type { CardTrend } from '@fg2/shared-types/v1';
import { durationFigure } from '@/ui/age';
import styles from './Sparkline.module.css';

interface SparklineProps {
  trend: CardTrend | null;
  /** The temperature target, drawn as a band the line should sit in. */
  setpoint: number | null;
  label: string;
}

const WIDTH = 200;
const HEIGHT = 40;
const BAND_HALF_WIDTH = 1;
/** Missing windows in a row before the line breaks: two of the half-hour steps the series is asked in. */
const GAP_WINDOWS = 2;
/**
 * The least a stamp this small is scaled over, in degrees. The line is drawn
 * on its own range, so a day that wandered two degrees fills the height; a day
 * that held to a tenth is not blown up into a storm.
 */
const LEAST_SPAN = 2;

/**
 * A day of temperature, the size of a stamp: the line on its own scale, the
 * target band as a tint behind it cut to the line's range, and a dot at
 * now - no axis, no figures, no cursor. What it says is "steady", "rising" or
 * "not", and the timeline is where a person goes to read the rest. It is an
 * SVG rather than a canvas because a card is small and there are many of them,
 * and it is drawn from the card's own answer, so a home full of cards is still
 * one request.
 */
export function Sparkline({ trend, setpoint, label }: SparklineProps) {
  const clipId = useId();

  const points = trend?.points ?? [];
  const known = points.filter((value): value is number => value !== null);
  if (known.length < 2) return <div className={styles.frame} aria-hidden />;

  const band = setpoint === null ? null : { low: setpoint - BAND_HALF_WIDTH, high: setpoint + BAND_HALF_WIDTH };
  let low = Math.min(...known);
  let high = Math.max(...known);
  if (high - low < LEAST_SPAN) {
    const middle = (high + low) / 2;
    low = middle - LEAST_SPAN / 2;
    high = middle + LEAST_SPAN / 2;
  }
  // A little room above and below, so the stroke is not cut by the frame.
  const pad = (high - low) * 0.12;
  low -= pad;
  high += pad;
  const near = band !== null && band.low < high && band.high > low;
  const x = (index: number) => (index / (points.length - 1)) * WIDTH;
  const y = (value: number) => HEIGHT - ((value - low) / (high - low)) * HEIGHT;

  // A window without a sample is bridged; a run of them is a gap in the line,
  // because an hour of silence is worth seeing and a missed sample is not.
  const parts: string[] = [];
  let silent = GAP_WINDOWS;
  points.forEach((value, index) => {
    if (value === null) return void silent++;
    parts.push(`${silent >= GAP_WINDOWS ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`);
    silent = 0;
  });
  const path = parts.join(' ');
  // The dot marks now only where the line reaches it; a line that stopped an
  // hour ago ends where it stopped.
  const now = points[points.length - 1];

  return (
    <div className={styles.frame}>
      <div className={styles.plot}>
        <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
          <clipPath id={clipId}>
            <rect width={WIDTH} height={HEIGHT} />
          </clipPath>
          {band !== null && near ? (
            <g clipPath={`url(#${clipId})`}>
              <rect className={styles.band} x={0} y={y(band.high)} width={WIDTH} height={y(band.low) - y(band.high)} />
              <line className={styles.bandEdge} x1={0} x2={WIDTH} y1={y(band.high)} y2={y(band.high)} vectorEffect="non-scaling-stroke" />
              <line className={styles.bandEdge} x1={0} x2={WIDTH} y1={y(band.low)} y2={y(band.low)} vectorEffect="non-scaling-stroke" />
            </g>
          ) : null}
          <path className={styles.line} d={path} clipPath={`url(#${clipId})`} vectorEffect="non-scaling-stroke" />
        </svg>
        {now !== null && now !== undefined ? (
          <span className={styles.now} style={{ left: '100%', top: `${(y(now) / HEIGHT) * 100}%` }} aria-hidden />
        ) : null}
      </div>
      <span className={`mono ${styles.caption}`}>{durationFigure(24, 'h')}</span>
    </div>
  );
}
