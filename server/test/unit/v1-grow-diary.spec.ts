import type { DeviceSeries, GrowDiaryDay, GrowDiaryPage, Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { growDayAt, stageWeekOf } from '@fg2/shared-types/v1-schemas';
import { AccessService } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { DataService, DeviceHistory } from '@modules/data/data.service';
import { diaryWeeksOf } from '@modules/v1/diary/grow-calendar';
import { GrowClimateService } from '@modules/v1/diary/grow-climate.service';
import { GrowDiaryService } from '@modules/v1/diary/grow-diary.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { anonymous, session, visitor } from './support/callers';
import { accessOn, growsOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';
import { standingIn } from './support/placed';

/**
 * A grow's diary, day by day.
 *
 * What is asserted is what nobody can see wrong in the data: which date a
 * line is filed under, which day of the grow a date is, when a day's share
 * inside its targets is a number and when it is nothing, and what a reader
 * from outside is not handed.
 *
 * The world is a Berlin grower's tent in November - an hour ahead of UTC -
 * with a controller, a camera and a grow begun on a Monday at three in the
 * afternoon. "Now" is ten on the Thursday of the week after: the eleventh
 * date of the grow, and by the grow's own twenty-four-hour count still its
 * tenth day.
 */

const OWNER = 'user-owner';
const TENT = 'space-tent';
const SPARE_TENT = 'space-spare';
const CONTROLLER = 'device-controller';
const SPARE_CONTROLLER = 'device-spare';
const CAMERA = 'camera-1';
const GROW = 'grow-autumn';

const ORIGIN = new Date('2026-11-02T14:00:00.000Z');
const NOW = new Date('2026-11-12T09:00:00.000Z');

const STEP_SECONDS = 300;
const HOUR_MS = 3600 * 1000;

/** An instant on the Berlin clock of a November date. */
const berlin = (day: number, clock: string): Date => new Date(`2026-11-${String(day).padStart(2, '0')}T${clock}:00.000+01:00`);

const db = useV1TestDatabase();
let access: AccessService;
let diary: GrowDiaryService;

/** What the store holds: readings by instant, null for a window nothing was heard in. */
let measured: (at: Date) => { temperature: number | null; humidity: number | null };
let readWindows: { deviceId: string; startsAt: Date; endsAt: Date }[];

/** The hours of the Berlin clock the lamp is lit between: six in the morning to six in the evening unless a test says otherwise. */
let lamp: { from: number; until: number };

/** From when on the device wrote nothing; null is a device that reports to the end of every read. */
let silentFrom: Date | null;

const lit = (at: number): boolean => {
  const hour = new Date(at + HOUR_MS).getUTCHours();
  return hour >= lamp.from && hour < lamp.until;
};

interface FakeRequest {
  startsAt: Date;
  endsAt: Date;
  metrics: readonly Metric[];
  outputs?: readonly OutputMetric[];
}

/** The store's windows over a read: aligned to the step, each stamped at its end. */
const windowsIn = (request: FakeRequest): number[] => {
  const step = STEP_SECONDS * 1000;
  const first = Math.floor(request.startsAt.getTime() / step) * step;
  return Array.from({ length: Math.ceil((request.endsAt.getTime() - first) / step) }, (_, index) => first + index * step);
};

const fakeData = {
  history: async (deviceId: string, request: FakeRequest): Promise<DeviceHistory> => {
    readWindows.push({ deviceId, startsAt: request.startsAt, endsAt: request.endsAt });
    const windows = windowsIn(request);
    const points = (value: (startsAt: number) => number | null): SeriesPoint[] =>
      windows.map(startsAt => ({ measuredAt: new Date(startsAt + STEP_SECONDS * 1000).toISOString(), value: value(startsAt) }));
    const heard = (startsAt: number) => measured(new Date(startsAt));

    return {
      series: {
        deviceId,
        startsAt: request.startsAt.toISOString(),
        endsAt: request.endsAt.toISOString(),
        stepSeconds: STEP_SECONDS,
        metrics: request.metrics.map(metric => ({
          metric,
          points: points(startsAt =>
            metric === 'temperature' ? heard(startsAt).temperature : metric === 'humidity' ? heard(startsAt).humidity : null,
          ),
        })),
        outputs: (request.outputs ?? []).map(output => ({ output, points: points(startsAt => (lit(startsAt) ? 100 : 0)) })),
      } as DeviceSeries,
      // The state the read opens in, then every switching after it.
      outputs: (request.outputs ?? []).map(output => ({
        output,
        switchings: windows.flatMap((startsAt, index) =>
          index === 0 || lit(startsAt) !== lit(windows[index - 1]) ? [{ at: new Date(startsAt).toISOString(), on: lit(startsAt) }] : [],
        ),
      })),
      lastSampleAt: (silentFrom && silentFrom < request.endsAt ? silentFrom : request.endsAt).toISOString(),
    };
  },
} as unknown as DataService;

const entry = (over: Partial<EntryDocument>): EntryDocument =>
  ({
    id: `entry-${Math.random()}`,
    createdAt: NOW,
    kind: 'note',
    occurredAt: NOW,
    source: 'human',
    authorId: OWNER,
    growId: null,
    spaceId: null,
    deviceId: null,
    plantIds: [],
    cameraId: null,
    taskId: null,
    alertId: null,
    severity: null,
    text: null,
    message: null,
    values: { kind: 'note' },
    mediaIds: [],
    undoUntil: null,
    ...over,
  }) as EntryDocument;

const machine = (id: string, key: string, occurredAt: Date, over: Partial<EntryDocument> = {}): EntryDocument =>
  entry({
    id,
    kind: 'system',
    source: 'device',
    authorId: null,
    spaceId: TENT,
    deviceId: CONTROLLER,
    occurredAt,
    message: { key, params: [] },
    values: { kind: 'system' },
    ...over,
  });

const TARGETS = { day: { temperature: 25, humidity: 55 }, night: { temperature: 20, humidity: 56 }, co2: null };

const still = (id: string, capturedAt: Date, lamp: boolean | null = true) => ({
  id,
  kind: 'still',
  mime: 'image/jpeg',
  bytes: 1,
  cameraId: CAMERA,
  capturedAt,
  lit: lamp,
});

const world = async (): Promise<void> => {
  await db.users.create({ id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x', preferences: { timezone: 'Europe/Berlin' } });
  await db.spaces.create([
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent', roomId: null },
    { id: SPARE_TENT, ownerId: OWNER, kind: 'tent', name: 'Spare', roomId: null },
  ]);
  await db.devices.create([
    {
      id: CONTROLLER,
      type: 'controller',
      ownerId: OWNER,
      ...standingIn(TENT),
      configuration: { day: { temperature: 25 }, night: { temperature: 20 } },
    },
    {
      id: SPARE_CONTROLLER,
      type: 'controller',
      ownerId: OWNER,
      ...standingIn(SPARE_TENT),
      configuration: { day: { temperature: 25 }, night: { temperature: 20 } },
    },
  ]);
  await db.cameras.create({ id: CAMERA, ownerId: OWNER, kind: 'terpcam_controller', deviceId: CONTROLLER, spaceId: TENT, name: 'Cam' });
  // What the controller aimed at is on record from noon of the fourth date on.
  await db.targetChanges.create({ id: 'change-1', deviceId: CONTROLLER, at: berlin(5, '12:00'), targets: TARGETS, cycle: null });

  await db.grows.create({
    id: GROW,
    ownerId: OWNER,
    name: 'Autumn run',
    type: 'photoperiod',
    phases: [
      {
        id: 'phase-veg',
        stage: 'vegetative',
        preset: null,
        startedAt: ORIGIN,
        source: 'human',
        plantIds: null,
        deviceId: CONTROLLER,
        targets: TARGETS,
        setBy: OWNER,
      },
      {
        id: 'phase-flower',
        stage: 'flowering',
        preset: null,
        startedAt: berlin(10, '09:00'),
        source: 'human',
        plantIds: null,
        deviceId: CONTROLLER,
        targets: TARGETS,
        setBy: OWNER,
      },
    ],
    placements: [{ id: 'placement-1', spaceId: TENT, startedAt: ORIGIN, endedAt: null, plantIds: null }],
    slug: 'autumn-run',
    startedAt: ORIGIN,
    endedAt: null,
  });

  await db.entries.create([
    entry({
      id: 'watered-this-morning',
      growId: GROW,
      kind: 'water',
      occurredAt: berlin(12, '08:12'),
      values: { kind: 'water', litres: 1.5, readings: [] },
    }),
    entry({ id: 'note-last-night', growId: GROW, occurredAt: berlin(11, '21:40'), text: 'Smells good' }),
    // What a device logs about itself is its own record, not the grow's diary.
    machine('booted', 'message-device-booted', berlin(11, '06:00')),
    machine('firmware', 'message-device-firmware-update', berlin(11, '07:00')),
    // Somebody put the tent into maintenance for fifteen minutes and ended it after four.
    machine('maintenance-on', 'message-maintenance-mode-activated-remote', berlin(11, '10:00'), {
      message: { key: 'message-maintenance-mode-activated-remote', params: ['15'] },
    }),
    machine('maintenance-off', 'message-maintenance-mode-activated-remote', berlin(11, '10:04'), {
      message: { key: 'message-maintenance-mode-activated-remote', params: ['0'] },
    }),
    // And once at the device, where nobody ended it: it was over when its minutes were.
    machine('maintenance-left', 'message-maintenance-mode-activated', berlin(10, '17:00'), {
      message: { key: 'message-maintenance-mode-activated', params: ['30'] },
    }),
    // Maintenance of a tent the grow never stood in.
    machine('maintenance-elsewhere', 'message-maintenance-mode-activated', berlin(11, '08:00'), {
      spaceId: SPARE_TENT,
      deviceId: SPARE_CONTROLLER,
      message: { key: 'message-maintenance-mode-activated', params: ['15'] },
    }),
    // Written to the grow for a moment before the date it began on.
    entry({ id: 'note-too-early', growId: GROW, occurredAt: berlin(1, '18:00'), text: 'Seeds arrived' }),
    entry({
      id: 'plan-step',
      kind: 'plan',
      source: 'plan',
      authorId: null,
      growId: GROW,
      spaceId: TENT,
      occurredAt: berlin(10, '09:00'),
      message: { key: 'message-recipe-advanced', params: ['2'] },
      values: { kind: 'plan', planId: 'plan-1', stepIndex: 1, transition: null },
    }),
    // The plan's line about another grow sharing the tent is that grow's.
    entry({
      id: 'plan-step-of-another',
      kind: 'plan',
      source: 'plan',
      authorId: null,
      growId: 'grow-other',
      spaceId: TENT,
      occurredAt: berlin(10, '09:30'),
      message: { key: 'message-recipe-advanced', params: ['2'] },
      values: { kind: 'plan', planId: 'plan-2', stepIndex: 1, transition: null },
    }),
  ]);

  await db.media.create([
    still('still-11-morning', berlin(11, '09:00')),
    still('still-11-midday', berlin(11, '13:10')),
    still('still-12-early', berlin(12, '08:00')),
    still('still-12-newest-lit', berlin(12, '09:30')),
    still('still-12-dark', berlin(12, '09:50'), false),
    {
      id: 'film-week',
      kind: 'timelapse',
      mime: 'video/mp4',
      bytes: 1,
      cameraId: CAMERA,
      window: 'week',
      capturedAt: berlin(9, '00:00'),
      endsAt: berlin(16, '00:00'),
      lengthSeconds: 20,
    },
  ]);
};

beforeEach(async () => {
  await db.reset();
  readWindows = [];
  lamp = { from: 6, until: 18 };
  silentFrom = null;
  measured = at => ({ temperature: lit(at.getTime()) ? 25 : 20, humidity: 55 });
  access = accessOn(db);
  diary = new GrowDiaryService(
    db.entries,
    db.cameras,
    db.media,
    db.users,
    growsOn(db, access),
    new GrowClimateService(db.devices, db.targetChanges, fakeData),
  );
  await world();
});

const grantFor = async (ctx: AccessContext): Promise<Grant> => {
  const grant = await access.access(ctx, { type: 'grow', id: GROW }, 'view');
  if (!grant) throw new Error('refused');

  return grant;
};

const read = async (ctx: AccessContext = session(OWNER), query: { limit?: number; cursor?: string } = {}): Promise<GrowDiaryPage> =>
  diary.page(GROW, await grantFor(ctx), query, NOW);

const dayOf = (page: GrowDiaryPage, dayNumber: number): GrowDiaryDay => {
  const day = page.items.flatMap(week => week.days).find(one => one.dayNumber === dayNumber);
  if (!day) throw new Error(`no day ${dayNumber}`);

  return day;
};

describe('the days of a diary', () => {
  it('are the dates of the owner´s calendar, numbered from the date the grow began on, newest first', async () => {
    const page = await read();

    expect(page.items.map(week => [week.weekNumber, week.dayFrom, week.dayTo])).toEqual([
      [2, 8, 14],
      [1, 1, 7],
    ]);
    expect(page.items[0].days.map(day => [day.dayNumber, day.date])).toEqual([
      [11, '2026-11-12'],
      [10, '2026-11-11'],
      [9, '2026-11-10'],
      [8, '2026-11-09'],
    ]);
    expect(page.items[1].days.map(day => day.dayNumber)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    // Midnight to midnight in Berlin; the day still running ends now.
    expect(dayOf(page, 10)).toMatchObject({ startsAt: '2026-11-10T23:00:00.000Z', endsAt: '2026-11-11T23:00:00.000Z' });
    expect(dayOf(page, 11)).toMatchObject({ startsAt: '2026-11-11T23:00:00.000Z', endsAt: NOW.toISOString() });
  });

  it('file this morning´s line under today, whatever hour the grow began at', async () => {
    // The grow began at three in the afternoon ten days ago; counted in dates this morning is its eleventh day.
    expect(growDayAt(ORIGIN, NOW, 'Europe/Berlin')).toBe(11);
    // In the first hour after midnight too, on every date after the clocks changed.
    expect(growDayAt(new Date('2026-03-20T15:00:00.000Z'), new Date('2026-03-31T22:30:00.000Z'), 'Europe/Berlin')).toBe(13);

    const page = await read();

    expect(dayOf(page, 11).entries.map(line => line.id)).toEqual(['watered-this-morning']);
    expect(dayOf(page, 10).entries.map(line => line.id)).toEqual(['note-last-night']);
  });

  it('keep what was dated to before the grow began for the end of the last page, without a day', async () => {
    const first = await read(session(OWNER), { limit: 1 });
    expect(first.earlier).toEqual([]);

    const last = await read(session(OWNER), { limit: 1, cursor: first.nextCursor! });
    expect(last.earlier.map(line => line.id)).toEqual(['note-too-early']);
    expect(last.items.flatMap(week => week.days.flatMap(day => day.entries.map(line => line.id)))).not.toContain('note-too-early');
  });

  it('name a week after the stage it lay in, and that stage´s own week', async () => {
    const page = await read();

    expect(page.items.map(week => [week.stage, week.stageWeek])).toEqual([
      ['flowering', 1],
      ['vegetative', 1],
    ]);
  });

  /** The week still running is named after today's stage; the days the diary folds of it are named by their own. */
  it('say each day´s stage at its middle and that stage´s week then', async () => {
    const page = await read();

    expect(page.items[0].days.map(day => [day.dayNumber, day.phase?.stage, day.phase?.stageWeek])).toEqual([
      [11, 'flowering', 1],
      [10, 'flowering', 1],
      [9, 'flowering', 1],
      [8, 'vegetative', 2],
    ]);
  });

  /**
   * A stage's week is counted from the stage's own start, as a grower counts:
   * on the thirteenth day of flowering it is in its second week, whichever day
   * of the grow's own week it began on.
   */
  it('count a stage´s week from its own first day: days 1 to 7 are week 1', () => {
    const flowering = berlin(10, '09:00');
    const first = growDayAt(ORIGIN, flowering, 'Europe/Berlin');

    expect([0, 6, 7, 12, 13, 14].map(after => stageWeekOf(ORIGIN, flowering, first + after, 'Europe/Berlin'))).toEqual([1, 1, 2, 2, 2, 3]);
    // A day before the stage began is counted as its first week, never a week 0.
    expect(stageWeekOf(ORIGIN, flowering, first - 3, 'Europe/Berlin')).toBe(1);
  });

  it('come a few weeks at a time', async () => {
    const first = await read(session(OWNER), { limit: 1 });
    expect(first.items.map(week => week.weekNumber)).toEqual([2]);
    expect(first.nextCursor).not.toBeNull();

    const second = await read(session(OWNER), { limit: 1, cursor: first.nextCursor! });
    expect(second.items.map(week => week.weekNumber)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
    // One read of the store per week and controller, and none of a tent the grow never stood in.
    expect(readWindows.map(window => window.deviceId)).toEqual([CONTROLLER, CONTROLLER]);
  });
});

describe('the calendar a diary is told in', () => {
  it('counts the date the clocks go back on once, twenty-five hours long', () => {
    // Berlin leaves summer time on 25 October 2026.
    const weeks = diaryWeeksOf(new Date('2026-10-20T13:00:00.000Z'), new Date('2026-10-27T09:00:00.000Z'), 'Europe/Berlin');
    const days = weeks.flatMap(week => week.days);

    expect(days.map(day => day.date)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(days.map(day => day.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(days[5]).toMatchObject({ startsAt: new Date('2026-10-24T22:00:00.000Z'), endsAt: new Date('2026-10-25T23:00:00.000Z') });
    expect(weeks.map(week => [week.weekNumber, week.days.length])).toEqual([
      [1, 7],
      [2, 1],
    ]);
  });

  it('is the calendar of UTC for an owner who never chose a zone', () => {
    const [week] = diaryWeeksOf(new Date('2026-11-02T23:30:00.000Z'), new Date('2026-11-03T00:30:00.000Z'), null);

    expect(week.days.map(day => day.date)).toEqual(['2026-11-02', '2026-11-03']);
  });
});

describe('what a day says about its climate', () => {
  it('states the means and the share inside what the device aimed at', async () => {
    const day = dayOf(await read(), 10);

    expect(day.climate).toEqual({ temperature: 22.5, humidity: 55, inBandFraction: 1 });
  });

  it('counts a stretch outside the band against the share and names it', async () => {
    measured = at => ({
      temperature: lit(at.getTime()) ? 25 : 20,
      humidity: at >= berlin(10, '20:00') && at < berlin(10, '20:30') ? 70 : 55,
    });

    const day = dayOf(await read(), 9);

    expect(day.climate?.inBandFraction).toBeCloseTo(282 / 288, 3);
    expect(day.events.filter(event => event.kind === 'excursion')).toEqual([
      {
        kind: 'excursion',
        at: berlin(10, '20:00').toISOString(),
        endedAt: berlin(10, '20:30').toISOString(),
        metric: 'humidity',
        above: true,
        extremeValue: 70,
      },
    ]);
  });

  it('says nothing of a day from before the record of what was aimed at', async () => {
    const page = await read();

    // The record begins at noon of the fourth date: the days before it are stated, not graded.
    expect(dayOf(page, 3).climate).toEqual({ temperature: 22.5, humidity: 55, inBandFraction: null });
    // From noon on is half the day, and that half is judged.
    expect(dayOf(page, 4).climate?.inBandFraction).toBe(1);
  });

  it('does not grade a day by the one good hour that was heard of it', async () => {
    measured = at =>
      at >= berlin(11, '00:00') && at < berlin(12, '00:00') && !(at >= berlin(11, '10:00') && at < berlin(11, '12:00'))
        ? { temperature: null, humidity: null }
        : { temperature: lit(at.getTime()) ? 25 : 20, humidity: 55 };

    expect(dayOf(await read(), 10).climate).toEqual({ temperature: 25, humidity: 55, inBandFraction: null });
  });

  it('is nothing at all where nothing measured', async () => {
    measured = () => ({ temperature: null, humidity: null });

    expect(dayOf(await read(), 10).climate).toBeNull();
  });

  it('keeps a controller for the days it stood in the tent, though it has left since', async () => {
    // Taken out of the tent at the start of the grow's ninth day, and standing nowhere now.
    await db.devices.updateOne(
      { id: CONTROLLER },
      { $set: { spaceId: null, placements: [{ spaceId: TENT, startedAt: new Date(0), endedAt: berlin(10, '00:00') }] } },
    );
    const page = await read();

    expect(dayOf(page, 8).climate).toMatchObject({ temperature: 22.5, humidity: 55 });
    expect(dayOf(page, 9).climate).toBeNull();
    expect(dayOf(page, 10).climate).toBeNull();
  });

  it('says nothing of the days before a controller came from another place', async () => {
    await db.devices.updateOne(
      { id: CONTROLLER },
      {
        $set: {
          placements: [
            { spaceId: 'another-place', startedAt: new Date(0), endedAt: berlin(10, '00:00') },
            { spaceId: TENT, startedAt: berlin(10, '00:00'), endedAt: null },
          ],
        },
      },
    );
    const page = await read();

    expect(dayOf(page, 8).climate).toBeNull();
    expect(dayOf(page, 9).climate).toMatchObject({ temperature: 22.5, humidity: 55 });
  });

  describe('where one controller replaced another', () => {
    const CAME = berlin(10, '20:07');

    beforeEach(async () => {
      await db.devices.updateOne(
        { id: CONTROLLER },
        { $set: { spaceId: null, placements: [{ spaceId: TENT, startedAt: new Date(0), endedAt: CAME }] } },
      );
      await db.devices.updateOne(
        { id: SPARE_CONTROLLER },
        {
          $set: {
            name: 'Controller B',
            spaceId: TENT,
            placements: [
              { spaceId: SPARE_TENT, startedAt: new Date(0), endedAt: CAME },
              { spaceId: TENT, startedAt: CAME, endedAt: null },
            ],
          },
        },
      );
      await db.targetChanges.create({ id: 'change-spare', deviceId: SPARE_CONTROLLER, at: new Date(0), targets: TARGETS, cycle: null });
    });

    it('says so on the day it happened, with the device that took over - and to nobody from outside', async () => {
      await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });
      const page = await read();
      const changes = (day: GrowDiaryDay) => day.events.filter(event => event.kind === 'device');

      expect(changes(dayOf(page, 9))).toEqual([{ kind: 'device', at: CAME.toISOString(), name: 'Controller B', type: 'controller' }]);
      expect(page.items.flatMap(week => week.days).flatMap(changes)).toHaveLength(1);
      expect((await read(anonymous)).items.flatMap(week => week.days).flatMap(day => day.events)).toEqual([]);
    });

    it('dates a stretch outside the band no earlier than its device came', async () => {
      // Too humid from two minutes before the new controller came: its first window began before it stood here.
      await db.devices.deleteOne({ id: CONTROLLER });
      measured = at => ({ temperature: lit(at.getTime()) ? 25 : 20, humidity: at >= berlin(10, '20:05') && at < berlin(10, '20:35') ? 70 : 55 });

      expect(dayOf(await read(), 9).events.filter(event => event.kind === 'excursion')).toMatchObject([
        { at: CAME.toISOString(), endedAt: berlin(10, '20:35').toISOString(), metric: 'humidity' },
      ]);
    });
  });
});

describe('what the devices did', () => {
  it('is the lamp coming on and going off', async () => {
    const page = await read();

    expect(dayOf(page, 10).events.filter(event => event.kind === 'light')).toEqual([
      { kind: 'light', at: berlin(11, '06:00').toISOString(), on: true, still: false },
      { kind: 'light', at: berlin(11, '18:00').toISOString(), on: false, still: false },
    ]);
    // Today the lamp has come on and not gone off yet: it is still lit.
    expect(dayOf(page, 11).events).toEqual([{ kind: 'light', at: berlin(12, '06:00').toISOString(), on: true, still: true }]);
  });

  it('gives a lit stretch that has not ended no end', async () => {
    // Lit from six in the evening to midnight: a date opens with the lamp going off and closes with it on.
    lamp = { from: 18, until: 24 };

    // The off of the morning is no end of the evening's stretch, and a day that is over says nothing of now.
    expect(dayOf(await read(), 10).events.filter(event => event.kind === 'light')).toEqual([
      { kind: 'light', at: berlin(11, '00:00').toISOString(), on: false, still: false },
      { kind: 'light', at: berlin(11, '18:00').toISOString(), on: true, still: false },
    ]);
  });

  it('says nothing of the lamp for the time after its device fell silent', async () => {
    silentFrom = berlin(12, '07:00');

    // It came on at six. Whether it is lit three hours after the last word of the device, nobody knows.
    expect(dayOf(await read(), 11).events).toEqual([{ kind: 'light', at: berlin(12, '06:00').toISOString(), on: true, still: false }]);
  });

  it('is a lamp coming on at midnight too, on the day a week of the diary begins', async () => {
    lamp = { from: 0, until: 12 };

    // The eighth date opens the second week, and with it a read of the store of its own.
    expect(dayOf(await read(), 8).events).toEqual([
      { kind: 'light', at: berlin(9, '00:00').toISOString(), on: true, still: false },
      { kind: 'light', at: berlin(9, '12:00').toISOString(), on: false, still: false },
    ]);
  });

  it('is the plan´s steps for this grow, and nothing of what a device logs about itself', async () => {
    const page = await read();
    const machines = page.items.flatMap(week => week.days.flatMap(day => day.entries.filter(line => line.source !== 'human').map(line => line.id)));

    expect(machines).toEqual(['plan-step']);
  });
});

describe('maintenance', () => {
  const maintenanceOf = (day: GrowDiaryDay) => day.events.filter(event => event.kind === 'maintenance');

  it('is one stretch from when somebody switched it on to when it was switched off', async () => {
    expect(maintenanceOf(dayOf(await read(), 10))).toEqual([
      { kind: 'maintenance', at: berlin(11, '10:00').toISOString(), endedAt: berlin(11, '10:04').toISOString() },
    ]);
  });

  it('is over when its minutes are, where nobody ended it', async () => {
    expect(maintenanceOf(dayOf(await read(), 9))).toEqual([
      { kind: 'maintenance', at: berlin(10, '17:00').toISOString(), endedAt: berlin(10, '17:30').toISOString() },
    ]);
  });

  it('is one stretch for every device of the place that wrote it, and still going while its minutes are', async () => {
    await db.entries.create([
      machine('on-controller', 'message-maintenance-mode-activated-remote', berlin(12, '09:50'), {
        message: { key: 'message-maintenance-mode-activated-remote', params: ['15'] },
      }),
      machine('on-plug', 'message-maintenance-mode-activated-remote', new Date(berlin(12, '09:50').getTime() + 2000), {
        deviceId: 'device-plug',
        message: { key: 'message-maintenance-mode-activated-remote', params: ['15'] },
      }),
    ]);

    expect(maintenanceOf(dayOf(await read(), 11))).toEqual([{ kind: 'maintenance', at: berlin(12, '09:50').toISOString(), endedAt: null }]);
  });
});

/**
 * Regulation switched off and on again wrote a settings line ("workmode: small → off") that no day told: the
 * critic's incident of a tent left to itself had no cause in its diary. It is one stretch, as maintenance is.
 */
describe('regulation switched off', () => {
  const switched = (id: string, at: Date, line: string, over: Partial<EntryDocument> = {}) =>
    machine(id, 'message-device-configuration-updated', at, {
      message: { key: 'message-device-configuration-updated', params: [line, '', 'controller'] },
      ...over,
    });
  const offOf = (day: GrowDiaryDay) => day.events.filter(event => event.kind === 'controlOff');

  it('is one stretch from the save that switched it off to the one that switched it on, and nothing of the other figures', async () => {
    await db.entries.create([
      switched('off', berlin(12, '09:00'), 'day.temperature: 25 → 24\nworkmode: small → off'),
      switched('figures', berlin(12, '09:05'), 'day.temperature: 24 → 23'),
      switched('on', berlin(12, '09:12'), 'workmode: off → small'),
    ]);
    const day = dayOf(await read(), 11);

    expect(offOf(day)).toEqual([{ kind: 'controlOff', at: berlin(12, '09:00').toISOString(), endedAt: berlin(12, '09:12').toISOString() }]);
    // The save's lines are the device's record, not the diary's.
    expect(day.entries.map(line => line.id)).not.toEqual(expect.arrayContaining(['off', 'figures', 'on']));
  });

  it('runs on where nobody switched it on, and is one stretch for two devices of the place switched off together', async () => {
    await db.entries.create([
      switched('off-controller', berlin(12, '09:30'), 'workmode: full → off'),
      switched('off-plug', new Date(berlin(12, '09:30').getTime() + 2000), 'workmode: small → off', { deviceId: 'device-plug' }),
      switched('on-plug', berlin(12, '09:40'), 'workmode: off → small', { deviceId: 'device-plug' }),
    ]);

    expect(offOf(dayOf(await read(), 11))).toEqual([{ kind: 'controlOff', at: berlin(12, '09:30').toISOString(), endedAt: null }]);
  });
});

describe('the pictures of a diary', () => {
  it('are the still nearest midday, and today the newest one taken in the light', async () => {
    const page = await read();

    expect(dayOf(page, 10).still).toEqual({ mediaId: 'still-11-midday', cameraId: CAMERA, capturedAt: berlin(11, '13:10').toISOString() });
    expect(dayOf(page, 11).still?.mediaId).toBe('still-12-newest-lit');
    expect(dayOf(page, 9).still).toBeNull();
  });

  it('show a day the camera never saw lit by a dark picture once it is over, and the day still running by none yet', async () => {
    await db.media.deleteMany({ kind: 'still' });
    await db.media.create([still('still-10-dark', berlin(10, '13:00'), false), still('still-12-dark', berlin(12, '09:50'), false)]);

    const page = await read();

    expect(dayOf(page, 9).still?.mediaId).toBe('still-10-dark');
    // Today's lamp may yet come on: a black frame says less than no picture.
    expect(dayOf(page, 11).still).toBeNull();
  });

  it('name the week film by the days it covers', async () => {
    const page = await read();

    expect(page.items[0].film).toEqual({ mediaId: 'film-week', dayFrom: 8, dayTo: 11, lengthSeconds: 20 });
    expect(page.items[1].film).toBeNull();
  });

  it('give a film cut across two weeks to the one most of it lies in, named by its days there', async () => {
    // Thursday to Thursday: three dates of the first week and four of the second.
    await db.media.updateOne({ id: 'film-week' }, { $set: { capturedAt: berlin(6, '00:00'), endsAt: berlin(13, '00:00') } });
    const page = await read();

    expect(page.items[0].film).toEqual({ mediaId: 'film-week', dayFrom: 8, dayTo: 11, lengthSeconds: 20 });
    expect(page.items[1].film).toBeNull();
  });

  it('offer no film that is over before it has begun', async () => {
    await db.media.updateOne({ id: 'film-week' }, { $set: { lengthSeconds: 1 } });

    expect((await read()).items.map(week => week.film)).toEqual([null, null]);
  });
});

describe('a reader from outside', () => {
  beforeEach(async () => {
    await db.shareLinks.create({
      id: 'share-1',
      token: 'two-days',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: berlin(10, '00:00'), endsAt: berlin(11, '13:00') },
      includeCameras: false,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });
  });

  it('is answered the days of the window, and each only as far as the window reaches', async () => {
    const page = await read(visitor('two-days'));

    expect(page.items.flatMap(week => week.days.map(day => day.dayNumber))).toEqual([10, 9]);
    expect(dayOf(page, 10).endsAt).toBe(berlin(11, '13:00').toISOString());
  });

  /** What a tent's devices and rules wrote into the grow's own diary inside the link's window, beside a note somebody wrote. */
  const aBusyDay = () =>
    db.entries.create([
      entry({ id: 'note-in-window', growId: GROW, occurredAt: berlin(11, '09:00'), text: 'Topped' }),
      entry({
        id: 'alarm-in-window',
        kind: 'alarm',
        source: 'alarm',
        authorId: null,
        growId: GROW,
        spaceId: TENT,
        alertId: 'alert-1',
        severity: 'warning',
        occurredAt: berlin(11, '10:00'),
        message: { key: 'message-alarm-triggered', params: ['Too humid (humidity), value=71, upper threshold=65, lower threshold=n/a'] },
        values: { kind: 'alarm' },
      }),
    ]);

  it('is answered what people wrote and nothing a device or an alarm did, through a link onto the grow', async () => {
    await aBusyDay();

    const page = await read(visitor('two-days'));

    expect(page.items.flatMap(week => week.days.flatMap(day => day.entries.map(line => line.id)))).toEqual(['note-in-window']);
    expect(JSON.stringify(page)).not.toMatch(/alarm|alert-1|Too humid/);
    // Whoever keeps the place reads both.
    expect(dayOf(await read(), 10).entries.map(line => line.id)).toEqual(['note-last-night', 'alarm-in-window', 'note-in-window']);
  });

  it('is answered the same on the grow´s public page', async () => {
    await aBusyDay();
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });

    const page = await read(anonymous);

    expect(dayOf(page, 10).entries.map(line => line.id)).toEqual(['note-last-night', 'note-in-window']);
    expect(page.items.flatMap(week => week.days.flatMap(day => day.events))).toEqual([]);
    expect(JSON.stringify(page)).not.toMatch(/alarm|alert-1|Too humid|plan-step|maintenance/);
  });

  it('is told neither what the machines wrote nor that a camera exists', async () => {
    const page = await read(visitor('two-days'));
    const days = page.items.flatMap(week => week.days);

    expect(days.flatMap(day => day.entries.map(line => line.id))).toEqual([]);
    // Nor what the devices did, nor how well they kept to their targets: only how the day was.
    expect(days.map(day => day.events)).toEqual([[], []]);
    expect(days.map(day => day.climate?.inBandFraction)).toEqual([null, null]);
    expect(days[1].climate?.temperature).not.toBeNull();
    expect(page.earlier).toEqual([]);
    expect(days.map(day => day.still)).toEqual([null, null]);
    expect(page.items.map(week => week.film)).toEqual([null]);
    expect(page.people).toEqual([]);
  });
});
