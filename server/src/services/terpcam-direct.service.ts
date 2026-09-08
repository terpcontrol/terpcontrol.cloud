import dgram from 'node:dgram';
import { logger } from '@utils/logger';
import { terpCamService } from '@services/terpcam.service';

/**
 * Terp Cam stills pulled straight from the cloud.
 *
 * The controller path (terpcam-p2p.service) exists because the camera was thought
 * to be reachable only from its own LAN. It is not: the camera keeps itself
 * registered with the vendor's CS2 rendezvous servers and will hole-punch to any
 * peer that asks for it by device id, so the server can open the session itself
 * and the controller drops out of the image path.
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
 * Protocol, all UDP, payloads obfuscated with the vendor's table cipher:
 *
 *   -> supernode  f1 00                     Hello
 *   <-            f1 01 <our public addr>   reflected back, STUN-style
 *   -> supernode  f1 20 <did><port><lanip>  where is this camera?
 *   <-            f1 21 <00 = accepted>     and f1 40 with its endpoints
 *   <- camera     f1 41 <did>               the camera punching at US, unasked
 *   -> camera     f1 00 / f1 05 / f1 20 / f1 41 + a CGI, then DRW as on the LAN
 *
 * See docs/terpcam-reverse-engineering.md §26.
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
 * Rendezvous servers used to locate a camera that is NOT on this server's own
 * network — the camera manufacturer's, and therefore deliberately not compiled
 * in. Unset means the LAN path is the only one, which is a complete setup for a
 * stack hosted alongside its cameras and involves no outside party whatsoever.
 */
const RENDEZVOUS_HOSTS = (process.env.TERPCAM_RENDEZVOUS_HOSTS ?? '')
  .split(',')
  .map(host => host.trim())
  .filter(Boolean);

/**
 * Directory that maps a camera's printed label to the id it registers under.
 * Only the rendezvous path needs it: on the LAN the camera states its own id.
 */
const DIRECTORY_URL = process.env.TERPCAM_DIRECTORY_URL?.trim() || null;
const RENDEZVOUS_PORTS = [32100, 32101, 32102];

/**
 * UDP ports the process binds for captures, which must be the ones the container
 * publishes (see `bind`). Configurable because the range has to match compose.
 */
const TERPCAM_P2P_PORTS = (process.env.TERPCAM_P2P_PORTS ?? '32200-32209').split(',').flatMap(part => {
  const [from, to] = part.split('-').map(value => Number(value.trim()));
  if (!Number.isInteger(from) || from <= 0) return [];
  return Array.from({ length: Math.max(1, (to || from) - from + 1) }, (_, i) => from + i);
});

/**
 * Address to tell the camera to punch at, when it shares our network.
 *
 * Auto-detection finds the address of THIS process, which inside a container is
 * a bridge address the camera cannot reach. When the server runs on the camera's
 * own LAN — as it does when the stack is hosted at home — set this to the host's
 * LAN address, and publish the UDP ports so the punch is forwarded in. Leave it
 * empty for a server that is genuinely remote.
 */
const TERPCAM_ADVERTISE_ADDRESS = process.env.TERPCAM_ADVERTISE_ADDRESS?.trim() || null;

/** VStarcam factory default, published by the vendor; the camera ships with it. */
const AUTH = 'name=admin&loginuse=admin&loginpas=888888&user=admin&pwd=888888&';

const CMD_CHANNEL = 0;
const VIDEO_CHANNEL = 1;
const FRAME_MAGIC = Buffer.from([0x55, 0xaa, 0x15, 0xa8]);

const LAN_SEARCH_MS = 2_500;
const RENDEZVOUS_MS = 20_000;
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
  /** Printed label -> P2P device id. The mapping never changes for a camera. */
  private uidCache = new Map<string, string>();

  /** Published UDP ports to prefer, so the camera's punch can reach us. */
  private ports = TERPCAM_P2P_PORTS;

  /** Where each camera last answered on our own network, when it is on it. */
  private lanAddresses = new Map<string, string>();

  /**
   * Find the camera on our own network, without asking anybody.
   *
   * This is the same LanSearch the controller uses: a `f1 30` to port 32108, to
   * which the camera answers with a PunchPkt from an ephemeral port. Sent
   * UNICAST rather than broadcast, because a broadcast does not leave the
   * container's bridge — which is also why it needs the address up front.
   *
   * Worth preferring whenever it works: it involves no third party at all, and
   * it skips the hole punch entirely.
   */
  private async lanSession(
    socket: dgram.Socket,
    inbox: { message: Buffer; from: Endpoint }[],
    address: string,
  ): Promise<{ peer: Endpoint; did: Buffer } | null> {
    const until = Date.now() + LAN_SEARCH_MS;
    const found: { session: { peer: Endpoint; did: Buffer } | null } = { session: null };
    while (!found.session && Date.now() < until) {
      socket.send(buildPacket(0x30), 32108, address, () => undefined);
      await this.drain(inbox, 600, entry => {
        if (entry.message.length >= 24 && entry.message[1] === 0x41 && entry.from.address === address) {
          // The camera states its own id in the reply, so this path needs no
          // directory lookup — it is self-contained on the local network.
          found.session = { peer: entry.from, did: Buffer.from(entry.message.subarray(4, 24)) };
          return true;
        }
        return false;
      });
    }
    return found.session;
  }

  /**
   * Remember where a camera answered, so later captures can go straight to it.
   * Fed by the controller's `webcam_ip` hardware-info and by whatever the
   * rendezvous reports, so the vendor is needed at most once per address change.
   */
  public rememberLanAddress(label: string, address: string): void {
    if (address && address !== 'none' && this.lanAddresses.get(label) !== address) {
      this.lanAddresses.set(label, address);
    }
  }

  /**
   * Bind the socket to one of TERPCAM_P2P_PORTS, falling back to an ephemeral port.
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
   * Resolve the id the camera is registered under. Pairing stores the printed
   * label (`AAC2851962SPLP`), which is not the P2P id (`VSTH581824TJXUG`); the
   * vendor's own directory maps one to the other, and the answer is permanent.
   */
  public async resolveDeviceId(label: string): Promise<string> {
    if (/^[A-Za-z]{4}\d{4,}[A-Za-z0-9]{5}$/.test(label) && label.startsWith('VST')) {
      return label; // already a P2P id
    }
    const cached = this.uidCache.get(label);
    if (cached) return cached;

    if (!DIRECTORY_URL) {
      throw new Error('camera id is not a P2P id and TERPCAM_DIRECTORY_URL is unset');
    }
    const response = await fetch(`${DIRECTORY_URL}${DIRECTORY_URL.includes('?') ? '&' : '?'}vuid=${encodeURIComponent(label)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`device-id lookup failed: HTTP ${response.status}`);
    const body = (await response.json()) as { uid?: string };
    if (!body?.uid) throw new Error('device-id lookup returned no uid');
    this.uidCache.set(label, body.uid);
    return body.uid;
  }

  /** Pull one still as a ready JPEG, decoding the keyframe when there is one. */
  public async captureStill(label: string): Promise<Buffer> {
    const { data, h264 } = await this.capture(label);
    if (!h264) return data;
    const jpeg = await terpCamService.decodeKeyframeToJpeg(data);
    logger.info(`[terpcam] ${label}: ${data.length}B keyframe -> ${jpeg.length}B jpeg`);
    return jpeg;
  }

  /**
   * Pull one still. Returns a full-resolution H.264 keyframe when the video
   * stream yields one, and falls back to `snapshot.cgi` (640x360 JPEG) when it
   * does not — a camera that answers something small beats no image at all.
   */
  public async capture(label: string): Promise<{ data: Buffer; h264: boolean }> {
    const socket = dgram.createSocket('udp4');
    const inbox: { message: Buffer; from: Endpoint }[] = [];

    socket.on('message', (message, rinfo) => {
      inbox.push({ message: deobfuscate(message), from: { address: rinfo.address, port: rinfo.port } });
    });
    socket.on('error', () => undefined); // ICMP unreachable for a stale endpoint is normal

    let streaming: Endpoint | null = null;
    try {
      await this.bind(socket);

      // Prefer our own network. Only when the camera is not on it (or has moved)
      // does this fall back to the vendor's rendezvous servers, which is the one
      // step that involves a third party at all.
      const known = this.lanAddresses.get(label);
      const local = known ? await this.lanSession(socket, inbox, known) : null;
      let peer: Endpoint;
      let did: Buffer;
      if (local) {
        logger.info(`[terpcam] ${label} found on the local network at ${local.peer.address}`);
        ({ peer, did } = local);
      } else {
        if (!RENDEZVOUS_HOSTS.length) {
          throw new Error('camera is not on this network and TERPCAM_RENDEZVOUS_HOSTS is unset');
        }
        did = packDeviceId(await this.resolveDeviceId(label));
        peer = await this.rendezvous(socket, inbox, did);
        if (isPrivate(peer.address)) this.rememberLanAddress(label, peer.address);
      }
      await this.login(socket, inbox, did, peer);

      streaming = peer;
      const keyframe = await this.readKeyframe(socket, inbox, peer);
      if (keyframe) return { data: keyframe, h264: true };

      logger.info('[terpcam] no keyframe, falling back to snapshot.cgi');
      const jpeg = await this.readSnapshot(socket, inbox, peer);
      return { data: jpeg, h264: false };
    } finally {
      // Stop the stream and close the session before dropping the socket.
      // Without the close (`f1 f0`, what the vendor's own PPCS_Close sends) the
      // camera holds the session and hands the NEXT one no keyframe at all —
      // measured as every second capture failing, exactly alternating.
      if (streaming) {
        socket.send(buildCgi(CMD_CHANNEL, 3, `livestream.cgi?streamid=16&${AUTH}`), streaming.port, streaming.address, () => undefined);
        socket.send(buildPacket(0xf0), streaming.port, streaming.address, () => undefined);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      socket.close();
    }
  }

  /**
   * Ask the rendezvous servers for the camera and wait for it to punch at us.
   *
   * Two things here are load-bearing and cost hours to find. The camera punches
   * from a port that is NOT the one the servers advertise, so the peer must be
   * taken from the packet it sends rather than from the lookup answer. And its
   * punch lands within a second or two of the lookup, i.e. while we are still
   * reading the servers' replies — so this loop has to watch for it here, not
   * afterwards.
   */
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

  /** Authenticate the punched session — the same handshake used on the LAN. */
  private async login(socket: dgram.Socket, inbox: { message: Buffer; from: Endpoint }[], did: Buffer, peer: Endpoint): Promise<void> {
    const trailer = Buffer.from([0x00, 0x02, 0x12, 0x64, 0x10, 0x02, 0x00, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const devlgn = Buffer.concat([did, trailer]);
    const until = Date.now() + LOGIN_MS;
    while (Date.now() < until) {
      for (const packet of [buildPacket(0x00), buildPacket(0x05, did), buildPacket(0x20, devlgn), buildPacket(0x41, did)]) {
        socket.send(packet, peer.port, peer.address, () => undefined);
      }
      socket.send(buildCgi(CMD_CHANNEL, 0, `get_status.cgi?${AUTH}`), peer.port, peer.address, () => undefined);

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
  private async readKeyframe(socket: dgram.Socket, inbox: { message: Buffer; from: Endpoint }[], peer: Endpoint): Promise<Buffer | null> {
    socket.send(buildCgi(CMD_CHANNEL, 1, `livestream.cgi?streamid=10&substream=2&${AUTH}`), peer.port, peer.address, () => undefined);

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
  private async readSnapshot(socket: dgram.Socket, inbox: { message: Buffer; from: Endpoint }[], peer: Endpoint): Promise<Buffer> {
    socket.send(buildCgi(CMD_CHANNEL, 2, `snapshot.cgi?${AUTH}`), peer.port, peer.address, () => undefined);

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
