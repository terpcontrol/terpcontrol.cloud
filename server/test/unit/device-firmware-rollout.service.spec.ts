import { jest } from '@jest/globals';
import { Device, DeviceClass } from '@fg2/shared-types';
import { DeviceFirmwareRolloutService } from '@modules/device/device-firmware-rollout.service';
import { DeviceLogService } from '@modules/device/device-log.service';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { startTestDatabase, TestDatabase } from './support/database';

/**
 * Who is handed a firmware, and when a device that was handed one but has not
 * moved is told again. Neither is reachable over HTTP: the rollout runs on a
 * timer, and the devices it has to tell apart - the ones configured before
 * `firmwareChannel` existed - cannot be created through an API that writes the
 * modern field. A pass is therefore run here directly, against a real database.
 */

const CLASS_ID = 'class-fridge';
const STABLE = 'fw-stable';
const BETA = 'fw-beta';

/**
 * The pass and the instruction timer have no caller outside the class; naming
 * the three seams the spec drives is more honest than reaching for `any`.
 */
type RolloutInternals = {
  findUpgradeableDevices(): Promise<void>;
  sendUpgradeInstruction(deviceId: string): Promise<void>;
  upgradeInstructionBackoff: Map<string, { firmwareId: string; nextDelayMs: number }>;
};

let db: TestDatabase;
let mqtt: { publish: jest.Mock<(topic: string, message: string) => boolean> };
let rollout: DeviceFirmwareRolloutService;
let internals: RolloutInternals;

const aClass = (overrides: Partial<DeviceClass> = {}) => ({
  class_id: CLASS_ID,
  name: 'fridge',
  description: 'Fridge Controller',
  concurrent: 2,
  maxfails: 3,
  firmware_id: STABLE,
  ...overrides,
});

/** A device that reported a minute ago, so the rollout counts it as reachable. */
const aDevice = (device_id: string, overrides: Partial<Device> = {}) => ({
  device_id,
  username: device_id,
  password: 'secret',
  class_id: CLASS_ID,
  current_firmware: 'fw-old',
  lastseen: Date.now() - 60_000,
  ...overrides,
});

const pendingFirmwareOf = async (device_id: string): Promise<string | undefined> => {
  const device = await db.devices.findOne({ device_id }).lean();
  return device?.cloudSettings?.pendingFirmware;
};

/** The devices the pass told to upgrade, by the build each was given. */
const toldToUpgrade = async (): Promise<Record<string, string>> => {
  const devices = await db.devices.find({ 'cloudSettings.pendingFirmware': { $exists: true } }).lean();
  return Object.fromEntries(devices.map(device => [device.device_id, device.cloudSettings.pendingFirmware]));
};

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  mqtt = { publish: jest.fn<(topic: string, message: string) => boolean>().mockReturnValue(true) };
  rollout = new DeviceFirmwareRolloutService(
    db.devices,
    db.deviceClasses,
    {} as never,
    mqtt as unknown as MqttClientService,
    {} as unknown as DeviceLogService,
  );
  internals = rollout as unknown as RolloutInternals;
});

describe('which devices a pass picks up', () => {
  it('hands the stable build to a device that asked for the stable channel', async () => {
    await db.deviceClasses.create(aClass());
    await db.devices.create(aDevice('on-stable', { cloudSettings: { firmwareChannel: 'stable' } }));

    await internals.findUpgradeableDevices();

    expect(await pendingFirmwareOf('on-stable')).toBe(STABLE);
  });

  it('leaves a device on the manual channel where it is', async () => {
    await db.deviceClasses.create(aClass());
    await db.devices.create(aDevice('manual', { cloudSettings: { firmwareChannel: 'manual' } }));

    await internals.findUpgradeableDevices();

    expect(await pendingFirmwareOf('manual')).toBeUndefined();
  });

  it('leaves a device that has not reported for a while alone', async () => {
    await db.deviceClasses.create(aClass());
    await db.devices.create(aDevice('offline', { cloudSettings: { firmwareChannel: 'stable' }, lastseen: Date.now() - 60 * 60_000 }));

    await internals.findUpgradeableDevices();

    expect(await pendingFirmwareOf('offline')).toBeUndefined();
  });

  it('reads a device configured before the channels existed from the auto-update flag it has', async () => {
    // Room for every device that qualifies, so what the pass picks is about the
    // flags rather than about how many upgrades the class allows at once.
    await db.deviceClasses.create(aClass({ beta_firmware_id: BETA, concurrent: 10 }));
    // The two flags a device could have been left with, in both places they
    // were written, and one device that never opted in at all.
    await db.devices.create(aDevice('legacy-cloud-flag', { cloudSettings: { autoFirmwareUpdate: true } }));
    await db.devices.create(aDevice('legacy-device-flag', { firmwareSettings: { autoUpdate: true } }));
    await db.devices.create(aDevice('legacy-beta', { cloudSettings: { autoFirmwareUpdate: true, betaFeatures: true } }));
    await db.devices.create(aDevice('legacy-off', { cloudSettings: { autoFirmwareUpdate: false } }));

    await internals.findUpgradeableDevices();

    expect(await toldToUpgrade()).toEqual({
      'legacy-cloud-flag': STABLE,
      'legacy-device-flag': STABLE,
      'legacy-beta': BETA,
    });
  });

  it('does not offer a pre-release build to a device that never asked for one', async () => {
    await db.deviceClasses.create(aClass({ beta_firmware_id: BETA }));
    await db.devices.create(aDevice('on-stable', { cloudSettings: { firmwareChannel: 'stable' } }));

    await internals.findUpgradeableDevices();

    expect(await pendingFirmwareOf('on-stable')).toBe(STABLE);
  });

  it('stops at the number of upgrades the class allows at once', async () => {
    await db.deviceClasses.create(aClass({ concurrent: 2 }));
    for (const name of ['a', 'b', 'c', 'd']) {
      await db.devices.create(aDevice(name, { cloudSettings: { firmwareChannel: 'stable' } }));
    }

    await internals.findUpgradeableDevices();

    expect(Object.keys(await toldToUpgrade())).toHaveLength(2);
  });

  it('counts the upgrades already running against that number', async () => {
    await db.deviceClasses.create(aClass({ concurrent: 2 }));
    await db.devices.create(
      aDevice('already-going', { cloudSettings: { firmwareChannel: 'stable', pendingFirmware: STABLE }, fwupdate_start: Date.now() }),
    );
    await db.devices.create(aDevice('waiting-1', { cloudSettings: { firmwareChannel: 'stable' } }));
    await db.devices.create(aDevice('waiting-2', { cloudSettings: { firmwareChannel: 'stable' } }));

    await internals.findUpgradeableDevices();

    // One of the two slots is taken, so only one more device is sent on its way.
    const upgrading = Object.keys(await toldToUpgrade());
    expect(upgrading).toContain('already-going');
    expect(upgrading).toHaveLength(2);
  });

  it('stops handing out a build that too many devices have failed to install', async () => {
    await db.deviceClasses.create(aClass({ concurrent: 2, maxfails: 1 }));
    // Told long enough ago that the update has timed out, and still not running it.
    await db.devices.create(
      aDevice('failed', {
        cloudSettings: { firmwareChannel: 'stable', pendingFirmware: STABLE },
        fwupdate_start: Date.now() - 60 * 60_000,
      }),
    );
    await db.devices.create(aDevice('next-in-line', { cloudSettings: { firmwareChannel: 'stable' } }));

    await internals.findUpgradeableDevices();

    expect(await pendingFirmwareOf('next-in-line')).toBeUndefined();
  });
});

describe('telling a device that has not moved', () => {
  const behindDevice = () => db.devices.create(aDevice('behind', { cloudSettings: { firmwareChannel: 'manual', pendingFirmware: STABLE } }));

  it('publishes the build the device is meant to be running', async () => {
    await behindDevice();

    await internals.sendUpgradeInstruction('behind');

    expect(mqtt.publish).toHaveBeenCalledWith('/devices/behind/firmware', STABLE);
  });

  it('waits twice as long before each repeat, so a device that cannot install it is not asked forever', async () => {
    await behindDevice();

    await internals.sendUpgradeInstruction('behind');
    const afterFirst = internals.upgradeInstructionBackoff.get('behind').nextDelayMs;

    await internals.sendUpgradeInstruction('behind');
    const afterSecond = internals.upgradeInstructionBackoff.get('behind').nextDelayMs;

    expect(afterSecond).toBe(afterFirst * 2);
  });

  it('says nothing to a device that is already running the build, and forgets the wait it had earned', async () => {
    await db.devices.create(aDevice('caught-up', { current_firmware: STABLE, cloudSettings: { pendingFirmware: STABLE } }));
    internals.upgradeInstructionBackoff.set('caught-up', { firmwareId: STABLE, nextDelayMs: 240_000 });

    await internals.sendUpgradeInstruction('caught-up');

    expect(mqtt.publish).not.toHaveBeenCalled();
    expect(internals.upgradeInstructionBackoff.has('caught-up')).toBe(false);
  });

  it('starts the wait over when the device is pointed at a different build', async () => {
    await behindDevice();
    internals.upgradeInstructionBackoff.set('behind', { firmwareId: 'fw-something-else', nextDelayMs: 240_000 });

    await internals.sendUpgradeInstruction('behind');

    expect(internals.upgradeInstructionBackoff.get('behind')).toEqual({ firmwareId: STABLE, nextDelayMs: 60_000 });
  });

  it('says nothing about a device that has been removed since it was queued', async () => {
    await internals.sendUpgradeInstruction('no-such-device');

    expect(mqtt.publish).not.toHaveBeenCalled();
  });
});
