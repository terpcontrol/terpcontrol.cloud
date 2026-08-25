import { Device, Ding } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import { begrenze, bindungenImFenster, DingFenster } from './fenster';

/**
 * One Ding per binding in `Zelt.geraete`, ended ones included: a device that
 * left in June still produced what the tent shows for May, and a row that
 * vanished with the binding would leave that history unattributable.
 *
 * A tent with no binding never reaches the device collection - the query below
 * is not even built. That is the device-less case, and it is the reason this
 * adapter starts with a length check rather than an `$in: []`.
 *
 * The binding's start is part of the `ding_id` always, not only when a device
 * is bound to one tent twice (§14.9, an RMA). What identifies this Ding is the
 * binding, and appending the start only on a collision would make the identity
 * depend on the window the read happened to ask for: a page covering only the
 * second stretch would call it `geraet:<id>`, a page covering both would call
 * the same row `geraet:<id>:<seit>`, and a client keying a list by `ding_id`
 * then holds one thing under two ids - or, worse, merges two.
 */
export const geraetDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const bindungen = bindungenImFenster(fenster);
  if (bindungen.length === 0) {
    return [];
  }

  const geraete: Device[] = await deviceModel
    .find(
      { device_id: { $in: bindungen.map(bindung => bindung.geraet_id) } },
      { _id: 0, device_id: 1, name: 1, device_type: 1, lastseen: 1, current_firmware: 1 },
    )
    .lean();
  const nachId = new Map(geraete.map(geraet => [geraet.device_id, geraet]));

  return begrenze(
    fenster,
    bindungen.map(bindung => {
      const geraet = nachId.get(bindung.geraet_id);

      return {
        ding_id: `geraet:${bindung.geraet_id}:${bindung.seit}`,
        zelt_id: fenster.zelt.zelt_id,
        geraet_id: bindung.geraet_id,
        art: 'geraet',
        name: geraet?.name?.trim() || '',
        t: bindung.seit,
        t_ende: bindung.bis ?? null,
        d: {
          typ: geraet?.device_type,
          firmware: geraet?.current_firmware,
          zuletzt_gesehen: geraet?.lastseen,
        },
      };
    }),
  );
};
