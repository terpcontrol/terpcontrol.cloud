import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Alert } from '@fg2/shared-types/v1';
import { notificationsWith, useMe, useUpdateMe } from '@/api/account';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { useAlerts } from '@/api/alerts';
import { useSession } from '@/api/session';
import { instantOf } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { AlertCard } from './alerts/AlertCard';
import { isAhead } from '@/ui/age';
import { clock, groupsOf, type GroupHeading } from './alerts/inbox';
import { useInboxNames } from './alerts/names';
import styles from './alerts/Alerts.module.css';

/** How long "Mute all" holds. */
const MUTE_SECONDS = 3600;

/**
 * How often the rules behind the cards are read again. A rule changes when
 * somebody edits it and not when a sample arrives, so the inbox quotes it at a
 * walk and keeps its own beat for the list of alerts.
 */
const RULES_BEAT_MS = 300_000;

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
  const { user } = useSession();
  const alerts = useAlerts(null);
  const { names, isPending: namesPending, watching } = useInboxNames();

  const items = alerts.data?.pages.flatMap(page => page.items) ?? [];
  // Only the devices something has actually gone wrong on: a rule is read to
  // say what a card watched, and a device with no card on the page says nothing.
  const ruleDevices = [...new Set(items.filter(alert => alert.ruleId && alert.deviceId).map(alert => alert.deviceId!))];
  const rules = useAlarmRulesOf(ruleDevices, { refetchIntervalMs: RULES_BEAT_MS });

  useReportFreshness(alerts.dataUpdatedAt ? new Date(alerts.dataUpdatedAt).toISOString() : null);

  const head = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('shell.alerts')}</h1>
      {mayManage ? <MuteCorner now={now} /> : null}
    </header>
  );

  // Nothing is drawn until everything the first page of cards says is in hand.
  // A card drawn before its space is named and before its rule says what it
  // watched changes length twice under the reader's thumb, and a list that
  // reflows while it is being read is worse than one that arrives a moment
  // later. Only a read still outstanding holds it - a rule list that was
  // refused leaves its cards in the bare wording rather than holding the inbox
  // - and only the first page, because what is already on screen must stay
  // there while the page before it is fetched.
  if (alerts.isPending || namesPending || (rules.isPending && alerts.data?.pages.length === 1)) {
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

  const groups = groupsOf(items, now);

  return (
    <section className={styles.page}>
      {head}
      <RefreshFailed failedAt={alerts.isError ? alerts.dataUpdatedAt : null} now={now} />

      {groups.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t(emptyKey(user?.isDemo === true, watching))}</p>
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

      {alerts.hasNextPage ? (
        <button type="button" className={ui.button} disabled={alerts.isFetchingNextPage} onClick={() => void alerts.fetchNextPage()}>
          {alerts.isFetchingNextPage ? t('home.waiting') : t('alerts.earlier')}
        </button>
      ) : null}

      {watching ? <p className={ui.note}>{t('alerts.note')}</p> : null}
    </section>
  );
}

const headingOf = (t: ReturnType<typeof useTranslation>['t'], heading: GroupHeading): string =>
  heading.kind === 'day' ? heading.day.toFormat('ccc d LLL') : t(`alerts.group.${heading.kind}`);

/**
 * What an empty inbox means, which is three different things. The demo account
 * is answered an empty page whatever its tents hold, so it is told where the
 * alarms it can see are instead; an account with neither a device nor a cam has
 * nothing that could raise an alert, and saying nothing has gone wrong there
 * would be a promise nothing is keeping.
 */
const emptyKey = (isDemo: boolean, watching: boolean): string =>
  isDemo ? 'alerts.demoNoInbox' : watching ? 'alerts.nothing' : 'alerts.nothingWatching';

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
