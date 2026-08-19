import { okamCamService } from './okam-cam.service';
import { tunnelService } from './tunnel.service';
import deviceModel from '@models/device.model';

/**
 * O-KAM / VStarcam camera P2P client (server side).
 *
 * Reverse-engineered clean-room reimplementation of the camera's CS2 PPPP
 * transport — see docs/okam-webcam-reverse-engineering.md §15. Speaks the
 * protocol over any datagram socket that exposes the small dgram-like surface
 * below, so it runs unchanged over:
 *   - a real UDP socket (node dgram) when the server is on the camera's LAN, or
 *   - the controller's UDP tunnel (tunnelService.openUdpTunnel) in production.
 *
 * Grabs one H.264 keyframe and hands it to okamCamService to decode + store.
 */

// 256-byte S-box (was at vaddr 0x2af11 in libOKSMARTPPCS.so).
const SBOX = Buffer.from(
  'fJzoShPe3LIvISPkMHs9jLwLJww895rnCHGWAJeF78EfxNuhwuvZAfq6OwW4FYeDKHLRi1rW2pNY/qrMbhvwo4irQ8ANtUU4T1AiZiB/B1sUmB2bpyq5qMvx/ElHBj6xDgQ6lF7uVBE03U357MfJ43gab3BrpL2pXdX45bsmr0I32OECCq5fHMVzCU5pJJBtErMZrXSKKUD1Lb6lWeD0edJLzomCSIQlxpErovuP6aawnj9l9gMxLqwPlSxc7Tm3M2xWfrSg/XqBU1GGjZ93/2qA3+K/ENd1ZFd281XN0MgY5jZBYs+Z8jJMZ2BhksrT6mN9FraO1Gg1w1KdRkQeFw==',
  'base64',
);
// Global derived key (constant for this SDK build; decrypts every packet).
const DK = [44, 212, 96, 6];

function decrypt(data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length);
  let prev = 0;
  for (let j = 0; j < data.length; j++) {
    out[j] = SBOX[(DK[prev & 3] + prev) & 0xff] ^ data[j];
    prev = data[j];
  }
  return out;
}
function encrypt(data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length);
  let prev = 0;
  for (let j = 0; j < data.length; j++) {
    const c = SBOX[(DK[prev & 3] + prev) & 0xff] ^ data[j];
    out[j] = c;
    prev = c;
  }
  return out;
}
function pkt(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.from([0xf1, type, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  return encrypt(Buffer.concat([head, payload]));
}

// Minimal dgram-like socket the client needs.
export interface DatagramLike {
  send(buf: Buffer, port: number, host: string): void;
  on(event: 'message', cb: (msg: Buffer, rinfo: { address: string; port: number }) => void): void;
  removeAllListeners?(): void;
  close?(): void;
}

const FRAME_MAGIC = Buffer.from('55aa15a8', 'hex');

export interface OkamP2PConfig {
  // Where to send the initial LanSearch. Over the tunnel the server does not
  // know the camera's LAN IP, so pass the LAN broadcast (e.g. '255.255.255.255');
  // the camera's real address is learned from the first reply. On a known LAN
  // pass the camera IP directly.
  cameraIp: string;
  did: Buffer; // 20-byte wire DID (see get_status realdeviceid); default provided
  devlgn: Buffer;
  auth: string; // "...&loginuse=admin&loginpas=<hash>&pwd=888888&"
  discoverPort?: number;
}

// The DID is learned from the camera's PunchPkt reply, so no per-camera id is
// needed. The DevLgn trailer after the 20-byte DID was constant on the reference
// unit. auth uses the VStarcam default admin/888888 (loginpas is the hash of the
// password — constant for 888888); override if the camera's password was changed.
const DEVLGN_TRAILER = Buffer.from('000212641002000a0000000000000000', 'hex');
const DEFAULT_AUTH = 'name=admin&loginuse=admin&userId=404192507&loginpas=03f5c2333e78918&user=admin&pwd=888888&';

class OkamP2PService {
  /**
   * Collect one H.264 keyframe from the camera. `socket` may be a node dgram
   * socket (LAN) or a tunnelService UDP tunnel (production). Resolves with the
   * H.264 Annex-B elementary stream (frame headers stripped).
   */
  public grabKeyframe(socket: DatagramLike, cfg: Partial<OkamP2PConfig> & { cameraIp: string }): Promise<Buffer> {
    const auth = cfg.auth ?? DEFAULT_AUTH;
    const discoverPort = cfg.discoverPort ?? 32108;
    const cameraIp = cfg.cameraIp;

    return new Promise<Buffer>((resolve, reject) => {
      let peerPort = 0;
      let peerHost = cameraIp; // updated to the camera's real address on first reply
      let did: Buffer | null = cfg.did ?? null; // learned from the PunchPkt reply
      const rx: Map<number, Map<number, Buffer>> = new Map(); // channel -> idx -> bytes
      let started = false;
      let done = false;
      const t0 = Date.now();

      const drw = (ch: number, idx: number, chan: Buffer): Buffer => {
        const inner = Buffer.concat([Buffer.from([0xd1, ch, (idx >> 8) & 0xff, idx & 0xff]), chan]);
        return encrypt(Buffer.concat([Buffer.from([0xf1, 0xd0, (inner.length >> 8) & 0xff, inner.length & 0xff]), inner]));
      };
      const drwAck = (ch: number, idx: number): Buffer => encrypt(Buffer.from([0xf1, 0xd1, 0, 6, 0xd1, ch, (idx >> 8) & 0xff, idx & 0xff, 0, 1]));
      const cgiChannel = (cgi: string): Buffer => {
        const g = Buffer.from('GET /' + cgi, 'latin1');
        const hdr = Buffer.alloc(8);
        hdr[0] = 0x01;
        hdr[1] = 0x0a;
        hdr.writeUInt32LE(g.length, 4);
        return Buffer.concat([hdr, g]);
      };
      const send = (buf: Buffer, port: number, host: string = peerHost) => socket.send(buf, port, host);
      const handshakeBurst = (port: number) => {
        if (!did) return;
        send(pkt(0x00), port);
        send(pkt(0x05, did), port);
        send(pkt(0x20, Buffer.concat([did, DEVLGN_TRAILER])), port);
        send(pkt(0x41, did), port);
      };

      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        try {
          socket.removeAllListeners?.();
          socket.close?.();
        } catch {
          /* noop */
        }
        if (err) return reject(err);
        const h264 = this.stripFrames(this.channelData(rx, 1));
        if (!h264.includes(Buffer.from('00000001', 'hex'))) return reject(new Error('no keyframe captured'));
        resolve(h264);
      };

      socket.on('message', (msg: Buffer, rinfo) => {
        // learn the camera's real address + ephemeral session port from the first datagram
        if (peerPort === 0 && rinfo?.port) {
          peerPort = rinfo.port;
          if (rinfo.address) peerHost = rinfo.address;
        }
        const p = decrypt(msg);
        if (p.length < 4) return;
        const t = p[1];
        // the PunchPkt reply to our LanSearch carries the camera's 20-byte DID
        if (t === 0x41 && !did && p.length >= 24) did = p.subarray(4, 24);
        if (t === 0x42 || t === 0x43) {
          send(encrypt(p), peerPort);
        } else if (t === 0xe0) {
          send(pkt(0xe1), peerPort);
        } else if (t === 0xd0) {
          const ch = p[5];
          const idx = (p[6] << 8) | p[7];
          const total = (p[2] << 8) | p[3];
          if (!rx.has(ch)) rx.set(ch, new Map());
          rx.get(ch).set(idx, p.subarray(8, 4 + total));
          send(drwAck(ch, idx), peerPort);
          if (ch === 1 && this.hasKeyframe(this.channelData(rx, 1))) finish();
        }
      });

      // LanSearch until the camera answers; capture its ephemeral session port.
      const lanSearch = pkt(0x30);
      const timer = setInterval(() => {
        if (done) return;
        if (Date.now() - t0 > 9000) return finish(new Error('timeout'));
        if (peerPort === 0 || !did) {
          // LanSearch to the (possibly broadcast) discovery address; the reply
          // gives us the camera's real address, session port and DID.
          send(lanSearch, discoverPort, cameraIp);
          return;
        }
        handshakeBurst(peerPort);
        send(drw(0, 0, cgiChannel('get_status.cgi?' + auth)), peerPort);
        if (Date.now() - t0 > 1500 && !started) {
          send(drw(0, 1, cgiChannel('livestream.cgi?streamid=10&substream=2&' + auth)), peerPort);
          started = true;
        }
      }, 400);
    });
  }

  /** Grab a keyframe and store it as a device still via the image pipeline. */
  public async captureStill(socket: DatagramLike, cameraIp: string, deviceId: string): Promise<void> {
    const h264 = await this.grabKeyframe(socket, { cameraIp });
    await okamCamService.ingestKeyframe(deviceId, h264);
  }

  /**
   * Production entry point: grab one still from the camera on the given device's
   * LAN, over the controller's UDP tunnel, and store it. Discovery uses the LAN
   * broadcast (the server doesn't know the camera's IP); the camera's real
   * address, DID and session port are all learned from its reply.
   */
  public async captureViaController(deviceId: string, cameraBroadcast = '255.255.255.255'): Promise<void> {
    const socket = tunnelService.openUdpTunnel(deviceId);
    try {
      const h264 = await this.grabKeyframe(socket as unknown as DatagramLike, { cameraIp: cameraBroadcast });
      await okamCamService.ingestKeyframe(deviceId, h264);
    } finally {
      socket.close();
    }
  }

  private polling = false;

  /**
   * Periodically grab a still from every device that has reported a camera DID.
   * Wire this at startup (e.g. from the server bootstrap) once the UDP-tunnel
   * firmware is deployed:  okamP2PService.startPolling().
   */
  public startPolling(intervalMs = 90_000): void {
    setInterval(() => void this.pollOnce(), intervalMs);
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return; // the thin tunnel handles one grab at a time
    this.polling = true;
    try {
      const devices = await deviceModel.find({ 'hardwareInfo.webcam_did': { $exists: true, $nin: [null, '', 'none'] } });
      for (const device of devices) {
        try {
          await this.captureViaController(device.device_id);
        } catch (e) {
          console.log('okam still capture failed for', device.device_id, (e as Error).message);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private channelData(rx: Map<number, Map<number, Buffer>>, ch: number): Buffer {
    const frags = rx.get(ch);
    if (!frags) return Buffer.alloc(0);
    return Buffer.concat([...frags.keys()].sort((a, b) => a - b).map(k => frags.get(k)));
  }
  private stripFrames(data: Buffer): Buffer {
    const parts: Buffer[] = [];
    let i = 0;
    const offs: number[] = [];
    while ((i = data.indexOf(FRAME_MAGIC, i)) !== -1) {
      offs.push(i);
      i += 4;
    }
    if (offs.length === 0) return data;
    for (let k = 0; k < offs.length; k++) {
      const end = k + 1 < offs.length ? offs[k + 1] : data.length;
      parts.push(data.subarray(offs[k] + 32, end));
    }
    return Buffer.concat(parts);
  }
  private hasKeyframe(data: Buffer): boolean {
    const h = this.stripFrames(data);
    const nals = new Set<number>();
    let i = 0;
    const sc = Buffer.from('00000001', 'hex');
    while ((i = h.indexOf(sc, i)) !== -1) {
      if (i + 4 < h.length) nals.add(h[i + 4] & 0x1f);
      i += 4;
    }
    return nals.has(7) && nals.has(5);
  }
}

export const okamP2PService = new OkamP2PService();
