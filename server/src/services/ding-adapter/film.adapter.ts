import { Ding } from '@fg2/shared-types';
import { bildZeilen } from './bild.adapter';
import { begrenzeAbfrage, DingFenster } from './fenster';

/**
 * Timelapses and Rückblicke - the same `Image` collection, told apart by
 * format. A film covers a stretch of time rather than a moment, so it carries
 * the stretch it was rendered from.
 *
 * It projects with no device: a Rückblick is built from the pictures a person
 * took, and those exist without hardware.
 */
export const filmDinge = async (fenster: DingFenster): Promise<Ding[]> =>
  begrenzeAbfrage(fenster, async grenze =>
    (await bildZeilen(fenster, ['mp4'], true, grenze)).map(zeile => ({
      ding_id: `film:${zeile.image_id}`,
      zelt_id: fenster.zelt.zelt_id,
      ...(zeile.device_id ? { geraet_id: zeile.device_id } : {}),
      art: 'film' as const,
      name: '',
      t: zeile.timestamp,
      t_ende: zeile.timestampEnd ?? null,
      d: { dauer: zeile.duration },
    })),
  );
