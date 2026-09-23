import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { useInvites } from '@/api/invites';
import { useRemoveMember } from '@/api/members';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { isLive } from './invites';
import styles from './Members.module.css';

/** Who is being shown the door, read off their row before the row goes. */
export type Leaving = {
  userId: string;
  name: string;
  /** The room they stay in the tent through, or nothing when this row is their only way in. */
  room: string | null;
  /** The code that let them in, where one did and where losing it is this tap's doing. */
  inviteId: string | null;
  isYou: boolean;
};

/**
 * Being shown the door, and walking out of it. They are the same row and the
 * same route, and they read entirely differently to the person tapping, so the
 * sheet says which of the two this is - and says the part that surprises
 * people either way: what somebody wrote in the tent stays in it and goes on
 * carrying their name. Somebody who is also in the room does not leave the
 * tent at all by this; they give up the role they held here and keep the tent
 * through the room, and the sheet says exactly that rather than promising a
 * door that stays open.
 *
 * The other surprise is the key. Taking somebody out revokes the code they
 * came in on - the link is still in the chat it was pasted into, and the
 * person just shown the door is the one holding it - but one link is one key
 * that may have gone to several people, so a host who cut a single link for a
 * club spends it on the first removal. That is worth doing and is not worth
 * doing silently, so the sheet says it before the tap, and says it only where
 * it is true: the code has to be one this tent still has out and live, and
 * nothing is revoked when somebody walks out of their own accord.
 *
 * It hangs on the screen rather than on the row it was opened from, because
 * the row is the first thing the removal takes away: a sheet owned by it would
 * be torn off the page the moment the server answered, and with it the word
 * about what the removal cost.
 */
export function RemoveSheet({
  spaceId,
  leaving,
  now,
  onClose,
  onLinkStopped,
}: {
  spaceId: string;
  leaving: Leaving;
  now: DateTime;
  onClose: () => void;
  /** Told the code that stopped working, so the screen can say what the removal cost besides the row. */
  onLinkStopped: (code: string) => void;
}) {
  const { t } = useTranslation();
  const remove = useRemoveMember(spaceId);
  const { userId, name, room, inviteId, isYou } = leaving;
  // The host's own list, already loaded beside these rows; a guest is asked
  // nothing, because their leaving takes no key with it and the route that
  // lists the keys is not theirs to call.
  const invites = useInvites(spaceId, inviteId !== null);
  const what = isYou ? 'leave' : 'remove';
  const key = invites.data?.items.find(invite => invite.id === inviteId) ?? null;
  // A code that has already been revoked or has run out stops nothing further,
  // so promising that it will is as wrong as saying nothing at all.
  const stopping = key !== null && isLive(key, now) ? key.code : null;

  return (
    <Sheet
      title={t(`space.members.${what}.title`, { name })}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(userId, {
              onSuccess: () => {
                if (stopping) onLinkStopped(stopping);
                onClose();
              },
            })
          }
        >
          {t(`space.members.${what}.yes`)}
        </button>
      }
    >
      <p className={styles.sheetBody}>
        {room ? t(`space.members.${what}.bodyKeepsRoom`, { name, room }) : t(`space.members.${what}.body`, { name })}
      </p>
      {stopping ? <p className={styles.sheetBody}>{t('space.members.remove.alsoTheLink', { code: stopping })}</p> : null}
      <Refused error={remove.error} />
    </Sheet>
  );
}
