import type { GrowListItem } from '@fg2/shared-types/v1';
import { useGrows } from '@/api/grows';
import { enough, standsIn, useMayWith } from '@/ui/session-access';

/**
 * The grows that could move into a place: every one still running that is not
 * already standing there, because a move to where the plants already are is not
 * a move. All three screens that offer the move mean the same set by it, so
 * they ask the question here rather than each filtering the list for itself.
 *
 * A grow this account may only write lines in is not among them either. The
 * move is written against the grow and is `manage` where it stands today, so
 * offering one would end in a refusal after the tent and the day had been
 * chosen - and a list somebody may not act on is not a list of answers.
 */
export const useMovableGrows = (spaceId: string): { pending: boolean; items: GrowListItem[] } => {
  const grows = useGrows();
  const mayWith = useMayWith();

  return {
    pending: grows.isPending,
    items: (grows.data?.items ?? []).filter(
      grow =>
        grow.endedAt === null &&
        !grow.summary.locations.some(one => one.spaceId === spaceId) &&
        enough(mayWith({ ownerId: grow.ownerId, spaceId: standsIn(grow) }), 'manage'),
    ),
  };
};
