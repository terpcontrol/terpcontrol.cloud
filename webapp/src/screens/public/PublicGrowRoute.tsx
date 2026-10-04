import { useEffect } from 'react';
import { useParams } from 'react-router';
import { publicPicture, usePublicGrow, usePublicGrowWeeks } from '@/api/public';
import { ApiError } from '@/api/problem';
import { session } from '@/api/session';
import { FollowButton } from './FollowButton';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { Diary } from './Diary';
import { Nothing } from './Nothing';
import { PublicShell } from './PublicShell';

/**
 * `/g/{slug}`: the address somebody pastes into a message.
 *
 * It sits outside the session gate, so a stranger never meets the sign-in page
 * and never sees a frame of it either. One read answers the page and the weeks
 * a reader opens on; a diary that ran longer than one page holds says so with a
 * cursor, and the weeks before those are read when somebody asks for them.
 *
 * Sitting outside that gate is also why the session is restored here. Nothing
 * else on a public address does it, and a reader who is signed in has to be
 * offered Follow rather than be treated as a stranger on the one page the whole
 * app points them at to start following. `restore()` is idempotent, so saying it
 * here as well costs a signed-in reader nothing.
 */
export function PublicGrowRoute() {
  const { slug = '' } = useParams();
  const now = useNow();
  const grow = usePublicGrow(slug);
  const earlier = usePublicGrowWeeks(slug, grow.data?.weeksCursor ?? null);

  useEffect(() => {
    void session.restore();
  }, []);

  if (grow.isPending) {
    return (
      <PublicShell>
        <Waiting lines={4} />
      </PublicShell>
    );
  }

  if (!grow.data) {
    return (
      <PublicShell>
        {grow.error instanceof ApiError && grow.error.status === 404 ? (
          <Nothing titleKey="publicPage.noDiary.title" bodyKey="publicPage.noDiary.body" />
        ) : (
          <LoadFailed retry={() => void grow.refetch()} />
        )}
      </PublicShell>
    );
  }

  // Beside the author, which is where the Following screen and the empty home
  // both say it is. The id is null for a diary that has no public page of its
  // own, which is a diary nothing can be followed of.
  const follow = grow.data.growId === null ? null : <FollowButton growId={grow.data.growId} />;

  return (
    <PublicShell title={grow.data.name}>
      <Diary page={grow.data} picture={publicPicture(slug)} now={now} aside={follow} earlier={earlier} />
    </PublicShell>
  );
}
