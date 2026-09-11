import { jest } from '@jest/globals';
import { Device } from '@fg2/shared-types';
import { DeviceService } from '@modules/device/device.service';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { startTestDatabase, TestDatabase } from './support/database';

/**
 * What the server does with a stored document that lacks a field the shared
 * type used to promise. The collections require almost none of what `Device`,
 * `DeviceClass` and `ClaimCode` describe, so a row written before a field
 * existed - or by a path that never filled it in - reaches the service
 * half-empty.
 *
 * None of it has an HTTP surface the black-box suite could drive: the rollout
 * runs on a timer, a device answers its configuration over MQTT, and a claim
 * code that names no device cannot be made through the API at all.
 */

/** The two passes that run on a timer, with no caller outside the class. */
type DeviceServiceInternals = {
  findUpgradeableDevices(): Promise<void>;
  fetchMessage(device: Device, payload: unknown): Promise<void>;
};

let db: TestDatabase;
let mqtt: { publish: jest.Mock<(topic: string, message: string) => void>; canPublish: boolean };
let devices: DeviceService;
let internals: DeviceServiceInternals;

const aDevice = (device_id: string, rest: Partial<Device> = {}) => ({
  device_id,
  username: device_id,
  password: 'secret',
  ...rest,
});

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.reset();
  mqtt = { publish: jest.fn<(topic: string, message: string) => void>(), canPublish: true };
  devices = new DeviceService(
    db.devices,
    db.deviceLogs,
    db.deviceClasses,
    db.deviceFirmwares,
    {} as never,
    db.claimCodes,
    mqtt as unknown as MqttClientService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  internals = devices as unknown as DeviceServiceInternals;
});

afterEach(() => devices.onApplicationShutdown());

describe('a claim code that names no device', () => {
  it('claims nothing', async () => {
    await db.devices.create(aDevice('someone-elses-device', { owner_id: 'the-owner' }));
    await db.claimCodes.create({ claim_code: 'ABC123' });

    // A code that names no device used to be redeemed all the same: mongoose
    // reads the missing id as a filter on null, so the claim went looking for
    // whichever device has no id either, and the caller was answered
    // `undefined` where this promises `null`.
    expect(await devices.claimDevice('ABC123', 'the-claimer')).toBeNull();
    expect((await db.devices.findOne({ device_id: 'someone-elses-device' }).lean())?.owner_id).toBe('the-owner');
  });
});

describe('a device that never reported what it is', () => {
  it('is still described with a device type', async () => {
    await db.devices.create(aDevice('typeless-device', { owner_id: 'the-owner' }));

    // The answer used to carry no `device_type` at all, while the type it is
    // declared with said it always would.
    expect(await devices.getDeviceAccessInfo('typeless-device', 'the-owner')).toMatchObject({
      device_id: 'typeless-device',
      device_type: '',
      isPublic: false,
    });
  });
});

describe('a device with no stored configuration', () => {
  it('is not sent one when it asks', async () => {
    const device = (await db.devices.create(aDevice('unconfigured-device'))).toObject();

    await internals.fetchMessage(device, {});

    // It used to be published `undefined`, because only the empty string counted
    // as having nothing to send.
    expect(mqtt.publish).not.toHaveBeenCalled();
  });

  it('is sent the configuration once it has one', async () => {
    const device = (await db.devices.create(aDevice('configured-device', { configuration: '{"day":{}}' }))).toObject();

    await internals.fetchMessage(device, {});

    expect(mqtt.publish).toHaveBeenCalledWith('/devices/configured-device/configuration', '{"day":{}}');
  });
});

describe('a device class with no firmware', () => {
  it('rolls nothing out to its devices', async () => {
    await db.deviceClasses.create({ class_id: 'firmwareless', name: 'fridge', concurrent: 5, maxfails: 10 });
    await db.devices.create(
      aDevice('waiting-device', {
        class_id: 'firmwareless',
        lastseen: Date.now(),
        current_firmware: 'fw-1',
        pending_firmware: 'fw-2',
        cloudSettings: { firmwareChannel: 'stable', pendingFirmware: 'fw-2' },
      }),
    );

    await internals.findUpgradeableDevices();

    // The class had no firmware to roll out, but the pass ran anyway: the
    // device was recorded as upgrading to nothing, and the firmware it was
    // actually waiting for was dropped on the way.
    const device = await db.devices.findOne({ device_id: 'waiting-device' }).lean();
    expect(device?.fwupdate_start).toBeUndefined();
    expect(device?.pending_firmware).toBe('fw-2');
    expect(device?.cloudSettings?.pendingFirmware).toBe('fw-2');
  });
});
