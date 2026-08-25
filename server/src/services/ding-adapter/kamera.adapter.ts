import { Device, Ding } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import imageModel from '@models/images.model';
import { DingFenster, nachZeitAbsteigend, offeneBindungen } from './fenster';

/** A `webcam_did` that stands for a camera: not missing, and not the word the device sends when one is gone. */
const gekoppelt = (webcam_did: string | undefined): boolean => webcam_did !== undefined && webcam_did !== '' && webcam_did !== 'none';

/**
 * The camera exists because the device says it is paired, not because it has
 * produced a picture: a camera coupled ten seconds ago is in the tent and has
 * no frames yet. The newest frame rides along as the evidence for it.
 *
 * Like `dose`, only an open binding projects - the pairing is part of what the
 * device reports now.
 */
export const kameraDinge = async (fenster: DingFenster): Promise<Ding[]> => {
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
    const webcam_did = nachId.get(bindung.geraet_id)?.hardwareInfo?.['webcam_did'];
    if (!gekoppelt(webcam_did)) {
      continue;
    }

    // The newest frame at or before the end of the window, so a look at last
    // week shows last week's picture rather than this morning's.
    const letztes = await imageModel
      .findOne({ device_id: bindung.geraet_id, format: 'jpeg', timestamp: { $lte: fenster.bis } }, { _id: 0, image_id: 1, timestamp: 1 })
      .sort({ timestamp: -1 })
      .lean();

    dinge.push({
      ding_id: `kamera:${webcam_did}`,
      zelt_id: fenster.zelt.zelt_id,
      geraet_id: bindung.geraet_id,
      art: 'kamera',
      // No name is reported for a camera, and the server has no locale to
      // invent one in; the webapp labels it.
      name: '',
      // Nothing records when the camera was coupled, so the earliest honest
      // moment is when its device joined the tent.
      t: bindung.seit,
      t_ende: null,
      ...(letztes ? { auto_bild: letztes.image_id } : {}),
      d: { webcam_did: webcam_did, letztes_bild_t: letztes?.timestamp },
    });
  }

  return nachZeitAbsteigend(dinge);
};
