import { Check, TriangleAlert } from 'lucide-react';
import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath } from '@/app/places';
import type { AlarmRule, CardSetpoint, Device, Me, Metric, OverviewTargets } from '@fg2/shared-types/v1';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { awaitingClimate } from '@/ui/climate-hardware';
import { Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { boundsOf, channelsLabel, ruleTitle } from '../control/alarms/rules';
import { targetFigure, UNIT } from '../home/units';
import { alarmsReach, reachedBy } from '../notifications/reach';
import { plugSummaryOf } from '../control/devices/own-summary';
import { offsetOf } from '../control/targets/targets-draft';
import { hoursFigure, lightWindowOf } from './place';
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

const withUnit = (value: number, metric: Metric): string => `${targetFigure(value, metric)} ${UNIT[metric] ?? ''}`.trim();

const halfOf = (row: CardSetpoint[], withCo2: boolean): string[] =>
  (['temperature', 'humidity', ...(withCo2 ? ['co2'] : [])] as Metric[]).flatMap(metric => {
    const value = row.find(setpoint => setpoint.metric === metric)?.value;
    if (value == null) return [];
    return [metric === 'co2' ? `CO₂ ${withUnit(value, metric)}` : withUnit(value, metric)];
  });

/**
 * "Tag 25 °C · 60 % · CO₂ 900 ppm / Nacht 21 °C · 55 % / Licht 08:00–20:00 ·
 * 12 Std". CO2 is in the day's line because it is only raised while the lamp
 * is on, which the night's line would otherwise seem to contradict.
 */
export function TargetsSummary({
  spaceId,
  targets,
  device,
  now,
  mayChange,
}: {
  spaceId: string;
  targets: OverviewTargets | null;
  device: Device | null;
  now: DateTime;
  mayChange: boolean;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const light = lightWindowOf(device, now, zone);
  // A smart socket has no targets but switch points of its own, which are what it is set to.
  const plug = device ? plugSummaryOf(t, device, offsetOf(now, zone)) : null;
  const rows = plug
    ? plug
    : targets
      ? [
          { label: t('cockpit.targets.day'), parts: halfOf(targets.day, true) },
          { label: t('cockpit.targets.night'), parts: halfOf(targets.night, false) },
        ].filter(row => row.parts.length > 0)
      : [];
  if (light) {
    const parts = [t('cockpit.light.window', { on: light.on, off: light.off, hours: hoursFigure(light.hours) })];
    if (light.limit < 100) parts.push(t('cockpit.targets.limit', { percent: light.limit }));
    rows.push({ label: t('cockpit.targets.light'), parts });
  }

  return (
    <Summary title={t('cockpit.targets.title')} change={mayChange ? controlPath(spaceId) : null}>
      {rows.length > 0 ? (
        <dl className={styles.facts}>
          {rows.map(row => (
            <div key={row.label}>
              <dt>{row.label}</dt>
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
        <p className={ui.note}>{t(device && awaitingClimate(device) ? 'cockpit.targets.awaiting' : 'cockpit.targets.none')}</p>
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
  // Each device keeps its own offline rule, and two of them are one promise to the grower.
  const lines = [...new Set(watching.map(rule => lineOf(t, rule)))];

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
