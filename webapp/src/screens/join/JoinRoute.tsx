import { DateTime } from 'luxon';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import type { InvitePreview } from '@fg2/shared-types/v1';
import { useAcceptInvite, useInvitePreview } from '@/api/invites';
import { session, useSession } from '@/api/session';
import { Nothing } from '@/screens/public/Nothing';
import { PublicShell } from '@/screens/public/PublicShell';
import { LoadFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './Join.module.css';

/**
 * `/join/{code}`: what somebody who was sent a link sees.
 *
 * It is a public address because that is what a link in a chat is - the person
 * opening it has usually never had an account here, and a sign-in page with no
 * explanation is where they stop. So the preview comes first and the account
 * comes after it: where they are being asked, by whom, what they would be able
 * to do, and plainly what the tent's owner will and will not be showing them.
 *
 * A code that was revoked, has run out, belongs to a tent that has ended or was
 * never issued all answer the same empty preview, and this screen says the same
 * one thing to all four. That is deliberate on the server's side and is kept
 * here: a page that said "this link has been revoked" would confirm to somebody
 * working through codes that they had found a real one.
 */
export function JoinRoute() {
  const { code = '' } = useParams();
  const { user, restored } = useSession();
  const preview = useInvitePreview(code);

  // Nothing restores the session on a public address, and somebody who is
  // already signed in has to be offered the button rather than the sign-in page.
  useEffect(() => {
    void session.restore();
  }, []);

  if (!restored || preview.isPending) {
    return (
      <PublicShell>
        <Waiting lines={3} />
      </PublicShell>
    );
  }

  if (!preview.data) {
    return (
      <PublicShell>
        <LoadFailed retry={() => void preview.refetch()} />
      </PublicShell>
    );
  }

  if (!preview.data.isValid) {
    return (
      <PublicShell>
        <Nothing titleKey="space.members.join.dead.title" bodyKey="space.members.join.dead.body" />
      </PublicShell>
    );
  }

  return (
    <PublicShell title={preview.data.spaceName ?? undefined}>
      <Invitation preview={preview.data} code={code} signedIn={user !== null} isDemo={user?.isDemo === true} />
    </PublicShell>
  );
}

function Invitation({ preview, code, signedIn, isDemo }: { preview: InvitePreview; code: string; signedIn: boolean; isDemo: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accept = useAcceptInvite();
  const name = preview.spaceName ?? '';

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
            {t('space.members.join.accept', { name })}
          </button>
          <Refused error={accept.error} />
        </>
      ) : (
        <>
          <Link to="/sign-in" state={{ from: `/join/${code}` }} className={`${ui.button} ${ui.primary} ${styles.go}`}>
            {t('space.members.join.signIn')}
          </Link>
          <p className={ui.note}>{t('space.members.join.needAnAccount')}</p>
        </>
      )}
    </section>
  );
}
