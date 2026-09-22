import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Alert, AlarmRule, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { useSilenceAlarmRule, useUnsilenceAlarmRule } from '@/api/alarm-rules';
import { useDeviceCommand } from '@/api/commands';
import { ageAttribute, ageLabel } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { figure, targetFigure, UNIT } from '../home/units';
import { isAhead } from '@/ui/age';
import { clock, crossedBound, lastedLabel, spanLabel } from './inbox';
import type { AlertNames, DeviceName } from './names';
import styles from './Alerts.module.css';

/** How long a silence from the card holds, and how long maintenance does. */
export const SILENCE_SECONDS = 3600;
export const MAINTENANCE_SECONDS = 900;

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
  const place = placeOf(t, alert, names);
  const { label, figure: reading } = whatOf(t, alert, rule, names, now);
  const severity = t(`alerts.severity.${alert.severity}`);

  return (
    <li
      className={`${ui.card} ${styles.card}`}
      data-severity={alert.severity}
      aria-label={[severity, place, label, reading].filter(Boolean).join(' · ')}
      {...(open ? {} : ageAttribute('stale'))}
    >
      <div className={styles.lines}>
        <p className={styles.what}>
          {[place, label].filter(Boolean).join(' · ')}
          {reading ? (
            <>
              {' '}
              <span className="mono">{reading}</span>
            </>
          ) : null}
        </p>
        <p className={`mono ${styles.meta}`}>{metaOf(t, alert, rule, now, severity)}</p>
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
const placeOf = (t: Translate, alert: Alert, names: AlertNames): string | null => {
  if (alert.spaceId) return names.spaces.get(alert.spaceId) ?? null;
  if (alert.deviceId) {
    const device = names.devices.get(alert.deviceId);
    return device ? deviceName(t, device) : null;
  }
  if (alert.cameraId && alert.kind !== 'camera_stale') return names.cameras.get(alert.cameraId) ?? null;
  return null;
};

/** What a device is called, or what kind of thing it is where nobody has named it. */
const deviceName = (t: Translate, device: DeviceName): string => device.name ?? t(`devices.type.${device.type}`, { defaultValue: device.type });

// The inbox writes a metric out in full - "humidity" rather than "RH" - so its
// own words come first and the short ones the dense cards elsewhere use stand
// in only where it has none.
const metricName = (t: Translate, metric: Metric): string =>
  t(`alerts.metric.${metric}`, { defaultValue: t(`home.metric.${metric}`, { defaultValue: metric }) });

const outputName = (t: Translate, output: OutputMetric): string => t(`alerts.output.${output}`, { defaultValue: output });

/** What the card says, and the figures in it apart from it, because a figure is set in mono wherever it is drawn. */
interface What {
  label: string;
  figure: string | null;
}

/**
 * The event in as few words as the board allows: the reading and the edge it
 * crossed where the rule is still there to say what it watched, the bare kind
 * where it is not.
 *
 * An offline alert is dated from the device's own last sample rather than from
 * the alert's start, because what a reader wants to know is how long the tent
 * has gone unwatched and not how long ago the cloud noticed. A device this
 * account cannot see leaves the alert's own start as the only answer there is.
 */
const whatOf = (t: Translate, alert: Alert, rule: AlarmRule | null, names: AlertNames, now: DateTime): What => {
  switch (alert.kind) {
    case 'offline': {
      if (alert.resolvedAt) return { label: t('alerts.what.wasOffline'), figure: null };
      const quietSince = (alert.deviceId && names.devices.get(alert.deviceId)?.lastSeenAt) || alert.startedAt;
      return { label: t('alerts.what.offline', { age: ageLabel(quietSince, now) }), figure: null };
    }
    case 'camera_stale':
      return {
        label: t('alerts.what.cameraStale', {
          camera: (alert.cameraId && names.cameras.get(alert.cameraId)) || t('alerts.what.camera'),
          time: clock(alert.startedAt),
        }),
        figure: null,
      };
    case 'threshold':
      return rule ? watched(t, alert, rule, now) : { label: t('alerts.what.threshold'), figure: alert.value === null ? null : String(alert.value) };
  }
};

/** A figure and what belongs to it, held together so a narrow card wraps the pair rather than splitting it. */
const tight = (part: string): string => part.replace(/ /g, '\u00a0');

const watched = (t: Translate, alert: Alert, rule: AlarmRule, now: DateTime): What => {
  const { watch } = rule;
  if (watch.kind === 'output_running') {
    return {
      label: t('alerts.what.running', { output: outputName(t, watch.output) }),
      // A rule that trips the moment its output starts has no span to name.
      figure: rule.forSeconds > 0 ? tight(`› ${spanLabel(rule.forSeconds, now)}`) : null,
    };
  }

  const value = alert.value ?? alert.extremeValue;
  const crossed = crossedBound(watch, value);
  // A level is the output's own percent; a reading carries the metric's unit and decimals.
  const asFigure = (x: number) => (watch.kind === 'reading' ? figure(x, watch.metric) : String(Math.round(x)));
  const asEdge = (x: number) => (watch.kind === 'reading' ? targetFigure(x, watch.metric) : String(Math.round(x)));
  const unit = watch.kind === 'reading' ? UNIT[watch.metric] : '%';

  const figures = [
    value === null ? null : [asFigure(value), unit].filter(Boolean).join(' '),
    crossed ? `${crossed.over ? '›' : '‹'} ${asEdge(crossed.bound)}` : null,
  ].filter((part): part is string => part !== null);

  return {
    label: watch.kind === 'reading' ? metricName(t, watch.metric) : outputName(t, watch.output),
    figure: figures.length ? figures.map(tight).join(' ') : null,
  };
};

/**
 * How much it matters, when it began and how long it stood, then what the rule
 * will go on doing about it. The severity leads the line because the coloured
 * edge beside it is the only other place it is said, and a colour is not a word.
 */
const metaOf = (t: Translate, alert: Alert, rule: AlarmRule | null, now: DateTime, severity: string): string => {
  const parts = [
    severity,
    alert.resolvedAt
      ? t('alerts.meta.resolved', { time: clock(alert.resolvedAt), age: lastedLabel(alert, now) })
      : t('alerts.meta.since', { time: clock(alert.startedAt), age: lastedLabel(alert, now) }),
  ];

  if (!alert.resolvedAt && rule) {
    parts.push(rule.repeatSeconds > 0 ? t('alerts.meta.repeats', { every: spanLabel(rule.repeatSeconds, now) }) : t('alerts.meta.once'));
    if (isAhead(rule.silencedUntil, now)) parts.push(t('alerts.meta.silenced', { time: clock(rule.silencedUntil!) }));
  }

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
