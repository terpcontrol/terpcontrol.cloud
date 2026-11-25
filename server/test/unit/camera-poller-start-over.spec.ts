import { jest } from '@jest/globals';
import { CameraPollerService } from '@modules/v1/camera/camera-poller.service';
import { CameraReportsService } from '@modules/v1/camera/camera-reports.service';
import { CameraNotFoundYetError } from '@modules/v1/camera/capture.service';

/**
 * A Terp Cam is read every interval from the moment its device reports it.
 *
 * Pairing a camera that serves its own stream makes its row at once, but the
 * device reports where on its network the camera answers only once it has found
 * it there. The reads in between used to fail as any other, doubling the wait
 * up to two hours, and the address the device then reported did not undo that:
 * a camera paired and found was left unread for as long as the search had
 * taken, and longer.
 */

const DEVICE = 'terpcam-device';
const INTERVAL_MS = 30_000;
const STILL = Buffer.from('2304x1296, off the stream');

const TERPCAM = {
  id: 'camera-terpcam',
  kind: 'terpcam_controller',
  deviceId: DEVICE,
  spaceId: 'space-1',
  did: 'AAC4004902SCAQ',
  url: null,
  transport: null,
  tunnel: false,
  stillIntervalSeconds: INTERVAL_MS / 1000,
  nightOff: false,
  maintenanceOff: true,
  logErrors: true,
};

type Internals = { pass(): Promise<void>; onApplicationShutdown(): void };

let now: number;
let readStill: jest.Mock<() => Promise<Buffer>>;
let diary: jest.Mock<(entry: unknown) => Promise<void>>;
let poller: CameraPollerService;

const pass = () => (poller as unknown as Internals).pass();
const later = (ms: number) => (now += ms);
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  // Starts at the real time: whether the device is online is judged by `new Date()`, which the spy leaves alone.
  now = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  readStill = jest.fn<() => Promise<Buffer>>().mockResolvedValue(STILL);
  diary = jest.fn<(entry: unknown) => Promise<void>>().mockResolvedValue(undefined);

  const devices = {
    find: () => ({ lean: async () => [{ id: DEVICE, configuration: {}, state: { lastSeenAt: new Date(), maintenanceUntil: null } }] }),
  };
  const cameras = {
    capturable: async () => [TERPCAM],
    withSecret: async () => ({ ...TERPCAM, secret: null, ip: null }),
    noteCapture: async () => undefined,
  };

  poller = new CameraPollerService(
    devices as never,
    cameras as never,
    { readStill } as never,
    { storeBytes: async () => ({ id: 'media-1' }) } as never,
    { write: diary } as never,
    null,
  );
});

afterEach(() => {
  (poller as unknown as Internals).onApplicationShutdown();
  jest.restoreAllMocks();
});

/** Three reads that fail as a camera that is not there fails, each when it is due: the wait is then eight intervals. */
async function failThreeTimes(): Promise<void> {
  readStill.mockRejectedValue(new Error('Connection refused'));
  for (const wait of [0, 2 * INTERVAL_MS, 4 * INTERVAL_MS]) {
    later(wait);
    await pass();
  }
  expect(readStill).toHaveBeenCalledTimes(3);
  readStill.mockResolvedValue(STILL);
}

describe('a Terp Cam its device has not found on its network yet', () => {
  it('is asked after again on its interval, not after a backoff', async () => {
    readStill.mockRejectedValue(new CameraNotFoundYetError());
    await pass();
    later(INTERVAL_MS);
    await pass();
    later(INTERVAL_MS);
    await pass();

    expect(readStill).toHaveBeenCalledTimes(3);
  });

  it('is not written down as a failed read: the device says it is looking', async () => {
    readStill.mockRejectedValue(new CameraNotFoundYetError());
    await pass();

    expect(diary).not.toHaveBeenCalled();
  });

  it('where an ordinary failure is backed off', async () => {
    readStill.mockRejectedValue(new Error('Connection refused'));
    await pass();
    later(INTERVAL_MS);
    await pass();

    expect(readStill).toHaveBeenCalledTimes(1);
  });
});

describe('a Terp Cam its device reports', () => {
  it('is read at once, whatever its failures before had grown the wait to', async () => {
    await failThreeTimes();
    later(INTERVAL_MS);
    await pass();
    expect(readStill).toHaveBeenCalledTimes(3);

    poller.cameraReported(TERPCAM.id);
    await pass();
    expect(readStill).toHaveBeenCalledTimes(4);
  });

  it('is read every interval from then on', async () => {
    await failThreeTimes();
    poller.cameraReported(TERPCAM.id);
    await pass();
    later(INTERVAL_MS);
    await pass();
    later(INTERVAL_MS);
    await pass();

    expect(readStill).toHaveBeenCalledTimes(6);
  });

  it('does not pay for a read that was under way when the report came', async () => {
    let fail!: (error: Error) => void;
    readStill.mockReturnValueOnce(new Promise<Buffer>((_, reject) => (fail = reject)));
    const polling = pass();
    await settle();

    poller.cameraReported(TERPCAM.id);
    fail(new Error('the device has no route to the camera'));
    await polling;
    later(INTERVAL_MS);
    await pass();

    expect(readStill).toHaveBeenCalledTimes(2);
  });
});

describe('a report about a camera', () => {
  it("starts the device's Terp Cam over, and lets the relay try a camera that refused it", async () => {
    const direct = { cameraReported: jest.fn() };
    const startOver = jest.spyOn(poller, 'cameraReported');
    const cameras = { controllerCameraOf: async (deviceId: string) => (deviceId === DEVICE ? TERPCAM : null) };
    const reports = new CameraReportsService(cameras as never, poller, direct as never);

    reports.cameraReported(DEVICE);
    await settle();

    expect(direct.cameraReported).toHaveBeenCalledWith(DEVICE);
    expect(startOver).toHaveBeenCalledWith(TERPCAM.id);
  });

  it('leaves the poller alone for a device without a camera', async () => {
    const startOver = jest.spyOn(poller, 'cameraReported');
    const reports = new CameraReportsService({ controllerCameraOf: async () => null } as never, poller, { cameraReported: () => undefined } as never);

    reports.cameraReported('device-without-a-camera');
    await settle();

    expect(startOver).not.toHaveBeenCalled();
  });
});
