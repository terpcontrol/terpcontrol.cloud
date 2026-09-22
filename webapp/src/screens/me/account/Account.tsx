import { Download } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@fg2/shared-types/v1';
import { useChangePassword, useMe, useRevokeSession, useSessions, useUpdatingMe } from '@/api/account';
import { fileSize, isBuilding, useAskAccountExport, useExport } from '@/api/exports';
import { mediaUrl, useSession } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { MePage, Row } from '../parts';
import { DeleteRow } from '../privacy/DeleteRow';
import { deviceLabel, sortedSessions } from './sessions';
import styles from './Account.module.css';

/**
 * Me › Account: how this person signs in, where they are signed in, and the
 * two ways of taking the account away - as a file, and for good.
 *
 * The address is shown and not changed: it is the login identity, and this
 * server has no route that moves it. The password is changed with the current
 * one in hand, so that a session somebody else is holding cannot lock the
 * owner out. The sessions are every browser and script signed in as this
 * account; this one is named as this device and cannot be ended from here by
 * accident, because the way to end it is the sign-out button and not a row in
 * a list. The export is the same job a grow's export is, for everything at
 * once, and deletion is the same sheet the privacy page carries, because a
 * second door to the same irreversible thing should be the same door.
 */
export function Account() {
  const { t } = useTranslation();
  const now = useNow();
  const { user, sessionId } = useSession();
  const isDemo = user?.isDemo === true;
  const me = useMe(false, !isDemo);
  const mayManage = useMayManage();
  const updating = useUpdatingMe();
  const title = t('me.account.title');

  if (isDemo) {
    return (
      <MePage title={title}>
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.account.demo')}</p>
      </MePage>
    );
  }

  if (me.isPending) {
    return (
      <MePage title={title}>
        <Waiting lines={4} />
      </MePage>
    );
  }

  if (!me.data) {
    return (
      <MePage title={title}>
        <LoadFailed retry={() => void me.refetch()} />
      </MePage>
    );
  }

  const account: Me = me.data;
  const held = !mayManage || updating;

  return (
    <MePage title={title}>
      <RefreshFailed failedAt={me.isError ? me.dataUpdatedAt : null} now={now} />

      <span className="label">{t('me.account.signIn')}</span>

      <Row
        title={t('me.account.email.title')}
        line={
          <>
            <span className="mono">{account.email}</span> · {t('me.account.email.line')}
          </>
        }
      />

      <PasswordRow held={held} />

      <span className="label">{t('me.account.sessions.title')}</span>
      <Sessions currentId={sessionId} now={now} held={held} />

      <span className="label">{t('me.account.data')}</span>
      <ExportRow />
      <DeleteRow handle={account.handle} disabled={held} />
    </MePage>
  );
}

/**
 * The password, changed in place. The form checks only what keeps a pointless
 * request from being sent - the new password typed the same way twice - and
 * whether the current one is right is the server's answer, said under the
 * form where the tap was.
 */
function PasswordRow({ held }: { held: boolean }) {
  const { t } = useTranslation();
  const change = useChangePassword();
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
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
      line={changed && !open ? t('me.account.password.changed') : t('me.account.password.line')}
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
                    setChanged(true);
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
        <button
          type="button"
          className={ui.chip}
          disabled={held}
          onClick={() => {
            setChanged(false);
            setOpen(true);
          }}
        >
          {t('me.account.password.change')}
        </button>
      )}
    </Row>
  );
}

/**
 * Every session of this account, this one first. Another one is ended with a
 * tap and the list read again, so that it is seen to be gone; this one has no
 * such tap, because ending it is what the sign-out button on Me is for and a
 * list is where a tap lands on the wrong row.
 */
function Sessions({ currentId, now, held }: { currentId: string | null; now: DateTime; held: boolean }) {
  const { t } = useTranslation();
  const sessions = useSessions();
  const revoke = useRevokeSession();

  if (sessions.isPending) return <Waiting lines={2} />;
  if (!sessions.data) return <LoadFailed retry={() => void sessions.refetch()} />;

  const rows = sortedSessions(
    sessions.data.pages.flatMap(page => page.items),
    currentId,
  );

  return (
    <section className={`${ui.card} ${styles.sessions}`}>
      <p className={ui.note}>{t('me.account.sessions.line')}</p>
      <ul className={styles.sessionList}>
        {rows.map(row => (
          <li key={row.id} className={styles.session}>
            <div className={styles.sessionText}>
              <span className={styles.sessionDevice}>{deviceLabel(row.userAgent) ?? t('me.account.sessions.unknownDevice')}</span>
              <span className={`mono ${styles.sessionMeta}`}>
                {t('me.account.sessions.lastSeen', { age: ageLabel(row.lastSeenAt, now) })} ·{' '}
                {t('me.account.sessions.until', { date: DateTime.fromISO(row.expiresAt).toLocaleString(DateTime.DATE_MED) })}
              </span>
            </div>
            {row.id === currentId ? (
              <span className={`${ui.chip} ${styles.thisDevice}`}>{t('me.account.sessions.thisDevice')}</span>
            ) : (
              <button type="button" className={ui.chip} disabled={held || revoke.isPending} onClick={() => revoke.mutate(row.id)}>
                {t('me.account.sessions.signOut')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {sessions.hasNextPage ? (
        <button type="button" className={ui.chip} disabled={sessions.isFetchingNextPage} onClick={() => void sessions.fetchNextPage()}>
          {t('me.account.sessions.more')}
        </button>
      ) : null}
      <Refused error={revoke.error} />
    </section>
  );
}

/**
 * Everything the account has, as a file. The zip is built in the background,
 * so this is a button and then a job: the row it is asked for is polled until
 * it is ready or has failed, and a failure says what went wrong rather than
 * sitting at "building" for ever - the same shape, and the same polling, as
 * the export at the end of a grow's report.
 */
function ExportRow() {
  const { t } = useTranslation();
  const ask = useAskAccountExport();
  const [mediaId, setMediaId] = useState<string | null>(null);
  const job = useExport(mediaId);

  const row = job.data;
  const status = row?.exportJob?.status ?? null;
  const ready = row && status === 'ready' ? row : null;
  const file = ready ? mediaUrl(ready.id) : null;

  return (
    <Row
      title={t('me.account.export.title')}
      line={t('me.account.export.note')}
      below={
        <>
          {status === 'queued' || status === 'rendering' ? (
            <p className={`mono ${styles.exportStatus}`} role="status">
              {t(`me.account.export.${status}`)}
            </p>
          ) : null}
          {status === 'failed' ? (
            <p className={ui.problem} role="alert">
              {row?.exportJob?.error || t('me.account.export.failedPlain')}
            </p>
          ) : null}
          <Refused error={ask.error} />
        </>
      }
    >
      {ready && file ? (
        <a className={`${ui.button} ${ui.primary}`} href={file} download>
          <Download size={14} strokeWidth={1.75} aria-hidden />
          {t('me.account.export.download', { size: fileSize(ready.bytes) })}
        </a>
      ) : (
        <button
          type="button"
          className={ui.button}
          disabled={ask.isPending || isBuilding(row)}
          onClick={() => ask.mutate(undefined, { onSuccess: accepted => setMediaId(accepted.media.id) })}
        >
          {status === 'failed' ? t('me.account.export.again') : t('me.account.export.ask')}
        </button>
      )}
    </Row>
  );
}
