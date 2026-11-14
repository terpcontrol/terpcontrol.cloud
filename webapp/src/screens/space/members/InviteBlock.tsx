import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Invite } from '@fg2/shared-types/v1';
import { useAddMember } from '@/api/members';
import { useInvites, useRevokeInvite } from '@/api/invites';
import { SHARE_LINKS } from '@/app/places';
import { useLog } from '@/log/log-context';
import { Asking } from '@/ui/Asking';
import { CopyButton } from '@/ui/CopyButton';
import { typedHandle } from '@/ui/handle';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { InviteSheet } from './InviteSheet';
import { InviteAddress, InviteTerms } from './InviteTerms';
import { inviteAddress, liveInvites } from './invites';
import styles from './Invite.module.css';

/** What an invitation lets somebody into: the place, or the room it stands in. */
type Target = { id: string; name: string };

/**
 * The ways somebody gets into a place, under the list of who is in it.
 *
 * Every code still out is listed, the place's and its room's alike, each with
 * what it grants and its own way to take it back - whether or not anybody is
 * being invited just now, so a link made yesterday is on the page today. Two
 * links can be out at once, and a block that showed the newest and stopped
 * only that one would tell a host a key was dead while another stayed live.
 * The server keeps a revoked code revoked, so taking one back is asked first,
 * in its card, and the toast that answers names what the link was for.
 *
 * Inviting (`open`) is two acts that are deliberately not the same. A **link**
 * goes to a stranger: a code anybody holding it may redeem, cut with a role
 * and a life chosen on the sheet. A **handle** goes to somebody already known:
 * the field reaches only accounts this one already grows with, and every
 * other name is refused alike, so it can never be asked who has an account
 * here. Where the place stands in a room, the next invitation is for either;
 * the choice changes nothing that is already there.
 */
export function InviteBlock({ id, place, room, open }: { id: string; place: Target; room: Target | null; open: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const ofPlace = useInvites(place.id);
  const ofRoom = useInvites(room?.id ?? '', room !== null);
  const [forRoom, setForRoom] = useState(false);
  const [sheet, setSheet] = useState<{ target: Target; shown: Invite | null } | null>(null);

  const target = forRoom && room ? room : place;
  const targetOf = (invite: Invite): Target => (room && invite.spaceId === room.id ? room : place);
  const live = liveInvites([...(ofPlace.data?.items ?? []), ...(ofRoom.data?.items ?? [])], now);

  if (!open && live.length === 0) return null;

  return (
    <section id={id} className={styles.block}>
      <span className="label">
        {t('space.members.invite')}
        <Help topic="invite" />
      </span>
      {live.length > 0 ? (
        <ul className={ui.list}>
          {live.map(invite => (
            <LinkRow
              key={invite.id}
              invite={invite}
              into={targetOf(invite).name}
              // Which of the two it lets into is said only where there are two.
              apart={room !== null}
              onShow={() => setSheet({ target: targetOf(invite), shown: invite })}
            />
          ))}
        </ul>
      ) : null}

      {open ? (
        <>
          {room ? (
            <label className={styles.target}>
              {t('space.members.inviteFor')}
              <select className={ui.input} value={forRoom ? 'room' : 'place'} onChange={event => setForRoom(event.target.value === 'room')}>
                <option value="place">{place.name}</option>
                <option value="room">{room.name}</option>
              </select>
            </label>
          ) : null}
          <button type="button" className={`${ui.button} ${ui.primary} ${styles.make}`} onClick={() => setSheet({ target, shown: null })}>
            {t('space.members.makeLink')}
          </button>
          <AddByHandle spaceId={target.id} />
          {/* Letting somebody look without an account is not an invitation: it is a link of another kind, whose sheet
              opens on this place. */}
          <p className={ui.note}>
            {t('place.members.lookOnly')}{' '}
            <Link to={`${SHARE_LINKS}?${new URLSearchParams({ place: place.id }).toString()}`} className={styles.shareLink}>
              {t('place.members.shareLink')} ›
            </Link>
          </p>
        </>
      ) : null}

      {sheet ? <InviteSheet spaceId={sheet.target.id} spaceName={sheet.target.name} shown={sheet.shown} onClose={() => setSheet(null)} /> : null}
    </section>
  );
}

/** One code that is out: its address, what it is worth - read off the row the server answered -, and what can be done about it. */
function LinkRow({ invite, into, apart, onShow }: { invite: Invite; into: string; apart: boolean; onShow: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const revoke = useRevokeInvite(invite.spaceId);
  const [asking, setAsking] = useState(false);
  const { code } = invite;
  const role = t(`space.members.role.${invite.role}`);
  const stopped = [t('space.members.told.linkStopped', { code }), into, role].join(' · ');
  const told = () => tell({ label: stopped, undo: null });

  return (
    <li className={`${ui.card} ${ui.stack2}`} aria-label={code}>
      <div className={`${ui.row2} ${styles.addressRow}`}>
        <InviteAddress code={code} />
        <CopyButton value={inviteAddress(code)} label={t('space.members.copyLink')} />
      </div>
      <div className={styles.termsRow}>
        <InviteTerms invite={invite} into={apart ? into : undefined} className={styles.terms} />
        <span className={styles.termsActions}>
          <button type="button" className={`${ui.chip} ${styles.finger}`} aria-label={t('space.members.links.showOf', { code })} onClick={onShow}>
            {t('space.members.links.show')}
          </button>
          <button
            type="button"
            className={`${ui.chip} ${styles.finger}`}
            aria-label={t('space.members.links.revokeOf', { code })}
            aria-expanded={asking}
            onClick={() => setAsking(!asking)}
          >
            {t('space.members.revoke')}
          </button>
        </span>
      </div>
      {asking ? (
        <Asking
          note={t('space.members.links.revokeAsk', { name: into })}
          yes={t('space.members.revoke')}
          danger
          busy={revoke.isPending}
          // Told from the promise: once the links are read again this row is gone. A refusal is said under the question.
          onYes={() => void revoke.mutateAsync(code).then(told, () => null)}
          onCancel={() => setAsking(false)}
        />
      ) : null}
      <Refused error={revoke.error} />
    </li>
  );
}

/**
 * Adding by name. It is a form so that Enter sends it, which is how a field
 * with one button beside it is used. Somebody added by name walks in able to
 * log; a wider role is a change on their row afterwards.
 */
function AddByHandle({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const add = useAddMember(spaceId);
  const handle = typedHandle(typed);

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
