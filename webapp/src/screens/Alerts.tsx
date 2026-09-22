import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Alert } from '@fg2/shared-types/v1';
import { notificationsWith, useMe, useUpdateMe } from '@/api/account';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { useAlerts } from '@/api/alerts';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSpaces } from '@/api/spaces';
import { instantOf } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { AlertCard, type AlertNames } from './alerts/AlertCard';
import { clock, groupsOf, isAhead, type GroupHeading } from './alerts/inbox';
import styles from './alerts/Alerts.module.css';

/** How long "Mute all" holds. */
const MUTE_SECONDS = 3600;

/**
 * The inbox behind the bell: one line per event, graded by severity, with what
 * can be done about it on the card. Everything still open is at the top, and
 * everything that has resolved stays below it under the day it began - dimmed,
 * dated, and never dropped for being old.
 *
 * The list is the alarm engine's own record, read on the beat live values age
 * on. What each card says about its rule - what it watched, whether it repeats,
 * whether it is silenced - comes from the rule read per device, so a rule that
 * has since been removed leaves a card that says only the kind of thing it was.
 */
export function Alerts() {
  const { t } = useTranslation();
  const now = useNow();
  const mayManage = useMayManage();
  const alerts = useAlerts(null);
  const spaces = useSpaces();
  const devices = useDevices();
  const cameras = useCameras();

  const ruleDevices = [...new Set((alerts.data?.items ?? []).filter(alert => alert.ruleId && alert.deviceId).map(alert => alert.deviceId!))];
  const rules = useAlarmRulesOf(ruleDevices);

  useReportFreshness(alerts.dataUpdatedAt ? new Date(alerts.dataUpdatedAt).toISOString() : null);

  const head = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('shell.alerts')}</h1>
      {mayManage ? <MuteCorner now={now} /> : null}
    </header>
  );

  // Only the list itself is waited for. The names and the rules are read
  // beside it and drawn as they arrive, so one device whose rules cannot be
  // read leaves its cards in the bare wording rather than holding the inbox.
  if (alerts.isPending) {
    return (
      <section className={styles.page}>
        {head}
        <Waiting lines={2} />
        <Waiting lines={2} />
      </section>
    );
  }

  if (!alerts.data) {
    return (
      <section className={styles.page}>
        {head}
        <LoadFailed retry={() => void alerts.refetch()} />
      </section>
    );
  }

  const names: AlertNames = {
    spaces: new Map((spaces.data?.items ?? []).map(space => [space.id, space.name])),
    devices: new Map(
      (devices.data?.items ?? []).map(device => [device.id, device.name ?? t(`devices.type.${device.type}`, { defaultValue: device.type })]),
    ),
    cameras: new Map((cameras.data?.items ?? []).map(camera => [camera.id, camera.name])),
  };
  const groups = groupsOf(alerts.data.items, now);

  return (
    <section className={styles.page}>
      {head}
      <RefreshFailed failedAt={alerts.isError ? alerts.dataUpdatedAt : null} now={now} />

      {groups.length === 0 ? (
        <div className={ui.cardDashed}>
          <p className={styles.nothing}>{t('alerts.nothing')}</p>
        </div>
      ) : (
        groups.map(group => (
          <section key={group.key} className={styles.group}>
            <header className={styles.groupHead}>
              <span className="label">{headingOf(t, group.heading)}</span>
              {group.heading.kind === 'now' ? (
                <span className={`mono ${styles.aside}`}>{t('alerts.active', { count: group.alerts.length })}</span>
              ) : null}
            </header>
            <ul className={styles.list}>
              {group.alerts.map((alert: Alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  rule={alert.ruleId ? (rules.rules.get(alert.ruleId) ?? null) : null}
                  names={names}
                  mayManage={mayManage}
                  now={now}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <p className={ui.note}>{t('alerts.note')}</p>
    </section>
  );
}

const headingOf = (t: ReturnType<typeof useTranslation>['t'], heading: GroupHeading): string =>
  heading.kind === 'day' ? heading.day.toFormat('ccc d LLL') : t(`alerts.group.${heading.kind}`);

/**
 * The one switch that reaches every channel at once: an hour of nothing, for
 * this person only. The settings travel whole, so the rest of them go back as
 * they were read; while the mute holds, the corner says until when and offers
 * the way out.
 */
function MuteCorner({ now }: { now: DateTime }) {
  const { t } = useTranslation();
  const me = useMe();
  const update = useUpdateMe();
  if (!me.data) return null;

  const { notifications } = me.data;
  const muted = isAhead(notifications.mutedUntil, now);
  const set = (mutedUntil: string | null) => update.mutate({ notifications: notificationsWith(notifications, { mutedUntil }) });

  return (
    <div className={styles.corner}>
      {muted ? (
        <>
          <span className={`mono ${styles.mutedUntil}`}>{t('alerts.mutedUntil', { time: clock(notifications.mutedUntil!) })}</span>
          <button type="button" className={ui.chip} disabled={update.isPending} onClick={() => set(null)}>
            {t('alerts.unmute')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className={ui.chip}
          disabled={update.isPending}
          onClick={() => set(instantOf(DateTime.now().plus({ seconds: MUTE_SECONDS })))}
        >
          {t('alerts.muteAll')}
        </button>
      )}
      <Refused error={update.error} />
    </div>
  );
}
