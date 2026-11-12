import type { DeviceLive } from '@fg2/shared-types/v1';
import { AccessService } from '@common/v1/access.service';
import { metricValueOf } from '@common/v1/value-age';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DataService } from '@modules/data/data.service';
import { changeLine, changeOf, figureOf, figureSaid, linesJoined, linesOf } from '@modules/device-protocol/change-lines';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { DevicesController } from '@modules/v1/device/devices.controller';
import type { RecordedClimate } from '@modules/v1/device/held-targets';
import { pendingSettingsOf } from '@modules/v1/device/pending-settings';
import { FleetService } from '@modules/v1/fleet/fleet.service';
import { deviceStackOn } from './support/device-stack';
import { accessOn, devicesOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';

/**
 * What a device that fell silent has not been handed: the settings stored
 * since it was last heard that differ from what it held then. The device says
 * nothing about it, so the answer is read from the target record and from the
 * diary lines of the saves people made.
 */

const at = (clock: string): number => Date.parse(`2026-11-12T${clock}:00.000Z`);
const iso = (clock: string): string => new Date(at(clock)).toISOString();

const HEARD = at('07:42');

describe('the lines of a save, written and read back', () => {
  it('reads back the place and both figures of every kind of value a document holds', () => {
    const values = [24, 24.5, 0, 'small', '', null, undefined, true, [{ start: 3600, minutes: 15 }], { device_id: 'none', speed: 100 }];

    for (const before of values) {
      for (const after of values) {
        expect(changeOf(changeLine('limits.time.min_on', before, after))).toEqual({
          path: 'limits.time.min_on',
          before: figureOf(before),
          after: figureOf(after),
        });
      }
    }
  });

  it('gives a figure back as the value it was: a number, nothing, or its words', () => {
    for (const value of [24, 24.5, 0, -3, 'small', 'heater', null]) expect(figureSaid(figureOf(value))).toBe(value);
    expect(figureSaid(figureOf(undefined))).toBeNull();
    expect(figureSaid(figureOf(true))).toBe('true');
    expect(figureSaid(figureOf([1, 2]))).toBe('[1,2]');
  });

  it('takes the lines of an entry apart as they were put together', () => {
    const lines = [changeLine('day.temperature', 24, 25), changeLine('workmode', 'small', 'dry'), '… 3 more'];

    expect(linesOf(linesJoined(lines))).toEqual(lines);
    expect(linesOf(undefined)).toEqual([]);
  });

  it('reads no change out of the count that ends a long entry, or out of a line from before this format', () => {
    expect(changeOf('… 3 more')).toBeNull();
    expect(changeOf('day.temperature 26 -> 27')).toBeNull();
  });
});

const TARGETS = { day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 55 }, co2: 900 };
const CYCLE = { day: 21600, night: 64800, workmode: 'small', sunrise: 15, sunset: 15, glides: false };

const DOCUMENT = {
  workmode: 'small',
  daynight: { day: 21600, night: 64800 },
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 21, humidity: 55 },
  co2: { target: 900 },
  lights: { sunrise: 15, sunset: 15, limit: 100 },
};

/** The document with figures set by their dotted place. */
const documentWith = (figures: Record<string, unknown>, document: Record<string, unknown> = DOCUMENT): Record<string, unknown> =>
  Object.entries(figures).reduce<Record<string, unknown>>((all, [path, value]) => {
    const [section, key] = path.split('.');
    return key === undefined ? { ...all, [section]: value } : { ...all, [section]: { ...(all[section] as object), [key]: value } };
  }, document);

const row = (clock: string, over: Partial<Omit<RecordedClimate, 'at'>> = {}): RecordedClimate => ({
  at: at(clock),
  targets: TARGETS,
  cycle: CYCLE,
  ...over,
});
const dayAt = (temperature: number) => ({ targets: { ...TARGETS, day: { ...TARGETS.day, temperature } } });
const save = (clock: string, ...lines: string[]) => ({ at: at(clock), lines });

const controller = (figures: Record<string, unknown> = {}) => ({ type: 'controller', configuration: documentWith(figures) });

describe('what a silent device has not been handed', () => {
  it('names a target stored since it was last heard, with what stood then and when it was stored', () => {
    const record = [row('06:00'), row('09:31', dayAt(24))];

    expect(pendingSettingsOf(HEARD, controller({ 'day.temperature': 24 }), record, [])).toEqual([
      { field: 'day.temperature', held: 25, savedAt: iso('09:31') },
    ]);
  });

  it('holds everything stored before it was last heard', () => {
    expect(pendingSettingsOf(HEARD, controller({ 'day.temperature': 24 }), [row('06:00'), row('07:30', dayAt(24))], [])).toEqual([]);
  });

  it('leaves out a setting changed and changed back, and dates one moved twice by its last move', () => {
    const there = [row('06:00'), row('09:00', dayAt(24)), row('10:00', dayAt(23))];

    expect(pendingSettingsOf(HEARD, controller(), [...there, row('11:00')], [])).toEqual([]);
    expect(pendingSettingsOf(HEARD, controller({ 'day.temperature': 23 }), there, [])).toEqual([
      { field: 'day.temperature', held: 25, savedAt: iso('10:00') },
    ]);
  });

  it('reads the light window, the ramps and the work mode off the record, whoever moved them', () => {
    const drying = { cycle: { ...CYCLE, day: 25200, sunset: 30, workmode: 'dry' } };
    const device = controller({ 'daynight.day': 25200, 'lights.sunset': 30, workmode: 'dry' });

    // No diary line: a plan step or a preset writes none.
    expect(pendingSettingsOf(HEARD, device, [row('06:00'), row('12:00', drying)], [])).toEqual([
      { field: 'daynight.day', held: 21600, savedAt: iso('12:00') },
      { field: 'lights.sunset', held: 15, savedAt: iso('12:00') },
      { field: 'workmode', held: 'small', savedAt: iso('12:00') },
    ]);
  });

  it('says a target the document stated none of was not stated', () => {
    const device = controller();

    expect(pendingSettingsOf(HEARD, device, [row('06:00', { targets: null }), row('09:00')], [])).toEqual(
      ['co2.target', 'day.humidity', 'day.temperature', 'night.humidity', 'night.temperature'].map(field => ({
        field,
        held: null,
        savedAt: iso('09:00'),
      })),
    );
  });

  it('reads every other figure off the diary lines of the saves since: the first says what it was, the last when', () => {
    const saves = [
      save('09:00', changeLine('lights.limit', 100, 60)),
      save('10:00', changeLine('lights.limit', 60, 80), changeLine('fans.external', 40, 0)),
    ];

    expect(pendingSettingsOf(HEARD, controller({ 'lights.limit': 80, 'fans.external': 0 }), [row('06:00')], saves)).toEqual([
      { field: 'fans.external', held: 40, savedAt: iso('10:00') },
      { field: 'lights.limit', held: 100, savedAt: iso('10:00') },
    ]);
    // Back where it was: nothing to take.
    expect(pendingSettingsOf(HEARD, controller({ 'fans.external': 40 }), [row('06:00')], saves)).toEqual([]);
    // A save from before it was last heard reached it.
    expect(
      pendingSettingsOf(HEARD, controller({ 'lights.limit': 60 }), [row('06:00')], [save('07:00', changeLine('lights.limit', 100, 60))]),
    ).toEqual([]);
  });

  it('goes by the record where both speak, and by the diary where the record says nothing', () => {
    const saves = [
      save('09:00', changeLine('day.temperature', 26, 24), changeLine('daynight.day', 21600, 25200), changeLine('daynight.night', 64800, 64800)),
    ];
    const device = controller({ 'day.temperature': 24, 'daynight.day': 25200 });
    const moved = { ...dayAt(24), cycle: { ...CYCLE, day: 25200 } };

    expect(pendingSettingsOf(HEARD, device, [row('06:00'), row('09:00', moved)], saves)).toEqual([
      { field: 'day.temperature', held: 25, savedAt: iso('09:00') },
      { field: 'daynight.day', held: 21600, savedAt: iso('09:00') },
    ]);
    // A record that begins after it was last heard has no row standing then.
    expect(pendingSettingsOf(HEARD, device, [row('09:00', moved)], saves)).toEqual([
      { field: 'day.temperature', held: 26, savedAt: iso('09:00') },
      { field: 'daynight.day', held: 21600, savedAt: iso('09:00') },
    ]);
    // A row from before cycles were recorded says the targets and nothing of the light window.
    expect(pendingSettingsOf(HEARD, device, [row('06:00', { cycle: null }), row('09:00', moved)], saves)).toEqual([
      { field: 'day.temperature', held: 25, savedAt: iso('09:00') },
      { field: 'daynight.day', held: 21600, savedAt: iso('09:00') },
    ]);
  });

  it('takes the time of a light window written as itself for no change, and the choices of germination for nothing a device holds', () => {
    const light = { type: 'light', configuration: { day: 25200, night: 79200, limit: 80 } };
    const saves = [
      save('09:00', changeLine('day', 21600, 25200), changeLine('night', 64800, 64800)),
      save('09:05', changeLine('germination.warnTooHumid', false, true), '… 2 more'),
      save('10:00', changeLine('day', 25200, 25200), changeLine('night', 64800, 79200)),
    ];

    // Each time is dated by the save that moved it, not by the one that named it beside the other.
    expect(pendingSettingsOf(HEARD, light, [], saves)).toEqual([
      { field: 'day', held: 21600, savedAt: iso('09:00') },
      { field: 'night', held: 64800, savedAt: iso('10:00') },
    ]);
  });

  it('reads a switch as the firmware does: the true and false a document held are the 1 and 0 a write stores', () => {
    const plug = (usedaynight: unknown) => ({ type: 'plug', configuration: { workmode: 'heater', usedaynight } });
    const flipped = save('09:00', changeLine('usedaynight', false, 1));
    const back = save('09:05', changeLine('usedaynight', 1, 0));

    expect(pendingSettingsOf(HEARD, plug(1), [], [flipped])).toEqual([{ field: 'usedaynight', held: 'false', savedAt: iso('09:00') }]);
    // Flipped back, the document says 0 where it said false: the device holds that already.
    expect(pendingSettingsOf(HEARD, plug(0), [], [flipped, back])).toEqual([]);
    expect(pendingSettingsOf(HEARD, plug(false), [], [flipped, back])).toEqual([]);
    // A write that only spells the switch the other way moved nothing.
    expect(pendingSettingsOf(HEARD, plug(0), [], [save('09:00', changeLine('usedaynight', false, 0))])).toEqual([]);
    expect(pendingSettingsOf(HEARD, plug(true), [], [save('09:00', changeLine('usedaynight', 1, true))])).toEqual([]);
  });

  it('gives what was held as the line says it where it is no figure', () => {
    const plug = { type: 'plug', configuration: { workmode: 'co2', usedaynight: 0, timer: { timeframes: [] } } };
    const saves = [
      save(
        '09:00',
        changeLine('workmode', 'heater', 'co2'),
        changeLine('usedaynight', true, 0),
        changeLine('timer.timeframes', [{ start: 3600, minutes: 15 }], []),
        changeLine('co2.mode', undefined, 'const'),
      ),
    ];

    expect(pendingSettingsOf(HEARD, plug, [], saves)).toEqual([
      { field: 'timer.timeframes', held: '[{"start":3600,"minutes":15}]', savedAt: iso('09:00') },
      { field: 'usedaynight', held: 'true', savedAt: iso('09:00') },
      { field: 'workmode', held: 'heater', savedAt: iso('09:00') },
    ]);
  });
});

const DEVICE = 'sim-fridge-1';
const OWNER = 'user-1';
const MINUTE = 60 * 1000;

const db = useV1TestDatabase();
let configuration: DeviceConfigurationService;
let access: AccessService;
/** When the store says the device last wrote a sample; null where it holds none. */
let sampleAt: Date | null;

const FRIDGE = {
  ...DOCUMENT,
  daynight: {
    day: 21600,
    night: 64800,
    maxDehumidifySeconds: 2700,
    targetHumidityDiff: 5,
    useLongHumidityAvg: 0,
    linearChange: 1,
    minimalDehumidifierOffTime: 240,
  },
  co2: { target: 900, sunsetOff: 1 },
  fans: { internal: 60, external: 40 },
};

const data = {
  live: async () => ({
    metrics: sampleAt ? { temperature: metricValueOf(24, sampleAt) } : {},
    outputs: sampleAt ? { light: metricValueOf(100, sampleAt) } : {},
    isDay: null,
    lightOn: null,
  }),
} as unknown as DataService;

const live = (): Promise<DeviceLive> =>
  new DevicesController(
    devicesOn(db, access),
    null as unknown as FleetService,
    data,
    null as unknown as DevicePublisherService,
    configuration,
    access,
    db.entries,
    db.targetChanges,
  ).live(DEVICE);

/** A fridge last heard so many minutes ago, whose record stood since an hour before that. */
const heardAgo = async (minutes: number): Promise<Date> => {
  const heard = new Date(Date.now() - minutes * MINUTE);
  await db.devices.create({ id: DEVICE, type: 'fridge', ownerId: OWNER, configuration: FRIDGE, state: { lastSeenAt: heard } });
  await db.targetChanges.create({
    id: 'standing',
    deviceId: DEVICE,
    at: new Date(heard.getTime() - 60 * MINUTE),
    targets: TARGETS,
    cycle: { ...CYCLE, glides: true },
  });

  return heard;
};

const stored = async () => (await db.devices.findOne({ id: DEVICE }).lean<StoredDevice>())!.configuration as Record<string, unknown>;

describe('the live read of a device that fell silent', () => {
  beforeEach(async () => {
    await db.reset();
    ({ configuration } = deviceStackOn(db));
    access = accessOn(db);
    sampleAt = null;
  });

  it('says what was saved since it was last heard, from the record and from the diary, and nothing once it is put back', async () => {
    const heard = await heardAgo(30);

    await configuration.replace(DEVICE, documentWith({ 'day.temperature': 24 }, await stored()), OWNER);
    await configuration.configure(DEVICE, { clipFan: 0 }, OWNER);

    const { pending } = await live();
    expect(pending?.since).toBe(heard.toISOString());
    expect(pending?.settings).toEqual([
      { field: 'day.temperature', held: 25, savedAt: expect.any(String) },
      { field: 'fans.external', held: 40, savedAt: expect.any(String) },
    ]);
    for (const setting of pending!.settings) expect(Date.parse(setting.savedAt)).toBeGreaterThan(heard.getTime());

    await configuration.replace(DEVICE, documentWith({ 'day.temperature': 25 }, await stored()), OWNER);
    expect((await live()).pending?.settings).toEqual([{ field: 'fans.external', held: 40, savedAt: expect.any(String) }]);

    await configuration.configure(DEVICE, { clipFan: 40 }, OWNER);
    expect((await live()).pending).toBeNull();
  });

  it('says nothing of a device that is heard: it holds what is stored', async () => {
    await heardAgo(5);
    await configuration.replace(DEVICE, documentWith({ 'day.temperature': 24 }, await stored()), OWNER);

    expect((await live()).pending).toBeNull();
  });

  it('dates the device by a stored sample newer than its last message, as every screen does', async () => {
    await heardAgo(60);
    await configuration.replace(DEVICE, documentWith({ 'day.temperature': 24 }, await stored()), OWNER);

    // A sample from after the save: the device was there and has it.
    sampleAt = new Date(Date.now() + MINUTE);
    expect((await live()).pending).toBeNull();

    // Silent since a sample from before the save.
    sampleAt = new Date(Date.now() - 20 * MINUTE);
    expect((await live()).pending).toEqual({
      since: sampleAt.toISOString(),
      settings: [{ field: 'day.temperature', held: 25, savedAt: expect.any(String) }],
    });
  });

  it('answers null for a device nothing was saved for, and for one never heard', async () => {
    await heardAgo(30);
    expect((await live()).pending).toBeNull();

    await db.devices.updateOne({ id: DEVICE }, { $set: { 'state.lastSeenAt': null } });
    await configuration.replace(DEVICE, documentWith({ 'day.temperature': 24 }, await stored()), OWNER);
    expect((await live()).pending).toBeNull();
  });
});
