import { jest } from '@jest/globals';
import { CloudSettings, Device } from '@fg2/shared-types';
import { RelayUnavailableError, TerpCamDirectService } from '@modules/camera/terpcam-direct.service';
import { TerpCamP2PService } from '@modules/camera/terpcam-p2p.service';
import { WebcamPollerService } from '@modules/image/webcam-poller.service';

/**
 * When a Terp Cam still comes from the camera itself and when it comes from the
 * controller instead. Both paths end in a controller and a P2P session the
 * black-box harness has nothing to answer with, so the two collaborators are
 * stood in for here and the service is driven directly.
 */

const DEVICE = 'terpcam-device';
const CAMERA: CloudSettings = { rtspStream: 'terpcam://cam-1' };
const DIRECT_STILL = Buffer.from('2304x1296, off the video stream');
const CONTROLLER_STILL = Buffer.from('1280x720, from snapshot.cgi');

/**
 * The state machine sits between the poller and the two camera services, with no
 * caller of its own outside the class. Naming the two seams the spec drives is
 * more honest than reaching for `any` at every call.
 */
type WebcamPollerInternals = {
  trackTerpCamOnlinePeriod(device: Device): void;
  readRtspStreamImage(cloudSettings: CloudSettings, deviceId: string, alwaysAllowController?: boolean): Promise<Buffer>;
};

let direct: { canReachCamera: jest.Mock<() => Promise<boolean>>; captureStill: jest.Mock<() => Promise<Buffer>> };
let controller: { captureViaController: jest.Mock<() => Promise<Buffer>> };
let service: WebcamPollerInternals;

/** What the poller does with a device before it reads its camera. */
const seenBy = (poller: 'an online device' | 'an offline device', deviceId = DEVICE) =>
  service.trackTerpCamOnlinePeriod({ device_id: deviceId, lastseen: poller === 'an online device' ? Date.now() : 0 } as Device);

/** One poll of the camera. */
const poll = (deviceId = DEVICE) => service.readRtspStreamImage(CAMERA, deviceId);

/** The test-image button, which takes a lesser picture over none at all. */
const testImage = (deviceId = DEVICE) => service.readRtspStreamImage(CAMERA, deviceId, true);

const directFails = () => direct.captureStill.mockRejectedValueOnce(new Error('no answer from the camera'));

/** The poller's clock; the fallback is a question of how long the camera has delivered nothing. */
let now = 0;
const minutesPass = (minutes: number) => (now += minutes * 60_000);

beforeEach(() => {
  now = Date.parse('2026-09-30T12:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);

  direct = {
    canReachCamera: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    captureStill: jest.fn<() => Promise<Buffer>>().mockResolvedValue(DIRECT_STILL),
  };
  controller = { captureViaController: jest.fn<() => Promise<Buffer>>().mockResolvedValue(CONTROLLER_STILL) };

  service = new WebcamPollerService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    controller as unknown as TerpCamP2PService,
    direct as unknown as TerpCamDirectService,
  ) as unknown as WebcamPollerInternals;
});

afterEach(() => jest.restoreAllMocks());

it('takes the full-resolution picture while the camera answers', async () => {
  seenBy('an online device');

  await expect(poll()).resolves.toBe(DIRECT_STILL);
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('asks the controller straight away where it reaches no camera of its own', async () => {
  seenBy('an online device');
  direct.canReachCamera.mockResolvedValue(false);

  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
  expect(direct.captureStill).not.toHaveBeenCalled();
});

it('leaves polls without a picture rather than downgrading them for the first ten minutes', async () => {
  seenBy('an online device');

  for (let minute = 0; minute < 10; minute++) {
    directFails();
    await expect(poll()).rejects.toThrow('keeping the full-resolution path');
    minutesPass(0.99);
  }
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('asks the controller once the camera has delivered nothing for ten minutes since coming online', async () => {
  seenBy('an online device');
  directFails();
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');

  minutesPass(10);
  directFails();
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
});

it('counts the ten minutes from the last full-resolution picture', async () => {
  seenBy('an online device');
  minutesPass(30);
  await expect(poll()).resolves.toBe(DIRECT_STILL);

  minutesPass(9);
  directFails();
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');

  minutesPass(1);
  directFails();
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
});

it('closes the fallback again as soon as a direct capture succeeds', async () => {
  seenBy('an online device');
  minutesPass(10);
  directFails();
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);

  await expect(poll()).resolves.toBe(DIRECT_STILL);

  directFails();
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  expect(controller.captureViaController).toHaveBeenCalledTimes(1);
});

it('starts the ten minutes again when the device comes back online', async () => {
  seenBy('an online device');
  minutesPass(20);

  seenBy('an offline device');
  seenBy('an online device');

  // The camera hangs off the same wifi as the controller, so a device that has
  // just come back is given the same time to reach it as a new one.
  directFails();
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('takes the smaller picture on the first failure for the test-image button', async () => {
  seenBy('an online device');
  directFails();

  await expect(testImage()).resolves.toBe(CONTROLLER_STILL);
});

it('falls back on the first failure for a device no pass has seen yet', async () => {
  directFails();

  await expect(poll('never-polled')).resolves.toBe(CONTROLLER_STILL);
});

it('waits the ten minutes out for a controller that did not open the relay, too', async () => {
  // A controller that answers the relay most of the time and missed it once
  // must not cost a quarter of an hour of downgraded stills.
  seenBy('an online device');
  direct.captureStill.mockRejectedValueOnce(new RelayUnavailableError('the controller did not open a relay'));
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');

  minutesPass(10);
  direct.captureStill.mockRejectedValueOnce(new RelayUnavailableError('the controller did not open a relay recently'));
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
});
