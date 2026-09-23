import { LEGACY, LegacyDevice, createdAtOf, flagOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';
import { loadDeviceFacts } from '../device-facts';

/**
 * The camera fields scattered across `cloudSettings` and the `hardware-info`
 * report become a camera of its own, one per device that has one.
 *
 * A device with pictures but no stream any more gets one too, with `removedAt`
 * set: its stills have to belong to something, or they lose their link and the
 * sweep that hunts for orphaned bytes eventually takes them.
 *
 * Decisions the old shape forces:
 *
 * - **What it is called.** Nothing names a camera today. It takes the device's
 *   name, and two thirds of the fleet was never named - so an unnamed device's
 *   camera is called what this app calls a new one, "Terp Cam 1" or "Camera 2",
 *   numbered per owner and per kind in the order the devices were made. The id
 *   it used to fall back to is a name for a machine and not for a person, which
 *   is the argument `004-spaces` makes about exactly this device and this
 *   grower; three of the ten cameras in the restored database carried a bare
 *   uuid as their name, and every screen that draws a camera drew it. The words
 *   are English because the server has no catalogue to say them in, and the
 *   name is one tap to change.
 * - **`stillIntervalSeconds`** is the interval the pipeline has always polled
 *   at; it was a constant, not a setting, so every migrated camera starts at it.
 * - **`nightOff` is false.** There was no such switch, and turning it on for
 *   somebody would stop pictures they have been getting.
 * - **`state.lastStillAt` is the newest still the device ever delivered.** The
 *   poller does overwrite it within one interval - but only for a camera the
 *   poller reaches, and a camera behind a controller that has gone quiet is
 *   never reached again. Left null it would stand for ever, and null is read
 *   everywhere as "this camera has never taken a picture": the screens spell it
 *   "never" beside a thumbnail of the picture it took, and the health loop skips
 *   the camera entirely because it takes the null for a setup nobody finished.
 *   The pictures are the only record of when the stream last worked, so they are
 *   what it is filled from, and the aggregate that finds the devices with
 *   pictures at all is already reading them.
 * - **Entitlement.** Twelve months from migration day with `grant: migration`,
 *   for every camera that exists, RTSP cameras included, as the record decides.
 * - **`secret`** is the camera password the controller reported as
 *   `webcam_pwd`. It is never served, which is also why it left
 *   `devices.state.hardware`.
 * - **`url`** keeps the stream with its credentials in it, because that is what
 *   opening the stream needs; the serialiser is what strips them.
 */

const STILL_INTERVAL_SECONDS = 30;

const ENTITLEMENT_MONTHS = 12;

const TRANSPORTS = ['tcp', 'udp'];

const MODELS = ['terp_cam', 'tapo_c200', 'reolink', 'hikvision', 'custom'];

/** The app's own words for a camera nobody has named, one per kind of camera. */
const UNNAMED: Record<string, string> = { terpcam_controller: 'Terp Cam', rtsp: 'Camera' };

/** "Terp Cam 2": the next number this owner has of that kind, counting only the ones being named here. */
const nextName = (counted: Map<string, number>, ownerId: string | null, kind: string): string => {
  const key = `${ownerId}:${kind}`;
  const n = (counted.get(key) ?? 0) + 1;
  counted.set(key, n);

  return `${UNNAMED[kind] ?? UNNAMED.rtsp} ${n}`;
};

export const cameras: MigrationStep = {
  name: '008-cameras',
  // The pictures are read here too, to find the devices that need a retired
  // camera, but moving that collection aside belongs to the migration that
  // transforms it - and a source is read under whichever name it has.
  moves: [LEGACY.devices],

  async run(context: MigrationContext): Promise<void> {
    const facts = await loadDeviceFacts(context);
    const legacy = await context.source(LEGACY.devices);
    const validUntil = new Date(context.at);
    validUntil.setMonth(validUntil.getMonth() + ENTITLEMENT_MONTHS);
    // One counter per owner and per kind, so a grower with three unnamed
    // streams gets Camera 1, Camera 2 and Camera 3 rather than three of one
    // name. The devices are read in the order they were made, which is the
    // order their owner met them in, so a repeated run numbers them the same.
    const counted = new Map<string, number>();

    for await (const device of legacy.find<LegacyDevice>({}).sort({ _id: 1 })) {
      const deviceId = textOf(device.device_id);
      const fact = deviceId ? facts.get(deviceId) : undefined;
      if (!deviceId || !fact) continue;

      if (fact.cameraId === null) {
        if (fact.ownerId === null && textOf(device.cloudSettings?.rtspStream)) {
          context.reject({
            source: LEGACY.devices,
            id: deviceId,
            reason: 'the device has a stream but no owner, and a camera belongs to somebody',
            dropped: true,
            detail: null,
          });
        }
        continue;
      }

      context.count('cameras.read');
      const hardware = device.hardwareInfo ?? {};
      const did = fact.terpCamLabel ?? notNone(hardware.webcam_did);
      const kind = fact.terpCamLabel ? 'terpcam_controller' : 'rtsp';

      await context.write('cameras', {
        id: fact.cameraId,
        createdAt: createdAtOf(device),
        ownerId: fact.ownerId,
        kind,
        deviceId,
        spaceId: fact.spaceId,
        name: fact.name ?? nextName(counted, fact.ownerId, kind),
        looksAt: null,
        plantIds: [],
        did,
        uid: notNone(hardware.webcam_uid),
        ip: notNone(hardware.webcam_ip),
        secret: notNone(hardware.webcam_pwd),
        // A Terp Cam is reached by its id, not by a URL: the stream field holds
        // the marker and the id, which is the camera's `did` and not an address.
        url: fact.terpCamLabel ? null : fact.stream,
        transport: enumOf(device.cloudSettings?.rtspStreamTransport, TRANSPORTS),
        tunnel: flagOf(device.cloudSettings?.tunnelRtspStream),
        model: enumOf(device.cloudSettings?.webcamModel, MODELS),
        stillIntervalSeconds: STILL_INTERVAL_SECONDS,
        nightOff: false,
        maintenanceOff: flagOf(device.cloudSettings?.maintenanceWebcamOff),
        logErrors: flagOf(device.cloudSettings?.logRtspStreamErrors),
        entitlement: { validUntil, grant: 'migration' },
        isDemo: fact.isDemo,
        // A camera nothing streams from any more is a tombstone its pictures
        // still point at, and is no longer listed.
        removedAt: fact.cameraRetired ? context.at : null,
        state: { lastStillAt: fact.lastStillAt, lastError: null, firmwareVersion: null },
      });

      if (fact.cameraRetired) context.count('cameras.retired');
    }
  },
};

/** The report spells "there is none" as the word, which is not a value. */
const notNone = (value: string | undefined): string | null => {
  const text = textOf(value);
  return text === null || text === 'none' ? null : text;
};

const enumOf = (value: string | undefined, allowed: string[]): string | null => {
  const text = textOf(value);
  return text !== null && allowed.includes(text) ? text : null;
};
