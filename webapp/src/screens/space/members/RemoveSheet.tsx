import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useInvites } from '@/api/invites';
import { useRemoveMember } from '@/api/members';
import { walkOut } from '@/app/places';
import { useLog } from '@/log/log-context';
import { Sheet } from '@/ui/Sheet';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { isLive } from './invites';
import styles from './Members.module.css';

/** Who is being shown the door, read off their row before the row goes. */
export type Leaving = {
  /** The space the row stands on, where it is ended: the place, or its room. */
  spaceId: string;
  userId: string;
  name: string;
  /** What that space is called. */
  place: string;
  /** The room they stay in the place through, or nothing when this row is their only way in. */
  room: string | null;
  /** The row is the room's: every place in it goes with it. */
  ofRoom: boolean;
  /** The code that let them in, where one did and where losing it is this tap's doing. */
  inviteId: string | null;
  isYou: boolean;
};

/**
 * Being shown the door, and walking out of it. They are the same row and the
 * same route, and they read entirely differently to the person tapping, so the
 * sheet says which of the two this is - and says the part that surprises
 * people either way: what somebody wrote stays and goes on carrying their
 * name. A room's row takes every place in the room with it; somebody who is
 * also in the room does not leave the place at all by ending its own row, and
 * the sheet says exactly that rather than promising a door that stays open.
 *
 * The other surprise is the key. Taking somebody out revokes the code they
 * came in on, and one link is one key that may have gone to several people.
 * So the sheet says it before the tap, and says it only where it is true: the
 * code has to be one still out and live, and nothing is revoked when somebody
 * walks out of their own accord.
 *
 * The answer is a toast, without a way back: it names who no longer sees
 * what, and the link that stopped with them. Whoever left is taken to Start -
 * the place is no longer theirs to look at.
 */
export function RemoveSheet({ leaving, now, onClose }: { leaving: Leaving; now: DateTime; onClose: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const navigate = useNavigate();
  const remove = useRemoveMember();
  const { spaceId, userId, name, place, room, ofRoom, inviteId, isYou } = leaving;
  // The host's own list; a guest is asked nothing, because their leaving takes
  // no key with it and the route that lists the keys is not theirs to call.
  const invites = useInvites(spaceId, inviteId !== null);
  const what = isYou ? 'leave' : 'remove';
  // Whoever walks out with no room to stay through has nothing left to look at here.
  const gone = isYou && !room;
  const key = invites.data?.items.find(invite => invite.id === inviteId) ?? null;
  // A code that has already been revoked or has run out stops nothing further,
  // so promising that it will is as wrong as saying nothing at all.
  const stopping = key !== null && isLive(key, now) ? key.code : null;
  const told = [
    t(`space.members.told.${isYou ? 'left' : 'removed'}${room ? 'Keeps' : ''}`, { name, place, room }),
    stopping ? t('space.members.told.linkStopped', { code: stopping }) : null,
  ];

  return (
    <Sheet
      title={t(`space.members.${what}.title`, { name, place })}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={remove.isPending || remove.isSuccess}
          onClick={() =>
            remove.mutate(
              { spaceId, userId, gone },
              {
                onSuccess: () => {
                  tell({ label: told.filter(Boolean).join(' · '), undo: null });
                  if (!gone) return onClose();
                  walkOut(spaceId);
                  // The sheet stands on a history entry over the page's (`ui/sheet-back.ts`): stepped back, Start replaces the page's own.
                  window.addEventListener('popstate', () => void navigate('/', { replace: true }), { once: true });
                  window.history.back();
                },
              },
            )
          }
        >
          {t(`space.members.${what}.yes`)}
        </button>
      }
    >
      <p className={styles.sheetBody}>{t(`space.members.${what}.${room ? 'bodyKeepsRoom' : ofRoom ? 'bodyRoom' : 'body'}`, { name, place, room })}</p>
      {stopping ? <p className={styles.sheetBody}>{t('space.members.remove.alsoTheLink', { code: stopping })}</p> : null}
      <Refused error={remove.error} />
    </Sheet>
  );
}
