import { jest } from '@jest/globals';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { FirmwareRolloutService } from '@modules/v1/fleet/firmware-rollout.service';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Who is handed a build, and when a device that was handed one but has not moved
 * is told again. Neither is reachable over HTTP: the rollout runs on a timer,
 * and what it has to tell apart - a class that is paused, a rollout staged at a
 * percentage, a device that has stopped reporting - is state rather than a
 * route. A pass is therefore run here directly, against a real database.
 */

const CLASS_ID = 'class-fridge';
const STABLE = 'fw-stable';
const BETA = 'fw-beta';

/**
 * The pass and the instruction timer have no caller outside the class; naming
 * the seams the spec drives is more honest than reaching for `any`.
 */
type RolloutInternals = {
  sweep(): Promise<void>;
  instruct(deviceId: string): Promise<void>;
  instructionBackoff: Map<string, { firmwareId: string; nextDelayMs: number }>;
};

let db: V1TestDatabase;
let publisher: { firmware: jest.Mock<(deviceId: string, firmwareId: string) => boolean> };
let rollout: FirmwareRolloutService;
let internals: RolloutInternals;

const aClass = (overrides: Record<string, unknown> = {}) => ({
  id: CLASS_ID,
  createdAt: new Date(),
  name: 'fridge',
  description: 'Fridge Controller',
  concurrentUpdates: 2,
  maxFailures: 3,
  firmwareIds: { stable: STABLE, beta: null, alpha: null },
  rollout: { paused: false, percent: 100 },
  ...overrides,
});

/** A device that reported a minute ago, so the rollout counts it as reachable. */
const aDevice = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: 'fridge',
  classId: CLASS_ID,
  firmware: { channel: 'stable', targetId: null },
  state: { lastSeenAt: new Date(Date.now() - 60_000), firmwareId: 'fw-old' },
  ...overrides,
});

/** The devices the pass told to update, by the build each was given. */
const toldToUpdate = async (): Promise<Record<string, string>> => {
  const devices = await db.devices.find({ 'firmware.targetId': { $ne: null } }).lean<StoredDevice[]>();
  return Object.fromEntries(devices.map(device => [device.id, device.firmware.targetId as string]));
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  publisher = { firmware: jest.fn<(deviceId: string, firmwareId: string) => boolean>().mockReturnValue(true) };
  rollout = new FirmwareRolloutService(
    db.devices,
    db.deviceClasses,
    db.firmwares,
    publisher as unknown as DevicePublisherService,
    new EntryWriterService(db.entries),
  );
  internals = rollout as unknown as RolloutInternals;
});

describe('which devices a pass picks up', () => {
  it('hands the stable build to a device that follows the stable channel', async () => {
    await db.deviceClasses.create(aClass());
    await db.devices.create(aDevice('fridge-1'));

    await internals.sweep();

    expect(await toldToUpdate()).toEqual({ 'fridge-1': STABLE });
  });

  it('leaves a device on the manual channel where it is', async () => {
    await db.deviceClasses.create(aClass());
    await db.devices.create(aDevice('fridge-manual', { firmware: { channel: 'manual', targetId: null } }));

    await internals.sweep();

    expect(await toldToUpdate()).toEqual({});
  });

  it('leaves a device that has not reported for a while alone', async () => {
    await db.deviceClasses.create(aClass());
    await db.devices.create(aDevice('fridge-quiet', { state: { lastSeenAt: new Date(Date.now() - 3600_000), firmwareId: 'fw-old' } }));

    await internals.sweep();

    expect(await toldToUpdate()).toEqual({});
  });

  it('does not offer a pre-release build to a device that never asked for one', async () => {
    await db.deviceClasses.create(aClass({ firmwareIds: { stable: STABLE, beta: BETA, alpha: null } }));
    await db.devices.create(aDevice('fridge-stable'));
    await db.devices.create(aDevice('fridge-beta', { firmware: { channel: 'beta', targetId: null } }));

    await internals.sweep();

    expect(await toldToUpdate()).toEqual({ 'fridge-stable': STABLE, 'fridge-beta': BETA });
  });

  it('stops at the number of updates the class allows at once', async () => {
    await db.deviceClasses.create(aClass({ concurrentUpdates: 2 }));
    for (const id of ['fridge-1', 'fridge-2', 'fridge-3']) await db.devices.create(aDevice(id));

    await internals.sweep();

    expect(Object.keys(await toldToUpdate())).toHaveLength(2);
  });

  it('counts the updates already running against that number', async () => {
    await db.deviceClasses.create(aClass({ concurrentUpdates: 2 }));
    await db.devices.create(
      aDevice('fridge-updating', {
        firmware: { channel: 'stable', targetId: STABLE },
        state: { lastSeenAt: new Date(), firmwareId: 'fw-old', updateStartedAt: new Date() },
      }),
    );
    await db.devices.create(aDevice('fridge-waiting-1'));
    await db.devices.create(aDevice('fridge-waiting-2'));

    await internals.sweep();

    // One slot was taken, so exactly one of the two waiting devices got the other.
    expect(Object.keys(await toldToUpdate())).toHaveLength(2);
  });

  it('stops handing out a build that too many devices have failed to install', async () => {
    await db.deviceClasses.create(aClass({ maxFailures: 1 }));
    await db.devices.create(
      aDevice('fridge-failed', {
        firmware: { channel: 'stable', targetId: STABLE },
        // Told long enough ago that the update has given up.
        state: { lastSeenAt: new Date(), firmwareId: 'fw-old', updateStartedAt: new Date(Date.now() - 3600_000) },
      }),
    );
    await db.devices.create(aDevice('fridge-waiting'));

    await internals.sweep();

    expect(await toldToUpdate()).toEqual({ 'fridge-failed': STABLE });
  });

  it('hands out nothing at all while the class is paused', async () => {
    await db.deviceClasses.create(aClass({ rollout: { paused: true, percent: 100 } }));
    await db.devices.create(aDevice('fridge-1'));

    await internals.sweep();

    expect(await toldToUpdate()).toEqual({});
  });

  it('reaches only part of a class that is being staged, and the same part every pass', async () => {
    await db.deviceClasses.create(aClass({ concurrentUpdates: 100, rollout: { paused: false, percent: 50 } }));
    for (let n = 0; n < 40; n++) await db.devices.create(aDevice(`fridge-${n}`));

    await internals.sweep();
    const first = Object.keys(await toldToUpdate());

    // A share re-drawn every pass would hand the build to the whole class
    // within the minute, which is the opposite of staging it.
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(40);

    await db.devices.updateMany({}, { $set: { 'firmware.targetId': null } });
    await internals.sweep();

    expect(Object.keys(await toldToUpdate()).sort()).toEqual(first.sort());
  });
});

describe('telling a device that has not moved', () => {
  beforeEach(async () => {
    await db.deviceClasses.create(aClass());
    await db.devices.create(aDevice('fridge-1', { firmware: { channel: 'stable', targetId: STABLE } }));
  });

  it('publishes the build the device is meant to be running', async () => {
    await internals.instruct('fridge-1');

    expect(publisher.firmware).toHaveBeenCalledWith('fridge-1', STABLE);
  });

  it('waits twice as long before each repeat, so a device that cannot install it is not asked forever', async () => {
    await internals.instruct('fridge-1');
    const first = internals.instructionBackoff.get('fridge-1')?.nextDelayMs;

    await internals.instruct('fridge-1');
    const second = internals.instructionBackoff.get('fridge-1')?.nextDelayMs;

    expect(second).toBe((first as number) * 2);
  });

  it('says nothing to a device that is already running the build, and forgets the wait it had earned', async () => {
    await internals.instruct('fridge-1');
    await db.devices.updateOne({ id: 'fridge-1' }, { $set: { 'state.firmwareId': STABLE } });
    publisher.firmware.mockClear();

    await internals.instruct('fridge-1');

    expect(publisher.firmware).not.toHaveBeenCalled();
    expect(internals.instructionBackoff.has('fridge-1')).toBe(false);
  });

  it('starts the wait over when the device is pointed at a different build', async () => {
    await internals.instruct('fridge-1');
    await internals.instruct('fridge-1');
    const grown = internals.instructionBackoff.get('fridge-1')?.nextDelayMs as number;

    await db.devices.updateOne({ id: 'fridge-1' }, { $set: { 'firmware.targetId': BETA } });
    await internals.instruct('fridge-1');

    expect(internals.instructionBackoff.get('fridge-1')?.nextDelayMs).toBeLessThan(grown);
  });

  it('says nothing about a device that has been removed since it was queued', async () => {
    await db.devices.deleteOne({ id: 'fridge-1' });

    await internals.instruct('fridge-1');

    expect(publisher.firmware).not.toHaveBeenCalled();
  });
});

describe('when a device comes back running what it was told to install', () => {
  beforeEach(async () => {
    await db.deviceClasses.create(aClass());
    await db.firmwares.create({ id: STABLE, createdAt: new Date(), classId: CLASS_ID, name: 'fridge', version: '2.1.0', wasStable: true });
    await db.devices.create(
      aDevice('fridge-1', {
        spaceId: 'space-1',
        firmware: { channel: 'stable', targetId: STABLE },
        state: { lastSeenAt: new Date(), firmwareId: 'fw-old', updateStartedAt: new Date(Date.now() - 120_000) },
      }),
    );
  });

  it('ends the update and writes what it came back with into the diary', async () => {
    await rollout.onFirmwareReported('fridge-1', STABLE);

    const device = await db.devices.findOne({ id: 'fridge-1' }).lean<StoredDevice>();
    expect(device?.state.updateEndedAt).toBeInstanceOf(Date);

    const [entry] = await db.entries.find({ deviceId: 'fridge-1' }).lean();
    // The version rather than the uuid, where the build is still recorded - and
    // the id itself where it is not, which is what the old one is here.
    expect(entry.message).toEqual({ key: 'message-firmware-update-complete-with-ids', params: ['fw-old -> 2.1.0'] });
    expect(entry.spaceId).toBe('space-1');
  });

  it('says nothing about a build the device was never told to install', async () => {
    // A device flashed over USB reports something of its own; that it is now
    // running it is recorded, but no update of this cloud's finished.
    await rollout.onFirmwareReported('fridge-1', 'fw-from-a-cable');

    const device = await db.devices.findOne({ id: 'fridge-1' }).lean<StoredDevice>();
    expect(device?.state.updateEndedAt).toBeNull();
    expect(await db.entries.countDocuments({ deviceId: 'fridge-1' })).toBe(0);
  });
});
