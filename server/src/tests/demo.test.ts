// uuid ships as an ES module, which this jest setup cannot transform.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import mongoose from 'mongoose';
import request from 'supertest';
import App from '@/app';
import AuthRoute from '@routes/auth.route';
import DeviceRoute from '@routes/device.route';
import deviceModel from '@/models/device.model';
import { demoAlarms, demoLogs, DEMO_WRITE_MESSAGE } from '@utils/demo';

const DEMO_DEVICE_ID = 'demo-device';
const PRIVATE_DEVICE_ID = 'private-device';

const demoDeviceDoc = {
  device_id: DEMO_DEVICE_ID,
  device_type: 'fridge',
  name: 'Demo fridge',
  demoDevice: true,
  configuration: '{"temperature":24}',
  cloudSettings: { rtspStream: 'rtsp://user:secret@cam/stream', firmwareChannel: 'stable' },
  hardwareInfo: { co2: 'on', webcam_url: 'http://user:secret@cam/snapshot', socket_ips: '192.168.1.20' },
};

afterAll(async () => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
});

describe('Demo sessions', () => {
  let app: App;

  const server = () => request(app.getServer());

  const demoToken = async (): Promise<string> => {
    const response = await server().post('/demologin').expect(200);
    return response.body.userToken.token;
  };

  beforeEach(() => {
    (mongoose as any).connect = jest.fn();
    app = new App([new AuthRoute(), new DeviceRoute()]);
    // App.run() would connect to the database first; wire up express directly.
    (app as any).initializeMiddlewares();
    (app as any).initializeRoutes((app as any).routes);
    (app as any).initializeErrorHandling();

    deviceModel.find = jest.fn().mockImplementation((filter: any) => ({
      lean: () => Promise.resolve(filter.demoDevice ? [demoDeviceDoc] : []),
    }));
    deviceModel.countDocuments = jest
      .fn()
      .mockImplementation((filter: any) => Promise.resolve(filter.demoDevice && filter.device_id === DEMO_DEVICE_ID ? 1 : 0));
    deviceModel.findOne = jest
      .fn()
      .mockImplementation((filter: any) => Promise.resolve(filter.device_id === DEMO_DEVICE_ID && filter.demoDevice ? demoDeviceDoc : null));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands out a session that is flagged as a demo session', async () => {
    const response = await server().post('/demologin').expect(200);
    expect(response.body.user).toMatchObject({ user_id: 'demo', is_admin: false, is_demo: true });
  });

  it('lists the demo devices without the webcam URL and the local addresses', async () => {
    const response = await server()
      .get('/device')
      .set('Authorization', `Bearer ${await demoToken()}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].device_id).toEqual(DEMO_DEVICE_ID);
    expect(response.body[0].cloudSettings.rtspStream).toEqual('1');
    expect(response.body[0].hardwareInfo).toEqual({ co2: 'on' });
  });

  it('reads a demo device', async () => {
    await server()
      .get(`/device/config/${DEMO_DEVICE_ID}`)
      .set('Authorization', `Bearer ${await demoToken()}`)
      .expect(200);
  });

  it('refuses a device that is not a demo device', async () => {
    await server()
      .get(`/device/config/${PRIVATE_DEVICE_ID}`)
      .set('Authorization', `Bearer ${await demoToken()}`)
      .expect(403);
  });

  it('refuses to save', async () => {
    const response = await server()
      .post('/device/setname')
      .set('Authorization', `Bearer ${await demoToken()}`)
      .send({ device_id: DEMO_DEVICE_ID, name: 'renamed' })
      .expect(403);

    expect(response.body.message).toEqual(DEMO_WRITE_MESSAGE);
  });
});

describe('demoLogs', () => {
  it('redacts what a failure echoed back from the configuration', () => {
    const [log] = demoLogs([
      { title: 'message-rtsp-stream-error', message: 'message-rtsp-stream-error:rtsp://user:secret@cam/stream: connection refused' },
    ]);

    expect(log.message).toEqual('message-rtsp-stream-error:[hidden] connection refused');
  });
});

describe('demoAlarms', () => {
  it('drops where an alarm reports to', () => {
    const [alarm] = demoAlarms([
      {
        alarmId: 'a1',
        sensorType: 'temperature',
        actionType: 'webhook',
        actionTarget: 'https://hooks.example.com/secret',
        webhookHeaders: { Authorization: 'Bearer secret' },
        webhookTriggeredPayload: '{"token":"secret"}',
        upperThreshold: 30,
      },
    ]);

    expect(alarm).toEqual({ alarmId: 'a1', sensorType: 'temperature', actionType: 'webhook', actionTarget: '', upperThreshold: 30 });
  });
});
