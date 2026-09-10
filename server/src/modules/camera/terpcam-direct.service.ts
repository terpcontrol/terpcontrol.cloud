import dgram from 'node:dgram';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigType } from '@nestjs/config';
import { Document, Model } from 'mongoose';
import { Device } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { terpCamConfig } from '../../config/configuration';
import { MODEL } from '../../database/models.module';
import { TerpCamService } from './terpcam.service';

/**
 * Terp Cam stills, fetched by the server itself over the camera's P2P protocol.
 *
 * The camera is found through the manufacturer's rendezvous (once per session,
 * not per image) and the session is then held open. Full resolution comes from
 * the main video stream: `snapshot.cgi` renders from the MJPEG encoder and is
 * pinned at 640x360 on this firmware, while the stream carries 2304x1296.
 *
 * With no rendezvous configured the server reaches no camera itself and every
 * capture is relayed by its controller instead (terpcam-p2p.service).
 *
 * Protocol details: docs/terpcam-reverse-engineering.md §26.
 */

/** Substitution table for the transport cipher (vendor constant). */
// prettier-ignore
const SBOX = Buffer.from([
  0x7c,0x9c,0xe8,0x4a,0x13,0xde,0xdc,0xb2,0x2f,0x21,0x23,0xe4,0x30,0x7b,0x3d,0x8c,
  0xbc,0x0b,0x27,0x0c,0x3c,0xf7,0x9a,0xe7,0x08,0x71,0x96,0x00,0x97,0x85,0xef,0xc1,
  0x1f,0xc4,0xdb,0xa1,0xc2,0xeb,0xd9,0x01,0xfa,0xba,0x3b,0x05,0xb8,0x15,0x87,0x83,
  0x28,0x72,0xd1,0x8b,0x5a,0xd6,0xda,0x93,0x58,0xfe,0xaa,0xcc,0x6e,0x1b,0xf0,0xa3,
  0x88,0xab,0x43,0xc0,0x0d,0xb5,0x45,0x38,0x4f,0x50,0x22,0x66,0x20,0x7f,0x07,0x5b,
  0x14,0x98,0x1d,0x9b,0xa7,0x2a,0xb9,0xa8,0xcb,0xf1,0xfc,0x49,0x47,0x06,0x3e,0xb1,
  0x0e,0x04,0x3a,0x94,0x5e,0xee,0x54,0x11,0x34,0xdd,0x4d,0xf9,0xec,0xc7,0xc9,0xe3,
  0x78,0x1a,0x6f,0x70,0x6b,0xa4,0xbd,0xa9,0x5d,0xd5,0xf8,0xe5,0xbb,0x26,0xaf,0x42,
  0x37,0xd8,0xe1,0x02,0x0a,0xae,0x5f,0x1c,0xc5,0x73,0x09,0x4e,0x69,0x24,0x90,0x6d,
  0x12,0xb3,0x19,0xad,0x74,0x8a,0x29,0x40,0xf5,0x2d,0xbe,0xa5,0x59,0xe0,0xf4,0x79,
  0xd2,0x4b,0xce,0x89,0x82,0x48,0x84,0x25,0xc6,0x91,0x2b,0xa2,0xfb,0x8f,0xe9,0xa6,
  0xb0,0x9e,0x3f,0x65,0xf6,0x03,0x31,0x2e,0xac,0x0f,0x95,0x2c,0x5c,0xed,0x39,0xb7,
  0x33,0x6c,0x56,0x7e,0xb4,0xa0,0xfd,0x7a,0x81,0x53,0x51,0x86,0x8d,0x9f,0x77,0xff,
  0x6a,0x80,0xdf,0xe2,0xbf,0x10,0xd7,0x75,0x64,0x57,0x76,0xf3,0x55,0xcd,0xd0,0xc8,
  0x18,0xe6,0x36,0x41,0x62,0xcf,0x99,0xf2,0x32,0x4c,0x67,0x60,0x61,0x92,0xca,0xd3,
  0xea,0x63,0x7d,0x16,0xb6,0x8e,0xd4,0x68,0x35,0xc3,0x52,0x9d,0x46,0x44,0x1e,0x17,
]);
const DK = [44, 212, 96, 6];

const RENDEZVOUS_PORTS = [32100, 32101, 32102];
const RENDEZVOUS_MS = 20_000;

/** Manufacturer default, for cameras paired before per-camera passwords, or reset since. */
const DEFAULT_PASSWORD = '888888';

function authFor(password: string): string {
  const pw = encodeURIComponent(password);
  return `name=admin&loginuse=admin&loginpas=${pw}&user=admin&pwd=${pw}&`;
}

const CMD_CHANNEL = 0;
const VIDEO_CHANNEL = 1;
const FRAME_MAGIC = Buffer.from([0x55, 0xaa, 0x15, 0xa8]);

const LOGIN_MS = 8_000;
const TRANSFER_MS = 20_000;
const IDLE_MS = 5_000;
/** A gap this old will not close; take the next keyframe instead of repairing. */
const GAP_ABANDON_MS = 1_200;
/** How often to exchange keepalives on an idle held session. */
const ALIVE_MS = 2_000;
/** Give an unused session back — the camera only allows a few at a time. */
const SESSION_IDLE_MS = 10 * 60_000;
/** A malfunctioning camera must not stream without end. */
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

type Endpoint = { address: string; port: number };
type Inbox = { message: Buffer; from: Endpoint }[];
type Camera = { label: string; uid?: string; password?: string };
type Session = {
  socket: dgram.Socket;
  peer: Endpoint;
  inbox: Inbox;
  auth: string;
  /** Channel-0 request index; must advance by exactly one per request. */
  next: number;
  idle?: NodeJS.Timeout;
  alive?: NodeJS.Timeout;
};

/** Every send is fire-and-forget; errors surface as the session going quiet. */
function send(socket: dgram.Socket, to: Endpoint, packet: Buffer): void {
  socket.send(packet, to.port, to.address, () => undefined);
}

/** Symmetric table cipher: `prev` is always the ciphertext byte. */
function obfuscate(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = SBOX[(DK[prev & 3] + prev) & 0xff] ^ buf[i];
    out[i] = c;
    prev = c;
  }
  return out;
}

function deobfuscate(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    out[i] = SBOX[(DK[prev & 3] + prev) & 0xff] ^ c;
    prev = c;
  }
  return out;
}

function buildPacket(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xf1;
  head[1] = type;
  head.writeUInt16BE(payload.length, 2);
  return obfuscate(Buffer.concat([head, payload]));
}

/** DRW data packet carrying an HTTP-style CGI request on `channel`. */
function buildCgi(channel: number, index: number, cgi: string): Buffer {
  const body = Buffer.from('GET /' + cgi, 'latin1');
  const inner = Buffer.alloc(12);
  inner[0] = 0xd1;
  inner[1] = channel;
  inner.writeUInt16BE(index, 2);
  inner[4] = 0x01;
  inner[5] = 0x0a;
  inner.writeUInt32LE(body.length, 8);
  const head = Buffer.alloc(4);
  head[0] = 0xf1;
  head[1] = 0xd0;
  head.writeUInt16BE(inner.length + body.length, 2);
  return obfuscate(Buffer.concat([head, inner, body]));
}

function buildAck(channel: number, index: number): Buffer {
  const body = Buffer.alloc(6);
  body[0] = 0xd1;
  body[1] = channel;
  body.writeUInt16BE(1, 2);
  body.writeUInt16BE(index & 0xffff, 4);
  return buildPacket(0xd1, body);
}

/** `VSTH581824TJXUG` / `VSTH-581824-TJXUG` -> the 20-byte packed wire form. */
export function packDeviceId(uid: string): Buffer {
  const plain = uid.replace(/-/g, '');
  const prefix = plain.slice(0, 4);
  const suffix = plain.slice(-5);
  const number = plain.slice(4, -5);
  if (!/^[A-Za-z]{4}$/.test(prefix) || !/^\d+$/.test(number)) {
    throw new Error(`not a P2P device id: ${uid}`);
  }
  const out = Buffer.alloc(20);
  out.write(prefix, 0, 'latin1');
  out.writeBigUInt64BE(BigInt(number), 4);
  out.write(suffix, 12, 'latin1');
  return out;
}

/** RFC1918, i.e. an address that only means something on our own network. */
/** The inclusive range of UDP ports to bind, ignoring a range that makes no sense. */
function portRange(from: number, to: number): number[] {
  if (!Number.isInteger(from) || from <= 0 || from > 65535) return [];
  const last = Number.isInteger(to) && to >= from && to <= 65535 ? to : from;
  return Array.from({ length: last - from + 1 }, (_, index) => from + index);
}

function isPrivate(address: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}

/**
 * Our own address on the route to `host`, if private. Asked of the routing table
 * rather than picking the first private interface, because a developer machine
 * has several (VM bridges, second NIC) and only one that reaches the camera.
 */
function routableAddress(host: string): Promise<string | null> {
  return new Promise(resolve => {
    const probe = dgram.createSocket('udp4');
    const done = (address: string | null) => {
      try {
        probe.close();
      } catch {
        /* already closed */
      }
      resolve(address);
    };
    probe.once('error', () => done(null));
    // A connected UDP socket sends nothing; it just fixes the source address.
    probe.connect(32100, host, () => {
      const address = probe.address()?.address ?? null;
      done(address && isPrivate(address) ? address : null);
    });
  });
}

/** Wire addresses are `u16 family, u16 port (BE), u32 ip (LE)`. */
function parseAddress(body: Buffer, offset = 0): Endpoint | null {
  if (body.length < offset + 8) return null;
  const port = body.readUInt16BE(offset + 2);
  const ip = [body[offset + 7], body[offset + 6], body[offset + 5], body[offset + 4]].join('.');
  if (!port || ip.startsWith('0.')) return null;
  return { address: ip, port };
}

@Injectable()
export class TerpCamDirectService implements OnApplicationShutdown {
  /** The lookup servers, the address advertised to a camera, and the ports held. */
  private readonly rendezvousHosts: string[];
  private readonly advertiseAddress: string | null;
  private readonly p2pPorts: number[];

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    private readonly stills: TerpCamService,
    @Inject(terpCamConfig.KEY) config: ConfigType<typeof terpCamConfig>,
  ) {
    this.rendezvousHosts = config.rendezvousHosts;
    this.advertiseAddress = config.advertiseAddress && isPrivate(config.advertiseAddress) ? config.advertiseAddress : null;
    this.p2pPorts = portRange(config.portsStart, config.portsEnd);
  }

  /**
   * A session holds a bound UDP socket and a heartbeat, which is what a camera
   * counts as one of the few connections it allows. Giving them back on the way
   * down also lets the process end rather than being killed for still having
   * handles open.
   */
  public onApplicationShutdown(): void {
    for (const deviceId of [...this.sessions.keys()]) {
      this.dropSession(deviceId);
    }
  }

  /**
   * Keyed by DEVICE and only ever written from that device's own hardware-info.
   * This is the tenant boundary: a stream setting naming somebody else's camera
   * gets no id, no password and no session.
   */
  private cameras = new Map<string, Camera>();

  /**
   * One live session per camera, held between captures — that is what keeps the
   * rendezvous to once per session rather than once per image. Caching the
   * punched address instead does not work: each session gets a different port.
   */
  private sessions = new Map<string, Session>();

  /** The camera a device says is its own. `none` forgets it. */
  public rememberCamera(deviceId: string, label: string): void {
    if (!label || label === 'none') {
      this.cameras.delete(deviceId);
      return;
    }
    const known = this.cameras.get(deviceId);
    // A different camera means the old id and password are meaningless.
    this.cameras.set(deviceId, known?.label === label ? known : { label });
  }

  /** Empty means the camera still has the manufacturer's default. */
  public rememberPassword(deviceId: string, password: string): void {
    const camera = this.cameras.get(deviceId);
    if (camera) camera.password = password || undefined;
  }

  /** The camera's P2P id, read off the camera by its controller. */
  public rememberUid(deviceId: string, uid: string): void {
    const camera = this.cameras.get(deviceId);
    if (camera && uid && uid !== 'none') camera.uid = uid;
  }

  /**
   * Bind to a published port, falling back to an ephemeral one. The camera
   * punches from an address we never sent to, so a bridge has no conntrack entry
   * and drops it unless the port is published (measured: bridge 0/3, published 3/3).
   */
  private async bind(socket: dgram.Socket): Promise<void> {
    for (const port of this.p2pPorts) {
      const bound = await new Promise<boolean>(resolve => {
        const onError = () => resolve(false);
        socket.once('error', onError);
        socket.bind(port, () => {
          socket.removeListener('error', onError);
          resolve(true);
        });
      });
      if (bound) return;
    }
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => resolve());
    });
  }

  /**
   * Read back from the device record when not in memory: devices report at boot,
   * so a restarted server would otherwise be blind until every controller rebooted.
   */
  private async cameraFor(deviceId: string): Promise<Camera | null> {
    const known = this.cameras.get(deviceId);
    if (known?.uid) return known;

    const device = await this.devices.findOne({ device_id: deviceId });
    const info = device?.hardwareInfo;
    const label = info?.webcam_did;
    if (!label || label === 'none' || !info?.webcam_uid) return null;

    const camera = { label, uid: info.webcam_uid, password: info.webcam_pwd || undefined };
    this.cameras.set(deviceId, camera);
    return camera;
  }

  /**
   * Send a CGI on the command channel. The index MUST advance by exactly one:
   * skip a number and the camera stops responding, silently and permanently.
   */
  private request(session: Session, cgi: string): void {
    send(session.socket, session.peer, buildCgi(CMD_CHANNEL, session.next++, cgi));
  }

  /**
   * Answer the camera's keepalives between captures. Without this nobody reads
   * the socket in the gaps, the camera drops the session, and the lookup rate
   * goes from one per session to one per 1.6 images (measured).
   */
  private startHeartbeat(session: Session): NodeJS.Timeout {
    const timer = setInterval(() => {
      // Nothing queued between captures is worth keeping.
      for (const entry of session.inbox.splice(0, session.inbox.length)) {
        if (entry.message.length > 1 && entry.message[1] === 0xe0) send(session.socket, session.peer, buildPacket(0xe1));
      }
      send(session.socket, session.peer, buildPacket(0xe0));
    }, ALIVE_MS);
    timer.unref?.();
    return timer;
  }

  /** Close a held session: stop its stream, say goodbye, free the camera's slot. */
  private dropSession(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) return;
    clearTimeout(session.idle);
    clearInterval(session.alive);
    try {
      this.request(session, `livestream.cgi?streamid=16&substream=0&${session.auth}`);
      send(session.socket, session.peer, buildPacket(0xf0));
    } catch {
      /* socket already gone */
    }
    try {
      session.socket.close();
    } catch {
      /* already closed */
    }
    this.sessions.delete(deviceId);
  }

  /** The camera allows only a few sessions, so an unused one is given back. */
  private touchSession(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) return;
    clearTimeout(session.idle);
    session.idle = setTimeout(() => this.dropSession(deviceId), SESSION_IDLE_MS);
    session.idle.unref?.();
  }

  /** Open a session (one rendezvous) or reuse the one already held. */
  private async session(deviceId: string, camera: { uid: string; password?: string }) {
    const existing = this.sessions.get(deviceId);
    if (existing) return existing;

    const did = packDeviceId(camera.uid);
    const socket = dgram.createSocket('udp4');
    const inbox: Inbox = [];
    socket.on('message', (message, rinfo) => {
      inbox.push({ message: deobfuscate(message), from: { address: rinfo.address, port: rinfo.port } });
    });
    socket.on('error', () => undefined);

    try {
      await this.bind(socket);
      const punched = await this.rendezvous(socket, inbox, did);
      const auth = authFor(camera.password ?? DEFAULT_PASSWORD);
      // login consumes channel-0 index 0, so requests continue from 1
      await this.login(socket, inbox, did, punched, auth);
      const session: Session = { socket, peer: punched, inbox, auth, next: 1 };
      session.alive = this.startHeartbeat(session);
      this.sessions.set(deviceId, session);
      this.touchSession(deviceId);
      logger.info(`[terpcam] ${deviceId}: session opened (one rendezvous, reused for later stills)`);
      return session;
    } catch (error) {
      try {
        socket.close();
      } catch {
        /* never opened */
      }
      throw error;
    }
  }

  /**
   * Whether this server can go for the camera itself at all: a rendezvous to ask
   * and a camera the device has reported. Where it cannot, the controller is not
   * a fallback but the only path there is, and a caller should not spend failed
   * attempts before taking it.
   */
  public async canReachCamera(deviceId: string): Promise<boolean> {
    if (!this.rendezvousHosts.length) return false;
    return !!(await this.cameraFor(deviceId))?.uid;
  }

  /** Pull one still as a ready JPEG, decoding the keyframe when there is one. */
  public async captureStill(deviceId: string): Promise<Buffer> {
    const { data, h264 } = await this.capture(deviceId);
    if (!h264) return data;
    const jpeg = await this.stills.decodeKeyframeToJpeg(data);
    logger.info(`[terpcam] ${deviceId}: ${data.length}B keyframe -> ${jpeg.length}B jpeg`);
    return jpeg;
  }

  /**
   * The keepalive stands down while reading: it and the reader drain the same
   * inbox, so leaving it running would let it swallow video fragments.
   */
  private async readStill(deviceId: string, identity: { uid: string; password?: string }): Promise<Buffer | undefined> {
    const session = await this.session(deviceId, identity);
    clearInterval(session.alive);
    try {
      return await this.readKeyframe(session);
    } finally {
      if (this.sessions.get(deviceId) === session) {
        session.alive = this.startHeartbeat(session);
      }
    }
  }

  /**
   * Pull one still, always a full-resolution H.264 keyframe. There is no
   * `snapshot.cgi` fallback: it only returns 640x360, and a capture that cannot
   * produce the real image is better handed to the controller than downgraded.
   */
  public async capture(deviceId: string): Promise<{ data: Buffer; h264: boolean }> {
    // Always the camera this device reported, never one the caller named.
    const camera = await this.cameraFor(deviceId);
    if (!camera?.uid) {
      throw new Error('this device has not reported a camera we can reach');
    }
    if (!this.rendezvousHosts.length) {
      throw new Error('TERPCAM_RENDEZVOUS_HOSTS is unset, so cameras can only be reached by their controller');
    }
    const identity = { uid: camera.uid, password: camera.password };

    // A held session that has gone stale fails exactly like a broken one, so a
    // reused session gets a second attempt on a freshly opened one.
    const attempts = this.sessions.has(deviceId) ? 2 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const keyframe = await this.readStill(deviceId, identity);
        if (!keyframe) throw new Error('no keyframe arrived');
        this.touchSession(deviceId);
        return { data: keyframe, h264: true };
      } catch (error) {
        this.dropSession(deviceId);
        if (attempt >= attempts) throw error;
        logger.info(`[terpcam] ${deviceId}: held session went stale, opening a new one`);
      }
    }
  }

  private async rendezvous(socket: dgram.Socket, inbox: Inbox, did: Buffer): Promise<Endpoint> {
    // Held in an object because both are assigned from inside a callback.
    const found: { reflected: Endpoint | null; punched: Endpoint | null } = { reflected: null, punched: null };

    // 1. Hello, to learn our own public endpoint.
    const helloUntil = Date.now() + 4_000;
    while (!found.reflected && Date.now() < helloUntil) {
      for (const host of this.rendezvousHosts) send(socket, { address: host, port: 32100 }, buildPacket(0x00));
      await this.drain(inbox, 700, entry => {
        if (entry.message.length >= 12 && entry.message[1] === 0x01) {
          found.reflected = parseAddress(entry.message.subarray(4));
        }
        return false;
      });
    }

    // 2. Ask for the camera.
    const body = Buffer.concat([did, Buffer.alloc(16)]);
    body.writeUInt16BE(found.reflected?.port ?? 0, 22);
    const lan = this.advertiseAddress ?? (await routableAddress(this.rendezvousHosts[0]));
    if (lan) {
      // Stored least-significant octet first, like every other address here.
      const octets = lan.split('.').map(Number).reverse();
      Buffer.from(octets).copy(body, 24);
    }

    const until = Date.now() + RENDEZVOUS_MS;
    while (!found.punched && Date.now() < until) {
      for (const host of this.rendezvousHosts) {
        for (const port of RENDEZVOUS_PORTS) send(socket, { address: host, port }, buildPacket(0x20, body));
      }
      await this.drain(inbox, 2_500, entry => {
        const isPunch = entry.message.length > 1 && entry.message[1] === 0x41;
        if (isPunch && !RENDEZVOUS_PORTS.includes(entry.from.port)) {
          found.punched = entry.from;
          return true;
        }
        return false;
      });
    }

    const peer = found.punched;
    if (!peer) throw new Error('camera did not answer the rendezvous');

    logger.info(`[terpcam] camera punched from ${peer.address}:${peer.port}`);
    send(socket, peer, buildPacket(0x41, did));
    return peer;
  }

  /** Authenticate the punched session. */
  private async login(socket: dgram.Socket, inbox: Inbox, did: Buffer, peer: Endpoint, auth: string): Promise<void> {
    const trailer = Buffer.from([0x00, 0x02, 0x12, 0x64, 0x10, 0x02, 0x00, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const devlgn = Buffer.concat([did, trailer]);
    const until = Date.now() + LOGIN_MS;
    while (Date.now() < until) {
      for (const packet of [buildPacket(0x00), buildPacket(0x05, did), buildPacket(0x20, devlgn), buildPacket(0x41, did)]) {
        send(socket, peer, packet);
      }
      send(socket, peer, buildCgi(CMD_CHANNEL, 0, `get_status.cgi?${auth}`));

      let authed = false;
      await this.drain(inbox, 1_000, entry => {
        const m = entry.message;
        if (m.length >= 4 && (m[1] === 0x42 || m[1] === 0x43)) {
          send(socket, entry.from, obfuscate(m));
          return false;
        }
        if (m.length >= 8 && m[1] === 0xd0 && m[5] === CMD_CHANNEL) {
          authed = true;
          return true;
        }
        return false;
      });
      if (authed) return;
    }
    throw new Error('camera did not accept the session');
  }

  /**
   * Take a full-resolution keyframe off the video stream, leaving the session
   * open. Two things here are load-bearing and each was measured:
   *
   * - EVERY frame is examined, not just the first: a restarted stream begins
   *   mid-GOP, so the IDR is usually not the first frame to arrive.
   * - A stalled gap is ABANDONED, not re-acked. Re-acking is a resend request in
   *   this protocol, so pressing it triggers a go-back-N flood; the next IDR is
   *   a second away, which is cheaper.
   */
  private async readKeyframe(session: Session): Promise<Buffer | null> {
    const { socket, peer, inbox, auth } = session;
    inbox.length = 0;
    this.request(session, `livestream.cgi?streamid=10&substream=2&${auth}`);

    let slots = new Map<number, Buffer>();
    let base: number | null = null;
    let contiguous = 0;
    const started = Date.now();
    let lastData = Date.now();
    let lastProgress = Date.now();

    while (Date.now() - started < TRANSFER_MS && Date.now() - lastData < IDLE_MS) {
      const found: { frame: Buffer | null } = { frame: null };
      await this.drain(inbox, 300, entry => {
        const m = entry.message;
        if (m.length < 8) return false;
        if (m[1] === 0xe0) {
          send(socket, peer, buildPacket(0xe1));
          return false;
        }
        if (m[1] !== 0xd0 || m[5] !== VIDEO_CHANNEL) return false;

        const index = m.readUInt16BE(6);
        const declared = m.readUInt16BE(2);
        let length = declared - 4;
        if (length <= 0 || length > m.length - 8) length = m.length - 8;
        if (length <= 0) return false;

        lastData = Date.now();
        if (base === null) base = index;
        const slot = (index - base) & 0xffff;
        if (slot > 0x8000) return false;
        if (!slots.has(slot)) slots.set(slot, m.subarray(8, 8 + length));

        const before = contiguous;
        while (slots.has(contiguous)) contiguous++;
        if (contiguous === before) return false;

        lastProgress = Date.now();
        send(socket, peer, buildAck(VIDEO_CHANNEL, (base + contiguous - 1) & 0xffff));

        const buffered = Buffer.concat([...Array(contiguous).keys()].map(i => slots.get(i)));
        const frame = this.findKeyframe(buffered);
        if (frame) {
          found.frame = frame;
          return true;
        }
        return false;
      });
      if (found.frame) {
        // Stop the stream; the SESSION stays open for the next still.
        this.request(session, `livestream.cgi?streamid=16&substream=0&${auth}`);
        return found.frame;
      }
      if (Date.now() - lastProgress > GAP_ABANDON_MS) {
        slots = new Map();
        base = null;
        contiguous = 0;
        lastProgress = Date.now();
      }
    }
    return null;
  }

  /** The first frame in the buffer carrying SPS and an IDR slice, if any. */
  private findKeyframe(buffer: Buffer): Buffer | null {
    let offset = 0;
    for (;;) {
      const start = buffer.indexOf(FRAME_MAGIC, offset);
      if (start < 0 || buffer.length < start + 32) return null;
      const length = buffer.readUInt32LE(start + 16);
      if (!(length > 0 && length < MAX_FRAME_BYTES)) return null;
      if (buffer.length < start + 32 + length) return null;
      const payload = buffer.subarray(start + 32, start + 32 + length);
      if (this.isKeyframe(payload)) return Buffer.from(payload);
      offset = start + 32 + length;
    }
  }

  /** Usable as a still only with SPS (NAL 7) and an IDR slice (NAL 5). */
  private isKeyframe(payload: Buffer): boolean {
    let sps = false;
    let idr = false;
    for (let i = 0; i + 4 < payload.length; i++) {
      if (payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 0 && payload[i + 3] === 1) {
        const nal = payload[i + 4] & 0x1f;
        if (nal === 7) sps = true;
        if (nal === 5) idr = true;
        if (sps && idr) return true;
      }
    }
    return false;
  }

  /** Consume queued datagrams for up to `ms`, stopping early if `handler` says so. */
  private async drain(inbox: Inbox, ms: number, handler: (entry: Inbox[number]) => boolean): Promise<void> {
    const until = Date.now() + ms;
    for (;;) {
      while (inbox.length) {
        const entry = inbox.shift();
        if (entry && handler(entry)) return;
      }
      if (Date.now() >= until) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
}
