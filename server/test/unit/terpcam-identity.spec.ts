import { jest } from '@jest/globals';
import { CameraRefusedError, checkStatusReply, TerpCamDirectService } from '@modules/camera/terpcam-direct.service';

/**
 * A camera uid that points at the wrong camera: the controller had cached the
 * one next to it on the same LAN, and both it and the server treated the
 * camera's `result=-1` as a session. The reply names the camera either way,
 * which is what these checks key on.
 */

const PAIRED = 'AAC4004902SCAQ';
const DEVICE = 'terpcam-device';

describe('checkStatusReply', () => {
  it('accepts the paired camera once it took the password', () => {
    const reply = 'result= 0;\r\nvar alias="";\r\nvar deviceid="VSTH828707TXVEW";\r\nvar realdeviceid="AAC4004902SCAQ";\r\n';
    expect(checkStatusReply(reply, PAIRED)).toBe('ours');
  });

  it('tells a refused password from a wrong camera', () => {
    expect(checkStatusReply('result=-1;vuid=AAC4004902SCAQ;', PAIRED)).toBe('refused');
    expect(checkStatusReply('result=-1;vuid=AAC2852199TWVA;', PAIRED)).toBe('foreign');
    expect(checkStatusReply('result= 0;var realdeviceid="AAC2852199TWVA";', PAIRED)).toBe('foreign');
  });

  it('waits while the id has not fully arrived', () => {
    expect(checkStatusReply('result= 0;var deviceid="VSTH828707TXVEW";', PAIRED)).toBe('pending');
    expect(checkStatusReply('result= 0;var realdeviceid="AAC40049', PAIRED)).toBe('pending');
  });
});

type Internals = {
  session: (deviceId: string, camera: unknown) => Promise<never>;
};

describe('a camera that refused the server', () => {
  let service: TerpCamDirectService;
  let session: jest.Mock<Internals['session']>;

  beforeEach(() => {
    const devices = {
      findOne: async () => ({ hardwareInfo: { webcam_did: PAIRED, webcam_uid: 'VSTH828707TXVEW', webcam_pwd: '' } }),
    };
    service = new TerpCamDirectService(
      devices as never,
      {} as never,
      {
        rendezvousHosts: ['rendezvous.invalid'],
        advertiseAddress: '',
        portsStart: 0,
        portsEnd: 0,
      } as never,
    );
    session = jest.fn<Internals['session']>().mockRejectedValue(new CameraRefusedError('UID belongs to a different camera'));
    (service as unknown as Internals).session = session;
  });

  it('is left to the controller instead of being asked on every poll', async () => {
    await expect(service.canReachCamera(DEVICE)).resolves.toBe(true);
    await expect(service.capture(DEVICE)).rejects.toThrow('different camera');

    await expect(service.canReachCamera(DEVICE)).resolves.toBe(false);
    await expect(service.capture(DEVICE)).rejects.toThrow('refused');
    expect(session).toHaveBeenCalledTimes(1);
  });

  it('is tried again as soon as the device reports something new about it', async () => {
    await expect(service.capture(DEVICE)).rejects.toThrow();

    service.rememberUid(DEVICE, 'VSTH400490SCAQX');
    await expect(service.canReachCamera(DEVICE)).resolves.toBe(true);
  });
});
