import type { EntryPage, GrowListItem, GrowWeekCard } from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf } from '@fg2/shared-types/v1-schemas/feeding.js';
import { api } from '@/api/client';
import { useRead } from '@/api/read';
import { DAY_IN_YEAR, zoned } from '@/ui/zone';

/** One picture of a grow, with what it is shown under in the viewer. */
export interface GrowPicture {
  mediaId: string;
  takenAt: string;
  day: number | null;
  text: string | null;
}

/** As many photo lines as a viewer of one grow is worth reading at once. */
const PHOTO_LIMIT = 200;

/** The photo lines of a grow, which is where its pictures are written. */
export const useGrowPhotoLines = (growId: string) =>
  useRead({
    queryKey: ['entries', 'photos', growId],
    queryFn: ({ signal }) => api.get<EntryPage>('/entries', { growId, kinds: 'photo', limit: PHOTO_LIMIT }, signal),
  });

/**
 * Every picture of a grow, oldest first: what was written into its diary, and
 * the camera's picture of each day the week cards show. One picture is one
 * frame, however many places it appears in.
 */
export const picturesOf = (grow: GrowListItem, lines: EntryPage | undefined, weeks: GrowWeekCard[] = []): GrowPicture[] => {
  const origin = growOriginOf(grow);
  const dayOf = (at: string): number => growDayAt(origin, new Date(at));
  const written = (lines?.items ?? []).flatMap(entry =>
    entry.mediaIds.map(mediaId => ({ mediaId, takenAt: entry.occurredAt, day: dayOf(entry.occurredAt), text: entry.text })),
  );
  const stills = weeks.flatMap(week =>
    week.days.flatMap(day =>
      day.mediaId && day.capturedAt ? [{ mediaId: day.mediaId, takenAt: day.capturedAt, day: day.dayNumber, text: null }] : [],
    ),
  );
  const seen = new Set<string>();

  return [...written, ...stills]
    .filter(picture => (seen.has(picture.mediaId) ? false : (seen.add(picture.mediaId), true)))
    .sort((one, other) => one.takenAt.localeCompare(other.takenAt));
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Tag 15 · 26. Sep · Nach dem Toppen …": which day, which date, and what was written with it. */
export const pictureCaption = (t: Translate, picture: GrowPicture, zone: string | null): string =>
  [
    picture.day !== null ? t('home.card.dayN', { day: picture.day }) : null,
    zoned(picture.takenAt, zone).toFormat(DAY_IN_YEAR),
    picture.text,
  ]
    .filter(Boolean)
    .join(' · ');
