import { jest } from '@jest/globals';
import { CameraWithSecret } from '@modules/v1/camera/cameras.service';
import { CaptureService } from '@modules/v1/camera/capture.service';
import { TerpCamDirectService } from '@modules/v1/camera/terpcam-direct.service';
import { TerpCamP2PService } from '@modules/v1/camera/terpcam-p2p.service';

/**
 * When a Terp Cam still comes from the camera itself and when it comes from the
 * controller instead. Both paths end in a rendezvous server and a P2P session
 * the black-box harness has nothing to answer with, so the two collaborators are
 * stood in for here and the service is driven directly.
 */

const CONTROLLER = 'terpcam-controller';
const CAMERA = { id: 'camera-1', kind: 'terpcam_controller', deviceId: CONTROLLER, uid: 'VSTH581824TJXUG', secret: null } as CameraWithSecret;
const DIRECT_STILL = Buffer.from('2304x1296, off the video stream');
const CONTROLLER_STILL = Buffer.from('1280x720, from snapshot.cgi');

let direct: { canReach: jest.Mock<() => boolean>; captureStill: jest.Mock<() => Promise<Buffer>> };
let controller: { captureViaController: jest.Mock<() => Promise<Buffer>> };
let service: CaptureService;

/** What the poller tells the capture path about the controller before it reads its camera. */
const seenBy = (poller: 'an online controller' | 'an offline controller', cameraId = CAMERA.id) =>
  service.trackControllerOnlinePeriod(cameraId, poller === 'an online controller');

/** One poll of the camera. */
const poll = (camera: CameraWithSecret = CAMERA) => service.readStill(camera);

/** The test-image button, which takes a lesser picture over none at all. */
const testImage = () => service.readStill(CAMERA, true);

const directFails = () => direct.captureStill.mockRejectedValueOnce(new Error('no answer from the camera'));

beforeEach(() => {
  direct = {
    canReach: jest.fn<() => boolean>().mockReturnValue(true),
    captureStill: jest.fn<() => Promise<Buffer>>().mockResolvedValue(DIRECT_STILL),
  };
  controller = { captureViaController: jest.fn<() => Promise<Buffer>>().mockResolvedValue(CONTROLLER_STILL) };

  service = new CaptureService({} as never, controller as unknown as TerpCamP2PService, direct as unknown as TerpCamDirectService);
});

it('takes the full-resolution picture while the camera answers', async () => {
  seenBy('an online controller');

  await expect(poll()).resolves.toBe(DIRECT_STILL);
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('asks the controller straight away where it reaches no camera of its own', async () => {
  seenBy('an online controller');
  direct.canReach.mockReturnValue(false);

  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
  expect(direct.captureStill).not.toHaveBeenCalled();
});

it('leaves a poll without a picture rather than downgrading it after one failure', async () => {
  seenBy('an online controller');
  directFails();

  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('asks the controller once two direct captures in a row have failed', async () => {
  seenBy('an online controller');
  directFails();
  directFails();

  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
});

it('closes the fallback again as soon as a direct capture succeeds', async () => {
  seenBy('an online controller');
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

it('forgets the failures of an earlier online period when the controller comes back', async () => {
  seenBy('an online controller');
  directFails();
  await expect(poll()).rejects.toThrow();

  seenBy('an offline controller');
  seenBy('an online controller');

  // Without the reset this second failure would be the camera's second in a row
  // and would take the controller's picture.
  directFails();
  await expect(poll()).rejects.toThrow('keeping the full-resolution path');
  expect(controller.captureViaController).not.toHaveBeenCalled();
});

it('forgets an earlier online period having succeeded when the controller comes back', async () => {
  seenBy('an online controller');
  await expect(poll()).resolves.toBe(DIRECT_STILL);

  seenBy('an offline controller');
  seenBy('an online controller');

  // The camera hangs off the same wifi as the controller, so a controller that
  // has just come back may no longer have it: what the last period proved says
  // nothing about this one.
  directFails();
  directFails();
  await expect(poll()).rejects.toThrow();
  await expect(poll()).resolves.toBe(CONTROLLER_STILL);
});

it('takes the smaller picture on the first failure for the test-image button', async () => {
  seenBy('an online controller');
  directFails();

  await expect(testImage()).resolves.toBe(CONTROLLER_STILL);
});

it('falls back on the first failure for a camera no pass has seen yet', async () => {
  directFails();

  await expect(poll({ ...CAMERA, id: 'never-polled' })).resolves.toBe(CONTROLLER_STILL);
});

it('has nowhere to fall back to for a camera the cloud reaches itself', async () => {
  const standalone = { ...CAMERA, kind: 'terpcam_standalone', deviceId: null } as CameraWithSecret;
  seenBy('an online controller', standalone.id);
  directFails();
  directFails();

  await expect(poll(standalone)).rejects.toThrow('keeping the full-resolution path');
  await expect(poll(standalone)).rejects.toThrow('has to reach it itself');
  expect(controller.captureViaController).not.toHaveBeenCalled();
});
