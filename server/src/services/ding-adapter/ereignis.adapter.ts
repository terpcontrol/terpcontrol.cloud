import { Ding } from '@fg2/shared-types';
import deviceLogModel from '@models/devicelog.model';
import { messwerteAusDiary } from '@utils/messwerte';
import { begrenzeAbfrage, bindungenImFenster, bindungsFenster, bisCursor, DingFenster } from './fenster';

/**
 * A log row a person typed into the diary sheet rather than one the device
 * sent. The five categories the sheet offers all start this way
 * (`diary-entry-modal.component.ts:8-54`), and nothing the firmware emits does.
 */
const istHandschrift = (kategorien?: string[]): boolean => (kategorien ?? []).some(kategorie => kategorie.startsWith('diary-'));

/**
 * What the device said - reboots, alarms, firmware, socket switches - as rows in
 * the same list as everything a person wrote.
 *
 * The old diary wrote into the same collection, and those rows are **not** what
 * the device said: a `diary-*` entry is somebody's own writing, so it projects
 * as a `notiz` with no `geraet_id`, and its six legacy measurements are mapped
 * onto `Messwerte` by `messwerteAusDiary` (§4.2) so a pH of 6.2 typed in 2024
 * still reads as a pH today. A `diary-plant-lifecycle` row projects the same
 * way for now; §3.6 hands those to a later backfill that emits `pflanze` and
 * `phase` out of them, and that slice has to stop projecting them here.
 *
 * The art is decided per row, so a caller asking for `ereignis` gets the legacy
 * notes too. That is deliberate - they would otherwise be unreachable, since
 * `notiz` routes to the `Ding` collection - and it is the one place where the
 * requested art and the returned art differ.
 *
 * Every log is clipped to the binding that produced it (§14.3): a claimed
 * second-hand controller carries its previous owner's log, and none of it is
 * this tent's history.
 *
 * A tent with no binding asks the log collection nothing at all.
 */
export const ereignisDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const geklemmt = bisCursor(fenster);
  const bindungen = bindungenImFenster(geklemmt);
  if (bindungen.length === 0) {
    return [];
  }

  const zweige = bindungen
    .map(bindung => ({ bindung: bindung, gebunden: bindungsFenster(geklemmt, bindung) }))
    .filter(({ gebunden }) => gebunden.von <= gebunden.bis)
    .map(({ bindung, gebunden }) => ({
      device_id: bindung.geraet_id,
      time: { $gte: new Date(gebunden.von), $lte: new Date(gebunden.bis) },
    }));
  if (zweige.length === 0) {
    return [];
  }

  return begrenzeAbfrage(fenster, async grenze => {
    const abfrage = deviceLogModel.find({ deleted: { $ne: true }, $or: zweige }).sort({ time: -1 });
    const logs = await (grenze === undefined ? abfrage : abfrage.limit(grenze)).lean();

    return logs.map(log => {
      const t = new Date(log.time).getTime();
      const bilder = log.images?.length ? { bilder: log.images } : {};

      if (istHandschrift(log.categories)) {
        const messwerte = messwerteAusDiary(log.data);

        return {
          ding_id: `notiz:${String(log._id)}`,
          zelt_id: fenster.zelt.zelt_id,
          art: 'notiz' as const,
          // The old sheet titled an entry with its category key
          // (`message-diary-measurement`); the webapp holds the translations, so
          // the key travels and the server invents no sentence.
          name: log.title || '',
          t: t,
          d: {
            text: log.message ?? '',
            ...(messwerte ? { messwerte: messwerte } : {}),
            // Where it came from, for the backfill in §3.6 and for anything that
            // has to tell a projected note from one somebody types today.
            aus_log: true,
            kategorien: log.categories,
          },
          ...bilder,
        };
      }

      // The one payload an `ereignis` carries: §14.6's count of the diary as it
      // stood the moment before the device joined it, which the upgrade screen
      // prints back to the user as the proof that nothing moved.
      const zaehler = (log.data as { zaehler?: unknown } | undefined)?.zaehler;

      return {
        ding_id: `ereignis:${String(log._id)}`,
        zelt_id: fenster.zelt.zelt_id,
        geraet_id: log.device_id,
        art: 'ereignis' as const,
        // The device sends a `message-*` key, not a sentence; the webapp holds
        // the translations and a raw log is the one that is already text.
        name: log.title || log.message || '',
        t: t,
        d: {
          nachricht: log.message,
          titel: log.title,
          roh: log.raw,
          severity: log.severity,
          kategorien: log.categories,
          ...(zaehler ? { zaehler: zaehler } : {}),
        },
        ...bilder,
      };
    });
  });
};
