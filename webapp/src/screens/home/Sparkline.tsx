import { useId } from 'react';
import type { CardTrend } from '@fg2/shared-types/v1';
import styles from './Sparkline.module.css';

interface SparklineProps {
  trend: CardTrend | null;
  /** The temperature target, drawn as a band the line should sit in. */
  setpoint: number | null;
  label: string;
}

const WIDTH = 72;
const HEIGHT = 28;
const BAND_HALF_WIDTH = 1;
/** Missing windows in a row before the line breaks: two of the half-hour steps the series is asked in. */
const GAP_WINDOWS = 2;

/**
 * A day of temperature, the size of a stamp: the line, the target band, and
 * nothing else - no axis, no figures, no cursor. What it says is "steady" or
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

  const low = Math.min(...known, setpoint === null ? Infinity : setpoint - BAND_HALF_WIDTH) - 0.5;
  const high = Math.max(...known, setpoint === null ? -Infinity : setpoint + BAND_HALF_WIDTH) + 0.5;
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

  return (
    <div className={styles.frame}>
      <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <clipPath id={clipId}>
          <rect width={WIDTH} height={HEIGHT} />
        </clipPath>
        {setpoint !== null ? (
          <rect
            className={styles.band}
            x={0}
            y={y(setpoint + BAND_HALF_WIDTH)}
            width={WIDTH}
            height={y(setpoint - BAND_HALF_WIDTH) - y(setpoint + BAND_HALF_WIDTH)}
          />
        ) : null}
        <path className={styles.line} d={path} clipPath={`url(#${clipId})`} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={`mono ${styles.caption}`}>24 h</span>
    </div>
  );
}
