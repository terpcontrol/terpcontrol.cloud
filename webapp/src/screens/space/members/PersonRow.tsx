import { UserMinus } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberRole, Membership } from '@fg2/shared-types/v1';
import { useRemoveMember, useSetMemberRole } from '@/api/members';
import { initials } from '@/app/shell/tabs';
import { Sheet } from '@/log/Sheet';
import { ageLabel } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './Members.module.css';

const ROLES: MemberRole[] = ['can_log', 'can_manage'];

/**
 * One person in the tent: who they are, how they got here, and what they may
 * do.
 *
 * How they got here is the line that matters most on this screen, because the
 * two ways in are not alike - somebody who redeemed a link let themselves in,
 * somebody added by hand was let in by name, and somebody who is here through
 * the room is not really in this tent at all. The last of the three is why the
 * role is drawn as a chip rather than a menu for those rows: the membership
 * belongs to the room and reaches into every tent grouped under it, so changing
 * or ending it from a screen that names one tent would take them out of all of
 * them without saying so.
 */
export function PersonRow({
  spaceId,
  row,
  handle,
  roomName,
  viaRoom,
  isYou,
  mayManage,
  now,
}: {
  spaceId: string;
  row: Membership;
  handle: string | null;
  roomName: string | null;
  viaRoom: boolean;
  isYou: boolean;
  /** Whether this session owns the space, which is what changing and ending a membership takes. */
  mayManage: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const setRole = useSetMemberRole(spaceId);
  const [leaving, setLeaving] = useState(false);
  const name = handle ?? t('space.members.someone');

  const how = viaRoom
    ? t('space.members.viaRoom', { room: roomName ?? t('space.members.theRoom') })
    : row.inviteId
      ? t('space.members.viaLink')
      : t('space.members.added');

  return (
    <li className={`${ui.card} ${styles.person}`}>
      <span className={`mono ${styles.avatar}`} aria-hidden>
        {initials(name)}
      </span>
      <span className={styles.who}>
        <span className={styles.handle}>{isYou ? t('space.members.you') : `@${name}`}</span>
        <span className={`mono ${styles.how}`}>{t('space.members.joined', { how, age: ageLabel(row.createdAt, now) })}</span>
      </span>

      {viaRoom || !mayManage ? (
        <span className={ui.chip}>{t(`space.members.role.${row.role}`)}</span>
      ) : (
        <select
          className={`mono ${ui.chip} ${styles.roleSelect}`}
          value={row.role}
          aria-label={t('space.members.roleOf', { name })}
          disabled={setRole.isPending}
          onChange={event => setRole.mutate({ userId: row.userId, role: event.target.value as MemberRole })}
        >
          {ROLES.map(role => (
            <option key={role} value={role}>
              {t(`space.members.role.${role}`)}
            </option>
          ))}
        </select>
      )}

      {viaRoom || !(mayManage || isYou) ? null : (
        <button type="button" className={styles.remove} aria-label={t('space.members.removeOf', { name })} onClick={() => setLeaving(true)}>
          <UserMinus size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}

      <Refused error={setRole.error} />
      {leaving ? <RemoveSheet spaceId={spaceId} userId={row.userId} name={name} isYou={isYou} onClose={() => setLeaving(false)} /> : null}
    </li>
  );
}

/**
 * Being shown the door, and walking out of it. They are the same row and the
 * same route, and they read entirely differently to the person tapping, so the
 * sheet says which of the two this is - and says the part that surprises
 * people either way: what somebody wrote in the tent stays in it and goes on
 * carrying their name.
 */
function RemoveSheet({
  spaceId,
  userId,
  name,
  isYou,
  onClose,
}: {
  spaceId: string;
  userId: string;
  name: string;
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
      <p className={styles.sheetBody}>{t(`space.members.${what}.body`, { name })}</p>
      <Refused error={remove.error} />
    </Sheet>
  );
}
