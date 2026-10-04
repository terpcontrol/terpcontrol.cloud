import { mongo } from 'mongoose';
import { LEGACY } from './legacy';
import { legacyName } from './migration';

/** The old pictures table, which stands for exactly as long as the way back does. */
const LEGACY_IMAGES = legacyName(LEGACY.images);

/**
 * Of these pictures, the ones the previous release still holds a row for - and
 * which are therefore nothing for a sweep of ours to delete yet.
 *
 * While `legacy_images` is standing, two sweeps would otherwise destroy pictures
 * nothing else has a copy of. The cleanup reads a picture with no camera, no
 * grow and no space as unreachable, which is how one whose device row was
 * already gone arrives, and one `012-media` had to drop leaves its bytes in the
 * bucket with no row naming them at all. The thinning meets three years of
 * stills the previous release kept every one of and applies today's tiers to the
 * lot, because their `capturedAt` is the day they were taken.
 *
 * Both are decisions about history somebody already has, and the first migration
 * moved the only copy of those bytes out of the document - so neither is a
 * sweep's to make while there is still a way back. The release that drops
 * `legacy_*` is where that decision belongs, and after it these pictures are
 * collected and thinned like anything else.
 */
export const picturesTheWayBackHolds = async (db: mongo.Db | undefined, ids: string[]): Promise<Set<string>> => {
  if (!db || ids.length === 0) return new Set();

  // Asked every time rather than remembered: the release that drops it does so
  // while a server is running, and this costs one name lookup.
  if ((await db.listCollections({ name: LEGACY_IMAGES }, { nameOnly: true }).toArray()).length === 0) return new Set();

  const held = await db.collection(LEGACY_IMAGES).distinct('image_id', { image_id: { $in: ids } });
  return new Set(held.filter((id): id is string => typeof id === 'string'));
};
