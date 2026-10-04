import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TestCapture } from '@fg2/shared-types/v1';
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
 */

/** How long a finished capture can still be asked about. */
const KEPT_MS = 5 * 60_000;

interface Kept {
  capture: TestCapture;
  /** The read this capture is the answer of, so a second press during it is the same capture. */
  read: Promise<StoredStill | null>;
  forget?: NodeJS.Timeout;
}

@Injectable()
export class TestCapturesService implements OnApplicationShutdown {
  private readonly kept = new Map<string, Kept>();

  constructor(
    private readonly cameras: CamerasService,
    private readonly poller: CameraPollerService,
  ) {}

  public onApplicationShutdown(): void {
    for (const { forget } of this.kept.values()) clearTimeout(forget);
    this.kept.clear();
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
