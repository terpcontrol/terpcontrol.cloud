import type { IncomingMessage } from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { type Cipheriv, createCipheriv, createDecipheriv, type Decipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import { CAPTURE_BUDGET_SECONDS } from '@fg2/shared-types/v1-schemas';
import { logger } from '@utils/logger';
import { terpCamConfig } from '@config/configuration';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { RELAY_REQUEST, RelayRequestPort } from './relay-request';
import { TerpCamService } from './terpcam.service';
import { orientationOf } from './orientation';

/**
 * Terp Cam stills, fetched by the server itself over the camera's P2P protocol,
 * through the controller. This is the only way the cloud gets a Terp Cam still.
 *
 * The controller (on the camera's LAN) opens a connection to the API - an HTTP
 * upgrade, so it takes the path every other request takes, reverse proxy
 * included - and bridges the camera's P2P UDP over it; this service runs the whole
 * P2P client across that bridge and reassembles the still. Full resolution comes
 * from the main video stream: `snapshot.cgi` renders from the MJPEG encoder and
 * is pinned at 640x360 on this firmware, while the stream carries 2304x1296.
 *
 * With no relay configured the server reaches no Terp Cam at all, and neither
 * does it reach one that answers to no device: a standalone camera has no
 * controller to open the relay for it.
 *
 * Every call names the camera, which is the tenant boundary: the id and the
 * password come off that camera's own record, written from what its device
 * reported, never from anything a caller says.
 *
 * The protocol was reverse engineered from the vendor SDK; the notes are kept
 * internally, not in this repository.
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

/** Manufacturer default, for cameras paired before per-camera passwords, or reset since. */
const DEFAULT_PASSWORD = '888888';

function authFor(password: string): string {
  const pw = encodeURIComponent(password);
  return `name=admin&loginuse=admin&loginpas=${pw}&user=admin&pwd=${pw}&`;
}

const CMD_CHANNEL = 0;
const VIDEO_CHANNEL = 1;
const FRAME_MAGIC = Buffer.from([0x55, 0xaa, 0x15, 0xa8]);

// The timeouts below assume a slow and lossy path between the camera's site and
// the cloud: every datagram crosses the controller's uplink inside the relay.
// None of them runs before the relay is up - the MQTT request and the
// controller's dial-in have RELAY_DIAL_MS to themselves - but on the relay a TCP
// segment the uplink loses is resent only after ~3s, and after 6s more if it is
// lost again (lwIP's initial retransmission timeout, doubling), so a round trip
// that takes half a second on a good link can take ten on a choppy one.
//
// Each is a step's own limit inside the capture's budget, never beyond it: a
// step is given what is left of the budget where that is less.
const LOGIN_MS = 15_000;
/**
 * How long a login waits for the camera to send anything at all. The camera now
 * and then drops a session that opens just as another is starting, and a fresh
 * one is cheaper than waiting out LOGIN_MS. It answers within half a second on
 * the LAN, so this is sized for the relay instead: two lost segments in a row.
 */
const LOGIN_SILENT_MS = 10_000;
/**
 * How long one attempt waits for a keyframe. The first frame of a fresh stream is
 * one, so this is only spent in full when that frame cannot be repaired and the
 * next keyframe of the GOP is waited for instead - longer in wall time in night
 * mode, which runs at a lower frame rate.
 */
const TRANSFER_MS = 60_000;
/** How long the stream may stay silent, including before its first datagram. */
const IDLE_MS = 15_000;
/**
 * A gap that has not closed while the stream kept arriving for this long will
 * not close; take the next keyframe instead of repairing. Every fragment is acked
 * as it arrives, so the camera resends the oldest one it is missing within tens
 * of milliseconds. Only time with data arriving counts: on a link that stalls,
 * the resend is held up with everything else and arrives once it recovers.
 */
const GAP_ABANDON_MS = 3_000;
/** Indices per DrwAck; it names each one, so this bounds the datagram's size. */
const MAX_ACK_INDICES = 128;
/** A malfunctioning camera must not stream without end. */
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
/**
 * How long a camera that refused us is left alone. Every attempt takes one of
 * its few session slots, and when the uid is a neighbour's camera, the slot is
 * taken from its real owner.
 */
const REFUSED_BACKOFF_MS = 30 * 60_000;
/** Where the API serves the controller relay; docker-compose.yaml builds the URL controllers are sent from it. */
const RELAY_PATH = '/terpcam/relay';
/** The `Upgrade` token a controller asks for; anything else on the relay path is turned away. */
const RELAY_PROTOCOL = 'terpcam-relay';
/**
 * How long a controller has to dial back in once asked for a relay. Everything
 * before the dial-in adds up:
 * - the request crosses MQTT, and the controller only reads it between two
 *   passes of its loop - a loop that may be busy switching smart sockets (a
 *   pass can take ~8s when one is unreachable: 2s budget, then 3s connect and
 *   3s read on the request that overran it) or searching for the camera (12s);
 * - the relay learns the camera's P2P id first when it does not know it yet
 *   (discovery and a login, up to ~10s);
 * - it looks for the camera on its LAN (up to ~5s) and connects to the cloud
 *   over its own uplink (a few seconds, a TLS handshake included where the API
 *   is https).
 * The relay itself runs in its own task, so a busy loop no longer matters once
 * it has started.
 */
const RELAY_DIAL_MS = 45_000;
/** How long a controller that has connected has to send the relay header. */
const RELAY_HEADER_MS = 20_000;
/**
 * How long a relay being closed has for the controller to hang up its side. The
 * controller takes no new relay until it has, so a retry sent before that is
 * turned down; waiting here is cheaper than a retry that cannot succeed.
 */
const RELAY_CLOSE_MS = 10_000;
/**
 * A new attempt is started only with this much of the capture's budget left.
 * One that works takes a few seconds, and a relay asked for and then given up on
 * leaves the controller bridging for nobody until it notices.
 */
const MIN_ATTEMPT_MS = 20_000;
/**
 * Attempts start at least this far apart, so that one which fails at once - the
 * broker down, a camera that drops the session as it opens - is not repeated as
 * fast as it fails for the whole of the budget.
 */
const ATTEMPT_SPACING_MS = 10_000;

/** What is left of a deadline, never less than nothing. */
const left = (deadline: number): number => Math.max(0, deadline - Date.now());

type Endpoint = { address: string; port: number };
type Inbox = { message: Buffer; from: Endpoint }[];
/**
 * A Terp Cam as this path needs it: the device that bridges it, the id printed
 * on it - which its own reply is checked against - and the password it was
 * secured with. An empty secret means the camera still has the manufacturer's
 * default.
 */
export type RelayCamera = Pick<CameraDocument, 'id' | 'kind' | 'deviceId' | 'did'> &
  Partial<Pick<CameraDocument, 'orientation'>> & { secret: string | null };
/**
 * The dgram-style slice the P2P client uses, satisfied by the RelaySocket the
 * controller bridge provides. Kept as an interface so login and readKeyframe
 * neither know nor care how the datagrams get to the camera.
 */
type P2PSocket = {
  send(msg: Buffer, port?: number, address?: string, cb?: (err?: Error | null) => void): void;
};

type Session = {
  socket: P2PSocket;
  peer: Endpoint;
  inbox: Inbox;
  auth: string;
  /** Channel-0 request index; must advance by exactly one per request. */
  next: number;
};

/** The relay talks to the one camera its controller discovered, so there is only ever this peer. */
const RELAY_PEER: Endpoint = { address: 'relay', port: 1 };

/**
 * A dgram-shaped socket whose datagrams cross a controller's TCP connection (the
 * cam_relay firmware path) instead of the network directly. The camera's bytes
 * arrive with the vendor's table cipher still on and are passed through
 * untouched, so the client deobfuscates them exactly as for a real socket.
 *
 * On the wire each datagram is a 2-byte big-endian length and the datagram, and
 * everything after the connection's header is AES-128-CTR under a key sent with
 * the cam_relay command, one per direction: every CGI carries the camera's
 * password, which the table cipher does not protect. An empty frame tells the
 * controller the cloud is done.
 */
class RelaySocket extends EventEmitter implements P2PSocket {
  private held: Buffer;
  private readonly hungUp: Promise<void>;
  private closing?: Promise<void>;
  constructor(
    private readonly conn: net.Socket,
    public readonly did: Buffer,
    decipher: Decipheriv,
    private readonly cipher: Cipheriv,
    initial: Buffer,
  ) {
    super();
    this.hungUp = new Promise(resolve => conn.once('close', () => resolve()));
    // The HTTP server leaves an upgraded socket half-open; a controller that has hung up is done.
    conn.once('end', () => conn.end());
    this.held = decipher.update(initial);
    conn.on('data', chunk => this.onData(decipher.update(chunk)));
    conn.on('error', () => undefined);
    if (this.held.length) setImmediate(() => this.onData(Buffer.alloc(0)));
  }
  private onData(chunk: Buffer): void {
    this.held = this.held.length ? Buffer.concat([this.held, chunk]) : chunk;
    for (;;) {
      if (this.held.length < 2) return;
      const len = this.held.readUInt16BE(0);
      if (this.held.length < 2 + len) return;
      const payload = Buffer.from(this.held.subarray(2, 2 + len));
      this.held = this.held.subarray(2 + len);
      this.emit('message', payload);
    }
  }
  public send(msg: Buffer, _port?: number, _address?: string, cb?: (err?: Error | null) => void): void {
    if (!this.conn.writable) return;
    const frame = Buffer.allocUnsafe(2 + msg.length);
    frame.writeUInt16BE(msg.length, 0);
    msg.copy(frame, 2);
    this.conn.write(this.cipher.update(frame), () => cb?.());
  }
  /**
   * Tell the controller the cloud is done, and wait for it to hang up: it does
   * so only after closing the camera session on the LAN, so once this resolves
   * the relay has ended and the camera's slot is free for the next capture.
   *
   * The empty frame is the only signal; this side does not close first. A
   * reverse proxy ends both sides as soon as one of them does, so a close from
   * here would come back as the controller's hang-up while it is still ending
   * the relay - and it turns down the next one until it has.
   */
  public close(waitMs = RELAY_CLOSE_MS): Promise<void> {
    if (!this.closing) {
      this.removeAllListeners('message');
      this.send(Buffer.alloc(0));
      const timer = setTimeout(() => this.conn.destroy(), waitMs);
      timer.unref?.();
      this.closing = this.hungUp.finally(() => clearTimeout(timer));
    }
    return this.closing;
  }
}

/** Whether a backoff recorded in `until` still holds for the device; an expired one is forgotten. */
function holds(until: Map<string, number>, deviceId: string): boolean {
  const end = until.get(deviceId);
  if (end === undefined) return false;
  if (Date.now() < end) return true;
  until.delete(deviceId);
  return false;
}

/** Every send is fire-and-forget; errors surface as the session going quiet. */
function send(socket: P2PSocket, to: Endpoint, packet: Buffer): void {
  socket.send(packet, to.port, to.address, () => undefined);
}

/** Symmetric table cipher: `prev` is always the ciphertext byte. */
export function obfuscate(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = SBOX[(DK[prev & 3] + prev) & 0xff] ^ buf[i];
    out[i] = c;
    prev = c;
  }
  return out;
}

export function deobfuscate(buf: Buffer): Buffer {
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

/**
 * DrwAck naming every index in `indices`. It acknowledges exactly those: the
 * camera keeps resending the oldest DRW it has no ack for, every ~40ms (measured),
 * so an index left out is one it sends again - which is what repairs a fragment
 * lost on the way, and what floods the link when received ones go unnamed.
 */
export function buildAck(channel: number, indices: number[]): Buffer {
  const body = Buffer.alloc(4 + 2 * indices.length);
  body[0] = 0xd1;
  body[1] = channel;
  body.writeUInt16BE(indices.length, 2);
  indices.forEach((index, i) => body.writeUInt16BE(index & 0xffff, 4 + 2 * i));
  return buildPacket(0xd1, body);
}

/** How far before the first fragment seen a late one is still taken as part of the stream. */
const MAX_EARLY_FRAGMENTS = 1024;

/**
 * The video channel's fragments, kept by index, and the contiguous run that
 * starts at the lowest index received. The lowest is not necessarily the first
 * to arrive: a fragment lost at the start of the stream is resent after later
 * ones, and it is the start of the keyframe.
 */
export class FragmentAssembly {
  /** Index of the first fragment received; the others are kept by their distance from it. */
  private first: number | null = null;
  private readonly fragments = new Map<number, Buffer>();
  private lowest = 0;
  private length = 0;

  /** Keeps the fragment; true when the contiguous run grew, and with it what contiguous() returns. */
  public add(index: number, payload: Buffer): boolean {
    if (this.first === null) this.first = index;
    // Signed distance, so a resend from before the first fragment is negative rather than near 65536.
    const at = ((((index - this.first) & 0xffff) + 0x8000) & 0xffff) - 0x8000;
    if (this.fragments.has(at) || at < -MAX_EARLY_FRAGMENTS) return false;
    this.fragments.set(at, payload);
    if (this.fragments.size === 1 || at < this.lowest) {
      this.lowest = at;
      this.length = 0;
    } else if (at !== this.lowest + this.length) {
      return false;
    }
    while (this.fragments.has(this.lowest + this.length)) this.length++;
    return true;
  }

  public contiguous(): Buffer {
    return Buffer.concat(Array.from({ length: this.length }, (_, i) => this.fragments.get(this.lowest + i) as Buffer));
  }
}

/**
 * Which camera answered a `get_status.cgi`, and whether it took the password.
 * Every reply names the camera's printed id (the controller's `webcam_did`):
 * `vuid=<id>;` when it refused, `var realdeviceid="<id>";` when it accepted. So
 * the check works without knowing the password of a camera that is not ours.
 *
 * `realdeviceid` is read first and is authoritative: an accepted reply also
 * carries unrelated `..._vuid` flags (`support_vuid=1`, `vuidResult=0`), so a
 * bare `vuid=` search would latch onto one of those and read the id as "1". The
 * field boundary (no preceding word character) is what keeps `vuid=` from
 * matching the tail of `support_vuid=`; `vuid` is only consulted for the refused
 * reply, which has no `realdeviceid`.
 */
type StatusVerdict = 'ours' | 'foreign' | 'refused' | 'pending';

export function checkStatusReply(text: string, label: string): StatusVerdict {
  const id = /(?<![\w])realdeviceid="?([^";]+)[";]/.exec(text)?.[1] ?? /(?<![\w])vuid="?([^";]+)[";]/.exec(text)?.[1];
  if (id === undefined) return 'pending';
  if (id !== label) return 'foreign';
  return /result=-1/.test(text) ? 'refused' : 'ours';
}

/** Thrown when a camera must not be asked again for a while; see REFUSED_BACKOFF_MS. */
export class CameraRefusedError extends Error {}

@Injectable()
export class TerpCamDirectService implements OnApplicationBootstrap, OnApplicationShutdown {
  /** The controller-relay path: the URL controllers are told to open. */
  private readonly relayUrl: string;
  /** The API's HTTP server, which hands relay dial-ins to onUpgrade. */
  private relayServer: net.Server | null = null;
  /** Relay connections awaited by token, resolved when a controller dials in. */
  private pendingRelays = new Map<string, { key: Buffer; resolve: (s: RelaySocket) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  /** Relays open right now, closed on shutdown. */
  private relays = new Set<RelaySocket>();
  /**
   * At most one capture per device: its controller bridges one relay at a time,
   * so a second request (a poll and the test-image button together) would only
   * wait out the dial-in and look like a controller without the relay.
   */
  private inflight = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly stills: TerpCamService,
    @Inject(RELAY_REQUEST) private readonly relay: RelayRequestPort,
    @Inject(terpCamConfig.KEY) config: ConfigType<typeof terpCamConfig>,
    private readonly http: HttpAdapterHost,
  ) {
    this.relayUrl = config.relayUrl;
  }

  public onApplicationBootstrap(): void {
    if (!this.relayUrl) return;
    const server = this.http.httpAdapter?.getHttpServer() as net.Server | undefined;
    if (!server) return;
    server.on('upgrade', this.onUpgrade);
    this.relayServer = server;
    logger.info(`[terpcam] controller relay served on ${RELAY_PATH}, controllers told to open ${this.relayUrl}`);
  }

  /**
   * The API's HTTP server hands every upgrade request here. Node destroys an
   * upgrade nobody listens for, and nothing else on this server takes one, so
   * whatever is not a relay is answered and closed rather than left hanging.
   */
  private readonly onUpgrade = (req: IncomingMessage, conn: net.Socket, head: Buffer): void => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.endsWith(RELAY_PATH) || req.headers.upgrade?.toLowerCase() !== RELAY_PROTOCOL) {
      conn.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    conn.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${RELAY_PROTOCOL}\r\nConnection: Upgrade\r\n\r\n`);
    this.onRelayConnection(conn, head);
  };

  /**
   * A controller has dialled in and been switched over (onUpgrade). Read the one header frame (token + NUL + the
   * camera's 20-byte P2P id, the id already enciphered), match it to a pending
   * capture by token, and hand the rest of the stream to a RelaySocket. An
   * unmatched or malformed dial-in is dropped rather than trusted.
   */
  private onRelayConnection(conn: net.Socket, head: Buffer = Buffer.alloc(0)): void {
    conn.setNoDelay(true);
    // The HTTP server's idle timeout would otherwise end a relay mid-still.
    conn.setTimeout(0);
    conn.on('error', () => undefined);
    let buf: Buffer = Buffer.alloc(0);
    const drop = setTimeout(() => conn.destroy(), RELAY_HEADER_MS);
    const onHeader = (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      if (buf.length < 2) return;
      const len = buf.readUInt16BE(0);
      if (len < 21 || len > 128 || buf.length < 2 + len) {
        if (len < 21 || len > 128) conn.destroy();
        return;
      }
      clearTimeout(drop);
      conn.removeListener('data', onHeader);
      const header = buf.subarray(2, 2 + len);
      const rest = Buffer.from(buf.subarray(2 + len));
      const nul = header.indexOf(0);
      const token = nul >= 0 ? header.subarray(0, nul).toString('latin1') : '';
      const pending = token ? this.pendingRelays.get(token) : undefined;
      if (!pending || header.length - nul - 1 !== 20) {
        conn.destroy();
        return;
      }
      this.pendingRelays.delete(token);
      clearTimeout(pending.timer);
      const decipher = createDecipheriv('aes-128-ctr', pending.key.subarray(0, 16), Buffer.alloc(16));
      const cipher = createCipheriv('aes-128-ctr', pending.key.subarray(16), Buffer.alloc(16));
      const did = decipher.update(header.subarray(nul + 1));
      pending.resolve(new RelaySocket(conn, did, decipher, cipher, rest));
    };
    conn.on('data', onHeader);
    if (head.length) onHeader(head);
  }

  /** Ask the controller to open a relay, and wait for it to dial back in, for as long as `waitMs` says. */
  private relayConnect(deviceId: string, waitMs = RELAY_DIAL_MS): Promise<RelaySocket> {
    const token = randomBytes(16).toString('hex');
    const key = randomBytes(32);
    return new Promise<RelaySocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRelays.delete(token);
        // An ordinary failed attempt, retried like any other: a slow link, a
        // controller still ending the previous relay, or one that did not find
        // the camera on its LAN this time all look like this.
        reject(new Error('the controller did not open the relay in time'));
      }, waitMs);
      timer.unref?.();
      this.pendingRelays.set(token, { key, resolve, reject, timer });
      const asked = this.relay.requestRelay(deviceId, { url: this.relayUrl, token, key: key.toString('hex') });
      if (!asked) {
        clearTimeout(timer);
        this.pendingRelays.delete(token);
        reject(new Error('could not ask the controller for a relay'));
      }
    });
  }

  /** Gives every open relay back, so the cameras' slots are free and the process can end. */
  public async onApplicationShutdown(): Promise<void> {
    for (const pending of this.pendingRelays.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('server is shutting down'));
    }
    this.pendingRelays.clear();
    this.relayServer?.off('upgrade', this.onUpgrade);
    this.relayServer = null;
    await Promise.all([...this.relays].map(relay => relay.close()));
  }

  /** Devices whose camera refused us, and until when it is left alone. */
  private refused = new Map<string, number>();

  /**
   * The device has reported something about its camera: a different camera, a
   * new password, the P2P id its controller has just learned, or simply a reboot.
   * Whatever kept the server away from it may no longer hold.
   */
  public cameraReported(deviceId: string): void {
    this.refused.delete(deviceId);
  }

  /**
   * Whether this path can reach the camera at all: a relay to open, a Terp Cam
   * paired at a device to open it, and the id printed on the camera to check its
   * reply against. The camera's P2P id is the device's business - one that does
   * not know it yet learns it on its LAN before it opens the relay - so it is
   * not waited for here.
   */
  public canReach(camera: Pick<RelayCamera, 'kind' | 'deviceId' | 'did'>): boolean {
    return this.relayUrl !== '' && camera.kind === 'terpcam_controller' && !!camera.deviceId && !!camera.did;
  }

  /**
   * Send a CGI on the command channel. The index MUST advance by exactly one:
   * skip a number and the camera stops responding, silently and permanently.
   */
  private request(session: Session, cgi: string): void {
    send(session.socket, session.peer, buildCgi(CMD_CHANNEL, session.next++, cgi));
  }

  /**
   * Pull one still as a ready JPEG, the keyframe in by `deadline`. A capture of
   * the device's camera that is already running is the answer rather than a
   * second one beside it, and its deadline is the earlier one.
   */
  public captureStill(camera: RelayCamera, deadline: number): Promise<Buffer> {
    const deviceId = camera.deviceId;
    if (!deviceId) return Promise.reject(new Error('this camera answers to no device, so nothing can bridge it to this server'));
    const running = this.inflight.get(deviceId);
    if (running) return running;
    const still = this.captureJpeg(camera, deadline).finally(() => this.inflight.delete(deviceId));
    this.inflight.set(deviceId, still);
    return still;
  }

  private async captureJpeg(camera: RelayCamera, deadline: number): Promise<Buffer> {
    const data = await this.capture(camera, deadline);
    const jpeg = await this.stills.decodeKeyframeToJpeg(data, orientationOf(camera));
    logger.info(`[terpcam] camera ${camera.id}: ${data.length}B keyframe -> ${jpeg.length}B jpeg`);
    return jpeg;
  }

  /**
   * One still over a fresh relay: the controller bridges the camera's P2P and the
   * cloud runs the client, taking the camera's P2P id off the relay header. The
   * relay is closed before this returns, whatever happened, so the controller is
   * free for the next one straight after - and all of it by `deadline`.
   */
  private async readStill(deviceId: string, label: string, secret: string | null, deadline: number): Promise<Buffer | null> {
    const socket = await this.relayConnect(deviceId, Math.min(RELAY_DIAL_MS, left(deadline)));
    this.relays.add(socket);
    const inbox: Inbox = [];
    socket.on('message', (message: Buffer) => inbox.push({ message: deobfuscate(message), from: RELAY_PEER }));
    // login consumes channel-0 index 0, so requests continue from 1
    const session: Session = { socket, peer: RELAY_PEER, inbox, auth: authFor(secret || DEFAULT_PASSWORD), next: 1 };
    let loggedIn = false;
    try {
      await this.login(socket, inbox, socket.did, RELAY_PEER, session.auth, label, deadline);
      loggedIn = true;
      return await this.readKeyframe(session, deadline);
    } finally {
      // Stop the stream and give the camera its slot back; the controller also
      // closes the session on the LAN once the relay ends.
      if (loggedIn) this.request(session, `livestream.cgi?streamid=16&substream=0&${session.auth}`);
      send(socket, RELAY_PEER, buildPacket(0xf0));
      await socket.close(Math.min(RELAY_CLOSE_MS, left(deadline)));
      this.relays.delete(socket);
    }
  }

  /**
   * Pull one still, always a full-resolution H.264 keyframe. There is no
   * `snapshot.cgi` fallback: it only returns 640x360, and a poll left without a
   * picture is better than a downgraded one in the timelapse.
   *
   * Everything - every attempt, each relay's dial-in and close - happens by
   * `deadline`, which is the capture's budget unless the caller set it.
   */
  public async capture(camera: RelayCamera, deadline = Date.now() + CAPTURE_BUDGET_SECONDS * 1000): Promise<Buffer> {
    if (!this.relayUrl) {
      throw new Error('no relay configured, so the server cannot reach a Terp Cam');
    }
    const { deviceId, did } = camera;
    if (camera.kind !== 'terpcam_controller' || !deviceId || !did) {
      throw new Error('this device has not reported a camera we can reach');
    }
    if (holds(this.refused, deviceId)) {
      throw new Error('the camera refused this server recently');
    }

    // A FRESH session per still, closed right after. Reusing a held session over
    // the relay returned the previous keyframe as often as a new one (a
    // re-requested stream on a live session is ignored), so a fresh session is
    // both the freshest frame and the most reliable one: the keyframe is the first
    // frame of a new stream. It does not accumulate sessions because the controller
    // frees the camera's slot on every relay exit, and readStill waits for that.
    // Further attempts ride out a slot a previous capture has not freed yet, a
    // relay that did not open and a stream that broke off, for as long as the
    // budget leaves room for one; the last one's failure is the capture's.
    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      try {
        const keyframe = await this.readStill(deviceId, did, camera.secret, deadline);
        if (!keyframe) throw new Error('no keyframe arrived');
        return keyframe;
      } catch (error) {
        if (error instanceof CameraRefusedError) {
          logger.warn(`[terpcam] ${deviceId}: ${error.message}, not asking again for ${REFUSED_BACKOFF_MS / 60_000} min`);
          this.refused.set(deviceId, Date.now() + REFUSED_BACKOFF_MS);
          throw error;
        }
        const next = Math.max(Date.now(), startedAt + ATTEMPT_SPACING_MS);
        if (deadline - next < MIN_ATTEMPT_MS) throw error;
        logger.info(`[terpcam] ${deviceId}: capture attempt ${attempt} failed (${(error as Error).message}); retrying on a fresh session`);
        // `next` may be now already, and a millisecond later than that is a
        // negative wait, which node rounds up to one and warns about.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, next - Date.now())));
      }
    }
  }

  private async login(socket: P2PSocket, inbox: Inbox, did: Buffer, peer: Endpoint, auth: string, label: string, deadline = Infinity): Promise<void> {
    const trailer = Buffer.from([0x00, 0x02, 0x12, 0x64, 0x10, 0x02, 0x00, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const devlgn = Buffer.concat([did, trailer]);
    // The reply can span fragments; kept by index so they join in order.
    const reply = new Map<number, Buffer>();
    // Held in an object because it is assigned from inside a callback.
    const state: { verdict: StatusVerdict } = { verdict: 'pending' };
    // What came back, by packet type: the failure message says how far it got.
    const heard = new Map<number, number>();
    const started = Date.now();
    const until = Math.min(started + LOGIN_MS, deadline);
    while (Date.now() < until && (heard.size > 0 || Date.now() < started + LOGIN_SILENT_MS)) {
      // Asked once it answers: a second get_status would restart the reply.
      if (reply.size === 0) {
        for (const packet of [buildPacket(0x00), buildPacket(0x05, did), buildPacket(0x20, devlgn), buildPacket(0x41, did)]) {
          send(socket, peer, packet);
        }
        send(socket, peer, buildCgi(CMD_CHANNEL, 0, `get_status.cgi?${auth}`));
      }

      await this.drain(inbox, 1_000, entry => {
        const m = entry.message;
        if (m.length >= 2) heard.set(m[1], (heard.get(m[1]) ?? 0) + 1);
        if (m.length >= 4 && (m[1] === 0x42 || m[1] === 0x43)) {
          send(socket, entry.from, obfuscate(m));
          return false;
        }
        if (m.length > 8 && m[1] === 0xd0 && m[5] === CMD_CHANNEL) {
          const index = m.readUInt16BE(6);
          send(socket, peer, buildAck(CMD_CHANNEL, [index]));
          if (!reply.has(index)) reply.set(index, m.subarray(8));
          const ordered = [...reply.keys()].sort((a, b) => a - b).map(key => reply.get(key) as Buffer);
          state.verdict = checkStatusReply(Buffer.concat(ordered).toString('latin1'), label);
          return state.verdict !== 'pending';
        }
        return false;
      });

      if (state.verdict === 'ours') return;
      // Anything else gives the camera its slot back before giving up.
      if (state.verdict !== 'pending') send(socket, peer, buildPacket(0xf0));
      if (state.verdict === 'refused') throw new CameraRefusedError('camera rejected the password');
      if (state.verdict === 'foreign') throw new CameraRefusedError(`UID belongs to a different camera than ${label}`);
    }
    if (reply.size) throw new Error('camera did not say which camera it is');
    const seconds = Math.round((Date.now() - started) / 1000);
    const got = [...heard].map(([type, n]) => `${type.toString(16).padStart(2, '0')}x${n}`).join(' ');
    throw new Error(`camera did not accept the session (${got ? `only ${got}` : 'nothing back'} in ${seconds}s)`);
  }

  /**
   * Take a full-resolution keyframe off the video stream; the caller stops the
   * stream. The first frame of a fresh stream is the keyframe, a burst of ~30-50
   * fragments, and the controller's relay loses one now and then. What gets it
   * through is acking EVERY fragment as it arrives: the camera then resends only
   * the one that is missing, within tens of milliseconds, and the keyframe is
   * complete a moment later. Acking only the newest fragment left every other one
   * unacknowledged, so the camera kept resending the oldest of them instead of the
   * one that was lost; the keyframe was given up and the next one of the GOP,
   * 15-20 seconds later, waited for.
   *
   * EVERY frame is still examined, not just the first, for when that one is lost
   * after all and the next keyframe has to do.
   */
  private async readKeyframe(session: Session, deadline = Infinity): Promise<Buffer | null> {
    const { socket, peer, inbox, auth } = session;
    inbox.length = 0;
    this.request(session, `livestream.cgi?streamid=10&substream=2&${auth}`);

    let assembly = new FragmentAssembly();
    const unacked: number[] = [];
    const ack = () => {
      while (unacked.length) send(socket, peer, buildAck(VIDEO_CHANNEL, unacked.splice(0, MAX_ACK_INDICES)));
    };
    const until = Math.min(Date.now() + TRANSFER_MS, deadline);
    let lastData = Date.now();
    let lastProgress = Date.now();

    while (Date.now() < until && Date.now() - lastData < IDLE_MS) {
      const found: { frame: Buffer | null } = { frame: null };
      await this.drain(
        inbox,
        300,
        entry => {
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
          // A fragment that arrives twice was resent because our ack got lost, so it is acked again.
          unacked.push(index);
          if (!assembly.add(index, m.subarray(8, 8 + length))) return false;

          lastProgress = Date.now();
          const frame = this.findKeyframe(assembly.contiguous());
          if (frame) {
            found.frame = frame;
            return true;
          }
          return false;
        },
        ack,
      );
      ack();
      if (found.frame) return found.frame;
      if (lastData - lastProgress > GAP_ABANDON_MS) {
        assembly = new FragmentAssembly();
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

  /**
   * Consume queued datagrams for up to `ms`, stopping early if `handler` says so.
   * `caughtUp` runs whenever the queue has been emptied, so replies to a burst go
   * out once per burst rather than once per datagram.
   */
  private async drain(inbox: Inbox, ms: number, handler: (entry: Inbox[number]) => boolean, caughtUp?: () => void): Promise<void> {
    const until = Date.now() + ms;
    for (;;) {
      while (inbox.length) {
        const entry = inbox.shift();
        if (entry && handler(entry)) return;
      }
      caughtUp?.();
      if (Date.now() >= until) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
}
