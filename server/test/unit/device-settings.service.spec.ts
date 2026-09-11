import { jest } from '@jest/globals';
import { CloudSettings, Device } from '@fg2/shared-types';
import { DeviceLogService } from '@modules/device/device-log.service';
import { DeviceSettingsService } from '@modules/device/device-settings.service';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { startTestDatabase, TestDatabase } from './support/database';

/**
 * Two things the black-box suite cannot get at. The diary entry a
 * configuration change writes is asserted there only to the extent that it
 * names the value that changed; which keys it leaves out is a rule of its own.
 * And the settings of a device configured before `firmwareChannel` existed
 * cannot be created through an API that writes the modern field.
 */

const DEVICE = 'settings-device';

let db: TestDatabase;
let mqtt: { canPublish: boolean; publish: jest.Mock<(topic: string, message: string) => boolean> };
let settings: DeviceSettingsService;

const aDevice = (overrides: Partial<Device> = {}) => ({
  device_id: DEVICE,
  username: DEVICE,
  password: 'secret',
  configuration: '',
  ...overrides,
});

/** The diff the change was recorded with, as the grow diary shows it. */
const configurationDiff = async (): Promise<string | undefined> => {
  const entry = await db.deviceLogs.findOne({ device_id: DEVICE, title: 'message-device-configuration-updated' }).lean();
  return entry?.message;
};

const configure = (configuration: Record<string, unknown>) => settings.configureDevice(DEVICE, JSON.stringify(configuration));

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  mqtt = { canPublish: true, publish: jest.fn<(topic: string, message: string) => boolean>().mockReturnValue(true) };
  settings = new DeviceSettingsService(
    db.devices,
    {} as never,
    db.claimCodes,
    mqtt as unknown as MqttClientService,
    new DeviceLogService(db.devices, db.deviceLogs),
  );
});

describe('what a configuration change is recorded as', () => {
  it('names the nested key that changed, and leaves the rest out', async () => {
    await db.devices.create(aDevice({ configuration: JSON.stringify({ day: { temperature: 26, humidity: 60 } }) }));

    await configure({ day: { temperature: 28, humidity: 60 } });

    const diff = await configurationDiff();
    expect(diff).toContain('day.temperature: 26 -> 28');
    expect(diff).not.toContain('humidity');
  });

  it('writes nothing when the configuration is the one the device already has', async () => {
    const configuration = { day: { temperature: 26 } };
    await db.devices.create(aDevice({ configuration: JSON.stringify(configuration) }));

    await expect(configure(configuration)).resolves.toBe(false);
    expect(await configurationDiff()).toBeUndefined();
  });

  it('leaves out the start of a floating day that is not floating', async () => {
    // The device keeps the field whether or not it is using it, so a change to
    // it is noise unless the day is actually floating - which is the one case
    // where the owner can act on it.
    await db.devices.create(aDevice({ configuration: JSON.stringify({ daynight: { floating: false, float_start: 100 } }) }));

    await configure({ daynight: { floating: false, float_start: 200 } });

    expect(await configurationDiff()).toBeUndefined();
  });

  it('names it once the day is floating', async () => {
    await db.devices.create(aDevice({ configuration: JSON.stringify({ daynight: { floating: false, float_start: 100 } }) }));

    await configure({ daynight: { floating: true, float_start: 200 } });

    expect(await configurationDiff()).toContain('daynight.float_start: 100 -> 200');
  });
});

describe('a configuration that cannot be sent', () => {
  it('is refused before anything is stored, so a retry still has a diff to write', async () => {
    await db.devices.create(aDevice({ configuration: JSON.stringify({ day: { temperature: 26 } }) }));
    mqtt.canPublish = false;

    await expect(configure({ day: { temperature: 28 } })).rejects.toMatchObject({ status: 503 });

    const device = await db.devices.findOne({ device_id: DEVICE }).lean();
    expect(JSON.parse(device.configuration)).toEqual({ day: { temperature: 26 } });
  });
});

describe('the settings of a device that predates the firmware channels', () => {
  const channelOf = async (stored: Partial<Device>): Promise<CloudSettings['firmwareChannel']> => {
    await db.devices.create(aDevice(stored));
    return (await settings.getDeviceCloudSettings(DEVICE)).firmwareChannel;
  };

  it('reads an auto-updating device as following the stable channel', async () => {
    await expect(channelOf({ cloudSettings: { autoFirmwareUpdate: true } })).resolves.toBe('stable');
  });

  it('reads one that also opted into the beta features as following the beta channel', async () => {
    await expect(channelOf({ cloudSettings: { autoFirmwareUpdate: true, betaFeatures: true } })).resolves.toBe('beta');
  });

  it('reads the flag the device itself was configured with the same way', async () => {
    await expect(channelOf({ firmwareSettings: { autoUpdate: true } })).resolves.toBe('stable');
  });

  it('reads a device that never opted in as updating by hand only', async () => {
    await expect(channelOf({})).resolves.toBe('manual');
  });
});
