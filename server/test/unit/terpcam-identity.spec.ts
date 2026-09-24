import { jest } from '@jest/globals';
import { CameraRefusedError, readStatusReply, TerpCamDirectService } from '@modules/camera/terpcam-direct.service';

/**
 * The server reaches a camera by the P2P id its controller reported, and that id
 * can belong to another camera on the same network. What the camera answers to
 * `get_status.cgi` decides whether a session is held at all.
 */

const PAIRED = 'AAC4004902SCAQ';

describe('reading a get_status reply', () => {
  it('names the camera even when it refuses the password', () => {
    expect(readStatusReply('result=-1;vuid=AAC2852199TWVA;', PAIRED)).toEqual({ result: -1, identity: 'mismatch' });
    expect(readStatusReply('result=-1;vuid=AAC4004902SCAQ;', PAIRED)).toEqual({ result: -1, identity: 'match' });
  });

  it('recognises the paired camera by its realdeviceid', () => {
    const text = 'result= 0;var alias="tent";var deviceid="VSTH828707TXVEW";var realdeviceid="AAC4004902SCAQ";';
    expect(readStatusReply(text, PAIRED)).toEqual({ result: 0, identity: 'match' });
  });

  it('does not take the P2P deviceid for the realdeviceid', () => {
    expect(readStatusReply('result= 0;var deviceid="VSTH828707TXVEW";', PAIRED).identity).toBe('unknown');
  });

  it('compares a camera paired by its P2P id with its deviceid', () => {
    expect(readStatusReply('result= 0;var deviceid="VSTH-828707-TXVEW";', 'VSTH828707TXVEW').identity).toBe('match');
    expect(readStatusReply('result= 0;var deviceid="VSTH581824TJXUG";', 'VSTH828707TXVEW').identity).toBe('mismatch');
  });

  it('knows nothing from a reply that has not arrived yet', () => {
    expect(readStatusReply('', PAIRED)).toEqual({ result: undefined, identity: 'unknown' });
  });
});

describe('a camera that refused the session', () => {
  const DEVICE = 'terpcam-device';
  let service: TerpCamDirectService;
  let readStill: jest.Mock<() => Promise<Buffer>>;

  beforeEach(() => {
    service = new TerpCamDirectService(
      { findOne: async () => null } as never,
      {} as never,
      { rendezvousHosts: ['127.0.0.1'], advertiseAddress: null, portsStart: 0, portsEnd: 0 } as never,
    );
    service.rememberCamera(DEVICE, PAIRED);
    service.rememberUid(DEVICE, 'VSTH828707TXVEW');
    readStill = jest.fn<() => Promise<Buffer>>().mockRejectedValue(new CameraRefusedError('the camera rejected the password'));
    (service as unknown as { readStill: typeof readStill }).readStill = readStill;
  });

  it('is not asked again on the next poll', async () => {
    await expect(service.capture(DEVICE)).rejects.toThrow('rejected the password');
    await expect(service.capture(DEVICE)).rejects.toThrow('not retrying before');
    expect(readStill).toHaveBeenCalledTimes(1);
  });

  it('is asked again as soon as the device reports different credentials', async () => {
    await expect(service.capture(DEVICE)).rejects.toThrow('rejected the password');
    service.rememberPassword(DEVICE, 'n3wPassword');
    await expect(service.capture(DEVICE)).rejects.toThrow('rejected the password');
    service.rememberUid(DEVICE, 'VSTH581824TJXUG');
    await expect(service.capture(DEVICE)).rejects.toThrow('rejected the password');
    expect(readStill).toHaveBeenCalledTimes(3);
  });
});
