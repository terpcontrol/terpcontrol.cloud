import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { StreamTestCapture, StreamTestPicture, TestCapture } from '@fg2/shared-types/v1';
import { captureFailureOf } from '@fg2/shared-types/v1-schemas';
import { CamerasService, CameraWithSecret } from './cameras.service';
import { CameraPollerService, StoredStill } from './camera-poller.service';

/**
 * The test button's pictures, from the press until a little while after the
 * answer.
 *
 * A press starts the poller's own read of the camera - or joins the one under
 * way - and is answered at once with an id the screen asks after until it is
 * done. A read can take minutes, and a request held open for that long is one
 * every proxy on the way to this server has to be told to allow; asking every
 * couple of seconds needs nothing of them.
 *
 * Kept in memory: a capture is a few minutes of somebody watching a button,
 * and one lost with a restart is asked after, refused, and pressed again.
 *
 * A stream's address is tested the same way before any camera is made of it:
 * the same read, of a camera drafted and never stored, whose picture is handed
 * over in the answer rather than kept (`StreamTestCapture`).
 */

/** How long a finished capture can still be asked about. */
const KEPT_MS = 5 * 60_000;

/** The widest the picture of a test of an address is handed over at: what the form draws it at, on a phone's screen. */
const PICTURE_WIDTH = 720;

interface Kept {
  capture: TestCapture;
  /** The read this capture is the answer of, so a second press during it is the same capture. */
  read: Promise<StoredStill | null>;
  forget?: NodeJS.Timeout;
}

/** A test of an address, which belongs to the account that started it and to nobody else. */
interface KeptStreamTest {
  capture: StreamTestCapture;
  accountId: string;
  /** Whether that account is told what the camera said, which can name where somebody else's hardware lives. */
  hearsError: boolean;
  /** The stream as it is opened, so a second press with the same settings joins the first. */
  stream: string;
  forget?: NodeJS.Timeout;
}

@Injectable()
export class TestCapturesService implements OnApplicationShutdown {
  private readonly kept = new Map<string, Kept>();
  private readonly streamTests = new Map<string, KeptStreamTest>();

  constructor(
    private readonly cameras: CamerasService,
    private readonly poller: CameraPollerService,
  ) {}

  public onApplicationShutdown(): void {
    for (const { forget } of [...this.kept.values(), ...this.streamTests.values()]) clearTimeout(forget);
    this.kept.clear();
    this.streamTests.clear();
  }

  /** A capture of the camera, running: a new one, or the one a press before this is still waiting for. */
  public start(camera: CameraWithSecret): TestCapture {
    const read = this.poller.readNow(camera);
    const joined = [...this.kept.values()].find(kept => kept.read === read && kept.capture.state === 'running');
    if (joined) return joined.capture;

    const kept: Kept = {
      read,
      capture: {
        id: uuidv4(),
        cameraId: camera.id,
        state: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        still: null,
        reason: null,
        error: null,
      },
    };
    this.kept.set(kept.capture.id, kept);
    void read.then(
      stored => this.finish(kept, stored ?? 'the camera was taken away while it was being read'),
      error => this.finish(kept, String((error as Error)?.message ?? error)),
    );
    return kept.capture;
  }

  /** The capture of this camera with that id, while it is kept. */
  public find(cameraId: string, captureId: string): TestCapture | null {
    const kept = this.kept.get(captureId);
    return kept?.capture.cameraId === cameraId ? kept.capture : null;
  }

  /**
   * A test of a stream that is no camera, running: a new one, or the one this
   * account started with the same stream and is still waiting for. `camera` is
   * the draft the address would become; nothing of it is written.
   */
  public startStream(accountId: string, hearsError: boolean, camera: CameraWithSecret): StreamTestCapture {
    const stream = JSON.stringify([camera.url, camera.transport ?? 'tcp', camera.tunnel, camera.deviceId]);
    const joined = [...this.streamTests.values()].find(
      kept => kept.accountId === accountId && kept.stream === stream && kept.capture.state === 'running',
    );
    if (joined) return heardBy(joined);

    const kept: KeptStreamTest = {
      accountId,
      hearsError,
      stream,
      capture: { id: uuidv4(), state: 'running', startedAt: new Date().toISOString(), finishedAt: null, picture: null, reason: null, error: null },
    };
    this.streamTests.set(kept.capture.id, kept);
    void this.poller
      .readUnstored(camera)
      .then(pictureOf)
      .then(
        picture => this.finishStream(kept, picture),
        error => this.finishStream(kept, String((error as Error)?.message ?? error)),
      );
    return heardBy(kept);
  }

  /** This account's test of an address with that id, while it is kept. */
  public findStream(accountId: string, captureId: string): StreamTestCapture | null {
    const kept = this.streamTests.get(captureId);
    return kept?.accountId === accountId ? heardBy(kept) : null;
  }

  private finishStream(kept: KeptStreamTest, outcome: StreamTestPicture | string): void {
    const finishedAt = new Date().toISOString();
    kept.capture =
      typeof outcome === 'string'
        ? { ...kept.capture, state: 'failed', finishedAt, reason: captureFailureOf(outcome), error: outcome.slice(0, 2000) }
        : { ...kept.capture, state: 'done', finishedAt, picture: outcome };
    kept.forget = setTimeout(() => this.streamTests.delete(kept.capture.id), KEPT_MS);
    kept.forget.unref?.();
  }

  private async finish(kept: Kept, outcome: StoredStill | string): Promise<void> {
    const finishedAt = new Date().toISOString();
    if (typeof outcome === 'string') {
      const error = outcome.slice(0, 2000);
      // The camera page says why the last try failed, and this was the last try:
      // written before the capture says it is over, so the page asks for it after.
      await this.cameras.noteCapture(kept.capture.cameraId, null, error).catch(() => undefined);
      kept.capture = { ...kept.capture, state: 'failed', finishedAt, reason: captureFailureOf(error), error };
    } else {
      kept.capture = {
        ...kept.capture,
        state: 'done',
        finishedAt,
        still: { mediaId: outcome.mediaId, capturedAt: outcome.capturedAt.toISOString() },
      };
    }
    kept.forget = setTimeout(() => this.kept.delete(kept.capture.id), KEPT_MS);
    kept.forget.unref?.();
  }
}

/** A test of an address as the account that started it may read it. */
const heardBy = ({ capture, hearsError }: KeptStreamTest): StreamTestCapture => (hearsError ? capture : { ...capture, error: null });

/** The still a test read, at most as wide as the form draws it, as of the moment it arrived. */
const pictureOf = async (still: Buffer): Promise<StreamTestPicture> => {
  const capturedAt = new Date().toISOString();
  const small = await sharp(still).resize({ width: PICTURE_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { capturedAt, jpeg: small.toString('base64') };
};
