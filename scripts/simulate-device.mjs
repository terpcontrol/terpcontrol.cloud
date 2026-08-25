// Simulated grow device. Speaks the same MQTT topics and HTTP endpoints as the
// firmware in firmware/, so the server and the webapp cannot tell it apart from
// real hardware. Launched through ../simulate-device.sh, which supplies the
// configuration from .env.
//
// MQTT is spoken directly over a socket rather than through a client library:
// the repo root has no package.json, and a dev tool that needs `npm install`
// before it runs is a dev tool nobody runs.

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// The socket report is a contract between firmware, server and webapp; the
// simulator answers to the same one.
import { MAX_SOCKETS, SOCKETS_PER_REPORT_CHUNK, socketListKey } from '../shared-types/index.js';

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
 * A JPEG encoder small enough to keep this tool dependency-free.
 *
 * It only ever emits the DC coefficient of each block, so the picture has one
 * colour per 8x8 pixels and no discrete cosine transform is needed - the DC
 * coefficient of a block of one colour is just that colour, level-shifted. That
 * is a blocky image, but it is a valid baseline JPEG, which is all the cloud's
 * webcam pipeline and the webapp ask for.
 */

// Standard luminance DC table (ITU-T T.81 Annex K). The AC table is ours: the
// encoder emits nothing but end-of-block, and two codes are the fewest that
// leave the all-ones code unused, as the format requires.
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const AC_VALUES = [0x00, 0x01];
const END_OF_BLOCK = 0x00;

// Quantising the DC coefficient by 8 undoes the transform's scaling, so the
// stored coefficient is the level-shifted sample value itself.
const DC_QUANT = 8;

const huffmanCodes = (bits, values) => {
  const codes = new Map();
  let code = 0;
  let index = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) codes.set(values[index++], { code: code++, length });
    code <<= 1;
  }
  return codes;
};

class BitWriter {
  bytes = [];
  #current = 0;
  #filled = 0;

  write(code, length) {
    for (let bit = length - 1; bit >= 0; bit--) {
      this.#current = (this.#current << 1) | ((code >> bit) & 1);
      if (++this.#filled === 8) this.#flush(this.#current);
    }
  }

  // Pad with 1 bits: the format reserves the all-ones code so a decoder cannot
  // mistake the padding for another symbol.
  end() {
    while (this.#filled !== 0) this.write(1, 1);
    return Buffer.from(this.bytes);
  }

  #flush(byte) {
    this.bytes.push(byte & 0xff);
    // A 0xFF in the entropy-coded data would look like the start of a marker.
    if ((byte & 0xff) === 0xff) this.bytes.push(0x00);
    this.#current = 0;
    this.#filled = 0;
  }
}

const marker = (code, ...payload) => {
  const body = Buffer.from(payload.flat());
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xff00 | code, 0);
  header.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([header, body]);
};

const huffmanSegment = (id, bits, values) => marker(0xc4, [id], bits, values);

// How many bits a coefficient needs, and the value the format writes for it.
const coefficientBits = value => {
  let size = 0;
  for (let magnitude = Math.abs(value); magnitude > 0; magnitude >>= 1) size++;
  return { size, bits: value < 0 ? value + (1 << size) - 1 : value };
};

const toYCbCr = ([r, g, b]) => [
  0.299 * r + 0.587 * g + 0.114 * b,
  128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
  128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
];

/** Encode blocksX x blocksY blocks of 8x8 pixels, each a colour from blockColor. */
const encodeJpeg = (blocksX, blocksY, blockColor) => {
  const dc = huffmanCodes(DC_BITS, DC_VALUES);
  const ac = huffmanCodes(AC_BITS, AC_VALUES);
  const writer = new BitWriter();
  const previous = [0, 0, 0];

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const channels = toYCbCr(blockColor(bx, by));
      for (let channel = 0; channel < 3; channel++) {
        const level = clamp(Math.round(channels[channel]), 0, 255) - 128;
        const { size, bits } = coefficientBits(level - previous[channel]);
        previous[channel] = level;
        const symbol = dc.get(size);
        writer.write(symbol.code, symbol.length);
        if (size > 0) writer.write(bits, size);
        const eob = ac.get(END_OF_BLOCK);
        writer.write(eob.code, eob.length);
      }
    }
  }

  const component = id => [id, 0x11, 0];
  const uint16 = value => [(value >> 8) & 0xff, value & 0xff];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    marker(0xdb, [0x00], new Array(64).fill(DC_QUANT)),
    marker(0xc0, [8], uint16(blocksY * 8), uint16(blocksX * 8), [3], component(1), component(2), component(3)),
    huffmanSegment(0x00, DC_BITS, DC_VALUES),
    huffmanSegment(0x10, AC_BITS, AC_VALUES),
    marker(0xda, [3], [1, 0x00], [2, 0x00], [3, 0x00], [0, 63, 0]),
    writer.end(),
    Buffer.from([0xff, 0xd9]),
  ]);
};

const CAMERA_BLOCKS_X = 80;
const CAMERA_BLOCKS_Y = 60;

/**
 * A grow tent seen from the camera: back wall, floor, and a plant whose canopy
 * fills out as the grow progresses. Lit by the device's own light output, so a
 * timelapse of the stills tracks the day/night cycle the charts show.
 */
const growScene = (light, growth, phase) => {
  // Value noise from the block coordinates, so the foliage has an irregular
  // texture instead of a visible pattern.
  const noise = (bx, by, salt) => {
    const hash = Math.sin(bx * 12.9898 + by * 78.233 + salt * 37.719) * 43758.5453;
    return hash - Math.floor(hash);
  };

  const horizon = 0.66;
  const centre = 0.5;
  const halfWidth = 0.13 + growth * 0.21;
  const canopyHeight = 0.12 + growth * 0.36;

  return (bx, by) => {
    const x = bx / CAMERA_BLOCKS_X;
    const y = by / CAMERA_BLOCKS_Y;

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
      const ragged = dome * (0.88 + noise(bx, 0, 3) * 0.24);
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
    this.captureCount = 0;
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
  // id into an okam:// stream and starts asking for stills.
  attachCamera() {
    const did = createHash('sha1').update(this.deviceId).digest('hex').slice(0, 6).toUpperCase();
    this.hardwareInfo('webcam_did', this.memory.webcamDid ?? `SIMCAM${did}`);
  }

  /**
   * Answer a still request. The real controller reads the frame off its P2P
   * link and forwards it in fragments as it goes, because it has nowhere near
   * enough RAM to hold a whole image - so this fragments too, and the cloud's
   * reassembly is exercised rather than bypassed.
   */
  #capture() {
    const secondsOfDay = new Date().getHours() * 3600 + new Date().getMinutes() * 60;
    const light = lightPercent(this.config, secondsOfDay);
    const age = (Date.now() - this.memory.plantedAt) / 86400000;
    const jpeg = encodeJpeg(CAMERA_BLOCKS_X, CAMERA_BLOCKS_Y, growScene(light, clamp(0.45 + age / 40, 0.45, 1), Date.now() / 60000));

    const capture = ++this.captureCount;
    const FRAGMENT_BYTES = 4096;
    for (let offset = 0, seq = 0; offset < jpeg.length; offset += FRAGMENT_BYTES, seq++) {
      const chunk = jpeg.subarray(offset, offset + FRAGMENT_BYTES);
      const last = offset + FRAGMENT_BYTES >= jpeg.length;
      this.mqtt.publish(this.topic('image'), JSON.stringify({ capture, seq, payload: chunk.toString('base64'), ...(last ? { last: true } : {}) }));
    }
    console.error(`cam_capture -> ${jpeg.length}B still`);
  }

  /**
   * What the firmware reports about its sockets. `sockets` and `socket_ips`
   * are the per-role summary older webapps read - one entry per role, however
   * many sockets share it - and the table itself travels as `sockets_n` plus
   * `socket_list<k>` chunks, because a log message has a fixed size budget.
   */
  publishSockets() {
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
      case 'cam_capture':
        this.#capture();
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
      --camera           pair a simulated webcam, so run answers the still
                         requests the cloud makes every 30s
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
  const result = await api('/device/register', {
    method: 'POST',
    body: {
      registration_password: REGISTRATION_PASSWORD,
      device_id: options.deviceId,
      username,
      password,
      device_type: options.type,
    },
  });
  if (result === false || result?.fw === undefined) {
    throw new Error(
      'Registration refused. Check ENABLE_SELF_REGISTRATION and SELF_REGISTRATION_PASSWORD in .env, and that the device id is not ' +
        'already registered under a different type.',
    );
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
