import { Ding } from '@fg2/shared-types';
import deviceLogModel from '@models/devicelog.model';
import { bindungenImFenster, bindungsFenster, DingFenster, nachZeitAbsteigend } from './fenster';

/**
 * What the device said - reboots, alarms, firmware, socket switches - as rows in
 * the same list as everything a person wrote.
 *
 * Every log is clipped to the binding that produced it (§14.3): a claimed
 * second-hand controller carries its previous owner's log, and none of it is
 * this tent's history.
 *
 * A tent with no binding asks the log collection nothing at all.
 */
export const ereignisDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const bindungen = bindungenImFenster(fenster);
  if (bindungen.length === 0) {
    return [];
  }

  const zweige = bindungen
    .map(bindung => ({ bindung: bindung, gebunden: bindungsFenster(fenster, bindung) }))
    .filter(({ gebunden }) => gebunden.von <= gebunden.bis)
    .map(({ bindung, gebunden }) => ({
      device_id: bindung.geraet_id,
      time: { $gte: new Date(gebunden.von), $lte: new Date(gebunden.bis) },
    }));
  if (zweige.length === 0) {
    return [];
  }

  const logs = await deviceLogModel
    .find({ deleted: { $ne: true }, $or: zweige })
    .sort({ time: -1 })
    .lean();

  return nachZeitAbsteigend(
    logs.map(log => ({
      ding_id: `ereignis:${String(log._id)}`,
      zelt_id: fenster.zelt.zelt_id,
      geraet_id: log.device_id,
      art: 'ereignis' as const,
      // The device sends a `message-*` key, not a sentence; the webapp holds
      // the translations and a raw log is the one that is already text.
      name: log.title || log.message || '',
      t: new Date(log.time).getTime(),
      d: {
        nachricht: log.message,
        titel: log.title,
        roh: log.raw,
        severity: log.severity,
        kategorien: log.categories,
      },
      ...(log.images?.length ? { bilder: log.images } : {}),
    })),
  );
};
