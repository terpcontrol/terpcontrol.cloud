import { jest } from '@jest/globals';
import { CloudSettings, Device } from '@fg2/shared-types';
import { TerpCamDirectService } from '@modules/camera/terpcam-direct.service';
import { TerpCamP2PService } from '@modules/camera/terpcam-p2p.service';
import { ImageService } from '@modules/image/image.service';

/**
 * When a Terp Cam still comes from the camera itself and when it comes from the
 * controller instead. Both paths end in a rendezvous server and a P2P session
 * the black-box harness has nothing to answer with, so the two collaborators are
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
type ImageServiceInternals = {
  trackTerpCamOnlinePeriod(device: Device): void;
  readRtspStreamImage(cloudSettings: CloudSettings, deviceId: string, alwaysAllowController?: boolean): Promise<Buffer>;
};

let direct: { canReachCamera: jest.Mock<() => Promise<boolean>>; captureStill: jest.Mock<() => Promise<Buffer>> };
let controller: { captureViaController: jest.Mock<() => Promise<Buffer>> };
let service: ImageServiceInternals;

/** What the poller does with a device before it reads its camera. */
const seenBy = (poller: 'an online device' | 'an offline device', deviceId = DEVICE) =>
  service.trackTerpCamOnlinePeriod({ device_id: deviceId, lastseen: poller === 'an online device' ? Date.now() : 0 } as Device);

/** One poll of the camera. */
const poll = (deviceId = DEVICE) => service.readRtspStreamImage(CAMERA, deviceId);

/** The test-image button, which takes a lesser picture over none at all. */
const testImage = (deviceId = DEVICE) => service.readRtspStreamImage(CAMERA, deviceId, true);

const directFails = () => direct.captureStill.mockRejectedValueOnce(new Error('no answer from the camera'));

beforeEach(() => {
  direct = {
    canReachCamera: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    captureStill: jest.fn<() => Promise<Buffer>>().mockResolvedValue(DIRECT_STILL),
  };
  controller = { captureViaController: jest.fn<() => Promise<Buffer>>().mockResolvedValue(CONTROLLER_STILL) };

  service = new ImageService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    controller as unknown as TerpCamP2PService,
    direct as unknown as TerpCamDirectService,
  ) as unknown as ImageServiceInternals;
});

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

it('leaves a poll without a picture rather than downgrading it after one failure', async () => {
  seenBy('an online device');
  directFails();

  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('asks the controller once two direct captures in a row have failed', async () => {
  seenBy('an online device');
  directFails();
  directFails();

  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
});

it('closes the fallback again as soon as a direct capture succeeds', async () => {
  seenBy('an online device');
  directFails();
  directFails();
  await expect(poll()).rejects.toThrow();
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);

  await expect(poll()).resolves.toBe(DIRECT_STILL);

  // The camera has proved itself for this online period, so the failures that
  // follow are a bad minute rather than a camera the server cannot reach.
  directFails();
  directFails();
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  expect(controller.captureViaController).toHaveBeenCalledTimes(1);
});

it('forgets the failures of an earlier online period when the device comes back', async () => {
  seenBy('an online device');
  directFails();
  await expect(poll()).rejects.toThrow();

  seenBy('an offline device');
  seenBy('an online device');

  // Without the reset this second failure would be the device's second in a row
  // and would take the controller's picture.
  directFails();
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('forgets an earlier online period having succeeded when the device comes back', async () => {
  seenBy('an online device');
  await expect(poll()).resolves.toBe(DIRECT_STILL);

  seenBy('an offline device');
  seenBy('an online device');

  // The camera hangs off the same wifi as the controller, so a device that has
  // just come back may no longer have it: what the last period proved says
  // nothing about this one.
  directFails();
  directFails();
  await expect(poll()).rejects.toThrow();
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
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
