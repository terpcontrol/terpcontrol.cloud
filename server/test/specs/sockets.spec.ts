import { createAccount, demoSession, Session } from '../support/api';
import { DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';

/**
 * The smart sockets of a controller, from the table it reports to the switch
 * somebody taps.
 *
 * Both halves meet here: the table arrives as `hardware-info:` lines on the
 * frozen log topic, and everything a person does with a socket is `/v1`. What
 * is asserted in between is the one rule of this round - a device is sent only
 * what it has announced, and a switch it has not announced is refused with a
 * reason rather than published into the dark.
 */

const ANNOUNCED = [
  'caps=socket_override,socket_timer,light_override',
  'socket_roles=dehumidifier,heater,light,secondary_light,co2,humidifier,exhaust,circulation,fan,pump,custom_timer,manual',
  'socket_pulse=heater:300,pump:120',
  'sockets_n=2',
  'socket_list0=heater|4C7525A1B2C3|10.0.0.6|on|,pump|4C7525A1B2C4|10.0.0.7|off|timer=30/900',
];

/** A build from before the change: it reports its table and none of the three keys. */
const DEPLOYED = ['sockets_n=1', 'socket_list0=heater|4C7525A1B2C5|10.0.0.8'];

let owner: Session;
let modern: { device: Awaited<ReturnType<typeof provisionDevice>>; simulator: DeviceSimulator };
let old: { device: Awaited<ReturnType<typeof provisionDevice>>; simulator: DeviceSimulator };

const report = async (simulator: DeviceSimulator, lines: string[]): Promise<void> => {
  for (const line of lines) {
    await simulator.publish('log', { severity: 0, message: `hardware-info:${line}` });
  }
  await settle(600);
};

const controller = async (lines: string[]) => {
  const device = await provisionDevice(owner, 'controller');
  const simulator = await startSimulator(device);
  await settle();
  await report(simulator, lines);

  return { device, simulator };
};

beforeAll(async () => {
  owner = await createAccount('sockets-owner');
  modern = await controller(ANNOUNCED);
  old = await controller(DEPLOYED);
});

afterAll(async () => {
  await modern?.simulator.close();
  await old?.simulator.close();
});

describe('the table a device reports', () => {
  it('is answered as rows with what the build announced beside them', async () => {
    const answer = await owner.client.get(`/v1/devices/${modern.device.deviceId}/sockets`).expect(200);

    expect(answer.body.items).toHaveLength(2);
    expect(answer.body.items[0]).toMatchObject({ slot: 0, role: 'heater', hardwareId: '4C7525A1B2C3', address: '10.0.0.6', state: 'on' });
    expect(answer.body.items[1]).toMatchObject({ slot: 1, role: 'pump', state: 'off', timer: { onSeconds: 30, everySeconds: 900 } });
    expect(answer.body.capabilities).toMatchObject({ socketOverride: true, socketTimer: true, lightOverride: true });
    expect(answer.body.capabilities.roles).toContain('custom_timer');
  });

  it('offers a build that announced none of the keys the five roles every build knows', async () => {
    const answer = await owner.client.get(`/v1/devices/${old.device.deviceId}/sockets`).expect(200);

    expect(answer.body.items).toHaveLength(1);
    // A three-column row names the socket but not whether it is on.
    expect(answer.body.items[0]).toMatchObject({ slot: 0, role: 'heater', state: 'unknown', override: null, timer: null });
    expect(answer.body.capabilities).toMatchObject({ socketOverride: false, socketTimer: false, lightOverride: false });
    // The unassigned role leads the list: no build announces it, every build takes it.
    expect(answer.body.capabilities.roles).toEqual(['', 'dehumidifier', 'heater', 'light', 'secondary_light', 'co2']);
  });
});

describe('what reaches a device that announced the change', () => {
  beforeEach(() => modern.simulator.clear());

  it('pairs a socket by its address and gives it a role', async () => {
    await owner.client
      .put(`/v1/devices/${modern.device.deviceId}/sockets/new`)
      .send({ role: 'humidifier', address: '10.0.0.9', credentials: null, timer: null })
      .expect(202);

    const sent = await modern.simulator.waitFor('command');
    expect(JSON.parse(sent.payload)).toEqual({ action: 'socket_set', role: 'humidifier', ip: '10.0.0.9', append: true });
  });

  it('gives a timed role its timer', async () => {
    await owner.client
      .put(`/v1/devices/${modern.device.deviceId}/sockets/1`)
      .send({ role: 'pump', address: '10.0.0.7', credentials: null, timer: { onSeconds: 30, everySeconds: 21600 } })
      .expect(202);

    const sent = await modern.simulator.waitFor('command');
    expect(JSON.parse(sent.payload)).toMatchObject({ action: 'socket_set', slot: 1, timer: { onS: 30, everyS: 21600 } });
  });

  it('holds a socket for a while, and hands it back', async () => {
    const held = await owner.client
      .put(`/v1/devices/${modern.device.deviceId}/sockets/0/override`)
      .send({ state: 'off', forSeconds: 900 })
      .expect(202);
    expect(held.body).toMatchObject({ publishedAt: expect.any(String), deviceOnline: expect.any(Boolean) });

    const sent = await modern.simulator.waitFor('command');
    expect(JSON.parse(sent.payload)).toEqual({ action: 'socket_override', slot: 0, state: 'off', seconds: 900 });

    modern.simulator.clear();
    await owner.client.delete(`/v1/devices/${modern.device.deviceId}/sockets/0/override`).expect(202);

    const cleared = await modern.simulator.waitFor('command');
    expect(JSON.parse(cleared.payload)).toMatchObject({ action: 'socket_override', slot: 0, state: 'auto' });
  });

  it('switches a socket on for a moment so somebody can find it in the tent', async () => {
    await owner.client.post(`/v1/devices/${modern.device.deviceId}/sockets/0/tests`).send({ forSeconds: 2 }).expect(202);

    const sent = await modern.simulator.waitFor('command');
    // The command carries no duration: the firmware runs its own two-second
    // pulse, which is what makes a test that is never answered still end.
    expect(JSON.parse(sent.payload)).toEqual({ action: 'socket_test', role: 'heater', slot: 0 });
  });

  it('takes a socket out of the table', async () => {
    await owner.client.delete(`/v1/devices/${modern.device.deviceId}/sockets/1`).expect(202);

    const sent = await modern.simulator.waitFor('command');
    expect(JSON.parse(sent.payload)).toEqual({ action: 'socket_remove', role: 'pump', slot: 1 });
  });
});

describe('what a device that announced nothing is spared', () => {
  beforeEach(() => old.simulator.clear());

  it.each([
    ['holding a socket', 'put', '/sockets/0/override', { state: 'on', forSeconds: 600 }],
    ['handing it back', 'delete', '/sockets/0/override', undefined],
  ])('refuses %s, and says the firmware is what is missing', async (_what, method, path, body) => {
    const refused = await owner.client
      .request(method as 'put' | 'delete', `/v1/devices/${old.device.deviceId}${path}`)
      .send(body ?? {})
      .expect(409);

    expect(refused.body.code).toBe('capability_not_announced');
    expect(refused.body.detail).toMatch(/needs a newer firmware/);
    expect(old.simulator.messagesOn('command')).toEqual([]);
  });

  it('refuses a role that arrived with the firmware change', async () => {
    const refused = await owner.client
      .put(`/v1/devices/${old.device.deviceId}/sockets/new`)
      .send({ role: 'exhaust', address: '10.0.0.9', credentials: null, timer: null })
      .expect(409);

    expect(refused.body.detail).toMatch(/the role exhaust/);
    expect(old.simulator.messagesOn('command')).toEqual([]);
  });

  it('still pairs a socket with a role every build in the field knows', async () => {
    await owner.client
      .put(`/v1/devices/${old.device.deviceId}/sockets/new`)
      .send({ role: 'heater', address: '10.0.0.9', credentials: null, timer: null })
      .expect(202);

    const sent = await old.simulator.waitFor('command');
    expect(JSON.parse(sent.payload)).toMatchObject({ action: 'socket_set', role: 'heater' });
  });
});

describe('a command the firmware would refuse', () => {
  beforeEach(() => modern.simulator.clear());

  it('is refused here, with the reason, rather than published into the dark', async () => {
    const unknownSlot = await owner.client
      .put(`/v1/devices/${modern.device.deviceId}/sockets/9/override`)
      .send({ state: 'on', forSeconds: 600 })
      .expect(404);
    expect(unknownSlot.body.code).toBe('socket_unknown');

    const timerOnTheWrongRole = await owner.client
      .put(`/v1/devices/${modern.device.deviceId}/sockets/0`)
      .send({ role: 'heater', address: '10.0.0.6', credentials: null, timer: { onSeconds: 30, everySeconds: 900 } })
      .expect(422);
    expect(timerOnTheWrongRole.body.code).toBe('timer_not_for_role');

    // An address a row cannot carry is refused by the contract itself, because
    // a socket the cloud cannot see is worse than a command that says no.
    await owner.client
      .put(`/v1/devices/${modern.device.deviceId}/sockets/new`)
      .send({ role: 'heater', address: '10.0.0.9 with a space', credentials: null, timer: null })
      .expect(400);

    expect(modern.simulator.messagesOn('command')).toEqual([]);
  });
});

describe('who may touch a socket', () => {
  it('lets the owner look and switch, and nobody else do either', async () => {
    const stranger = await createAccount('sockets-stranger');
    const path = `/v1/devices/${modern.device.deviceId}/sockets`;

    await stranger.client.get(path).expect(404);
    await stranger.client.put(`${path}/0/override`).send({ state: 'on', forSeconds: 60 }).expect(404);
  });

  it('offers a demo session the table and nothing that writes', async () => {
    const demo = await demoSession();

    // A demo session reads the demo objects; this device is nobody's demo, so
    // the read is refused for that reason and the write for its own.
    const refused = await demo.client.put(`${`/v1/devices/${modern.device.deviceId}/sockets`}/0/override`).send({ state: 'on', forSeconds: 60 });
    expect(refused.status).toBe(403);
  });
});
