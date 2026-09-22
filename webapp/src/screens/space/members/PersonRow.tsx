import { UserMinus } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberRole } from '@fg2/shared-types/v1';
import { useRemoveMember, useSetMemberRole } from '@/api/members';
import { initials } from '@/app/shell/tabs';
import { Sheet } from '@/log/Sheet';
import { ageLabel } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { decidesHere, type Guest } from './people';
import styles from './Members.module.css';

const ROLES: MemberRole[] = ['can_log', 'can_manage'];

/**
 * One person in the tent: who they are, how they got here, when they last
 * wrote, and what they may do.
 *
 * How they got here is the line that matters most on this screen, because the
 * ways in are not alike - somebody who redeemed a link let themselves in,
 * somebody added by hand was let in by name, and somebody who is here through
 * the room is not really in this tent at all. A person can be here both ways
 * at once, and is drawn once: the line says both, and the role is the stronger
 * of the two, because that is the one the server grants. The menu is only
 * offered where the tent's own row decides - a row the room already outranks
 * has nothing left to change - and ending a room row from a screen that names
 * one tent would take them out of every tent under it without saying so, so
 * that row is changed on the room's own page.
 *
 * When they last logged is the fact an owner reads a guest list for. It is the
 * server's answer and nothing is inferred from its absence: somebody who never
 * wrote is said to have written nothing, and an answer that does not carry the
 * fact at all leaves the line at how they got here.
 */
export function PersonRow({
  spaceId,
  guest,
  handle,
  roomName,
  lastLogged,
  isYou,
  mayManage,
  now,
}: {
  spaceId: string;
  guest: Guest;
  handle: string | null;
  roomName: string | null;
  /** When they last wrote here; `null` never, `undefined` not answered. */
  lastLogged: string | null | undefined;
  isYou: boolean;
  /** Whether this session owns the space, which is what changing and ending a membership takes. */
  mayManage: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const setRole = useSetMemberRole(spaceId);
  const [leaving, setLeaving] = useState(false);
  const name = handle ?? t('space.members.someone');
  const room = roomName ?? t('space.members.theRoom');
  const { here, viaRoom } = guest;

  const how = here ? (here.inviteId ? t('space.members.viaLink') : t('space.members.added')) : t('space.members.viaRoom', { room });
  const origin = here && viaRoom ? t('space.members.alsoViaRoom', { how, room }) : how;
  const figure =
    lastLogged === undefined
      ? null
      : lastLogged === null
        ? t('space.members.neverLogged')
        : t('space.members.lastLogged', { age: ageLabel(lastLogged, now) });

  return (
    <li className={`${ui.card} ${styles.person}`}>
      <span className={`mono ${styles.avatar}`} aria-hidden>
        {initials(name)}
      </span>
      <span className={styles.who}>
        <span className={styles.handle}>{isYou ? t('space.members.you') : `@${name}`}</span>
        <span className={`mono ${styles.how}`}>
          <span className={styles.howProse}>{origin}</span>
          {figure ? <span className={styles.howFigure}>· {figure}</span> : null}
        </span>
      </span>

      {here && mayManage && decidesHere(guest) ? (
        <select
          className={`mono ${ui.chip} ${styles.roleSelect}`}
          value={here.role}
          aria-label={t('space.members.roleOf', { name })}
          disabled={setRole.isPending}
          onChange={event => setRole.mutate({ userId: guest.userId, role: event.target.value as MemberRole })}
        >
          {ROLES.map(role => (
            <option key={role} value={role}>
              {t(`space.members.role.${role}`)}
            </option>
          ))}
        </select>
      ) : (
        <span className={ui.chip}>{t(`space.members.role.${guest.role}`)}</span>
      )}

      {here && (mayManage || isYou) ? (
        <button
          type="button"
          className={styles.remove}
          aria-label={isYou ? t('space.members.leaveThis') : t('space.members.removeOf', { name })}
          onClick={() => setLeaving(true)}
        >
          <UserMinus size={16} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}

      <Refused error={setRole.error} />
      {leaving ? (
        <RemoveSheet
          spaceId={spaceId}
          userId={guest.userId}
          name={name}
          room={viaRoom ? room : null}
          isYou={isYou}
          onClose={() => setLeaving(false)}
        />
      ) : null}
    </li>
  );
}

/**
 * Being shown the door, and walking out of it. They are the same row and the
 * same route, and they read entirely differently to the person tapping, so the
 * sheet says which of the two this is - and says the part that surprises
 * people either way: what somebody wrote in the tent stays in it and goes on
 * carrying their name. Somebody who is also in the room does not leave the
 * tent at all by this; they give up the role they held here and keep the tent
 * through the room, and the sheet says exactly that rather than promising a
 * door that stays open.
 */
function RemoveSheet({
  spaceId,
  userId,
  name,
  room,
  isYou,
  onClose,
}: {
  spaceId: string;
  userId: string;
  name: string;
  /** The room they stay in the tent through, or nothing when this row is their only way in. */
  room: string | null;
  isYou: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const remove = useRemoveMember(spaceId);
  const what = isYou ? 'leave' : 'remove';

  return (
    <Sheet
      title={t(`space.members.${what}.title`, { name })}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate(userId, { onSuccess: onClose })}
        >
          {t(`space.members.${what}.yes`)}
        </button>
      }
    >
      <p className={styles.sheetBody}>
        {room ? t(`space.members.${what}.bodyKeepsRoom`, { name, room }) : t(`space.members.${what}.body`, { name })}
      </p>
      <Refused error={remove.error} />
    </Sheet>
  );
}
