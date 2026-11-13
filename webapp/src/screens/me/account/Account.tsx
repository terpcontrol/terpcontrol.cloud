import { type DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChangePassword, useRevokeOtherSessions, useRevokeSession, useSessions } from '@/api/account';
import { itemsOf } from '@/api/pages';
import { useSession } from '@/api/session';
import { Sheet } from '@/ui/Sheet';
import { ageLabel } from '@/ui/age';
import { Help } from '@/ui/Help';
import { LoadFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useLog } from '@/log/log-context';
import { browserZone, calendarDay, useZone, zoneNames } from '@/ui/zone';
import { AccountPage, ExportRow, Menu, Row } from '../parts';
import { useSaveAccount } from '../save';
import { DeleteRow } from './DeleteRow';
import { deviceLabel, sortedSessions } from './sessions';
import styles from './Account.module.css';

/**
 * Ich › Konto: how this person signs in, the zone their clock times are read
 * in, where they are signed in, and the two ways of taking the account away -
 * as a file, and for good.
 *
 * The address is shown and not changed: it is the login identity, and this
 * server has no route that moves it. The password is changed with the current
 * one in hand, so that a session somebody else is holding cannot lock the
 * owner out. The zone is the one setting the server acts on rather than
 * merely draws - quiet hours are read in it - so the browser's zone is
 * offered as a hint and never written by itself. The sessions are every
 * browser and script signed in as this account; this one is named as this
 * device and cannot be ended from here by accident, because the way to end it
 * is the sign-out button and not a row in a list.
 */
export function Account() {
  const { t } = useTranslation();
  const now = useNow();
  const { sessionId } = useSession();

  return (
    <AccountPage title={t('me.account.title')} demo={t('me.demo')}>
      {(account, held) => (
        <>
          <Row
            title={t('me.account.email.title')}
            line={
              <>
                <span className="mono">{account.email}</span> · {t('me.account.email.line')}
              </>
            }
          />
          <PasswordRow held={held} />
          <ZoneRow kept={account.preferences.timezone} held={held} />

          <span className="label">
            {t('me.account.sessions.title')}
            <Help topic="sessions" />
          </span>
          <Sessions currentId={sessionId} now={now} held={held} />

          <span className="label">{t('me.account.data')}</span>
          <ExportRow />
          <DeleteRow handle={account.handle} disabled={held} />
        </>
      )}
    </AccountPage>
  );
}

/**
 * The zones the menu offers: everything this browser knows, plus UTC, the
 * account's own and this device's. The three are added by hand because the
 * browser's list is of places rather than of offsets and holds no UTC at all,
 * and an account that keeps a zone it cannot be given back - which is every
 * account the migration left on UTC - would be a menu that only goes one way.
 */
const offeredZones = (kept: string): string[] => {
  const known = new Set(zoneNames());
  known.add('UTC');
  known.add(kept);
  const here = browserZone();
  if (here) known.add(here);

  return [...known].sort();
};

/** The zone every clock time is drawn in, with what this device is in where that is something else - the one hint an account still on the migration's UTC needs. */
function ZoneRow({ kept, held }: { kept: string; held: boolean }) {
  const { t } = useTranslation();
  const { save, error } = useSaveAccount();
  const here = browserZone();

  return (
    <>
      <Row
        title={t('me.account.timezone')}
        help="timezone"
        line={here && here !== kept ? t('me.account.timezoneHere', { zone: here }) : t('me.account.timezoneLine')}
      >
        <Menu
          name={t('me.account.timezone')}
          value={kept}
          className={styles.zone}
          disabled={held}
          onChange={timezone =>
            save({ preferences: { timezone } }, t('me.saved.setting', { what: t('me.account.timezone'), value: timezone }), () => ({
              preferences: { timezone: kept },
            }))
          }
        >
          {offeredZones(kept).map(zone => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Menu>
      </Row>
      <Refused error={error} />
    </>
  );
}

/**
 * The password, changed in place. The form checks only what keeps a pointless
 * request from being sent - the new password typed the same way twice - and
 * whether the current one is right is the server's answer, said under the
 * form where the tap was. A change that landed is said in a toast; it cannot
 * be taken back.
 */
function PasswordRow({ held }: { held: boolean }) {
  const { t } = useTranslation();
  const change = useChangePassword();
  const { tell } = useLog();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');

  const mismatch = again !== '' && next !== again;
  const ready = current !== '' && next !== '' && next === again && !change.isPending;

  const close = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setAgain('');
    change.reset();
  };

  return (
    <Row
      title={t('me.account.password.title')}
      help="passwordChange"
      line={t('me.account.password.line')}
      below={
        open ? (
          <form
            className={styles.fields}
            onSubmit={event => {
              event.preventDefault();
              if (!ready) return;
              change.mutate(
                { currentPassword: current, newPassword: next },
                {
                  onSuccess: () => {
                    close();
                    tell({ label: t('me.account.password.changed'), undo: null });
                  },
                },
              );
            }}
          >
            <label className={styles.field}>
              <span className="label">{t('me.account.password.current')}</span>
              <input
                className={ui.input}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={event => setCurrent(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className="label">{t('me.account.password.new')}</span>
              <input className={ui.input} type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className="label">{t('me.account.password.repeat')}</span>
              <input
                className={ui.input}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={event => setAgain(event.target.value)}
              />
            </label>
            {mismatch ? <p className={ui.problem}>{t('me.account.password.mismatch')}</p> : null}
            <div className={styles.actions}>
              <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={!ready}>
                {change.isPending ? t('me.account.password.saving') : t('me.account.password.save')}
              </button>
              <button type="button" className={ui.button} onClick={close}>
                {t('me.account.password.cancel')}
              </button>
            </div>
            <Refused error={change.error} />
          </form>
        ) : null
      }
    >
      {open ? null : (
        <button type="button" className={ui.chip} disabled={held} onClick={() => setOpen(true)}>
          {t('me.account.password.change')}
        </button>
      )}
    </Row>
  );
}

/**
 * How many sessions stand on the page before it offers the rest: this device,
 * which is always first, and a handful of the browsers used most recently.
 * Every agent run and every script signs in, so an account that is worked on
 * accumulates rows nobody will ever tap, and the two irreversible controls
 * below - the export and the deletion - are what somebody came to this page
 * for. They must not sit under a screen and a half of scrolling.
 */
const SESSIONS_SHOWN = 6;

/**
 * Every session of this account, this one first. Another one is ended with a
 * tap and the list read again, so that it is seen to be gone; this one has no
 * such tap, because ending it is what the sign-out button on Me is for and a
 * list is where a tap lands on the wrong row.
 *
 * The list has a ceiling and says so. Nothing is hidden that cannot be asked
 * for in one tap, and the count is not stated, because what is loaded is not
 * what there is: the cursor may still have pages behind it, and a figure that
 * counts the rows this browser happens to hold would be an answer to a
 * different question.
 */
function Sessions({ currentId, now, held }: { currentId: string | null; now: DateTime; held: boolean }) {
  const { t } = useTranslation();
  const zone = useZone();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const others = useRevokeOtherSessions();
  const { tell } = useLog();
  const [all, setAll] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  if (sessions.isPending) return <Waiting lines={2} />;
  if (!sessions.data) return <LoadFailed retry={() => void sessions.refetch()} />;

  const rows = sortedSessions(itemsOf(sessions.data), currentId);
  const shown = all ? rows : rows.slice(0, SESSIONS_SHOWN);
  const rest = rows.length > shown.length || sessions.hasNextPage;

  return (
    <section className={`${ui.card} ${styles.sessions}`}>
      <ul className={styles.sessionList}>
        {shown.map(row => (
          <li key={row.id} className={styles.session}>
            <div className={styles.sessionText}>
              <span className={styles.sessionDevice}>{deviceLabel(row.userAgent) ?? t('me.account.sessions.unknownDevice')}</span>
              <span className={`mono ${styles.sessionMeta}`}>
                {t('me.account.sessions.lastSeen', { age: ageLabel(row.lastSeenAt, now) })} ·{' '}
                {t('me.account.sessions.until', { date: calendarDay(row.expiresAt, zone) })}
              </span>
            </div>
            {row.id === currentId ? (
              <span className={`${ui.chip} ${styles.thisDevice}`}>{t('me.account.sessions.thisDevice')}</span>
            ) : (
              <button
                type="button"
                className={ui.chip}
                disabled={held || revoke.isPending}
                onClick={() =>
                  revoke.mutate(row.id, {
                    onSuccess: () =>
                      tell({
                        label: t('me.account.sessions.signedOut', { device: deviceLabel(row.userAgent) ?? t('me.account.sessions.unknownDevice') }),
                        undo: null,
                      }),
                  })
                }
              >
                {t('me.account.sessions.signOut')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!all && rest ? (
        <button type="button" className={ui.chip} onClick={() => setAll(true)}>
          {t('me.account.sessions.showAll')}
        </button>
      ) : null}
      {all && sessions.hasNextPage ? (
        <button type="button" className={ui.chip} disabled={sessions.isFetchingNextPage} onClick={() => void sessions.fetchNextPage()}>
          {t('me.account.sessions.more')}
        </button>
      ) : null}
      {/*
        One act rather than a row at a time, because the sessions worth ending
        are the ones nobody can see from here: a browser left signed in
        somewhere is not on the first page of anything. It spares this one.

        It asks first. Every other control on this card ends the one row it
        sits on, and this one sits among them while reaching every device the
        account is signed in on - a tap meant for the row above it would sign
        somebody's phone, their partner's tablet and whatever script they run
        out at once, and nothing about that can be taken back from here.
      */}
      {rows.length > 1 ? (
        <button
          type="button"
          className={`${ui.chip} ${styles.signOutEverywhere}`}
          disabled={held || others.isPending}
          onClick={() => setSweeping(true)}
        >
          {t('me.account.sessions.signOutOthers')}
        </button>
      ) : null}
      <Refused error={revoke.error} />
      {sweeping ? (
        <SweepSheet
          sweep={others}
          onClose={() => setSweeping(false)}
          onDone={() => {
            setSweeping(false);
            tell({ label: t('me.account.sessions.sweep.done'), undo: null });
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * The question in front of the sweep: what it ends, whom it reaches, and what
 * it leaves standing.
 *
 * It says the effect and not a number. What this browser has loaded is not
 * what the account has - the list is paged and the cursor may still have
 * pages behind it - so a figure here would be an answer to a different
 * question, and one that reads as a promise about how much is being ended.
 *
 * A tap is the whole gate, without the typed word the account's deletion asks
 * for: what is lost here is convenience rather than anything of the grower's,
 * and every session ended this way can be signed back in with the password
 * they already have. The sheet closes only once the server has answered, so a
 * refusal is read where the tap was rather than on the card behind it.
 */
function SweepSheet({ sweep, onClose, onDone }: { sweep: ReturnType<typeof useRevokeOtherSessions>; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();

  return (
    <Sheet
      title={t('me.account.sessions.sweep.title')}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={sweep.isPending}
          onClick={() => sweep.mutate(undefined, { onSuccess: onDone })}
        >
          {sweep.isPending ? t('me.account.sessions.sweep.signingOut') : t('me.account.sessions.sweep.yes')}
        </button>
      }
    >
      <div className={styles.asked}>
        <p>{t('me.account.sessions.sweep.what')}</p>
        <p>{t('me.account.sessions.sweep.thisOne')}</p>
        <Refused error={sweep.error} />
      </div>
    </Sheet>
  );
}
