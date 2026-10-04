import { createAccount, demoSession, Session } from '../support/api';
import { DeviceCredentials, DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';
import { markAsDemoDevice } from '../support/fixtures';

/**
 * The public demo shows one of somebody's real devices to anyone who asks, so
 * everything the owner put into it that is not part of the show has to be gone
 * from the answer: a stream URL and a camera's address carry credentials and a
 * home network, and so do the sockets' addresses. What the hardware can *do*
 * stays - that is what the demo is showing.
 */

// Routed nowhere on purpose: the poller reads a camera for the rest of the run,
// and an address that merely goes unanswered leaves ffmpeg waiting on a
// connection until its timeout, holding a slot the specs after this one need.
const RTSP_STREAM = 'rtsp://camera-user:hunter2@127.0.0.1:1/stream1';
const CAMERA_DID = 'DEMOCAM01';
const CAMERA_IP = '192.168.1.77';

let owner: Session;
let demo: Session;
let device: DeviceCredentials;
let simulator: DeviceSimulator;
let rtspCameraId: string;

const demoDevice = async () => {
  const response = await demo.client.get('/v1/devices').expect(200);
  return response.body.items.find((candidate: { id: string }) => candidate.id === device.deviceId);
};

beforeAll(async () => {
  owner = await createAccount('demo-owner');
  demo = await demoSession();
  device = await provisionDevice(owner);
  simulator = await startSimulator(device);

  // What a controller reports about itself: the camera it has paired, the
  // sockets it drives, and what it can do.
  await simulator.publish('log', { message: `hardware-info:webcam_did=${CAMERA_DID}`, severity: 0, time: Date.now() });
  await simulator.publish('log', { message: `hardware-info:webcam_ip=${CAMERA_IP}`, severity: 0, time: Date.now() });
  await simulator.publish('log', { message: 'hardware-info:sockets_n=1', severity: 0, time: Date.now() });
  await simulator.publish('log', { message: 'hardware-info:socket_list0=heater|AA:BB:CC:DD:EE:FF|192.168.1.51|on', severity: 0, time: Date.now() });
  await simulator.publish('log', { message: 'hardware-info:socket_ips=192.168.1.51,192.168.1.52', severity: 0, time: Date.now() });
  await simulator.publish('log', { message: 'hardware-info:co2=on', severity: 0, time: Date.now() });
  await settle(800);

  const camera = await owner.client
    .post('/v1/cameras')
    .send({ kind: 'rtsp', deviceId: device.deviceId, name: 'The tent', url: RTSP_STREAM })
    .expect(201);
  rtspCameraId = camera.body.id;

  await markAsDemoDevice(device.deviceId);
});

afterAll(async () => {
  await simulator?.close();
  if (device) await markAsDemoDevice(device.deviceId, false);
});

describe('what a demo session is shown', () => {
  it('lists the demo device, and the owner still sees the real values', async () => {
    expect(await demoDevice()).toBeDefined();

    const mine = await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200);
    expect(mine.body.state.hardware).toMatchObject({ socket_ips: '192.168.1.51,192.168.1.52', co2: 'on' });
  });

  it('drops the hardware info that describes the owner´s network', async () => {
    const entry = await demoDevice();

    expect(entry.state.hardware.socket_ips).toBeUndefined();
    expect(entry.state.hardware.socket_list0).toBeUndefined();
    // What the device can do is the point of the demo, and stays.
    expect(entry.state.hardware.co2).toBe('on');
  });

  it('shows the sockets without the addresses they are reached at', async () => {
    const response = await demo.client.get(`/v1/devices/${device.deviceId}/sockets`).expect(200);

    expect(response.body.items).toHaveLength(1);
    for (const socket of response.body.items) {
      expect(socket.address).toBe('');
      expect(socket.hardwareId).toBe('');
      // The role and the state are what the demo is showing.
      expect(socket.role).toBe('heater');
      expect(socket.state).toBe('on');
    }

    const mine = await owner.client.get(`/v1/devices/${device.deviceId}/sockets`).expect(200);
    expect(mine.body.items[0].address).toBe('192.168.1.51');
  });

  it('replaces a stream URL rather than passing the credentials on', async () => {
    const response = await demo.client.get(`/v1/cameras/${rtspCameraId}`).expect(200);

    expect(response.body.url).not.toContain('hunter2');
    expect(response.body.url).toBe('rtsp://demo.terpcontrol.cloud:554/growcam');
    // Nothing of the stored camera may come along with it either.
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('keeps the address of a paired camera to the owner', async () => {
    const listed = await demo.client.get('/v1/cameras').expect(200);
    const paired = listed.body.items.find((candidate: { kind: string }) => candidate.kind === 'terpcam_controller');

    // The Terp Cam the controller paired is listed; where it is reached is not.
    expect(paired).toBeDefined();
    expect(paired.did).toBeNull();
    expect(paired.ip).toBeNull();

    const mine = await owner.client.get('/v1/cameras').expect(200);
    const real = mine.body.items.find((candidate: { kind: string }) => candidate.kind === 'terpcam_controller');
    expect(real).toMatchObject({ did: CAMERA_DID, ip: CAMERA_IP });
  });

  it('reaches nothing but the demo objects', async () => {
    const other = await provisionDevice(owner);

    await demo.client.get(`/v1/devices/${other.deviceId}`).expect(404);
    await demo.client.get(`/v1/devices/${other.deviceId}/alarm-rules`).expect(404);
    await demo.client.get(`/v1/devices/${other.deviceId}/sockets`).expect(404);
  });

  it('may read the demo and write nothing, including to it', async () => {
    await demo.client.patch(`/v1/devices/${device.deviceId}`).send({ name: 'renamed by a visitor' }).expect(403);
    await demo.client.post(`/v1/devices/${device.deviceId}/commands`).send({ kind: 'reboot' }).expect(403);
  });
});
