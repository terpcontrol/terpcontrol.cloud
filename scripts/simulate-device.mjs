// Simulated grow device. Speaks the same MQTT topics and HTTP endpoints as the
// firmware in firmware/, so the server and the webapp cannot tell it apart from
// real hardware. Launched through ../simulate-device.sh, which supplies the
// configuration from .env.
//
// MQTT is spoken directly over a socket rather than through a client library:
// the repo root has no package.json, and a dev tool that needs `npm install`
// before it runs is a dev tool nobody runs.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// The socket report is a contract between firmware, server and webapp; the
// simulator answers to the same one.
import { MAX_SOCKETS, SOCKETS_PER_REPORT_CHUNK, socketListKey, socketRolesFor } from '../shared-types/index.js';

const STATE_DIR = '.simulated-devices';
const API_URL = process.env.SIM_API_URL.replace(/\/$/, '');
const MQTT_HOST = process.env.SIM_MQTT_HOST;
const MQTT_PORT = Number(process.env.SIM_MQTT_PORT);
const REGISTRATION_PASSWORD = process.env.SIM_REGISTRATION_PASSWORD ?? '';
const USER = process.env.SIM_USER ?? '';
const USER_PASSWORD = process.env.SIM_USER_PASSWORD ?? '';

// Stands in for the MAC the firmware reads out of Tasmota's `Status 5` and then
// finds the socket by. Derived from the address so a socket keeps its id across
// restarts, and so two sockets are never given the same one.
const simulatedSocketId = (role, ip) =>
  createHash('sha1')
    .update(`${role}@${ip}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();


// ---------------------------------------------------------------- MQTT client

const CONNECT = 1,
  CONNACK = 2,
  PUBLISH = 3,
  SUBSCRIBE = 8,
  SUBACK = 9,
  PINGREQ = 12,
  DISCONNECT = 14;

const CONNACK_ERRORS = {
  1: 'unacceptable protocol version',
  2: 'client id rejected',
  3: 'server unavailable',
  4: 'bad username or password',
  5: 'not authorized',
};

const varLength = n => {
  const out = [];
  do {
    let digit = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) digit |= 0x80;
    out.push(digit);
  } while (n > 0);
  return Buffer.from(out);
};

const mqttString = value => {
  const body = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length);
  return Buffer.concat([length, body]);
};

const packet = (type, flags, rest) => Buffer.concat([Buffer.from([(type << 4) | flags]), varLength(rest.length), rest]);

class MqttClient {
  #socket;
  #buffer = Buffer.alloc(0);
  #keepAlive;
  #packetId = 1;
  handlers = [];
  connected = false;

  constructor({ clientId, username, password }) {
    Object.assign(this, { clientId, username, password });
  }

  connect() {
    return new Promise((resolve, reject) => {
      const fail = error => {
        this.connected = false;
        this.#stopKeepAlive();
        this.#socket.destroy();
        reject(error);
      };
      this.#socket = net.createConnection({ host: MQTT_HOST, port: MQTT_PORT });
      this.#socket.setTimeout(10000, () => fail(new Error(`No MQTT answer from ${MQTT_HOST}:${MQTT_PORT}`)));
      this.#socket.on('error', fail);
      this.#socket.on('data', chunk => this.#onData(chunk));
      this.#socket.on('close', () => {
        this.connected = false;
        this.#stopKeepAlive();
      });
      this.#socket.on('connect', () => {
        const header = Buffer.concat([mqttString('MQTT'), Buffer.from([4, 0xc2, 0, 60])]);
        this.#socket.write(
          packet(CONNECT, 0, Buffer.concat([header, mqttString(this.clientId), mqttString(this.username), mqttString(this.password)])),
        );
      });
      this.handlers.push(message => {
        if (message.type !== CONNACK) return;
        const code = message.body[1];
        if (code === 0) {
          this.#socket.setTimeout(0);
          this.connected = true;
          this.#keepAlive = setInterval(() => this.#socket.write(packet(PINGREQ, 0, Buffer.alloc(0))), 30000);
          resolve();
        } else {
          fail(new Error(`MQTT connection refused: ${CONNACK_ERRORS[code] ?? `code ${code}`}`));
        }
      });
    });
  }

  publish(topic, payload) {
    this.#socket.write(packet(PUBLISH, 0, Buffer.concat([mqttString(topic), Buffer.from(String(payload), 'utf8')])));
  }

  subscribe(filter) {
    const id = Buffer.alloc(2);
    id.writeUInt16BE(this.#packetId++);
    this.#socket.write(packet(SUBSCRIBE, 2, Buffer.concat([id, mqttString(filter), Buffer.from([0])])));
    return new Promise(resolve => this.handlers.push(message => message.type === SUBACK && resolve()));
  }

  onMessage(callback) {
    this.handlers.push(message => {
      if (message.type !== PUBLISH) return;
      const topicLength = message.body.readUInt16BE(0);
      callback(message.body.subarray(2, 2 + topicLength).toString('utf8'), message.body.subarray(2 + topicLength).toString('utf8'));
    });
  }

  end() {
    this.#stopKeepAlive();
    this.#socket?.write(packet(DISCONNECT, 0, Buffer.alloc(0)));
    this.#socket?.end();
  }

  #stopKeepAlive() {
    if (this.#keepAlive) clearInterval(this.#keepAlive);
    this.#keepAlive = null;
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      if (this.#buffer.length < 2) return;
      let length = 0;
      let multiplier = 1;
      let offset = 1;
      let digit;
      do {
        if (offset >= this.#buffer.length) return;
        digit = this.#buffer[offset++];
        length += (digit & 127) * multiplier;
        multiplier *= 128;
      } while (digit & 0x80);

      if (this.#buffer.length < offset + length) return;
      const message = { type: this.#buffer[0] >> 4, body: this.#buffer.subarray(offset, offset + length) };
      this.#buffer = this.#buffer.subarray(offset + length);
      for (const handler of this.handlers) handler(message);
    }
  }
}

// ------------------------------------------------------------------ HTTP / API

const api = async (path, { method = 'GET', body, token } = {}) => {
  const response = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const login = async () => {
  if (!USER) throw new Error('No user configured. Set AGENT_TESTING_USERNAME/PASSWORD (or ADMINUSER_*) in .env.');
  const { userToken } = await api('/login', { method: 'POST', body: { username: USER, password: USER_PASSWORD } });
  return userToken.token;
};

// ----------------------------------------------------------- Device behaviour

// The keys each hardware type reports, mirroring the status documents built in
// firmware/src_hwtype/*/. Sending keys a type never reports would show the
// webapp tiles that real hardware of that type never has.
const PROFILES = {
  fridge: {
    sensors: ['temperature', 'humidity', 'co2'],
    outputs: ['heater', 'dehumidifier', 'co2', 'light', 'fan-internal', 'fan-external', 'fan-backwall'],
  },
  controller: {
    sensors: ['temperature', 'humidity', 'co2', 'sensor_type', 'leaf_temperature', 'lux'],
    outputs: ['heater', 'dehumidifier', 'co2', 'light'],
  },
  plug: { sensors: ['temperature', 'humidity', 'co2', 'sensor_type'], outputs: ['relais'] },
  fan: { sensors: ['temperature', 'humidity', 'rpm', 'day'], outputs: ['fan'] },
  light: { sensors: ['temperature', 'humidity'], outputs: ['light'] },
};

const DEFAULT_CONFIG = {
  workmode: 'small',
  daynight: { day: 21600, night: 64800 },
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 21, humidity: 55 },
  co2: { target: 900, sunsetOff: true },
  lights: { sunrise: 15, sunset: 15, limit: 100, maintenanceOn: false },
  fans: { internal: 60, external: 40 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));

// Deterministic noise, seeded from the device id: two runs of `history` for the
// same device draw the same curve, so a chart screenshot stays comparable.
const makeRandom = seed => {
  let state = [...seed].reduce((hash, char) => (Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0), 2166136261);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const configValue = (config, path, fallback) => path.split('.').reduce((node, key) => node?.[key], config) ?? fallback;

// Light level in percent for a point in time, following the configured day
// window with a linear sunrise/sunset ramp.
const lightPercent = (config, secondsOfDay) => {
  const dayStart = configValue(config, 'daynight.day', DEFAULT_CONFIG.daynight.day);
  const nightStart = configValue(config, 'daynight.night', DEFAULT_CONFIG.daynight.night);
  const limit = configValue(config, 'lights.limit', 100);
  const rampUp = configValue(config, 'lights.sunrise', 15) * 60;
  const rampDown = configValue(config, 'lights.sunset', 15) * 60;

  const isDay =
    dayStart <= nightStart
      ? secondsOfDay >= dayStart && secondsOfDay < nightStart
      : secondsOfDay >= dayStart || secondsOfDay < nightStart;
  if (!isDay) return 0;

  const sinceSunrise = (secondsOfDay - dayStart + 86400) % 86400;
  const untilSunset = (nightStart - secondsOfDay + 86400) % 86400;
  const ramp = Math.min(rampUp > 0 ? sinceSunrise / rampUp : 1, rampDown > 0 ? untilSunset / rampDown : 1, 1);
  return clamp(limit * ramp, 0, 100);
};

// One climate step. `state` is carried between steps so temperature, humidity
// and CO2 drift instead of jumping, both live and while backfilling history.
const step = (state, config, at, stepSeconds, random) => {
  const secondsOfDay = at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds();
  const light = lightPercent(config, secondsOfDay);
  const isDay = light > 0.5;

  const targetTemperature = configValue(config, isDay ? 'day.temperature' : 'night.temperature', isDay ? 25 : 21);
  const targetHumidity = configValue(config, isDay ? 'day.humidity' : 'night.humidity', isDay ? 60 : 55);
  const targetCo2 = configValue(config, 'co2.target', 900);

  // First-order approach to the target, so a settings change is visible as a
  // curve bending over minutes rather than a step.
  const rate = clamp(stepSeconds / 1800, 0, 0.6);
  state.temperature += (targetTemperature + (isDay ? 0.6 : -0.4) - state.temperature) * rate + (random() - 0.5) * 0.25;
  state.humidity += (targetHumidity - state.humidity) * rate + (random() - 0.5) * 1.4;
  const co2Target = isDay ? targetCo2 : 430;
  state.co2 += (co2Target - state.co2) * rate + (random() - 0.5) * 25;

  state.temperature = clamp(state.temperature, 5, 45);
  state.humidity = clamp(state.humidity, 15, 95);
  state.co2 = clamp(state.co2, 380, 2000);

  const heater = clamp((targetTemperature - state.temperature) * 0.9, 0, 1);
  const dehumidifier = state.humidity > targetHumidity + 2 ? 1 : 0;
  const co2Valve = isDay && state.co2 < targetCo2 - 40 ? 1 : 0;
  const internal = configValue(config, 'fans.internal', 60) / 100;
  const external = clamp(configValue(config, 'fans.external', 40) / 100 + dehumidifier * 0.4, 0, 1);

  return {
    sensors: {
      temperature: round(state.temperature),
      humidity: round(state.humidity),
      co2: round(state.co2, 0),
      sensor_type: 1,
      leaf_temperature: round(state.temperature - (isDay ? 2 : 0.2)),
      lux: round(light * 400, 0),
      rpm: round(internal * 3000, 0),
      day: isDay ? 1 : 0,
    },
    outputs: {
      heater: round(heater),
      dehumidifier,
      co2: co2Valve,
      light: round(light, 1),
      fan: round(internal),
      relais: heater > 0.1 ? 1 : 0,
      'fan-internal': round(internal),
      'fan-external': round(external),
      'fan-backwall': round(internal * 0.5),
    },
  };
};

// Trim a full sample down to the keys this hardware type reports and apply
// whatever the caller pinned with --set.
const shape = (sample, type, overrides) => {
  const profile = PROFILES[type];
  const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));
  const result = { sensors: pick(sample.sensors, profile.sensors), outputs: pick(sample.outputs, profile.outputs) };
  for (const [key, value] of Object.entries(overrides)) {
    const target = key.startsWith('out_') ? result.outputs : result.sensors;
    target[key.replace(/^out_/, '')] = value;
  }
  return result;
};

// ----------------------------------------------------------------- Camera

/**
 * An H.264 encoder small enough to keep this tool dependency-free.
 *
 * Every macroblock is I_PCM: its samples are stored as they are, so there is no
 * prediction, transform or entropy coding to get right, only the bitstream
 * syntax around them. That is a large keyframe (384 bytes per 16x16 pixels),
 * but a valid Baseline one, which is all the cloud's decoder asks for - the same
 * SPS + PPS + IDR access unit a real Terp Cam opens its stream with.
 */

class BitWriter {
  bytes = [];
  #current = 0;
  #filled = 0;

  bits(value, count) {
    for (let bit = count - 1; bit >= 0; bit--) {
      this.#current = (this.#current << 1) | ((value >>> bit) & 1);
      if (++this.#filled === 8) {
        this.bytes.push(this.#current);
        this.#current = 0;
        this.#filled = 0;
      }
    }
  }

  // Exp-Golomb, the variable-length code nearly every header field uses.
  ue(value) {
    const length = 32 - Math.clz32(value + 1);
    this.bits(0, length - 1);
    this.bits(value + 1, length);
  }

  align() {
    while (this.#filled !== 0) this.bits(0, 1);
  }

  // The stop bit, then zeros to the byte boundary.
  end() {
    this.bits(1, 1);
    this.align();
    return this.bytes;
  }
}

// Start code, header byte, and the payload with emulation prevention: a 0x03 is
// slipped in after any two zero bytes that would otherwise read as a start code.
const nalUnit = (header, payload) => {
  const out = [0, 0, 0, 1, header];
  let zeros = 0;
  for (const byte of payload) {
    if (zeros >= 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Buffer.from(out);
};

/** One H.264 access unit (SPS, PPS, IDR slice) of a width x height picture, each pixel [r, g, b] from pixel(). */
const encodeKeyframe = (width, height, pixel) => {
  const mbsX = Math.ceil(width / 16);
  const mbsY = Math.ceil(height / 16);
  const stride = mbsX * 16;
  const lines = mbsY * 16;

  // BT.601 studio range, which is what a decoder assumes without VUI. The
  // macroblock padding past the picture repeats its edge and is cropped away.
  const luma = new Uint8Array(stride * lines);
  const cb = new Float32Array(stride * lines);
  const cr = new Float32Array(stride * lines);
  for (let y = 0; y < lines; y++) {
    for (let x = 0; x < stride; x++) {
      const [r, g, b] = pixel(Math.min(x, width - 1), Math.min(y, height - 1));
      const at = y * stride + x;
      luma[at] = clamp(Math.round(16 + 0.257 * r + 0.504 * g + 0.098 * b), 1, 255);
      cb[at] = 128 - 0.148 * r - 0.291 * g + 0.439 * b;
      cr[at] = 128 + 0.439 * r - 0.368 * g - 0.071 * b;
    }
  }
  // 4:2:0: one chroma sample per 2x2 pixels.
  const chroma = (plane, x, y) => {
    const at = 2 * y * stride + 2 * x;
    return clamp(Math.round((plane[at] + plane[at + 1] + plane[at + stride] + plane[at + stride + 1]) / 4), 1, 255);
  };

  const sps = new BitWriter();
  sps.bits(66, 8); // Baseline
  sps.bits(0xc0, 8); // constraint_set0/1: constrained Baseline
  sps.bits(30, 8); // level 3.0
  sps.ue(0); // seq_parameter_set_id
  sps.ue(0); // log2_max_frame_num_minus4
  sps.ue(2); // pic_order_cnt_type: none to signal for a lone picture
  sps.ue(1); // max_num_ref_frames
  sps.bits(0, 1); // gaps_in_frame_num_value_allowed_flag
  sps.ue(mbsX - 1);
  sps.ue(mbsY - 1);
  sps.bits(1, 1); // frame_mbs_only_flag
  sps.bits(1, 1); // direct_8x8_inference_flag
  const crop = stride !== width || lines !== height;
  sps.bits(crop ? 1 : 0, 1);
  if (crop) [0, (stride - width) / 2, 0, (lines - height) / 2].forEach(offset => sps.ue(offset)); // in 2-pixel units
  sps.bits(0, 1); // vui_parameters_present_flag

  const pps = new BitWriter();
  pps.ue(0); // pic_parameter_set_id
  pps.ue(0); // seq_parameter_set_id
  pps.bits(0, 1); // entropy_coding_mode_flag: CAVLC
  pps.bits(0, 1); // bottom_field_pic_order_in_frame_present_flag
  pps.ue(0); // num_slice_groups_minus1
  pps.ue(0); // num_ref_idx_l0_default_active_minus1
  pps.ue(0); // num_ref_idx_l1_default_active_minus1
  pps.bits(0, 3); // weighted_pred_flag, weighted_bipred_idc
  pps.ue(0); // pic_init_qp_minus26 (se 0)
  pps.ue(0); // pic_init_qs_minus26 (se 0)
  pps.ue(0); // chroma_qp_index_offset (se 0)
  pps.bits(0, 3); // deblocking_filter_control_present, constrained_intra_pred, redundant_pic_cnt_present

  const slice = new BitWriter();
  slice.ue(0); // first_mb_in_slice
  slice.ue(7); // slice_type: I, and so is every other slice of the picture
  slice.ue(0); // pic_parameter_set_id
  slice.bits(0, 4); // frame_num
  slice.ue(0); // idr_pic_id
  slice.bits(0, 2); // no_output_of_prior_pics_flag, long_term_reference_flag
  slice.ue(0); // slice_qp_delta (se 0)
  for (let my = 0; my < mbsY; my++) {
    for (let mx = 0; mx < mbsX; mx++) {
      slice.ue(25); // mb_type I_PCM
      slice.align(); // pcm_alignment_zero_bit
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) slice.bytes.push(luma[(my * 16 + y) * stride + mx * 16 + x]);
      }
      for (const plane of [cb, cr]) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) slice.bytes.push(chroma(plane, mx * 8 + x, my * 8 + y));
        }
      }
    }
  }

  return Buffer.concat([nalUnit(0x67, sps.end()), nalUnit(0x68, pps.end()), nalUnit(0x65, slice.end())]);
};

// The real camera's main stream is 2304x1296; this is the same 16:9 at a size
// whose I_PCM keyframe (about 350 KB) is still a realistic burst for the relay.
const CAMERA_WIDTH = 640;
const CAMERA_HEIGHT = 360;

/**
 * A grow tent seen from the camera: back wall, floor, and a plant whose canopy
 * fills out as the grow progresses. Lit by the device's own light output, so a
 * timelapse of the stills tracks the day/night cycle the charts show.
 */
const growScene = (light, growth, phase) => {
  // Value noise over small cells of pixels, so the foliage has an irregular
  // texture instead of a visible pattern.
  const noise = (bx, by, salt) => {
    const hash = Math.sin(bx * 12.9898 + by * 78.233 + salt * 37.719) * 43758.5453;
    return hash - Math.floor(hash);
  };

  const horizon = 0.66;
  const centre = 0.5;
  const halfWidth = 0.13 + growth * 0.21;
  const canopyHeight = 0.12 + growth * 0.36;

  return (px, py) => {
    const x = px / CAMERA_WIDTH;
    const y = py / CAMERA_HEIGHT;
    const bx = Math.floor(px / 4);
    const by = Math.floor(py / 4);

    // Grow lights are heavy on red and blue. Lights-out keeps the exposure a
    // camera with a night mode would still show rather than going black.
    const lit = 0.45 + (light / 100) * 0.55;
    const tint = ([r, g, b]) => [r * lit * 1.06, g * lit, b * lit * 1.12].map(value => clamp(value, 0, 255));

    if (y > horizon) {
      const depth = (y - horizon) / (1 - horizon);
      // The pot the plant stands in.
      if (Math.abs(x - centre) < 0.1 - depth * 0.03 && y < horizon + 0.16) return tint([88, 74, 62 + depth * 10]);
      return tint([64 + depth * 26, 58 + depth * 22, 54 + depth * 20]);
    }

    // A dome that widens and rises as the grow progresses, with a ragged edge
    // and a slow sway so consecutive stills are never identical.
    const offset = (x - centre + Math.sin(phase + y * 4) * 0.015) / halfWidth;
    if (Math.abs(offset) < 1) {
      const dome = Math.sqrt(1 - offset * offset) * canopyHeight;
      const ragged = dome * (0.88 + noise(Math.floor(px / 8), 0, 3) * 0.24);
      if (y > horizon - ragged) {
        const depth = (y - (horizon - ragged)) / Math.max(ragged, 0.001);
        const leaf = noise(bx, by, phase) * 40 - 20;
        const shade = 0.72 + (1 - depth) * 0.28 - Math.abs(offset) * 0.18;
        return tint([(52 + leaf * 0.6) * shade, (124 + leaf) * shade, (46 + leaf * 0.4) * shade]);
      }
    }

    // The tent wall behind the plant.
    return tint([42 + y * 26, 44 + y * 26, 50 + y * 28]);
  };
};

// ------------------------------------------------------------ Terp Cam (P2P)

/**
 * The camera's side of its P2P protocol, as far as the cloud's client uses it
 * (server/src/modules/camera/terpcam-direct.service.ts). The real controller
 * only shovels datagrams between the cloud and the camera on its LAN, so the
 * simulator plays both: the relay in SimulatedDevice#relay, and the camera
 * here, answering the datagrams in-process instead of over UDP.
 */

// The transport's table cipher (vendor constants, as in the server and firmware).
// prettier-ignore
const P2P_SBOX = Buffer.from([
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
const P2P_DK = [44, 212, 96, 6];

// Symmetric: `prev` is always the ciphertext byte, so the two differ only in
// which side of the XOR that is.
const p2pCipher = (buf, encrypting) => {
  const out = Buffer.allocUnsafe(buf.length);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    out[i] = P2P_SBOX[(P2P_DK[prev & 3] + prev) & 0xff] ^ buf[i];
    prev = encrypting ? out[i] : buf[i];
  }
  return out;
};

const p2pPacket = (type, payload = Buffer.alloc(0)) => {
  const head = Buffer.from([0xf1, type, 0, 0]);
  head.writeUInt16BE(payload.length, 2);
  return p2pCipher(Buffer.concat([head, payload]), true);
};

// A DRW data packet: d1, channel, a per-channel index, then the data.
const p2pData = (channel, index, data) => {
  const head = Buffer.from([0xd1, channel, 0, 0]);
  head.writeUInt16BE(index & 0xffff, 2);
  return p2pPacket(0xd0, Buffer.concat([head, data]));
};

// A CGI reply carries the same 8-byte command header as the request that asked.
const cgiReply = text => {
  const body = Buffer.from(text, 'latin1');
  const head = Buffer.from([0x01, 0x0a, 0, 0, 0, 0, 0, 0]);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};

const CMD_CHANNEL = 0;
const VIDEO_CHANNEL = 1;
// The camera's datagrams carry at most 1024 bytes of stream (1032 in all).
const VIDEO_FRAGMENT_BYTES = 1024;
// One keyframe per GOP, about as often as the real camera sends one.
const GOP_MS = 2000;

/**
 * The camera's P2P id, derived from the printed id pairing stored: VSTH, a
 * number and five letters, the way the real ones read. Packed into the 20 bytes
 * the protocol carries it as (the firmware's formatCamUid reads it back).
 */
const cameraUid = label => {
  const hash = createHash('sha1').update(label).digest();
  const number = 100000 + (hash.readUInt32BE(0) % 900000);
  const letters = [...hash.subarray(4, 9)].map(byte => String.fromCharCode(65 + (byte % 26))).join('');
  const did = Buffer.alloc(20);
  did.write('VSTH', 0, 'latin1');
  did.writeBigUInt64BE(BigInt(number), 4);
  did.write(letters, 12, 'latin1');
  return { uid: `VSTH${number}${letters}`, did };
};

/**
 * One P2P session on the simulated camera. `receive` takes a datagram from the
 * client, `send` puts one on the way back; both are table-ciphered, exactly as
 * they cross the controller.
 */
class SimulatedTerpCam {
  #outIndex = [0, 0];
  #seen = new Set();
  #stream = null;

  constructor({ label, did, send, keyframe }) {
    Object.assign(this, { label, did, send, keyframe });
  }

  receive(datagram) {
    const m = p2pCipher(datagram, false);
    if (m.length < 4 || m[0] !== 0xf1) return;
    switch (m[1]) {
      case 0x00: // hello: answered with the address the camera sees, which nobody reads
        this.send(p2pPacket(0x01, Buffer.alloc(16)));
        break;
      case 0x41: // punch: the camera is ready, and the client echoes that back
        if (m.subarray(4, 24).equals(this.did)) this.send(p2pPacket(0x42, this.did));
        break;
      case 0xe0: // keepalive
        this.send(p2pPacket(0xe1));
        break;
      case 0xd0:
        if (m.length > 16 && m[5] === CMD_CHANNEL) this.#onCgi(m.readUInt16BE(6), m.subarray(16).toString('latin1'));
        break;
      case 0xf0: // the client closed the session
        this.stop();
        break;
      // 0x05, 0x20 (the DevLgn) and the client's acks (0xd1) need no answer.
    }
  }

  stop() {
    clearInterval(this.#stream);
    this.#stream = null;
  }

  // Acked like every DRW, but answered once: the client repeats get_status
  // under the same index until something comes back.
  #onCgi(index, request) {
    const ack = Buffer.from([0xd1, CMD_CHANNEL, 0, 1, 0, 0]);
    ack.writeUInt16BE(index, 4);
    this.send(p2pPacket(0xd1, ack));
    if (this.#seen.has(index)) return;
    this.#seen.add(index);

    const cgi = request.replace(/^GET \//, '');
    let reply = 'result=0;\r\n';
    if (cgi.startsWith('get_status.cgi')) {
      // What the client checks is `realdeviceid`; support_vuid is there because
      // a real reply has it, and it once fooled the client's parsing.
      reply = `var alias="Terp Cam";\r\nvar realdeviceid="${this.label}";\r\nvar support_vuid=1;\r\nvar vuidResult=0;\r\n`;
    } else if (/^livestream\.cgi\?streamid=16\b/.test(cgi)) {
      this.stop();
    } else if (/^livestream\.cgi\?streamid=10\b/.test(cgi)) {
      this.#startStream();
    }
    this.send(p2pData(CMD_CHANNEL, this.#outIndex[CMD_CHANNEL]++, cgiReply(reply)));
  }

  // A restarted stream begins mid-GOP, so the first frame is not the keyframe.
  #startStream() {
    if (this.#stream) return;
    this.#sendFrame(1, Buffer.from([0, 0, 0, 1, 0x09, 0xf0])); // an access unit delimiter stands in for a P frame
    this.#sendFrame(0, this.keyframe());
    this.#stream = setInterval(() => this.#sendFrame(0, this.keyframe()), GOP_MS);
  }

  // The vendor frame: a 32-byte header (the client reads the magic and the
  // payload length at 16), then the H.264 access unit, cut into datagrams.
  #sendFrame(type, payload) {
    const header = Buffer.alloc(32);
    Buffer.from([0x55, 0xaa, 0x15, 0xa8]).copy(header, 0);
    header[4] = type;
    header.writeUInt32LE(payload.length, 16);
    header.writeUInt32LE(Math.floor(Date.now() / 1000), 20);
    const frame = Buffer.concat([header, payload]);
    for (let offset = 0; offset < frame.length; offset += VIDEO_FRAGMENT_BYTES) {
      this.send(p2pData(VIDEO_CHANNEL, this.#outIndex[VIDEO_CHANNEL]++, frame.subarray(offset, offset + VIDEO_FRAGMENT_BYTES)));
    }
  }
}

// ------------------------------------------------------------------ Device I/O

class SimulatedDevice {
  constructor({ deviceId, type, username, password }) {
    Object.assign(this, { deviceId, type, username, password });
    this.topic = suffix => `/devices/${this.deviceId}/${suffix}`;
    this.config = structuredClone(DEFAULT_CONFIG);
    this.state = { temperature: 22, humidity: 58, co2: 500 };
    this.random = makeRandom(deviceId);
    this.testOutputs = null;
    this.maintenanceUntil = 0;

    // What real hardware keeps in NVS across a reboot. Restarting the script is
    // a power cycle, not a factory reset: without this the device would report
    // its pre-update firmware again and forget its paired sockets every time.
    this.memory = { firmwareId: 'simulated-firmware', sockets: [], webcamDid: null, plantedAt: Date.now() };
    this.memoryFile = path.join(STATE_DIR, `${encodeURIComponent(deviceId)}.json`);
    try {
      Object.assign(this.memory, JSON.parse(fs.readFileSync(this.memoryFile, 'utf8')));
    } catch {
      // First boot of this device.
    }
    this.memory.sockets = this.#loadSockets();
    this.configWaiters = [];
  }

  remember() {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(this.memoryFile, JSON.stringify(this.memory));
  }

  // Sockets used to be one address per role; they are a table now, any number
  // of which may share a role. A state file written by the older simulator
  // still holds the map, so adopt it rather than making the device forget what
  // it was paired with - the firmware migrates its own storage the same way.
  #loadSockets() {
    const stored = this.memory.sockets;
    if (Array.isArray(stored)) return stored;
    return Object.entries(stored ?? {}).map(([role, ip]) => ({ role, id: simulatedSocketId(role, ip), ip }));
  }

  // The broker refuses the odd connection attempt when its pooled HTTP
  // connection to the server's auth endpoint has just gone idle, so a device
  // that gives up on the first refusal is a device that randomly stays offline.
  async connect(attempts = 5) {
    for (let attempt = 1; ; attempt++) {
      this.mqtt = new MqttClient({
        clientId: `sim-${this.deviceId}-${process.pid}-${attempt}`,
        username: this.username,
        password: this.password,
      });
      try {
        return await this.mqtt.connect();
      } catch (error) {
        if (attempt >= attempts) throw error;
        await sleep(500 * attempt);
      }
    }
  }

  log(message, severity = 0) {
    this.mqtt.publish(this.topic('log'), JSON.stringify({ severity, message }));
  }

  hardwareInfo(key, value) {
    // Pairing a camera happens on the device, so remember it the way the
    // firmware does - the cloud follows what the device reports on boot.
    if (key === 'webcam_did') {
      this.memory.webcamDid = value === 'none' || value === '' ? null : String(value);
      this.remember();
      // The controller reads the camera's P2P id off its first session with it
      // and reports that too; the cloud asks for a relay only once it has one.
      this.log(`hardware-info:${key}=${value}`);
      this.log(`hardware-info:webcam_uid=${this.memory.webcamDid ? cameraUid(this.memory.webcamDid).uid : 'none'}`);
      return;
    }
    this.log(`hardware-info:${key}=${value}`);
  }

  publishStatus(sample) {
    this.mqtt.publish(this.topic('status'), JSON.stringify(sample));
  }

  publishBulk(sample, timestampSeconds) {
    this.mqtt.publish(this.topic('bulk'), JSON.stringify({ ...sample, timestamp: timestampSeconds }));
  }

  // What the firmware tells the cloud on every (re)connect: which firmware it
  // runs. The server answers it with the stored configuration.
  fetch() {
    this.mqtt.publish(this.topic('fetch'), JSON.stringify({ firmware_id: this.memory.firmwareId }));
  }

  // What it additionally reports once per boot. The hardware-info lines are
  // what the webapp reads to decide which capabilities this device has.
  boot(reason = 'POWERON') {
    this.log(`message-device-booted:${reason}`);
    this.fetch();
    this.hardwareInfo('firmware_version', this.memory.firmwareId);
    this.hardwareInfo('claimcode_auth', 'on');
    if (this.type === 'controller') {
      this.hardwareInfo('co2', 'on');
      this.hardwareInfo('leaf_temp', 'on');
      this.hardwareInfo('ppfd', 'on');
    }
    if (this.memory.webcamDid) this.hardwareInfo('webcam_did', this.memory.webcamDid);
    this.publishSockets();
  }

  // Pair a camera the way the module's menu does. The cloud turns the reported
  // id into a terpcam:// stream and starts asking for stills.
  attachCamera() {
    const did = createHash('sha1').update(this.deviceId).digest('hex').slice(0, 6).toUpperCase();
    this.hardwareInfo('webcam_did', this.memory.webcamDid ?? `SIMCAM${did}`);
  }

  // The camera as paired right now. Read from the state file rather than from
  // memory, so `hwinfo webcam_did=...` from another shell reaches a running device.
  #pairedCamera() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.memoryFile, 'utf8'));
      if ('webcamDid' in stored) this.memory.webcamDid = stored.webcamDid;
    } catch {
      // Nothing stored yet, so memory is current.
    }
    return this.memory.webcamDid;
  }

  // The still the camera would see right now, as the keyframe its stream opens with.
  #keyframe() {
    const secondsOfDay = new Date().getHours() * 3600 + new Date().getMinutes() * 60;
    const light = lightPercent(this.config, secondsOfDay);
    const age = (Date.now() - this.memory.plantedAt) / 86400000;
    return encodeKeyframe(CAMERA_WIDTH, CAMERA_HEIGHT, growScene(light, clamp(0.45 + age / 40, 0.45, 1), Date.now() / 60000));
  }

  /**
   * Answer a cam_relay the way firmware/src/terpcam.cpp relay() does: open `url`
   * as an HTTP upgrade, send the header (token in the clear, a NUL, the camera's 20-byte P2P
   * id), then carry length-framed datagrams both ways under AES-128-CTR - the
   * key's first half for what goes up, the second for what comes down. An empty
   * frame from the cloud means it has its still, and the device hangs up.
   *
   * The real controller bridges to the camera on its LAN; here the camera is
   * SimulatedTerpCam, so the cloud's P2P client runs against the whole path.
   */
  #relay({ url, token, key }) {
    const label = this.#pairedCamera();
    const keyBytes = Buffer.from(String(key ?? ''), 'hex');
    let target;
    try {
      target = new URL(String(url));
    } catch {
      return;
    }
    const secure = target.protocol === 'https:';
    // One relay at a time, and only to a camera the device knows - as the firmware.
    if (!this.servesCamera || this.relaying || !label || !token || keyBytes.length !== 32) return;
    if (!secure && target.protocol !== 'http:') return;
    this.relaying = true;

    const up = createCipheriv('aes-128-ctr', keyBytes.subarray(0, 16), Buffer.alloc(16));
    const down = createDecipheriv('aes-128-ctr', keyBytes.subarray(16), Buffer.alloc(16));
    const { did } = cameraUid(label);
    const host = target.hostname;
    const port = Number(target.port || (secure ? 443 : 80));
    // The relay enciphers everything itself, so TLS only has to get through - as the firmware.
    const conn = secure ? tls.connect({ host, port, rejectUnauthorized: false }) : net.createConnection({ host, port });
    conn.setNoDelay(true);

    const frame = datagram => {
      if (!conn.writable) return;
      const out = Buffer.alloc(2 + datagram.length);
      out.writeUInt16BE(datagram.length, 0);
      datagram.copy(out, 2);
      conn.write(up.update(out));
    };
    let picture = null;
    const camera = new SimulatedTerpCam({ label, did, send: frame, keyframe: () => (picture ??= this.#keyframe()) });

    // The firmware's cap, for a cloud that has lost track of the relay.
    const cap = setTimeout(() => conn.destroy(), 2 * 60000);
    const finish = () => {
      camera.stop();
      clearTimeout(cap);
      this.relaying = false;
    };
    conn.on('error', error => console.error(`cam_relay: ${error.message}`));
    conn.on('close', finish);

    conn.once(secure ? 'secureConnect' : 'connect', () =>
      conn.write(`GET ${target.pathname} HTTP/1.1\r\nHost: ${target.host}\r\nUpgrade: terpcam-relay\r\nConnection: Upgrade\r\n\r\n`),
    );
    const switched = () => {
      const header = Buffer.concat([Buffer.from(String(token), 'latin1'), Buffer.from([0]), up.update(did)]);
      const length = Buffer.alloc(2);
      length.writeUInt16BE(header.length);
      conn.write(Buffer.concat([length, header]));
    };

    // The response head is not the relay's; only what follows it is.
    let response = Buffer.alloc(0);
    let held = Buffer.alloc(0);
    conn.on('data', data => {
      let chunk = data;
      if (response) {
        response = Buffer.concat([response, chunk]);
        const end = response.indexOf('\r\n\r\n');
        if (end < 0) return;
        if (!/^HTTP\/1\.\d 101/.test(response.toString('latin1'))) {
          console.error(`cam_relay: ${url} answered ${response.toString('latin1').split('\r\n')[0]}`);
          conn.destroy();
          return;
        }
        chunk = response.subarray(end + 4);
        response = null;
        switched();
      }
      held = Buffer.concat([held, down.update(chunk)]);
      while (held.length >= 2) {
        const length = held.readUInt16BE(0);
        if (length === 0) {
          console.error(`cam_relay -> ${picture ? `${picture.length}B keyframe` : 'no keyframe'} to ${url}`);
          camera.stop();
          conn.end();
          return;
        }
        if (held.length < 2 + length) return;
        camera.receive(held.subarray(2, 2 + length));
        held = held.subarray(2 + length);
      }
    });
  }

  /**
   * What the firmware reports about its sockets. `sockets` and `socket_ips`
   * are the per-role summary older webapps read - one entry per role, however
   * many sockets share it - and the table itself travels as `sockets_n` plus
   * `socket_list<k>` chunks, because a log message has a fixed size budget.
   */
  publishSockets() {
    // Firmware that drives no sockets says nothing about them.
    if (!socketRolesFor(this.type).length) return;
    const sockets = this.memory.sockets;
    const roles = [...new Set(sockets.map(socket => socket.role))];
    this.hardwareInfo('sockets', roles.length ? roles.join(',') : 'none');
    this.hardwareInfo(
      'socket_ips',
      roles.map(role => `${role}@${sockets.find(socket => socket.role === role).ip}`).join(',') || 'none',
    );

    this.hardwareInfo('sockets_n', String(sockets.length));
    for (let chunk = 0; chunk * SOCKETS_PER_REPORT_CHUNK < sockets.length; chunk++) {
      const entries = sockets.slice(chunk * SOCKETS_PER_REPORT_CHUNK, (chunk + 1) * SOCKETS_PER_REPORT_CHUNK);
      this.hardwareInfo(socketListKey(chunk), entries.map(socket => `${socket.role}|${socket.id}|${socket.ip}`).join(','));
    }
  }

  // Which sockets a command is aimed at: one named by its slot, or every
  // socket of the role when the command names none.
  #addressedSockets({ role, slot }) {
    const index = Number(slot);
    if (Number.isInteger(index) && index >= 0) return this.memory.sockets[index] ? [index] : [];
    return this.memory.sockets.flatMap((socket, at) => (socket.role === role ? [at] : []));
  }

  // Whether a command named a socket by slot, as opposed to addressing the role.
  #namesSlot({ slot }) {
    return Number.isInteger(Number(slot)) && Number(slot) >= 0;
  }

  #setSocket(command) {
    const failed = () => this.log(`message-aux-command-failed:socket_set:${command.role}`, 1);
    const existing = this.#addressedSockets(command);

    // A slot names one socket; a slot naming none is a stale table, not an
    // invitation to add one. `append` adds a socket to the role; without it the
    // command configures the role's one socket, and cannot tell which is meant
    // once there are several.
    if (this.#namesSlot(command)) {
      if (!existing.length) return failed();
    } else if (!command.append && existing.length > 1) {
      return failed();
    }

    const target = command.append && !this.#namesSlot(command) ? -1 : (existing[0] ?? -1);
    if (target < 0 && this.memory.sockets.length >= MAX_SOCKETS) return failed();

    const socket = { role: command.role, id: simulatedSocketId(command.role, command.ip), ip: command.ip };
    if (target < 0) this.memory.sockets.push(socket);
    else this.memory.sockets[target] = socket;

    this.remember();
    this.log(`message-smart-socket-connected:${socket.role}`);
    this.publishSockets();
  }

  #removeSockets(command) {
    // Back to front, so the indexes still to be removed stay valid.
    for (const index of this.#addressedSockets(command).reverse()) {
      this.log(`message-smart-socket-disconnected:${this.memory.sockets[index].role}`);
      this.memory.sockets.splice(index, 1);
    }
    this.remember();
    this.publishSockets();
  }

  async listen() {
    this.mqtt.onMessage((topic, payload) => this.#onServerMessage(topic.split('/').pop(), payload));
    for (const suffix of ['configuration', 'command', 'firmware']) await this.mqtt.subscribe(this.topic(suffix));
  }

  #onServerMessage(kind, payload) {
    if (kind === 'configuration') return this.#onConfiguration(payload);
    if (kind === 'firmware') return this.#onFirmware(payload.trim());
    if (kind === 'command') return this.#onCommand(payload);
  }

  // Settings the user saved in the webapp. Like the firmware, the device
  // adopts them silently - it publishes on this topic only when its own
  // settings changed, which is what uploadConfig() below is for.
  #onConfiguration(payload) {
    try {
      this.config = JSON.parse(payload);
    } catch {
      return;
    }
    console.error('config <- server:', payload.slice(0, 200));
    for (const waiter of this.configWaiters.splice(0)) waiter();
  }

  /**
   * Resolves once the server has answered a fetch with the stored settings, or
   * after `timeoutMs` if it never does - which is the normal answer for a device
   * whose settings nobody has saved yet. Commands that change a setting have to
   * wait for this, or they would upload their defaults over the real thing.
   */
  configured(timeoutMs = 3000) {
    return new Promise(resolve => {
      this.configWaiters.push(resolve);
      setTimeout(resolve, timeoutMs);
    });
  }

  // Stands in for a grower changing settings on the device itself: the device
  // is the one that publishes, and the cloud follows.
  uploadConfig() {
    this.mqtt.publish(this.topic('configuration'), JSON.stringify(this.config));
  }

  #onFirmware(firmwareId) {
    if (!firmwareId || firmwareId === this.memory.firmwareId) return;
    console.error(`firmware <- server: updating to ${firmwareId}`);
    this.log(`message-device-firmware-update:${firmwareId}`);
    setTimeout(() => {
      this.memory.firmwareId = firmwareId;
      this.remember();
      this.boot('SW');
    }, 5000);
  }

  #onCommand(payload) {
    let command;
    try {
      command = JSON.parse(payload);
    } catch {
      return;
    }
    console.error('command <- server:', payload.slice(0, 200));

    switch (command.action) {
      case 'test':
        this.testOutputs = {
          heater: clamp(Number(command.outputs?.heater ?? 0), 0, 1),
          dehumidifier: Number(command.outputs?.dehumidifier ?? 0),
          co2: Number(command.outputs?.co2 ?? 0),
          light: Number(command.outputs?.lights ?? 0),
          'fan-internal': Number(command.outputs?.fanint ?? 0) / 100,
          'fan-external': Number(command.outputs?.fanext ?? 0) / 100,
          'fan-backwall': Number(command.outputs?.fanbw ?? 0) / 100,
          fan: Number(command.outputs?.fanint ?? 0) / 100,
          relais: Number(command.outputs?.heater ?? 0) > 0 ? 1 : 0,
        };
        break;
      case 'stoptest':
        this.testOutputs = null;
        break;
      case 'cam_relay':
        this.#relay(command);
        break;
      case 'maintenance':
        this.maintenanceUntil = Date.now() + Number(command.durationMinutes ?? 0) * 60000;
        this.log(`message-maintenance-mode-activated-remote:${Number(command.durationMinutes ?? 0)}`);
        break;
      case 'reboot':
        this.testOutputs = null;
        this.boot('REMOTE');
        break;
      case 'socket_set':
      case 'socket_remove':
      case 'socket_test':
        // The firmware knows only its own type's roles and refuses the rest.
        if (!socketRolesFor(this.type).includes(command.role)) {
          this.log(`message-aux-command-failed:${command.action}:${command.role}`, 1);
          break;
        }
        this.#socketCommand(command);
        break;
    }
  }

  #socketCommand(command) {
    switch (command.action) {
      case 'socket_set':
        this.#setSocket(command);
        break;
      case 'socket_remove':
        this.#removeSockets(command);
        break;
      case 'socket_test':
        // The real device pulses the socket on and back off; nothing here has
        // an output to pulse, so it reports the same outcome the webapp waits for.
        if (this.#addressedSockets(command).length) this.log(`message-smart-socket-tested:${command.role}`);
        else this.log(`message-smart-socket-cmd-failed:${command.role}:test`, 1);
        break;
    }
  }

  // Settle the climate model before the first published sample. Without this
  // every start would report the cold-start values and the charts would show a
  // step where the device was simply switched on again.
  warmUp(at, hours = 6) {
    for (let seconds = hours * 3600; seconds > 0; seconds -= 600) {
      step(this.state, this.config, new Date(at.getTime() - seconds * 1000), 600, this.random);
    }
  }

  sample(at = new Date(), stepSeconds = 60, overrides = {}) {
    const sample = shape(step(this.state, this.config, at, stepSeconds, this.random), this.type, overrides);
    if (this.testOutputs) {
      for (const key of Object.keys(sample.outputs)) {
        if (this.testOutputs[key] !== undefined) sample.outputs[key] = this.testOutputs[key];
      }
    }
    // Maintenance mode parks the climate outputs, exactly like the firmware's
    // pause does, so the webapp's maintenance banner matches the tiles.
    if (Date.now() < this.maintenanceUntil) {
      for (const key of ['heater', 'co2', 'dehumidifier']) {
        if (key in sample.outputs) sample.outputs[key] = 0;
      }
    }
    return sample;
  }
}

// --------------------------------------------------------------- CLI plumbing

const USAGE = `simulate-device.sh - drive a fake grow device against the local stack

Usage: ./simulate-device.sh [options] <command> [arguments]

Commands:
  setup                  invent a device, claim it for the local user, upload a
                         configuration and seed history, then print its id
  run                    stay online: publish live samples and answer the
                         configuration, test-mode, maintenance, reboot, smart
                         socket, camera and firmware messages the server sends
  send                   publish a single live sample and exit
  configure <key=value>  change a device setting, dotted paths, and upload it
                         (e.g. configure day.temperature=27 lights.limit=60)
  history                backfill samples so the charts have something to draw
  log <message>          publish a device log entry, e.g. message-co2-low:380
  hwinfo <key=value>     publish a hardware-info line, e.g. hwinfo co2=off
  watch                  print everything the server sends to this device
  info                   show what the server currently knows about the device
  list                   list the devices the local user owns
  register               register a device only
  claim                  print a claim code and claim it for the local user
  demo <on|off>          mark the device as a public demo device (needs docker)

Options:
  -d, --device-id <id>   which device to talk to. Required by every command
                         except setup, register and list; setup and register
                         invent sim-<type>-<random> when it is left out.
  -t, --type <type>      fridge|controller|plug|fan|light (default controller)
      --interval <sec>   seconds between live samples     (default 30)
      --days <n>         days of history to backfill      (default 3)
      --step <min>       minutes between history samples  (default 10)
      --set <key=value>  pin a value, repeatable; prefix outputs with out_
                         (e.g. --set temperature=31 --set out_light=0)
      --severity <0|1|2> severity of a log entry        (default 0, 2 = error)
      --camera           pair a simulated webcam, so run relays the cloud's
                         still requests (every 30s) to it
      --no-claim         skip claiming during setup
`;

const parseArgs = argv => {
  const options = { deviceId: '', type: 'controller', interval: 30, days: 3, step: 10, severity: 0, overrides: {}, claim: true, camera: false };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '-d':
      case '--device-id':
        options.deviceId = next();
        break;
      case '-t':
      case '--type':
        options.type = next();
        break;
      case '--interval':
        options.interval = Number(next());
        break;
      case '--days':
        options.days = Number(next());
        break;
      case '--step':
        options.step = Number(next());
        break;
      case '--severity':
        options.severity = Number(next());
        break;
      case '--set': {
        const [key, value] = parseAssignment(next());
        options.overrides[key] = value;
        break;
      }
      case '--no-claim':
        options.claim = false;
        break;
      case '--camera':
        options.camera = true;
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
        positional.push(arg);
    }
  }

  if (!PROFILES[options.type]) throw new Error(`Unknown device type "${options.type}". Known: ${Object.keys(PROFILES).join(', ')}`);
  options.command = positional.shift();
  options.rest = positional;
  return options;
};

// Splits "key=value" into a pair, keeping numbers numeric so they reach MQTT as
// numbers rather than strings.
const parseAssignment = assignment => {
  const index = assignment.indexOf('=');
  if (index < 1) throw new Error(`Expected key=value, got "${assignment}"`);
  const raw = assignment.slice(index + 1);
  const value = Number(raw);
  return [assignment.slice(0, index), Number.isFinite(value) && raw.trim() !== '' ? value : raw];
};

// Credentials are derived from the device id instead of stored, so every
// command in every shell reaches the same simulated device without state.
const credentials = deviceId => ({ username: `sim-${deviceId}`, password: `sim-${deviceId}-secret` });

// --------------------------------------------------------------- Commands

const register = async options => {
  const { username, password } = credentials(options.deviceId);
  // The server answers a refused registration with 401, which `api` throws on,
  // so the hint has to be given from here rather than from a falsy result.
  const refused = new Error(
    'Registration refused. Check ENABLE_SELF_REGISTRATION and SELF_REGISTRATION_PASSWORD in .env, and that the device id is not ' +
      'already registered under a different type.',
  );

  let result;
  try {
    result = await api('/device/register', {
      method: 'POST',
      body: {
        registration_password: REGISTRATION_PASSWORD,
        device_id: options.deviceId,
        username,
        password,
        device_type: options.type,
      },
    });
  } catch (error) {
    if (/-> 401 /.test(String(error.message))) throw refused;
    throw error;
  }

  if (result === false || result?.fw === undefined) {
    throw refused;
  }
  console.log(`registered ${options.deviceId} as ${options.type}`);
};

const claim = async options => {
  const { password } = credentials(options.deviceId);
  const code = await api('/device/claimcode', { method: 'POST', body: { device_id: options.deviceId, password } });
  if (!code?.claim_code) throw new Error('Server did not hand out a claim code - is the device registered?');
  console.log(`claim code: ${code.claim_code}`);
  const token = await login();
  await api('/device', { method: 'POST', body: { claim_code: code.claim_code }, token });
  console.log(`claimed by ${USER}`);
};

const withDevice = async (options, body) => {
  const device = new SimulatedDevice({ deviceId: options.deviceId, type: options.type, ...credentials(options.deviceId) });
  await device.connect();
  try {
    return await body(device);
  } finally {
    device.mqtt.end();
  }
};

// The server answers a fetch with the stored configuration, so a short-lived
// command still follows the same targets the running device would.
const withCurrentConfig = async (device, at = new Date()) => {
  await device.listen();
  const configured = device.configured();
  device.fetch();
  await configured;
  device.warmUp(at);
};

const send = options =>
  withDevice(options, async device => {
    await withCurrentConfig(device);
    const sample = device.sample(new Date(), 3600, options.overrides);
    device.publishStatus(sample);
    console.log(JSON.stringify(sample));
    await sleep(300);
  });

const configure = options =>
  withDevice(options, async device => {
    await withCurrentConfig(device);
    for (const assignment of options.rest) {
      const [dotted, value] = parseAssignment(assignment);
      const keys = dotted.split('.');
      const parent = keys.slice(0, -1).reduce((node, key) => (node[key] ??= {}), device.config);
      parent[keys.at(-1)] = value;
    }
    device.uploadConfig();
    console.log(JSON.stringify(device.config));
    await sleep(500);
  });

const history = options =>
  withDevice(options, async device => {
    const stepSeconds = options.step * 60;
    const total = Math.round((options.days * 86400) / stepSeconds);
    const now = Date.now();
    await withCurrentConfig(device, new Date(now - total * stepSeconds * 1000));

    // Walks up to the present so the newest sample is also the current reading.
    for (let i = total; i > 0; i--) {
      const at = new Date(now - i * stepSeconds * 1000);
      device.publishBulk(device.sample(at, stepSeconds, options.overrides), Math.floor(at.getTime() / 1000));
      // The server writes every sample to InfluxDB as it arrives; pausing keeps
      // the backfill from outrunning it and filling the broker's queue.
      if (i % 25 === 0) await sleep(250);
    }
    device.publishStatus(device.sample(new Date(), stepSeconds, options.overrides));
    console.log(`published ${total} samples covering ${options.days} day(s)`);
    await sleep(2000);
  });

const run = async options => {
  const device = new SimulatedDevice({ deviceId: options.deviceId, type: options.type, ...credentials(options.deviceId) });
  // Only the long-running device bridges its camera: a short-lived `send` would
  // otherwise take a relay and exit halfway through it.
  device.servesCamera = true;

  const goOnline = async (booting = false) => {
    await device.connect();
    await device.listen();
    const configured = device.configured();
    if (booting) device.boot();
    else device.fetch();
    if (options.camera) device.attachCamera();
    await configured;
  };

  await goOnline(true);
  device.warmUp(new Date());
  console.log(`${options.deviceId} (${options.type}) online, sampling every ${options.interval}s. Ctrl-C to stop.`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      device.mqtt.end();
      process.exit(0);
    });
  }

  for (;;) {
    if (!device.mqtt.connected) {
      console.log('mqtt connection lost, reconnecting');
      await goOnline();
    }
    const sample = device.sample(new Date(), options.interval, options.overrides);
    device.publishStatus(sample);
    console.log(new Date().toISOString(), JSON.stringify(sample.sensors), JSON.stringify(sample.outputs));
    await sleep(options.interval * 1000);
  }
};

const watch = async options => {
  const device = new SimulatedDevice({ deviceId: options.deviceId, type: options.type, ...credentials(options.deviceId) });
  await device.connect();
  device.mqtt.onMessage((topic, payload) => console.log(new Date().toISOString(), topic, payload));
  for (const suffix of ['configuration', 'command', 'firmware', 'tunnel_write']) await device.mqtt.subscribe(device.topic(suffix));
  console.log(`watching server messages for ${options.deviceId}. Ctrl-C to stop.`);
  await new Promise(() => {});
};

const logEntry = options =>
  withDevice(options, async device => {
    const message = options.rest.join(' ');
    if (!message) throw new Error('Nothing to log. Pass a message, e.g. log message-co2-low:400');
    device.log(message, options.severity);
    console.log(`logged: ${message}`);
    await sleep(300);
  });

const hwinfo = options =>
  withDevice(options, async device => {
    for (const assignment of options.rest) {
      const [key, value] = parseAssignment(assignment);
      device.hardwareInfo(key, value);
      console.log(`hardware-info: ${key}=${value}`);
    }
    await sleep(300);
  });

const info = async options => {
  const token = await login();
  const devices = await api('/device', { token });
  const device = devices.find(entry => entry.device_id === options.deviceId);
  if (!device) {
    console.log(`${options.deviceId} is not claimed by ${USER}. Known devices: ${devices.map(d => d.device_id).join(', ') || '(none)'}`);
    return;
  }

  const age = Date.now() - (device.lastseen ?? 0);
  console.log(`device_id     ${device.device_id}`);
  console.log(`type / name   ${device.device_type} / ${device.name ?? '(unnamed)'}`);
  const seen = device.lastseen ? `${new Date(device.lastseen).toISOString()} (${Math.round(age / 1000)}s ago)` : 'never';
  console.log(`lastseen      ${seen} - ${age < 600000 ? 'online' : 'offline'}`);
  console.log(`hardwareInfo  ${JSON.stringify(device.hardwareInfo ?? {})}`);
  console.log(`cloudSettings ${JSON.stringify(device.cloudSettings ?? {})}`);
  console.log(`configuration ${device.configuration || '(none)'}`);

  const measures = ['temperature', 'humidity', 'co2', 'vpd', 'out_light', 'out_heater'];
  const latest = await Promise.all(measures.map(measure => api(`/data/latest/${options.deviceId}/${measure}`, { token }).catch(() => null)));
  const format = entry => (entry?.value == null || Number.isNaN(entry.value) ? 'n/a' : round(entry.value));
  console.log(`latest        ${measures.map((measure, i) => `${measure}=${format(latest[i])}`).join(' ')}`);
};

const list = async () => {
  const token = await login();
  const devices = await api('/device', { token });
  if (!devices.length) {
    console.log(`${USER} owns no devices yet - "./simulate-device.sh setup" makes one.`);
    return;
  }
  const width = Math.max(...devices.map(device => device.device_id.length));
  for (const device of devices) {
    const age = Date.now() - (device.lastseen ?? 0);
    console.log(`${device.device_id.padEnd(width)}  ${device.device_type.padEnd(10)} ${age < 600000 ? 'online' : 'offline'}`);
  }
};

const setup = async options => {
  await register(options);
  if (options.claim) await claim(options);
  await withDevice(options, async device => {
    await withCurrentConfig(device);
    device.boot();
    // A device nobody has configured yet has no settings in the cloud at all,
    // which is the setup-wizard state rather than the one worth looking at.
    device.uploadConfig();
    await sleep(1500);
  });
  await history(options);
  console.log(`\n${options.deviceId} is ready. Keep it online with:\n  ./simulate-device.sh -d ${options.deviceId} -t ${options.type} run`);
};

const COMMANDS = { setup, run, send, configure, history, watch, register, claim, info, list, hwinfo, log: logEntry };

// The two commands that bring a device into being may invent its id; everything
// else acts on a device that already exists and has to be told which one.
const INVENTS_DEVICE_ID = ['setup', 'register'];

const resolveDeviceId = options => {
  if (options.deviceId) return options.deviceId;
  if (INVENTS_DEVICE_ID.includes(options.command)) {
    return `sim-${options.type}-${randomBytes(3).toString('hex')}`;
  }
  throw new Error(`${options.command} needs -d <device-id>. "setup" invents one and prints it, "list" shows the ones you have.`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const command = COMMANDS[options.command];
  if (!command) {
    console.log(USAGE);
    process.exit(options.command ? 1 : 0);
  }
  if (options.command !== 'list') {
    options.deviceId = resolveDeviceId(options);
  }
  await command(options);
};

main().catch(error => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
