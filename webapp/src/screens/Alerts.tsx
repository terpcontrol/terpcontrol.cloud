import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Alert } from '@fg2/shared-types/v1';
import { notificationsWith, useMe, useUpdateMe } from '@/api/account';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { useOpenAlerts, useResolvedAlerts } from '@/api/alerts';
import { useSession } from '@/api/session';
import { instantOf } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { enough, useMayInEach, useMayManage } from '@/ui/session-access';
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
 * can be done about it on the card. Everything still open is at the top, worst
 * first, and everything that has resolved stays below it under the day it began
 * - dimmed, dated, and never dropped for being old.
 *
 * The list is the alarm engine's own record, read on the beat live values age
 * on, and it is drawn the moment it arrives. What a name and a rule add to a
 * card - which tent this is, what the rule watched, whether it repeats - lands
 * as it comes and never holds the alerts back: those reads are slower, they
 * fail on their own, and a reader kept in front of skeletons while the answer
 * sits in the browser has been told nothing at all. Where a name has not
 * arrived the card falls back to the id and a failed read is said out loud, so
 * a card is never quietly about nowhere.
 */
export function Alerts() {
  const { t } = useTranslation();
  const now = useNow();
  // The mute is the account's own and stands above every place; silencing a
  // rule or sending a device into maintenance is `manage` on the device the
  // card is about, which is why the two are asked separately.
  const mayWriteAtAll = useMayManage();
  const mayManageIn = useMayInEach();
  // An alert that names no place is about something standing nowhere, which
  // nobody but its owner can be shown at all - so there the session's own half
  // is the whole answer, and everywhere else the place decides.
  const mayActOn = (alert: Alert): boolean => (alert.spaceId === null ? mayWriteAtAll : enough(mayManageIn(alert.spaceId), 'manage'));
  const { user } = useSession();
  const me = useMe();
  const open = useOpenAlerts();
  const resolved = useResolvedAlerts();
  const { names, watching } = useInboxNames();

  const items = [...pagesOf(open.data), ...pagesOf(resolved.data)];
  // Only the devices something has actually gone wrong on: a rule is read to
  // say what a card watched, and a device with no card on the page says nothing.
  const ruleDevices = [...new Set(items.filter(alert => alert.ruleId && alert.deviceId).map(alert => alert.deviceId!))];
  const rules = useAlarmRulesOf(ruleDevices, { refetchIntervalMs: RULES_BEAT_MS });

  const readAt = Math.min(open.dataUpdatedAt || Infinity, resolved.dataUpdatedAt || Infinity);
  useReportFreshness(Number.isFinite(readAt) ? new Date(readAt).toISOString() : null);

  const head = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('shell.alerts')}</h1>
      {mayWriteAtAll ? <MuteCorner now={now} /> : null}
    </header>
  );

  // What is open is the half a reader came for, so the page waits for that one
  // and for nothing else.
  if (open.isPending) {
    return (
      <section className={styles.page}>
        {head}
        <Waiting lines={2} />
        <Waiting lines={2} />
      </section>
    );
  }

  if (!open.data) {
    return (
      <section className={styles.page}>
        {head}
        <LoadFailed
          retry={() => {
            void open.refetch();
            void resolved.refetch();
          }}
        />
      </section>
    );
  }

  const groups = groupsOf(items, now);
  // What is on screen is as old as its older half, whichever half failed.
  const failedAt = (open.isError || resolved.isError) && Number.isFinite(readAt) ? readAt : null;
  const more = open.hasNextPage || resolved.hasNextPage;
  const fetchMore = () => {
    if (open.hasNextPage) void open.fetchNextPage();
    if (resolved.hasNextPage) void resolved.fetchNextPage();
  };

  return (
    <section className={styles.page}>
      {head}
      <RefreshFailed failedAt={failedAt} now={now} />
      {names.failed ? (
        <p className={`mono ${styles.namesFailed}`} role="status">
          {t('alerts.namesFailed')}
        </p>
      ) : null}

      {groups.length === 0 && !resolved.isPending ? (
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
                  me={me.data}
                  mayManage={mayActOn(alert)}
                  now={now}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {resolved.isPending ? <Waiting lines={2} /> : null}

      {more ? (
        <button type="button" className={ui.button} disabled={open.isFetchingNextPage || resolved.isFetchingNextPage} onClick={fetchMore}>
          {open.isFetchingNextPage || resolved.isFetchingNextPage ? t('home.waiting') : t('alerts.earlier')}
        </button>
      ) : null}

      {watching ? <p className={ui.note}>{t('alerts.note')}</p> : null}
    </section>
  );
}

const pagesOf = (data: { pages: { items: Alert[] }[] } | undefined): Alert[] => data?.pages.flatMap(page => page.items) ?? [];

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
