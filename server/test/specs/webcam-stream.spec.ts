import { context, createAccount, Session } from '../support/api';
import { DeviceCredentials, provisionDevice, startSimulator } from '../support/device';
import { argumentAfter, armFfmpeg, ffmpegCalls, resetFfmpeg } from '../support/ffmpeg';

/**
 * How a still is read: what the server runs ffmpeg with, what it makes of a run
 * that failed, and what reaches the device when the camera is behind its
 * tunnel. None of that is visible in the answer, so these specs go through the
 * ffmpeg the app finds on its PATH - see support/ffmpeg.ts.
 */

let owner: Session;
let device: DeviceCredentials;

const MISSING_CODEC_PARAMETERS = 'Could not find codec parameters for stream 0 (Video: hevc, none): unspecified size';

const readStill = (body: Record<string, unknown>) => owner.client.post(`/image/test/${device.deviceId}`).send(body);
const camera = () => ({ rtspStream: `${context.controlUrl}/__control/stream.mp4` });

beforeAll(async () => {
  owner = await createAccount('webcam-stream-owner');
  device = await provisionDevice(owner);
});

beforeEach(() => resetFfmpeg());
afterAll(() => resetFfmpeg());

describe('reading a still from a camera', () => {
  it('asks for the frame with a minimal probe budget', async () => {
    await readStill(camera()).expect(200);

    const calls = ffmpegCalls();
    expect(calls).toHaveLength(1);
    expect(argumentAfter(calls[0], '-probesize')).toBe('32');
    expect(argumentAfter(calls[0], '-analyzeduration')).toBe('0');
  });

  it('retries with a full probe budget when the camera had no codec parameters ready', async () => {
    armFfmpeg([{ stderr: MISSING_CODEC_PARAMETERS, exit: 1 }]);

    const response = await readStill(camera()).expect(200);
    expect(response.headers['content-type']).toBe('image/jpeg');

    const calls = ffmpegCalls();
    expect(calls).toHaveLength(2);
    expect(argumentAfter(calls[1], '-probesize')).toBe('5000000');
    expect(argumentAfter(calls[1], '-analyzeduration')).toBe('5000000');
  });

  it('does not spend a second attempt on a camera it could not reach', async () => {
    armFfmpeg([{ stderr: 'Connection refused', exit: 1 }]);

    await readStill(camera()).expect(502);

    expect(ffmpegCalls()).toHaveLength(1);
  });
});

describe('a camera reached through the device tunnel', () => {
  it('relays bytes above 0x7f to the device unchanged', async () => {
    const simulator = await startSimulator(device);
    // An interleaved RTCP receiver report, as ffmpeg sends it on an RTSP/TCP
    // session: five of its eight bytes are above 0x7f or below 0x20, so a
    // socket read as text would arrive at the device mangled.
    const report = '2401000c80c9ff00';

    try {
      armFfmpeg([{ writeToInput: report, stderr: 'harness: the camera said nothing back', exit: 1 }]);

      await readStill({ rtspStream: 'rtsp://192.168.11.198:554/streamtype=1', tunnelRtspStream: true }).expect(502);

      const relayed = Buffer.concat(
        simulator
          .messagesOn('tunnel_write')
          .map(message => JSON.parse(message.payload).payload)
          .filter(Boolean)
          .map((payload: string) => new Uint8Array(Buffer.from(payload, 'base64'))),
      );
      expect(relayed.toString('hex')).toBe(report);
    } finally {
      await simulator.close();
    }
  });
});
