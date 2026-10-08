import { execFile, ExecFileException } from 'node:child_process';
import pLimit from 'p-limit';

/**
 * How many stills ffmpeg makes at once on this server, whatever camera they are
 * of: ten, which is what the box takes - ffmpeg is expensive.
 *
 * They are two lanes rather than one queue, because the two kinds of run are
 * nothing alike. A stream read over RTSP holds its run for up to 90 s on a
 * camera that hangs; a Terp Cam keyframe decoded into a JPEG takes a moment and
 * at most 15 s, and comes at the end of a read whose budget the relay has
 * already spent. In one queue a decode could wait behind ten hanging streams
 * past the time the app waits for a test picture, and the picture somebody
 * pressed the button for was stored after the screen had said no answer came.
 * So the streams have eight runs and the decodes two of their own, which
 * nothing on the other lane can hold.
 *
 * A Terp Cam's relay is not counted, only its decode: the relay is the device
 * dialling in and the camera sending a keyframe, which can take minutes of
 * waiting and next to no work, and holding a run through it would leave the
 * streams queued behind cameras that are only slow to answer.
 */
export const STREAM_RUNS = 8;
const DECODE_RUNS = 2;

export const streamSlot = pLimit(STREAM_RUNS);
export const decodeSlot = pLimit(DECODE_RUNS);

interface FfmpegRun {
  error: ExecFileException | null;
  stdout: Buffer;
  stderr: string;
}

/**
 * One run of ffmpeg on one thread, overwriting its output. A run that fails
 * resolves too, with its error beside what it wrote, because what it wrote is
 * what says why. `stdin` is fed to it where there is one.
 */
export const runFfmpeg = (
  args: string[],
  options: { loglevel: 'error' | 'warning'; timeoutMs: number; maxBuffer: number; stdin?: Buffer },
): Promise<FfmpegRun> =>
  new Promise(resolve => {
    const child = execFile(
      'ffmpeg',
      ['-loglevel', options.loglevel, '-threads', '1', '-y', ...args],
      { timeout: options.timeoutMs, maxBuffer: options.maxBuffer, encoding: 'buffer' },
      (error, stdout, stderr) => resolve({ error, stdout: stdout ?? Buffer.alloc(0), stderr: String(stderr) }),
    );
    if (options.stdin) {
      // An ffmpeg that exits before it has read all of it fails on its own; the EPIPE says nothing more.
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(options.stdin);
    }
  });
