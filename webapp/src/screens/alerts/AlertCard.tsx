import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Alert, AlarmRule, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { useSilenceAlarmRule, useUnsilenceAlarmRule } from '@/api/alarm-rules';
import { useDeviceCommand } from '@/api/commands';
import { ageAttribute } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { figure, targetFigure, UNIT } from '../home/units';
import { clock, crossedBound, isAhead, lastedLabel, spanLabel } from './inbox';
import styles from './Alerts.module.css';

/** How long a silence from the card holds, and how long maintenance does. */
export const SILENCE_SECONDS = 3600;
export const MAINTENANCE_SECONDS = 900;

/** Who and what an alert is about, looked up once for the whole inbox. */
export interface AlertNames {
  spaces: Map<string, string>;
  devices: Map<string, string>;
  cameras: Map<string, string>;
}

type Translate = ReturnType<typeof useTranslation>['t'];

interface AlertCardProps {
  alert: Alert;
  /** The rule that raised it, where it still exists; null for a health-loop alert and for a rule since removed. */
  rule: AlarmRule | null;
  names: AlertNames;
  mayManage: boolean;
  now: DateTime;
}

/**
 * One event, graded by its severity on the left edge and drawn from the
 * server's instants alone. The first line says where and what, the second when
 * and for how long; a resolved card keeps both, dimmed and dated, because a
 * night the tent ran hot is still worth reading in the morning.
 *
 * What can be done about it sits on the card, and only while it is open:
 * silence the rule, put the device into maintenance, open the timeline it
 * happened in, or edit the rule. Nothing here claims a device heard a command;
 * what the server answered is said underneath.
 */
export function AlertCard({ alert, rule, names, mayManage, now }: AlertCardProps) {
  const { t } = useTranslation();
  const open = alert.resolvedAt === null;
  const place = placeOf(alert, names);
  const what = whatOf(t, alert, rule, names, now);

  return (
    <li className={`${ui.card} ${styles.card}`} data-severity={alert.severity} {...(open ? {} : ageAttribute('stale'))}>
      <div className={styles.lines}>
        <p className={styles.what}>{[place, what].filter(Boolean).join(' · ')}</p>
        <p className={`mono ${styles.meta}`}>{metaOf(t, alert, rule, now)}</p>
      </div>

      {open && mayManage ? (
        <OpenChips alert={alert} rule={rule} now={now} />
      ) : !open && alert.spaceId ? (
        <div className={styles.chips}>
          <TimelineChip spaceId={alert.spaceId} />
        </div>
      ) : null}
    </li>
  );
}

/** The space the alert names, or the device or camera where it names no space. */
const placeOf = (alert: Alert, names: AlertNames): string | null => {
  if (alert.spaceId) return names.spaces.get(alert.spaceId) ?? null;
  if (alert.deviceId) return names.devices.get(alert.deviceId) ?? null;
  if (alert.cameraId && alert.kind !== 'camera_stale') return names.cameras.get(alert.cameraId) ?? null;
  return null;
};

const metricName = (t: Translate, metric: Metric): string =>
  t(`home.metric.${metric}`, { defaultValue: t(`alerts.metric.${metric}`, { defaultValue: metric }) });

const outputName = (t: Translate, output: OutputMetric): string => t(`alerts.output.${output}`, { defaultValue: output });

/**
 * The event in as few words as the board allows: the reading and the edge it
 * crossed where the rule is still there to say what it watched, the bare kind
 * where it is not.
 */
const whatOf = (t: Translate, alert: Alert, rule: AlarmRule | null, names: AlertNames, now: DateTime): string => {
  switch (alert.kind) {
    case 'offline':
      return alert.resolvedAt ? t('alerts.what.wasOffline') : t('alerts.what.offline', { age: lastedLabel(alert, now) });
    case 'camera_stale':
      return t('alerts.what.cameraStale', {
        camera: (alert.cameraId && names.cameras.get(alert.cameraId)) || t('alerts.what.camera'),
        time: clock(alert.startedAt),
      });
    case 'threshold':
      return rule
        ? watched(t, alert, rule, now)
        : alert.value === null
          ? t('alerts.what.threshold')
          : t('alerts.what.thresholdValue', { value: alert.value });
  }
};

const watched = (t: Translate, alert: Alert, rule: AlarmRule, now: DateTime): string => {
  const { watch } = rule;
  if (watch.kind === 'output_running') {
    return t('alerts.what.running', { output: outputName(t, watch.output), for: spanLabel(rule.forSeconds, now) });
  }

  const value = alert.value ?? alert.extremeValue;
  const crossed = crossedBound(watch, value);
  const name = watch.kind === 'reading' ? metricName(t, watch.metric) : outputName(t, watch.output);
  // A level is the output's own percent; a reading carries the metric's unit and decimals.
  const asFigure = (x: number) => (watch.kind === 'reading' ? figure(x, watch.metric) : String(Math.round(x)));
  const asEdge = (x: number) => (watch.kind === 'reading' ? targetFigure(x, watch.metric) : String(Math.round(x)));
  const unit = watch.kind === 'reading' ? UNIT[watch.metric] : '%';

  return [
    name,
    value === null ? null : [asFigure(value), unit].filter(Boolean).join(' '),
    crossed ? `${crossed.over ? '›' : '‹'} ${asEdge(crossed.bound)}` : null,
  ]
    .filter(Boolean)
    .join(' ');
};

/** When it began and how long it stood, then what the rule will do about it and how much it matters. */
const metaOf = (t: Translate, alert: Alert, rule: AlarmRule | null, now: DateTime): string => {
  const parts = alert.resolvedAt
    ? [t('alerts.meta.resolved', { time: clock(alert.resolvedAt), age: lastedLabel(alert, now) })]
    : [t('alerts.meta.since', { time: clock(alert.startedAt), age: lastedLabel(alert, now) })];

  if (!alert.resolvedAt && rule) {
    parts.push(rule.repeatSeconds > 0 ? t('alerts.meta.repeats', { every: spanLabel(rule.repeatSeconds, now) }) : t('alerts.meta.once'));
    if (isAhead(rule.silencedUntil, now)) parts.push(t('alerts.meta.silenced', { time: clock(rule.silencedUntil!) }));
  }
  if (alert.severity === 'info') parts.push(t('alerts.meta.lowPriority'));

  return parts.join(' · ');
};

function TimelineChip({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();

  return (
    <Link to={`/spaces/${spaceId}/timeline`} className={ui.chip}>
      {t('alerts.action.timeline')}
    </Link>
  );
}

/**
 * The chips on an open card. A camera that stopped delivering is looked at
 * rather than silenced, so it gets its own page instead of the rule's actions.
 */
function OpenChips({ alert, rule, now }: { alert: Alert; rule: AlarmRule | null; now: DateTime }) {
  const { t } = useTranslation();
  // A chip that writes is drawn only where the alert names a device, so the empty id is never sent.
  const deviceId = alert.deviceId ?? '';
  const silence = useSilenceAlarmRule(deviceId);
  const unsilence = useUnsilenceAlarmRule(deviceId);
  const maintenance = useDeviceCommand();
  const silenced = rule !== null && isAhead(rule.silencedUntil, now);
  const busy = silence.isPending || unsilence.isPending || maintenance.isPending;
  const camera = alert.kind === 'camera_stale';

  return (
    <>
      <div className={styles.chips}>
        {camera && alert.cameraId ? (
          <Link to={`/cameras/${alert.cameraId}`} className={ui.chip}>
            {t('alerts.action.checkCam')}
          </Link>
        ) : null}
        {!camera && rule && alert.deviceId ? (
          <button
            type="button"
            className={ui.chip}
            disabled={busy}
            onClick={() => (silenced ? unsilence.mutate(rule.id) : silence.mutate({ ruleId: rule.id, body: { forSeconds: SILENCE_SECONDS } }))}
          >
            {t(silenced ? 'alerts.action.unsilence' : 'alerts.action.silence')}
          </button>
        ) : null}
        {!camera && alert.deviceId ? (
          <button
            type="button"
            className={ui.chip}
            disabled={busy}
            onClick={() => maintenance.mutate({ deviceId, command: { kind: 'maintenance', forSeconds: MAINTENANCE_SECONDS } })}
          >
            {t('alerts.action.maintenance')}
          </button>
        ) : null}
        {alert.spaceId ? <TimelineChip spaceId={alert.spaceId} /> : null}
        {!camera && rule && alert.spaceId ? (
          <Link to={`/spaces/${alert.spaceId}/control/alarms?rule=${rule.id}`} className={ui.chip}>
            {t('alerts.action.editRule')}
          </Link>
        ) : null}
      </div>

      {maintenance.data ? (
        <p className={`mono ${styles.answer}`} role="status">
          {t(maintenance.data.deviceOnline ? 'alerts.maintenance.sent' : 'alerts.maintenance.unheard')}
        </p>
      ) : null}
      <Refused error={silence.error ?? unsilence.error ?? maintenance.error} />
    </>
  );
}
