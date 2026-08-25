import { FilterQuery } from 'mongoose';
import { Ding, Image } from '@fg2/shared-types';
import imageModel from '@models/images.model';
import { bindungenImFenster, bindungsFenster, DingFenster, nachZeitAbsteigend } from './fenster';

/** What a projection needs from an `Image`, which is everything except the picture. */
export type BildZeile = Pick<Image, 'image_id' | 'device_id' | 'timestamp' | 'timestampEnd' | 'format' | 'duration'> & { zelt_id?: string };

const OHNE_DATEN = { _id: 0, image_id: 1, device_id: 1, zelt_id: 1, timestamp: 1, timestampEnd: 1, format: 1, duration: 1 };

/**
 * A picture is a moment and a film is a stretch, so the same window means two
 * different questions. `alsZeitraum` asks the second one: a timelapse that runs
 * across the window belongs in it even though it started before it.
 */
const zeitraum = (von: number, bis: number, alsZeitraum: boolean): FilterQuery<Image> =>
  alsZeitraum
    ? {
        timestamp: { $lte: bis },
        $or: [{ timestampEnd: { $gte: von } }, { timestampEnd: { $exists: false }, timestamp: { $gte: von } }],
      }
    : { timestamp: { $gte: von, $lte: bis } };

/**
 * Every row of the requested formats that belongs to this tent, in both
 * keyings: `zelt_id` on anything written since the tent existed, `device_id` on
 * everything older. No backfill is assumed, so the legacy half is resolved the
 * only way it can be - through the bindings - and clipped to each binding, or a
 * second-hand controller would hand this tent the previous owner's pictures.
 */
export const bildAbfrage = (fenster: DingFenster, formate: string[], alsZeitraum = false): FilterQuery<Image> => {
  const zweige: FilterQuery<Image>[] = [{ zelt_id: fenster.zelt.zelt_id, ...zeitraum(fenster.von, fenster.bis, alsZeitraum) } as FilterQuery<Image>];

  for (const bindung of bindungenImFenster(fenster)) {
    const gebunden = bindungsFenster(fenster, bindung);
    if (gebunden.von > gebunden.bis) {
      continue;
    }
    zweige.push({ device_id: bindung.geraet_id, ...zeitraum(gebunden.von, gebunden.bis, alsZeitraum) });
  }

  return { format: { $in: formate }, $or: zweige };
};

/** Reads the rows without the `data` buffer: a list of sixty photographs is sixty full-size reads otherwise. */
export const bildZeilen = async (fenster: DingFenster, formate: string[], alsZeitraum = false): Promise<BildZeile[]> =>
  imageModel.find(bildAbfrage(fenster, formate, alsZeitraum), OHNE_DATEN).sort({ timestamp: -1 }).lean() as unknown as Promise<BildZeile[]>;

/**
 * Pictures: the camera's frames and the pictures a person took, as one art.
 * Which of the two a row is stays visible in `d.quelle`, because that is the
 * word the caption prints (§5) - it is not a reason to split the art in two.
 */
export const bildDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const zeilen = await bildZeilen(fenster, ['jpeg', 'user/jpeg']);

  return nachZeitAbsteigend(
    zeilen.map(zeile => ({
      ding_id: `bild:${zeile.image_id}`,
      zelt_id: fenster.zelt.zelt_id,
      ...(zeile.device_id ? { geraet_id: zeile.device_id } : {}),
      art: 'bild' as const,
      // A picture has no name. The webapp captions it from `t` and `d.quelle`.
      name: '',
      t: zeile.timestamp,
      bilder: [zeile.image_id],
      d: { quelle: zeile.format === 'user/jpeg' ? 'hand' : 'geraet', format: zeile.format },
    })),
  );
};
