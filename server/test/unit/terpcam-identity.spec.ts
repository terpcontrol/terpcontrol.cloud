import { createCipheriv, createDecipheriv } from 'node:crypto';
import http from 'node:http';
import net, { AddressInfo } from 'node:net';
import { jest } from '@jest/globals';
import { CameraRefusedError, checkStatusReply, TerpCamDirectService } from '@modules/v1/camera/terpcam-direct.service';

/**
 * A camera uid that points at the wrong camera: the controller had cached the
 * one next to it on the same LAN, and both it and the server treated the
 * camera's `result=-1` as a session. The reply names the camera either way,
 * which is what these checks key on.
 */

const PAIRED = 'AAC4004902SCAQ';
const DEVICE = 'terpcam-device';
/** The camera row a device's pairing made: whose relay it is read over, and the id printed on it. */
const CAMERA = { id: 'camera-1', kind: 'terpcam_controller' as const, deviceId: DEVICE, did: PAIRED, secret: null };

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
  readStill: (deviceId: string, label: string, secret: string | null) => Promise<Buffer | null>;
  relayConnect: (deviceId: string) => Promise<RelaySocketLike>;
  onUpgrade: (req: http.IncomingMessage, conn: net.Socket, head: Buffer) => void;
};
type RelaySocketLike = {
  did: Buffer;
  on(event: 'message', cb: (message: Buffer) => void): void;
  send(message: Buffer): void;
  close(): Promise<void>;
};

const RELAY_CONFIG = { relayUrl: 'http://relay.invalid/terpcam/relay' };

type RelayAsked = { url: string; token: string; key: string };

function serviceFor(requestRelay: (deviceId: string, relay: RelayAsked) => boolean = () => true): TerpCamDirectService {
  return new TerpCamDirectService({} as never, { requestRelay } as never, RELAY_CONFIG as never, {} as never);
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
    await expect(service.capture(CAMERA)).rejects.toThrow('different camera');

    await expect(service.capture(CAMERA)).rejects.toThrow('refused');
    expect(readStill).toHaveBeenCalledTimes(1);
  });

  it('is tried again as soon as the device reports something new about it', async () => {
    await expect(service.capture(CAMERA)).rejects.toThrow();

    service.cameraReported(DEVICE);
    await expect(service.capture(CAMERA)).rejects.toThrow('different camera');
    expect(readStill).toHaveBeenCalledTimes(2);
  });
});

describe('a controller that does not open the relay', () => {
  let service: TerpCamDirectService;
  let readStill: jest.Mock<Internals['readStill']>;

  beforeEach(() => {
    service = serviceFor();
    readStill = jest.fn<Internals['readStill']>().mockRejectedValue(new Error('the controller did not open the relay in time'));
    (service as unknown as Internals).readStill = readStill;
  });

  it('is an ordinary failed attempt: retried, and asked again on the next poll', async () => {
    // A slow link, a controller still ending the previous relay, a camera it did
    // not find on its LAN this time: none of them is a reason to stop asking.
    await expect(service.capture(CAMERA)).rejects.toThrow('in time');
    expect(readStill).toHaveBeenCalledTimes(3);

    await expect(service.capture(CAMERA)).rejects.toThrow('in time');
    expect(readStill).toHaveBeenCalledTimes(6);
  });

  it('is not asked at all while the broker is down', async () => {
    service = serviceFor(() => false);
    await expect((service as unknown as Internals).relayConnect(DEVICE)).rejects.toThrow('could not ask');
  });
});

it("asks for a relay before the device has reported the camera's P2P id", async () => {
  // The device learns the id on its LAN before it opens the relay, so the id is
  // not the server's to wait for: the camera row may carry none.
  const service = serviceFor();
  expect(service.canReach(CAMERA)).toBe(true);
  const readStill = jest.fn<Internals['readStill']>().mockResolvedValue(Buffer.from('keyframe'));
  (service as unknown as Internals).readStill = readStill;
  await expect(service.capture(CAMERA)).resolves.toEqual(Buffer.from('keyframe'));
  // The camera's own record says who it is and what to log in with, never the caller.
  expect(readStill).toHaveBeenCalledWith(DEVICE, PAIRED, null);
});

describe('a camera the relay cannot reach', () => {
  it('is one paired at no device, or a stream', () => {
    const service = serviceFor();
    expect(service.canReach({ ...CAMERA, deviceId: null })).toBe(false);
    expect(service.canReach({ ...CAMERA, did: null })).toBe(false);
    expect(service.canReach({ ...CAMERA, kind: 'terpcam_standalone' })).toBe(false);
    expect(service.canReach({ ...CAMERA, kind: 'rtsp' })).toBe(false);
  });

  it('is every camera where no relay is configured', async () => {
    const service = new TerpCamDirectService({} as never, { requestRelay: () => true } as never, { relayUrl: '' } as never, {} as never);
    expect(service.canReach(CAMERA)).toBe(false);
    await expect(service.capture(CAMERA)).rejects.toThrow('no relay configured');
  });
});

it('runs one capture per device however many callers ask at once', async () => {
  const service = serviceFor();
  let finish: (still: Buffer) => void = () => undefined;
  const readStill = jest.fn<Internals['readStill']>().mockReturnValue(new Promise(resolve => (finish = resolve)));
  (service as unknown as Internals).readStill = readStill;
  (service as unknown as { stills: unknown }).stills = { decodeKeyframeToJpeg: async (data: Buffer) => data };

  const poll = service.captureStill(CAMERA);
  const button = service.captureStill(CAMERA);
  finish(Buffer.from('keyframe'));

  await expect(poll).resolves.toEqual(Buffer.from('keyframe'));
  await expect(button).resolves.toEqual(Buffer.from('keyframe'));
  expect(readStill).toHaveBeenCalledTimes(1);
});

describe('the relay connection', () => {
  const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
  let server: http.Server;

  afterEach(() => server?.close());

  /** The API's HTTP server, as the controller reaches it: onUpgrade is all it adds. */
  const listen = async (internals: Internals) => {
    server = http.createServer((_req, res) => res.end());
    server.on('upgrade', internals.onUpgrade);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  };

  /** Dial in as the controller does: the upgrade request, and nothing until it is switched over. */
  const dial = (port: number, path = '/terpcam/relay', upgrade = 'terpcam-relay') =>
    new Promise<{ conn: net.Socket; status: string }>((resolve, reject) => {
      const conn = net.connect(port, '127.0.0.1');
      conn.on('error', reject);
      conn.write(`GET ${path} HTTP/1.1\r\nHost: relay\r\nUpgrade: ${upgrade}\r\nConnection: Upgrade\r\n\r\n`);
      let head = '';
      const onData = (chunk: Buffer) => {
        head += chunk.toString('latin1');
        if (!head.includes('\r\n\r\n')) return;
        conn.off('data', onData);
        resolve({ conn, status: head.split('\r\n')[0] });
      };
      conn.on('data', onData);
    });

  it('turns away an upgrade that is not a relay', async () => {
    const port = await listen(serviceFor() as unknown as Internals);
    await expect(dial(port, '/terpcam/relay', 'websocket')).resolves.toMatchObject({ status: 'HTTP/1.1 404 Not Found' });
    await expect(dial(port, '/device')).resolves.toMatchObject({ status: 'HTTP/1.1 404 Not Found' });
  });

  it('enciphers both directions and tells the controller when the cloud is done', async () => {
    const asked: RelayAsked[] = [];
    const service = serviceFor((deviceId, relay) => deviceId === DEVICE && asked.push(relay) > 0);
    const internals = service as unknown as Internals;
    const port = await listen(internals);

    const relay = internals.relayConnect(DEVICE);
    const { url, token, key } = asked[0];
    expect(url).toBe(RELAY_CONFIG.relayUrl);
    const keys = Buffer.from(key, 'hex');
    const up = createCipheriv('aes-128-ctr', keys.subarray(0, 16), Buffer.alloc(16));
    const down = createDecipheriv('aes-128-ctr', keys.subarray(16), Buffer.alloc(16));

    // The controller: its header, and the camera's first datagram right behind it.
    const { conn: controller, status } = await dial(port);
    expect(status).toBe('HTTP/1.1 101 Switching Protocols');
    const did = Buffer.from('VSTH00000828707TXVEW', 'latin1');
    const header = Buffer.concat([Buffer.from(token, 'latin1'), Buffer.from([0]), up.update(did)]);
    const fromCamera = Buffer.from('a camera datagram');
    controller.write(Buffer.concat([u16(header.length), header, up.update(Buffer.concat([u16(fromCamera.length), fromCamera]))]));

    const socket = await relay;
    expect(socket.did).toEqual(did);
    await expect(new Promise(resolve => socket.on('message', resolve))).resolves.toEqual(fromCamera);

    // The controller hangs up once it reads the empty frame, as the firmware does.
    const onTheWire: Buffer[] = [];
    const received: Buffer[] = [];
    const toCamera = Buffer.from('a CGI with the password in it');
    const done = Buffer.concat([u16(toCamera.length), toCamera, u16(0)]);
    controller.on('data', chunk => {
      onTheWire.push(chunk);
      received.push(down.update(chunk));
      if (Buffer.concat(received).equals(done)) controller.end();
    });
    let hungUp = false;
    controller.on('end', () => (hungUp = true));
    socket.send(toCamera);
    await socket.close();

    // The server waits for the controller rather than closing first.
    expect(hungUp).toBe(false);
    expect(Buffer.concat(onTheWire).includes(toCamera)).toBe(false);
    expect(Buffer.concat(received)).toEqual(done);
  });

  it('gives up on a dial-in that does not arrive in time', async () => {
    const service = serviceFor();
    const internals = service as unknown as Internals;

    jest.useFakeTimers();
    try {
      const late = internals.relayConnect(DEVICE);
      jest.advanceTimersByTime(45_000);
      await expect(late).rejects.toThrow('did not open the relay in time');
    } finally {
      jest.useRealTimers();
    }
  });
});
