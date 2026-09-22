import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Invite } from '@fg2/shared-types/v1';
import { useAddMember } from '@/api/members';
import { useCreateInvite, useInvites, useRevokeInvite } from '@/api/invites';
import { appUrl } from '@/ui/clipboard';
import { CopyButton } from '@/ui/CopyButton';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './Members.module.css';

/**
 * The two ways somebody gets into a tent, which are deliberately not the same
 * act.
 *
 * A **link** goes to a stranger: it is a code anybody holding it may redeem,
 * so it lives seven days and can be stopped at any moment, and whoever walks in
 * through it walks in able to log and no more. A **handle** goes to somebody
 * already known: the field reaches only accounts this one already grows with,
 * and every other name - taken or free - is refused alike, so it can never be
 * asked who has an account here.
 *
 * One link is live at a time. Making a second while the first is still out
 * would leave two keys in the world and one button to stop them with, so the
 * card shows the open one and offers to revoke it rather than to add to it.
 */

/** What the board fixes a link's life at, and what it fixes a guest's role at. */
const LINK_DAYS = 7;

const isOpen = (invite: Invite, now: DateTime): boolean =>
  invite.revokedAt === null && (invite.expiresAt === null || DateTime.fromISO(invite.expiresAt) > now);

export function InviteBlock({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const invites = useInvites(spaceId);
  const create = useCreateInvite(spaceId);
  const revoke = useRevokeInvite(spaceId);

  const open = (invites.data?.items ?? []).find(invite => isOpen(invite, now)) ?? null;
  const busy = create.isPending || revoke.isPending;

  return (
    <section className={styles.invite}>
      <span className="label">{t('space.members.invite')}</span>

      <div className={`${ui.card} ${styles.linkRow}`}>
        {open ? (
          <>
            <code className={`mono ${styles.link}`}>{shown(open.code)}</code>
            <CopyButton value={appUrl(`/join/${open.code}`)} label={t('space.members.copyLink')} />
          </>
        ) : (
          <>
            <span className={ui.note}>{invites.isPending ? t('home.waiting') : t('space.members.noLink')}</span>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={busy}
              onClick={() => create.mutate({ role: 'can_log', expiresAt: now.plus({ days: LINK_DAYS }).toUTC().toISO() })}
            >
              {t('space.members.makeLink')}
            </button>
          </>
        )}
      </div>
      <Refused error={create.error ?? revoke.error} />

      <AddByHandle spaceId={spaceId} />

      <div className={styles.terms}>
        <p className={ui.note}>{t('space.members.linkTerms', { days: LINK_DAYS })}</p>
        {open ? (
          <button type="button" className={ui.chip} disabled={busy} onClick={() => revoke.mutate(open.code)}>
            {t('space.members.revoke')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The host reads the address off a phone as often as they copy it, so the scheme is not part of what is drawn. */
const shown = (code: string): string => appUrl(`/join/${code}`).replace(/^https?:\/\//, '');

/**
 * Adding by name. It is a form so that Enter sends it, which is how a field
 * with one button beside it is used; the leading `@` people type out of habit
 * is dropped, because the handle is the name and the sigil is decoration.
 */
function AddByHandle({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const add = useAddMember(spaceId);
  const handle = typed.trim().replace(/^@/, '');

  return (
    <>
      <form
        className={`${ui.fieldRow} ${styles.handleRow}`}
        onSubmit={event => {
          event.preventDefault();
          if (handle) add.mutate({ handle, role: 'can_log' }, { onSuccess: () => setTyped('') });
        }}
      >
        <input
          className={`${ui.input} ${styles.handleInput}`}
          value={typed}
          aria-label={t('space.members.handleLabel')}
          placeholder={t('space.members.handlePlaceholder')}
          autoComplete="off"
          onChange={event => setTyped(event.target.value)}
        />
        <button type="submit" className={ui.fieldAction} disabled={!handle || add.isPending}>
          {t('space.members.add')}
        </button>
      </form>
      <Refused error={add.error} />
    </>
  );
}
