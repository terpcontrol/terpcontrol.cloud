import { jest } from '@jest/globals';
import { DateTime } from 'luxon';
import { DeviceConfiguration } from '@fg2/shared-types/v1';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { ScheduleClock, StoredDevice } from '@database/schemas/v1/devices.schema';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DeviceIngestService } from '@modules/device-protocol/device-ingest.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { clockTimesOf, keepsTime, sameClockTimes, scheduleClockOf, withClockTimesMoved } from '@modules/device-protocol/schedule-clock';
import { ScheduleClockService } from '@modules/device-protocol/schedule-clock.service';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { PlanService } from '@modules/v1/plan/plan.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The light comes on at the hour on the owner's wall clock, summer or winter.
 *
 * The firmware keeps its times of day as seconds past midnight UTC and will
 * not learn about zones, so the cloud moves those seconds when the owner's
 * offset moves and sends the document again. What is asserted is the hour a
 * grower in Berlin reads off their wall: 08:00 before the clocks go back, and
 * 08:00 after - which in the document is 06:00 and then 07:00.
 */

const DEVICE = 'sim-controller-1';
const OWNER = 'user-1';
const HOUR = 60 * 60;
const BERLIN = 'Europe/Berlin';

/** The night summer time ends in Berlin: 03:00 CEST becomes 02:00 CET at 01:00 UTC. */
const BEFORE_AUTUMN = new Date('2026-10-25T00:59:00Z');
const AFTER_AUTUMN = new Date('2026-10-25T01:00:30Z');
/** And the night it begins again: 02:00 CET becomes 03:00 CEST at 01:00 UTC. */
const AFTER_SPRING = new Date('2027-03-28T01:00:30Z');

const SUMMER: ScheduleClock = { zone: BERLIN, offset: 120 };
const WINTER: ScheduleClock = { zone: BERLIN, offset: 60 };

/** A controller that lights at 08:00 and goes dark at 20:00 in Berlin summer time, with the tuning a move must keep. */
const SUMMER_CONFIGURATION: DeviceConfiguration = {
  workmode: 'breed',
  day: { temperature: 25, humidity: 60 },
  daynight: { day: 6 * HOUR, night: 18 * HOUR, maxDehumidifySeconds: 120 },
};

let db: V1TestDatabase;
let published: { topic: string; message: string }[];
let configuration: DeviceConfigurationService;
let clocks: ScheduleClockService;
let ingest: DeviceIngestService;

const owner = (preferences: { timezone: string; timezoneChosen: boolean }) =>
  db.users.create({ id: OWNER, email: 'grower@example.com', passwordHash: 'x', handle: 'grower', preferences });

const device = (fields: Partial<StoredDevice> = {}) =>
  db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, configuration: SUMMER_CONFIGURATION, ...fields });

const stored = async (): Promise<StoredDevice> => {
  const found = await db.devices.findOne({ id: DEVICE }).lean<StoredDevice>();
  if (!found) throw new Error('The device is gone');
  return found;
};

const sent = () => published.filter(message => message.topic === `/devices/${DEVICE}/configuration`).map(message => JSON.parse(message.message));

/** What the Berlin wall says at so many seconds past midnight UTC on the day given. */
const onTheWall = (seconds: unknown, day: string) =>
  DateTime.fromISO(day, { zone: 'utc' })
    .plus({ seconds: Number(seconds) })
    .setZone(BERLIN)
    .toFormat('HH:mm');

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
      published.push({ topic, message });
      return true;
    }),
  } as unknown as MqttClientService;

  const publisher = new DevicePublisherService(db.devices, mqtt);
  const plans = new PlanService(db.plans, db.devices, {} as never);
  configuration = new DeviceConfigurationService(db.devices, db.users, db.targetChanges, publisher, new EntryWriterService(db.entries), plans);
  clocks = new ScheduleClockService(db.devices, db.users, configuration);
  ingest = new DeviceIngestService(
    db.devices,
    db.cameras,
    db.targetChanges,
    mqtt,
    publisher,
    new HardwareReportService(db.devices, db.cameras),
    new EntryWriterService(db.entries),
  );
});

describe('the clock a schedule is kept on', () => {
  it('is the zone the owner picked, at the offset it has at that instant', () => {
    expect(scheduleClockOf({ timezone: BERLIN, timezoneChosen: true }, BEFORE_AUTUMN)).toEqual(SUMMER);
    expect(scheduleClockOf({ timezone: BERLIN, timezoneChosen: true }, AFTER_AUTUMN)).toEqual(WINTER);
  });

  it('is no clock at all for the UTC an account starts on, or for a zone nobody knows', () => {
    expect(scheduleClockOf({ timezone: 'UTC', timezoneChosen: false }, AFTER_AUTUMN)).toBeNull();
    expect(scheduleClockOf({ timezone: BERLIN, timezoneChosen: false }, AFTER_AUTUMN)).toBeNull();
    expect(scheduleClockOf({ timezone: 'Mars/Olympus_Mons', timezoneChosen: true }, AFTER_AUTUMN)).toBeNull();
    expect(scheduleClockOf(null, AFTER_AUTUMN)).toBeNull();
  });

  it('moves every time of day a firmware keeps, round midnight, and nothing else', () => {
    expect(
      withClockTimesMoved(
        {
          day: { temperature: 25 },
          daynight: { day: 23.5 * HOUR, night: 11.5 * HOUR, maxDehumidifySeconds: 120 },
          co2inject: { day: 7 * HOUR, night: 17 * HOUR, period: 15 },
        },
        HOUR,
      ),
    ).toEqual({
      day: { temperature: 25 },
      daynight: { day: 0.5 * HOUR, night: 12.5 * HOUR, maxDehumidifySeconds: 120 },
      co2inject: { day: 8 * HOUR, night: 18 * HOUR, period: 15 },
    });
    // The stand-alone lamp keeps its pair at the top of its document.
    expect(withClockTimesMoved({ day: 6 * HOUR, night: 0, limit: 80 }, -HOUR)).toEqual({ day: 5 * HOUR, night: 23 * HOUR, limit: 80 });
    // A smart socket's timer moves window by window, each keeping how long it runs.
    expect(
      withClockTimesMoved(
        {
          workmode: 'timer',
          daynight: { day: 6 * HOUR, night: 22 * HOUR },
          timer: {
            timeframes: [
              { ontime: 23.5 * HOUR, duration: 60 },
              { ontime: 10 * HOUR, duration: 15 },
            ],
            kept: 1,
          },
        },
        HOUR,
      ),
    ).toEqual({
      workmode: 'timer',
      daynight: { day: 7 * HOUR, night: 23 * HOUR },
      timer: {
        timeframes: [
          { ontime: 0.5 * HOUR, duration: 60 },
          { ontime: 11 * HOUR, duration: 15 },
        ],
        kept: 1,
      },
    });
  });

  it('counts the windows of a socket’s timer among the times a document keeps', () => {
    const timer = (ontime: number): DeviceConfiguration => ({ timer: { timeframes: [{ ontime, duration: 10 }] } });

    expect(keepsTime(timer(10 * HOUR))).toBe(true);
    expect(clockTimesOf(timer(10 * HOUR))).toEqual({ 'timer.timeframes.0.ontime': 10 * HOUR });
    expect(sameClockTimes(timer(10 * HOUR), timer(11 * HOUR))).toBe(false);
    expect(keepsTime({ timer: { timeframes: [] } })).toBe(false);
  });
});

describe('the night the clocks change', () => {
  it('keeps the light at 08:00 on the Berlin wall when summer time ends, and sends the device the moved document once', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device({ scheduleClock: SUMMER });
    expect(onTheWall(6 * HOUR, '2026-10-24')).toBe('08:00');

    await clocks.run(BEFORE_AUTUMN);
    expect(sent()).toEqual([]);

    await clocks.run(AFTER_AUTUMN);

    const after = await stored();
    expect(after.configuration).toEqual({ ...SUMMER_CONFIGURATION, daynight: { day: 7 * HOUR, night: 19 * HOUR, maxDehumidifySeconds: 120 } });
    expect(onTheWall((after.configuration?.daynight as { day: number }).day, '2026-10-26')).toBe('08:00');
    expect(onTheWall((after.configuration?.daynight as { night: number }).night, '2026-10-26')).toBe('20:00');
    expect(after.scheduleClock).toEqual(WINTER);
    expect(sent()).toEqual([after.configuration]);

    // Nothing the owner did, so nothing in their diary.
    expect(await db.entries.countDocuments()).toBe(0);

    await clocks.run(new Date(AFTER_AUTUMN.getTime() + 60_000));
    expect(sent()).toHaveLength(1);
  });

  it('moves it back when summer time begins again', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device({ configuration: { daynight: { day: 7 * HOUR, night: 19 * HOUR } }, scheduleClock: WINTER });

    await clocks.run(AFTER_SPRING);

    expect((await stored()).configuration).toEqual({ daynight: { day: 6 * HOUR, night: 18 * HOUR } });
    expect((await stored()).scheduleClock).toEqual(SUMMER);
  });

  it('moves a plan’s light schedule along with the device, so the next hourly pass does not put the old hour back', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device({ scheduleClock: SUMMER });
    await db.plans.create({
      id: 'plan-1',
      deviceId: DEVICE,
      name: 'Carried over from the old cloud',
      steps: [
        {
          id: 'veg',
          name: 'Veg',
          duration: { value: 4, unit: 'weeks' },
          settings: { day: { temperature: 26 }, daynight: { day: 4 * HOUR, night: 22 * HOUR } },
        },
        { id: 'flower', name: 'Flower', duration: { value: 8, unit: 'weeks' }, settings: { day: { temperature: 24 } } },
      ],
    });

    await clocks.run(AFTER_AUTUMN);

    const plan = await db.plans.findOne({ deviceId: DEVICE }).lean();
    expect(plan?.steps.map(step => step.settings)).toEqual([
      { day: { temperature: 26 }, daynight: { day: 5 * HOUR, night: 23 * HOUR } },
      { day: { temperature: 24 } },
    ]);
  });

  it('keeps the wall-clock hour when the owner names another zone', async () => {
    await owner({ timezone: 'America/New_York', timezoneChosen: true });
    await device({ configuration: { daynight: { day: 7 * HOUR, night: 19 * HOUR, maxDehumidifySeconds: 120 } }, scheduleClock: WINTER });

    await clocks.run(AFTER_AUTUMN);

    // 08:00 in Berlin was 07:00 UTC; 08:00 in New York, still on summer time that week, is 12:00 UTC.
    // Twelve hours later is midnight UTC, written as the second before it so the evening ramp runs.
    expect((await stored()).configuration?.daynight).toEqual({ day: 12 * HOUR, night: 86399, maxDehumidifySeconds: 120 });
    expect((await stored()).scheduleClock).toEqual({ zone: 'America/New_York', offset: -240 });
  });
});

describe('a clock that only appears', () => {
  it('moves nothing for an account that never picked its zone, and anchors without moving once it does', async () => {
    await owner({ timezone: 'UTC', timezoneChosen: false });
    await device();

    await clocks.run(AFTER_AUTUMN);
    expect((await stored()).scheduleClock).toBeNull();

    // What the app does on the first visit: it takes the browser's zone. The
    // lamp was set by that wall clock all along, so it must not move now.
    await db.users.updateOne({ id: OWNER }, { $set: { preferences: { timezone: BERLIN, timezoneChosen: true } } });
    await clocks.run(AFTER_AUTUMN);

    expect((await stored()).configuration).toEqual(SUMMER_CONFIGURATION);
    expect((await stored()).scheduleClock).toEqual(WINTER);
    expect(sent()).toEqual([]);
  });

  it('anchors times the device set on its own menu on the clock in force, and moves nothing', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device({ scheduleClock: SUMMER });

    await ingest.handle(`/devices/${DEVICE}/configuration`, JSON.stringify({ daynight: { day: 9 * HOUR, night: 21 * HOUR } }));
    expect((await stored()).scheduleClock).toBeNull();

    await clocks.run(AFTER_AUTUMN);

    expect((await stored()).configuration).toEqual({ daynight: { day: 9 * HOUR, night: 21 * HOUR } });
    expect((await stored()).scheduleClock).toEqual(WINTER);
  });

  it('keeps the clock when the device only echoes what it was sent', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device({ scheduleClock: SUMMER });

    await ingest.handle(`/devices/${DEVICE}/configuration`, JSON.stringify({ ...SUMMER_CONFIGURATION, day: { temperature: 27, humidity: 60 } }));

    expect((await stored()).scheduleClock).toEqual(SUMMER);
  });

  it('leaves devices without a schedule or an owner alone', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device({ configuration: { workmode: 'heater', heater: { day: { on: 24 } } } });
    await db.devices.create({ id: 'unclaimed', type: 'controller', ownerId: null, configuration: SUMMER_CONFIGURATION });

    await clocks.run(AFTER_AUTUMN);

    expect((await stored()).scheduleClock).toBeNull();
    expect((await db.devices.findOne({ id: 'unclaimed' }).lean())?.scheduleClock).toBeNull();
    expect(sent()).toEqual([]);
  });
});

describe('a save', () => {
  it('anchors the times it sets on the clock it is made on', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device();

    await configuration.replace(DEVICE, { ...SUMMER_CONFIGURATION, daynight: { day: 20 * HOUR, night: 8 * HOUR } }, OWNER);

    expect((await stored()).configuration?.daynight).toEqual({ day: 20 * HOUR, night: 8 * HOUR });
    expect((await stored()).scheduleClock).toEqual(scheduleClockOf({ timezone: BERLIN, timezoneChosen: true }, new Date()));
  });

  /**
   * A page drawn before the clock moved still holds the old seconds; a
   * temperature saved from it must not pin the light an hour off. The zone
   * change stands in for any move that has not been passed over yet.
   */
  it('moves times it leaves alone onto the clock that moved, and keeps times it sets as they were sent', async () => {
    await owner({ timezone: 'Asia/Tokyo', timezoneChosen: true });
    const tokyo = scheduleClockOf({ timezone: 'Asia/Tokyo', timezoneChosen: true }, new Date())!;
    const away: ScheduleClock = { zone: 'Etc/GMT-10', offset: tokyo.offset + 60 };
    await device({ scheduleClock: away });

    await configuration.replace(DEVICE, { ...SUMMER_CONFIGURATION, day: { temperature: 26, humidity: 60 } }, OWNER);
    expect((await stored()).configuration?.daynight).toEqual({ day: 7 * HOUR, night: 19 * HOUR, maxDehumidifySeconds: 120 });
    expect((await stored()).scheduleClock).toEqual(tokyo);

    await db.devices.updateOne({ id: DEVICE }, { $set: { scheduleClock: away } });
    await configuration.replace(DEVICE, { ...SUMMER_CONFIGURATION, daynight: { day: 10 * HOUR, night: 22 * HOUR } }, OWNER);
    expect((await stored()).configuration?.daynight).toEqual({ day: 10 * HOUR, night: 22 * HOUR });
  });

  it('still lets a preset lengthen the day from the hour the light comes on', async () => {
    await owner({ timezone: BERLIN, timezoneChosen: true });
    await device({ scheduleClock: scheduleClockOf({ timezone: BERLIN, timezoneChosen: true }, new Date()) });

    await configuration.applyConfiguration(DEVICE, { daynight: { day: 6 * HOUR, night: 0 }, lights: { limit: 80 } });

    // Midnight UTC on the dot is held a second short of it (`class-rules.ts`).
    expect((await stored()).configuration?.daynight).toEqual({ day: 6 * HOUR, night: 86399, maxDehumidifySeconds: 120 });
  });
});
