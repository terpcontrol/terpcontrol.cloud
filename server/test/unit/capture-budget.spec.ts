import { AddressInfo, createServer, Server, Socket } from 'node:net';
import { jest } from '@jest/globals';
import { CaptureService } from '@modules/v1/camera/capture.service';
import { STREAM_RUNS, streamSlot } from '@modules/v1/camera/ffmpeg-slots';
import { TerpCamService } from '@modules/v1/camera/terpcam.service';

/**
 * A stream read in the same three minutes a Terp Cam is: its wait for a turn at
 * ffmpeg, the run and the one retry a missing parameter set earns all come out
 * of one budget, because the test button waits for exactly this read.
 */

type Run = { stdout: Buffer; stderr: string; failure?: Error; timedOut?: boolean };
type RunFfmpeg = (url: string, camera: unknown, probe: string[], timeoutMs: number) => Promise<Run>;

const STREAM = { id: 'camera-stream', kind: 'rtsp', url: 'rtsp://127.0.0.1:1/budget', transport: 'tcp', tunnel: false, deviceId: null, secret: null };
const NO_CODEC = 'Could not find codec parameters for stream 0';

let service: CaptureService;
let run: jest.Mock<RunFfmpeg>;

/** A run of ffmpeg that takes `ms` of the clock and fails the way `stderr` says. */
const taking = (ms: number, stderr: string) => async (): Promise<Run> => {
  jest.setSystemTime(Date.now() + ms);
  return { stdout: Buffer.alloc(0), stderr, failure: new Error('ffmpeg failed') };
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  service = new CaptureService({} as never, {} as never);
  run = jest.fn<RunFfmpeg>();
  (service as unknown as { runFfmpegStill: RunFfmpeg }).runFfmpegStill = run;
});

afterEach(() => jest.useRealTimers());

it('gives the retry a missing parameter set earns only what the first run left of the budget', async () => {
  run.mockImplementationOnce(taking(100_000, NO_CODEC)).mockImplementationOnce(taking(1_000, 'Connection refused'));

  await expect(service.readStill(STREAM as never)).rejects.toThrow('Connection refused');
  expect(run.mock.calls.map(call => call[3])).toEqual([90_000, 80_000]);
});

it('makes no second run with too little of the budget left for one', async () => {
  run.mockImplementationOnce(taking(175_000, NO_CODEC));

  await expect(service.readStill(STREAM as never)).rejects.toThrow(NO_CODEC);
  expect(run).toHaveBeenCalledTimes(1);
});

it('counts the wait for a turn at ffmpeg, and runs nothing once that wait has spent the budget', async () => {
  let release!: () => void;
  const busy = new Promise<void>(resolve => (release = resolve));
  const others = Array.from({ length: STREAM_RUNS }, () => streamSlot(() => busy));

  const read = service.readStill(STREAM as never);
  jest.setSystemTime(Date.now() + 175_000);
  release();
  await Promise.all(others);

  await expect(read).rejects.toThrow(/timed out waiting for a turn at ffmpeg: no picture within the 3 minutes/);
  expect(run).not.toHaveBeenCalled();
});

/**
 * A Terp Cam's keyframe is decoded once its read has spent the budget on the
 * relay. Behind streams that hang for their 90 s it waited past the time the
 * app gives a test picture, and was stored after the screen had given up.
 */
it('decodes a keyframe while every stream run is held', async () => {
  let release!: () => void;
  const busy = new Promise<void>(resolve => (release = resolve));
  const streams = Array.from({ length: STREAM_RUNS }, () => streamSlot(() => busy));
  const stills = new TerpCamService();
  (stills as unknown as { decode: (h264: Buffer) => Promise<Buffer> }).decode = async () => Buffer.from('jpeg');

  await expect(stills.decodeKeyframeToJpeg(Buffer.from('keyframe'))).resolves.toEqual(Buffer.from('jpeg'));

  release();
  await Promise.all(streams);
});

describe('a run that takes too long', () => {
  let silent: Server;
  let url: string;
  const held: Socket[] = [];

  // A camera that takes the connection and never says a word, which ffmpeg waits on for as long as it is let.
  beforeEach(async () => {
    jest.useRealTimers();
    silent = createServer(conn => held.push(conn));
    await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve));
    url = `rtsp://127.0.0.1:${(silent.address() as AddressInfo).port}/silent`;
  });

  afterEach(() => {
    held.forEach(conn => conn.destroy());
    return new Promise(resolve => silent.close(resolve));
  });

  it('is ended, and says it timed out rather than what it wrote until then', async () => {
    const real = Object.getPrototypeOf(service).runFfmpegStill as RunFfmpeg;
    const ran = await real.call(service, url, { ...STREAM, url }, [], 1_000);

    expect(ran.timedOut).toBe(true);
    expect(ran.failure?.message).toBe('timed out after 1 s without a picture');
  });
});
