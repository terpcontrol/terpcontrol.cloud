import { AccessContext } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { AlertsController } from '@modules/alarm/alarm.controller';
import { AlertInboxService } from '@modules/alarm/alert-inbox.service';
import { CamerasService } from '@modules/v1/camera/cameras.service';
import { EntitlementService } from '@modules/v1/camera/entitlement.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { session } from './support/callers';
import { standingIn } from './support/placed';
import { accessOn, devicesOn, spacesOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';

/**
 * An open alert stands where its device stands.
 *
 * The inbox, Start and Verlauf read an alert by the place it names, so the one
 * writer of a device's place moves its open alerts along, and whoever sees the
 * place the device stands in now sees the alert - with what a manager may do
 * to it - while whoever only saw the place it left sees nothing of the device
 * any more. An alert that is over is the history of the place it happened in
 * and stays there, under that place's name, also once the place has ended.
 *
 * The world is one account with two tents, a guest who manages the old one
 * and a guest who manages the new one - both managers, so that what either is
 * refused is refused for the place and not for the role.
 */

const OWNER = 'user-owner';
const OF_THE_OLD = 'user-of-the-old-tent';
const OF_THE_NEW = 'user-of-the-new-tent';

const OLD = 'space-old';
const NEW = 'space-new';
const DEVICE = 'device-1';
const OPEN = 'alert-open';
const OVER = 'alert-over';

const db = useV1TestDatabase();
let devices: DevicesService;
let spaces: SpacesService;
let cameras: CamerasService;
let alerts: AlertsController;

const world = async (): Promise<void> => {
  await db.spaces.create([
    { id: OLD, ownerId: OWNER, kind: 'tent', name: 'Old tent', roomId: null },
    { id: NEW, ownerId: OWNER, kind: 'tent', name: 'New tent', roomId: null },
  ]);
  await db.memberships.create([
    { id: 'membership-old', spaceId: OLD, userId: OF_THE_OLD, role: 'can_manage' },
    { id: 'membership-new', spaceId: NEW, userId: OF_THE_NEW, role: 'can_manage' },
  ]);
  await db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, ...standingIn(OLD) });
  await db.alerts.create([
    { id: OPEN, deviceId: DEVICE, spaceId: OLD, kind: 'offline', severity: 'critical', startedAt: new Date('2026-06-02T00:00:00.000Z') },
    {
      id: OVER,
      deviceId: DEVICE,
      spaceId: OLD,
      kind: 'threshold',
      severity: 'warning',
      startedAt: new Date('2026-06-01T00:00:00.000Z'),
      resolvedAt: new Date('2026-06-01T01:00:00.000Z'),
    },
  ]);
};

beforeEach(async () => {
  await db.reset();
  const access = accessOn(db);
  devices = devicesOn(db, access);
  spaces = spacesOn(db, access, devices);
  cameras = new CamerasService(db.cameras, db.devices, db.memberships, new EntitlementService(null as never), db.users, db.alerts);
  alerts = new AlertsController(new AlertInboxService(db.alerts, db.spaces, db.memberships, db.devices, db.cameras), access);
  await world();
});

/** What a caller's inbox holds: each alert with the place it names and what that place is called. */
const inboxOf = async (who: string, open: boolean, deviceId?: string) =>
  (await alerts.list({ open: open ? 'true' : 'false', deviceId }, session(who))).items.map(alert => [alert.id, alert.spaceId, alert.spaceName]);

const refusal = async (action: () => Promise<unknown>): Promise<string> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof ProblemException) return `${error.problem.status} ${error.problem.code}`;
    throw error;
  }
  return 'allowed';
};

const as = (who: string): AccessContext => session(who);

describe('a move', () => {
  beforeEach(async () => {
    await devices.update(DEVICE, { spaceId: NEW });
  });

  it('shows the owner the open alert in the new place and the one that is over where it happened', async () => {
    expect(await inboxOf(OWNER, true)).toEqual([[OPEN, NEW, 'New tent']]);
    expect(await inboxOf(OWNER, false)).toEqual([[OVER, OLD, 'Old tent']]);
    expect(await alerts.read(OPEN, as(OWNER))).toMatchObject({ spaceId: NEW, spaceName: 'New tent' });
  });

  it('gives a manager of the new place the open alert, with what a manager may do, and nothing of the place it left', async () => {
    expect(await inboxOf(OF_THE_NEW, true)).toEqual([[OPEN, NEW, 'New tent']]);
    expect(await inboxOf(OF_THE_NEW, false)).toEqual([]);
    expect(await alerts.read(OPEN, as(OF_THE_NEW))).toMatchObject({ id: OPEN });
    // Refused as an open alert is to anybody who manages it, not as a stranger's.
    expect(await refusal(() => alerts.remove(OPEN, as(OF_THE_NEW)))).toBe('409 alert_open');
    // The device's past in a place they do not see is not theirs, by the device either.
    expect(await inboxOf(OF_THE_NEW, false, DEVICE)).toEqual([]);
    expect(await inboxOf(OF_THE_NEW, true, DEVICE)).toEqual([[OPEN, NEW, 'New tent']]);
    expect(await refusal(() => alerts.read(OVER, as(OF_THE_NEW)))).toBe('404 space_not_found');
  });

  it('shows a guest of the old place nothing of the device any more, and keeps them that place`s past', async () => {
    expect(await inboxOf(OF_THE_OLD, true)).toEqual([]);
    expect(await refusal(() => alerts.read(OPEN, as(OF_THE_OLD)))).toBe('404 device_not_found');
    expect(await inboxOf(OF_THE_OLD, false)).toEqual([[OVER, OLD, 'Old tent']]);
    expect(await alerts.read(OVER, as(OF_THE_OLD))).toMatchObject({ id: OVER, spaceName: 'Old tent' });
    await alerts.remove(OVER, as(OF_THE_OLD));
    expect(await inboxOf(OWNER, false)).toEqual([]);
  });

  it('moves the alert back with a move taken back', async () => {
    await devices.update(DEVICE, { spaceId: OLD });

    expect(await inboxOf(OWNER, true)).toEqual([[OPEN, OLD, 'Old tent']]);
    expect(await inboxOf(OF_THE_OLD, true)).toEqual([[OPEN, OLD, 'Old tent']]);
    expect(await inboxOf(OF_THE_NEW, true)).toEqual([]);
  });
});

describe('a place removed after its device moved out', () => {
  beforeEach(async () => {
    await devices.update(DEVICE, { spaceId: NEW });
    await spaces.remove(OLD);
  });

  it('keeps the open alert in the new place and the past one under the ended place`s name, for the owner', async () => {
    expect(await inboxOf(OWNER, true)).toEqual([[OPEN, NEW, 'New tent']]);
    expect(await inboxOf(OWNER, false)).toEqual([[OVER, OLD, 'Old tent']]);
    await alerts.remove(OVER, as(OWNER));
  });

  it('leaves the manager of the new place the open alert alone', async () => {
    expect(await inboxOf(OF_THE_NEW, true)).toEqual([[OPEN, NEW, 'New tent']]);
    expect(await inboxOf(OF_THE_NEW, false)).toEqual([]);
  });

  it('leaves the guest of the ended place nothing', async () => {
    expect(await inboxOf(OF_THE_OLD, true)).toEqual([]);
    expect(await inboxOf(OF_THE_OLD, false)).toEqual([]);
    expect(await refusal(() => alerts.read(OVER, as(OF_THE_OLD)))).toBe('404 space_not_found');
    expect(await refusal(() => alerts.read(OPEN, as(OF_THE_OLD)))).toBe('404 device_not_found');
  });
});

describe('a device given up', () => {
  it.each([
    ['its owner', OWNER],
    ['a manager of the place it had moved to', OF_THE_NEW],
    ['a guest of the place it stood in before', OF_THE_OLD],
  ])('leaves %s no alert of it, open or over', async (_who, userId) => {
    await devices.update(DEVICE, { spaceId: NEW });
    await devices.releaseClaim(DEVICE);

    expect(await inboxOf(userId, true)).toEqual([]);
    expect(await inboxOf(userId, false)).toEqual([]);
    expect(await refusal(() => alerts.read(OPEN, as(userId)))).toBe('404 alert_not_found');
  });
});

describe('a device taken out of every place', () => {
  it('leaves its open alert naming no place, in its owner`s inbox alone', async () => {
    await devices.update(DEVICE, { spaceId: null });

    expect(await inboxOf(OWNER, true)).toEqual([[OPEN, null, null]]);
    expect(await inboxOf(OF_THE_OLD, true)).toEqual([]);
    expect(await inboxOf(OF_THE_NEW, true)).toEqual([]);
    expect(await refusal(() => alerts.read(OPEN, as(OF_THE_OLD)))).toBe('404 device_not_found');
  });
});

describe('a camera moved by itself', () => {
  it('takes its open alert along and leaves the one that is over', async () => {
    await db.cameras.create({ id: 'camera-1', ownerId: OWNER, kind: 'rtsp', name: 'Cam', spaceId: OLD, deviceId: null });
    await db.alerts.create([
      {
        id: 'cam-open',
        cameraId: 'camera-1',
        spaceId: OLD,
        kind: 'camera_stale',
        severity: 'warning',
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
      },
      {
        id: 'cam-over',
        cameraId: 'camera-1',
        spaceId: OLD,
        kind: 'camera_stale',
        severity: 'warning',
        startedAt: new Date('2026-05-03T00:00:00.000Z'),
        resolvedAt: new Date('2026-05-04T00:00:00.000Z'),
      },
    ]);

    await cameras.update('camera-1', { spaceId: NEW });

    expect((await db.alerts.findOne({ id: 'cam-open' }).lean())?.spaceId).toBe(NEW);
    expect((await db.alerts.findOne({ id: 'cam-over' }).lean())?.spaceId).toBe(OLD);
  });
});
