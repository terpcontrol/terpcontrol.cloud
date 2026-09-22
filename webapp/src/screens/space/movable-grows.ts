import type { GrowListItem } from '@fg2/shared-types/v1';
import { useGrows } from '@/api/grows';

/**
 * The grows that could move into a place: every one still running that is not
 * already standing there, because a move to where the plants already are is not
 * a move. All three screens that offer the move mean the same set by it, so
 * they ask the question here rather than each filtering the list for itself.
 */
export const useMovableGrows = (spaceId: string): { pending: boolean; items: GrowListItem[] } => {
  const grows = useGrows();

  return {
    pending: grows.isPending,
    items: (grows.data?.items ?? []).filter(grow => grow.endedAt === null && !grow.summary.locations.some(one => one.spaceId === spaceId)),
  };
};
