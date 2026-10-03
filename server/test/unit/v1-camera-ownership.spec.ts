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
  hardware = new HardwareReportService(db.devices, db.cameras);
  devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access, null, hardware);

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

describe('the password the cloud signs in to the camera with', () => {
  const secretOn = async (deviceId: string): Promise<string | null | undefined> =>
    (await db.cameras.findOne({ deviceId, removedAt: null }).select('+secret').lean())?.secret;

  it('is the one pairing secured the camera with, although it is reported before the camera´s id', async () => {
    await claim(ALICE, DEVICE);

    // The order the firmware reports a pairing in: secured, then paired, then its P2P id.
    await reports(DEVICE, 'webcam_pwd=freshly-set');
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    await reports(DEVICE, 'webcam_uid=UID-OF-THE-CAM');

    expect(await secretOn(DEVICE)).toBe('freshly-set');
  });

  it('is the new one when the same camera is paired again, not the one its buried row held', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    await reports(DEVICE, 'webcam_pwd=the-old-one');

    // Unpaired at the device, reset, and paired again: a camera reset is on the
    // default password until it is secured afresh.
    await reports(DEVICE, 'webcam_did=none');
    await reports(DEVICE, 'webcam_pwd=the-new-one');
    await reports(DEVICE, `webcam_did=${PAIRED}`);

    expect(await secretOn(DEVICE)).toBe('the-new-one');
    expect(await db.cameras.countDocuments()).toBe(1);
  });

  it('is the default for a camera that could not be secured, rather than the previous camera´s', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    await reports(DEVICE, 'webcam_pwd=the-first-cams');

    // Another camera paired in its place, and securing it failed.
    await reports(DEVICE, 'webcam_pwd=');
    await reports(DEVICE, 'webcam_did=TERPCAM02');

    expect(await secretOn(DEVICE)).toBeNull();
  });

  it('stays as it is when a restart reports the same camera before its password', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, 'webcam_pwd=kept');
    await reports(DEVICE, `webcam_did=${PAIRED}`);

    await reports(DEVICE, `webcam_did=${PAIRED}`);

    expect(await secretOn(DEVICE)).toBe('kept');
  });

  it('reaches a camera paired before the device was claimed, from the claim on', async () => {
    // Paired while the device was nobody's: there was no one to make a camera for.
    await reports(DEVICE, 'webcam_pwd=before-the-claim');
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    await reports(DEVICE, 'webcam_uid=UID-OF-THE-CAM');
    expect(await db.cameras.countDocuments()).toBe(0);

    const claimed = await claim(ALICE, DEVICE);

    const camera = await db.cameras.findOne({ deviceId: DEVICE, removedAt: null }).select('+secret').lean();
    expect(camera).toMatchObject({ ownerId: ALICE, did: PAIRED, uid: 'UID-OF-THE-CAM', secret: 'before-the-claim', spaceId: claimed.device.spaceId });
  });

  it('is never served with the device', async () => {
    await claim(ALICE, DEVICE);
    await reports(DEVICE, 'webcam_pwd=hunter2');

    expect(JSON.stringify(devices.serialise(await devices.require(DEVICE)))).not.toContain('hunter2');
    expect(JSON.stringify(await devices.require(DEVICE))).not.toContain('hunter2');
  });
});

describe('what the camera pipeline is told', () => {
  it('hears of every report that may let the cloud back in to a camera that refused it', async () => {
    const told: string[] = [];
    hardware = new HardwareReportService(db.devices, db.cameras, { cameraReported: deviceId => told.push(deviceId) });
    await claim(ALICE, DEVICE);

    // A different camera, the password it was secured with, the P2P id read off it.
    await reports(DEVICE, `webcam_did=${PAIRED}`);
    await reports(DEVICE, 'webcam_pwd=hunter2');
    await reports(DEVICE, 'webcam_uid=UID-OF-THE-CAM');
    expect(told).toEqual([DEVICE, DEVICE, DEVICE]);

    // Where it is on the LAN, and anything else, changes nothing about whether it lets us in.
    await reports(DEVICE, 'webcam_ip=10.0.0.9');
    await reports(DEVICE, 'co2=on');
    expect(told).toHaveLength(3);
  });
});
