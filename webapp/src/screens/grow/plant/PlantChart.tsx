import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowMeasurementSeries, GrowSeriesPoint, MeasurementDefinition, Plant, TimelineSpan } from '@fg2/shared-types/v1';
import { Chart, type ChartOption } from '@/charts/Chart';
import type { ChartPalette } from '@/charts/tokens';
import ui from '@/ui/ui.module.css';
import { bandEnds, bandOf } from '../measurements/definitions';
import styles from './Plant.module.css';

/** How much room the figures need above and below the line before the card looks cramped. */
const PADDING = 0.08;

/** Tall enough for the shape of a curve and no taller: this is a page about a plant, not a charts view. */
const HEIGHT = 120;

interface PlantChartProps {
  definition: MeasurementDefinition;
  series: GrowMeasurementSeries;
  plantId: string;
  label: string;
  /** The rest of the grow's plants, so that each faint line is a plant with a name. */
  others: Plant[];
  nights: TimelineSpan[];
  from: number;
  to: number;
}

/**
 * One of the plant's own measurements over the grow: its readings drawn as a
 * line, the band it is aimed at behind them, and the other plants of the grow
 * faintly beside it.
 *
 * The siblings are there because that is the comparison a grower makes - this
 * one against the rest of the tent - and they are drawn thin so that the plant
 * whose page this is stays the subject. Each of them is a line of its own and
 * carries its name in the legend: a measurement taken per plant read as one
 * curve across all of them would be a zig-zag nobody measured.
 */
export function PlantChart({ definition, series, plantId, label, others, nights, from, to }: PlantChartProps) {
  const { t } = useTranslation();
  const mine = useMemo(() => series.points.filter(point => point.plantId === plantId), [series.points, plantId]);
  const beside = useMemo(() => byPlant(series.points, others), [series.points, others]);
  const scale = useMemo(() => scaleOf(series.points, definition), [series.points, definition]);
  const option = useMemo(
    () => (palette: ChartPalette) => optionOf(palette, mine, beside, definition, nights, scale, from, to),
    [mine, beside, definition, nights, scale, from, to],
  );

  const band = bandOf(t, definition);

  return (
    <section className={`${ui.card} ${styles.chartCard}`}>
      <header className={styles.chartHead}>
        <span className={styles.chartName}>
          {definition.name}
          {definition.unit ? <span className={`mono ${styles.chartUnit}`}> · {definition.unit}</span> : null}
        </span>
        <span className={`mono ${styles.legend}`}>
          <span className={styles.legendMine}>
            <span className={styles.mineMark} aria-hidden />
            {label}
          </span>
          {beside.map(one => (
            <span key={one.label} className={styles.legendOther}>
              <span className={styles.otherMark} aria-hidden />
              {one.label}
            </span>
          ))}
        </span>
        {band ? <span className="label">{t('grow.measurements.target', { band })}</span> : null}
      </header>
      <Chart option={option} height={HEIGHT} ariaLabel={t('grow.plant.chartAlt', { name: definition.name, label })} />
    </section>
  );
}

/** The other plants' readings, each kept together and named, so one faint line is one plant. */
const byPlant = (points: GrowSeriesPoint[], others: Plant[]): Sibling[] =>
  others
    .map(plant => ({ label: plant.label, points: points.filter(point => point.plantId === plant.id) }))
    .filter(sibling => sibling.points.length > 0);

interface Sibling {
  label: string;
  points: GrowSeriesPoint[];
}

/**
 * What the card is drawn between. Every plant's readings and both ends of the
 * band, so that the band is on the card even in a week where nothing came near
 * it, with a little air either side.
 */
const scaleOf = (points: GrowSeriesPoint[], definition: MeasurementDefinition): { low: number; high: number } => {
  const values = [...points.map(point => point.value), ...bandEnds(definition)].filter((value): value is number => value !== null);
  if (values.length === 0) return { low: 0, high: 1 };

  const low = Math.min(...values);
  const high = Math.max(...values);
  const air = (high - low || Math.abs(high) || 1) * PADDING;

  return { low: low - air, high: high + air };
};

const at = (instant: string): number => new Date(instant).getTime();

/** A token at a fraction of itself, the way the timeline washes its band. */
const wash = (colour: string, alpha: string): string => `${colour}${alpha}`;

/** The green wash behind the line, where the measurement is aimed at anything at all. */
const bandArea = (definition: MeasurementDefinition, scale: { low: number; high: number }, palette: ChartPalette) => {
  const [low, high] = bandEnds(definition);
  if (low === null && high === null) return [];

  return [[{ yAxis: low ?? scale.low, itemStyle: { color: wash(palette.green, '2b') } }, { yAxis: high ?? scale.high }]];
};

const optionOf = (
  palette: ChartPalette,
  mine: GrowSeriesPoint[],
  beside: Sibling[],
  definition: MeasurementDefinition,
  nights: TimelineSpan[],
  scale: { low: number; high: number },
  from: number,
  to: number,
): ChartOption => ({
  animation: false,
  grid: { left: 0, right: 0, top: 4, bottom: 4 },
  xAxis: { type: 'time', min: from, max: to, show: false },
  yAxis: { type: 'value', min: scale.low, max: scale.high, show: false },
  series: [
    ...beside.map(sibling => ({
      type: 'line' as const,
      name: sibling.label,
      data: sibling.points.map(point => [at(point.measuredAt), point.value]),
      showSymbol: false,
      silent: true,
      lineStyle: { width: 1, type: 'dotted' as const, color: palette.muted },
    })),
    {
      type: 'line',
      data: mine.map(point => [at(point.measuredAt), point.value]),
      showSymbol: true,
      symbolSize: 4,
      itemStyle: { color: palette.ink },
      lineStyle: { width: 1.4, color: palette.ink },
      markArea: {
        silent: true,
        data: [
          ...nights.map(night => [{ xAxis: at(night.startsAt), itemStyle: { color: palette['card-2'] } }, { xAxis: at(night.endsAt) }]),
          ...bandArea(definition, scale, palette),
        ],
      },
    },
  ],
});
