import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Metric, TimelineAlarm, TimelinePanel, TimelineSpan } from '@fg2/shared-types/v1';
import { Chart, type ChartOption } from '@/charts/Chart';
import { nightColour } from '@/charts/series';
import type { ChartPalette, ChartToken } from '@/charts/tokens';
import { figure, targetFigure, UNIT } from '../home/units';
import { alarmsOf, at, fractionOf, pointAt, scaleOf, stretchesOf, targetAt, type Stretch } from './window';
import styles from './Timeline.module.css';

/** The signal colour a curve is drawn in. Only the three steered metrics have a panel, so only they have one. */
const METRIC_TOKEN: Partial<Record<Metric, ChartToken>> = { temperature: 'temperature', humidity: 'humidity', co2: 'co2' };

interface PanelProps {
  panel: TimelinePanel;
  nights: TimelineSpan[];
  alarms: TimelineAlarm[];
  from: number;
  to: number;
  cursor: number;
  scrub: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * One metric over the window: the band that was aimed at behind a thin line,
 * the setpoint dashed, the night shaded and the alarms marked. The chart is
 * drawn once per answer and the cursor is an overlay over it, so scrubbing
 * costs no redraw.
 */
export function Panel({ panel, nights, alarms, from, to, cursor, scrub }: PanelProps) {
  const { t } = useTranslation();
  const stretches = useMemo(() => stretchesOf(panel, nights, from, to), [panel, nights, from, to]);
  const scale = useMemo(() => scaleOf(panel, stretches), [panel, stretches]);
  const mine = useMemo(() => alarmsOf(alarms, panel.metric), [alarms, panel.metric]);
  const option = useMemo(
    () => (palette: ChartPalette) => optionOf(palette, panel, stretches, mine, nights, scale, from, to),
    [panel, stretches, mine, nights, scale, from, to],
  );

  const value = pointAt(panel, cursor);
  const target = targetAt(panel, nights, from, to, cursor);
  const left = `${fractionOf(cursor, from, to) * 100}%`;
  const unit = UNIT[panel.metric] ?? '';

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <span className={styles.metric} data-metric={panel.metric}>
          {t(`timeline.metric.${panel.metric}`, { defaultValue: panel.metric })}
        </span>
        <span className={`figure ${styles.panelValue}`}>{value === null ? '—' : figure(value, panel.metric)}</span>
        <span className={`mono ${styles.panelUnit}`}>{unit}</span>
        <span className={`label ${styles.band}`}>
          {target
            ? t('timeline.band', { low: targetFigure(target.band.low, panel.metric), high: targetFigure(target.band.high, panel.metric) })
            : t('timeline.noTarget')}
        </span>
      </header>
      <div className={styles.plot}>
        <Chart option={option} height="100%" ariaLabel={t('timeline.panelAlt', { metric: t(`timeline.metric.${panel.metric}`) })} />
        <span className={`mono ${styles.scaleHigh}`}>{targetFigure(scale.high, panel.metric)}</span>
        <span className={`mono ${styles.scaleLow}`}>{targetFigure(scale.low, panel.metric)}</span>
        <div className={styles.overlay} {...scrub}>
          <span className={styles.cursor} style={{ left }} />
          {value === null ? null : (
            <span className={styles.dot} style={{ left, top: `${(1 - (value - scale.low) / (scale.high - scale.low)) * 100}%` }} />
          )}
        </div>
      </div>
    </section>
  );
}

/** A token at a fraction of itself; the areas behind the line are all washes of one. */
const wash = (colour: string, alpha: string): string => `${colour}${alpha}`;

const optionOf = (
  palette: ChartPalette,
  panel: TimelinePanel,
  stretches: Stretch[],
  alarms: TimelineAlarm[],
  nights: TimelineSpan[],
  scale: { low: number; high: number },
  from: number,
  to: number,
): ChartOption => ({
  animation: false,
  // The gutter the corner figures sit in is left by the stylesheet, which
  // moves the canvas itself over by it: one width, written once, that every
  // panel and every lane reads, and that a wide screen can widen.
  grid: { left: 0, right: 0, top: 0, bottom: 0 },
  xAxis: { type: 'time', min: from, max: to, show: false },
  yAxis: { type: 'value', min: scale.low, max: scale.high, show: false },
  series: [
    {
      type: 'line',
      data: panel.points.map(point => [at(point.measuredAt), point.value]),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.6, color: palette[METRIC_TOKEN[panel.metric] ?? 'ink'] },
      // Drawn in this order, so the night sits behind the band and the alarm over both.
      markArea: {
        silent: true,
        data: [
          ...nights.map(night => [
            { xAxis: at(night.startsAt), itemStyle: { color: nightColour(palette, nights.length) } },
            { xAxis: at(night.endsAt) },
          ]),
          ...stretches.map(stretch => [
            { xAxis: stretch.from, yAxis: stretch.target.band.low, itemStyle: { color: palette.band } },
            { xAxis: stretch.to, yAxis: stretch.target.band.high },
          ]),
          ...alarms.map(alarm => [
            { xAxis: at(alarm.startedAt), itemStyle: { color: wash(palette.alarm, '30') } },
            { xAxis: alarm.endedAt ? at(alarm.endedAt) : to },
          ]),
        ],
      },
    },
    {
      type: 'line',
      // A break after each stretch, so the setpoint steps down into the night rather than sloping into it.
      data: stretches.flatMap(stretch => [
        [stretch.from, stretch.target.setpoint],
        [stretch.to, stretch.target.setpoint],
        [stretch.to, null],
      ]),
      showSymbol: false,
      connectNulls: false,
      silent: true,
      lineStyle: { width: 1, type: 'dashed', color: palette.muted },
    },
  ],
});
