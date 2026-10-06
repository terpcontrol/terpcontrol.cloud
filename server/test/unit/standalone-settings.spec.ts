import { jest } from '@jest/globals';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { ProblemException } from '@common/v1/problem';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { fieldChangesOf } from '@modules/device-protocol/configuration-fields';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DeviceIngestService } from '@modules/device-protocol/device-ingest.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The settings of the stand-alone modules, changed by name: what a smart socket
 * switches by and at, its timer and its protections; what an AIR fan's speed
 * follows; when a LIGHT is on. And the one setting that spans two devices - the
 * AIR fan a socket slows while it doses CO2 - which the server keeps in step
 * with the socket on every write.
 */

const OWNER = 'user-1';
const PLUG = 'sim-plug-1';
const FAN = 'sim-fan-1';
const OTHER_FAN = 'sim-fan-2';
const HOUR = 3600;

let db: V1TestDatabase;
let published: { topic: string; message: Record<string, unknown> }[];
let configuration: DeviceConfigurationService;
let ingest: DeviceIngestService;

const plugDocument = (over: Record<string, unknown> = {}) => ({
  workmode: 'heater',
  usedaynight: false,
  daynight: { day: 6 * HOUR, night: 22 * HOUR },
  timer: { timeframes: [] },
  heater: { day: { on: 22, off: 25 }, night: { on: 20, off: 23 } },
  co2: { mode: 'const', period: 60, duration: 10, on: 600, off: 1000 },
  limits: { overtemperature: { enabled: false, limit: 30, hysteresis: 1 } },
  fan: '',
  ...over,
});

const fanDocument = (over: Record<string, unknown> = {}) => ({
  mode: 0,
  min_speed: 30,
  day: { temperature: 25, humidity: 60, fixed_speed: 70, max_speed: 100 },
  night: { temperature: 21, humidity: 55, fixed_speed: 40, max_speed: 60 },
  ...over,
});

const make = (id: string, type: string, document: Record<string, unknown>, fields: Partial<StoredDevice> = {}) =>
  db.devices.create({ id, type, ownerId: OWNER, configuration: document, ...fields });

const stored = async (id: string) => (await db.devices.findOne({ id }).lean<StoredDevice>())!;

const refusal = (type: string, set: Parameters<typeof fieldChangesOf>[1]) => {
  try {
    fieldChangesOf(type, set);
    return null;
  } catch (error) {
    return (error as ProblemException).problem;
  }
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  published = [];

  const mqtt = {
    canPublish: true,
    publish: jest.fn((topic: string, message: string) => {
      published.push({ topic, message: JSON.parse(message) });
      return true;
    }),
  } as unknown as MqttClientService;
  const publisher = new DevicePublisherService(db.devices, mqtt);
  const entries = new EntryWriterService(db.entries);
  configuration = new DeviceConfigurationService(db.devices, db.users, db.targetChanges, publisher, entries);
  ingest = new DeviceIngestService(
    db.devices,
    db.cameras,
    db.targetChanges,
    mqtt,
    publisher,
    new HardwareReportService(db.devices, db.cameras),
    entries,
    configuration,
  );
});

describe('a smart socket', () => {
  it('turns a work mode, the switch points, the day and the timer into its own document', () => {
    expect(
      fieldChangesOf('plug', {
        plugMode: 'cooler',
        dayNight: true,
        dayFrom: 5 * HOUR,
        coolerNightOff: 21.5,
        timerWindows: [{ ontime: 10 * HOUR, duration: 15 }],
      }).figures,
    ).toEqual([
      ['workmode', 'cooler'],
      ['usedaynight', 1],
      ['daynight.day', 5 * HOUR],
      ['cooler.night.off', 21.5],
      ['timer.timeframes', [{ ontime: 10 * HOUR, duration: 15 }]],
    ]);
  });

  it('refuses a mode it has not got, a point out of range, and a timer the firmware could not hold', () => {
    const windows = Array.from({ length: 9 }, (_, index) => ({ ontime: index * HOUR, duration: 10 }));

    expect(refusal('plug', { plugMode: 'light', heaterDayOn: 60, co2Every: 0, timerWindows: windows })?.errors.map(error => error.field)).toEqual([
      'set.plugMode',
      'set.heaterDayOn',
      'set.co2Every',
      'set.timerWindows',
    ]);
    expect(refusal('plug', { timerWindows: [{ ontime: 0, duration: 0 }] })?.errors).toEqual([expect.objectContaining({ field: 'set.timerWindows' })]);
    // Another type's names are not a plug's.
    expect(refusal('plug', { fanMode: 'fixed' })?.errors).toEqual([expect.objectContaining({ code: 'unknown_field' })]);
  });

  it('writes what was changed and keeps every key it was not asked about, the fan it slows among them', async () => {
    const coupled = JSON.stringify({ device_id: FAN, speed: 30 });
    await make(PLUG, 'plug', plugDocument({ fan: coupled, mqttcontrol: false }));

    await configuration.configure(PLUG, { plugMode: 'timer', timerWindows: [{ ontime: 8 * HOUR, duration: 30 }], overheatOff: true }, OWNER);

    const after = (await stored(PLUG)).configuration!;
    expect(after).toMatchObject({
      workmode: 'timer',
      timer: { timeframes: [{ ontime: 8 * HOUR, duration: 30 }] },
      limits: { overtemperature: { enabled: 1, limit: 30, hysteresis: 1 } },
      heater: { day: { on: 22, off: 25 } },
      fan: coupled,
      mqttcontrol: false,
    });
    expect(published.find(one => one.topic.includes(PLUG))?.message).toEqual(after);
  });
});

describe('an AIR fan and a LIGHT', () => {
  it('keeps a fan’s mode as the number its firmware reads, and its speeds where they are', () => {
    expect(fieldChangesOf('fan', { fanMode: 'humidity', mostNight: 50, least: 20 }).figures).toEqual([
      ['mode', 2],
      ['night.max_speed', 50],
      ['min_speed', 20],
    ]);
    expect(refusal('fan', { fanMode: 'auto' })?.errors).toEqual([expect.objectContaining({ field: 'set.fanMode', code: 'out_of_range' })]);
  });

  it('keeps a lamp’s times, brightness, ramps and protection at the top of its document', () => {
    expect(fieldChangesOf('light', { lightsOn: 7 * HOUR, lightsOff: 19 * HOUR, brightness: 80, sunrise: 30, overheatAt: 32 }).figures).toEqual([
      ['day', 7 * HOUR],
      ['night', 19 * HOUR],
      ['limit', 80],
      ['sunrise', 30],
      ['max_temperature', 32],
    ]);
  });
});

describe('the fan a socket slows while it doses CO2', () => {
  const periodic = (over: Record<string, unknown> = {}) =>
    plugDocument({ workmode: 'co2', usedaynight: true, co2: { mode: 'periodic', period: 60, duration: 10, on: 600, off: 1000 }, ...over });

  it('gives the fan the socket’s windows and day, and names the fan in the socket', async () => {
    await make(PLUG, 'plug', periodic());
    await make(FAN, 'fan', fanDocument());

    await configuration.coupleCo2Fan(PLUG, { fanId: FAN, speed: 30 });

    expect(JSON.parse((await stored(PLUG)).configuration!.fan as string)).toEqual({ device_id: FAN, speed: 30 });
    expect((await stored(FAN)).configuration!.co2inject).toEqual({
      device_id: PLUG,
      speed: 30,
      usedaynight: 1,
      day: 6 * HOUR,
      night: 22 * HOUR,
      period: 60,
      duration: 10,
    });
    // The fan's own settings are kept, and the fan is sent its document.
    expect((await stored(FAN)).configuration).toMatchObject({ mode: 0, min_speed: 30 });
    expect(published.some(one => one.topic.includes(FAN))).toBe(true);
  });

  it('keeps the fan in step when the socket’s windows change, and tells it to stop while the socket does not dose in windows', async () => {
    await make(PLUG, 'plug', periodic({ fan: JSON.stringify({ device_id: FAN, speed: 40 }) }));
    await make(FAN, 'fan', fanDocument());

    await configuration.configure(PLUG, { co2Every: 30, co2For: 5 }, OWNER);
    expect((await stored(FAN)).configuration!.co2inject).toMatchObject({ device_id: PLUG, speed: 40, period: 30, duration: 5 });

    await configuration.configure(PLUG, { co2Dosing: 'const' }, OWNER);
    expect((await stored(FAN)).configuration!.co2inject).toEqual({});
  });

  it('lets the old fan go when another is chosen or none, and refuses what is not a socket and a fan', async () => {
    await make(PLUG, 'plug', periodic());
    await make(FAN, 'fan', fanDocument());
    await make(OTHER_FAN, 'fan', fanDocument());
    await make('sim-light-1', 'light', { day: 0, night: 0 });

    await configuration.coupleCo2Fan(PLUG, { fanId: FAN, speed: 30 });
    await configuration.coupleCo2Fan(PLUG, { fanId: OTHER_FAN, speed: 50 });
    expect((await stored(FAN)).configuration!.co2inject).toEqual({});
    expect((await stored(OTHER_FAN)).configuration!.co2inject).toMatchObject({ device_id: PLUG, speed: 50 });

    await configuration.coupleCo2Fan(PLUG, null);
    expect((await stored(OTHER_FAN)).configuration!.co2inject).toEqual({});
    expect(JSON.parse((await stored(PLUG)).configuration!.fan as string)).toMatchObject({ device_id: 'none' });

    await expect(configuration.coupleCo2Fan(PLUG, { fanId: 'sim-light-1', speed: 30 })).rejects.toMatchObject({ problem: { code: 'not_a_fan' } });
    await expect(configuration.coupleCo2Fan(FAN, { fanId: OTHER_FAN, speed: 30 })).rejects.toMatchObject({ problem: { code: 'not_a_plug' } });
  });

  it('does not fail the socket’s own write over a fan that is gone', async () => {
    await make(PLUG, 'plug', periodic({ fan: JSON.stringify({ device_id: 'sim-fan-gone', speed: 30 }) }));

    await expect(configuration.configure(PLUG, { co2Every: 45 }, OWNER)).resolves.toBe(true);
    expect((await stored(PLUG)).configuration).toMatchObject({ co2: { period: 45 } });
  });

  it('passes the day the socket was given on its own menu on to the fan, so the fan is not slowed through the night', async () => {
    const coupled = periodic({ usedaynight: false, fan: JSON.stringify({ device_id: FAN, speed: 4 }) });
    const roundTheClock = { device_id: PLUG, speed: 4, usedaynight: 0, day: 6 * HOUR, night: 22 * HOUR, period: 60, duration: 10 };
    await make(PLUG, 'plug', coupled);
    await make(FAN, 'fan', fanDocument({ co2inject: roundTheClock }));

    const fromItsMenu = { ...coupled, usedaynight: true, daynight: { day: 20 * HOUR, night: 14 * HOUR } };
    await ingest.handle(`/devices/${PLUG}/configuration`, JSON.stringify(fromItsMenu));

    expect((await stored(FAN)).configuration!.co2inject).toEqual({
      device_id: PLUG,
      speed: 4,
      usedaynight: 1,
      day: 20 * HOUR,
      night: 14 * HOUR,
      period: 60,
      duration: 10,
    });
    expect(published.some(one => one.topic.includes(FAN) && (one.message.co2inject as { night?: number })?.night === 14 * HOUR)).toBe(true);
  });

  it('keeps the socket’s windows in a fan that sends its own document from its menu', async () => {
    const co2inject = { device_id: PLUG, speed: 4, usedaynight: 1, day: 20 * HOUR, night: 14 * HOUR, period: 60, duration: 10 };
    await make(PLUG, 'plug', periodic({ fan: JSON.stringify({ device_id: FAN, speed: 4 }) }));
    await make(FAN, 'fan', fanDocument({ co2inject }));

    await ingest.handle(`/devices/${FAN}/configuration`, JSON.stringify(fanDocument({ min_speed: 20 })));

    expect((await stored(FAN)).configuration).toMatchObject({ min_speed: 20, co2inject });
    expect(published.some(one => one.topic.includes(FAN) && JSON.stringify(one.message.co2inject) === JSON.stringify(co2inject))).toBe(true);
  });
});
