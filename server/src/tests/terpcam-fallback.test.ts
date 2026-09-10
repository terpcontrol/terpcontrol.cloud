// uuid ships as an ES module, which this jest setup cannot transform.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import { imageService } from '@services/image.service';
import { terpCamDirectService } from '@services/terpcam-direct.service';
import { terpCamP2PService } from '@services/terpcam-p2p.service';
import { ONLINE_TIMEOUT } from '@services/device.service';

const DEVICE_ID = 'device-1';
const SETTINGS = { rtspStream: 'terpcam://VSTH000000ABCDE' };

const DIRECT = Buffer.from('full-resolution-jpeg');
const CONTROLLER = Buffer.from('snapshot-cgi-jpeg');

/** One poll of the image pipeline, with the online-period bookkeeping it does. */
const poll = async (online = true): Promise<Buffer> => {
  (imageService as any).trackTerpCamOnlinePeriod({ device_id: DEVICE_ID, lastseen: online ? Date.now() : Date.now() - 2 * ONLINE_TIMEOUT });
  return (imageService as any).readRtspStreamImage(SETTINGS, DEVICE_ID);
};

describe('the controller still is a last resort', () => {
  let captureStill: jest.SpyInstance;
  let captureViaController: jest.SpyInstance;

  beforeEach(() => {
    (imageService as any).deviceIdToTerpCamDirectState.clear();
    jest.spyOn(terpCamDirectService, 'canReachCamera').mockResolvedValue(true);
    captureStill = jest.spyOn(terpCamDirectService, 'captureStill').mockResolvedValue(DIRECT);
    captureViaController = jest.spyOn(terpCamP2PService, 'captureViaController').mockResolvedValue(CONTROLLER);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('takes the camera itself and leaves the controller alone', async () => {
    await expect(poll()).resolves.toEqual(DIRECT);
    expect(captureViaController).not.toHaveBeenCalled();
  });

  it('leaves the poll without an image rather than falling back on the first failure', async () => {
    captureStill.mockRejectedValueOnce(new Error('no keyframe arrived'));

    await expect(poll()).rejects.toThrow('no keyframe arrived');
    expect(captureViaController).not.toHaveBeenCalled();
  });

  it('asks the controller once the direct path has failed twice with nothing to show for the period', async () => {
    captureStill.mockRejectedValue(new Error('camera did not answer the rendezvous'));

    await expect(poll()).rejects.toThrow();
    await expect(poll()).resolves.toEqual(CONTROLLER);
    expect(captureViaController).toHaveBeenCalledTimes(1);
  });

  it('never falls back once a direct still has arrived in this online period', async () => {
    await expect(poll()).resolves.toEqual(DIRECT);

    captureStill.mockRejectedValue(new Error('held session went stale'));
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(poll()).rejects.toThrow();
    }
    expect(captureViaController).not.toHaveBeenCalled();
  });

  it('weighs a new online period on its own: coming back opens the fallback again', async () => {
    await expect(poll()).resolves.toEqual(DIRECT);

    captureStill.mockRejectedValue(new Error('camera did not answer the rendezvous'));
    await poll(false).catch(() => undefined); // the device drops off the network

    await expect(poll()).rejects.toThrow();
    await expect(poll()).resolves.toEqual(CONTROLLER);
  });

  it('goes straight to the controller where the server reaches no camera itself', async () => {
    (terpCamDirectService.canReachCamera as jest.Mock).mockResolvedValue(false);

    await expect(poll()).resolves.toEqual(CONTROLLER);
    expect(captureStill).not.toHaveBeenCalled();
  });

  it('still answers the test-image button with the controller picture', async () => {
    captureStill.mockRejectedValue(new Error('no keyframe arrived'));

    await expect(imageService.testRtspStream(DEVICE_ID, SETTINGS)).resolves.toEqual(CONTROLLER);
  });
});
