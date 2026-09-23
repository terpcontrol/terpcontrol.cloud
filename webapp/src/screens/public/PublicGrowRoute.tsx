import { useParams } from 'react-router';
import { publicPicture, usePublicGrow, usePublicGrowWeeks } from '@/api/public';
import { ApiError } from '@/api/problem';
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
 */
export function PublicGrowRoute() {
  const { slug = '' } = useParams();
  const now = useNow();
  const grow = usePublicGrow(slug);
  const earlier = usePublicGrowWeeks(slug, grow.data?.weeksCursor ?? null);

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

  return (
    <PublicShell title={grow.data.name}>
      <Diary page={grow.data} picture={publicPicture(slug)} now={now} earlier={earlier} />
    </PublicShell>
  );
}
