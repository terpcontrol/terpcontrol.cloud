import { derivedId } from '../ids';
import {
  LEGACY,
  LegacyClaimCode,
  LegacyDeviceClass,
  LegacyDeviceFirmware,
  LegacyDeviceFirmwareBinary,
  createdAtOf,
  flagOf,
  instantOf,
  numberOf,
  textOf,
} from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';

/**
 * The four collections whose transform is nothing but field names: the update
 * classes, the builds, their files and the claim codes.
 *
 * What is not only a rename:
 *
 * - **`rollout`** is new. Every class starts unpaused and at 100 %, which is
 *   what a class does today, because staged rollout is a thing the old model
 *   cannot have been doing.
 * - **A binary with no name** cannot be served: OTA asks for a file by name, and
 *   a row without one has never matched a request. It is rejected rather than
 *   given an invented name, which would put bytes nobody has verified under a
 *   name a device does ask for.
 * - **A claim code that names no device** is a row the old schema allows and
 *   nothing can use. Rejected.
 * - **A duplicate `class_id` or `firmware_id`** keeps its first document and
 *   rejects the rest: neither is unique today, and the two rows say different
 *   things about one id.
 */
export const fleet: MigrationStep = {
  name: '003-fleet',

  async run(context: MigrationContext): Promise<void> {
    await deviceClasses(context);
    await firmwares(context);
    await firmwareBinaries(context);
    await claimCodes(context);
  },
};

const deviceClasses = async (context: MigrationContext): Promise<void> => {
  await context.renameAside(LEGACY.deviceClasses);
  const legacy = await context.source(LEGACY.deviceClasses);
  const seen = new Set<string>();

  for await (const deviceClass of legacy.find<LegacyDeviceClass>({}).sort({ _id: 1 })) {
    context.count('deviceClasses.read');

    const id = textOf(deviceClass.class_id);
    if (!id) {
      context.reject({ source: LEGACY.deviceClasses, id: String(deviceClass._id), reason: 'no class_id', dropped: true, detail: null });
      continue;
    }
    if (seen.has(id)) {
      context.reject({ source: LEGACY.deviceClasses, id, reason: 'a second class carries this class_id', dropped: true, detail: null });
      continue;
    }
    seen.add(id);

    await context.write('deviceClasses', {
      id,
      createdAt: createdAtOf(deviceClass),
      name: textOf(deviceClass.name) ?? id,
      description: textOf(deviceClass.description),
      concurrentUpdates: numberOf(deviceClass.concurrent) ?? 1,
      maxFailures: numberOf(deviceClass.maxfails) ?? 0,
      firmwareIds: {
        stable: textOf(deviceClass.firmware_id),
        beta: textOf(deviceClass.beta_firmware_id),
        alpha: textOf(deviceClass.alpha_firmware_id),
      },
      rollout: { paused: false, percent: 100 },
    });
  }
};

const firmwares = async (context: MigrationContext): Promise<void> => {
  await context.renameAside(LEGACY.deviceFirmwares);
  const legacy = await context.source(LEGACY.deviceFirmwares);
  const seen = new Set<string>();

  for await (const firmware of legacy.find<LegacyDeviceFirmware>({}).sort({ _id: 1 })) {
    context.count('firmwares.read');

    const id = textOf(firmware.firmware_id);
    const classId = textOf(firmware.class_id);
    const version = textOf(firmware.version);

    if (!id || !classId || !version) {
      context.reject({
        source: LEGACY.deviceFirmwares,
        id: id ?? String(firmware._id),
        reason: 'a build without an id, a class or a version cannot be offered to a device',
        dropped: true,
        detail: null,
      });
      continue;
    }
    if (seen.has(id)) {
      context.reject({ source: LEGACY.deviceFirmwares, id, reason: 'a second build carries this firmware_id', dropped: true, detail: null });
      continue;
    }
    seen.add(id);

    await context.write('firmwares', {
      id,
      createdAt: instantOf(firmware.createdAt) ?? createdAtOf(firmware),
      classId,
      name: textOf(firmware.name),
      version,
      wasStable: flagOf(firmware.wasStable),
    });
  }
};

const firmwareBinaries = async (context: MigrationContext): Promise<void> => {
  await context.renameAside(LEGACY.deviceFirmwareBinaries);
  const legacy = await context.source(LEGACY.deviceFirmwareBinaries);

  // One at a time and by `_id`: a row carries a whole firmware image, and a
  // batch of them is a batch of megabytes held in memory at once.
  for await (const binary of legacy.find<LegacyDeviceFirmwareBinary>({}).sort({ _id: 1 }).batchSize(1)) {
    context.count('firmwareBinaries.read');

    const firmwareId = textOf(binary.firmware_id);
    const name = textOf(binary.name);

    if (!firmwareId || !name || !binary.data) {
      context.reject({
        source: LEGACY.deviceFirmwareBinaries,
        id: String(binary._id),
        reason: !name ? 'a file with no name is not reachable over OTA, which asks for a build’s file by name' : 'no build or no bytes',
        dropped: true,
        detail: firmwareId,
      });
      continue;
    }

    await context.write('firmwareBinaries', {
      id: derivedId('firmwareBinary', firmwareId, name),
      createdAt: createdAtOf(binary),
      firmwareId,
      name,
      data: binary.data,
    });
    // Megabytes per row, so each one goes on its own rather than filling a batch.
    await context.flushAll();
  }
};

const claimCodes = async (context: MigrationContext): Promise<void> => {
  await context.renameAside(LEGACY.claimCodes);
  const legacy = await context.source(LEGACY.claimCodes);

  for await (const claimCode of legacy.find<LegacyClaimCode>({}).sort({ _id: 1 })) {
    context.count('claimCodes.read');

    const code = textOf(claimCode.claim_code);
    const deviceId = textOf(claimCode.device_id);

    if (!code || !deviceId) {
      context.reject({
        source: LEGACY.claimCodes,
        id: code ?? String(claimCode._id),
        reason: 'a code that names no device, or a device with no code, claims nothing',
        dropped: true,
        detail: null,
      });
      continue;
    }

    await context.write('claimCodes', { id: derivedId('claimCode', deviceId), createdAt: createdAtOf(claimCode), code, deviceId });
  }
};
