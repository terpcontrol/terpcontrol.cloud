import { createAccount, Session } from '../support/api';
import { bounceMqttBroker } from '../support/control';
import { DeviceCredentials, DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';

/**
 * The server's own MQTT connection is the only way it reaches a device, and a
 * broker restart is an ordinary event. Nothing else in the suite would notice
 * the server failing to come back from one.
 */
let owner: Session;
let device: DeviceCredentials;
let simulator: DeviceSimulator;

beforeAll(async () => {
  owner = await createAccount('mqtt-resilience-owner');
  device = await provisionDevice(owner);
  simulator = await startSimulator(device);
  await settle();
});

afterAll(async () => {
  await simulator?.close();
});

describe('after the broker restarts', () => {
  // Both sides reconnect on a timer, so this one is allowed to take longer than
  // the rest of the suite.
  it('still reaches the device, and still hears from it', async () => {
    // Down long enough that a reconnect attempt is refused while it is gone,
    // which is what makes a client give up if it handles the failure wrongly.
    await bounceMqttBroker(3000);

    // Both sides reconnect on their own; give them a moment to notice.
    await simulator.reconnect();
    await settle(3000);

    simulator.clear();
    await owner.client.post('/device/reboot').send({ device_id: device.deviceId }).expect(200);

    const command = await simulator.waitFor('command', 20_000);
    expect(JSON.parse(command.payload)).toEqual({ action: 'reboot' });

    // And the inbound direction: the server's subscription has to be back too.
    await simulator.reportStatus({ temperature: 19.5 });
    await settle(1000);

    const listed = await owner.client.get('/device').expect(200);
    const entry = listed.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
    expect(entry.lastseen).toBeGreaterThan(Date.now() - 60_000);
  }, 60_000);

  it('handles each message once, however many times it has reconnected', async () => {
    // The server subscribes to a subject that outlives a connection attempt, so
    // a second subscriber would double everything a device says - two sets of
    // measurements, two diary entries, an alarm evaluated twice.
    const fresh = await provisionDevice(owner);
    const talker = await startSimulator(fresh);

    try {
      await bounceMqttBroker(2000);
      await talker.reconnect();
      await settle(3000);

      const message = `message-co2-low:${Date.now()}`;
      await talker.publish('log', { message, severity: 0, time: Date.now() });
      await settle(1500);

      const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
      expect(logs.body.filter((entry: { message: string }) => entry.message === message)).toHaveLength(1);
    } finally {
      await talker.close();
    }
  }, 60_000);
});
