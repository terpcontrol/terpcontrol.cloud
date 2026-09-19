import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MediaQuality, MediaWindow } from '@fg2/shared-types/v1';
import { logger } from '@utils/logger';
import { BackgroundWork } from '@common/background-work';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CamerasService } from './cameras.service';
import { EntitlementService } from './entitlement.service';
import { MediaPosition, MediaService } from './media.service';
import { TimelapseContextService } from './timelapse-context.service';
import { DEFAULT_ASPECT, FrameSize, OverlayFrame, composeFrame, overlayLayer, sizeFor, wasDark } from './timelapse-overlays';

/**
 * Rolls a camera's stills up into the films a client plays back, renders the
 * ones somebody asked for, and thins the stills themselves out as they age - a
 * year of full-resolution frames every thirty seconds is not worth keeping once
 * the films made from them exist.
 *
 * Everything here is per camera, so two cameras in one tent each keep their own
 * day, week and month.
 */

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

const BUILD_INTERVAL_MS = 60 * 60 * 1000;
const THIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What a still is kept for when nothing says otherwise, which is what this server has always kept. */
const STILL_RETENTION_DAYS = 3 * 365;

// Gradually thin out stills as they age: once a picture is older than `afterMs`,
// no more than one is kept per `minIntervalMs`. Ordered oldest-boundary last so
// each tier only thins pictures younger than the next, coarser tier.
const THINNING_TIERS = [
  { afterMs: MS_IN_A_DAY, minIntervalMs: 60 * 1000 },
  { afterMs: 7 * MS_IN_A_DAY, minIntervalMs: 5 * 60 * 1000 },
  { afterMs: 30 * MS_IN_A_DAY, minIntervalMs: 15 * 60 * 1000 },
  { afterMs: 90 * MS_IN_A_DAY, minIntervalMs: 60 * 60 * 1000 },
];

const FRAME_RATE = 25;

/** Half a second of film. Fewer frames than this is a flicker, not a timelapse. */
const MINIMUM_FRAMES = FRAME_RATE / 2;

const DAY_FRAME_INTERVAL_MS = 2 * 60 * 1000;

/**
 * The three rolling films. The weekly and monthly ones cover far more frames
 * than the daily one, so rebuilding them every time a single new still arrives
 * wastes CPU for little visible benefit: each is only rebuilt once enough new
 * frames have arrived since the last rebuild.
 */
const ROLLING: { window: MediaWindow; spanMs: number; frameIntervalMs: number; refreshMs: number }[] = [
  { window: 'day', spanMs: MS_IN_A_DAY, frameIntervalMs: DAY_FRAME_INTERVAL_MS, refreshMs: 60 * 60 * 1000 },
  { window: 'week', spanMs: 7 * MS_IN_A_DAY, frameIntervalMs: 7 * DAY_FRAME_INTERVAL_MS, refreshMs: 4 * 60 * 60 * 1000 },
  { window: 'month', spanMs: 30 * MS_IN_A_DAY, frameIntervalMs: 30 * DAY_FRAME_INTERVAL_MS, refreshMs: 12 * 60 * 60 * 1000 },
];

/** How many queued renders one pass takes on: a render is minutes of ffmpeg, and the rolling films wait behind it. */
const RENDERS_PER_PASS = 3;

/** What ffmpeg is told; `size` is the shape a composed film was asked for and is absent on the rolling ones. */
interface FfmpegOptions {
  quality: MediaQuality;
  watermark: string | null;
  framesPerSecond?: number;
  size?: FrameSize;
}

/**
 * What one film is made of. `compose` is what the composer adds: the camera
 * shown beside this one - `null` for a film of one - and the layer drawn over
 * each frame.
 */
interface EncodeOptions extends Omit<FfmpegOptions, 'watermark'> {
  watermark: boolean;
  compose: {
    beside: MediaPosition[] | null;
    layer: (frame: OverlayFrame) => string | null;
    tolerance: number;
  } | null;
}

/** What an `sd` render is scaled to. `hd` keeps the frames at the size the camera delivered them. */
const SD_WIDTH = 1280;

@Injectable()
export class TimelapseService implements OnModuleInit, OnApplicationShutdown {
  private lastThinningRun = 0;
  private readonly work = new BackgroundWork();

  constructor(
    private readonly cameras: CamerasService,
    private readonly media: MediaService,
    private readonly entitlement: EntitlementService,
    private readonly context: TimelapseContextService,
  ) {}

  public onModuleInit(): void {
    this.work.schedule('The timelapse builder', () => this.pass(), 60_000);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the timelapse builder');
    this.work.stop();
  }

  private async pass(): Promise<void> {
    try {
      // What somebody is waiting for goes first; the rolling films are nobody's
      // stopwatch.
      await this.drainTheQueue();

      const shouldThin = Date.now() - this.lastThinningRun >= THIN_INTERVAL_MS;

      for (const camera of await this.cameras.all()) {
        // As in the poller: a pass walks every camera and runs ffmpeg as it
        // goes, so it has to notice the server stopping around it.
        if (this.work.isStopped) break;

        if (camera.removedAt === null) {
          for (const rolling of ROLLING) {
            await this.buildRolling(camera, rolling);
          }
        }

        // A camera that is gone keeps its pictures, so they are still thinned
        // and still swept: what stops is only the making of new films.
        await this.sweep(camera);
        if (shouldThin) await this.thin(camera);
      }

      if (shouldThin) this.lastThinningRun = Date.now();
    } catch (e) {
      logger.error(`The timelapse builder failed a pass: ${e}`);
    } finally {
      this.work.schedule('The timelapse builder', () => this.pass(), BUILD_INTERVAL_MS);
    }
  }

  // -------------------------------------------------------------------------
  // The rolling day, week and month
  // -------------------------------------------------------------------------

  /**
   * Rebuilds this camera's film of the given window, walking back through the
   * periods until it meets one that is already up to date. The open period is
   * the one that keeps growing, so only it is held to the refresh interval; a
   * period that has closed is rebuilt once, as soon as it is complete.
   */
  private async buildRolling(camera: CameraDocument, rolling: (typeof ROLLING)[number]): Promise<void> {
    const openPeriodEnd = Math.ceil(Date.now() / rolling.spanMs) * rolling.spanMs;

    for (let end = openPeriodEnd; ; end -= rolling.spanMs) {
      if (this.work.isStopped) return;

      const startsAt = new Date(end - rolling.spanMs);
      const endsAt = new Date(end);
      const existing = await this.media.newest({ cameraId: camera.id, kind: 'timelapse', window: rolling.window, from: startsAt, before: endsAt });
      const [newest] = await this.media.latestPositions({ cameraId: camera.id, kind: 'still', from: startsAt, before: endsAt }, 1);
      if (!newest) return;

      // A film stored without the instant of its last frame is left alone:
      // there is nothing to compare against.
      const coveredUntil = existing?.endsAt ?? null;
      const isOpen = end === openPeriodEnd;
      const stale =
        !existing ||
        (coveredUntil !== null &&
          (isOpen ? newest.capturedAt.getTime() - coveredUntil.getTime() >= rolling.refreshMs : coveredUntil < newest.capturedAt));

      if (!stale) return;

      const frames = await this.framesOf(camera.id, startsAt, endsAt, rolling.frameIntervalMs);
      const quality = this.entitlement.allowedQuality(camera, 'hd');
      await this.encode(camera, frames, { quality, watermark: this.entitlement.watermarks(camera), compose: null }, async path => {
        // The film it replaces goes first: `media` is unique on camera, kind,
        // window and instant, and its delete hook takes the old bytes with it.
        if (existing) await this.media.delete(existing.id);

        await this.media.storeFile(
          {
            kind: 'timelapse',
            mime: 'video/mp4',
            cameraId: camera.id,
            capturedAt: startsAt,
            endsAt: frames[frames.length - 1]?.capturedAt ?? null,
            window: rolling.window,
            quality,
            lengthSeconds: Math.round(frames.length / FRAME_RATE),
          },
          path,
        );
      });
    }
  }

  // -------------------------------------------------------------------------
  // What somebody asked for
  // -------------------------------------------------------------------------

  /**
   * The renders that are waiting. A row is queued by the route and drained here,
   * so the request answers at once and the person polls the row.
   */
  private async drainTheQueue(): Promise<void> {
    for (const job of await this.media.queued(RENDERS_PER_PASS)) {
      if (this.work.isStopped) return;
      await this.render(job);
    }
  }

  private async render(job: MediaDocument): Promise<void> {
    // Queued is a render's own status, so both are there; a camera deleted since
    // the request is the one thing that can be missing.
    const queued = job.render;
    const camera = job.cameraId ? await this.cameras.byId(job.cameraId) : null;
    if (!queued) return;
    if (!camera) {
      await this.media.setRender(job.id, { ...queued, status: 'failed', endedAt: new Date(), error: 'the camera this was asked of is gone' });
      return;
    }

    // Every later write carries the instant this one set, because each of them
    // replaces the whole object: rebuilding it from the queued row would take
    // back the moment the render started.
    const render = { ...queued, startedAt: new Date(), error: null };
    await this.media.setRender(job.id, { ...render, status: 'rendering' });

    const endsAt = job.endsAt ?? new Date();
    const span = { startsAt: job.capturedAt, endsAt };
    // Enough frames for a film of a sensible length, however long the span is.
    const frameInterval = Math.max(Math.round((endsAt.getTime() - job.capturedAt.getTime()) / (render.framesPerSecond * 60)), 1000);

    try {
      const quality = job.quality ?? 'sd';
      const overlays = render.overlays;
      const context = await this.context.contextFor(camera, span, {
        dayCounter: overlays.dayCounter,
        climate: overlays.climate,
        captions: overlays.entries,
        // Leaving the dark frames out is what reads the light output; a film
        // that keeps them asks for nothing.
        light: !render.includeLightsOff,
      });

      const all = await this.framesOf(camera.id, span.startsAt, endsAt, frameInterval);
      const frames = render.includeLightsOff ? all : all.filter(frame => !wasDark(frame.capturedAt, context.light));
      const beside = render.secondCameraId ? await this.framesOf(render.secondCameraId, span.startsAt, endsAt, 0) : [];

      const built = await this.encode(
        camera,
        frames,
        {
          quality,
          watermark: render.watermark,
          framesPerSecond: render.framesPerSecond,
          size: sizeFor(render.aspect, quality),
          // A frame is only drawn on where something was asked for; a plain
          // film of one camera keeps the path that copies bytes and nothing else.
          compose:
            overlays.dayCounter || overlays.climate || overlays.entries || render.secondCameraId !== null
              ? {
                  beside: render.secondCameraId === null ? null : beside,
                  layer: (frame: OverlayFrame) => overlayLayer(frame, overlays, context),
                  tolerance: frameInterval,
                }
              : null,
        },
        path => this.media.fill(job.id, path, { lengthSeconds: Math.round(frames.length / render.framesPerSecond) }),
      );

      await this.media.setRender(job.id, {
        ...render,
        status: built ? 'ready' : 'failed',
        endedAt: new Date(),
        error: built ? null : 'there are not enough pictures in that span to make a film',
      });
    } catch (e) {
      await this.media.setRender(job.id, { ...render, status: 'failed', endedAt: new Date(), error: String((e as Error)?.message ?? e) });
    }
  }

  // -------------------------------------------------------------------------
  // Frames and ffmpeg
  // -------------------------------------------------------------------------

  /** The stills of a span, no closer together than `minIntervalMs`, oldest first. */
  private async framesOf(cameraId: string, from: Date, before: Date, minIntervalMs: number): Promise<MediaPosition[]> {
    const frames: MediaPosition[] = [];
    let lastKept = -Infinity;

    for await (const still of this.media.positions({ cameraId, kind: 'still', from, before })) {
      if (still.capturedAt.getTime() - lastKept < minIntervalMs) continue;

      lastKept = still.capturedAt.getTime();
      frames.push(still);
    }

    return frames;
  }

  /**
   * Encode the frames and hand the finished file to `store`. Frames and film
   * stay on disk from beginning to end - a day of full-resolution stills is tens
   * of megabytes as a film and far more as frames, and neither the store nor
   * ffmpeg needs any of it in memory. Answers whether a film was produced.
   */
  private async encode(
    camera: CameraDocument,
    frames: MediaPosition[],
    options: EncodeOptions,
    store: (path: string) => Promise<void>,
  ): Promise<boolean> {
    if (frames.length < MINIMUM_FRAMES) return false;

    const directory = await mkdtemp(join(tmpdir(), `timelapse-${camera.id}-`));
    const film = join(directory, 'result.mp4');

    try {
      let written = 0;
      for (const frame of frames) {
        try {
          await this.writeFrame(frame, options, join(directory, `${written + 1}.jpeg`));
          written++;
        } catch (e) {
          logger.error(`Skipping frame ${frame.id} of camera ${camera.id}: ${e}`);
        }
      }

      if (written < MINIMUM_FRAMES) return false;

      const watermark = options.watermark ? await this.drawWatermark(directory) : null;
      await this.runFfmpeg(directory, film, { ...options, watermark });
      await store(film);
      return true;
    } catch (e) {
      logger.error(`Could not build a timelapse for camera ${camera.id}: ${e}`);
      return false;
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(e => logger.error(`Could not clean up ${directory}: ${e}`));
    }
  }

  /**
   * One frame on disk. A plain film copies the bytes across and nothing else,
   * which is what keeps the three rolling films cheap; a composed one is drawn
   * - the second camera beside it, the overlays on top - and written out at the
   * size the whole film is rendered at.
   */
  private async writeFrame(frame: MediaPosition, options: EncodeOptions, path: string): Promise<void> {
    const compose = options.compose;
    if (!compose) {
      await this.media.copyToFile(frame.id, path);
      return;
    }

    const beside = compose.beside === null ? undefined : nearestFrame(frame.capturedAt, compose.beside, compose.tolerance);
    const tiles = [
      await this.media.download(frame.id),
      ...(beside === undefined ? [] : [beside === null ? null : await this.media.download(beside.id)]),
    ];

    await composeFrame(tiles, options.size ?? sizeFor(DEFAULT_ASPECT, options.quality), compose.layer, frame.capturedAt, path);
  }

  private runFfmpeg(directory: string, film: string, options: FfmpegOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        'ffmpeg',
        [
          '-loglevel',
          'error',
          '-threads',
          '1',
          '-y',
          '-framerate',
          String(options.framesPerSecond ?? FRAME_RATE),
          '-f',
          'image2',
          '-i',
          `${directory}/%d.jpeg`,
          ...(options.watermark ? ['-i', options.watermark] : []),
          ...filterArguments(options),
          '-f',
          'mp4',
          '-vcodec',
          'libx265',
          '-crf',
          '30',
          film,
        ],
        { timeout: 15 * 60_000, maxBuffer: 50 * 1024 * 1024, encoding: 'buffer' },
        (error, _stdout, stderr) => {
          if (error) {
            logger.error(`Error encoding a timelapse: ${error} ${stderr}`);
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * The mark a free render carries, as a picture rather than as drawn text:
   * ffmpeg's text filter needs a font and a build that has freetype in it, and
   * an overlay needs neither.
   */
  private async drawWatermark(directory: string): Promise<string> {
    const path = join(directory, 'watermark.png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="56">
      <rect width="100%" height="100%" rx="10" fill="rgb(13,14,18)" fill-opacity="0.55"/>
      <text x="180" y="28" text-anchor="middle" dominant-baseline="central"
            font-family="DejaVu Sans, sans-serif" font-size="26" fill="#f3f5f8">terpcontrol.com</text>
    </svg>`;

    await writeFile(path, await sharp(Buffer.from(svg)).png().toBuffer());
    return path;
  }

  // -------------------------------------------------------------------------
  // Thinning and retention
  // -------------------------------------------------------------------------

  private async thin(camera: CameraDocument): Promise<void> {
    const now = Date.now();

    for (let tier = 0; tier < THINNING_TIERS.length; tier++) {
      const { afterMs, minIntervalMs } = THINNING_TIERS[tier];
      const coarser = THINNING_TIERS[tier + 1];
      await this.thinRange(camera.id, new Date(coarser ? now - coarser.afterMs : 0), new Date(now - afterMs), minIntervalMs);
    }
  }

  private async thinRange(cameraId: string, from: Date, before: Date, minIntervalMs: number): Promise<void> {
    let lastKept = -Infinity;
    let doomed: string[] = [];

    for await (const still of this.media.positions({ cameraId, kind: 'still', from, before })) {
      if (still.capturedAt.getTime() - lastKept < minIntervalMs) {
        doomed.push(still.id);
        if (doomed.length >= 500) {
          await this.media.deleteMany(doomed);
          doomed = [];
        }
        continue;
      }
      lastKept = still.capturedAt.getTime();
    }

    await this.media.deleteMany(doomed);
  }

  /**
   * What is old enough to go. Every install sweeps stills at three years, which
   * is what this server has always done. A free camera's shorter windows are a
   * switch of their own and apply only where an install has turned them on and
   * said how many days - so an install that says nothing keeps every picture
   * exactly as long as it did before there was a tier at all.
   */
  private async sweep(camera: CameraDocument): Promise<void> {
    const free = this.entitlement.freeRetention();
    const entitled = this.entitlement.isEntitled(camera);

    const stillDays = !entitled && free && free.stillDays > 0 ? Math.min(free.stillDays, STILL_RETENTION_DAYS) : STILL_RETENTION_DAYS;
    await this.deleteBefore(camera.id, 'still', stillDays);

    if (!entitled && free && free.timelapseDays > 0) {
      await this.deleteBefore(camera.id, 'timelapse', free.timelapseDays);
    }
  }

  private async deleteBefore(cameraId: string, kind: 'still' | 'timelapse', days: number): Promise<void> {
    let doomed: string[] = [];

    for await (const row of this.media.positions({ cameraId, kind, before: new Date(Date.now() - days * MS_IN_A_DAY) })) {
      doomed.push(row.id);
      if (doomed.length >= 500) {
        await this.media.deleteMany(doomed);
        doomed = [];
      }
    }

    await this.media.deleteMany(doomed);
  }
}

/**
 * How the frames are put together: brought to the shape the film was asked for
 * where one was, scaled where the render is not HD, and with the mark laid over
 * the result rather than over the frames - so one mark keeps its size whatever
 * the film was scaled to.
 *
 * The shape is a fill rather than a fit: a reel of a 16:9 camera is the middle
 * of the picture, not the picture with two black bars, because that is what the
 * person who picked 9:16 was looking at.
 */
const filterArguments = (options: FfmpegOptions): string[] => {
  const scale = options.size
    ? `scale=${options.size.width}:${options.size.height}:force_original_aspect_ratio=increase,crop=${options.size.width}:${options.size.height}`
    : options.quality === 'hd'
      ? null
      : `scale=${SD_WIDTH}:-2`;
  const overlay = 'overlay=W-w-24:H-h-24';

  if (!options.watermark) return scale ? ['-vf', scale] : [];

  return ['-filter_complex', scale ? `[0:v]${scale}[base];[base][1:v]${overlay}` : `[0:v][1:v]${overlay}`];
};

/** The nearest picture of the camera shown beside this one, or null where it took none that close. */
const nearestFrame = (at: Date, frames: readonly MediaPosition[], toleranceMs: number): MediaPosition | null => {
  let best: MediaPosition | null = null;
  let distance = Math.max(toleranceMs, 1000);

  for (const frame of frames) {
    const apart = Math.abs(frame.capturedAt.getTime() - at.getTime());
    if (apart <= distance) {
      best = frame;
      distance = apart;
    }
  }

  return best;
};
