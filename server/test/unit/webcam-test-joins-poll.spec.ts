import { jest } from '@jest/globals';
import type { TestCapture } from '@fg2/shared-types/v1';
import { CameraPollerService } from '@modules/v1/camera/camera-poller.service';
import { CamerasController } from '@modules/v1/camera/cameras.controller';
import { TestCapturesService } from '@modules/v1/camera/test-captures.service';

/**
 * The test-image button while the poller is reading the same camera. A Terp
 * Cam's device bridges one relay at a time, so a second capture beside the
 * poll's would be turned down. The button joins the poll's read instead, and
 * the poller leaves a camera alone while the button is reading it.
 *
 * A press is answered at once with a capture that is asked after until it is
 * over, as the camera page does.
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
let noteCapture: jest.Mock<(id: string, at: Date | null, error: string | null) => Promise<void>>;
let poller: CameraPollerService;
let tests: TestCapturesService;
let controller: CamerasController;

const OWNER = { grantee: 'owner' } as never;

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

/** A press of the button, answered as the route answers it: at once. */
const press = (cameraId: string, grant = OWNER) => controller.testCapture(grant, cameraId);

/** The capture asked after until it is over, as the camera page asks every couple of seconds. */
async function outcome(started: TestCapture | Promise<TestCapture>, grant = OWNER): Promise<TestCapture> {
  const { id, cameraId } = await started;
  for (;;) {
    const capture = controller.testCaptureState(grant, cameraId, id);
    if (capture.state !== 'running') return capture;
    await settle();
  }
}

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
    noteCapture: (noteCapture = jest.fn<(id: string, at: Date | null, error: string | null) => Promise<void>>().mockResolvedValue(undefined)),
  };
  const entries = { write: async () => undefined };

  poller = new CameraPollerService(devices as never, cameras as never, { readStill } as never, { storeBytes } as never, entries as never, null);
  tests = new TestCapturesService(cameras as never, poller);
  controller = new CamerasController(cameras as never, {} as never, poller, {} as never, {} as never, {} as never, tests);
});

afterEach(() => {
  (poller as unknown as Internals).onApplicationShutdown();
  tests.onApplicationShutdown();
});

it("answers with the poll's picture instead of capturing beside it", async () => {
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);

  const polling = pass();
  await settle();
  const button = await press(TERPCAM.id);
  expect(button.state).toBe('running');
  capture.resolve(STILL);

  await expect(outcome(button)).resolves.toMatchObject({ state: 'done', still: { mediaId: 'media-1' }, reason: null, error: null });
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
  const button = press(TERPCAM.id);
  capture.reject(new Error('the controller did not open the relay in time'));

  await expect(outcome(button)).resolves.toMatchObject({
    state: 'failed',
    still: null,
    reason: 'relayNotOpened',
    error: 'the controller did not open the relay in time',
  });
  await polling;
  expect(readStill).toHaveBeenCalledTimes(1);
});

it('lets a second click wait for the first', async () => {
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);

  const first = await press(TERPCAM.id);
  await settle();
  const second = await press(TERPCAM.id);
  capture.resolve(STILL);

  // The same capture, not a second one waiting on the same read.
  expect(second.id).toBe(first.id);
  await expect(outcome(second)).resolves.toMatchObject({ state: 'done', still: { mediaId: 'media-1' } });
  expect(readStill).toHaveBeenCalledTimes(1);
});

it('leaves the camera to a running test-image read', async () => {
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);

  const button = press(TERPCAM.id);
  await settle();
  await pass();
  capture.resolve(STILL);

  await expect(outcome(button)).resolves.toMatchObject({ state: 'done' });
  expect(readStill).toHaveBeenCalledTimes(1);
});

it('reads a stream of its own when the settings being tested are not the ones being polled', async () => {
  polled = [{ ...STREAM, url: 'rtsp://192.168.1.21/old' }];
  const capture = held();
  readStill.mockReturnValueOnce(capture.promise);
  const polling = pass();
  await settle();

  await expect(outcome(press(STREAM.id))).resolves.toMatchObject({ state: 'done' });
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
      const answer = await outcome(press(camera.id));
      expect(answer).toMatchObject({ state: 'failed', still: null, reason: 'deviceOffline' });
      expect(answer.error).toBe(`the device this camera is read through is offline since ${lastSeenAt.toISOString()}`);
    }
    expect(readStill).not.toHaveBeenCalled();
  });

  it('reads for the button as soon as the device is back', async () => {
    lastSeenAt = new Date(Date.now() - 60 * 60_000);
    await outcome(press(TERPCAM.id));
    lastSeenAt = new Date();

    await expect(outcome(press(TERPCAM.id))).resolves.toMatchObject({ state: 'done' });
    expect(readStill).toHaveBeenCalledTimes(1);
  });
});

describe('a capture asked after', () => {
  it('is answered at once, while the read it started goes on', async () => {
    const capture = held();
    readStill.mockReturnValueOnce(capture.promise);

    const button = await press(TERPCAM.id);
    expect(button).toMatchObject({ cameraId: TERPCAM.id, state: 'running', finishedAt: null, still: null, reason: null, error: null });
    await settle();
    expect(controller.testCaptureState(OWNER, TERPCAM.id, button.id).state).toBe('running');

    capture.resolve(STILL);
    const done = await outcome(button);
    expect(done.finishedAt).not.toBeNull();
  });

  it('writes down why it failed before it says it is over, so the camera page reads the reason with it', async () => {
    readStill.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(outcome(press(STREAM.id))).resolves.toMatchObject({ state: 'failed', reason: 'noAnswer' });
    expect(noteCapture).toHaveBeenCalledWith(STREAM.id, null, 'Connection refused');
  });

  it('is found under its own camera only', async () => {
    const button = await outcome(press(TERPCAM.id));

    expect(() => controller.testCaptureState(OWNER, STREAM.id, button.id)).toThrow();
    expect(() => controller.testCaptureState(OWNER, TERPCAM.id, 'no-such-capture')).toThrow();
  });

  it('tells somebody who manages the tent, not owns the camera, the kind of failure and not the camera´s words', async () => {
    readStill.mockRejectedValueOnce(new Error('Connection to tcp://192.168.1.40:554 failed: Connection refused'));
    const member = { grantee: 'member' } as never;

    const failed = await outcome(press(STREAM.id, member), member);
    expect(failed).toMatchObject({ state: 'failed', reason: 'noAnswer', error: null });
    expect(controller.testCaptureState(OWNER, STREAM.id, failed.id).error).toContain('192.168.1.40');
  });

  it('is kept for a few minutes after it finished, and then forgotten', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const button = await outcome(press(TERPCAM.id));

      jest.advanceTimersByTime(4 * 60_000);
      expect(controller.testCaptureState(OWNER, TERPCAM.id, button.id).state).toBe('done');
      jest.advanceTimersByTime(60_000);
      expect(() => controller.testCaptureState(OWNER, TERPCAM.id, button.id)).toThrow();
    } finally {
      jest.useRealTimers();
    }
  });
});
