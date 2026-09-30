import { jest } from '@jest/globals';
import { CloudSettings, Device } from '@fg2/shared-types';
import { TerpCamDirectService } from '@modules/camera/terpcam-direct.service';
import { TerpCamP2PService } from '@modules/camera/terpcam-p2p.service';
import { WebcamPollerService } from '@modules/image/webcam-poller.service';

/**
 * The test-image button while a poll is reading the same camera. A Terp Cam's
 * controller bridges one relay at a time, so a second capture beside the poll's
 * is turned down - and read by the cloud as a controller that cannot relay at
 * all. The button waits for the poll's picture instead.
 */

const DEVICE = 'terpcam-device';
const CAMERA: CloudSettings = { rtspStream: 'terpcam://cam-1' };
const DIRECT_STILL = Buffer.from('2304x1296, off the video stream');
const CONTROLLER_STILL = Buffer.from('1280x720, from snapshot.cgi');

/** One pass of the poller is the seam the spec drives besides the button. */
type WebcamPollerInternals = Pick<WebcamPollerService, 'testRtspStream' | 'onApplicationShutdown'> & {
  readFromRtspStreams(): Promise<void>;
};

let direct: { canReachCamera: jest.Mock<() => Promise<boolean>>; captureStill: jest.Mock<() => Promise<Buffer>> };
let controller: { captureViaController: jest.Mock<() => Promise<Buffer>> };
let store: { createImage: jest.Mock<(meta: unknown, image: Buffer) => Promise<void>> };
let service: WebcamPollerInternals;

/** A capture that finishes when the spec says so. */
function held(): { promise: Promise<Buffer>; resolve: (b: Buffer) => void; reject: (e: Error) => void } {
  let resolve!: (b: Buffer) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<Buffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the poller get as far as its capture. */
const settle = () => new Promise(r => setImmediate(r));

beforeEach(() => {
  direct = {
    canReachCamera: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    captureStill: jest.fn<() => Promise<Buffer>>().mockResolvedValue(DIRECT_STILL),
  };
  controller = { captureViaController: jest.fn<() => Promise<Buffer>>().mockResolvedValue(CONTROLLER_STILL) };
  store = { createImage: jest.fn<(meta: unknown, image: Buffer) => Promise<void>>().mockResolvedValue(undefined) };
  const devices = {
    find: async () => [{ device_id: DEVICE, lastseen: Date.now(), cloudSettings: CAMERA } as Device],
  };

  service = new WebcamPollerService(
    devices as never,
    store as never,
    {} as never,
    {} as never,
    controller as unknown as TerpCamP2PService,
    direct as unknown as TerpCamDirectService,
  ) as unknown as WebcamPollerInternals;
});

afterEach(() => service.onApplicationShutdown());

it("answers with the poll's picture instead of capturing beside it", async () => {
  const capture = held();
  direct.captureStill.mockReturnValueOnce(capture.promise);

  const pass = service.readFromRtspStreams();
  await settle();
  const button = service.testRtspStream(DEVICE, CAMERA);
  capture.resolve(DIRECT_STILL);

  await expect(button).resolves.toBe(DIRECT_STILL);
  await pass;
  expect(direct.captureStill).toHaveBeenCalledTimes(1);
  expect(store.createImage).toHaveBeenCalledWith(expect.anything(), DIRECT_STILL);
});

it("takes the controller's picture when the poll it waited for comes back empty", async () => {
  const capture = held();
  direct.captureStill.mockReturnValueOnce(capture.promise);

  const pass = service.readFromRtspStreams();
  await settle();
  const button = service.testRtspStream(DEVICE, CAMERA);
  capture.reject(new Error('no keyframe arrived'));

  await expect(button).resolves.toBe(CONTROLLER_STILL);
  await pass;
  expect(direct.captureStill).toHaveBeenCalledTimes(1);
});

it('leaves the camera to a running test-image read', async () => {
  const capture = held();
  direct.captureStill.mockReturnValueOnce(capture.promise);

  const button = service.testRtspStream(DEVICE, CAMERA);
  await settle();
  await service.readFromRtspStreams();
  capture.resolve(DIRECT_STILL);

  await expect(button).resolves.toBe(DIRECT_STILL);
  expect(direct.captureStill).toHaveBeenCalledTimes(1);
  expect(store.createImage).not.toHaveBeenCalled();
});

it('reads an RTSP stream of its own when the settings being tested are not the ones being polled', async () => {
  const capture = held();
  direct.captureStill.mockReturnValueOnce(capture.promise);
  const pass = service.readFromRtspStreams();
  await settle();

  // Not a Terp Cam, so nothing here is joined; ffmpeg is simply not there to
  // answer in the unit suite, which is enough to show the read was its own.
  await expect(service.testRtspStream(DEVICE, { rtspStream: 'rtsp://127.0.0.1:9/nothing' })).rejects.toThrow();
  capture.resolve(DIRECT_STILL);
  await pass;
});
