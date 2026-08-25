import { Device, Ding, readSockets, socketKey, socketsReported } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import { begrenze, DingFenster, offeneBindungen } from './fenster';

/**
 * One Ding per socket - not per role. Several sockets may carry the same role
 * and switch together, and each of them is its own piece of hardware with its
 * own address, so each is its own thing.
 *
 * Only a binding that is still open projects. The socket table is what the
 * controller reports *now*; a device that has left the tent cannot testify
 * about the sockets it had while it was here.
 *
 * A controller that reports no table at all projects nothing - not an empty
 * row, not an unknown one. `socketsReported()` is the whole test.
 */
export const doseDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const bindungen = offeneBindungen(fenster);
  if (bindungen.length === 0) {
    return [];
  }

  const geraete: Device[] = await deviceModel
    .find({ device_id: { $in: bindungen.map(bindung => bindung.geraet_id) } }, { _id: 0, device_id: 1, hardwareInfo: 1 })
    .lean();
  const nachId = new Map(geraete.map(geraet => [geraet.device_id, geraet]));

  const dinge: Ding[] = [];
  for (const bindung of bindungen) {
    const geraet = nachId.get(bindung.geraet_id);
    if (!geraet || !socketsReported(geraet.hardwareInfo)) {
      continue;
    }

    for (const dose of readSockets(geraet.hardwareInfo)) {
      // The hardware id is what the controller finds the socket by, so a DHCP
      // lease change moves this Ding instead of retiring one and inventing
      // another. A socket paired before ids were kept reports none; those fall
      // back to their position, which a re-slot does break - the fallback is
      // for legacy pairings, and the controller learns the real id in the
      // background. `socketKey()` is how a command addresses the socket and is
      // never the identity, so it appears here only inside that fallback.
      const identitaet = dose.id || `${bindung.geraet_id}:${socketKey(dose)}`;

      dinge.push({
        ding_id: `dose:${identitaet}`,
        zelt_id: fenster.zelt.zelt_id,
        geraet_id: bindung.geraet_id,
        art: 'dose',
        // The firmware's own word for the role. The webapp translates it
        // (`sockets.roles.*`) into `Heizung (Dose 1)`; the server has no locale
        // and writing German here would put a language in the database.
        name: dose.role,
        // Nothing records when a socket was paired, so the earliest honest
        // moment is when its controller joined the tent.
        t: bindung.seit,
        t_ende: null,
        d: { rolle: dose.role, slot: dose.slot, hardware_id: dose.id, ip: dose.ip },
      });
    }
  }

  return begrenze(fenster, dinge);
};
