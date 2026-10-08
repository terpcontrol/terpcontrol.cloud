import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MediaQuality, TimelapseCreate } from '@fg2/shared-types/v1';
import { RENDER_FAILURE_TEXT } from '@fg2/shared-types/v1-schemas';
import { logger } from '@utils/logger';
import { BackgroundWork } from '@common/background-work';
import { badRequest, unprocessable } from '@common/v1/problem';
import { Span } from '@common/v1/range';
import { isDuplicateKey } from '@database/duplicate-key';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { isRolling, periodAround, periodBefore, RollingWindow } from './film-periods';
import { CamerasService } from './cameras.service';
import { EntitlementService } from './entitlement.service';
import { runFfmpeg } from './ffmpeg';
import { MediaPosition, MediaService } from './media.service';
import { THINNING_TIERS } from './still-thinning';
import { TimelapseContextService } from './timelapse-context.service';
import {
  DEFAULT_ASPECT,
  DEFAULT_OVERLAYS,
  FrameSize,
  INK,
  OverlayFrame,
  PANEL,
  TEXT_FAMILY,
  composeFrame,
  overlayLayer,
  sizeFor,
  wasDark,
} from './timelapse-overlays';

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

/**
 * How long a film somebody just asked for waits before the queue is taken. The
 * builder's own beat is hourly, which is right for the rolling films and far
 * too slow for a person watching the job they started, so a render that is
 * queued wakes the drain; the hourly pass keeps its place either way.
 */
const QUEUE_WAKE_MS = 2000;
const THIN_INTERVAL_MS = MS_IN_A_DAY;

/** How many pictures a sweep removes in one round trip. */
const DELETE_BATCH = 500;

/** What a still is kept for when nothing says otherwise, which is what this server has always kept. */
const STILL_RETENTION_DAYS = 3 * 365;

/** What a film plays at unless it was asked for at another rate; a request at this rate is the plain film. */
const DEFAULT_FRAME_RATE = 25;

/** Half a second of film. Fewer frames than this is a flicker, not a timelapse. */
const MINIMUM_FRAMES = DEFAULT_FRAME_RATE / 2;

const DAY_FRAME_INTERVAL_MS = 2 * 60 * 1000;

/**
 * The three rolling films. The weekly and monthly ones cover far more frames
 * than the daily one, so rebuilding them every time a single new still arrives
 * wastes CPU for little visible benefit: each is only rebuilt once enough new
 * frames have arrived since the last rebuild.
 */
const ROLLING: { window: RollingWindow; frameIntervalMs: number; refreshMs: number }[] = [
  { window: 'day', frameIntervalMs: DAY_FRAME_INTERVAL_MS, refreshMs: 60 * 60 * 1000 },
  { window: 'week', frameIntervalMs: 7 * DAY_FRAME_INTERVAL_MS, refreshMs: 4 * 60 * 60 * 1000 },
  { window: 'month', frameIntervalMs: 30 * DAY_FRAME_INTERVAL_MS, refreshMs: 12 * 60 * 60 * 1000 },
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
  // The hourly pass and a film somebody just asked for both drain the queue,
  // and a job read by both would be rendered twice.
  private draining = false;
  private readonly work = new BackgroundWork();

  constructor(
    private readonly cameras: CamerasService,
    private readonly media: MediaService,
    private readonly entitlement: EntitlementService,
    private readonly context: TimelapseContextService,
  ) {}

  public onModuleInit(): void {
    this.work.loop('The timelapse builder', () => this.pass(), 60_000, BUILD_INTERVAL_MS);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the timelapse builder');
    this.work.stop();
  }

  /** A film was asked for: the queue is taken now rather than on the next hourly pass. */
  public renderQueued(): void {
    this.work.schedule('A film somebody asked for', () => this.drainTheQueue(), QUEUE_WAKE_MS);
  }

  private async pass(): Promise<void> {
    // What somebody is waiting for goes first; the rolling films are nobody's
    // stopwatch.
    await this.drainTheQueue();

    const shouldThin = Date.now() - this.lastThinningRun >= THIN_INTERVAL_MS;

    for (const camera of await this.cameras.all()) {
      // As in the poller: a pass walks every camera and runs ffmpeg as it
      // goes, so it has to notice the server stopping around it.
      if (this.work.isStopped) break;

      if (camera.removedAt === null) {
        const zone = await this.cameras.zoneOf(camera);
        for (const rolling of ROLLING) {
          await this.buildRolling(camera, rolling, zone);
        }
      }

      // A camera that is gone keeps its pictures, so they are still thinned
      // and still swept: what stops is only the making of new films.
      await this.sweep(camera);
      if (shouldThin) await this.thin(camera);
    }

    if (shouldThin) this.lastThinningRun = Date.now();
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
  private async buildRolling(camera: CameraDocument, rolling: (typeof ROLLING)[number], zone: string | null): Promise<void> {
    const open = periodAround(rolling.window, new Date(), zone);

    for (let period = open; ; period = periodBefore(rolling.window, period, zone)) {
      if (this.work.isStopped) return;

      const { startsAt, endsAt } = period;
      const existing = await this.media.newest({ cameraId: camera.id, kind: 'timelapse', window: rolling.window, from: startsAt, before: endsAt });
      const [newest] = await this.media.latestPositions({ cameraId: camera.id, kind: 'still', from: startsAt, before: endsAt }, 1);
      if (!newest) return;

      // A film stored without the instant of its last frame is left alone:
      // there is nothing to compare against. One whose end still lies ahead was
      // asked for before the span was over and covers what was there when it
      // was rendered.
      const coveredUntil = existing ? coveredBy(existing) : null;
      const isOpen = period === open;
      const stale =
        !existing ||
        (coveredUntil !== null &&
          (isOpen ? newest.capturedAt.getTime() - coveredUntil.getTime() >= rolling.refreshMs : coveredUntil < newest.capturedAt));

      if (!stale) return;

      const frames = await this.framesOf(camera.id, startsAt, endsAt, rolling.frameIntervalMs);
      // HD is entitled; a free camera renders at the resolution it always has.
      const quality = this.entitlement.isEntitled(camera) ? 'hd' : 'sd';
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
            lengthSeconds: Math.round(frames.length / DEFAULT_FRAME_RATE),
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
   * A film of a span somebody asked for: the one already there when it is the
   * same film and still current, otherwise a render queued for the builder.
   * `beside` decides the camera shown beside this one, and is asked only once
   * the span and what the film may cost have been decided.
   */
  public async request(
    camera: CameraDocument,
    body: TimelapseCreate,
    beside: () => Promise<string | null>,
  ): Promise<{ film: MediaDocument; queued: boolean }> {
    const span = spanOf(body, await this.cameras.zoneOf(camera));
    const entitled = this.entitlement.isEntitled(camera);

    // Refused rather than quietly rendered smaller: somebody who asked for HD
    // and was handed SD without a word would think that is what HD looks like.
    if (body.quality === 'hd' && !entitled) {
      throw badRequest('needs_entitlement', 'Rendering in HD is part of Premium. Without it the film is rendered at the standard size.');
    }
    if (body.window === 'grow' && !entitled) {
      throw badRequest('needs_entitlement', 'A film of a whole grow is part of Premium.');
    }

    const secondCameraId = await beside();
    const render: MediaDocument['render'] = {
      status: 'queued',
      framesPerSecond: body.framesPerSecond ?? DEFAULT_FRAME_RATE,
      watermark: this.entitlement.watermarks(camera),
      aspect: body.aspect ?? DEFAULT_ASPECT,
      overlays: { ...DEFAULT_OVERLAYS, ...(body.overlays ?? {}) },
      includeLightsOff: body.includeLightsOff ?? false,
      secondCameraId,
      startedAt: null,
      endedAt: null,
      error: null,
    };

    const quality = body.quality ?? 'sd';
    const composed = isComposed(render, quality);
    const window = composed && isRolling(body.window) ? 'custom' : body.window;

    // `media` is unique on camera, kind, window and instant, so the film of this
    // very span either exists or is about to be the only one.
    const ofThisSpan = { cameraId: camera.id, kind: 'timelapse' as const, window, range: { startsAt: span.startsAt, endsAt: span.startsAt } };
    const existing = await this.media.newest(ofThisSpan);

    // A span that is still going - today, this week - is filmed up to its last
    // picture, so the film of it is the one asked for while it still reaches
    // the newest picture; once the camera has gone on, a tap films the rest.
    const open = span.endsAt.getTime() > Date.now();
    const current = existing !== null && (!open || (await this.reachesTheNewest(existing, camera.id, span)));

    if (existing && current && (!composed || sameFilm(existing, render, quality, open ? null : span.endsAt))) {
      return { film: existing, queued: false };
    }

    if (existing) await this.media.delete(existing.id);

    // Two taps on the same button are two requests, and the second may reach
    // the read above before the first has written its row. The index is what
    // decides which of them makes the film; the one it turns away answers the
    // row that won, which is what asking for a film that exists answers anyway.
    let queued: MediaDocument;
    try {
      queued = await this.media.queue({
        kind: 'timelapse',
        mime: 'video/mp4',
        cameraId: camera.id,
        capturedAt: span.startsAt,
        endsAt: span.endsAt,
        window,
        quality,
        render,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      const won = await this.media.newest(ofThisSpan);
      if (!won) throw error;

      return { film: won, queued: false };
    }

    // The builder's own pass is hourly; a film somebody is waiting for is taken
    // from the queue at once, so the job on their screen starts rather than
    // sitting in `queued` for the rest of the hour.
    this.renderQueued();
    return { film: queued, queued: true };
  }

  /**
   * Whether a film of a span still going covers it up to its newest picture, or
   * nearly - a film being made is the one asked for, and a ready one stays it
   * for a few minutes of pictures, so a second tap does not render again.
   */
  private async reachesTheNewest(film: MediaDocument, cameraId: string, span: Span): Promise<boolean> {
    if (film.render?.status === 'queued' || film.render?.status === 'rendering') return true;

    const [newest] = await this.media.latestPositions({ cameraId, kind: 'still', from: span.startsAt, before: span.endsAt }, 1);
    const covered = coveredBy(film);
    return !newest || (covered !== null && newest.capturedAt.getTime() - covered.getTime() < STILL_FRESH_FILM_MS);
  }

  /**
   * The renders that are waiting. A row is queued by `request` and drained here,
   * so the route answers at once and the person polls the row.
   */
  private async drainTheQueue(): Promise<void> {
    if (this.draining) return;

    this.draining = true;
    try {
      for (const job of await this.media.queued(RENDERS_PER_PASS)) {
        if (this.work.isStopped) return;
        await this.render(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async render(job: MediaDocument): Promise<void> {
    // Queued is a render's own status, so both are there; a camera deleted since
    // the request is the one thing that can be missing.
    const queued = job.render;
    const camera = job.cameraId ? await this.cameras.byId(job.cameraId) : null;
    if (!queued) return;
    if (!camera) {
      await this.media.setRender(job.id, { ...queued, status: 'failed', endedAt: new Date(), error: RENDER_FAILURE_TEXT.cameraGone });
      return;
    }

    // Every later write carries the instant this one set, because each of them
    // replaces the whole object: rebuilding it from the queued row would take
    // back the moment the render started.
    const render = { ...queued, startedAt: new Date(), error: null };
    await this.media.setRender(job.id, { ...render, status: 'rendering' });

    const endsAt = job.endsAt ?? new Date();
    const span = { startsAt: job.capturedAt, endsAt };
    const open = endsAt.getTime() > Date.now();
    // Enough frames for a film of a sensible length, however long the span is.
    const frameInterval = Math.max(Math.round((endsAt.getTime() - job.capturedAt.getTime()) / (render.framesPerSecond * 60)), 1000);

    try {
      const quality = job.quality ?? 'sd';
      const overlays = render.overlays;
      const context = {
        ...(await this.context.contextFor(camera, span, {
          dayCounter: overlays.dayCounter,
          climate: overlays.climate,
          captions: overlays.entries,
          // Leaving the dark frames out is what reads the light output; a film
          // that keeps them asks for nothing.
          light: !render.includeLightsOff,
        })),
        language: overlays.dayCounter ? await this.cameras.languageOf(camera) : undefined,
      };

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
        path =>
          this.media.fill(job.id, path, {
            lengthSeconds: Math.round(frames.length / render.framesPerSecond),
            // A film of a span still going ends at its last frame, as the
            // rolling ones do: that is what lets the hourly pass carry a day
            // film asked for this morning on into the evening, and a later tap
            // ask for the rest, instead of both reading the day as done.
            ...(open && frames.length > 0 ? { endsAt: frames[frames.length - 1].capturedAt } : {}),
          }),
      );

      await this.media.setRender(job.id, {
        ...render,
        status: built ? 'ready' : 'failed',
        endedAt: new Date(),
        error: built ? null : whyNoFilm(all.length, frames.length),
      });
      if (built && job.window === 'grow') await this.context.attachGrowFilm(camera, span, job.id);
    } catch (e) {
      await this.media.setRender(job.id, { ...render, status: 'failed', endedAt: new Date(), error: String((e as Error)?.message ?? e) });
    }
  }

  // -------------------------------------------------------------------------
  // Frames and ffmpeg
  // -------------------------------------------------------------------------

  /** The stills of a span, no closer together than `minIntervalMs`, oldest first. */
  private async framesOf(cameraId: string, from: Date, before: Date, minIntervalMs: number): Promise<MediaPosition[]> {
    const kept = spacedBy(minIntervalMs);
    const frames: MediaPosition[] = [];

    for await (const still of this.media.positions({ cameraId, kind: 'still', from, before })) {
      if (kept(still)) frames.push(still);
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
      await this.writeFilm(directory, film, { ...options, watermark });
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

  private async writeFilm(directory: string, film: string, options: FfmpegOptions): Promise<void> {
    const { error, stderr } = await runFfmpeg(
      [
        '-framerate',
        String(options.framesPerSecond ?? DEFAULT_FRAME_RATE),
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
      { loglevel: 'error', timeoutMs: 15 * 60_000, maxBuffer: 50 * 1024 * 1024 },
    );
    if (error) {
      logger.error(`Error encoding a timelapse: ${error} ${stderr}`);
      throw error;
    }
  }

  /**
   * The mark a free render carries, as a picture rather than as drawn text:
   * ffmpeg's text filter needs a font and a build that has freetype in it, and
   * an overlay needs neither. It is set on the overlays' own plate, in their
   * ink and their face, so the mark reads as part of the same film.
   */
  private async drawWatermark(directory: string): Promise<string> {
    const path = join(directory, 'watermark.png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="56">
      <rect width="100%" height="100%" rx="10" fill="${PANEL}" fill-opacity="0.55"/>
      <text x="180" y="28" text-anchor="middle" dominant-baseline="central"
            font-family="${TEXT_FAMILY}" font-size="26" font-weight="600" fill="${INK}">terpcontrol.com</text>
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

  private thinRange(cameraId: string, from: Date, before: Date, minIntervalMs: number): Promise<void> {
    const kept = spacedBy(minIntervalMs);
    return this.removeInBatches(
      this.media.positions({ cameraId, kind: 'still', from, before }),
      still => !kept(still),
      ids => this.removeThinned(ids),
    );
  }

  /**
   * The stills a tier has thinned away, minus the ones the migration carried
   * over and the previous release still holds a row for.
   *
   * These tiers are new. The release before them kept every still it ever took,
   * so the first pass after an upgrade meets years of pictures at thirty-second
   * spacing and applies all four tiers to the lot - and the bytes it frees are
   * the only copy, because the first migration moved them out of the document
   * and the rollback deliberately does not move them back. Whether history
   * somebody already has should be thinned at all is a decision for the release
   * that drops `legacy_*`; until then it is left alone.
   */
  private async removeThinned(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const held = await this.media.carriedOverAndStillHeld(ids);
    await this.media.deleteMany(ids.filter(id => !held.has(id)));
  }

  /**
   * What is old enough to go. Every install sweeps stills at three years, which
   * is what this server has always done. A free camera's shorter windows are a
   * switch of their own and apply only where an install has turned them on and
   * said how many days - so an install that says nothing keeps every picture
   * exactly as long as it did before there was a tier at all.
   */
  private async sweep(camera: CameraDocument): Promise<void> {
    const free = this.entitlement.isEntitled(camera) ? null : this.entitlement.freeTier();

    const stillDays = free?.stillDays ? Math.min(free.stillDays, STILL_RETENTION_DAYS) : STILL_RETENTION_DAYS;
    await this.deleteBefore(camera.id, 'still', stillDays);

    if (free?.timelapseDays) await this.deleteBefore(camera.id, 'timelapse', free.timelapseDays);
  }

  private deleteBefore(cameraId: string, kind: 'still' | 'timelapse', days: number): Promise<void> {
    return this.removeInBatches(
      this.media.positions({ cameraId, kind, before: new Date(Date.now() - days * MS_IN_A_DAY) }),
      () => true,
      ids => this.media.deleteMany(ids),
    );
  }

  /** The rows `doomed` picks, handed to `remove` a batch at a time. */
  private async removeInBatches(
    rows: AsyncIterable<MediaPosition>,
    doomed: (row: MediaPosition) => boolean,
    remove: (ids: string[]) => Promise<void>,
  ): Promise<void> {
    let batch: string[] = [];

    for await (const row of rows) {
      if (!doomed(row)) continue;

      batch.push(row.id);
      if (batch.length >= DELETE_BATCH) {
        await remove(batch);
        batch = [];
      }
    }

    await remove(batch);
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

/**
 * Up to when a film covers its span. A film asked for before its span was over
 * and rendered before that fix carried the end of the span as its end, and
 * covers what there was when it was rendered.
 */
const coveredBy = (film: Pick<MediaDocument, 'endsAt' | 'render'>): Date | null => {
  if (film.endsAt === null || film.endsAt <= new Date()) return film.endsAt;
  return film.render?.status === 'ready' ? (film.render.endedAt ?? null) : null;
};

/**
 * Which span was meant. `day`, `week` and `month` are worked out around the
 * instant given, and default to the most recent complete one; a phase, a whole
 * grow and a range somebody drew each read both ends, because where a phase or
 * a grow began is the client's to say.
 */
const spanOf = (body: TimelapseCreate, zone: string | null): Span => {
  if (!isRolling(body.window)) {
    if (!body.startsAt || !body.endsAt) {
      throw badRequest('span_missing', 'A film of a phase, a whole grow or a span of your choosing needs both ends of it.');
    }

    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) throw unprocessable('span_backwards', 'A film ends after it begins.');

    return { startsAt, endsAt };
  }

  // Cut on the owner's calendar, exactly as the builder cuts the films it keeps,
  // so a film asked for here is the same span as the one already on the list.
  return body.startsAt
    ? periodAround(body.window, new Date(body.startsAt), zone)
    : periodBefore(body.window, periodAround(body.window, new Date(), zone), zone);
};

/** Whether anything was asked for beyond the plain film of that span. */
const isComposed = (render: NonNullable<MediaDocument['render']>, quality: MediaQuality): boolean =>
  render.secondCameraId !== null ||
  render.overlays.dayCounter ||
  render.overlays.climate ||
  render.overlays.entries ||
  render.includeLightsOff ||
  render.aspect !== DEFAULT_ASPECT ||
  render.framesPerSecond !== DEFAULT_FRAME_RATE ||
  quality !== 'sd';

/** How many minutes of new pictures a film of today may lag behind before a tap renders it again. */
const STILL_FRESH_FILM_MS = 10 * 60 * 1000;

/** Whether the film that is already there is the one being asked for; a span still going is compared without its end. */
const sameFilm = (existing: MediaDocument, render: NonNullable<MediaDocument['render']>, quality: MediaQuality, endsAt: Date | null): boolean => {
  const was = existing.render;

  return (
    was !== null &&
    was.status !== 'failed' &&
    (existing.quality ?? 'sd') === quality &&
    (endsAt === null || existing.endsAt?.getTime() === endsAt.getTime()) &&
    was.framesPerSecond === render.framesPerSecond &&
    was.aspect === render.aspect &&
    was.includeLightsOff === render.includeLightsOff &&
    was.secondCameraId === render.secondCameraId &&
    was.overlays.dayCounter === render.overlays.dayCounter &&
    was.overlays.climate === render.overlays.climate &&
    was.overlays.entries === render.overlays.entries
  );
};

/**
 * Why a render produced no film, told from what it had to work with: how many
 * stills the span held and how many of them were still there once the frames
 * taken in the dark had been dropped.
 *
 * It used to be one sentence for all three, and the sentence was the one about
 * a span holding too few pictures. A tent whose light output reads zero all
 * night makes every frame of it dark, so the one-tap films of such a camera are
 * emptied by that filter and were then reported as spans with nothing in them -
 * ten lines under the page's own "27 pictures today", and with no mention of
 * the switch that would have kept them. Naming the filter is the whole point:
 * it is the one cause of the three the person reading can do something about.
 */
export const whyNoFilm = (stills: number, frames: number): string => {
  if (frames >= MINIMUM_FRAMES) return RENDER_FAILURE_TEXT.encodeFailed;
  if (stills >= MINIMUM_FRAMES) return RENDER_FAILURE_TEXT.allDark;

  return RENDER_FAILURE_TEXT.tooFew;
};

/** Whether a still, walked oldest first, is kept when no two kept ones may lie closer than `minIntervalMs`. */
const spacedBy = (minIntervalMs: number): ((still: MediaPosition) => boolean) => {
  let lastKept = -Infinity;

  return still => {
    if (still.capturedAt.getTime() - lastKept < minIntervalMs) return false;

    lastKept = still.capturedAt.getTime();
    return true;
  };
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
