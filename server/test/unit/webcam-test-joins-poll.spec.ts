import { jest } from '@jest/globals';
import { CameraPollerService } from '@modules/v1/camera/camera-poller.service';
import { CamerasController } from '@modules/v1/camera/cameras.controller';

/**
 * The test-image button while the poller is reading the same camera. A Terp
 * Cam's device bridges one relay at a time, so a second capture beside the
 * poll's would be turned down. The button waits for the poll's picture instead,
 * and the poller leaves a camera alone while the button is reading it.
 */

const DEVICE = 'terpcam-device';
const STILL = Buffer.from('2304x1296, off the video stream');

type Camera = {
  id: string;
  kind: string;
  deviceId: string;
  spaceId: string;
  did: string | null;
  url: string | null;
  transport: string | null;
  tunnel: boolean;
  stillIntervalSeconds: number;
  nightOff: boolean;
  maintenanceOff: boolean;
  logErrors: boolean;
};

const TERPCAM: Camera = {
  id: 'camera-terpcam',
  kind: 'terpcam_controller',
  deviceId: DEVICE,
  spaceId: 'space-1',
  did: 'AAC4004902SCAQ',
  url: null,
  transport: null,
  tunnel: false,
  stillIntervalSeconds: 30,
  nightOff: false,
  maintenanceOff: false,
  logErrors: false,
};
const STREAM: Camera = { ...TERPCAM, id: 'camera-stream', kind: 'rtsp', did: null, url: 'rtsp://192.168.1.20/stream1', tunnel: true };

type Internals = { pass(): Promise<void>; onApplicationShutdown(): void };

let lastSeenAt: Date;
let polled: Camera[];
let readStill: jest.Mock<(camera: Camera) => Promise<Buffer>>;
let storeBytes: jest.Mock<(draft: unknown, data: Buffer) => Promise<{ id: string }>>;
let poller: CameraPollerService;
let controller: CamerasController;

/** A capture that finishes when the spec says so. */
function held() {
  let resolve!: (still: Buffer) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Buffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the poller get as far as its capture. */
const settle = () => new Promise(resolve => setImmediate(resolve));

/** One pass of the poller, which is the seam the spec drives besides the button. */
const pass = () => (poller as unknown as Internals).pass();

beforeEach(() => {
  lastSeenAt = new Date();
  polled = [TERPCAM];
  readStill = jest.fn<(camera: Camera) => Promise<Buffer>>().mockResolvedValue(STILL);
  let stored = 0;
  storeBytes = jest.fn<(draft: unknown, data: Buffer) => Promise<{ id: string }>>().mockImplementation(async () => ({ id: `media-${++stored}` }));

  const devices = {
    find: () => ({ lean: async () => [{ id: DEVICE, configuration: {}, state: { lastSeenAt, maintenanceUntil: null } }] }),
    findOne: () => ({ lean: async () => ({ id: DEVICE, state: { lastSeenAt, maintenanceUntil: null } }) }),
  };
  const cameras = {
    capturable: async () => polled,
    withSecret: async (id: string) => {
      const camera = [TERPCAM, STREAM].find(candidate => candidate.id === id);
      return camera ? { ...camera, secret: null } : null;
    },
    noteCapture: async () => undefined,
  };
  const entries = { write: async () => undefined };

  poller = new CameraPollerService(devices as never, cameras as never, { readStill } as never, { storeBytes } as never, entries as never, null);
  controller = new CamerasController(cameras as never, {} as never, poller, {} as never, {} as never, {} as never);
});

afterEach(() => (poller as unknown as Internals).onApplicationShutdown());

it("answers with the poll's picture instead of capturing beside it", async () => {
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);

  const polling = pass();
  await settle();
  const button = controller.testCapture(TERPCAM.id);
  capture.resolve(STILL);

  await expect(button).resolves.toMatchObject({ succeeded: true, mediaId: 'media-1' });
  await polling;
  expect(readStill).toHaveBeenCalledTimes(1);
  // Stored once, by the read both of them waited for.
  expect(storeBytes).toHaveBeenCalledTimes(1);
});

it('shares the failure of the poll it waited for', async () => {
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);

  const polling = pass();
  await settle();
  const button = controller.testCapture(TERPCAM.id);
  capture.reject(new Error('the controller did not open the relay in time'));

  await expect(button).resolves.toMatchObject({ succeeded: false, error: 'the controller did not open the relay in time' });
  await polling;
  expect(readStill).toHaveBeenCalledTimes(1);
});

it('lets a second click wait for the first', async () => {
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);

  const first = controller.testCapture(TERPCAM.id);
  await settle();
  const second = controller.testCapture(TERPCAM.id);
  capture.resolve(STILL);

  await expect(first).resolves.toMatchObject({ succeeded: true, mediaId: 'media-1' });
  await expect(second).resolves.toMatchObject({ succeeded: true, mediaId: 'media-1' });
  expect(readStill).toHaveBeenCalledTimes(1);
});

it('leaves the camera to a running test-image read', async () => {
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);

  const button = controller.testCapture(TERPCAM.id);
  await settle();
  await pass();
  capture.resolve(STILL);

  await expect(button).resolves.toMatchObject({ succeeded: true });
  expect(readStill).toHaveBeenCalledTimes(1);
});

it('reads a stream of its own when the settings being tested are not the ones being polled', async () => {
  polled = [{ ...STREAM, url: 'rtsp://192.168.1.21/old' }];
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);
  const polling = pass();
  await settle();

  await expect(controller.testCapture(STREAM.id)).resolves.toMatchObject({ succeeded: true });
  expect(readStill).toHaveBeenCalledTimes(2);
  capture.resolve(STILL);
  await polling;
});

describe('a camera read through its device', () => {
  it('is not read while the device is offline', async () => {
    lastSeenAt = new Date(Date.now() - 60 * 60_000);
    polled = [TERPCAM, STREAM];

    await pass();
    expect(readStill).not.toHaveBeenCalled();
  });

  it('is read again as soon as the device is back', async () => {
    lastSeenAt = new Date(Date.now() - 60 * 60_000);
    await pass();
    lastSeenAt = new Date();

    await pass();
    expect(readStill).toHaveBeenCalledTimes(1);
  });

  it('leaves a camera reached directly to be read', async () => {
    lastSeenAt = new Date(Date.now() - 60 * 60_000);
    polled = [{ ...STREAM, tunnel: false }];

    await pass();
    expect(readStill).toHaveBeenCalledTimes(1);
  });

  it('answers the test-image button at once that the device is offline, rather than after the relay´s timeouts', async () => {
    lastSeenAt = new Date(Date.now() - 60 * 60_000);

    for (const camera of [TERPCAM, STREAM]) {
      const answer = await controller.testCapture(camera.id);
      expect(answer).toMatchObject({ succeeded: false, mediaId: null });
      expect(answer.error).toBe(`the device this camera is read through is offline since ${lastSeenAt.toISOString()}`);
    }
    expect(readStill).not.toHaveBeenCalled();
  });

  it('reads for the button as soon as the device is back', async () => {
    lastSeenAt = new Date(Date.now() - 60 * 60_000);
    await controller.testCapture(TERPCAM.id);
    lastSeenAt = new Date();

    await expect(controller.testCapture(TERPCAM.id)).resolves.toMatchObject({ succeeded: true });
    expect(readStill).toHaveBeenCalledTimes(1);
  });
});
