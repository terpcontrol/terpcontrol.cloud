import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Whose camera a controller's report makes.
 *
 * A camera belongs to whoever owns the device that reports it, and the moment
 * that is worth holding is the one where the owner changes: hardware is sold,
 * given away and taken back, and the row a report finds may be a stranger's or
 * one this account has already buried. Neither half can be asked about it alone
 * - the claim is `/v1` and the report is the device protocol - so the two are
 * driven together here, against a real database, because every one of these
 * answers is a query's.
 */

const DEVICE = 'sim-controller-handed-on';
const SECOND_DEVICE = 'sim-controller-of-their-own';
const PAIRED = 'TERPCAM01';
const ALICE = 'user-alice';
const BOB = 'user-bob';

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });

let db: V1TestDatabase;
let devices: DevicesService;
let hardware: HardwareReportService;
let codes: number;

/** A claim spends its code, so every claim in a spec needs one of its own. */
const claim = async (userId: string, deviceId: string, name?: string) => {
  const code = `CODE${++codes}`;
  await db.claimCodes.create({ id: `claim-${codes}`, code, deviceId });

  return devices.claim(session(userId), { code, ...(name ? { name } : {}) });
};

const reports = async (deviceId: string, line: string): Promise<void> => {
  await hardware.report(await devices.require(deviceId), line);
};

const cameraOn = (deviceId: string) => db.cameras.findOne({ deviceId, removedAt: null }).lean();

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  codes = 0;

  const access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
  hardware = new HardwareReportService(db.devices, db.cameras);

  await db.devices.create([
    { id: DEVICE, type: 'controller', ownerId: null },
    { id: SECOND_DEVICE, type: 'controller', ownerId: null },
  ]);
});

describe('the camera a controller reports', () => {
  it('stays exactly where it is while the same account keeps reporting it', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    const first = await cameraOn(DEVICE);

    await reports(DEVICE, `webcam_did=${PAIRED}`);

    expect(await db.cameras.countDocuments()).toBe(1);
    expect(await cameraOn(DEVICE)).toEqual(first);
  });

  it('gives the same person their camera back, with the year it already had, when they claim the device again', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    const granted = (await cameraOn(DEVICE))?.entitlement.validUntil;

    await devices.releaseClaim(DEVICE);
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);

    const camera = await cameraOn(DEVICE);
    expect(camera?.ownerId).toBe(ALICE);
    // Not a second year, and not a second row: the pictures keep their camera.
    expect(camera?.entitlement.validUntil).toEqual(granted);
    expect(await db.cameras.countDocuments()).toBe(1);
  });

  it('gives the next owner a camera of their own, carrying nothing of the last owner´s', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    const hers = await cameraOn(DEVICE);
    await db.cameras.updateOne(
      { id: hers?.id },
      {
        $set: {
          name: 'Alice´s canopy',
          looksAt: 'canopy',
          plantIds: ['plant-of-alice'],
          stillIntervalSeconds: 300,
          entitlement: { validUntil: new Date('2020-01-01T00:00:00.000Z'), grant: 'included' },
        },
      },
    );
    await db.media.create({ id: 'still-of-alice', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: hers?.id, capturedAt: new Date() });

    await devices.releaseClaim(DEVICE);
    const claimed = await claim(BOB, DEVICE, 'Bob´s tent');
    await reports(DEVICE, `webcam_did=${PAIRED}`);

    const camera = await cameraOn(DEVICE);
    expect(camera?.ownerId).toBe(BOB);
    expect(camera?.id).not.toBe(hers?.id);
    expect(camera?.spaceId).toBe(claimed.device.spaceId);
    expect(camera).toMatchObject({ name: 'Bob´s tent', looksAt: null, plantIds: [], stillIntervalSeconds: 30, did: PAIRED });
    expect(camera?.entitlement.grant).toBe('included');
    expect(camera?.entitlement.validUntil?.getTime()).toBeGreaterThan(Date.now());

    // Hers is still hers, still dead, and still what her pictures point at.
    const buried = await db.cameras.findOne({ id: hers?.id }).lean();
    expect(buried?.ownerId).toBe(ALICE);
    expect(buried?.removedAt).not.toBeNull();
    expect(buried?.deviceId).toBeNull();
    expect((await db.media.findOne({ id: 'still-of-alice' }).lean())?.cameraId).toBe(hers?.id);
    expect(await db.media.countDocuments({ cameraId: camera?.id })).toBe(0);
  });

  it('never takes over a camera that is live on somebody else´s device', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    const hers = await cameraOn(DEVICE);

    await claim(BOB, SECOND_DEVICE);
    await reports(SECOND_DEVICE, `webcam_did=${PAIRED}`);

    // Alice gave nothing up, so nothing of hers moved - not the row, not a field.
    expect(await cameraOn(DEVICE)).toEqual(hers);

    const theirs = await cameraOn(SECOND_DEVICE);
    expect(theirs?.ownerId).toBe(BOB);
    expect(theirs?.id).not.toBe(hers?.id);
  });

  it('takes the way to the camera off the row a claim leaves behind', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    await reports(DEVICE, 'webcam_uid=UID-OF-THE-CAM');
    await reports(DEVICE, 'webcam_ip=10.0.0.9');
    await reports(DEVICE, 'webcam_pwd=hunter2');

    await devices.releaseClaim(DEVICE);

    const buried = await db.cameras.findOne({ ownerId: ALICE }).select('+secret').lean();
    expect(buried).toMatchObject({ deviceId: null, uid: null, ip: null, secret: null });
    // The pairing id stays: it opens nothing on its own and it is what gives the
    // same person their camera back when they claim the device again.
    expect(buried?.did).toBe(PAIRED);
  });
});
