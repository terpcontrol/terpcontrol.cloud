import dgram from 'node:dgram';
import { logger } from '@utils/logger';
import { terpCamService } from '@services/terpcam.service';
import deviceModel from '@models/device.model';

/**
 * Terp Cam stills, fetched by the server itself.
 *
 * The controller path (terpcam-p2p.service) exists because the camera was thought
 * to be reachable only from the controller. It is not — the server can open the
 * session itself, and the controller drops out of the image path.
 *
 * That matters for more than tidiness. Over this path nothing is lost — a
 * keyframe arrives in as many fragments as it has — where the controller needs
 * 3-10x that many for the same image and still fails one capture in six. It is
 * also what makes FULL RESOLUTION possible: `snapshot.cgi` renders from the
 * MJPEG encoder and is pinned at 640x360 on this firmware, while the main video
 * stream carries 2304x1296. Taking one H.264 keyframe off that stream was
 * measured at 3/8 on the controller (its radio drops fragments of an unpaced
 * burst) and 10/10 from here.
 *
 * The camera is always on the same network as its controller, and this server is
 * expected to be too, so it is found the way the controller finds it: a
 * LanSearch (`f1 30`) to the address the controller reports, answered by a
 * PunchPkt that states the camera's own id. Nothing outside the network is
 * involved, at any point, ever — a camera that cannot be reached this way falls
 * back to being relayed by its controller rather than to somebody's servers.
 *
 * The session and CGI layer after that is the one the controller speaks. See
 * docs/terpcam-reverse-engineering.md §26.
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

/**
 * Rendezvous servers that locate a camera on somebody else's network. They are
 * the camera manufacturer's, so they are configuration rather than source: with
 * none set the server does not reach cameras itself and every capture is relayed
 * by its controller, which is a working setup, just a lower-resolution one.
 */
const RENDEZVOUS_HOSTS = (process.env.TERPCAM_RENDEZVOUS_HOSTS ?? '')
  .split(',')
  .map(host => host.trim())
  .filter(Boolean);
const RENDEZVOUS_PORTS = [32100, 32101, 32102];
const RENDEZVOUS_MS = 20_000;

/**
 * Address to tell a camera on this network to punch at.
 *
 * Defaults to MQTT_HOST_EXTERNAL, which is already the address this stack is
 * reachable at from its devices — on a stack hosted alongside its cameras that
 * is exactly the right answer, and it saves configuring the same thing twice.
 * Only a private address is used: announcing a public one stops the camera
 * punching at all (measured), so a hosted stack correctly advertises nothing.
 */
const TERPCAM_ADVERTISE_ADDRESS = (() => {
  const configured = (process.env.TERPCAM_ADVERTISE_ADDRESS || process.env.MQTT_HOST_EXTERNAL || '').trim();
  return configured && isPrivate(configured) ? configured : null;
})();

/**
 * UDP ports bound for captures. Fixed inside the container — docker-compose.yaml
 * sets them and nothing else should — while which host ports they are published
 * on is a deployment choice, since a machine may already be using this range.
 */
const P2P_PORTS = (process.env.TERPCAM_P2P_PORTS ?? '32200-32209').split(',').flatMap(part => {
  const [from, to] = part.split('-').map(value => Number(value.trim()));
  if (!Number.isInteger(from) || from <= 0) return [];
  return Array.from({ length: Math.max(1, (to || from) - from + 1) }, (_, index) => from + index);
});

/**
 * What the camera ships with — the manufacturer publishes it, so every unpaired
 * camera of this kind answers to it. Pairing replaces it with a per-camera
 * secret which the controller reports; this is only the fallback for cameras
 * paired before that existed, or one that has been factory-reset since.
 */
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
/** A malfunctioning camera must not stream without end. */
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

type Endpoint = { address: string; port: number };

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
function isPrivate(address: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}

/**
 * Our own address on the route to `host`, when that address is a private one.
 *
 * The lookup carries this so two peers on the same network can shortcut past the
 * public path, and it matters in both directions: a server that announces its
 * PUBLIC address here gets no punch at all, while a host that genuinely shares
 * the camera's LAN only gets punched on the address it names. Asking the routing
 * table rather than picking the first private interface matters on a developer
 * machine, which usually has several (VM bridges, a second NIC) and only one
 * that reaches the camera.
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

class TerpCamDirectService {
  /** Published UDP ports to prefer, so the camera's punch can reach us. */
  private ports = P2P_PORTS;

  /**
   * What each device has told us about its own camera: which camera it is, where
   * it answered, and the password its controller set.
   *
   * Keyed by DEVICE, and only ever written from a device's own hardware-info.
   * That is what keeps one customer's camera away from another's: a capture is
   * asked for by device, and the only camera reachable through it is the one
   * that device reported. A stream setting naming somebody else's camera gets
   * no address, no password and no session.
   */
  private cameras = new Map<string, { label: string; uid?: string; password?: string }>();

  /**
   * The open path to each camera: the socket the hole was punched from, the
   * endpoint on the far side, and a timer keeping the NAT mapping alive.
   *
   * This is what stops the rendezvous being a per-image cost. Asking the
   * manufacturer's servers where a camera is happens once; after that the
   * mapping is held open with a keepalive and later sessions go straight to the
   * endpoint. It is dropped when the camera stops answering, which is what
   * triggers a fresh lookup.
   */
  private paths = new Map<
    string,
    { socket: dgram.Socket; peer: Endpoint; inbox: { message: Buffer; from: Endpoint }[]; keepalive: NodeJS.Timeout }
  >();

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

  /**
   * Remember the password a device's controller set on its camera during
   * pairing. Empty means that camera still has the manufacturer's default.
   */
  public rememberPassword(deviceId: string, password: string): void {
    const camera = this.cameras.get(deviceId);
    if (camera) camera.password = password || undefined;
  }

  /**
   * The camera's P2P id, as read off the camera by its controller. Needed to ask
   * the rendezvous servers for it, and knowing it here means nothing has to be
   * looked up in the manufacturer's directory.
   */
  public rememberUid(deviceId: string, uid: string): void {
    const camera = this.cameras.get(deviceId);
    if (camera && uid && uid !== 'none') camera.uid = uid;
  }

  /**
   * Bind the socket to one of P2P_PORTS, falling back to an ephemeral port.
   *
   * The port has to be one the container PUBLISHES. The camera punches at us
   * from an address we never sent anything to, so Docker's bridge NAT has no
   * conntrack entry for it and drops it — measured: the same capture succeeds on
   * `--network host` or with `-p <port>:<port>/udp`, and fails on the default
   * bridge. A published port gives the packet somewhere to land.
   *
   * A small range rather than one port so captures for different cameras can
   * overlap; an ephemeral port is still tried last, since it is all that is
   * needed when the process is not behind a NAT of its own.
   */
  private async bind(socket: dgram.Socket): Promise<void> {
    for (const port of this.ports) {
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
   * What a device has told us about its own camera, from memory or from what it
   * reported earlier.
   *
   * Reading it back from the device record matters: a device reports at boot, so
   * a server that has just restarted would otherwise know nothing about any
   * camera until every controller happened to reboot.
   */
  private async cameraFor(deviceId: string): Promise<{ label: string; uid?: string; password?: string } | null> {
    const known = this.cameras.get(deviceId);
    if (known?.uid) return known;

    const device = await deviceModel.findOne({ device_id: deviceId });
    const info = device?.hardwareInfo;
    const label = info?.webcam_did;
    if (!label || label === 'none' || !info?.webcam_uid) return null;

    const camera = { label, uid: info.webcam_uid, password: info.webcam_pwd || undefined };
    this.cameras.set(deviceId, camera);
    return camera;
  }

  /** Pull one still as a ready JPEG, decoding the keyframe when there is one. */
  public async captureStill(deviceId: string): Promise<Buffer> {
    const { data, h264 } = await this.capture(deviceId);
    if (!h264) return data;
    const jpeg = await terpCamService.decodeKeyframeToJpeg(data);
    logger.info(`[terpcam] ${deviceId}: ${data.length}B keyframe -> ${jpeg.length}B jpeg`);
    return jpeg;
  }

  /**
   * Pull one still. Returns a full-resolution H.264 keyframe when the video
   * stream yields one, and falls back to `snapshot.cgi` (640x360 JPEG) when it
   * does not — a camera that answers something small beats no image at all.
   */
  public async capture(deviceId: string): Promise<{ data: Buffer; h264: boolean }> {
    // The camera is whatever this device reported as its own — never a name the
    // caller supplied, so no stream setting can point a capture at a camera
    // belonging to someone else.
    const camera = await this.cameraFor(deviceId);
    if (!camera?.uid) {
      throw new Error('this device has not reported a camera we can reach');
    }
    if (!RENDEZVOUS_HOSTS.length) {
      throw new Error('TERPCAM_RENDEZVOUS_HOSTS is unset, so cameras can only be reached by their controller');
    }

    const did = packDeviceId(camera.uid);
    const socket = dgram.createSocket('udp4');
    const inbox: { message: Buffer; from: Endpoint }[] = [];
    socket.on('message', (message, rinfo) => {
      inbox.push({ message: deobfuscate(message), from: { address: rinfo.address, port: rinfo.port } });
    });
    socket.on('error', () => undefined); // ICMP for a stale endpoint is normal

    let streaming: { peer: Endpoint; auth: string } | null = null;
    try {
      await this.bind(socket);
      const peer = await this.rendezvous(socket, inbox, did);
      const auth = authFor(camera.password ?? DEFAULT_PASSWORD);
      await this.login(socket, inbox, did, peer, auth);

      streaming = { peer, auth };
      const keyframe = await this.readKeyframe(socket, inbox, peer, auth);
      if (keyframe) return { data: keyframe, h264: true };

      logger.info('[terpcam] no keyframe, falling back to snapshot.cgi');
      const jpeg = await this.readSnapshot(socket, inbox, peer, auth);
      return { data: jpeg, h264: false };
    } finally {
      // Stop the stream and close the session before dropping the socket.
      // Without the close (`f1 f0`, what the vendor's own PPCS_Close sends) the
      // camera holds the session and hands the NEXT one no keyframe at all —
      // measured as every second capture failing, exactly alternating.
      // Close the camera's session but KEEP the socket: the session has to go or
      // the next capture gets no keyframe, while the socket is what holds the
      // NAT mapping open and saves the next lookup.
      if (streaming) {
        const { peer: to, auth } = streaming;
        socket.send(buildCgi(CMD_CHANNEL, 3, `livestream.cgi?streamid=16&${auth}`), to.port, to.address, () => undefined);
        socket.send(buildPacket(0xf0), to.port, to.address, () => undefined);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      socket.close();
    }
  }

  private async rendezvous(socket: dgram.Socket, inbox: { message: Buffer; from: Endpoint }[], did: Buffer): Promise<Endpoint> {
    const send = (packet: Buffer, host: string, port: number) => socket.send(packet, port, host, () => undefined);

    // Held in an object because both are assigned from inside a callback.
    const found: { reflected: Endpoint | null; punched: Endpoint | null } = { reflected: null, punched: null };

    // 1. Hello, to learn our own public endpoint.
    const helloUntil = Date.now() + 4_000;
    while (!found.reflected && Date.now() < helloUntil) {
      for (const host of RENDEZVOUS_HOSTS) send(buildPacket(0x00), host, 32100);
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
    const lan = TERPCAM_ADVERTISE_ADDRESS ?? (await routableAddress(RENDEZVOUS_HOSTS[0]));
    if (lan) {
      // Stored least-significant octet first, like every other address here.
      const octets = lan.split('.').map(Number).reverse();
      Buffer.from(octets).copy(body, 24);
    }

    const until = Date.now() + RENDEZVOUS_MS;
    while (!found.punched && Date.now() < until) {
      for (const host of RENDEZVOUS_HOSTS) {
        for (const port of RENDEZVOUS_PORTS) send(buildPacket(0x20, body), host, port);
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
    socket.send(buildPacket(0x41, did), peer.port, peer.address, () => undefined);
    return peer;
  }

  /** Authenticate the punched session. */
  private async login(socket: dgram.Socket, inbox: { message: Buffer; from: Endpoint }[], did: Buffer, peer: Endpoint, auth: string): Promise<void> {
    const trailer = Buffer.from([0x00, 0x02, 0x12, 0x64, 0x10, 0x02, 0x00, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const devlgn = Buffer.concat([did, trailer]);
    const until = Date.now() + LOGIN_MS;
    while (Date.now() < until) {
      for (const packet of [buildPacket(0x00), buildPacket(0x05, did), buildPacket(0x20, devlgn), buildPacket(0x41, did)]) {
        socket.send(packet, peer.port, peer.address, () => undefined);
      }
      socket.send(buildCgi(CMD_CHANNEL, 0, `get_status.cgi?${auth}`), peer.port, peer.address, () => undefined);

      let authed = false;
      await this.drain(inbox, 1_000, entry => {
        const m = entry.message;
        if (m.length >= 4 && (m[1] === 0x42 || m[1] === 0x43)) {
          socket.send(obfuscate(m), entry.from.port, entry.from.address, () => undefined);
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
   * Take the first H.264 keyframe off the main video stream — the only source of
   * a full-resolution image, since snapshot.cgi renders from the MJPEG encoder.
   *
   * Channel 1 carries VStarcam media frames: a 32-byte header (magic 55aa15a8,
   * frame length at offset 16, little endian) then Annex-B H.264. The first
   * frame of a session is the keyframe and re-requesting the stream on a live
   * session is ignored, so this gets one attempt per session.
   */
  private async readKeyframe(
    socket: dgram.Socket,
    inbox: { message: Buffer; from: Endpoint }[],
    peer: Endpoint,
    auth: string,
  ): Promise<Buffer | null> {
    socket.send(buildCgi(CMD_CHANNEL, 1, `livestream.cgi?streamid=10&substream=2&${auth}`), peer.port, peer.address, () => undefined);

    const slots = new Map<number, Buffer>();
    let base: number | null = null;
    let contiguous = 0;
    const started = Date.now();
    let lastData = Date.now();

    while (Date.now() - started < TRANSFER_MS && Date.now() - lastData < IDLE_MS) {
      const found: { frame: Buffer | null } = { frame: null };
      await this.drain(inbox, 300, entry => {
        const m = entry.message;
        if (m.length < 8) return false;
        if (m[1] === 0xe0) {
          socket.send(buildPacket(0xe1), peer.port, peer.address, () => undefined);
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
        if (slot > 0x8000) return false; // predates the stream we asked for
        if (!slots.has(slot)) slots.set(slot, m.subarray(8, 8 + length));
        while (slots.has(contiguous)) contiguous++;

        // Ack while assembling: that is what repairs a gap. Acking from the very
        // first fragment instead pulls thousands of retransmits in and drowns
        // the new data.
        if (contiguous > 0) {
          socket.send(buildAck(VIDEO_CHANNEL, (base + contiguous - 1) & 0xffff), peer.port, peer.address, () => undefined);
        }

        const buffered = Buffer.concat([...Array(contiguous).keys()].map(i => slots.get(i)));
        const start = buffered.indexOf(FRAME_MAGIC);
        if (start >= 0 && buffered.length >= start + 32) {
          const frameLength = buffered.readUInt32LE(start + 16);
          if (frameLength > 0 && frameLength < MAX_FRAME_BYTES && buffered.length >= start + 32 + frameLength) {
            const payload = buffered.subarray(start + 32, start + 32 + frameLength);
            if (this.isKeyframe(payload)) {
              found.frame = Buffer.from(payload);
              return true;
            }
          }
        }
        return false;
      });
      if (found.frame) return found.frame;
    }
    return null;
  }

  /** 640x360 JPEG straight from the camera; the fallback when no keyframe came. */
  private async readSnapshot(socket: dgram.Socket, inbox: { message: Buffer; from: Endpoint }[], peer: Endpoint, auth: string): Promise<Buffer> {
    socket.send(buildCgi(CMD_CHANNEL, 2, `snapshot.cgi?${auth}`), peer.port, peer.address, () => undefined);

    const slots = new Map<number, Buffer>();
    let base: number | null = null;
    let contiguous = 0;
    const started = Date.now();
    let lastData = Date.now();

    while (Date.now() - started < TRANSFER_MS && Date.now() - lastData < IDLE_MS) {
      await this.drain(inbox, 300, entry => {
        const m = entry.message;
        if (m.length < 8) return false;
        if (m[1] === 0xe0) {
          socket.send(buildPacket(0xe1), peer.port, peer.address, () => undefined);
          return false;
        }
        if (m[1] !== 0xd0 || m[5] !== CMD_CHANNEL) return false;

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
        while (slots.has(contiguous)) contiguous++;
        if (contiguous > 0) {
          socket.send(buildAck(CMD_CHANNEL, (base + contiguous - 1) & 0xffff), peer.port, peer.address, () => undefined);
        }
        return false;
      });

      // The JPEG is bounded by its own markers: a `result= 0;var …` preamble
      // comes first and trailing text can follow, so neither is forwarded.
      const buffered = Buffer.concat([...Array(contiguous).keys()].map(i => slots.get(i)));
      const soi = buffered.indexOf(Buffer.from([0xff, 0xd8]));
      const eoi = soi >= 0 ? buffered.indexOf(Buffer.from([0xff, 0xd9]), soi) : -1;
      if (soi >= 0 && eoi > soi) return buffered.subarray(soi, eoi + 2);
    }
    throw new Error('no image came back from the camera');
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
  private async drain(
    inbox: { message: Buffer; from: Endpoint }[],
    ms: number,
    handler: (entry: { message: Buffer; from: Endpoint }) => boolean,
  ): Promise<void> {
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

export const terpCamDirectService = new TerpCamDirectService();
