import dgram from 'node:dgram';
import { logger } from '@utils/logger';
import { terpCamService } from '@services/terpcam.service';

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
 * UDP ports the process binds for captures, which must be the ones the container
 * publishes (see `bind`). Configurable because the range has to match compose.
 */
const TERPCAM_P2P_PORTS = (process.env.TERPCAM_P2P_PORTS ?? '32200-32209').split(',').flatMap(part => {
  const [from, to] = part.split('-').map(value => Number(value.trim()));
  if (!Number.isInteger(from) || from <= 0) return [];
  return Array.from({ length: Math.max(1, (to || from) - from + 1) }, (_, i) => from + i);
});

/** VStarcam factory default, published by the vendor; the camera ships with it. */
const AUTH = 'name=admin&loginuse=admin&loginpas=888888&user=admin&pwd=888888&';

const CMD_CHANNEL = 0;
const VIDEO_CHANNEL = 1;
const FRAME_MAGIC = Buffer.from([0x55, 0xaa, 0x15, 0xa8]);

const LAN_SEARCH_MS = 2_500;
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

class TerpCamDirectService {
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
          // The camera states its own id in the reply, so nothing has to be
          // looked up anywhere — this is self-contained on the local network.
          found.session = { peer: entry.from, did: Buffer.from(entry.message.subarray(4, 24)) };
          return true;
        }
        return false;
      });
    }
    return found.session;
  }

  /**
   * Remember where a camera answered, so captures can go straight to it.
   *
   * Fed by the controller's `webcam_ip` hardware-info. The controller shares the
   * camera's network and already searches for it when it moves, so this stays
   * current without the server having to hunt for anything itself.
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

      const known = this.lanAddresses.get(label);
      const local = known ? await this.lanSession(socket, inbox, known) : null;
      if (!local) {
        // Deliberately no second route. The controller shares the camera's
        // network and can always relay, so a camera we cannot see is its job,
        // not something to go looking for through anybody else's servers.
        throw new Error(known ? `camera did not answer at ${known}` : 'no camera address reported yet');
      }
      logger.info(`[terpcam] ${label} answered at ${local.peer.address}`);
      const { peer, did } = local;
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
