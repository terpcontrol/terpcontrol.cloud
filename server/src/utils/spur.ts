import deviceLogModel from '@models/devicelog.model';
import imageModel from '@models/images.model';

/** The earliest of the times that are known, or undefined when none is. */
export const fruehesteZeit = (...zeiten: Array<number | undefined>): number | undefined => {
  const bekannt = zeiten.filter((zeit): zeit is number => typeof zeit === 'number' && Number.isFinite(zeit));
  return bekannt.length === 0 ? undefined : Math.min(...bekannt);
};

/** `DeviceLog.time` is a Date and `Image.timestamp` epoch ms; both answer the same question. */
const alsZeit = (wert: unknown): number | undefined => {
  const zeit = wert instanceof Date ? wert.getTime() : typeof wert === 'number' ? wert : NaN;
  return Number.isFinite(zeit) ? zeit : undefined;
};

/**
 * One aggregation for the whole fleet, not one per device, and no document
 * fetch: `$match` on the `device_id` prefix and a projection of nothing but the
 * two indexed fields is what lets this be answered from the index instead of by
 * reading every stored JPEG.
 */
const aeltestePro = (feld: string) => [{ $project: { _id: 0, device_id: 1, [feld]: 1 } }, { $group: { _id: '$device_id', t: { $min: `$${feld}` } } }];

/**
 * The oldest row each of these devices left behind in Mongo — a log line or a
 * picture.
 *
 * A device that never reported a measurement, or whose samples have aged out of
 * the retention window, still has a past: dating its tent from today would clip
 * every one of those rows away, because §14.3 reads device-sourced history from
 * `GeraetBindung.seit` forward and no further back.
 */
export async function aeltesteSpuren(geraet_ids: string[]): Promise<Map<string, number>> {
  if (geraet_ids.length === 0) {
    return new Map();
  }

  const auswahl = { $match: { device_id: { $in: geraet_ids } } };
  const [logs, bilder] = await Promise.all([
    deviceLogModel.aggregate([auswahl, ...aeltestePro('time')]),
    imageModel.aggregate([auswahl, ...aeltestePro('timestamp')]),
  ]);

  return [...logs, ...bilder].reduce<Map<string, number>>((spuren, zeile) => {
    const zeit = alsZeit(zeile.t);
    if (typeof zeile._id === 'string' && zeile._id !== '' && zeit !== undefined) {
      spuren.set(zeile._id, fruehesteZeit(spuren.get(zeile._id), zeit) as number);
    }
    return spuren;
  }, new Map<string, number>());
}
