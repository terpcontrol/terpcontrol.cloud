import { Ding } from '@fg2/shared-types';
import zielStandModel from '@models/zielstand.model';
import { begrenzeAbfrage, bisCursor, DingFenster } from './fenster';

/**
 * The targets and the windows they were in force for. Keyed by tent, never by
 * device: a hand target has no device, and that is what lets the target line
 * run unbroken from the weeks before a controller into the weeks after it.
 *
 * With no device and no hand target the collection simply holds nothing for
 * this tent - which is why this adapter needs no device check to return
 * nothing for a device-less tent.
 */
export const zielDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const geklemmt = bisCursor(fenster);

  return begrenzeAbfrage(fenster, async grenze => {
    const abfrage = zielStandModel
      .find({
        zelt_id: geklemmt.zelt.zelt_id,
        gilt_ab: { $lte: geklemmt.bis },
        // Half-open: a target with no end is still in force, so it overlaps every
        // window that has opened since it was set.
        $or: [{ gilt_bis: { $gte: geklemmt.von } }, { gilt_bis: { $exists: false } }, { gilt_bis: null }],
      })
      .sort({ gilt_ab: -1 });
    const staende = await (grenze === undefined ? abfrage : abfrage.limit(grenze)).lean();

    return staende.map(stand => ({
      // Two controllers in one tent hold the same setpoint under the same key,
      // and a migration that binds both stamps them with one `gilt_ab` - so tent,
      // key and moment do not identify a target, and a client keying by
      // `ding_id` would silently keep one of the two. The device is what tells
      // them apart, and it is appended rather than always present because a hand
      // target has none and must keep an id of its own.
      ding_id: `ziel:${fenster.zelt.zelt_id}:${stand.schluessel}:${stand.gilt_ab}${stand.geraet_id ? `:${stand.geraet_id}` : ''}`,
      zelt_id: fenster.zelt.zelt_id,
      ...(stand.geraet_id ? { geraet_id: stand.geraet_id } : {}),
      art: 'ziel' as const,
      name: stand.schluessel,
      t: stand.gilt_ab,
      t_ende: stand.gilt_bis ?? null,
      ...(stand.gesetzt_von ? { akteur: stand.gesetzt_von } : {}),
      d: { schluessel: stand.schluessel, wert: stand.wert, quelle: stand.quelle },
    }));
  });
};
