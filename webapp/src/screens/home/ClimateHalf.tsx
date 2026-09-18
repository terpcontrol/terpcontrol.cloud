import { useTranslation } from 'react-i18next';
import type { CardSetpoint, CardValue, HomeSpaceCard, Metric } from '@fg2/shared-types/v1';
import { ageAttribute } from '@/ui/age';
import { BAND, livenessOf } from './attention';
import { Sparkline } from './Sparkline';
import styles from './SpaceCard.module.css';
import { figure, UNIT } from './units';

/** Three figures fit beside the sparkline on a phone; VPD stands in for a CO2 sensor that is not there. The rest is the tent page's. */
const SHOWN: Metric[] = ['temperature', 'humidity', 'co2', 'vpd'];
const FIGURES = 3;

/** A target is a round number more often than not, and reads as one. */
const target = (value: number, metric: Metric): string => (Number.isInteger(value) ? String(value) : figure(value, metric));

/**
 * The climate half: each value large, its target as the small grey figure
 * beside it, and a day of temperature at the right. Dimmed by the age the
 * server gave the value - never hidden, never a dash - so an old figure is
 * still the last thing that was known.
 */
export function ClimateHalf({ card }: { card: HomeSpaceCard }) {
  const { t } = useTranslation();
  const shown = SHOWN.flatMap(metric => card.values.filter(value => value.metric === metric)).slice(0, FIGURES);
  const setpointOf = (metric: Metric): CardSetpoint | undefined => card.setpoints.find(setpoint => setpoint.metric === metric);
  const temperatureTarget = setpointOf('temperature')?.value ?? null;

  return (
    <div className={styles.climate} data-liveness={livenessOf(card)}>
      <div className={styles.values}>
        {shown.map(value => (
          <Figure key={value.metric} value={value} setpoint={setpointOf(value.metric) ?? null} />
        ))}
      </div>
      <Sparkline trend={card.trend} setpoint={temperatureTarget} label={t('home.card.sparkline', { name: card.name })} />
    </div>
  );
}

function Figure({ value, setpoint }: { value: CardValue; setpoint: CardSetpoint | null }) {
  const { t } = useTranslation();
  const band = BAND[value.metric];
  const delta = value.value !== null && setpoint?.value != null ? value.value - setpoint.value : null;

  return (
    <div className={styles.value} {...ageAttribute(value.state)}>
      <div className={styles.figureLine}>
        <span className={`figure ${styles.figure}`}>{value.value === null ? t('home.card.noReading') : figure(value.value, value.metric)}</span>
        <span className={`mono ${styles.unit}`}>{UNIT[value.metric] ?? value.metric}</span>
      </div>
      <div className={`mono ${styles.target}`}>
        {setpoint && setpoint.value !== null ? (
          <>
            <span>→ {target(setpoint.value, value.metric)}</span>
            {delta !== null && band !== undefined ? (
              Math.abs(delta) <= band ? (
                <span className={styles.inBand}>{t('home.card.inBand')}</span>
              ) : (
                <span className={styles.offBand}>{`${delta > 0 ? '+' : '−'}${figure(Math.abs(delta), value.metric)}`}</span>
              )
            ) : null}
          </>
        ) : (
          <span>
            {t(`home.metric.${value.metric}`, { defaultValue: value.metric })} · {t('home.card.noTarget')}
          </span>
        )}
      </div>
    </div>
  );
}
