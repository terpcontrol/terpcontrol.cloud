import { anonymous, createAccount, demoSession, loginAsAdmin, Session } from '../support/api';
import { DeviceCredentials, DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';

let owner: Session;
let admin: Session;
let device: DeviceCredentials;
let simulator: DeviceSimulator;

const commandsSeen = () => simulator.messagesOn('command').map(message => JSON.parse(message.payload));

beforeAll(async () => {
  owner = await createAccount('control-owner');
  admin = await loginAsAdmin();
  device = await provisionDevice(owner);
  simulator = await startSimulator(device);
  await settle();
});

afterAll(async () => {
  await simulator?.close();
});

beforeEach(() => simulator.clear());

const testOutputs = { heater: 1, dehumidifier: 0, co2: 0, lights: 1, fanint: 0, fanext: 0, fanbw: 0 };

describe('POST /device/test/:device_id', () => {
  it('sends the requested outputs to the device', async () => {
    await owner.client.post(`/device/test/${device.deviceId}`).send(testOutputs).expect(200);

    const command = await simulator.waitFor('command');
    expect(JSON.parse(command.payload)).toEqual({ action: 'test', outputs: testOutputs });
  });

  it('validates that every output is a number', async () => {
    await owner.client
      .post(`/device/test/${device.deviceId}`)
      .send({ ...testOutputs, heater: 'on' })
      .expect(400);
    await owner.client.post(`/device/test/${device.deviceId}`).send({ heater: 1 }).expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('control-stranger');
    await stranger.client.post(`/device/test/${device.deviceId}`).send(testOutputs).expect(403);

    await settle(200);
    expect(commandsSeen()).toHaveLength(0);
  });

  it('requires a session', async () => {
    await anonymous().post(`/device/test/${device.deviceId}`).send(testOutputs).expect(401);
  });

  it('refuses a demo session', async () => {
    const demo = await demoSession();
    await demo.client.post(`/device/test/${device.deviceId}`).send(testOutputs).expect(403);
  });
});

describe('DELETE /device/test/:device_id', () => {
  it('tells the device to leave test mode', async () => {
    await owner.client.delete(`/device/test/${device.deviceId}`).expect(200);

    const command = await simulator.waitFor('command');
    expect(JSON.parse(command.payload)).toEqual({ action: 'stoptest' });
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('control-stoptest-stranger');
    await stranger.client.delete(`/device/test/${device.deviceId}`).expect(403);
  });
});

describe('POST /device/reboot', () => {
  it('sends a reboot command', async () => {
    await owner.client.post('/device/reboot').send({ device_id: device.deviceId }).expect(200);

    const command = await simulator.waitFor('command');
    expect(JSON.parse(command.payload)).toEqual({ action: 'reboot' });
  });

  it('lets an admin reboot any device', async () => {
    await admin.client.post('/device/reboot').send({ device_id: device.deviceId }).expect(200);
    await simulator.waitFor('command');
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('control-reboot-stranger');
    await stranger.client.post('/device/reboot').send({ device_id: device.deviceId }).expect(403);

    await settle(200);
    expect(commandsSeen()).toHaveLength(0);
  });
});

describe('POST /device/maintenancemode', () => {
  it('sends the duration to the device and starts the countdown', async () => {
    await owner.client.post('/device/maintenancemode').send({ device_id: device.deviceId, duration_minutes: 30 }).expect(200);

    const command = await simulator.waitFor('command');
    expect(JSON.parse(command.payload)).toEqual({ action: 'maintenance', durationMinutes: 30 });

    const listed = await owner.client.get('/device').expect(200);
    const entry = listed.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
    expect(entry.maintenance_mode_seconds_left).toBeGreaterThan(1700);
    expect(entry.maintenance_mode_seconds_left).toBeLessThanOrEqual(1800);
  });

  it('treats a missing duration as zero, which ends maintenance', async () => {
    await owner.client.post('/device/maintenancemode').send({ device_id: device.deviceId }).expect(200);

    const command = await simulator.waitFor('command');
    expect(JSON.parse(command.payload)).toEqual({ action: 'maintenance', durationMinutes: 0 });

    const listed = await owner.client.get('/device').expect(200);
    const entry = listed.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
    expect(entry.maintenance_mode_seconds_left).toBe(0);
  });

  it('refuses a duration that is not a number, before the device hears about it', async () => {
    await owner.client.post('/device/maintenancemode').send({ device_id: device.deviceId, duration_minutes: 'half an hour' }).expect(400);
    await owner.client.post('/device/maintenancemode').send({ device_id: device.deviceId, duration_minutes: -5 }).expect(400);

    await settle(200);
    expect(commandsSeen()).toHaveLength(0);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('control-maintenance-stranger');
    await stranger.client.post('/device/maintenancemode').send({ device_id: device.deviceId, duration_minutes: 5 }).expect(403);
  });
});

describe('POST /device/auxcommand', () => {
  it('forwards a whitelisted socket command', async () => {
    await owner.client.post('/device/auxcommand').send({ device_id: device.deviceId, action: 'socket_test', role: 'heater' }).expect(200);

    const command = await simulator.waitFor('command');
    expect(JSON.parse(command.payload)).toMatchObject({ action: 'socket_test', role: 'heater' });
  });

  it('passes a socket slot through', async () => {
    await owner.client
      .post('/device/auxcommand')
      .send({ device_id: device.deviceId, action: 'socket_remove', role: 'light', slot: 2 })
      .expect(200);

    const command = await simulator.waitFor('command');
    expect(JSON.parse(command.payload)).toMatchObject({ action: 'socket_remove', role: 'light', slot: 2 });
  });

  it('rejects an action that is not whitelisted', async () => {
    await owner.client.post('/device/auxcommand').send({ device_id: device.deviceId, action: 'reboot', role: 'heater' }).expect(400);

    await settle(200);
    expect(commandsSeen()).toHaveLength(0);
  });

  it('rejects an unknown socket role', async () => {
    await owner.client.post('/device/auxcommand').send({ device_id: device.deviceId, action: 'socket_test', role: 'kettle' }).expect(400);
  });

  it('rejects an out-of-range slot', async () => {
    await owner.client
      .post('/device/auxcommand')
      .send({ device_id: device.deviceId, action: 'socket_test', role: 'heater', slot: -1 })
      .expect(400);
    await owner.client
      .post('/device/auxcommand')
      .send({ device_id: device.deviceId, action: 'socket_test', role: 'heater', slot: 9999 })
      .expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('control-aux-stranger');
    await stranger.client.post('/device/auxcommand').send({ device_id: device.deviceId, action: 'socket_test', role: 'heater' }).expect(403);
  });
});

describe('what a device reports over MQTT', () => {
  it('marks the device online and stores its samples', async () => {
    await simulator.reportStatus({ temperature: 22.5, humidity: 55 }, { heater: 1 });

    await settle(600);

    const listed = await owner.client.get('/device').expect(200);
    const entry = listed.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
    expect(entry.lastseen).toBeGreaterThan(Date.now() - 60_000);
  });

  it('records a device log message', async () => {
    await simulator.publish('log', { message: 'message-co2-low:380', severity: 1, time: Date.now() });

    await settle(600);

    const logs = await owner.client.get(`/device/logs/${device.deviceId}`).expect(200);
    expect(logs.body.some((entry: { message: string }) => entry.message === 'message-co2-low:380')).toBe(true);
  });

  // Each hardware-info message carries exactly one key=value pair; the value may
  // itself contain '=', so only the first one separates the two.
  it('stores reported hardware info', async () => {
    await simulator.publish('log', { message: 'hardware-info:co2=on', severity: 0, time: Date.now() });

    await settle(600);

    const listed = await owner.client.get('/device').expect(200);
    const entry = listed.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
    expect(entry.hardwareInfo).toMatchObject({ co2: 'on' });
  });

  it('ignores traffic for a device that was never registered', async () => {
    const ghost = new DeviceSimulator({ deviceId: 'ghost-device', username: 'ghost', password: 'ghost', deviceType: 'fridge' });
    await ghost.connect();

    try {
      await ghost.reportStatus({ temperature: 99 });
      await settle(400);

      const response = await owner.client.get('/device/logs/ghost-device').expect(403);
      expect(response.text).toBe('No access to device');
    } finally {
      await ghost.close();
    }
  });
});
