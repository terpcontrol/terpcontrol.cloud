import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Camera, CameraCreate, CameraUpdate, MediaPage, TestCaptureAnswer, TimelapseAccepted, TimelapseCreate } from '@fg2/shared-types/v1';
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
import { badRequest, notFound } from '@common/v1/problem';
import { clampRange } from '@common/v1/range';
import { V1Query, pageQuery } from '@common/v1/validation';
import { CamerasService } from './cameras.service';
import { CameraPollerService } from './camera-poller.service';
import { CaptureService } from './capture.service';
import { EntitlementService } from './entitlement.service';
import { MediaService } from './media.service';
import { OptionalSessionGuard } from './optional-session.guard';
import { V1Answer } from '../answer-shape';

/**
 * The cameras of a tent, and the pictures and films of one camera.
 *
 * A read is open to whoever the decision lets in - the owner, a member, a share
 * link that includes pictures - so those routes take a session if there is one
 * and nobody if there is not. Everything that changes a camera needs a session.
 */

const cameraListQuery = pageQuery.extend({
  spaceId: z.string().optional(),
  deviceId: z.string().optional(),
  includeRemoved: z.coerce.boolean().optional(),
});

/** A span a client asks for, narrowed by the one the decision allows. */
const spanQuery = pageQuery.extend({
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

type SpanQuery = z.infer<typeof spanQuery>;

const DEFAULT_RENDER_FRAME_RATE = 25;

@ApiTags('cameras')
@Controller('v1/cameras')
export class CamerasController {
  constructor(
    private readonly cameras: CamerasService,
    private readonly media: MediaService,
    private readonly capture: CaptureService,
    private readonly poller: CameraPollerService,
    private readonly entitlement: EntitlementService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The cameras this account can see' })
  @V1Answer(cameraPage)
  public list(@Caller() ctx: AccessContext, @V1Query(cameraListQuery) query: z.infer<typeof cameraListQuery>) {
    return this.cameras.list(ctx, query, query);
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
    if (body.kind === 'terpcam_standalone') {
      // The model, the kind and the path to such a camera are here; pairing one
      // is finished in its own session, because it needs a camera on a desk.
      throw badRequest('not_yet', 'Pairing a standalone Terp Cam is coming; the tab that would do it says so.');
    }

    const deviceId = body.deviceId ?? null;
    if (deviceId) await this.access.require(ctx, subjectRef('device', deviceId), 'manage');
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

    return this.cameras.serialise(camera);
  }

  @Get(':id')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'camera')
  @ApiOperation({ summary: 'One camera' })
  @V1Answer(camera)
  public async read(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<Camera> {
    return this.cameras.serialise(await this.require(id), ctx.isDemo);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'camera')
  @ApiOperation({ summary: 'Change a camera´s settings' })
  @V1Answer(camera)
  public async update(@Param('id') id: string, @V1Body(cameraUpdate) body: CameraUpdate): Promise<Camera> {
    const updated = await this.cameras.update(id, body);
    if (!updated) throw notFound('camera_not_found', 'There is no camera with that id.');

    // The settings may be the ones that were failing, so it is tried again at once.
    this.poller.settingsChanged(id);
    return this.cameras.serialise(updated);
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
   * Ask for a film of a span. A render does not finish inside the request, so
   * the row comes back with `render.status: queued` and is polled through
   * `GET /media/{id}`; asking twice for the same span answers the film that
   * already exists rather than making a second one, which is what `queued` and
   * the status code say apart.
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
    @Param('id') id: string,
    @V1Body(timelapseCreate) body: TimelapseCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TimelapseAccepted> {
    const camera = await this.require(id);
    const span = spanOf(body);
    const quality = this.entitlement.allowedQuality(camera, body.quality);

    // A whole grow is a span nobody watches in a rolling window, and it is the
    // one render the record puts behind entitlement outright.
    if (body.window === 'custom' && !this.entitlement.isEntitled(camera)) {
      throw badRequest('needs_entitlement', 'A film of a span of your choosing is part of Premium.');
    }

    // `media` is unique on camera, kind, window and instant, so the film of this
    // very span either exists or is about to be the only one.
    const existing = await this.media.newest({
      cameraId: id,
      kind: 'timelapse',
      window: body.window,
      range: { startsAt: span.startsAt, endsAt: span.startsAt },
    });
    if (existing) {
      void reply.status(HttpStatus.OK);
      return { media: this.media.serialise(existing), queued: false };
    }

    const queued = await this.media.queue({
      kind: 'timelapse',
      mime: 'video/mp4',
      cameraId: id,
      capturedAt: span.startsAt,
      endsAt: span.endsAt,
      window: body.window,
      quality,
      render: {
        status: 'queued',
        framesPerSecond: body.framesPerSecond ?? DEFAULT_RENDER_FRAME_RATE,
        watermark: this.entitlement.watermarks(camera),
        startedAt: null,
        endedAt: null,
        error: null,
      },
    });

    void reply.status(HttpStatus.ACCEPTED);
    return { media: this.media.serialise(queued), queued: true };
  }

  private async require(id: string) {
    const camera = await this.cameras.byId(id);
    if (!camera) throw notFound('camera_not_found', 'There is no camera with that id.');
    return camera;
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
});

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

const SPANS: Record<string, number> = { day: MS_IN_A_DAY, week: 7 * MS_IN_A_DAY, month: 30 * MS_IN_A_DAY };

/**
 * Which span was meant. `day`, `week` and `month` are worked out around the
 * instant given, and default to the most recent complete one; `custom` is the
 * only window that reads both ends.
 */
const spanOf = (body: TimelapseCreate): { startsAt: Date; endsAt: Date } => {
  if (body.window === 'custom') {
    if (!body.startsAt || !body.endsAt) {
      throw badRequest('span_missing', 'A film of a span of your choosing needs both ends of it.');
    }
    return { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) };
  }

  const span = SPANS[body.window];
  const around = body.startsAt ? new Date(body.startsAt).getTime() : Date.now() - span;
  const startsAt = new Date(Math.floor(around / span) * span);

  return { startsAt, endsAt: new Date(startsAt.getTime() + span) };
};
