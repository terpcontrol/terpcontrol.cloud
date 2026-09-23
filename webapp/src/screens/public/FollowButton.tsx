import { Check, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/api/session';
import { useFollowGrow, useFollows, useUnfollowGrow } from '@/api/sharing';
import ui from '@/ui/ui.module.css';
import styles from './Public.module.css';

/**
 * Keeping a diary on your home screen, and stopping.
 *
 * Only a real account has anywhere to put it: a stranger has no home screen and
 * the demo is somebody else's account, which the server refuses to write a
 * follow against - so neither is offered a button that would be refused.
 * Following is a state rather than an event, which is why one button says both
 * what is true and what tapping it does.
 *
 * Nothing is drawn until the stored session has been tried. On a public address
 * that happens as the page loads, and a button that decided before it was
 * finished would be the wrong one for a beat - a reader who is signed in would
 * see no Follow at all and reach for the browser's back button instead.
 */
export function FollowButton({ growId }: { growId: string }) {
  const { t } = useTranslation();
  const { user, restored } = useSession();
  const mayFollow = restored && user !== null && !user.isDemo;
  const follows = useFollows(mayFollow);
  const follow = useFollowGrow();
  const unfollow = useUnfollowGrow();

  if (!mayFollow) return null;

  const following = follows.data?.items.some(row => row.growId === growId) ?? false;
  const busy = follows.isPending || follow.isPending || unfollow.isPending;

  return (
    <button
      type="button"
      className={`${ui.chip} ${styles.follow}`}
      data-following={following}
      disabled={busy}
      onClick={() => (following ? unfollow.mutate(growId) : follow.mutate(growId))}
    >
      {following ? <Check size={13} strokeWidth={2} aria-hidden /> : <Plus size={13} strokeWidth={2} aria-hidden />}
      {t(following ? 'publicPage.following' : 'publicPage.follow')}
    </button>
  );
}
