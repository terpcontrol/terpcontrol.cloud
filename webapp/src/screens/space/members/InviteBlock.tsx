import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Invite, SpaceKind } from '@fg2/shared-types/v1';
import { useAddMember } from '@/api/members';
import { useInvites, useRevokeInvite } from '@/api/invites';
import { CopyButton } from '@/ui/CopyButton';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { InviteSheet } from './InviteSheet';
import { InviteTerms } from './InviteTerms';
import { inviteAddress, liveInvites, shownAddress } from './invites';
import styles from './Invite.module.css';

/**
 * The two ways somebody gets into a tent, which are deliberately not the same
 * act.
 *
 * A **link** goes to a stranger: it is a code anybody holding it may redeem,
 * so it is cut with a role and a life chosen on the sheet, and it can be
 * stopped at any moment. A **handle** goes to somebody already known: the
 * field reaches only accounts this one already grows with, and every other
 * name - taken or free - is refused alike, so it can never be asked who has an
 * account here.
 *
 * Every code that is still live is listed, each with what it grants and its
 * own Revoke. Two links can be out at once - a phone and a laptop each cut
 * one, or a week-long one for the club and a day-long one for a visitor - and
 * a card that showed the newest and stopped only that one would tell a host a
 * key was dead while another stayed live. What a row says about its link is
 * read off the row the server answered, not off what the sheet asked for.
 */
export function InviteBlock({ spaceId, spaceName, kind }: { spaceId: string; spaceName: string; kind: SpaceKind }) {
  const { t } = useTranslation();
  const now = useNow();
  const invites = useInvites(spaceId);
  const revoke = useRevokeInvite(spaceId);
  const [sheet, setSheet] = useState<{ open: boolean; shown: Invite | null }>({ open: false, shown: null });

  const live = liveInvites(invites.data?.items ?? [], now);
  const open = (shown: Invite | null) => () => setSheet({ open: true, shown });

  return (
    <section className={styles.block}>
      <header className={styles.head}>
        <span className="label">{t('space.members.invite')}</span>
        {live.length > 0 ? (
          <button type="button" className={ui.chip} onClick={open(null)}>
            <Plus size={13} strokeWidth={2} aria-hidden />
            {t('space.members.newLink')}
          </button>
        ) : null}
      </header>

      {invites.isPending ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('home.waiting')}</p>
      ) : live.length === 0 ? (
        <div className={`${ui.cardDashed} ${styles.none}`}>
          <span className={ui.note}>{t('space.members.noLink')}</span>
          <button type="button" className={`${ui.button} ${ui.primary}`} onClick={open(null)}>
            {t('space.members.makeLink')}
          </button>
        </div>
      ) : (
        <ul className={styles.links}>
          {live.map(invite => (
            <li key={invite.id} className={`${ui.card} ${styles.link}`} aria-label={invite.code}>
              <div className={styles.addressRow}>
                <code className={`mono ${styles.address}`}>{shownAddress(invite.code)}</code>
                <CopyButton value={inviteAddress(invite.code)} label={t('space.members.copyLink')} />
              </div>
              <div className={styles.termsRow}>
                <InviteTerms invite={invite} className={styles.terms} />
                <span className={styles.termsActions}>
                  <button
                    type="button"
                    className={ui.chip}
                    aria-label={t('space.members.links.showOf', { code: invite.code })}
                    onClick={open(invite)}
                  >
                    {t('space.members.links.show')}
                  </button>
                  <button
                    type="button"
                    className={ui.chip}
                    aria-label={t('space.members.links.revokeOf', { code: invite.code })}
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(invite.code)}
                  >
                    {t('space.members.revoke')}
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Refused error={revoke.error} />

      <AddByHandle spaceId={spaceId} />

      {sheet.open ? (
        <InviteSheet spaceId={spaceId} spaceName={spaceName} kind={kind} shown={sheet.shown} onClose={() => setSheet({ open: false, shown: null })} />
      ) : null}
    </section>
  );
}

/**
 * Adding by name. It is a form so that Enter sends it, which is how a field
 * with one button beside it is used; the leading `@` people type out of habit
 * is dropped, because the handle is the name and the sigil is decoration.
 * Somebody added by name walks in able to log, as the board says under the
 * field; a wider role is a change on their row afterwards.
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
