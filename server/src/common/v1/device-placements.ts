import { FilterQuery, Model } from 'mongoose';
import { Span } from '@common/v1/range';
import type { DevicePlacement, StoredDevice } from '@database/schemas/v1/devices.schema';

/**
 * Where a device stood, and when.
 *
 * A device row says where it stands now (`spaceId`), which is all a read about
 * now needs. A read about a stretch of time - a place's curves, a grow's days,
 * an export - asks the placements instead, so a device that has since left a
 * tent still speaks for the days it stood there, and one that has since come
 * says nothing of where it stood before.
 */

/**
 * A stay shorter than this is a mistake put right and not a stay: a move
 * undone from its toast, a device claimed into a place of its own and sent on
 * a step later. The window a diary line may be taken back in, for the same
 * reason.
 */
export const BRIEF_STAY_MS = 5 * 60 * 1000;

/**
 * The placements after a device is put in a place, or taken out of every place
 * (`null`), at an instant. Nothing changes where it already stands there.
 */
export const movedTo = (placements: readonly DevicePlacement[], spaceId: string | null, at: Date): DevicePlacement[] => {
  const kept = [...placements];
  const open = kept.findIndex(placement => placement.endedAt === null);

  if (open >= 0) {
    const standing = kept[open];
    if (standing.spaceId === spaceId) return kept;

    if (at.getTime() - standing.startedAt.getTime() < BRIEF_STAY_MS) kept.splice(open, 1);
    else kept[open] = { ...standing, endedAt: at };
  }
  if (spaceId === null) return kept;

  // Back where it stood a moment ago: that stay goes on as if nothing had happened.
  const last = kept[kept.length - 1];
  if (last && last.spaceId === spaceId && last.endedAt !== null && at.getTime() - last.endedAt.getTime() < BRIEF_STAY_MS) {
    return [...kept.slice(0, -1), { ...last, endedAt: null }];
  }

  return [...kept, { spaceId, startedAt: at, endedAt: null }];
};

/**
 * When a placement begins for a read. A device's first placement also speaks
 * for what it measured before it was put there: the hour between plugging a
 * new device in and claiming it, and the days a device carried over from the
 * old cloud had already run, were measured where it first stood. Every later
 * placement begins when it began.
 */
const beginsAt = (placement: DevicePlacement, index: number): number => (index === 0 ? -Infinity : placement.startedAt.getTime());

/** The placements in these places that reach into the stretch, each with when it begins for a read. */
const reaching = (placements: readonly DevicePlacement[] | undefined, spaceIds: readonly (string | null)[], span: Span) =>
  (placements ?? [])
    .map((placement, index) => ({ placement, from: beginsAt(placement, index) }))
    .filter(
      ({ placement, from }) =>
        spaceIds.includes(placement.spaceId) && from < span.endsAt.getTime() && (placement.endedAt === null || placement.endedAt > span.startsAt),
    );

/**
 * The part of a stretch a device stood in any of these places: from its first
 * moment there inside the stretch to its last. A device that left and came back
 * inside one stretch is answered across the gap.
 */
export const stayOf = (placements: readonly DevicePlacement[] | undefined, spaceIds: readonly (string | null)[], span: Span): Span | null => {
  const there = reaching(placements, spaceIds, span);
  if (there.length === 0) return null;

  const from = Math.max(span.startsAt.getTime(), Math.min(...there.map(one => one.from)));
  const to = Math.min(span.endsAt.getTime(), Math.max(...there.map(one => one.placement.endedAt?.getTime() ?? Infinity)));
  return to > from ? { startsAt: new Date(from), endsAt: new Date(to) } : null;
};

/** A device, and the part of a stretch it stood in the places asked about. */
export interface Stood<T extends Pick<StoredDevice, 'id'> = StoredDevice> {
  device: T;
  stay: Span;
  /**
   * When it was put there, where that lies inside the stay: a first placement
   * is read from before it began, and what held the place until then is still
   * the device that stood there before.
   */
  since: Date;
}

/** The devices with a placement in one of these places that reaches into the stretch. */
const stoodDuring = (spaceIds: readonly string[], span: Span): FilterQuery<StoredDevice> => ({
  $or: [
    {
      placements: {
        $elemMatch: { spaceId: { $in: spaceIds }, startedAt: { $lt: span.endsAt }, $or: [{ endedAt: null }, { endedAt: { $gt: span.startsAt } }] },
      },
    },
    // A first placement reaches back past its own beginning (`beginsAt`).
    { 'placements.0.spaceId': { $in: spaceIds }, 'placements.0.endedAt': null },
    { 'placements.0.spaceId': { $in: spaceIds }, 'placements.0.endedAt': { $gt: span.startsAt } },
  ],
});

/**
 * Every device that stood in these places inside a stretch, each with its stay:
 * the ones standing there now first, in the order they were claimed - which is
 * the order every read about now lists them in - then the ones that have left,
 * the last to leave first.
 */
export const stoodIn = async (
  devices: Model<StoredDevice>,
  spaceIds: readonly string[],
  span: Span,
  projection: Record<string, 1> | null = null,
): Promise<Stood[]> => {
  if (spaceIds.length === 0 || span.endsAt <= span.startsAt) return [];

  const rows = await devices
    .find(stoodDuring(spaceIds, span), projection ? { ...projection, id: 1, spaceId: 1, placements: 1, createdAt: 1 } : undefined)
    .sort({ createdAt: 1, id: 1 })
    .lean<StoredDevice[]>();
  const stood = rows.flatMap(device => {
    const stay = stayOf(device.placements, spaceIds, span);
    if (!stay) return [];

    const put = Math.min(...reaching(device.placements, spaceIds, span).map(one => one.placement.startedAt.getTime()));
    return [{ device, stay, since: new Date(Math.min(stay.endsAt.getTime(), Math.max(stay.startsAt.getTime(), put))) }];
  });
  const here = (one: Stood): boolean => one.device.spaceId !== null && spaceIds.includes(one.device.spaceId);

  return [...stood.filter(here), ...stood.filter(one => !here(one)).sort((one, other) => other.stay.endsAt.getTime() - one.stay.endsAt.getTime())];
};
