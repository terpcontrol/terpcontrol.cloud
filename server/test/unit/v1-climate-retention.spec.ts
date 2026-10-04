import { jest } from '@jest/globals';
import { DailySummary, dailySummariesOf, FluxRow, gridOf, startOfDay } from '@modules/data/flux';
import { DataService } from '@modules/data/data.service';
import { ClimateRetentionService, DEVICES_PER_PASS, untilNextRun } from '@modules/retention/climate-retention.service';
import { chunkOf, climateWindowOf, cutoffOf } from '@modules/retention/climate-window';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Climate retention: which window applies to a device, what a day summarises
 * to, and what one pass of the sweep does with the answer.
 *
 * The store is stood in for rather than started. What is worth checking here is
 * the arithmetic and the order of the two acts - the summary is written before
 * the raw points are dropped, and the stretch that is dropped is exactly the
 * stretch that was summarised - and a real InfluxDB would only make those
 * slower to look at. The Flux itself is not tested by running it; it is built
 * by `flux.ts` beside every other query this server sends.
 */

const OWNER = 'user-owner';
const TENT = 'tent-1';
const CONTROLLER = 'device-controller';

/** A day of one field, as the store answers an aggregate of it. */
const row = (at: string, field: string, value: number | null): FluxRow => ({ _time: at, _field: field, _value: value });

let db: V1TestDatabase;

describe('which window applies', () => {
  it('takes the tent´s window over the account´s, because a shared tent is kept, not its owner', () => {
    expect(climateWindowOf({ climateDays: 90 }, { climateDays: 365 }, 730)).toBe(90);
    // And the other way round: the tent may keep longer than the person does.
    expect(climateWindowOf({ climateDays: 730 }, { climateDays: 90 }, 365)).toBe(730);
  });

  it('falls back to the account where the tent has said nothing, and to the install where neither has', () => {
    expect(climateWindowOf({ climateDays: null }, { climateDays: 365 }, 730)).toBe(365);
    expect(climateWindowOf({ climateDays: null }, { climateDays: null }, 730)).toBe(730);
    expect(climateWindowOf(null, null, 730)).toBe(730);
  });

  it('keeps everything where nobody has named a window, which is what an install that says nothing gets', () => {
    expect(climateWindowOf({ climateDays: null }, { climateDays: null }, 0)).toBeNull();
    expect(climateWindowOf(null, null, 0)).toBeNull();
  });

  it('reads a figure that is not a positive number as nothing said, so a stored zero never means "delete everything"', () => {
    expect(climateWindowOf({ climateDays: 0 }, { climateDays: 365 }, 0)).toBe(365);
    expect(climateWindowOf({ climateDays: -5 }, null, 0)).toBeNull();
    expect(climateWindowOf({ climateDays: Number.NaN }, { climateDays: 90 }, 0)).toBe(90);
    // A window given in fractions of a day is a whole day.
    expect(climateWindowOf({ climateDays: 90.7 }, null, 0)).toBe(90);
  });
});

describe('where the window closes', () => {
  it('cuts at the start of the UTC day that many days back, whatever hour the sweep ran at', () => {
    const cutoff = cutoffOf(90, new Date('2026-09-22T03:00:00.000Z'));

    expect(cutoff.toISOString()).toBe('2026-06-24T00:00:00.000Z');
    // Running at a different hour of the same day cuts at the same instant, so
    // a day is never half summarised and half raw.
    expect(cutoffOf(90, new Date('2026-09-22T23:59:00.000Z'))).toEqual(cutoff);
  });

  it('takes one chunk at a time, from the oldest sample´s own day and never past the cutoff', () => {
    const cutoff = new Date('2026-09-22T00:00:00.000Z');

    // Three years behind: the pass takes its ninety days and leaves the rest
    // for the passes after it.
    const first = chunkOf(new Date('2023-01-04T17:22:00.000Z'), cutoff, 90);
    expect(first.startsAt.toISOString()).toBe('2023-01-04T00:00:00.000Z');
    expect(first.endsAt.toISOString()).toBe('2023-04-04T00:00:00.000Z');

    // Nearly caught up: the chunk stops at the window rather than reaching into
    // the days that are still somebody's live chart.
    const last = chunkOf(new Date('2026-09-01T09:00:00.000Z'), cutoff, 90);
    expect(last.endsAt).toEqual(cutoff);

    // And a chunk ends where the next begins, so a point is dropped once.
    const second = chunkOf(first.endsAt, cutoff, 90);
    expect(second.startsAt).toEqual(first.endsAt);
  });
});

describe('what a day summarises to', () => {
  it('gathers the store´s figures into one point a day, oldest first', () => {
    const summaries = dailySummariesOf([
      row('2026-06-02T00:00:00Z', 'temp', 21.5),
      row('2026-06-01T00:00:00Z', 'temp', 20),
      row('2026-06-01T00:00:00Z', 'hum', 55),
      row('2026-06-01T00:00:00Z', 'out_light', 0.5),
    ]);

    expect(summaries.map(day => day.at.toISOString())).toEqual(['2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z']);
    expect(summaries[0].fields).toEqual({ temp: 20, hum: 55, out_light: 0.5 });
    expect(summaries[1].fields).toEqual({ temp: 21.5 });
  });

  it('leaves out a field the day has no figure for rather than writing it as a zero', () => {
    const summaries = dailySummariesOf([
      row('2026-06-01T00:00:00Z', 'temp', 20),
      // Influx renders an aggregate of nothing as an empty cell, which the
      // client reads back as null.
      row('2026-06-01T00:00:00Z', 'co2', null),
    ]);

    expect(summaries[0].fields).toEqual({ temp: 20 });
    expect(summaries[0].fields.co2).toBeUndefined();
  });

  it('is no point at all for a day that measured nothing, so an unplugged week is absent rather than seven rows of nothing', () => {
    expect(dailySummariesOf([row('2026-06-01T00:00:00Z', 'temp', null)])).toEqual([]);
    expect(dailySummariesOf([])).toEqual([]);
  });

  it('is stamped at the start of its own day', () => {
    expect(startOfDay(new Date('2026-06-01T23:59:59.999Z')).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('reading the summaries back', () => {
  it('never lets an empty raw window blank a day a summary has a figure for', () => {
    // The two reads meet in one grid: a summary at the start of a day, and the
    // raw window at the same instant, which is empty because the raw points of
    // that day have been dropped.
    const grid = gridOf([row('2026-06-01T00:00:00Z', 'temp', 20), row('2026-06-01T00:00:00Z', 'temp', null)]);

    expect(grid.valuesByField.get('temp')?.get('2026-06-01T00:00:00Z')).toBe(20);
  });

  it('still lets a later reading replace an earlier one at the same instant', () => {
    const grid = gridOf([row('2026-06-01T00:00:00Z', 'temp', 20), row('2026-06-01T00:00:00Z', 'temp', 21)]);

    expect(grid.valuesByField.get('temp')?.get('2026-06-01T00:00:00Z')).toBe(21);
  });
});

describe('a pass of the sweep', () => {
  const NOW = new Date('2026-09-22T03:00:00.000Z');

  /** The store, stood in for: what it was asked, and what it answers. */
  const store = {
    oldest: null as Date | null,
    summaries: [] as DailySummary[],
    written: [] as { deviceId: string; summaries: readonly DailySummary[] }[],
    dropped: [] as { deviceId: string; startsAt: Date; endsAt: Date }[],
    failWriting: null as Error | null,
    order: [] as string[],
  };

  const fakeData = {
    oldestSampleBefore: async (_deviceId: string, _before: Date) => store.oldest,
    dailySummariesOf: async (_deviceId: string, _window: { startsAt: Date; endsAt: Date }) => store.summaries,
    writeDailySummaries: async (deviceId: string, summaries: readonly DailySummary[]) => {
      store.order.push('write');
      if (store.failWriting) throw store.failWriting;
      store.written.push({ deviceId, summaries });
    },
    dropRawSamples: async (deviceId: string, startsAt: Date, endsAt: Date) => {
      store.order.push('drop');
      store.dropped.push({ deviceId, startsAt, endsAt });
    },
  } as unknown as DataService;

  const sweeper = (installDays: number): ClimateRetentionService =>
    new ClimateRetentionService(db.devices, db.spaces, db.users, fakeData, { climateDays: installDays });

  const world = async (retention: { space: number | null; owner: number | null }): Promise<void> => {
    await db.users.create({
      id: OWNER,
      email: 'owner@test.invalid',
      handle: 'owner',
      passwordHash: 'x',
      retention: { climateDays: retention.owner },
    });
    await db.spaces.create({ id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: null, retention: { climateDays: retention.space } });
    await db.devices.create({ id: CONTROLLER, type: 'controller', ownerId: OWNER, spaceId: TENT, configuration: null });
  };

  beforeEach(async () => {
    await db.reset();
    store.oldest = new Date('2026-01-05T08:00:00.000Z');
    store.summaries = [
      { at: new Date('2026-01-05T00:00:00.000Z'), fields: { temp: 20 } },
      { at: new Date('2026-01-06T00:00:00.000Z'), fields: { temp: 21 } },
    ];
    store.written = [];
    store.dropped = [];
    store.failWriting = null;
    store.order = [];
  });

  it('summarises the days past the window and then drops exactly those, in that order', async () => {
    await world({ space: null, owner: 90 });

    const run = await sweeper(0).run(NOW);

    expect(run).toEqual({ reached: 1, devices: 1, days: 2, errors: 0 });
    expect(store.written).toEqual([{ deviceId: CONTROLLER, summaries: store.summaries }]);
    // Ninety days back from the 22nd, and ninety days on from the oldest
    // sample's own day, whichever comes first.
    expect(store.dropped).toEqual([
      { deviceId: CONTROLLER, startsAt: new Date('2026-01-05T00:00:00.000Z'), endsAt: new Date('2026-04-05T00:00:00.000Z') },
    ]);
    // The write comes first. The other way round is how a year of somebody's
    // readings goes missing.
    expect(store.order).toEqual(['write', 'drop']);
  });

  it('takes the tent´s window where it has one', async () => {
    await world({ space: 180, owner: 90 });

    await sweeper(0).run(NOW);

    // A hundred and eighty days back from the 22nd is the 26th of March, which
    // is inside the chunk the oldest sample starts, so the chunk stops there.
    expect(store.dropped[0].endsAt).toEqual(new Date('2026-03-26T00:00:00.000Z'));
  });

  it('does nothing at all where nobody has named a window', async () => {
    await world({ space: null, owner: null });

    const run = await sweeper(0).run(NOW);

    expect(run).toEqual({ reached: 1, devices: 0, days: 0, errors: 0 });
    expect(store.written).toEqual([]);
    expect(store.dropped).toEqual([]);
  });

  it('sweeps on the install´s own window where nobody has overridden it', async () => {
    await world({ space: null, owner: null });

    expect(await sweeper(180).run(NOW)).toMatchObject({ devices: 1, days: 2 });
  });

  it('drops nothing when it has nothing left older than the window, and says it did nothing', async () => {
    await world({ space: null, owner: 90 });
    store.oldest = null;

    expect(await sweeper(0).run(NOW)).toEqual({ reached: 1, devices: 0, days: 0, errors: 0 });
    expect(store.dropped).toEqual([]);
  });

  it('drops nothing for a device whose oldest sample is still inside the window', async () => {
    await world({ space: null, owner: 90 });
    store.oldest = new Date('2026-09-20T00:00:00.000Z');

    expect(await sweeper(0).run(NOW)).toEqual({ reached: 1, devices: 0, days: 0, errors: 0 });
    expect(store.dropped).toEqual([]);
  });

  it('keeps the raw points of a chunk whose summary could not be written, and counts the failure', async () => {
    await world({ space: null, owner: 90 });
    store.failWriting = new Error('the store is full');

    const run = await sweeper(0).run(NOW);

    expect(run).toMatchObject({ days: 0, errors: 1 });
    expect(store.dropped).toEqual([]);
  });

  it('counts a device it could not sweep and goes on to the next', async () => {
    await world({ space: null, owner: 90 });
    await db.devices.create({ id: 'device-second', type: 'fridge', ownerId: OWNER, spaceId: TENT, configuration: null });
    let first = true;
    const failsOnce = {
      ...fakeData,
      oldestSampleBefore: async () => {
        if (first) {
          first = false;
          throw new Error('the store said no');
        }

        return store.oldest;
      },
    } as unknown as DataService;

    const run = await new ClimateRetentionService(db.devices, db.spaces, db.users, failsOnce, { climateDays: 0 }).run(NOW);

    expect(run).toMatchObject({ devices: 1, days: 2, errors: 1 });
  });

  it('is safe to run twice: the second pass finds nothing left and writes nothing', async () => {
    await world({ space: null, owner: 90 });

    await sweeper(0).run(NOW);
    store.oldest = null;
    const again = await sweeper(0).run(NOW);

    expect(again).toEqual({ reached: 1, devices: 0, days: 0, errors: 0 });
    expect(store.written).toHaveLength(1);
    expect(store.dropped).toHaveLength(1);
  });

  /**
   * The pass is capped, so on a fleet larger than the cap the order is the
   * whole question. Ordered by creation, as it was, the same oldest five
   * hundred were read every night and the five hundred and first was swept
   * never - so this asserts its absence from the first pass as much as its
   * presence in the second.
   */
  it('reaches the device past the cap on the next pass, which an unrotated order never did', async () => {
    await world({ space: null, owner: 90 });
    // The world's own controller is the oldest, so the fleet is exactly one
    // device longer than a pass and the newest of them is the one the old
    // order could never reach.
    await db.devices.updateOne({ id: CONTROLLER }, { $set: { createdAt: new Date('2020-01-01T00:00:00.000Z') } });
    await db.devices.create(
      Array.from({ length: DEVICES_PER_PASS }, (_unused, index) => ({
        id: `device-${index}`,
        type: 'controller',
        ownerId: OWNER,
        spaceId: TENT,
        configuration: null,
        createdAt: new Date(NOW.getTime() + index * 1000),
      })),
    );
    const beyond = `device-${DEVICES_PER_PASS - 1}`;

    const first = await sweeper(0).run(NOW);
    expect(first.reached).toBe(DEVICES_PER_PASS);
    expect(store.written.map(write => write.deviceId)).not.toContain(beyond);

    store.written = [];
    // A minute later, so the devices the first pass stamped sort behind the one
    // it never got to - which is the whole of the rotation.
    await sweeper(0).run(new Date(NOW.getTime() + 60_000));

    expect(store.written.map(write => write.deviceId)).toContain(beyond);
  });

  /**
   * Stamping only the devices that were swept is the same starvation one device
   * at a time: a device nobody can sweep - no window at all, or a store that
   * refuses it every night - would stand at the head of the order for ever and
   * take a place in every pass.
   */
  it('stamps every device it reached, the one with no window and the one that threw included', async () => {
    await world({ space: null, owner: null });
    await db.devices.create({ id: 'device-second', type: 'fridge', ownerId: OWNER, spaceId: TENT, configuration: null });
    const refuses = {
      ...fakeData,
      oldestSampleBefore: async () => {
        throw new Error('the store said no');
      },
    } as unknown as DataService;

    // The first device has no window anywhere, the second is refused by the
    // store; neither is swept and both have had their turn.
    await new ClimateRetentionService(db.devices, db.spaces, db.users, refuses, { climateDays: 0 }).run(NOW);
    await new ClimateRetentionService(db.devices, db.spaces, db.users, refuses, { climateDays: 90 }).run(NOW);

    const unstamped = await db.devices.countDocuments({ climateSweptAt: null });
    expect(unstamped).toBe(0);
  });

  /** What the fleet's health card reads: a pass that happened, and how badly it went. */
  it('keeps its last pass where a screen can read it, and says nothing before one has run', async () => {
    await world({ space: null, owner: 90 });
    const sweep = sweeper(0);

    expect(sweep.lastRun).toBeNull();

    await sweep.run(NOW);

    expect(sweep.lastRun).toMatchObject({ reached: 1, devices: 1, days: 2, errors: 0 });
    expect(sweep.lastRun?.ranAt).toBeInstanceOf(Date);
  });
});

describe('when it runs', () => {
  it('waits for the next three in the morning, and never for no time at all', () => {
    const at = (when: string) => untilNextRun(new Date(when));

    // Times are the server's own, which is what the health card's "03:00" is
    // read in, so the assertion is on the hour that comes out rather than on a
    // fixed number of milliseconds.
    expect(new Date(Date.parse('2026-09-22T12:00:00') + at('2026-09-22T12:00:00')).getHours()).toBe(3);
    expect(new Date(Date.parse('2026-09-22T01:00:00') + at('2026-09-22T01:00:00')).getHours()).toBe(3);
    // A pass that finishes a second after three waits for tomorrow rather than
    // starting again straight away.
    expect(at('2026-09-22T03:00:01')).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(at('2026-09-22T03:00:00')).toBeGreaterThan(23 * 60 * 60 * 1000);
  });
});

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

afterEach(() => {
  jest.restoreAllMocks();
});
