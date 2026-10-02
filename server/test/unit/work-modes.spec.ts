import { jest } from '@jest/globals';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { ProblemException } from '@common/v1/problem';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { heldTo, stepSettingsHeld } from '@modules/device-protocol/class-rules';
import { fieldChangesOf } from '@modules/device-protocol/configuration-fields';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DeviceIngestService } from '@modules/device-protocol/device-ingest.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { controlOf, decideWorkmode } from '@modules/device-protocol/work-modes';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * What the server decides about a fridge's and a controller's document on
 * every write: the work mode - whether it regulates, which mode, energy saving,
 * drying - and the figures a fridge is held to whoever wrote them. Every way a
 * document is written passes here: the targets saved by hand, a preset or a
 * phase, a plan step and its hourly re-send, a setting changed by name, and the
 * device's own upload.
 */

const DEVICE = 'sim-fridge-1';
const OWNER = 'user-1';

let db: V1TestDatabase;
let published: Record<string, unknown>[];
let configuration: DeviceConfigurationService;
let ingest: DeviceIngestService;

const fridgeDocument = (over: Record<string, unknown> = {}) => ({
  workmode: 'small',
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 20, humidity: 55 },
  daynight: { day: 21600, night: 64800, maxDehumidifySeconds: 2700, targetHumidityDiff: 5, useLongHumidityAvg: 0, linearChange: 1 },
  co2: { target: 900, sunsetOff: 1 },
  lights: { limit: 80 },
  ...over,
});

const device = (fields: Partial<StoredDevice> = {}) =>
  db.devices.create({ id: DEVICE, type: 'fridge', ownerId: OWNER, configuration: fridgeDocument(), ...fields });

const stored = async () => (await db.devices.findOne({ id: DEVICE }).lean<StoredDevice>())!;

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
    publish: jest.fn((_topic: string, message: string) => {
      published.push(JSON.parse(message));
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
  );
});

describe('the work mode a write leaves', () => {
  it('switches a device that is off back on with the targets, onto the mode it last ran, and leaves a drying one drying', () => {
    expect(decideWorkmode('fridge', 'off', 'full', { kind: 'targets' })).toEqual({ workmode: 'full', base: 'full' });
    expect(decideWorkmode('fridge', 'off', null, { kind: 'targets' })).toEqual({ workmode: 'small', base: 'small' });
    expect(decideWorkmode('fridge', 'dry', 'full', { kind: 'targets' })).toEqual({ workmode: 'dry', base: 'full' });
    // The firmware reads a word it does not know as off.
    expect(decideWorkmode('fridge', 'exp', null, { kind: 'targets' })).toEqual({ workmode: 'small', base: 'small' });
  });

  it('dries for targets saved as a drying room, and ends a drying spell for targets saved as anything else', () => {
    expect(decideWorkmode('fridge', 'full', null, { kind: 'targets', drying: true })).toEqual({ workmode: 'dry', base: 'full' });
    expect(decideWorkmode('fridge', 'off', 'small', { kind: 'targets', drying: true })).toEqual({ workmode: 'dry', base: 'small' });
    expect(decideWorkmode('fridge', 'dry', 'full', { kind: 'targets', drying: false })).toEqual({ workmode: 'full', base: 'full' });
    expect(decideWorkmode('controller', 'dry', 'breed', { kind: 'targets', drying: false })).toEqual({ workmode: 'breed', base: 'breed' });
  });

  it('dries for a drying stage, and ends a drying spell or an off for any other', () => {
    expect(decideWorkmode('fridge', 'full', null, { kind: 'climate', stage: 'drying' })).toEqual({ workmode: 'dry', base: 'full' });
    expect(decideWorkmode('fridge', 'dry', 'full', { kind: 'climate', stage: 'vegetative' })).toEqual({ workmode: 'full', base: 'full' });
    expect(decideWorkmode('fridge', 'off', 'temp', { kind: 'climate', stage: null })).toEqual({ workmode: 'temp', base: 'temp' });
  });

  it('ignores the small and full an old plan step carries, and keeps what else a step asks for', () => {
    expect(decideWorkmode('fridge', 'full', null, { kind: 'climate', stage: null, requested: 'small' })).toEqual({ workmode: 'full', base: 'full' });
    expect(decideWorkmode('fridge', 'full', null, { kind: 'climate', stage: null, requested: 'off' })).toEqual({ workmode: 'off', base: 'full' });
    expect(decideWorkmode('fridge', 'small', null, { kind: 'climate', stage: null, requested: 'breed' })).toEqual({
      workmode: 'breed',
      base: 'breed',
    });
  });

  it('turns the three switches a person has into one work mode, and remembers it while the device is off or drying', () => {
    expect(decideWorkmode('fridge', 'small', null, { kind: 'fields', energySaving: true })).toEqual({ workmode: 'full', base: 'full' });
    expect(decideWorkmode('fridge', 'off', 'small', { kind: 'fields', energySaving: true })).toEqual({ workmode: 'off', base: 'full' });
    expect(decideWorkmode('fridge', 'dry', 'small', { kind: 'fields', energySaving: true })).toEqual({ workmode: 'dry', base: 'full' });
    expect(decideWorkmode('fridge', 'full', null, { kind: 'fields', mode: 'greenhouse' })).toEqual({ workmode: 'temp', base: 'temp' });
    expect(decideWorkmode('fridge', 'temp', 'temp', { kind: 'fields', mode: 'standard' })).toEqual({ workmode: 'small', base: 'small' });
    // Back from another mode, the energy-saving switch stands where the standard mode last had it.
    expect(decideWorkmode('fridge', 'breed', 'breed', { kind: 'fields', mode: 'standard' }, 'full')).toEqual({ workmode: 'full', base: 'full' });
    expect(decideWorkmode('fridge', 'temp', 'temp', { kind: 'fields', mode: 'standard' }, 'small')).toEqual({ workmode: 'small', base: 'small' });
    expect(decideWorkmode('fridge', 'full', null, { kind: 'fields', control: false })).toEqual({ workmode: 'off', base: 'full' });
    expect(decideWorkmode('fridge', 'off', 'breed', { kind: 'fields', control: true })).toEqual({ workmode: 'breed', base: 'breed' });
    expect(decideWorkmode('fridge', 'dry', 'full', { kind: 'fields', drying: false })).toEqual({ workmode: 'full', base: 'full' });
    expect(decideWorkmode('fridge', 'off', 'temp', { kind: 'fields', drying: true })).toEqual({ workmode: 'dry', base: 'temp' });
    expect(decideWorkmode('fridge', 'dry', 'small', { kind: 'fields', control: false })).toEqual({ workmode: 'off', base: 'small' });
    // A controller has no back-wall fan; its firmware reads `full` as `small`.
    expect(decideWorkmode('controller', 'small', null, { kind: 'fields', energySaving: true })).toEqual({ workmode: 'small', base: 'small' });
  });

  it('touches nothing that states no work mode', () => {
    expect(decideWorkmode('light', 'small', null, { kind: 'targets' })).toBeNull();
    expect(decideWorkmode('fridge', undefined, null, { kind: 'targets' })).toBeNull();
  });

  it('reads how a device stands in the words the screens use', () => {
    expect(controlOf('fridge', { workmode: 'full' }, null)).toEqual({ running: true, drying: false, mode: 'standard', energySaving: true });
    expect(controlOf('fridge', { workmode: 'off' }, 'temp')).toEqual({ running: false, drying: false, mode: 'greenhouse', energySaving: false });
    expect(controlOf('fridge', { workmode: 'dry' }, 'full')).toEqual({ running: true, drying: true, mode: 'standard', energySaving: true });
    expect(controlOf('controller', { workmode: 'breed' }, null)).toEqual({ running: true, drying: false, mode: 'germination', energySaving: false });
    expect(controlOf('plug', { workmode: 'small' }, null)).toBeNull();
    expect(controlOf('fridge', null, null)).toBeNull();
  });
});

describe('what a fridge document is held to', () => {
  it('tunes the dehumidifier from the day humidity: short runs from the target below 55 %, long ones with a band above', () => {
    expect(heldTo('fridge', fridgeDocument({ day: { temperature: 25, humidity: 54 } })).daynight).toMatchObject({
      maxDehumidifySeconds: 900,
      targetHumidityDiff: 0,
      useLongHumidityAvg: 1,
    });
    expect(heldTo('fridge', fridgeDocument({ day: { temperature: 25, humidity: 55 } })).daynight).toMatchObject({
      maxDehumidifySeconds: 2700,
      targetHumidityDiff: 5,
      useLongHumidityAvg: 0,
    });
  });

  it('always glides from night to day, never doses CO2 at sunset, and rests the compressor at least four minutes', () => {
    const held = heldTo(
      'fridge',
      fridgeDocument({ daynight: { day: 0, night: 0, linearChange: 0, minimalDehumidifierOffTime: 60 }, co2: { target: 900, sunsetOff: 0 } }),
    );
    expect(held.daynight).toMatchObject({ linearChange: 1, minimalDehumidifierOffTime: 240 });
    expect(held.co2).toEqual({ target: 900, sunsetOff: 1 });
    expect(heldTo('fridge', fridgeDocument({ daynight: { minimalDehumidifierOffTime: 600 } })).daynight).toMatchObject({
      minimalDehumidifierOffTime: 600,
    });
  });

  it('leaves a controller and a document without those sections as they are', () => {
    const tent = fridgeDocument({ day: { temperature: 25, humidity: 40 }, co2: { target: 900, sunsetOff: 0 } });
    expect(heldTo('controller', tent)).toBe(tent);
    expect(heldTo('fridge', { workmode: 'small' })).toEqual({ workmode: 'small' });
  });

  it('clears a plan step of the work mode and the figures the server writes itself', () => {
    expect(stepSettingsHeld(fridgeDocument(), true)).toEqual({
      day: { temperature: 25, humidity: 60 },
      night: { temperature: 20, humidity: 55 },
      daynight: { day: 21600, night: 64800 },
      co2: { target: 900 },
      lights: { limit: 80 },
    });
    expect(stepSettingsHeld({ workmode: 'dry', co2: { sunsetOff: 1 } }, true)).toEqual({ workmode: 'dry' });
    expect(stepSettingsHeld({ workmode: 'full', co2: { sunsetOff: 1 } }, false)).toEqual({ co2: { sunsetOff: 1 } });
  });
});

describe('a setting changed by name', () => {
  const refusal = (type: string, set: Record<string, number | boolean | string>) => {
    try {
      fieldChangesOf(type, set);
      return null;
    } catch (error) {
      return (error as ProblemException).problem;
    }
  };

  it('is checked against what the type offers, and every field that does not fit is named at once', () => {
    expect(refusal('fridge', { energySaving: 'yes', compressorRest: 120, fanSpeed: 3 })).toMatchObject({
      status: 422,
      code: 'setting_refused',
      errors: [
        { field: 'set.energySaving', code: 'out_of_range' },
        { field: 'set.compressorRest', code: 'out_of_range' },
        { field: 'set.fanSpeed', code: 'unknown_field' },
      ],
    });
    expect(refusal('controller', { energySaving: true })?.errors).toEqual([
      expect.objectContaining({ field: 'set.energySaving', code: 'unknown_field' }),
    ]);
    expect(refusal('fridge', {})?.errors).toEqual([expect.objectContaining({ code: 'required' })]);
  });

  it('writes a figure at its place and keeps every key it was not asked about', async () => {
    await device({ configuration: fridgeDocument({ daynight: { day: 21600, night: 64800, minimalDehumidifierOffTime: 240, foreign: 'kept' } }) });

    await configuration.configure(DEVICE, { compressorRest: 600 }, OWNER);

    const after = await stored();
    expect(after.configuration?.daynight).toMatchObject({ day: 21600, minimalDehumidifierOffTime: 600, foreign: 'kept' });
    expect(published.at(-1)).toEqual(after.configuration);
  });

  it('switches energy saving on as the work mode, says so in the diary, and keeps it while control is off', async () => {
    await device();

    await configuration.configure(DEVICE, { energySaving: true }, OWNER);
    expect((await stored()).configuration?.workmode).toBe('full');

    await configuration.configure(DEVICE, { control: false }, OWNER);
    expect((await stored()).configuration?.workmode).toBe('off');
    expect((await stored()).baseWorkmode).toBe('full');

    await configuration.configure(DEVICE, { control: true }, OWNER);
    expect((await stored()).configuration?.workmode).toBe('full');

    const lines = (await db.entries.find({}).sort({ _id: 1 }).lean()).map(entry => entry.message);
    expect(lines).toEqual([
      { key: 'message-device-configuration-updated', params: ['workmode: small → full'] },
      { key: 'message-device-configuration-updated', params: ['workmode: full → off'] },
      { key: 'message-device-configuration-updated', params: ['workmode: off → full'] },
    ]);
  });

  it('keeps the energy-saving switch through a spell in another operating mode', async () => {
    await device();

    await configuration.configure(DEVICE, { energySaving: true }, OWNER);
    await configuration.configure(DEVICE, { mode: 'greenhouse' }, OWNER);
    await configuration.configure(DEVICE, { mode: 'germination' }, OWNER);
    expect((await stored()).configuration?.workmode).toBe('breed');

    await configuration.configure(DEVICE, { mode: 'standard' }, OWNER);
    expect((await stored()).configuration?.workmode).toBe('full');
  });

  it('refuses a device that has never sent its document', async () => {
    await device({ configuration: null });

    await expect(configuration.configure(DEVICE, { control: true }, OWNER)).rejects.toMatchObject({ problem: { code: 'device_sent_no_settings' } });
    expect(published).toEqual([]);
  });
});

describe('every other way a document is written', () => {
  it('switches an off fridge on with the targets, believes the stored mode over the page’s, and tunes from the new humidity', async () => {
    await device({ configuration: fridgeDocument({ workmode: 'off' }), baseWorkmode: 'full' });

    // The page was drawn while the device still ran `small`.
    await configuration.replace(DEVICE, fridgeDocument({ workmode: 'small', day: { temperature: 25, humidity: 50 } }), OWNER);

    const after = (await stored()).configuration!;
    expect(after.workmode).toBe('full');
    expect(after.daynight).toMatchObject({ maxDehumidifySeconds: 900, targetHumidityDiff: 0, useLongHumidityAvg: 1 });
    // What the person moved is written down; what the server tuned from it is not.
    expect((await db.entries.findOne({}).lean())?.message?.params).toEqual(['day.humidity: 60 → 50\nworkmode: off → full']);
  });

  it('dries for a drying preset or step, and goes back to the remembered mode for the next', async () => {
    await device({ configuration: fridgeDocument({ workmode: 'full' }) });

    await configuration.applyConfiguration(DEVICE, { day: { temperature: 18, humidity: 58 } }, 'drying');
    expect((await stored()).configuration?.workmode).toBe('dry');

    await configuration.applyConfiguration(DEVICE, { day: { temperature: 25, humidity: 60 } }, 'vegetative');
    expect((await stored()).configuration?.workmode).toBe('full');
  });

  /**
   * "Trocknung beenden" put the work mode back and left the drying room's
   * figures standing: the fridge went on regulating its day and night at 18 °C
   * and 58 %, with the lamp at 0 % and CO2 at 400.
   */
  it('brings back the targets a drying spell put aside when the spell is ended by itself', async () => {
    await device();
    const drying = { day: { temperature: 18, humidity: 58 }, night: { temperature: 18, humidity: 58 }, co2: { target: 400 }, lights: { limit: 0 } };

    await configuration.replace(DEVICE, fridgeDocument(drying), OWNER, true);
    const dried = await stored();
    expect(dried.configuration?.workmode).toBe('dry');
    expect(controlOf('fridge', dried.configuration, dried.baseWorkmode, dried.beforeDrying)?.afterDrying).toEqual({
      dayTemperature: 25,
      dayHumidity: 60,
      nightTemperature: 20,
      nightHumidity: 55,
      co2: 900,
      lightLimit: 80,
    });

    await configuration.configure(DEVICE, { drying: false }, OWNER);

    const after = await stored();
    expect(after.configuration).toMatchObject({
      workmode: 'small',
      day: { temperature: 25, humidity: 60 },
      night: { temperature: 20, humidity: 55 },
      co2: { target: 900 },
      lights: { limit: 80 },
    });
    // Tuned from the day humidity it came back to, as every write is.
    expect(after.configuration?.daynight).toMatchObject({ maxDehumidifySeconds: 2700, targetHumidityDiff: 5 });
    expect(after.beforeDrying).toBeNull();
    expect(controlOf('fridge', after.configuration, after.baseWorkmode, after.beforeDrying)?.afterDrying).toBeUndefined();
  });

  it('brings them back where control is switched off during a spell, and leaves a preset´s own figures where a preset ends it', async () => {
    await device();
    await configuration.applyConfiguration(DEVICE, { day: { temperature: 18, humidity: 58 }, lights: { limit: 0 } }, 'drying');

    await configuration.configure(DEVICE, { control: false }, OWNER);
    expect((await stored()).configuration).toMatchObject({ workmode: 'off', day: { temperature: 25, humidity: 60 }, lights: { limit: 80 } });

    await configuration.applyConfiguration(DEVICE, { day: { temperature: 18, humidity: 58 }, lights: { limit: 0 } }, 'drying');
    await configuration.replace(DEVICE, fridgeDocument({ day: { temperature: 24, humidity: 70 }, lights: { limit: 40 } }), OWNER, false);
    expect((await stored()).configuration).toMatchObject({ workmode: 'small', day: { temperature: 24, humidity: 70 }, lights: { limit: 40 } });
    expect((await stored()).beforeDrying).toBeNull();
  });

  it('brings back what the record holds from before a spell nothing was kept for, and lights a lamp it left dark', async () => {
    const drying = { day: { temperature: 18, humidity: 58 }, night: { temperature: 18, humidity: 58 }, co2: { target: 400 }, lights: { limit: 0 } };
    await device({ configuration: fridgeDocument({ ...drying, workmode: 'dry' }), baseWorkmode: 'small' });
    const row = (at: string, day: number, humidity: number, co2: number) => ({
      id: `row-${at}`,
      deviceId: DEVICE,
      at: new Date(at),
      targets: { day: { temperature: day, humidity }, night: { temperature: day - 4, humidity: humidity - 5 }, co2 },
    });
    await db.targetChanges.create([row('2026-09-01T10:00:00Z', 26, 62, 900), row('2026-09-20T10:00:00Z', 18, 58, 400)]);
    await db.targetChanges.updateOne({ id: 'row-2026-09-20T10:00:00Z' }, { $set: { 'targets.night': { temperature: 18, humidity: 58 } } });

    await configuration.configure(DEVICE, { drying: false }, OWNER);

    expect((await stored()).configuration).toMatchObject({
      workmode: 'small',
      day: { temperature: 26, humidity: 62 },
      night: { temperature: 22, humidity: 57 },
      co2: { target: 900 },
      lights: { limit: 100 },
    });
  });

  it('dries for a drying step that carries no figures at all', async () => {
    await device();

    await configuration.applyConfiguration(DEVICE, {}, 'drying');
    expect((await stored()).configuration?.workmode).toBe('dry');
    // Without a stage, an empty step is still no write.
    published = [];
    await configuration.applyConfiguration(DEVICE, {}, null);
    expect(published).toEqual([]);
  });

  it('keeps the energy-saving switch through the hourly re-send of an old step that still says small', async () => {
    await device({ configuration: fridgeDocument({ workmode: 'full' }) });

    await configuration.applyConfiguration(DEVICE, { workmode: 'small', daynight: { maxDehumidifySeconds: 100, linearChange: 0 } }, null);

    const after = (await stored()).configuration!;
    expect(after.workmode).toBe('full');
    expect(after.daynight).toMatchObject({ maxDehumidifySeconds: 2700, linearChange: 1 });
  });

  it('holds what the device uploads, sends the held document back once, and remembers the mode it runs', async () => {
    await device({ baseWorkmode: 'small' });
    const uploaded = fridgeDocument({ workmode: 'full', daynight: { day: 21600, night: 64800, maxDehumidifySeconds: 100, linearChange: 0 } });

    await ingest.handle(`/devices/${DEVICE}/configuration`, JSON.stringify(uploaded));

    const after = await stored();
    expect(after.baseWorkmode).toBe('full');
    expect(after.configuration?.daynight).toMatchObject({ maxDehumidifySeconds: 2700, targetHumidityDiff: 5, linearChange: 1 });
    expect(published).toEqual([after.configuration]);

    // The echo of that send is held already, and goes no further.
    await ingest.handle(`/devices/${DEVICE}/configuration`, JSON.stringify(published[0]));
    expect(published).toHaveLength(1);

    // Switched off at the device: the mode it goes back to stays the one it ran.
    await ingest.handle(`/devices/${DEVICE}/configuration`, JSON.stringify({ ...published[0], workmode: 'off' }));
    expect((await stored()).baseWorkmode).toBe('full');
  });
});
