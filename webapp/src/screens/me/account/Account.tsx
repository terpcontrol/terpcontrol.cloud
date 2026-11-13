import { type DateTime } from 'luxon';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChangePassword, useRevokeOtherSessions, useRevokeSession, useSessions } from '@/api/account';
import { itemsOf } from '@/api/pages';
import { refusalCode } from '@/api/problem';
import { useSession } from '@/api/session';
import { Sheet } from '@/ui/Sheet';
import { ageLabel } from '@/ui/age';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
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
            line={<Facts facts={[<span className="mono">{account.email}</span>, ...factsOf(t('me.account.email.line'))]} />}
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

const FIELDS = ['current', 'new', 'repeat'] as const;
const UNTYPED = { current: '', new: '', repeat: '' };

/**
 * The password, changed in place. The form checks only what keeps a pointless
 * request from being sent - the new password typed the same way twice - and
 * whether the current one is right is the server's answer, said at its field;
 * any other refusal is said under the form. A change that landed is said in a
 * toast; it cannot be taken back.
 */
function PasswordRow({ held }: { held: boolean }) {
  const { t } = useTranslation();
  const change = useChangePassword();
  const { tell } = useLog();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(UNTYPED);

  const mismatch = typed.repeat !== '' && typed.new !== typed.repeat;
  const ready = typed.current !== '' && typed.new !== '' && typed.new === typed.repeat && !change.isPending;
  const wrong = refusalCode(change.error) === 'current_password_wrong';

  const close = () => {
    setOpen(false);
    setTyped(UNTYPED);
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
                { currentPassword: typed.current, newPassword: typed.new },
                {
                  onSuccess: () => {
                    close();
                    tell({ label: t('me.account.password.changed'), undo: null });
                  },
                },
              );
            }}
          >
            {FIELDS.map(key => (
              <Fragment key={key}>
                <label className={styles.field}>
                  <span className="label">{t(`me.account.password.${key}`)}</span>
                  <input
                    className={ui.input}
                    type="password"
                    autoComplete={key === 'current' ? 'current-password' : 'new-password'}
                    aria-invalid={(key === 'current' && wrong) || undefined}
                    value={typed[key]}
                    onChange={event => setTyped({ ...typed, [key]: event.target.value })}
                  />
                </label>
                {key === 'current' && wrong ? <Refused error={change.error} /> : null}
              </Fragment>
            ))}
            {mismatch ? <p className={ui.problem}>{t('me.account.password.mismatch')}</p> : null}
            <div className={styles.actions}>
              <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={!ready}>
                {change.isPending ? t('me.account.password.saving') : t('me.account.password.save')}
              </button>
              <button type="button" className={ui.button} onClick={close}>
                {t('me.account.password.cancel')}
              </button>
            </div>
            {wrong ? null : <Refused error={change.error} />}
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
 * How many sessions stand on the page before it offers the rest: this device
 * and a handful of the browsers used most recently. Every script signs in, so
 * an account that is worked on gathers rows nobody will tap, and the export
 * and the deletion below must not sit under a screen and a half of them.
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
              <Facts
                className={`mono ${styles.sessionMeta}`}
                facts={[
                  t('me.account.sessions.lastSeen', { age: ageLabel(row.lastSeenAt, now) }),
                  t('me.account.sessions.until', { date: calendarDay(row.expiresAt, zone) }),
                ]}
              />
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
        One act rather than a row at a time: the sessions worth ending are the
        ones nobody can see from here. It spares this one, and it asks first -
        every other control on this card ends its own row, and this one
        reaches every device the account is signed in on, with no way back.
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
 * it leaves standing - the effect and not a number, for the reason the list
 * states none. A tap is the whole gate, without the typed word the account's
 * deletion asks for: what is lost is convenience, and every session ended can
 * be signed back in. The sheet closes only once the server has answered, so a
 * refusal is read where the tap was.
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
