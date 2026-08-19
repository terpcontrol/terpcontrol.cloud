import { tunnelService } from './tunnel.service';
import { logger } from '@utils/logger';

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
 * Grabs one JPEG via snapshot.cgi over the P2P data channel.
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

const SOI = Buffer.from('ffd8', 'hex'); // JPEG start-of-image
const EOI = Buffer.from('ffd9', 'hex'); // JPEG end-of-image

/**
 * cloudSettings.rtspStream marker for an O-KAM camera (`okam://<did>`). Using the
 * existing rtspStream field means the whole image pipeline — poll scheduling,
 * backoff, maintenance gating, the test-image button, storage, timelapses and
 * thinning — works for these cameras with no parallel machinery.
 */
export const OKAM_STREAM_PREFIX = 'okam://';

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
// Default VStarcam admin login (loginpas = plaintext password for the factory 888888).
const DEFAULT_AUTH = 'name=admin&loginuse=admin&loginpas=888888&user=admin&pwd=888888&';

class OkamP2PService {
  /**
   * Collect one H.264 keyframe from the camera. `socket` may be a node dgram
   * socket (LAN) or a tunnelService UDP tunnel (production). Resolves with the
   * H.264 Annex-B elementary stream (frame headers stripped).
   */
  public grabSnapshot(socket: DatagramLike, cfg: Partial<OkamP2PConfig> & { cameraIp: string }): Promise<Buffer> {
    const auth = cfg.auth ?? DEFAULT_AUTH;
    const discoverPort = cfg.discoverPort ?? 32108;
    const cameraIp = cfg.cameraIp;

    return new Promise<Buffer>((resolve, reject) => {
      let peerPort = 0;
      let peerHost = cameraIp; // updated to the camera's real address on first reply
      let did: Buffer | null = cfg.did ?? null; // learned from the PunchPkt reply
      const rx: Map<number, Map<number, Buffer>> = new Map(); // channel -> idx -> bytes
      let snapshotSent = false;
      let authed = false; // set once the camera answers a CGI (session processes commands)
      let snapAt = 0;
      let lastDataAt = 0; // last time a channel-0 fragment arrived (stall detection)
      let attempts = 0;
      let done = false;
      const t0 = Date.now();
      const stats = { rxCount: 0, types: {} as Record<string, number>, maxLen: 0, chans: {} as Record<number, number> }; // diagnostics

      const drw = (ch: number, idx: number, chan: Buffer): Buffer => {
        const inner = Buffer.concat([Buffer.from([0xd1, ch, (idx >> 8) & 0xff, idx & 0xff]), chan]);
        return encrypt(Buffer.concat([Buffer.from([0xf1, 0xd0, (inner.length >> 8) & 0xff, inner.length & 0xff]), inner]));
      };
      // DrwAck payload = d1 <channel> <count16> <index16...>. Count MUST precede the
      // index (the camera uses this to advance its send window; getting it wrong
      // stalls the video after a few packets).
      const drwAck = (ch: number, idx: number): Buffer => encrypt(Buffer.from([0xf1, 0xd1, 0, 6, 0xd1, ch, 0, 1, (idx >> 8) & 0xff, idx & 0xff]));
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

      let jpeg: Buffer | null = null;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        try {
          // Only detach our handler — the caller owns the socket's lifecycle
          // (relays are reused across captures).
          socket.removeAllListeners?.();
        } catch {
          /* noop */
        }
        const diag =
          'rx=' + stats.rxCount + ' drwChans=' + JSON.stringify(stats.chans) +
          ' peer=' + peerHost + ':' + peerPort + ' did=' + (did ? 'yes' : 'no') +
          ' ch0frags=' + (rx.get(0)?.size ?? 0) + ' jpeg=' + (jpeg ? jpeg.length : 0);
        if (!jpeg) {
          if (err) return reject(new Error(err.message + ' [' + diag + ']'));
          return reject(new Error('no complete jpeg [' + diag + ']'));
        }
        logger.info('[okam] snapshot ' + jpeg.length + 'B [' + diag + ']');
        resolve(jpeg);
      };

      socket.on('message', (msg: Buffer, rinfo) => {
        stats.rxCount++;
        if (msg.length > stats.maxLen) stats.maxLen = msg.length;
        const ty = '0x' + (decrypt(msg.subarray(0, 2))[1] ?? 0).toString(16);
        stats.types[ty] = (stats.types[ty] ?? 0) + 1;
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
          stats.chans[ch] = (stats.chans[ch] ?? 0) + 1;
          if (ch === 0) authed = true; // camera is processing our CGI commands

          if (!rx.has(ch)) rx.set(ch, new Map());
          rx.get(ch).set(idx, p.subarray(8, 4 + total));
          if (ch === 0) lastDataAt = Date.now();
          // Cumulative ACK: ack the highest CONTIGUOUS index, not this packet's
          // index. Acking an out-of-order index would tell the camera we received
          // the packets in the gap too, so it would never retransmit them and the
          // transfer would stall permanently at the first lost packet (invisible
          // LAN-direct where there is no loss, fatal over the lossy tunnel).
          send(drwAck(ch, this.highestContig(rx, ch)), peerPort);
          // snapshot.cgi returns a JPEG on channel 0 (reliable, unlike the video
          // channel). Watch the contiguous channel-0 stream for a complete JPEG.
          if (ch === 0 && snapshotSent) {
            const jp = this.extractJpegFromFragments(rx.get(0));
            if (jp) {
              jpeg = jp;
              finish();
            }
          }
        }
      });

      // LanSearch until the camera answers; capture its ephemeral session port.
      const lanSearch = pkt(0x30);
      let lastProgress = 0;
      const timer = setInterval(() => {
        if (done) return;
        if (Date.now() - t0 > 60000) return finish(new Error("timeout"));
        if (Date.now() - lastProgress > 5000) {
          lastProgress = Date.now();
          logger.info('[okam] +' + Math.round((Date.now() - t0) / 1000) + 's rx=' + stats.rxCount +
            ' drwPkts=' + JSON.stringify(stats.chans) +
            ' uniqueCh0frags=' + (rx.get(0)?.size ?? 0));
        }
        // Discovery — LanSearch until the camera answers with its address/DID.
        if (peerPort === 0 || !did) {
          send(lanSearch, discoverPort, cameraIp);
          return;
        }
        if (!authed) {
          // Establish + authenticate: the thin tunnel adds latency, so keep
          // punching + polling get_status until the camera actually answers a CGI.
          handshakeBurst(peerPort);
          send(drw(0, 0, cgiChannel('get_status.cgi?' + auth)), peerPort);
          return;
        }
        // Authenticated: request the JPEG snapshot ONCE, then keep outbound to the
        // absolute minimum — over the thin bidirectional tunnel, extra outbound
        // packets (handshake/acks/re-requests) congest the link and block the
        // camera's inbound data. The per-fragment acks from the handler are the
        // only outbound during transfer; a rare Alive keeps the session.
        if (!snapshotSent) {
          send(drw(0, 0, cgiChannel('snapshot.cgi?' + auth)), peerPort);
          snapshotSent = true;
          attempts = 1;
          snapAt = Date.now();
          lastDataAt = Date.now();
          return;
        }
        // Application-level reliability: the transfer stalls if a datagram is lost
        // in the tunnel (the camera's window never advances). Detect the stall —
        // no new channel-0 fragment for a while — and restart the transfer with a
        // fresh snapshot request, discarding the partial response so the new
        // JPEG can't be spliced onto the old one.
        const stalledFor = Date.now() - Math.max(lastDataAt, snapAt);
        // Be patient: while fragments are still trickling in the transfer is
        // progressing, and restarting would throw that progress away. Only after
        // a real silence (no new fragment for 6s) do we restart with a fresh
        // request, discarding the partial so the new JPEG isn't spliced onto it.
        if (stalledFor > 6000) {
          attempts++;
          const had = rx.get(0)?.size ?? 0;
          rx.delete(0);
          send(drw(0, 0, cgiChannel('snapshot.cgi?' + auth)), peerPort);
          snapAt = Date.now();
          lastDataAt = Date.now();
          logger.info('[okam] transfer stalled after ' + had + ' frags, restart #' + attempts);
        }
      }, 500);
    });
  }

  /**
   * Production entry point: grab one still from the camera on the given device's
   * LAN, over the controller's UDP tunnel. Called by the image pipeline
   * (readRtspStreamImage) for devices configured as `okam://…`, which then stores
   * the JPEG exactly like an RTSP still. Discovery uses the LAN broadcast (the
   * server doesn't know the camera's IP); the camera's real address, DID and
   * session port are all learned from its reply.
   */
  public async captureViaController(deviceId: string, cameraBroadcast = '255.255.255.255'): Promise<Buffer> {
    // Reuse one relay per device instead of opening a new one per capture: the
    // controller only has a handful of tunnel slots, and the churn (plus the
    // resulting new source port) forced a fresh P2P handshake every time.
    let socket = this.udpTunnels.get(deviceId);
    if (!socket) {
      socket = tunnelService.openUdpTunnel(deviceId);
      this.udpTunnels.set(deviceId, socket);
    }
    try {
      return await this.grabSnapshot(socket as unknown as DatagramLike, { cameraIp: cameraBroadcast });
    } catch (e) {
      // A failed capture may mean the relay itself is stale — drop it so the next
      // attempt starts with a fresh one.
      this.udpTunnels.delete(deviceId);
      try {
        socket.close();
      } catch {
        /* noop */
      }
      throw e;
    }
  }

  private udpTunnels = new Map<string, ReturnType<typeof tunnelService.openUdpTunnel>>();



  // Reassemble a channel's DRW fragments as a CONTIGUOUS byte stream starting at
  // the lowest index and stopping at the first gap — so a not-yet-retransmitted
  // packet can't misalign the frame data (the PPPP DrwAck flow control fills gaps).
  private channelDataContiguous(rx: Map<number, Map<number, Buffer>>, ch: number): Buffer {
    const frags = rx.get(ch);
    if (!frags || frags.size === 0) return Buffer.alloc(0);
    const keys = [...frags.keys()].sort((a, b) => a - b);
    const parts: Buffer[] = [];
    let expect = keys[0];
    for (const k of keys) {
      if (k !== expect) break; // gap — stop; wait for the missing fragment
      parts.push(frags.get(k)!);
      expect++;
    }
    return Buffer.concat(parts);
  }

  // Highest index N such that all indices from the first up to N are present (the
  // cumulative-ack point for the camera's send window).
  private highestContig(rx: Map<number, Map<number, Buffer>>, ch: number): number {
    const frags = rx.get(ch);
    if (!frags || frags.size === 0) return -1;
    const keys = [...frags.keys()].sort((a, b) => a - b);
    let expect = keys[0];
    let last = -1;
    for (const k of keys) {
      if (k !== expect) break;
      last = k;
      expect++;
    }
    return last;
  }

  /**
   * snapshot.cgi returns a JPEG inside the channel-0 DRW stream (after some
   * `result= 0;var …` text). Assemble it starting from the fragment that holds
   * the SOI marker and walking forward over consecutive indices.
   *
   * Deliberately NOT built on a globally-contiguous buffer: a single fragment
   * lost anywhere earlier in the session (e.g. in the preamble text) would cap
   * the contiguous prefix forever and the image could never complete, even
   * though every fragment of the JPEG itself arrived.
   */
  private extractJpegFromFragments(frags: Map<number, Buffer> | undefined): Buffer | null {
    if (!frags || frags.size === 0) return null;
    const keys = [...frags.keys()].sort((a, b) => a - b);

    for (let s = 0; s < keys.length; s++) {
      const start = frags.get(keys[s])!;
      const soi = start.indexOf(SOI);
      if (soi < 0) continue; // this fragment doesn't begin the image

      const parts: Buffer[] = [start.subarray(soi)];
      let assembled = Buffer.concat(parts);
      let eoi = assembled.indexOf(EOI);
      if (eoi >= 0) return assembled.subarray(0, eoi + 2);

      let expect = keys[s] + 1;
      for (let i = s + 1; i < keys.length; i++) {
        if (keys[i] !== expect) break; // gap inside the image — wait for it
        parts.push(frags.get(keys[i])!);
        expect++;
        assembled = Buffer.concat(parts);
        eoi = assembled.indexOf(EOI);
        if (eoi >= 0) return assembled.subarray(0, eoi + 2);
      }
      return null; // image started but is still incomplete
    }
    return null;
  }
}

export const okamP2PService = new OkamP2PService();
