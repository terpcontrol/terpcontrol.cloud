import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Co2Report as Report, Device } from '@fg2/shared-types/v1';
import { useCo2Report, useWriteRefill } from '@/api/co2-report';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { advancedItem, type PlaceContext } from '@/ui/advanced/item';
import { useUnfolded } from '@/ui/advanced/unfolded';
import { decimalFigure } from '@/ui/figures';
import { LoadFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay, useZone } from '@/ui/zone';
import styles from './Co2Report.module.css';

/**
 * The CO2 cylinder: how much the one in use has left, how long it will last at
 * the rate it is going, and what the ones before it gave. The weights are what
 * the grower writes down when a cylinder goes in; the valve's openings are what
 * the device counted meanwhile, and a finished cylinder is what turns openings
 * into grams.
 *
 * It belongs to the place because the cylinder stands there, beside whatever
 * doses from it, and it is under Erweitert because only a tent with a cylinder
 * has one to watch.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a soda cylinder holds, which is what most growers dose from. */
const USUAL_FILL_GRAMS = 425;

/** The hardware here that doses from a cylinder: a fridge or a tent controller, each with a CO2 sensor beside its valve. */
const dosing = (device: Device): boolean => (device.type === 'fridge' || device.type === 'controller') && device.state?.hardware?.co2 !== 'off';

const grams = (value: number): string => decimalFigure(Math.round(value), 0);

/** How many days the cylinder in use lasts at the rate it has gone down since it went in; null until a day of it has been seen. */
export const daysLeftOf = (report: Report, now: DateTime): number | null => {
  const current = report.cylinders.find(cylinder => cylinder.until === null);
  if (!current || report.openingsPerGram === null || report.restGrams === null) return null;

  const days = (now.toMillis() - DateTime.fromISO(current.since).toMillis()) / DAY_MS;
  const used = current.openings / report.openingsPerGram;
  return days >= 1 && used > 0 ? Math.floor(report.restGrams / (used / days)) : null;
};

function Co2Report({ spaceId, devices, mayManage }: PlaceContext) {
  const { t } = useTranslation();
  const zone = useZone();
  const now = useNow();
  const { ref, unfolded } = useUnfolded<HTMLDivElement>();
  const report = useCo2Report(spaceId, unfolded);
  const [adding, setAdding] = useState(false);

  const body = () => {
    if (!unfolded || report.isPending) return <Waiting lines={2} />;
    if (!report.data) return <LoadFailed retry={() => void report.refetch()} />;

    const { cylinders, openingsPerGram, restGrams } = report.data;
    const current = cylinders.find(cylinder => cylinder.until === null) ?? null;
    const finished = cylinders.filter(cylinder => cylinder.until !== null);
    const days = daysLeftOf(report.data, now);
    if (!current) return <p className={ui.note}>{t('co2Report.none')}</p>;

    return (
      <>
        <p className={styles.current}>{t('co2Report.inUse', { day: calendarDay(current.since, zone), grams: grams(current.filledGrams) })}</p>
        {restGrams !== null ? (
          <>
            <p className={styles.rest}>
              {t('co2Report.rest', { grams: grams(restGrams), percent: Math.round((restGrams / current.filledGrams) * 100) })}
              {days !== null ? ` · ${t('co2Report.lasts', { count: days })}` : ''}
            </p>
            <span className={styles.track} aria-hidden>
              <span className={styles.fill} style={{ width: `${Math.min(100, Math.round((restGrams / current.filledGrams) * 100))}%` }} />
            </span>
          </>
        ) : (
          <p className={ui.note}>{t('co2Report.noRate')}</p>
        )}
        {openingsPerGram !== null ? (
          <p className={`mono ${styles.rate}`}>{t('co2Report.rate', { rate: decimalFigure(openingsPerGram, 1), count: finished.length })}</p>
        ) : null}
        {finished.length > 0 ? (
          <ul className={styles.before}>
            {finished.map(cylinder => (
              <li key={cylinder.since} className="mono">
                {t('co2Report.cylinder', {
                  from: calendarDay(cylinder.since, zone),
                  to: calendarDay(cylinder.until ?? cylinder.since, zone),
                  grams: grams(cylinder.filledGrams - (cylinder.restGrams ?? 0)),
                })}
                {cylinder.openingsPerGram !== null ? ` · ${t('co2Report.cylinderRate', { rate: decimalFigure(cylinder.openingsPerGram, 1) })}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  };

  return (
    <SettingRow label={t('co2Report.title')} help="advanced.co2Report" wide>
      <div className={styles.card} ref={ref}>
        {body()}
        {mayManage && report.data ? (
          adding ? (
            <RefillForm
              spaceId={spaceId}
              deviceId={devices.find(dosing)?.id ?? null}
              hadOne={report.data.cylinders.length > 0}
              onDone={() => setAdding(false)}
            />
          ) : (
            <button type="button" className={`${ui.chip} ${styles.add}`} onClick={() => setAdding(true)}>
              {t('co2Report.add')}
            </button>
          )
        ) : null}
      </div>
    </SettingRow>
  );
}

/** A cylinder going in: what it holds, and - where there was one before - what was left in that one. */
function RefillForm({ spaceId, deviceId, hadOne, onDone }: { spaceId: string; deviceId: string | null; hadOne: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const write = useWriteRefill(spaceId);
  const [filled, setFilled] = useState(String(USUAL_FILL_GRAMS));
  const [rest, setRest] = useState('');
  const number = (typed: string) => Number(typed.replace(',', '.'));
  const filledFits = filled.trim() !== '' && number(filled) > 0 && number(filled) <= 100_000;
  const restFits = rest.trim() === '' || (number(rest) >= 0 && number(rest) <= 100_000);

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('co2Report.filled')}</span>
        <input
          className={`${ui.input} ${styles.grams}`}
          inputMode="numeric"
          value={filled}
          aria-label={t('co2Report.filled')}
          onChange={event => setFilled(event.target.value)}
        />
        <span className="mono">g</span>
      </label>
      {hadOne ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('co2Report.leftOver')}</span>
          <input
            className={`${ui.input} ${styles.grams}`}
            inputMode="numeric"
            value={rest}
            aria-label={t('co2Report.leftOver')}
            placeholder={t('co2Report.empty')}
            onChange={event => setRest(event.target.value)}
          />
          <span className="mono">g</span>
        </label>
      ) : null}
      {hadOne ? <p className={ui.note}>{t('co2Report.leftOverNote')}</p> : null}
      <Refused error={write.error} />
      <div className={styles.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!filledFits || !restFits || write.isPending}
          onClick={() =>
            write.mutate({ filledGrams: number(filled), restGrams: rest.trim() === '' ? null : number(rest), deviceId }, { onSuccess: onDone })
          }
        >
          {t('co2Report.save')}
        </button>
        <button type="button" className={ui.button} onClick={onDone}>
          {t('grow.lifecycle.cancel')}
        </button>
      </div>
    </div>
  );
}

export const items = [advancedItem({ scope: 'place', id: 'co2-report', order: 10, shows: ({ devices }) => devices.some(dosing), Item: Co2Report })];
