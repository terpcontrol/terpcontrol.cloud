import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_ROOT } from './infra/app';

/**
 * The ffmpeg the app under test runs is a shim (`support/infra/fake-bin/ffmpeg`)
 * that records every run and passes it on to the real ffmpeg. These are the two
 * sides of it a spec uses: what was run, and what a particular run should
 * answer instead of the camera.
 */
export const FFMPEG_STATE_DIR = join(SERVER_ROOT, 'test', '.tmp', 'ffmpeg');
export const FFMPEG_BIN_DIR = join(SERVER_ROOT, 'test', 'support', 'infra', 'fake-bin');

const PLAN = join(FFMPEG_STATE_DIR, 'plan.json');
const CALLS = join(FFMPEG_STATE_DIR, 'calls.jsonl');

export interface ScriptedRun {
  /**
   * Part of the command line this answer is for - the stream URL, normally.
   * Without it the next ffmpeg run takes the answer, and the webcam poller is
   * reading its own cameras the whole time.
   */
  match?: string;
  /** What the run writes on stderr - which is what the server reads it by. */
  stderr?: string;
  /** Its exit code; anything but 0 is a failed run. */
  exit?: number;
  /** A still to answer with, base64. */
  stdout?: string;
  /** Bytes to send to whatever `-i` points at, hex, before answering. */
  writeToInput?: string;
}

/** Answers the next runs from this plan; later runs reach the real ffmpeg again. */
export const armFfmpeg = (runs: ScriptedRun[]): void => writeFileSync(PLAN, JSON.stringify(runs));

export const resetFfmpeg = (): void => {
  mkdirSync(FFMPEG_STATE_DIR, { recursive: true });
  rmSync(PLAN, { force: true });
  writeFileSync(CALLS, '');
};

/** The arguments of every ffmpeg run since the last reset, in order. */
export const ffmpegCalls = (): string[][] =>
  readFileSync(CALLS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as string[]);

export const argumentAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];
