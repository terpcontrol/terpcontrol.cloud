import { createCipheriv, createDecipheriv } from 'node:crypto';
import net, { AddressInfo } from 'node:net';
import { jest } from '@jest/globals';
import { CameraRefusedError, checkStatusReply, RelayUnavailableError, TerpCamDirectService } from '@modules/camera/terpcam-direct.service';

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

  it('reads realdeviceid past the unrelated support_vuid flag', () => {
    // The accepted reply carries `support_vuid=1` and `vuidResult=0` before the
    // real id; a bare `vuid=` search would latch onto the "1" and call it foreign.
    const reply = 'result= 0;var support_vuid=1;var realdeviceid="AAC4004902SCAQ";var vuidResult=0;';
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
  readStill: (deviceId: string, camera: unknown) => Promise<Buffer | null>;
  relayConnect: (deviceId: string) => Promise<RelaySocketLike>;
  onRelayConnection: (conn: net.Socket) => void;
};
type RelaySocketLike = {
  did: Buffer;
  on(event: 'message', cb: (message: Buffer) => void): void;
  send(message: Buffer): void;
  close(): Promise<void>;
};

const RELAY_CONFIG = { relayHost: 'relay.invalid', relayPort: 32250 };

function serviceFor(publish: (topic: string, message: string) => boolean = () => true): TerpCamDirectService {
  const devices = {
    findOne: async () => ({ hardwareInfo: { webcam_did: PAIRED, webcam_uid: 'VSTH828707TXVEW', webcam_pwd: '' } }),
  };
  return new TerpCamDirectService(devices as never, {} as never, { publish } as never, RELAY_CONFIG as never);
}

describe('a camera that refused the server', () => {
  let service: TerpCamDirectService;
  let readStill: jest.Mock<Internals['readStill']>;

  beforeEach(() => {
    service = serviceFor();
    readStill = jest.fn<Internals['readStill']>().mockRejectedValue(new CameraRefusedError('UID belongs to a different camera'));
    (service as unknown as Internals).readStill = readStill;
  });

  it('is not asked again on every poll', async () => {
    await expect(service.capture(DEVICE)).rejects.toThrow('different camera');

    // Still a camera this server reaches: how long a camera that fails may go
    // on failing before its picture comes from the controller is the poller's.
    await expect(service.canReachCamera(DEVICE)).resolves.toBe(true);
    await expect(service.capture(DEVICE)).rejects.toThrow('refused');
    expect(readStill).toHaveBeenCalledTimes(1);
  });

  it('is tried again as soon as the device reports something new about it', async () => {
    await expect(service.capture(DEVICE)).rejects.toThrow();

    service.cameraReported(DEVICE);
    await expect(service.capture(DEVICE)).rejects.toThrow('different camera');
    expect(readStill).toHaveBeenCalledTimes(2);
  });
});

describe('a controller that does not open the relay', () => {
  let service: TerpCamDirectService;
  let readStill: jest.Mock<Internals['readStill']>;

  beforeEach(() => {
    service = serviceFor();
    readStill = jest.fn<Internals['readStill']>().mockRejectedValue(new RelayUnavailableError('the controller did not open a relay'));
    (service as unknown as Internals).readStill = readStill;
  });

  it('is asked once, and then not again for a while', async () => {
    await expect(service.capture(DEVICE)).rejects.toThrow(RelayUnavailableError);
    expect(readStill).toHaveBeenCalledTimes(1);

    await expect(service.capture(DEVICE)).rejects.toThrow(RelayUnavailableError);
    expect(readStill).toHaveBeenCalledTimes(1);
  });

  it('is asked again once it reports its camera, as it does after a reboot or learning the id', async () => {
    await expect(service.capture(DEVICE)).rejects.toThrow();

    service.cameraReported(DEVICE);
    await expect(service.capture(DEVICE)).rejects.toThrow(RelayUnavailableError);
    expect(readStill).toHaveBeenCalledTimes(2);
  });

  it('is not asked at all while the broker is down', async () => {
    service = serviceFor(() => false);
    await expect((service as unknown as Internals).relayConnect(DEVICE)).rejects.toThrow('could not ask');
  });
});

it('leaves a camera whose P2P id the controller has not reported to the controller', async () => {
  // The controller relays nothing until it knows the id, so asking would only
  // wait out the dial-in. The device simulator's camera is one of these.
  for (const webcam_uid of [undefined, 'none']) {
    const devices = { findOne: async () => ({ hardwareInfo: { webcam_did: PAIRED, webcam_uid } }) };
    const service = new TerpCamDirectService(devices as never, {} as never, { publish: () => true } as never, RELAY_CONFIG as never);
    await expect(service.canReachCamera(DEVICE)).resolves.toBe(false);
  }
});

it('runs one capture per device however many callers ask at once', async () => {
  const service = serviceFor();
  let finish: (still: Buffer) => void = () => undefined;
  const readStill = jest.fn<Internals['readStill']>().mockReturnValue(new Promise(resolve => (finish = resolve)));
  (service as unknown as Internals).readStill = readStill;
  (service as unknown as { stills: unknown }).stills = { decodeKeyframeToJpeg: async (data: Buffer) => data };

  const poll = service.captureStill(DEVICE);
  const button = service.captureStill(DEVICE);
  finish(Buffer.from('keyframe'));

  await expect(poll).resolves.toEqual(Buffer.from('keyframe'));
  await expect(button).resolves.toEqual(Buffer.from('keyframe'));
  expect(readStill).toHaveBeenCalledTimes(1);
});

describe('the relay connection', () => {
  const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
  let server: net.Server;

  afterEach(() => server?.close());

  it('enciphers both directions and tells the controller when the cloud is done', async () => {
    const published: string[] = [];
    const service = serviceFor((_topic, message) => published.push(message) > 0);
    const internals = service as unknown as Internals;
    server = net.createServer(conn => internals.onRelayConnection(conn));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    const relay = internals.relayConnect(DEVICE);
    const { token, key } = JSON.parse(published[0]) as { token: string; key: string };
    const keys = Buffer.from(key, 'hex');
    const up = createCipheriv('aes-128-ctr', keys.subarray(0, 16), Buffer.alloc(16));
    const down = createDecipheriv('aes-128-ctr', keys.subarray(16), Buffer.alloc(16));

    // The controller: its header, and the camera's first datagram right behind it.
    const controller = net.connect((server.address() as AddressInfo).port, '127.0.0.1');
    const did = Buffer.from('VSTH00000828707TXVEW', 'latin1');
    const header = Buffer.concat([Buffer.from(token, 'latin1'), Buffer.from([0]), up.update(did)]);
    const fromCamera = Buffer.from('a camera datagram');
    controller.write(Buffer.concat([u16(header.length), header, up.update(Buffer.concat([u16(fromCamera.length), fromCamera]))]));

    const socket = await relay;
    expect(socket.did).toEqual(did);
    await expect(new Promise(resolve => socket.on('message', resolve))).resolves.toEqual(fromCamera);

    const onTheWire: Buffer[] = [];
    controller.on('data', chunk => onTheWire.push(chunk));
    controller.on('end', () => controller.end());
    const toCamera = Buffer.from('a CGI with the password in it');
    socket.send(toCamera);
    await socket.close();

    expect(Buffer.concat(onTheWire).includes(toCamera)).toBe(false);
    expect(down.update(Buffer.concat(onTheWire))).toEqual(Buffer.concat([u16(toCamera.length), toCamera, u16(0)]));
  });
});
