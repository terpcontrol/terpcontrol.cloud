import { anonymous, context, createAccount, Session, unique } from '../support/api';
import { provisionDevice, registerDevice } from '../support/device';
import { diaryEntriesOf } from '../support/fixtures';
import { serverLog as logContents } from '../support/logs';

const settle = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

let owner: Session;

beforeAll(async () => {
  owner = await createAccount('logging-owner');
});

describe('what the server writes down', () => {
  it('logs the device it registered, not just that it registered one', async () => {
    const device = await registerDevice();

    await settle();

    expect(logContents()).toContain(device.deviceId);
  });

  it('never writes a value it failed to render', async () => {
    // `logger.info('failed:', error)` reaches the file as the message alone,
    // and an object logged on its own as "[object Object]" - both of which lose
    // exactly what somebody reading the log came for.
    const contents = logContents();

    expect(contents).not.toContain('[object Object]');
    expect(contents).not.toMatch(/^\S+ \S+ \w+: \s*$/m);
  });

  it('never writes the MQTT shared secret down, though the broker sends it in the path', async () => {
    // The broker checks credentials for every device that connects, so an
    // unredacted path would fill a month of logs with copies of the secret.
    await anonymous().post(`/mqttauth/${context.mqttAuthSecret}/user`).type('form').send({ username: 'nobody', password: 'nope' });

    await settle();
    const contents = logContents();

    expect(contents).not.toContain(context.mqttAuthSecret);
    // The request is still recorded, minus the one part that is a credential.
    expect(contents).toContain('/mqttauth/<secret>/user');
  });

  it('never writes a camera password down, or hands one back', async () => {
    const device = await provisionDevice(owner);
    const password = `cam-secret-${Date.now()}`;
    const camera = await owner.client
      .post('/v1/cameras')
      .send({ kind: 'rtsp', deviceId: device.deviceId, name: 'Nothing here', url: `rtsp://camera-user:${password}@127.0.0.1:1/nothing-here` })
      .expect(201);

    // The failure message quotes the whole ffmpeg command line, which carries
    // the URL the camera is stored with - credentials and all.
    const response = await owner.client.post(`/v1/cameras/${camera.body.id}/test-captures`).expect(200);

    expect(response.body.succeeded).toBe(false);
    expect(response.body.error).not.toContain(password);
    expect(response.body.error).toContain('<credentials>');

    await settle();
    expect(logContents()).not.toContain(password);
  });

  it('never writes one into the diary either, which a share link can read', async () => {
    const device = await provisionDevice(owner);
    const password = `diary-cam-secret-${Date.now()}`;

    // The poller reads the camera, fails, and - with error logging on - records
    // why in the diary, which the owner can hand to anybody with a share link.
    await owner.client
      .post('/v1/cameras')
      .send({
        kind: 'rtsp',
        deviceId: device.deviceId,
        name: 'Nothing here either',
        url: `rtsp://camera-user:${password}@127.0.0.1:1/nothing-here`,
        logErrors: true,
      })
      .expect(201);

    const streamErrors = async () => {
      const entries = await diaryEntriesOf(device.deviceId);
      return entries.filter(entry => (entry.message as { key?: string } | null)?.key === 'message-rtsp-stream-error');
    };

    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline && (await streamErrors()).length === 0) await settle(2000);

    const recorded = await streamErrors();
    expect(recorded.length).toBeGreaterThan(0);
    expect(JSON.stringify(recorded)).not.toContain(password);
    expect(JSON.stringify(recorded)).toContain('<credentials>');
  }, 60_000);

  it('keeps the detail of a message that carries one', async () => {
    // The access log is the highest-volume line the server writes, and the
    // path is the part of it that has to be there.
    const path = `/v1/devices/${unique('never-a-device')}`;
    await owner.client.get(path).expect(404);

    await settle();

    expect(logContents()).toContain(path);
  });
});
