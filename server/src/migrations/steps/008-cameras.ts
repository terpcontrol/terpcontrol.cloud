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
 *   name, and a device without one falls back to its id.
 * - **`stillIntervalSeconds`** is the interval the pipeline has always polled
 *   at; it was a constant, not a setting, so every migrated camera starts at it.
 * - **`nightOff` is false.** There was no such switch, and turning it on for
 *   somebody would stop pictures they have been getting.
 * - **`state.lastStillAt` is null**, rather than the newest still's instant. The
 *   poller fills it within one interval, and reading the whole picture
 *   collection to pre-fill a value that is about to be overwritten buys nothing.
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

      await context.write('cameras', {
        id: fact.cameraId,
        createdAt: createdAtOf(device),
        ownerId: fact.ownerId,
        kind: fact.terpCamLabel ? 'terpcam_controller' : 'rtsp',
        deviceId,
        spaceId: fact.spaceId,
        name: fact.name ?? deviceId,
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
        state: { lastStillAt: null, lastError: null, firmwareVersion: null },
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
