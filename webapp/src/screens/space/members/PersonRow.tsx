import { UserMinus } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { MemberRole, Membership } from '@fg2/shared-types/v1';
import { useSetMemberRole } from '@/api/members';
import { useLog } from '@/log/log-context';
import { ageLabel } from '@/ui/age';
import { Facts } from '@/ui/Facts';
import { Refused } from '@/ui/PageState';
import { RowText } from '@/ui/Rows';
import ui from '@/ui/ui.module.css';
import { ROLES } from './invites';
import { rowsFor, type Guest } from './people';
import type { Leaving } from './RemoveSheet';
import styles from './Members.module.css';

/**
 * One person who sees the place: who they are, whether they are here through
 * the room, when they last wrote, and what they may do.
 *
 * A person can be here both ways at once, and is drawn once with the stronger
 * of the two roles, because that is the one the server grants. The menu
 * writes the rows that make it so (`rowsFor`) and the way out ends the
 * place's own row before the room's - each at the space the row names, since
 * the server refuses a room's row changed through a place. The answer to
 * either is a toast that says where it holds.
 *
 * When they last logged is the server's answer and nothing is inferred from
 * its absence: somebody who never wrote is said to have written nothing.
 */
export function PersonRow({
  place,
  guest,
  handle,
  roomName,
  lastLogged,
  diary = true,
  isYou,
  mayManage,
  now,
  onAskToRemove,
}: {
  place: { id: string; name: string };
  guest: Guest;
  handle: string | null;
  roomName: string | null;
  /** When they last wrote here; `null` never. */
  lastLogged: string | null;
  /** Whether the account keeps a diary, without which there is nothing anybody logs and no date to give for it. */
  diary?: boolean;
  isYou: boolean;
  /** Whether this session owns the place, which is what changing and ending a membership takes. */
  mayManage: boolean;
  now: DateTime;
  /** Asks the screen for the sheet: this row is the first thing a removal takes away, so it cannot hold one. */
  onAskToRemove: (leaving: Leaving) => void;
}) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const setRole = useSetMemberRole();
  const name = handle ?? t('space.members.someone');
  const room = roomName ?? t('space.members.theRoom');
  const ends = guest.here ?? guest.viaRoom!;
  const nameOf = (spaceId: string) => (spaceId === place.id ? place.name : room);
  const facts = [
    guest.viaRoom ? t('space.members.viaRoom', { room }) : null,
    !diary ? null : lastLogged === null ? t('space.members.neverLogged') : t('space.members.lastLogged', { age: ageLabel(lastLogged, now) }),
  ];

  const change = async (role: MemberRole) => {
    const rows = rowsFor(guest, role);
    const write = (roleOf: (row: Membership) => MemberRole) =>
      rows.reduce(
        (done, row) => done.then(() => setRole.mutateAsync({ spaceId: row.spaceId, userId: row.userId, role: roleOf(row) })),
        Promise.resolve<unknown>(null),
      );
    const said = (held: MemberRole) => [t(`space.members.told.role.${held}`, { name }), ...rows.map(row => nameOf(row.spaceId))].join(' · ');
    try {
      await write(() => role);
      tell({
        label: said(role),
        undo: () => write(row => row.role).then(() => tell({ label: `${t('place.edit.told.undone')} · ${said(guest.role)}`, undo: null })),
        from: `member-${guest.userId}`,
      });
    } catch {
      // Said in the row, from the write that was refused.
    }
  };

  return (
    <div className={styles.person}>
      <RowText title={isYou ? t('space.members.you') : `@${name}`} line={facts.some(Boolean) ? <Facts facts={facts} /> : null} />
      <span className={styles.controls}>
        {mayManage ? (
          <select
            className={`mono ${ui.chip} ${styles.roleSelect}`}
            value={guest.role}
            aria-label={t('space.members.roleOf', { name })}
            disabled={setRole.isPending}
            onChange={event => void change(event.target.value as MemberRole)}
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
        {mayManage || isYou ? (
          <button
            type="button"
            className={styles.remove}
            aria-label={t(isYou ? 'space.members.leaveOf' : 'space.members.removeOf', { name, place: nameOf(ends.spaceId) })}
            onClick={() =>
              onAskToRemove({
                spaceId: ends.spaceId,
                userId: guest.userId,
                name,
                place: nameOf(ends.spaceId),
                room: ends.spaceId !== place.id ? null : guest.viaRoom ? room : null,
                ofRoom: ends.spaceId !== place.id,
                inviteId: isYou ? null : ends.inviteId,
                isYou,
              })
            }
          >
            <UserMinus size={16} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </span>
      <Refused error={setRole.error} />
    </div>
  );
}
