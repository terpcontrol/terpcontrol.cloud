import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  Camera,
  CameraCreate,
  CameraUpdate,
  MediaPage,
  MediaQuality,
  MediaWindow,
  TestCaptureAnswer,
  TimelapseAccepted,
  TimelapseCreate,
} from '@fg2/shared-types/v1';
import {
  camera,
  cameraCreate,
  cameraPage,
  cameraUpdate,
  mediaPage,
  testCaptureAnswer,
  timelapseAccepted,
  timelapseCreate,
} from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { V1Body } from '@common/zod-validation.pipe';
import { AccessGuard, Caller, CurrentGrant, Requires } from '@common/v1/access.guard';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { badRequest, notFound, unprocessable } from '@common/v1/problem';
import { clampRange } from '@common/v1/range';
import { V1Query, pageQuery } from '@common/v1/validation';
import { terpCamConfig } from '@config/configuration';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CamerasService } from './cameras.service';
import { CameraPollerService } from './camera-poller.service';
import { CaptureService } from './capture.service';
import { EntitlementService } from './entitlement.service';
import { MediaService } from './media.service';
import { TimelapseService } from './timelapse.service';
import { OptionalSessionGuard } from './optional-session.guard';
import { DEFAULT_ASPECT, DEFAULT_OVERLAYS } from './timelapse-overlays';
import { V1Answer } from '../answer-shape';

/**
 * The cameras of a tent, and the pictures and films of one camera.
 *
 * A read is open to whoever the decision lets in - the owner, a member, a share
 * link that includes pictures - so those routes take a session if there is one
 * and nobody if there is not. Everything that changes a camera needs a session.
 */

/**
 * A query string carries a flag as text, so it is read as the two words it can
 * be - the same way `archived`, `done` and `open` are read next door.
 *
 * `z.coerce.boolean()` is `Boolean(value)` and a query string is never anything
 * but a string, so it answered true to `false`, to `0` and to `yes` alike: a
 * client that read the published contract, saw a boolean and sent
 * `includeRemoved=false` to leave the tombstones out was handed them. The enum
 * reads `false` as false and refuses anything that is neither with a problem
 * document, which is what a contract-reading client can act on.
 */
const cameraListQuery = pageQuery.extend({
  spaceId: z.string().optional(),
  deviceId: z.string().optional(),
  includeRemoved: z.enum(['true', 'false']).optional().describe('`true` lists the cameras that have been removed as well as the ones in use.'),
});

/** A span a client asks for, narrowed by the one the decision allows. */
const spanQuery = pageQuery.extend({
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

type SpanQuery = z.infer<typeof spanQuery>;

const DEFAULT_RENDER_FRAME_RATE = 25;

/** The pipeline asks a camera for a picture every 30 seconds at most, so a shorter interval is a promise it cannot keep. */
const MINIMUM_STILL_INTERVAL_SECONDS = 30;

@ApiTags('cameras')
@Controller('v1/cameras')
export class CamerasController {
  constructor(
    private readonly cameras: CamerasService,
    private readonly media: MediaService,
    private readonly capture: CaptureService,
    private readonly poller: CameraPollerService,
    private readonly builder: TimelapseService,
    private readonly entitlement: EntitlementService,
    private readonly access: AccessService,
    @Inject(terpCamConfig.KEY) private readonly terpCam: ConfigType<typeof terpCamConfig>,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The cameras this account can see' })
  @V1Answer(cameraPage)
  public list(@Caller() ctx: AccessContext, @V1Query(cameraListQuery) query: z.infer<typeof cameraListQuery>) {
    return this.cameras.list(ctx, { spaceId: query.spaceId, deviceId: query.deviceId, includeRemoved: query.includeRemoved === 'true' }, query);
  }

  /**
   * Creating a camera is managing the place it stands in, so the space it is put
   * in - or, for one a controller answers for, that controller - is what the
   * decision is made about. Whether an address answers is found out by the first
   * capture and never here.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Add a camera' })
  @V1Answer(camera, { status: HttpStatus.CREATED })
  public async create(@Caller() ctx: AccessContext, @V1Body(cameraCreate) body: CameraCreate): Promise<Camera> {
    // The model, the kind and the path to such a camera are all here, and the
    // path is the rendezvous the cloud finds a Terp Cam through. An install
    // that has none cannot reach one at all, so the tab says it is coming
    // rather than taking a camera it would never read a picture from.
    if (body.kind === 'terpcam_standalone' && this.terpCam.rendezvousHosts.length === 0) {
      throw badRequest('not_yet', 'Pairing a standalone Terp Cam is coming: this install has no rendezvous to find one through.');
    }

    const deviceId = body.kind === 'terpcam_standalone' ? null : (body.deviceId ?? null);
    if (deviceId) await this.access.require(ctx, subjectRef('device', deviceId), 'manage');
    if (body.kind === 'rtsp' && body.tunnel) await this.requireATunnel(deviceId);
    if (body.spaceId) await this.access.require(ctx, subjectRef('space', body.spaceId), 'manage');
    if (!deviceId && !body.spaceId) {
      throw badRequest('nowhere_to_put_it', 'A camera belongs to a space or to the controller that answers for it; name one of them.');
    }

    const owner = ctx.userId;
    if (owner === null) throw badRequest('no_account', 'A camera belongs to somebody, and this session is nobody.');

    // A controller pairs exactly one Terp Cam and reports it over MQTT, so this
    // body adopts the row that pairing already made rather than making a second.
    const paired = body.kind === 'terpcam_controller' ? await this.cameras.controllerCameraOf(body.deviceId) : null;
    const camera = paired ? await this.cameras.update(paired.id, settingsOf(body)) : await this.cameras.create(owner, body);
    if (!camera) throw notFound('camera_not_found', 'There is no camera with that id.');

    // Adopting a controller's paired camera answers a row this caller may not
    // own: a manager of somebody's tent may add a camera to it, and what comes
    // back is then still the host's.
    return this.cameras.serialise(camera, this.cameras.granteeOf(ctx, camera));
  }

  /**
   * One camera, as far as the caller's own window reaches. A link carries a
   * window, and when the camera last fired is a fact about now: a reader whose
   * fortnight closed in March is not told that the lens was still working in
   * September, exactly as the tent page refuses to tell them.
   */
  @Get(':id')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'camera')
  @ApiOperation({ summary: 'One camera' })
  @V1Answer(camera)
  public async read(@CurrentGrant() grant: Grant, @Param('id') id: string): Promise<Camera> {
    return this.cameras.serialise(await this.require(id), grant.grantee, new Date(), clampRange(grant));
  }

  /**
   * What the camera page edits: its name, what it is pointed at, which plants
   * it watches, how often it takes a picture, and the two switches that stop it
   * doing so. A stream is the one thing only an RTSP camera has, so naming one
   * on a Terp Cam is refused rather than stored where nothing would read it.
   *
   * A stream also carries the controller it is pulled through, and that follows
   * the tent: a camera moved to a place another controller stands in has to be
   * pulled through that one, so the screen that moves it sends both and this
   * route checks the pair is one the cloud could act on.
   */
  @Patch(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'camera')
  @ApiOperation({ summary: "Change a camera's settings" })
  @V1Answer(camera)
  public async update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(cameraUpdate) body: CameraUpdate): Promise<Camera> {
    const current = await this.require(id);

    // Moving a camera is managing two places, and the guard above has only
    // decided about the one it stands in.
    if (body.spaceId) await this.access.require(ctx, subjectRef('space', body.spaceId), 'manage');
    if (current.kind !== 'rtsp' && (namesAStream(body) || body.deviceId !== undefined)) {
      throw unprocessable('not_a_stream', 'This camera is a Terp Cam, which the cloud reaches by its own id rather than at a stream address.');
    }
    // Naming somebody else's controller would pull a stream through hardware
    // they never offered, so moving a camera onto one is managing that one too.
    if (body.deviceId) await this.access.require(ctx, subjectRef('device', body.deviceId), 'manage');
    // Either half of the pair decides the other, so both are judged together,
    // and only when this request is what changes them: a camera stored before
    // the pair was checked is not made unrenameable by it.
    if ((body.deviceId !== undefined || body.tunnel !== undefined) && (body.tunnel ?? current.tunnel)) {
      await this.requireATunnel(body.deviceId !== undefined ? body.deviceId : current.deviceId);
    }
    if (body.stillIntervalSeconds !== undefined && body.stillIntervalSeconds < MINIMUM_STILL_INTERVAL_SECONDS) {
      throw unprocessable(
        'still_interval_too_short',
        `The pipeline asks a camera for a picture every ${MINIMUM_STILL_INTERVAL_SECONDS} seconds at most, so a shorter interval would not be kept.`,
      );
    }

    const updated = await this.cameras.update(id, body);
    if (!updated) throw notFound('camera_not_found', 'There is no camera with that id.');

    // The settings may be the ones that were failing, so it is tried again at once.
    this.poller.settingsChanged(id);
    return this.cameras.serialise(updated, this.cameras.granteeOf(ctx, updated));
  }

  /**
   * Taking a camera away leaves its pictures where they are: the row stays as a
   * tombstone so every still and every film it delivered keeps its link, and is
   * no longer listed or read from.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('own', 'camera')
  @ApiOperation({ summary: 'Take a camera away' })
  @ApiNoContentResponse({ description: 'The camera is no longer listed or read from; its pictures keep their link to it.' })
  public async remove(@Param('id') id: string): Promise<void> {
    await this.cameras.remove(id);
    this.poller.forget(id);
  }

  /**
   * One picture, now, so that whoever is setting a camera up learns whether it
   * answers at all. A camera that could not be read is reported in the answer
   * rather than as an error: a wrong address is an ordinary outcome of this
   * button, and the reason the camera gave is what the person needs to see.
   */
  @Post(':id/test-captures')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'camera')
  @ApiOperation({ summary: 'Read one picture from a camera to check its settings' })
  @V1Answer(testCaptureAnswer)
  public async testCapture(@Param('id') id: string): Promise<TestCaptureAnswer> {
    const camera = await this.cameras.withSecret(id);
    if (!camera) throw notFound('camera_not_found', 'There is no camera with that id.');

    try {
      // The button asks for a picture to look at right now, so a Terp Cam whose
      // direct path is unwell answers with the controller's smaller one rather
      // than with nothing.
      const still = await this.capture.readStill(camera, true);
      const capturedAt = new Date();
      const stored = await this.media.storeBytes({ kind: 'still', mime: 'image/jpeg', cameraId: camera.id, capturedAt }, still);
      await this.cameras.noteCapture(camera.id, capturedAt, null);

      return { succeeded: true, mediaId: stored.id, capturedAt: capturedAt.toISOString(), error: null };
    } catch (e) {
      const reason = String((e as Error)?.message ?? e).slice(0, 2000);
      await this.cameras.noteCapture(camera.id, null, reason);

      return { succeeded: false, mediaId: null, capturedAt: null, error: reason };
    }
  }

  @Get(':id/frames')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'camera')
  @ApiOperation({ summary: 'The stills of one camera, newest first' })
  @V1Answer(mediaPage)
  public frames(@Param('id') id: string, @V1Query(spanQuery) query: SpanQuery, @CurrentGrant() grant: Grant | undefined): Promise<MediaPage> {
    return this.media.page({ cameraId: id, kind: 'still', range: clampRange(grant, query) }, query);
  }

  @Get(':id/timelapses')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'camera')
  @ApiOperation({ summary: 'The films of one camera, newest first' })
  @V1Answer(mediaPage)
  public timelapses(@Param('id') id: string, @V1Query(spanQuery) query: SpanQuery, @CurrentGrant() grant: Grant | undefined): Promise<MediaPage> {
    return this.media.page({ cameraId: id, kind: 'timelapse', range: clampRange(grant, query) }, query);
  }

  /**
   * The composer. A span, one camera or two side by side, what is drawn over
   * the frames, whether the ones taken in the dark are in it, a shape and a
   * resolution - and a job, because a render is minutes of ffmpeg and does not
   * finish inside a request. The row comes back with `render.status: queued`
   * and is polled through `GET /media/{id}`.
   *
   * A camera keeps one film per span and window, so asking for the same film
   * twice answers the one that is there rather than making a second. Asking for
   * the same span composed differently is a different film of it and replaces
   * the composed one - a film is made again from frames that are still there,
   * and the alternative is refusing somebody the reel they just changed their
   * mind about. The rolling day, week and month the builder keeps by itself are
   * never replaced: a composed film of one of those spans is stored as the
   * range it covers.
   */
  @Post(':id/timelapses')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'camera')
  @ApiOperation({ summary: 'Ask for a film of a span' })
  @V1Answer(timelapseAccepted, {
    status: HttpStatus.ACCEPTED,
    description: 'Queued, and polled through `GET /media/{id}`. 200 where the film already exists.',
  })
  public async requestTimelapse(
    @Caller() ctx: AccessContext,
    @Param('id') id: string,
    @V1Body(timelapseCreate) body: TimelapseCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TimelapseAccepted> {
    const camera = await this.require(id);
    const span = spanOf(body);
    const entitled = this.entitlement.isEntitled(camera);

    // Refused rather than quietly rendered smaller: somebody who asked for HD
    // and was handed SD without a word would think that is what HD looks like.
    if (body.quality === 'hd' && !entitled) {
      throw badRequest('needs_entitlement', 'Rendering in HD is part of Premium. Without it the film is rendered at the standard size.');
    }
    if (body.window === 'grow' && !entitled) {
      throw badRequest('needs_entitlement', 'A film of a whole grow is part of Premium.');
    }

    const secondCameraId = await this.besideId(ctx, camera, body.secondCameraId);
    const render: MediaDocument['render'] = {
      status: 'queued',
      framesPerSecond: body.framesPerSecond ?? DEFAULT_RENDER_FRAME_RATE,
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
    const window = composed && ROLLING_WINDOWS.includes(body.window) ? 'custom' : body.window;

    // `media` is unique on camera, kind, window and instant, so the film of this
    // very span either exists or is about to be the only one.
    const existing = await this.media.newest({
      cameraId: id,
      kind: 'timelapse',
      window,
      range: { startsAt: span.startsAt, endsAt: span.startsAt },
    });

    if (existing && (!composed || sameFilm(existing, render, quality, span.endsAt))) {
      void reply.status(HttpStatus.OK);
      return { media: this.media.serialise(existing), queued: false };
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
        cameraId: id,
        capturedAt: span.startsAt,
        endsAt: span.endsAt,
        window,
        quality,
        render,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      const won = await this.media.newest({ cameraId: id, kind: 'timelapse', window, range: { startsAt: span.startsAt, endsAt: span.startsAt } });
      if (!won) throw error;

      void reply.status(HttpStatus.OK);
      return { media: this.media.serialise(won), queued: false };
    }

    // The builder's own pass is hourly; a film somebody is waiting for is taken
    // from the queue at once, so the job on their screen starts rather than
    // sitting in `queued` for the rest of the hour.
    this.builder.renderQueued();

    void reply.status(HttpStatus.ACCEPTED);
    return { media: this.media.serialise(queued), queued: true };
  }

  /**
   * The camera shown beside this one. It is looked at rather than written to,
   * so looking at it is what is asked of the caller - and it has to stand in
   * the same place, because "both, split" is the two cameras of one tent and
   * not a way to put somebody else's tent into this film.
   */
  private async besideId(ctx: AccessContext, camera: CameraDocument, secondCameraId: string | undefined): Promise<string | null> {
    if (!secondCameraId || secondCameraId === camera.id) return null;

    await this.access.require(ctx, subjectRef('camera', secondCameraId), 'view');
    const second = await this.cameras.byId(secondCameraId);
    if (!second || second.removedAt !== null) throw notFound('camera_not_found', 'There is no camera with that id.');
    if (second.spaceId !== camera.spaceId) {
      throw unprocessable('not_the_same_place', 'Two cameras are shown side by side when they stand in the same place.');
    }

    return second.id;
  }

  private async require(id: string) {
    const camera = await this.cameras.byId(id);
    if (!camera) throw notFound('camera_not_found', 'There is no camera with that id.');
    return camera;
  }

  /**
   * That a stream said to be pulled through a tunnel has one to be pulled
   * through. A camera may name a device without that: the device is then only
   * where it stands. A tunnel is a promise about the network, and the
   * controller is the only hardware that keeps it.
   */
  private async requireATunnel(deviceId: string | null | undefined): Promise<void> {
    if (!deviceId) throw unprocessable('tunnel_without_controller', 'A stream pulled through a tunnel needs the controller whose tunnel it is.');
    if (!(await this.cameras.carriesATunnel(deviceId))) {
      throw unprocessable('not_a_controller', 'Only a controller has a tunnel to pull a stream through.');
    }
  }
}

/** What a create body says about a camera that is already there: its settings, never its identity. */
const settingsOf = (body: CameraCreate): CameraUpdate => ({
  spaceId: body.spaceId,
  name: body.name,
  looksAt: body.looksAt,
  plantIds: body.plantIds,
  stillIntervalSeconds: body.stillIntervalSeconds,
  nightOff: body.nightOff,
  maintenanceOff: body.maintenanceOff,
  logErrors: body.logErrors,
  staleWarning: body.staleWarning,
});

/** The fields only an RTSP camera has; a Terp Cam is reached by its own id. */
const namesAStream = (body: CameraUpdate): boolean =>
  body.url !== undefined || body.transport !== undefined || body.tunnel !== undefined || body.model !== undefined;

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

const SPANS: Record<string, number> = { day: MS_IN_A_DAY, week: 7 * MS_IN_A_DAY, month: 30 * MS_IN_A_DAY };

/** The three the builder keeps by itself, which the composer never replaces. */
const ROLLING_WINDOWS: MediaWindow[] = ['day', 'week', 'month'];

/** What the unique index says when two requests raced for the same film. */
const isDuplicateKey = (error: unknown): boolean => (error as { code?: number } | null)?.code === 11000;

/**
 * Which span was meant. `day`, `week` and `month` are worked out around the
 * instant given, and default to the most recent complete one; a phase, a whole
 * grow and a range somebody drew each read both ends, because where a phase or
 * a grow began is the client's to say.
 */
const spanOf = (body: TimelapseCreate): { startsAt: Date; endsAt: Date } => {
  const span = SPANS[body.window];

  if (span === undefined) {
    if (!body.startsAt || !body.endsAt) {
      throw badRequest('span_missing', 'A film of a phase, a whole grow or a span of your choosing needs both ends of it.');
    }

    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) throw unprocessable('span_backwards', 'A film ends after it begins.');

    return { startsAt, endsAt };
  }

  const around = body.startsAt ? new Date(body.startsAt).getTime() : Date.now() - span;
  const startsAt = new Date(Math.floor(around / span) * span);

  return { startsAt, endsAt: new Date(startsAt.getTime() + span) };
};

/** Whether anything was asked for beyond the plain film of that span. */
const isComposed = (render: NonNullable<MediaDocument['render']>, quality: MediaQuality): boolean =>
  render.secondCameraId !== null ||
  render.overlays.dayCounter ||
  render.overlays.climate ||
  render.overlays.entries ||
  render.includeLightsOff ||
  render.aspect !== DEFAULT_ASPECT ||
  render.framesPerSecond !== DEFAULT_RENDER_FRAME_RATE ||
  quality !== 'sd';

/** Whether the film that is already there is the one being asked for. */
const sameFilm = (existing: MediaDocument, render: NonNullable<MediaDocument['render']>, quality: MediaQuality, endsAt: Date): boolean => {
  const was = existing.render;

  return (
    was !== null &&
    was.status !== 'failed' &&
    (existing.quality ?? 'sd') === quality &&
    existing.endsAt?.getTime() === endsAt.getTime() &&
    was.framesPerSecond === render.framesPerSecond &&
    was.aspect === render.aspect &&
    was.includeLightsOff === render.includeLightsOff &&
    was.secondCameraId === render.secondCameraId &&
    was.overlays.dayCounter === render.overlays.dayCounter &&
    was.overlays.climate === render.overlays.climate &&
    was.overlays.entries === render.overlays.entries
  );
};
