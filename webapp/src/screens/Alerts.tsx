import type { DateTime } from 'luxon';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Alert, Me } from '@fg2/shared-types/v1';
import { useAccountMe } from '@/api/account';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { useOpenAlerts, useResolvedAlerts } from '@/api/alerts';
import { itemsOf } from '@/api/pages';
import { useSession } from '@/api/session';
import { useEndedSpaces, useSpaces } from '@/api/spaces';
import { devicePath } from '@/app/places';
import { buildName, useOfferedUpdates } from '@/screens/devices/firmware-builds';
import { useDue } from '@/screens/start/due';
import { DueList } from '@/screens/start/Today';
import { foldSame } from '@/screens/grow/diary/days';
import { instantOf, isAhead } from '@/ui/age';
import { Help } from '@/ui/Help';
import { useKept, useKeptScroll } from '@/ui/kept';
import { deviceName } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { together } from '@/api/read';
import { LoadFailed, NothingHere, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { Rows } from '@/ui/Rows';
import { enough, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { clock, zoned, zoneOf } from '@/ui/zone';
import { AlertCard, ResolvedRow } from './alerts/AlertCard';
import { beganAt, heardOf, openAgain, silentDevices, titleOf, worstFirst } from './alerts/inbox';
import { useInboxNames } from './alerts/names';
import { useWriteNotifications } from './notifications/write';
import styles from './alerts/Alerts.module.css';

/** How long "Alles 1 Std stumm" holds. */
const MUTE_SECONDS = 3600;

/**
 * How often the rules behind the cards are read again. A rule changes when
 * somebody edits it and not when a sample arrives, so the inbox quotes it at a
 * walk and keeps its own beat for the list of alerts.
 */
const RULES_BEAT_MS = 300_000;

/** How many of what is over the page lists before "Früher" is asked for, and how many each asking adds: a record, not the page. */
const OVER_FIRST = 5;
const OVER_MORE = 20;

/**
 * Meldungen, behind the bell: what is open - the alerts still standing, worst
 * first, and an update waiting for somebody's word -, what is due in the
 * diary, and what is over - what ended last first, a few of it, more behind
 * "Früher" - as rows that open the whole of it. The bell counts what the
 * first two list (`app/shell/bell.ts`).
 *
 * The list is the alarm engine's own record, read on the beat live values age
 * on, and it is drawn the moment it arrives, each alert under the name of the
 * place it stands in or happened in, which it carries itself. What a device's
 * name and a rule add to a card lands as it comes and never holds the alerts
 * back, and a failed read is said out loud.
 */
export function Alerts() {
  const { t } = useTranslation();
  const now = useNow();
  // The mute is the account's own and stands above every place.
  const mayWriteAtAll = useMayManage();
  const { user } = useSession();
  // The demo has no account of its own and is not asked for one.
  const me = useAccountMe();
  const open = useOpenAlerts();
  const resolved = useResolvedAlerts();
  const updates = useOfferedUpdates();
  const due = useDue(now);
  const { names, watching } = useInboxNames();
  // Back from an alert's curves finds the list as it was left: as far unfolded, as far down.
  const [shown, setShown] = useKept('over', OVER_FIRST);
  useKeptScroll(open.data !== undefined && !resolved.isPending);

  const silent = silentDevices(itemsOf(open.data));
  const standing = worstFirst(itemsOf(open.data), silent);
  // What is over is listed and paged by the server in the order it ended, the last first.
  const ended = itemsOf(resolved.data);
  // What a card offers is decided by the place it names: where the device stands for an open alert, where it
  // happened for one that is over. A place that ended since is not among those in use; its record is still its
  // owner's to delete, and only the list of ended places says so.
  const inUse = useSpaces().data?.items;
  const placeOf = (alert: Alert) => inUse?.find(place => place.id === alert.spaceId);
  const gone = useEndedSpaces(inUse !== undefined && ended.some(alert => alert.spaceId !== null && !placeOf(alert))).data?.items;
  // An alert that names no place is shown to nobody but its owner, so there the session's own half is the whole answer.
  const mayActOn = (alert: Alert): boolean =>
    alert.spaceId === null ? mayWriteAtAll : enough((placeOf(alert) ?? gone?.find(place => place.id === alert.spaceId))?.youMay, 'manage');
  // Only the devices something has actually gone wrong on: a rule is read to
  // say what a card watched, and a device with no card on the page says nothing.
  const ruleDevices = [...new Set([...standing, ...ended].filter(alert => alert.ruleId && alert.deviceId).map(alert => alert.deviceId!))];
  const rules = useAlarmRulesOf(ruleDevices, { refetchIntervalMs: RULES_BEAT_MS });
  const ruleOf = (alert: Alert) => (alert.ruleId ? (rules.rules.get(alert.ruleId) ?? null) : null);
  // A reading that came and went all morning is one row: one rule's sentence about the same device on the same day.
  const day = (alert: Alert) => zoned(alert.resolvedAt ?? alert.startedAt, zoneOf(me.data)).toISODate();
  const said = new Map(ended.map(alert => [alert.id, titleOf(t, alert, ruleOf(alert), names, null)]));
  const kinds = new Map(ended.map(alert => [alert.id, [day(alert), alert.spaceId, alert.deviceId, alert.ruleId, said.get(alert.id)].join('|')]));
  const kindOf = (alert: Alert) => kinds.get(alert.id)!;
  // What is over is paged by when it ended, so the oldest row read may stand in a day that goes on behind it. A
  // row of that day is not whole yet: it is held back, and read on, rather than counted or deleted by a part.
  const cutDay = resolved.hasNextPage && ended.length > 0 ? day(ended[ended.length - 1]) : null;
  const folds = foldSame(ended, kindOf, beganAt);
  // Rows of two rules that read the same are told apart by the rules' names, which a row otherwise leaves to its sheet.
  const sharesWords = (row: Alert) => folds.some(({ newest }) => newest.ruleId !== row.ruleId && said.get(newest.id) === said.get(row.id));
  const over = folds.slice(0, shown).filter(row => day(row.newest) !== cutDay);
  const cut = over.length < Math.min(shown, folds.length) && !resolved.isError;
  const readOn = cut && !resolved.isFetchingNextPage;
  const { fetchNextPage } = resolved;
  useEffect(() => {
    if (readOn) void fetchNextPage();
  }, [readOn, fetchNextPage]);

  const head = (
    <PageHead back={{ to: '/', label: t('me.back') }} title={t('shell.alerts')}>
      {/* Nothing here can raise an alarm without a device or a cam, so there is nothing to mute either. */}
      {mayWriteAtAll && watching && me.data ? <Mute account={me.data} now={now} /> : null}
    </PageHead>
  );

  // What is open is the half a reader came for, so the page waits for that one
  // and for nothing else.
  if (open.isPending) {
    return (
      <section className={`${ui.stack3} ${ui.page} ${styles.page}`}>
        {head}
        <Waiting lines={2} />
        <Waiting lines={2} />
      </section>
    );
  }

  if (!open.data) {
    return (
      <section className={`${ui.stack3} ${ui.page} ${styles.page}`}>
        {head}
        <LoadFailed read={together(open, resolved)} />
      </section>
    );
  }

  // What is on screen is as old as its older half, whichever half failed.
  const readAt = Math.min(open.dataUpdatedAt || Infinity, resolved.dataUpdatedAt || Infinity);
  const failedAt = (open.isError || resolved.isError) && Number.isFinite(readAt) ? readAt : null;
  const more = open.hasNextPage || resolved.hasNextPage;
  const fetching = open.isFetchingNextPage || resolved.isFetchingNextPage;
  // A place of the reader's own that has ended still has its curves to open, read only.
  const placed = (alert: Alert) => !!placeOf(alert) || !!gone?.some(place => place.id === alert.spaceId);
  const card = (alert: Alert) => ({ alert, rule: ruleOf(alert), names, me: me.data, mayManage: mayActOn(alert), placed: placed(alert), now });

  return (
    <section className={`${ui.stack3} ${ui.page} ${styles.page}`}>
      {head}
      <RefreshFailed failedAt={failedAt} now={now} />
      {names.failed ? (
        <p className={styles.namesFailed} role="status">
          {t('alerts.namesFailed')}
        </p>
      ) : null}

      {standing.length + updates.length > 0 ? (
        <section className={`${ui.stack2} ${styles.section}`} aria-labelledby="alerts-open">
          <h2 id="alerts-open" className={ui.cardHeading}>
            {t('alerts.open')}
          </h2>
          <ul className={ui.list}>
            {standing.map(alert => (
              <AlertCard key={alert.id} {...card(alert)} heardAt={heardOf(alert, silent)} />
            ))}
            {updates.map(({ device, build }) => (
              <li key={device.id} className={`${ui.panel} ${styles.card} ${styles.beside}`}>
                <p className={styles.title}>
                  {t('alerts.update', { build: buildName(build) })}
                  <span className={styles.line}>{deviceName(device, t)}</span>
                </p>
                <div className={`${ui.wrapRow} ${styles.actions}`}>
                  <Link to={devicePath(device.id)}>{t('alerts.action.device')}</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <NothingHere>{t(emptyKey(user?.isDemo === true, watching))}</NothingHere>
      )}

      {/* The list of tasks is the diary's; a step of the grow plan waits here without one. */}
      {due.kept || due.rows.length > 0 ? (
        <section className={`${ui.stack2} ${styles.section}`} aria-labelledby="alerts-tasks">
          <h2 id="alerts-tasks" className={ui.cardHeading}>
            {t('tasks.title')}
          </h2>
          <div className={`${ui.panel} ${styles.card}`}>
            {due.rows.length > 0 ? <DueList rows={due.rows} across={due.across} now={now} /> : null}
            {due.kept ? (
              <Link to="/tasks" className={styles.onward}>
                {t('alerts.allTasks')} ›
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {resolved.isPending ? <Waiting lines={2} /> : null}
      {folds.length > 0 ? (
        <section className={`${ui.stack2} ${styles.section}`} aria-labelledby="alerts-over">
          <h2 id="alerts-over" className={ui.cardHeading}>
            {t('alerts.over')}
          </h2>
          <Rows>
            {over.map(({ newest, since }) => (
              <ResolvedRow
                key={newest.id}
                {...card(newest)}
                fold={ended.filter(alert => kindOf(alert) === kindOf(newest)).map(alert => alert.id)}
                since={since}
                ruled={sharesWords(newest)}
                elsewhere={inUse?.length !== 1 || !placeOf(newest)}
                again={openAgain(newest, standing)}
              />
            ))}
          </Rows>
          {cut ? <Waiting lines={1} /> : null}
          {folds.length > shown || more ? (
            <button
              type="button"
              className={ui.button}
              // Not disabled while it asks: that would drop the focus, and the rescue's ring then read as a button of its own.
              aria-disabled={fetching || undefined}
              onClick={() => {
                if (fetching) return;
                setShown(shown + OVER_MORE);
                if (shown + OVER_MORE <= folds.length) return;
                if (open.hasNextPage) void open.fetchNextPage();
                if (resolved.hasNextPage) void resolved.fetchNextPage();
              }}
            >
              {fetching ? t('home.waiting') : t('alerts.earlier')}
            </button>
          ) : null}
        </section>
      ) : null}

      {user !== null && !user.isDemo ? (
        <Link to="/me/notifications" className={styles.onward}>
          {t('alerts.settings')} ›
        </Link>
      ) : null}
    </section>
  );
}

/**
 * What a page with nothing open says. The demo is answered an empty page
 * whatever its tents hold, so it is told where the alarms it can see are; an
 * account with neither a device nor a cam has nothing that could raise an
 * alert, and is not told that nothing has gone wrong.
 */
const emptyKey = (isDemo: boolean, watching: boolean): string =>
  isDemo ? 'alerts.demoNoInbox' : watching ? 'alerts.nothing' : 'alerts.nothingWatching';

/**
 * The one switch that reaches every channel at once: an hour of nothing, for
 * this person only. The settings travel whole, so the rest of them go back as
 * they were read; while the mute holds, the head says until when and offers
 * the way out. Either tap is answered as every notification setting is.
 */
function Mute({ account, now }: { account: Me; now: DateTime }) {
  const { t } = useTranslation();
  const { write, error, pending } = useWriteNotifications(account);
  const until = isAhead(account.notifications.mutedUntil, now) ? account.notifications.mutedUntil : null;
  const time = (instant: string) => clock(instant, zoneOf(account));
  const toggle = () => {
    const next = until ? null : instantOf(now.plus({ seconds: MUTE_SECONDS }));
    const said = (at: string | null) => (at ? t('alerts.told.muted', { time: time(at) }) : t('alerts.told.loud'));
    write({ mutedUntil: next }, said(next), said(until), () => ({ mutedUntil: until }));
  };

  return (
    <>
      <div className={styles.muting}>
        <button type="button" className={`${ui.pill} ${styles.mute}`} disabled={pending} onClick={toggle}>
          {t(until ? 'alerts.unmute' : 'alerts.mute')}
        </button>
        <Help topic="muteAll" />
      </div>
      {until ? (
        <p className={styles.muted} role="status">
          {t('alerts.mutedUntil', { time: time(until) })}
        </p>
      ) : null}
      <Refused error={error} />
    </>
  );
}
