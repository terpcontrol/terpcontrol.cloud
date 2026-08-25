import { Device, Ding } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import { bindungenImFenster, DingFenster, nachZeitAbsteigend } from './fenster';

/**
 * One Ding per binding in `Zelt.geraete`, ended ones included: a device that
 * left in June still produced what the tent shows for May, and a row that
 * vanished with the binding would leave that history unattributable.
 *
 * A tent with no binding never reaches the device collection - the query below
 * is not even built. That is the device-less case, and it is the reason this
 * adapter starts with a length check rather than an `$in: []`.
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

  // A device bound to the same tent twice would otherwise give two rows one
  // ding_id; only then does the binding's start have to join the identity.
  const bindungenJeGeraet = new Map<string, number>();
  bindungen.forEach(bindung => bindungenJeGeraet.set(bindung.geraet_id, (bindungenJeGeraet.get(bindung.geraet_id) ?? 0) + 1));

  return nachZeitAbsteigend(
    bindungen.map(bindung => {
      const geraet = nachId.get(bindung.geraet_id);
      const mehrfach = (bindungenJeGeraet.get(bindung.geraet_id) ?? 0) > 1;

      return {
        ding_id: mehrfach ? `geraet:${bindung.geraet_id}:${bindung.seit}` : `geraet:${bindung.geraet_id}`,
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
