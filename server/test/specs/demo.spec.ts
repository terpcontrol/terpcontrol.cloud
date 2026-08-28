import { createAccount, demoSession, Session } from '../support/api';
import { DeviceCredentials, DeviceSimulator, provisionDevice, startSimulator } from '../support/device';
import { markAsDemoDevice } from '../support/fixtures';

/**
 * The public demo shows one of somebody's real devices to anyone who asks, so
 * everything the owner put into it that is not part of the show has to be gone
 * from the answer: the webcam URL and the socket addresses carry credentials
 * and a home network, an alarm names where it reports to, and a failure is
 * logged with the URL that failed.
 */

// A camera the poller can fail to reach at once. Stored settings are read by
// the poller for the rest of the run, and an address that is merely routed
// nowhere - a LAN address on a build machine - leaves ffmpeg waiting on a
// connection until its timeout, holding a slot the specs after this one need.
const RTSP_STREAM = 'rtsp://camera-user:hunter2@127.0.0.1:1/stream1';
const WEBHOOK = 'https://hooks.example.invalid/T0000/B0000/secret-token';

let owner: Session;
let demo: Session;
let device: DeviceCredentials;
let simulator: DeviceSimulator;

const settle = (ms = 400) => new Promise(resolve => setTimeout(resolve, ms));

const listedForDemo = async () => {
  const response = await demo.client.get('/device').expect(200);
  return response.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
};

beforeAll(async () => {
  owner = await createAccount('demo-owner');
  demo = await demoSession();
  device = await provisionDevice(owner);
  simulator = await startSimulator(device);

  await owner.client
    .post('/device/cloudsettings')
    .send({ device_id: device.deviceId, cloud_settings: { rtspStream: RTSP_STREAM, firmwareChannel: 'stable' } })
    .expect(200);

  await owner.client
    .post('/device/alarms')
    .send({
      device_id: device.deviceId,
      alarms: [
        {
          name: 'Too hot',
          sensorType: 'temperature',
          upperThreshold: 30,
          actionType: 'webhook',
          actionTarget: WEBHOOK,
          webhookMethod: 'POST',
          webhookHeaders: { Authorization: 'Bearer secret' },
          webhookTriggeredPayload: '{"text":"hot"}',
        },
      ],
    })
    .expect(200);

  await simulator.publish('log', { message: `hardware-info:webcam_url=${RTSP_STREAM}`, severity: 0, time: Date.now() });
  await simulator.publish('log', { message: 'hardware-info:socket_ips=192.168.1.51,192.168.1.52', severity: 0, time: Date.now() });
  await simulator.publish('log', { message: 'hardware-info:co2=on', severity: 0, time: Date.now() });
  await settle(800);

  await owner.client
    .post(`/device/logs/${device.deviceId}`)
    .send({ message: `Webcam unreachable: ${RTSP_STREAM}`, severity: 2, categories: ['device'], time: Date.now() })
    .expect(200);

  await markAsDemoDevice(device.deviceId);
});

afterAll(async () => {
  await simulator?.close();
  if (device) await markAsDemoDevice(device.deviceId, false);
});

describe('what a demo session is shown', () => {
  it('lists the demo device, and the owner still sees the real values', async () => {
    expect(await listedForDemo()).toBeDefined();

    const mine = await owner.client.get('/device').expect(200);
    const entry = mine.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
    expect(entry.cloudSettings.rtspStream).toBe(RTSP_STREAM);
    expect(entry.hardwareInfo).toMatchObject({ webcam_url: RTSP_STREAM, socket_ips: '192.168.1.51,192.168.1.52' });
  });

  it('replaces the webcam URL rather than passing the credentials on', async () => {
    const entry = await listedForDemo();

    expect(entry.cloudSettings.rtspStream).not.toContain('hunter2');
    expect(entry.cloudSettings.rtspStream).toBe('rtsp://demo.terpcontrol.cloud:554/growcam');
  });

  it('drops the hardware info that describes the owner´s network', async () => {
    const entry = await listedForDemo();

    expect(entry.hardwareInfo.webcam_url).toBeUndefined();
    expect(entry.hardwareInfo.socket_ips).toBeUndefined();
    // What the device can do is the point of the demo, and stays.
    expect(entry.hardwareInfo.co2).toBe('on');
  });

  it('blanks where an alarm reports to', async () => {
    const alarms = await demo.client.get(`/device/alarms/${device.deviceId}`).expect(200);

    expect(alarms.body).toHaveLength(1);
    for (const alarm of alarms.body) {
      expect(alarm.actionTarget).toBe('');
      expect(alarm.webhookHeaders).toBeUndefined();
      expect(alarm.webhookTriggeredPayload).toBeUndefined();
      // The alarm itself is still shown, so the demo has something to display.
      expect(alarm.sensorType).toBe('temperature');
    }

    const mine = await owner.client.get(`/device/alarms/${device.deviceId}`).expect(200);
    expect(mine.body[0].actionTarget).toBe(WEBHOOK);
  });

  it('hides the URL a failure was logged with', async () => {
    const logs = await demo.client.get(`/device/logs/${device.deviceId}`).expect(200);
    const failure = logs.body.find((entry: { message: string }) => entry.message?.startsWith('Webcam unreachable'));

    expect(failure.message).toBe('Webcam unreachable: [hidden]');

    const mine = await owner.client.get(`/device/logs/${device.deviceId}`).expect(200);
    expect(mine.body.some((entry: { message: string }) => entry.message === `Webcam unreachable: ${RTSP_STREAM}`)).toBe(true);
  });

  it('keeps the webcam URL out of the cloud settings endpoint too', async () => {
    const response = await demo.client.get(`/device/cloudsettings/${device.deviceId}`).expect(200);

    expect(response.body.cloudSettings.rtspStream).toBe('rtsp://demo.terpcontrol.cloud:554/growcam');
    // Nothing of the stored device may come along with the settings that were
    // built from it - not the real URL, and not the owner it belongs to.
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
    expect(JSON.stringify(response.body)).not.toContain('owner_id');
  });

  it('reaches nothing but the demo devices', async () => {
    const other = await provisionDevice(owner);

    await demo.client.get(`/device/logs/${other.deviceId}`).expect(403);
    await demo.client.get(`/device/alarms/${other.deviceId}`).expect(403);
    await demo.client.get(`/device/config/${other.deviceId}`).expect(403);
  });
});
