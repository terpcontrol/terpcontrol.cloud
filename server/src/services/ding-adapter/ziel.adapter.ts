import { Ding } from '@fg2/shared-types';
import zielStandModel from '@models/zielstand.model';
import { DingFenster, nachZeitAbsteigend } from './fenster';

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
  const staende = await zielStandModel
    .find({
      zelt_id: fenster.zelt.zelt_id,
      gilt_ab: { $lte: fenster.bis },
      // Half-open: a target with no end is still in force, so it overlaps every
      // window that has opened since it was set.
      $or: [{ gilt_bis: { $gte: fenster.von } }, { gilt_bis: { $exists: false } }, { gilt_bis: null }],
    })
    .sort({ gilt_ab: -1 })
    .lean();

  return nachZeitAbsteigend(
    staende.map(stand => ({
      ding_id: `ziel:${fenster.zelt.zelt_id}:${stand.schluessel}:${stand.gilt_ab}`,
      zelt_id: fenster.zelt.zelt_id,
      ...(stand.geraet_id ? { geraet_id: stand.geraet_id } : {}),
      art: 'ziel' as const,
      name: stand.schluessel,
      t: stand.gilt_ab,
      t_ende: stand.gilt_bis ?? null,
      ...(stand.gesetzt_von ? { akteur: stand.gesetzt_von } : {}),
      d: { schluessel: stand.schluessel, wert: stand.wert, quelle: stand.quelle },
    })),
  );
};
