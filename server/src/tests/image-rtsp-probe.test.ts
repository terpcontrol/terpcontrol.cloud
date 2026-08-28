jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const execFileCalls: string[][] = [];
let execFileResults: { stdout: Buffer; stderr: string; error?: Error }[] = [];

jest.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, callback: (e: Error | null, out: Buffer, err: string) => void) => {
    execFileCalls.push(args);
    const result = execFileResults[execFileCalls.length - 1];
    callback(result.error ?? null, result.stdout, result.stderr);
  },
}));

import { imageService } from '@services/image.service';

const DEVICE_ID = 'device-1';
const SETTINGS = { rtspStream: 'rtsp://cam:554/streamtype=0' };

const JPEG = Buffer.from('jpeg-bytes');
const MISSING_PARAMS_STDERR = 'Could not find codec parameters for stream 0 (Video: hevc, none): unspecified size';

const probeArg = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe('still frame probe budget', () => {
  beforeEach(() => {
    execFileCalls.length = 0;
  });

  it('grabs the frame with a minimal probe budget and does not retry', async () => {
    execFileResults = [{ stdout: JPEG, stderr: '' }];

    await expect(imageService.testRtspStream(DEVICE_ID, SETTINGS)).resolves.toEqual(JPEG);
    expect(execFileCalls).toHaveLength(1);
    expect(probeArg(execFileCalls[0], '-probesize')).toBe('32');
    expect(probeArg(execFileCalls[0], '-analyzeduration')).toBe('0');
  });

  it('retries with a full probe budget when ffmpeg could not find the codec parameters', async () => {
    execFileResults = [
      { stdout: Buffer.alloc(0), stderr: MISSING_PARAMS_STDERR, error: new Error('exit 1') },
      { stdout: JPEG, stderr: '' },
    ];

    await expect(imageService.testRtspStream(DEVICE_ID, SETTINGS)).resolves.toEqual(JPEG);
    expect(execFileCalls).toHaveLength(2);
    expect(probeArg(execFileCalls[1], '-probesize')).toBe('5000000');
    expect(probeArg(execFileCalls[1], '-analyzeduration')).toBe('5000000');
  });

  it('does not spend a second attempt on a camera that was unreachable', async () => {
    execFileResults = [{ stdout: Buffer.alloc(0), stderr: 'Connection refused', error: new Error('exit 1') }];

    await expect(imageService.testRtspStream(DEVICE_ID, SETTINGS)).rejects.toThrow('exit 1');
    expect(execFileCalls).toHaveLength(1);
  });
});
