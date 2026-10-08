import { Check, TriangleAlert } from 'lucide-react';
import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath } from '@/app/places';
import type { AlarmRule, CardSetpoint, Device, DeviceLive, Me, Metric, OverviewTargets } from '@fg2/shared-types/v1';
import { restsInGermination, watchNow } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { awaitingClimate } from '@/ui/climate-hardware';
import { Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { boundsOf, channelsLabel, ruleTitle } from '../control/alarms/rules';
import { targetWithUnit } from '@/ui/units';
import { alarmsReach, reachedBy } from '../notifications/reach';
import { fanSummaryOf, plugSummaryOf } from '../control/devices/own-summary';
import { offsetOf } from '../control/targets/targets-draft';
import { holdsHumidity, storedShapeOf, type Half } from '../control/targets/day-night';
import { darkReasonOf, halfNowOf, hoursFigure, lightWindowOf, type HumidifierHold } from './place';
import { PlanLine } from './PlanLine';
import styles from './Cockpit.module.css';

/**
 * What the place is set to and what watches over it, each in a few short lines
 * with the one way to change it. The cockpit says what is true; Control is where
 * it is changed, so these are summaries and never a second set of sliders.
 */

function Summary({ title, change, children }: { title: string; change: string | null; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className={`${ui.card} ${styles.summary}`} aria-label={title}>
      <header className={styles.summaryHead}>
        <span className="label">{title}</span>
        {change ? (
          <Link to={change} className={`${ui.button} ${styles.change}`}>
            {t('cockpit.change')}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

const halfOf = (row: CardSetpoint[], withCo2: boolean, withHumidity: boolean): string[] =>
  (['temperature', ...(withHumidity ? ['humidity'] : []), ...(withCo2 ? ['co2'] : [])] as Metric[]).flatMap(metric => {
    const value = row.find(setpoint => setpoint.metric === metric)?.value;
    if (value == null) return [];
    return [metric === 'co2' ? `CO₂ ${targetWithUnit(value, metric)}` : targetWithUnit(value, metric)];
  });

interface Row {
  label: string;
  parts: string[];
  /** The half this row's figures hold in, which is marked while it holds. */
  half?: Half;
}

/**
 * "Tag 25 °C · 60 % · CO₂ 900 ppm / Nacht 21 °C · 55 % / Licht 08:00–20:00 ·
 * 12 Std", the half that holds now marked. CO2 is in the day's line because it
 * is only dosed by day, which the night's line would otherwise seem to
 * contradict. Where the device has no day and night there is one line, named
 * by what it holds: a drying room's, a germination's, or the one climate held
 * round the clock at 24 hours of light or none.
 */
export function TargetsSummary({
  spaceId,
  targets,
  device,
  live,
  now,
  offline = false,
  mayChange,
  humidifierHold = null,
}: {
  spaceId: string;
  targets: OverviewTargets | null;
  device: Device | null;
  live?: DeviceLive;
  now: DateTime;
  offline?: boolean;
  mayChange: boolean;
  /** The humidity a humidifier holds while the device germinates, which germination's line names beside its temperature. */
  humidifierHold?: HumidifierHold | null;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const light = lightWindowOf(device, now, zone);
  const dark = darkReasonOf(device);
  const shape = storedShapeOf(device);
  const regime = shape?.regime ?? 'cycle';
  const humidity = shape ? holdsHumidity(shape) : true;
  const holding = halfNowOf(device, live, now, offline);
  // A smart socket has no targets but switch points of its own, which are what it is set to.
  const plug = device ? (plugSummaryOf(t, device, offsetOf(now, zone)) ?? fanSummaryOf(t, device)) : null;
  const rows: Row[] = (
    plug
      ? plug
      : !targets
        ? []
        : regime === 'drying' || regime === 'germination'
          ? [
              {
                label: t(`cockpit.targets.${regime}`),
                parts: [
                  ...halfOf(targets.night, false, humidity),
                  ...(regime === 'germination' && humidifierHold ? [targetWithUnit(humidifierHold.target, 'humidity')] : []),
                ],
              },
            ]
          : regime === 'always'
            ? [{ label: t('cockpit.targets.roundTheClock'), parts: halfOf(targets.day, true, humidity) }]
            : regime === 'never'
              ? [{ label: t('cockpit.targets.roundTheClock'), parts: halfOf(targets.night, false, humidity) }]
              : [
                  { label: t('cockpit.targets.day'), parts: halfOf(targets.day, true, humidity), half: 'day' as const },
                  { label: t('cockpit.targets.night'), parts: halfOf(targets.night, false, humidity), half: 'night' as const },
                ]
  ).filter((row: Row) => row.parts.length > 0);
  if (light) {
    // A day-long light goes off a second before it comes on, which is no time to name.
    const parts = [
      light.always
        ? t('cockpit.light.always')
        : light.never
          ? t('cockpit.light.never')
          : t('cockpit.light.window', { on: light.on, off: light.off, hours: hoursFigure(light.hours) }),
    ];
    if (light.limit < 100 && !light.never) parts.push(t('cockpit.targets.limit', { percent: light.limit }));
    rows.push({ label: t('cockpit.targets.light'), parts });
  } else if (dark && dark !== 'off') {
    rows.push({ label: t('cockpit.targets.light'), parts: [t(`cockpit.light.dark.${dark}`)] });
  }

  return (
    // A socket's or a lamp's are its settings, which is also what the page behind the link is called.
    <Summary
      title={t(plug || device?.type === 'light' ? 'ownPanel.title' : 'cockpit.targets.title')}
      change={mayChange ? controlPath(spaceId) : null}
    >
      {rows.length > 0 ? (
        <dl className={styles.facts}>
          {rows.map(row => (
            <div key={row.label}>
              <dt>
                {row.label}
                {row.half && row.half === holding ? (
                  <span className={styles.nowMark} data-by={offline ? 'schedule' : undefined}>
                    {t(offline ? 'cockpit.targets.bySchedule' : 'cockpit.targets.now')}
                  </span>
                ) : null}
              </dt>
              <dd className="mono">
                {row.parts.map((part, index) => (
                  <Fragment key={part}>
                    {index > 0 ? ' · ' : ''}
                    <span className={styles.part}>{part}</span>
                  </Fragment>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={ui.note}>
          {t(dark === 'off' ? 'cockpit.targets.controlOff' : device && awaitingClimate(device) ? 'cockpit.targets.awaiting' : 'cockpit.targets.none')}
        </p>
      )}
      {device?.control ? <PlanLine spaceId={spaceId} device={device} now={now} /> : null}
    </Summary>
  );
}

/** How many rules a summary names before it counts the rest. */
const NAMED = 3;

/**
 * "Gerät offline · Zu warm über 30 °C" and whether any of it reaches the
 * grower: a rule that tells nobody is not watching over anything, so the
 * summary says so and links to the fix. The bounds are written out in words:
 * in a run of prose "›" reads as the chevron every link beside it ends in.
 */
export function AlarmsSummary({ spaceId, devices, me, mayChange }: { spaceId: string; devices: Device[]; me: Me | undefined; mayChange: boolean }) {
  const { t } = useTranslation();
  const rules = useAlarmRulesOf(devices.map(device => device.id));
  const watching = [...rules.rules.values()].filter(rule => rule.enabled);
  // The stage's "too humid" that rests while its device germinates is said to rest, rather than promised,
  // and one that warns there is said at the line it warns at.
  const said = (rule: AlarmRule) => {
    const device = devices.find(one => one.id === rule.deviceId);
    const workmode = device?.configuration?.workmode;
    const line = lineOf(t, { ...rule, watch: watchNow(rule, workmode) });
    return device && restsInGermination(rule, workmode, device.control?.germinationChoices) ? t('cockpit.alarms.resting', { line }) : line;
  };
  // Each device keeps its own offline rule, and two of them are one promise to the grower.
  const lines = [...new Set(watching.map(said))];

  return (
    <Summary title={t('cockpit.alarms.title')} change={mayChange ? controlPath(spaceId, 'alarms') : null}>
      {rules.isPending ? (
        <Waiting lines={1} />
      ) : (
        <p className={styles.alarmLine}>
          {lines.length === 0
            ? t('cockpit.alarms.none')
            : [...lines.slice(0, NAMED), ...(lines.length > NAMED ? [t('cockpit.alarms.more', { count: lines.length - NAMED })] : [])].join(' · ')}
        </p>
      )}
      {me && watching.length > 0 ? (
        alarmsReach(me) ? (
          <p className={`mono ${styles.reach}`} data-reach="yes">
            <Check size={13} strokeWidth={2} aria-hidden />
            {t('cockpit.alarms.reaches', { channels: channelsLabel(t, reachedBy(me)) })}
          </p>
        ) : (
          <Link to="/me/notifications" className={`mono ${styles.reach}`} data-reach="no">
            <TriangleAlert size={13} strokeWidth={2} aria-hidden />
            {t('cockpit.alarms.reachesNobody')}
          </Link>
        )
      ) : null}
    </Summary>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const lineOf = (t: Translate, rule: AlarmRule): string => {
  const title = ruleTitle(t, rule);
  if (rule.origin === 'always') return title;
  const { upper, lower } = boundsOf(rule.watch);
  const bound =
    upper !== null && lower !== null
      ? t('cockpit.alarms.outside', { lower, upper })
      : upper !== null
        ? t('cockpit.alarms.above', { value: upper })
        : lower !== null
          ? t('cockpit.alarms.below', { value: lower })
          : null;
  return bound ? `${title} ${bound}` : title;
};
