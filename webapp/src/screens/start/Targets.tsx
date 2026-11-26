import type { DateTime } from 'luxon';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CardSetpoint, Device, DeviceLive, OverviewTargets } from '@fg2/shared-types/v1';
import type { Steered } from '@fg2/shared-types/v1-schemas/steering.js';
import { useDevicePlans } from '@/api/plans';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { fieldValue } from '@/ui/advanced/field-values';
import { awaitingClimate, darkReasonOf } from '@/ui/climate-hardware';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { climateChoiceName } from '@/ui/presets';
import { Spoken } from '@/ui/Spoken';
import { targetFigure, UNIT } from '@/ui/units';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import ui from '@/ui/ui.module.css';
import { plugSummaryOf } from '@/screens/control/devices/own-summary';
import { usePlanWords } from '@/screens/control/plan-labels';
import { holdsHumidity, storedShapeOf, type Half } from '@/screens/control/targets/day-night';
import { halfNowOf, lightWindowOf, lightWindowSaid, lightWindowText, setpointOf, type HumidifierHold } from './place';
import { planLineOf } from './plan-line';
import styles from './Start.module.css';

/** A row of the targets' table: a half of the day, or what the device holds round the clock, with a figure per column. */
interface Row {
  label: string;
  /** The half the row's figures hold in, which is marked while it holds. */
  half?: Half;
  figures: Partial<Record<Steered, number>>;
}

const figuresOf = (row: CardSetpoint[], withCo2: boolean): Row['figures'] =>
  Object.fromEntries(
    (['temperature', 'humidity', ...(withCo2 ? ['co2'] : [])] as Steered[]).flatMap(metric => {
      const value = setpointOf(row, metric)?.value;
      return value == null ? [] : [[metric, value]];
    }),
  );

/**
 * What a place's climate is set to, as a table: the halves of the day down,
 * the readings across. CO₂ is in the day's row because it is only dosed by
 * day. Where the device has no day and night there is one row, named by what
 * it holds - a drying room's, a germination's, with the humidity a humidifier
 * holds there, the one climate held round the clock. Null where nothing is set.
 */
const tableOf = (t: Translate, targets: OverviewTargets | null, device: Device | null, hold: HumidifierHold | null): Row[] | null => {
  if (!targets) return null;
  const regime = storedShapeOf(device)?.regime ?? 'cycle';
  const rows: Row[] =
    regime === 'drying' || regime === 'germination'
      ? [
          {
            label: t(`start.targets.${regime}`),
            figures: { ...figuresOf(targets.night, false), ...(regime === 'germination' && hold ? { humidity: hold.target } : {}) },
          },
        ]
      : regime === 'always'
        ? [{ label: t('start.targets.roundTheClock'), figures: figuresOf(targets.day, true) }]
        : regime === 'never'
          ? [{ label: t('start.targets.roundTheClock'), figures: figuresOf(targets.night, false) }]
          : [
              { label: t('start.targets.day'), half: 'day', figures: figuresOf(targets.day, true) },
              { label: t('start.targets.night'), half: 'night', figures: figuresOf(targets.night, false) },
            ];
  const shape = storedShapeOf(device);
  // A shape that holds no humidity leaves its column out, whatever an old document still carries.
  if (shape && !holdsHumidity(shape) && !(regime === 'germination' && hold)) rows.forEach(row => delete row.figures.humidity);
  return rows.some(row => Object.keys(row.figures).length > 0) ? rows : null;
};

/** An AIR fan at a fixed speed, which follows no target: how fast it runs by day and by night. */
const fixedSpeedsOf = (device: Device | null): { day: number; night: number } | null => {
  if (device?.type !== 'fan' || fieldValue(device, 'fanMode') !== 'fixed') return null;
  const day = fieldValue(device, 'fixedDay');
  const night = fieldValue(device, 'fixedNight');
  return typeof day === 'number' && typeof night === 'number' ? { day, night } : null;
};

/**
 * What a device that holds no climate is set to, in lines: a fan at a fixed speed its speeds, a smart socket its
 * switch points. Null for one that holds a climate.
 */
const ownLines = (t: Translate, device: Device | null, offset: number): string[] | null => {
  const speeds = fixedSpeedsOf(device);
  if (speeds) return [`${t('start.targets.day')} ${speeds.day} %`, `${t('start.targets.night')} ${speeds.night} %`];
  const own = device ? plugSummaryOf(t, device, offset) : null;
  return own ? own.map(row => [row.label, ...row.parts].join(' ')) : null;
};

/**
 * "07:00–19:00 · 12 Std · Grenze 65 %": when the lamp is on and how bright it may get. A place dark for its work
 * mode says so instead.
 */
const lightOf = (t: Translate, device: Device | null, now: DateTime, zone: string | null): { text: string; said: string } | null => {
  const light = lightWindowOf(device, now, zone);
  const dark = darkReasonOf(device);
  if (!light) return dark && dark !== 'off' ? { text: t(`start.light.dark.${dark}`), said: t(`start.light.dark.${dark}`) } : null;
  const limit = light.limit < 100 && !light.never ? t('start.targets.limit', { percent: light.limit }) : null;
  return {
    text: [lightWindowText(t, light), limit].filter(Boolean).join(' · '),
    said: [lightWindowSaid(t, light), limit].filter(Boolean).join(', '),
  };
};

/**
 * The targets on Start, master's summary as a table: the halves of the day
 * with a column per reading the device holds a target for, the half in force
 * marked "jetzt" - "laut Zeitplan" for a device not heard from -, and the
 * light. "Ändern ›" leads to Steuerung, where they are changed: Start changes
 * no setting. A running plan says where it stands, a silent device that a
 * change reaches it all the same, and a reader who may not steer the place who
 * can change them. A socket, a fan and a lamp alone say their own settings.
 */
export function Targets({
  spaceId,
  name,
  targets,
  device,
  live,
  humidifierHold,
  offline,
  offStored = false,
  mayManage,
  guest,
  now,
}: {
  spaceId: string;
  name: string;
  targets: OverviewTargets | null;
  device: Device | null;
  /** The device's live read, which says the half it holds now. */
  live: DeviceLive | undefined;
  humidifierHold: HumidifierHold | null;
  offline: boolean;
  /** Regulation off is stored but not yet taken by the device, which still regulates: the card does not call it off. */
  offStored?: boolean;
  mayManage: boolean;
  /** Let in by the place's owner, who is the one to ask for a change. */
  guest: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const plan = useDevicePlans(mayManage && device?.control ? [device.id] : []).plans[0];
  usePlanWords([plan]);
  const planLine = plan ? planLineOf(t, plan, now) : null;
  const own = ownLines(t, device, offsetOf(now, zone));
  const rows = own ? null : tableOf(t, targets, device, humidifierHold);
  const light = lightOf(t, device, now, zone);
  // A lamp alone aims at no climate: what it is set to is its light, never "no targets yet", under a card called so.
  const alone = !own && !rows && device?.type === 'light';
  const holding = halfNowOf(device, live, now, offline);
  const columns = (['temperature', 'humidity', 'co2'] as const).filter(metric => rows?.some(row => row.figures[metric] !== undefined));
  // A climate the place was put on before its device sent its settings is said as what will be set.
  const awaited = device && awaitingClimate(device) ? (device.state.awaitedClimate ?? null) : null;
  // Named by what it holds: a socket its settings, a lamp its light, a fan at a fixed speed its speed, the rest targets.
  const title = alone
    ? t('start.targets.light')
    : fixedSpeedsOf(device)
      ? t('fanSettings.speeds')
      : t(device?.type === 'plug' || device?.type === 'light' ? 'ownPanel.title' : 'start.targets.title');

  let body: ReactNode;
  if (own) {
    body = <Facts className={styles.cardText} facts={own} />;
  } else if (rows) {
    body = (
      <div className={styles.targets} role="table" aria-label={title} style={{ '--columns': columns.length } as CSSProperties}>
        <div role="row" className={styles.targetsRow}>
          <span role="columnheader" />
          {columns.map(metric => (
            <span key={metric} role="columnheader" className={styles.targetsHead}>
              {t(`home.metric.${metric}`)}
            </span>
          ))}
        </div>
        {rows.map(row => (
          <div key={row.label} role="row" className={styles.targetsRow}>
            <span role="rowheader" className={styles.targetsLabel}>
              {row.label}
              {row.half && row.half === holding ? (
                <span className={styles.now} data-by={offline ? 'schedule' : undefined}>
                  {t(offline ? 'start.targets.bySchedule' : 'start.targets.now')}
                </span>
              ) : null}
            </span>
            {columns.map(metric => {
              const value = row.figures[metric];
              return (
                <span key={metric} role="cell" className={styles.targetsValue}>
                  {value === undefined ? (
                    t('home.card.noReading')
                  ) : (
                    <>
                      {targetFigure(value, metric)} <small>{UNIT[metric]}</small>
                    </>
                  )}
                </span>
              );
            })}
          </div>
        ))}
        {light ? (
          <div role="row" className={styles.targetsRow}>
            <span role="rowheader" className={styles.targetsLabel}>
              {t('start.targets.light')}
            </span>
            <span role="cell" className={styles.targetsLight}>
              <Spoken said={light.said}>
                {/* The hours on, then what goes with them quieter: "07:00–19:00 · 12 Std". */}
                <span className={styles.targetsWindow}>{factsOf(light.text)[0]}</span>
                {factsOf(light.text)
                  .slice(1)
                  .map(part => ` · ${part}`)
                  .join('')}
              </Spoken>
            </span>
          </div>
        ) : null}
      </div>
    );
  } else if (alone && light) {
    body = <Facts className={styles.cardText} facts={factsOf(light.text)} />;
  } else {
    body = (
      <p className={styles.cardText}>
        {offStored
          ? t('start.latest.stored', { what: t('control.state.off') })
          : awaited
            ? t('start.targets.awaitingClimate', { climate: climateChoiceName(t, awaited) })
            : t(
                darkReasonOf(device) === 'off'
                  ? 'control.state.off'
                  : device && awaitingClimate(device)
                    ? 'start.targets.awaiting'
                    : 'start.targets.none',
              )}
      </p>
    );
  }

  return (
    <section className={ui.panel} aria-labelledby="start-targets">
      <header className={styles.summaryHead}>
        <h2 className={ui.cardHeading} id="start-targets">
          {title}
        </h2>
        {mayManage ? (
          <Link to={controlPath(spaceId)} className={styles.change}>
            {t('start.change')} ›<span className={ui.visuallyHidden}>{`: ${title}`}</span>
          </Link>
        ) : null}
      </header>
      {body}
      {/* Where nothing but a light is set, the light was said in the table or alone above. */}
      {!rows && !alone && light ? <p className={styles.cardText}>{`${t('start.targets.light')} ${light.text}`}</p> : null}
      {planLine ? <p className={styles.cardText}>{`${t('planLine.plan')} ${planLine}`}</p> : null}
      {offline && mayManage ? <p className={styles.cardText}>{t('start.targets.offlineNote')}</p> : null}
      {guest ? <p className={styles.cardText}>{t('start.targets.whoChanges', { name })}</p> : null}
    </section>
  );
}
