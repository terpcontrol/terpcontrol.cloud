import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowSeriesPoint, MeasurementDefinition, TimelineSpan } from '@fg2/shared-types/v1';
import { Chart, type ChartOption } from '@/charts/Chart';
import { nightColour } from '@/charts/series';
import type { ChartPalette } from '@/charts/tokens';
import { useZone } from '@/ui/zone';
import { at, fractionOf, stampOf } from './window';
import { looseFigure } from '@/ui/figures';
import styles from './Timeline.module.css';

interface ReadingPanelProps {
  definition: MeasurementDefinition;
  points: GrowSeriesPoint[];
  nights: TimelineSpan[];
  from: number;
  to: number;
  cursor: number;
  scrub: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * One of the grow's own measurements over the window: the readings somebody
 * took, each a dot where it was taken and joined by a line, under the band the
 * grower aims at. A grower without a device reads the climate off a hygrometer
 * and writes it down, and the Timeline said "nothing measures here" over those
 * very readings. Beside the cursor stands the last reading taken before it,
 * with when, because between two readings nothing is known.
 */
export function ReadingPanel({ definition, points, nights, from, to, cursor, scrub }: ReadingPanelProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const sorted = useMemo(() => [...points].sort((one, other) => at(one.measuredAt) - at(other.measuredAt)), [points]);
  const scale = useMemo(() => scaleOf(sorted, definition), [sorted, definition]);
  const option = useMemo(
    () => (palette: ChartPalette) => optionOf(palette, sorted, definition, nights, scale, from, to),
    [sorted, definition, nights, scale, from, to],
  );

  const last = [...sorted].reverse().find(point => at(point.measuredAt) <= cursor) ?? null;
  const left = `${fractionOf(cursor, from, to) * 100}%`;
  const band =
    definition.targetMin !== null && definition.targetMax !== null
      ? t('timeline.band', { low: looseFigure(definition.targetMin), high: looseFigure(definition.targetMax) })
      : null;

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        {/* The right-hand side says it was read by hand and when, so the name stands alone. */}
        <span className={styles.metric}>{definition.name}</span>
        <span className={`figure ${styles.panelValue}`}>{last ? looseFigure(last.value) : '—'}</span>
        <span className={`mono ${styles.panelUnit}`}>{definition.unit}</span>
        <span className={`label ${styles.band}`}>
          {last ? t('timeline.readAt', { time: stampOf(at(last.measuredAt), to - from, zone) }) : (band ?? t('timeline.noTarget'))}
        </span>
      </header>
      <div className={styles.plot}>
        <Chart option={option} height="100%" ariaLabel={t('timeline.panelAlt', { metric: definition.name })} />
        <span className={`mono ${styles.scaleHigh}`}>{looseFigure(scale.high)}</span>
        <span className={`mono ${styles.scaleLow}`}>{looseFigure(scale.low)}</span>
        <div className={styles.overlay} {...scrub}>
          <span className={styles.cursor} style={{ left }} />
        </div>
      </div>
    </section>
  );
}

/** The readings and the band, with a little room around them, so a dot never sits on the edge. */
const scaleOf = (points: GrowSeriesPoint[], definition: MeasurementDefinition): { low: number; high: number } => {
  const values = [...points.map(point => point.value), definition.targetMin, definition.targetMax].filter((value): value is number => value !== null);
  if (values.length === 0) return { low: 0, high: 1 };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.15, Math.abs(high) * 0.05, 0.5);
  return { low: Math.floor(low - pad), high: Math.ceil(high + pad) };
};

const optionOf = (
  palette: ChartPalette,
  points: GrowSeriesPoint[],
  definition: MeasurementDefinition,
  nights: TimelineSpan[],
  scale: { low: number; high: number },
  from: number,
  to: number,
): ChartOption => ({
  animation: false,
  grid: { left: 0, right: 0, top: 0, bottom: 0 },
  xAxis: { type: 'time', min: from, max: to, show: false },
  yAxis: { type: 'value', min: scale.low, max: scale.high, show: false },
  series: [
    {
      type: 'line',
      data: points.map(point => [at(point.measuredAt), point.value]),
      showSymbol: true,
      symbolSize: 7,
      // Readings of single plants are dots side by side, not a line zigzagging between them.
      lineStyle: { width: definition.perPlant ? 0 : 1.6, color: palette.ink },
      itemStyle: { color: palette.ink },
      markArea: {
        silent: true,
        data: [
          ...nights.map(night => [
            { xAxis: at(night.startsAt), itemStyle: { color: nightColour(palette, nights.length) } },
            { xAxis: at(night.endsAt) },
          ]),
          ...(definition.targetMin !== null || definition.targetMax !== null
            ? [
                [
                  { xAxis: from, yAxis: definition.targetMin ?? scale.low, itemStyle: { color: palette.band } },
                  { xAxis: to, yAxis: definition.targetMax ?? scale.high },
                ],
              ]
            : []),
        ],
      },
    },
  ],
});
