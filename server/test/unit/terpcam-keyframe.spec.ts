import { buildAck, deobfuscate, FragmentAssembly, TerpCamDirectService } from '@modules/v1/camera/terpcam-direct.service';

/**
 * The keyframe transfer against a camera that behaves as the real one was
 * measured to: a DrwAck acknowledges exactly the indices it names, and the
 * oldest DRW still unacknowledged is sent again every ~40ms. The controller's
 * relay loses a fragment of the burst now and then; these check that the
 * keyframe is repaired rather than given up for the next one of the GOP.
 */

const VIDEO_CHANNEL = 1;
const FRAGMENT_BYTES = 1000;

/** One VStarcam media frame: 32-byte header (magic, length at 16) around H.264 with SPS and an IDR slice. */
function keyframe(bytes: number): Buffer {
  const h264 = Buffer.alloc(bytes, 0x42);
  Buffer.from([0, 0, 0, 1, 0x67]).copy(h264, 0);
  Buffer.from([0, 0, 0, 1, 0x65]).copy(h264, 64);
  const header = Buffer.alloc(32);
  Buffer.from([0x55, 0xaa, 0x15, 0xa8]).copy(header, 0);
  header.writeUInt32LE(h264.length, 16);
  return Buffer.concat([header, h264]);
}

/** A video DRW as the client reads it (after deobfuscation). */
function drw(index: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xf1, 0xd0, 0, 0, 0xd1, VIDEO_CHANNEL, index >> 8, index & 0xff]);
  head.writeUInt16BE(payload.length + 4, 2);
  return Buffer.concat([head, payload]);
}

type Session = { socket: { send(msg: Buffer): void }; peer: { address: string; port: number }; inbox: unknown[]; auth: string; next: number };
type Internals = { readKeyframe(session: Session): Promise<Buffer | null>; login(...args: unknown[]): Promise<void> };

/**
 * The camera: on `livestream.cgi` it bursts the keyframe, dropping the fragments
 * in `lost` the first time round, then keeps resending the oldest unacked one.
 * `stallMs` holds everything after the burst back, as a link that stalls does.
 * `stuck` is lost for good - the link drops every resend of it - while the
 * stream goes on and the GOP's next keyframe comes `nextKeyframeMs` later.
 */
function camera(frame: Buffer, lost: number[], options: { stallMs?: number; stuck?: number; nextKeyframeMs?: number } = {}) {
  const fragments: Buffer[] = [];
  for (let at = 0; at < frame.length; at += FRAGMENT_BYTES) fragments.push(frame.subarray(at, at + FRAGMENT_BYTES));
  const acked = new Set<number>();
  const sent: number[] = [];
  const timers: NodeJS.Timeout[] = [];
  const session: Session = { socket: { send: () => undefined }, peer: { address: 'relay', port: 1 }, inbox: [], auth: '', next: 1 };
  const deliver = (index: number) => {
    sent.push(index);
    if (index !== options.stuck) session.inbox.push({ message: drw(index, fragments[index]), from: session.peer });
  };
  session.socket.send = (msg: Buffer) => {
    const m = deobfuscate(msg);
    if (m[1] === 0xd0 && m.toString('latin1').includes('livestream.cgi?streamid=10')) {
      fragments.forEach((_, index) => lost.includes(index) || deliver(index));
      const resend = () => {
        const oldest = fragments.findIndex((_, index) => !acked.has(index));
        if (oldest >= 0) deliver(oldest);
        // The stream goes on behind the keyframe, and its next keyframe follows.
        if (options.nextKeyframeMs !== undefined) {
          const index = fragments.length;
          fragments.push(Date.now() - streamed >= options.nextKeyframeMs ? frame : Buffer.alloc(FRAGMENT_BYTES, 0x11));
          deliver(index);
        }
      };
      const streamed = Date.now();
      timers.push(setTimeout(() => timers.push(setInterval(resend, 40)), options.stallMs ?? 0));
    }
    if (m[1] === 0xd1 && m[5] === VIDEO_CHANNEL) {
      for (let i = 0; i < m.readUInt16BE(6); i++) acked.add(m.readUInt16BE(8 + 2 * i));
    }
  };
  return { session, sent, acked, stop: () => timers.forEach(timer => clearInterval(timer)) };
}

function service(): Internals {
  return new TerpCamDirectService({} as never, {} as never, { relayUrl: 'http://relay.invalid' } as never, {} as never) as unknown as Internals;
}

describe('the keyframe transfer', () => {
  it('repairs a keyframe whose first fragment was lost', async () => {
    const frame = keyframe(45_000);
    const cam = camera(frame, [0, 17]);
    try {
      const started = Date.now();
      await expect(service().readKeyframe(cam.session)).resolves.toEqual(frame.subarray(32));
      expect(Date.now() - started).toBeLessThan(2_000);
      // Every fragment was acked, so only the lost ones came twice.
      expect(cam.sent.length).toBeLessThan(Math.ceil(frame.length / FRAGMENT_BYTES) + 6);
    } finally {
      cam.stop();
    }
  });

  it('still repairs it when the link stalls for longer than a gap is given', async () => {
    // Nothing arrives for 4s, the resend included; it comes once the link recovers.
    const frame = keyframe(45_000);
    const cam = camera(frame, [0, 17], { stallMs: 4_000 });
    try {
      await expect(service().readKeyframe(cam.session)).resolves.toEqual(frame.subarray(32));
    } finally {
      cam.stop();
    }
  });

  it('gives up a gap that does not close while the stream goes on, and takes the next keyframe', async () => {
    const frame = keyframe(30_000);
    const cam = camera(frame, [], { stuck: 5, nextKeyframeMs: 4_000 });
    try {
      const started = Date.now();
      await expect(service().readKeyframe(cam.session)).resolves.toEqual(frame.subarray(32));
      expect(Date.now() - started).toBeGreaterThan(4_000);
    } finally {
      cam.stop();
    }
  });

  it('acks every fragment it receives', async () => {
    const frame = keyframe(30_000);
    const cam = camera(frame, []);
    try {
      await service().readKeyframe(cam.session);
      expect(cam.acked.size).toBe(Math.ceil(frame.length / FRAGMENT_BYTES));
    } finally {
      cam.stop();
    }
  });
});

describe('FragmentAssembly', () => {
  const part = (s: string) => Buffer.from(s);

  it('restarts the run at a fragment resent from before the first one seen', () => {
    const assembly = new FragmentAssembly();
    expect(assembly.add(11, part('b'))).toBe(true);
    expect(assembly.add(12, part('c'))).toBe(true);
    expect(assembly.add(10, part('a'))).toBe(true);
    expect(assembly.contiguous().toString()).toBe('abc');
  });

  it('waits at a gap and closes it when the fragment comes', () => {
    const assembly = new FragmentAssembly();
    assembly.add(0, part('a'));
    expect(assembly.add(2, part('c'))).toBe(false);
    expect(assembly.contiguous().toString()).toBe('a');
    expect(assembly.add(1, part('b'))).toBe(true);
    expect(assembly.contiguous().toString()).toBe('abc');
  });

  it('follows the index across its wrap', () => {
    const assembly = new FragmentAssembly();
    assembly.add(0, part('b'));
    assembly.add(0xffff, part('a'));
    assembly.add(1, part('c'));
    expect(assembly.contiguous().toString()).toBe('abc');
  });
});

it('names every index in one DrwAck', () => {
  const ack = deobfuscate(buildAck(VIDEO_CHANNEL, [3, 7, 0x1234]));
  expect([...ack]).toEqual([0xf1, 0xd1, 0, 10, 0xd1, VIDEO_CHANNEL, 0, 3, 0, 3, 0, 7, 0x12, 0x34]);
});

describe('the login', () => {
  const login = (socket: { send(msg: Buffer): void }, inbox: unknown[]) =>
    service().login(socket, inbox, Buffer.alloc(20), { address: 'relay', port: 1 }, '', 'AAC2851962SPLP');

  it('gives up on a camera that never answers, saying so', async () => {
    const started = Date.now();
    await expect(login({ send: () => undefined }, [])).rejects.toThrow('camera did not accept the session (nothing back in 10s)');
    expect(Date.now() - started).toBeLessThan(12_000);
  });

  it('waits out a choppy link that holds the first answer back for seconds', async () => {
    // Two lost TCP segments on the relay: ~3s and then ~6s before a resend gets through.
    const inbox: unknown[] = [];
    const reply = Buffer.from('result= 0;var realdeviceid="AAC2851962SPLP";', 'latin1');
    const head = Buffer.from([0xf1, 0xd0, 0, 0, 0xd1, 0, 0, 0]);
    head.writeUInt16BE(reply.length + 4, 2);
    const timer = setTimeout(() => inbox.push({ message: Buffer.concat([head, reply]), from: { address: 'relay', port: 1 } }), 8_000);
    try {
      await expect(login({ send: () => undefined }, inbox)).resolves.toBeUndefined();
    } finally {
      clearTimeout(timer);
    }
  });
});
