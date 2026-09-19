import { jest } from '@jest/globals';
import { DeviceCommand } from '@fg2/shared-types/v1';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { CamerasController } from '@modules/v1/camera/cameras.controller';
import { DevicesController } from '@modules/v1/device/devices.controller';
import { decodeCapabilities, decodeSockets } from '@modules/device-protocol/sockets';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * What may be said to a socket, and what may not.
 *
 * The rule the whole round hangs on: **a device is sent only what it has
 * announced.** Old firmware drops a command it does not know without a word -
 * no error, no log line, no reply - and the version it reports is the build's
 * uuid, which cannot be compared against anything. So a command that would be
 * dropped is refused here instead, with the one reason there is: the controller
 * needs its next firmware.
 *
 * Two devices carry every case: one that has announced nothing, whose every new
 * control is refused, and one that has announced the lot.
 */

const OLD = 'sim-controller-old';
const NEW = 'sim-controller-new';

/** What the socket firmware announces at boot, exactly as `wifi.cpp` spells it. */
const ANNOUNCED = {
  caps: 'socket_override,socket_timer,light_override',
  socket_roles: 'dehumidifier,heater,light,secondary_light,co2,humidifier,exhaust,circulation,fan,pump,custom_timer,manual',
  socket_pulse: 'heater:300,pump:120',
  sockets_n: '3',
  socket_list0: 'heater|AA|10.0.0.1|on|,pump|BB|10.0.0.2|off|timer=30/900,light|CC|10.0.0.3|on|override=on@120',
};

/** A build from before the change: it reports its table and none of the three keys. */
const DEPLOYED = { sockets_n: '1', socket_list0: 'heater|AA|10.0.0.1' };

let db: V1TestDatabase;
let published: { topic: string; message: string }[];
let publisher: DevicePublisherService;

const sent = () => JSON.parse(published[0].message);

const set = (over: Partial<Extract<DeviceCommand, { kind: 'socket_set' }>> = {}): DeviceCommand => ({
  kind: 'socket_set',
  slot: null,
  role: 'heater',
  address: '10.0.0.9',
  credentials: null,
  timer: null,
  ...over,
});

const hold = (over: Partial<Extract<DeviceCommand, { kind: 'socket_override' }>> = {}): DeviceCommand => ({
  kind: 'socket_override',
  subject: { type: 'socket', id: '0' },
  state: 'on',
  forSeconds: 600,
  ...over,
});

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  published = [];

  const mqtt = {
    canPublish: true,
    publish: jest.fn((topic: string, message: string) => {
      published.push({ topic, message });
      return true;
    }),
  } as unknown as MqttClientService;

  publisher = new DevicePublisherService(db.devices, mqtt);
  await db.devices.create([
    { id: OLD, type: 'controller', ownerId: 'user-1', state: { hardware: DEPLOYED } },
    { id: NEW, type: 'controller', ownerId: 'user-1', state: { hardware: ANNOUNCED } },
  ] as never);
});

describe('a device that has announced nothing', () => {
  it('is offered exactly the roles every build in the field knows', async () => {
    const device = await db.devices.findOne({ id: OLD }).lean<StoredDevice>();

    expect(decodeCapabilities(device!.state.hardware)).toMatchObject({
      socketOverride: false,
      socketTimer: false,
      lightOverride: false,
      roles: ['', 'dehumidifier', 'heater', 'light', 'secondary_light', 'co2'],
    });
  });

  it.each([
    ['a role that arrived with the firmware change', set({ role: 'pump' })],
    ['a timer', set({ role: 'pump', timer: { onSeconds: 30, everySeconds: 900 } })],
    ['an override of a socket', hold()],
    ['an override of its own light output', hold({ subject: { type: 'output', id: 'light' } })],
  ])('refuses %s, and says the firmware is what is missing', async (_what, command) => {
    await expect(publisher.command(OLD, command)).rejects.toThrow(/needs the next controller firmware/);
    expect(published).toEqual([]);
  });

  it('still takes the commands every build in the field understands', async () => {
    await publisher.command(OLD, set({ role: 'heater' }));

    expect(sent()).toEqual({ action: 'socket_set', role: 'heater', ip: '10.0.0.9', append: true });
  });

  it('takes the unassigned role, which no build can announce and every build knows', async () => {
    // It is the empty string, and a comma-separated list cannot carry one, so
    // `socket_roles` never names it.
    await publisher.command(OLD, set({ role: '' }));

    expect(sent()).toMatchObject({ action: 'socket_set', role: '' });
  });
});

describe('a device that has announced everything', () => {
  it('takes every role the change added', async () => {
    await publisher.command(NEW, set({ role: 'humidifier' }));

    expect(sent()).toMatchObject({ action: 'socket_set', role: 'humidifier' });
  });

  it('takes a timer for the roles that run on one, and refuses it for the rest', async () => {
    await publisher.command(NEW, set({ role: 'pump', timer: { onSeconds: 30, everySeconds: 900 } }));
    expect(sent()).toMatchObject({ timer: { onS: 30, everyS: 900 } });

    published = [];
    await expect(publisher.command(NEW, set({ role: 'heater', timer: { onSeconds: 30, everySeconds: 900 } }))).rejects.toThrow(
      /follows the controller rather than a timer/,
    );
    expect(published).toEqual([]);
  });

  it('holds a socket of the table it reported, and refuses one it does not report', async () => {
    await publisher.command(NEW, hold({ subject: { type: 'socket', id: '1' } }));
    expect(sent()).toEqual({ action: 'socket_override', slot: 1, state: 'on', seconds: 600 });

    published = [];
    await expect(publisher.command(NEW, hold({ subject: { type: 'socket', id: '9' } }))).rejects.toThrow(/no socket in slot 9/);
    expect(published).toEqual([]);
  });

  it('hands a socket back with `auto`, which carries no duration', async () => {
    await publisher.command(NEW, hold({ state: 'auto', forSeconds: 0 }));

    expect(sent()).toEqual({ action: 'socket_override', slot: 0, state: 'auto', seconds: 0 });
  });

  it('refuses an override that never ends, because the expiry is the failsafe', async () => {
    await expect(publisher.command(NEW, hold({ forSeconds: 0 }))).rejects.toThrow(/says how long it holds/);
    expect(published).toEqual([]);
  });

  it('holds the light output and no other, because it is the only one that takes an override', async () => {
    await publisher.command(NEW, hold({ subject: { type: 'output', id: 'light' } }));
    expect(sent()).toEqual({ action: 'socket_override', output: 'light', state: 'on', seconds: 600 });

    published = [];
    await expect(publisher.command(NEW, hold({ subject: { type: 'output', id: 'heater' } }))).rejects.toThrow(/Only the light output/);
    expect(published).toEqual([]);
  });

  it('names a socket it is asked to remove or test by the role the table gives it', async () => {
    await publisher.socketAction(NEW, 'socket_test', 1);
    expect(sent()).toEqual({ action: 'socket_test', role: 'pump', slot: 1 });

    published = [];
    await expect(publisher.socketAction(NEW, 'socket_remove', 7)).rejects.toThrow(/no socket in slot 7/);
    await expect(publisher.socketAction(NEW, 'socket_remove', 'co2')).rejects.toThrow(/no socket with the role co2/);
    expect(published).toEqual([]);
  });
});

describe('who may do each of these', () => {
  const needOf = (controller: object, method: string): unknown =>
    Reflect.getMetadata('v1:access', (controller as { prototype: Record<string, object> }).prototype[method]);

  it.each([
    ['sockets', 'view'],
    ['setSocket', 'manage'],
    ['removeSocket', 'manage'],
    ['overrideSocket', 'manage'],
    ['clearSocketOverride', 'manage'],
    ['testSocket', 'manage'],
  ])('asks for %s to be a %s of the device', (route, need) => {
    // The need each route declares is the checklist a membership widens, so it
    // is asserted per route rather than inferred from the guard being there:
    // pairing a socket is managing, holding one is managing, looking is not.
    expect(needOf(DevicesController, route)).toEqual({ need, subject: 'device', param: 'id' });
  });

  it.each([
    ['read', 'view'],
    ['update', 'manage'],
    ['remove', 'own'],
    ['testCapture', 'manage'],
    ['frames', 'view'],
    ['timelapses', 'view'],
    ['requestTimelapse', 'manage'],
  ])('asks for %s to be a %s of the camera', (route, need) => {
    expect(needOf(CamerasController, route)).toEqual({ need, subject: 'camera', param: 'id' });
  });
});

describe('the table as the API answers it', () => {
  it('counts an override´s remaining seconds from when the table arrived, not from now', () => {
    const reportedAt = new Date('2026-09-19T10:00:00.000Z');

    const [socket] = decodeSockets({ sockets_n: '1', socket_list0: 'light|CC|10.0.0.3|on|override=on@120' }, { reportedAt });

    // The row says how long the override had left when it was sent, and never a
    // time of day: read against now, the same report would read as full forever.
    expect(socket.override).toEqual({ state: 'on', validUntil: '2026-09-19T10:02:00.000Z' });
  });

  it('answers what each row is doing, and `unknown` for one the module could not reach', () => {
    const sockets = decodeSockets({ sockets_n: '3', socket_list0: ANNOUNCED.socket_list0.replace('|on|,', '||,') });

    expect(sockets.map(socket => [socket.slot, socket.role, socket.state])).toEqual([
      [0, 'heater', 'unknown'],
      [1, 'pump', 'off'],
      [2, 'light', 'on'],
    ]);
    expect(sockets[1].timer).toEqual({ onSeconds: 30, everySeconds: 900 });
  });
});
