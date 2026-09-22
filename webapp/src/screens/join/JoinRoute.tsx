import { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { InvitePreview } from '@fg2/shared-types/v1';
import { useAcceptInvite, useInvitePreview } from '@/api/invites';
import { session, useSession } from '@/api/session';
import { Nothing } from '@/screens/public/Nothing';
import { PublicShell } from '@/screens/public/PublicShell';
import { LoadFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './Join.module.css';

/**
 * `/join/{code}`: what somebody who was sent a link sees, and `/join` on its
 * own: where somebody who was read a code types it.
 *
 * It is a public address because that is what a link in a chat is - the person
 * opening it has usually never had an account here, and a sign-in page with no
 * explanation is where they stop. So the preview comes first and the account
 * comes after it: where they are being asked, by whom, what they would be able
 * to do, and plainly what the tent's owner will and will not be showing them.
 * The account itself is made on its own page, which is sent the invitation's
 * address and comes back to it with the word that it may now be taken up.
 *
 * A code that was revoked, has run out, belongs to a tent that has ended or was
 * never issued all answer the same empty preview, and this screen says the same
 * one thing to all four. That is deliberate on the server's side and is kept
 * here: a page that said "this link has been revoked" would confirm to somebody
 * working through codes that they had found a real one.
 */
export function JoinRoute() {
  const { code = '' } = useParams();

  return <PublicShell>{code === '' ? <CodeEntry /> : <InvitationRoute code={code} />}</PublicShell>;
}

function InvitationRoute({ code }: { code: string }) {
  const { user, restored } = useSession();
  const preview = useInvitePreview(code);

  // Nothing restores the session on a public address, and somebody who is
  // already signed in has to be offered the button rather than the sign-in page.
  useEffect(() => {
    void session.restore();
  }, []);

  if (!restored || preview.isPending) return <Waiting lines={3} />;
  if (!preview.data) return <LoadFailed retry={() => void preview.refetch()} />;
  if (!preview.data.isValid) return <Nothing titleKey="space.members.join.dead.title" bodyKey="space.members.join.dead.body" />;

  return <Invitation preview={preview.data} code={code} signedIn={user !== null} isDemo={user?.isDemo === true} />;
}

function Invitation({ preview, code, signedIn, isDemo }: { preview: InvitePreview; code: string; signedIn: boolean; isDemo: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const accept = useAcceptInvite();
  const name = preview.spaceName ?? '';
  const here = `/join/${code}`;

  // The sign-up page comes back here with this word once the account exists:
  // the person read the terms above before they went to make one, and made it
  // to take the invitation up, so it is taken up rather than asked about again.
  // Once only, so that a refusal is shown and not retried behind their back.
  const takeUp = (location.state as { takeUp?: boolean } | null)?.takeUp === true;
  const tried = useRef(false);
  const { mutate: acceptInvite } = accept;
  useEffect(() => {
    if (!takeUp || !signedIn || isDemo || tried.current) return;
    tried.current = true;
    acceptInvite(code, { onSuccess: accepted => void navigate(`/spaces/${accepted.space.id}/overview`, { replace: true }) });
  }, [takeUp, signedIn, isDemo, acceptInvite, code, navigate]);

  return (
    <section className={styles.invitation}>
      <span className="label">{t('space.members.join.label')}</span>
      <h1 className={styles.title}>{t('space.members.join.title', { name })}</h1>
      <p className={styles.by}>
        {preview.invitedByHandle ? t('space.members.join.by', { handle: preview.invitedByHandle }) : t('space.members.join.bySomebody')}
      </p>

      <div className={`${ui.card} ${styles.terms}`}>
        <p className={styles.term}>{t(`space.members.join.asRole.${preview.role ?? 'can_log'}`)}</p>
        <p className={styles.term}>{t('space.members.join.sees', { name })}</p>
        <p className={styles.term}>{t('space.members.join.doesNotSee')}</p>
        {preview.expiresAt ? (
          <p className={`mono ${styles.until}`}>
            {t('space.members.join.until', { date: DateTime.fromISO(preview.expiresAt).toFormat('d LLL yyyy') })}
          </p>
        ) : null}
      </div>

      {isDemo ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.members.join.demo')}</p>
      ) : signedIn ? (
        <>
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.go}`}
            disabled={accept.isPending}
            onClick={() => accept.mutate(code, { onSuccess: accepted => void navigate(`/spaces/${accepted.space.id}/overview`, { replace: true }) })}
          >
            {accept.isPending ? t('space.members.join.takingUp') : t('space.members.join.accept', { name })}
          </button>
          <Refused error={accept.error} />
        </>
      ) : (
        <>
          <Link to="/sign-up" state={{ from: here, name }} className={`${ui.button} ${ui.primary} ${styles.go}`}>
            {t('space.members.join.createAccount')}
          </Link>
          <Link to="/sign-in" state={{ from: here }} className={`${ui.button} ${styles.go}`}>
            {t('space.members.join.signIn')}
          </Link>
          <p className={ui.note}>{t('space.members.join.needAnAccount')}</p>
        </>
      )}
    </section>
  );
}

/**
 * The code on its own, for somebody it was read to. Eight characters from an
 * alphabet chosen so that none can be mistaken for another off a screen or
 * over a telephone, so what is typed is only put into capitals and stripped
 * of the spaces and dashes people put into a code to read it; whether it opens
 * anything is the invitation page's answer, the same one for every code that
 * does not.
 */
function CodeEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const code = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');

  return (
    <section className={styles.invitation}>
      <span className="label">{t('space.members.join.label')}</span>
      <h1 className={styles.title}>{t('space.members.join.code.title')}</h1>
      <p className={styles.by}>{t('space.members.join.code.body')}</p>

      <form
        className={styles.codeForm}
        onSubmit={event => {
          event.preventDefault();
          if (code) void navigate(`/join/${code}`);
        }}
        noValidate
      >
        <input
          className={`mono ${ui.input}`}
          aria-label={t('space.members.join.code.field')}
          placeholder={t('space.members.join.code.field')}
          autoCapitalize="characters"
          autoComplete="off"
          enterKeyHint="go"
          spellCheck={false}
          value={typed}
          onChange={event => setTyped(event.target.value)}
        />
        <button type="submit" className={`${ui.button} ${ui.primary} ${styles.go}`} disabled={code === ''}>
          {t('space.members.join.code.open')}
        </button>
      </form>
    </section>
  );
}
