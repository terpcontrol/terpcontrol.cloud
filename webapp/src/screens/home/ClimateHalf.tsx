import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { CardSetpoint, CardValue, HomeSpaceCard, Metric } from '@fg2/shared-types/v1';
import { ageAttribute, valueAge } from '@/ui/age';
import { livenessOf } from './attention';
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
 * beside it, and a day of temperature at the right. Dimmed by the age the value
 * has at the moment it is drawn - never hidden, never a dash - so an old figure
 * is still the last thing that was known, and a card the screen has stopped
 * being able to refresh goes grey rather than staying bright on a verdict that
 * has outlived its reading.
 */
export function ClimateHalf({ card, now }: { card: HomeSpaceCard; now: DateTime }) {
  const { t } = useTranslation();
  const shown = SHOWN.flatMap(metric => card.values.filter(value => value.metric === metric)).slice(0, FIGURES);
  const setpointOf = (metric: Metric): CardSetpoint | undefined => card.setpoints.find(setpoint => setpoint.metric === metric);
  const temperatureTarget = setpointOf('temperature')?.value ?? null;

  return (
    <div className={styles.climate} data-liveness={livenessOf(card, now)}>
      <div className={styles.values}>
        {shown.map(value => (
          <Figure key={value.metric} value={value} setpoint={setpointOf(value.metric) ?? null} now={now} />
        ))}
      </div>
      <Sparkline trend={card.trend} setpoint={temperatureTarget} label={t('home.card.sparkline', { name: card.name })} />
    </div>
  );
}

function Figure({ value, setpoint, now }: { value: CardValue; setpoint: CardSetpoint | null; now: DateTime }) {
  const { t } = useTranslation();
  // The band is the server's, the same width the verdict judges by.
  const band = setpoint?.band ?? null;
  const delta = value.value !== null && setpoint?.value != null ? value.value - setpoint.value : null;

  return (
    <div className={styles.value} {...ageAttribute(valueAge(value, now))}>
      <div className={styles.figureLine}>
        <span className={`figure ${styles.figure}`}>{value.value === null ? t('home.card.noReading') : figure(value.value, value.metric)}</span>
        <span className={`mono ${styles.unit}`}>{UNIT[value.metric] ?? value.metric}</span>
      </div>
      <div className={`mono ${styles.target}`}>
        {setpoint && setpoint.value !== null ? (
          <>
            <span>→ {target(setpoint.value, value.metric)}</span>
            {delta !== null && band !== null ? (
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
