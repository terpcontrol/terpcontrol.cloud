import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Camera, CameraCreate, CameraUpdate, MediaPage, TestCapture, TimelapseAccepted, TimelapseCreate } from '@fg2/shared-types/v1';
import {
  camera,
  cameraCreate,
  cameraPage,
  cameraUpdate,
  mediaPage,
  testCapture,
  timelapseAccepted,
  timelapseCreate,
} from '@fg2/shared-types/v1-schemas';
import { AuthGuard, OptionalSessionGuard } from '@common/auth/auth.guard';
import { V1Body } from '@common/zod-validation.pipe';
import { AccessGuard, Caller, CurrentGrant, Requires } from '@common/v1/access.guard';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant, Grantee } from '@common/v1/access.types';
import { badRequest, notFound, unprocessable } from '@common/v1/problem';
import { clampRange } from '@common/v1/range';
import { V1Query, inOrder, instantQuery, pageQuery } from '@common/v1/validation';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { CamerasService } from './cameras.service';
import { CameraPollerService } from './camera-poller.service';
import { TestCapturesService } from './test-captures.service';
import { MediaService } from './media.service';
import { TimelapseService } from './timelapse.service';
import { changesTheStream } from './stream-url';
import { V1Answer } from '../answer-shape';
import { SHARED_READ_OPERATION } from '../../../openapi';
import { accountOf } from '../caller';

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
const spanQuery = inOrder(
  pageQuery.extend({
    startsAt: instantQuery().optional(),
    endsAt: instantQuery().optional(),
  }),
  'startsAt',
  'endsAt',
);

type SpanQuery = z.infer<typeof spanQuery>;

/** The pipeline asks a camera for a picture every 30 seconds at most, so a shorter interval is a promise it cannot keep. */
const MINIMUM_STILL_INTERVAL_SECONDS = 30;

@ApiTags('cameras')
@Controller('v1/cameras')
export class CamerasController {
  constructor(
    private readonly cameras: CamerasService,
    private readonly media: MediaService,
    private readonly poller: CameraPollerService,
    private readonly builder: TimelapseService,
    private readonly access: AccessService,
    private readonly tests: TestCapturesService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The cameras this account can see' })
  @V1Answer(cameraPage)
  public async list(@Caller() ctx: AccessContext, @V1Query(cameraListQuery) query: z.infer<typeof cameraListQuery>) {
    if (query.spaceId) await this.access.require(ctx, subjectRef('space', query.spaceId), 'view');
    if (query.deviceId) await this.access.require(ctx, subjectRef('device', query.deviceId), 'view');

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
    // A Terp Cam is reached over a relay its device opens to the cloud, and one
    // paired at no device has nobody to open it. The kind stays in the model, but
    // no camera is taken that the cloud would never read a picture from; the app
    // does not offer one.
    if (body.kind === 'terpcam_standalone') {
      throw badRequest('not_yet', 'Pairing a standalone Terp Cam is coming: a Terp Cam is reached through the device it is paired at.');
    }

    const deviceId = body.deviceId ?? null;
    if (deviceId) await this.access.require(ctx, subjectRef('device', deviceId), 'manage');
    if (body.kind === 'rtsp' && body.tunnel) {
      await this.requireATunnel(deviceId);
      refuseUdpThroughATunnel(body.transport);
    }
    if (body.spaceId) await this.access.require(ctx, subjectRef('space', body.spaceId), 'manage');
    if (!deviceId && !body.spaceId) {
      throw badRequest('nowhere_to_put_it', 'A camera belongs to a space or to the controller that answers for it; name one of them.');
    }

    const owner = accountOf(ctx, 'A camera belongs to somebody, and this session is nobody.');

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
  @ApiOperation({ summary: 'One camera', ...SHARED_READ_OPERATION })
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
   * A stream also carries the device it is pulled through, and that follows
   * the tent: a camera moved to a place another device stands in has to be
   * pulled through that one, so the screen that moves it sends both and this
   * route checks the pair is one the cloud could act on.
   *
   * A new address keeps the login the stream was opened with unless it brings
   * one of its own (`stream-url.ts`): the login is never answered, so nobody
   * correcting an address could send it back. The camera keeps its id, and with
   * it every picture, film and the Premium it carries.
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
    // Naming somebody else's device would pull a stream through hardware they
    // never offered, so moving a camera onto one is managing that one too.
    if (body.deviceId) await this.access.require(ctx, subjectRef('device', body.deviceId), 'manage');
    // Either half of the pair decides the other, so both are judged together,
    // and only when this request is what changes them: a camera stored before
    // the pair was checked is not made unrenameable by it.
    if ((body.deviceId !== undefined || body.tunnel !== undefined) && (body.tunnel ?? current.tunnel)) {
      await this.requireATunnel(body.deviceId !== undefined ? body.deviceId : current.deviceId);
    }
    if ((body.transport !== undefined || body.tunnel !== undefined) && (body.tunnel ?? current.tunnel)) {
      refuseUdpThroughATunnel(body.transport !== undefined ? body.transport : current.transport);
    }
    if (body.stillIntervalSeconds !== undefined && body.stillIntervalSeconds < MINIMUM_STILL_INTERVAL_SECONDS) {
      throw unprocessable(
        'still_interval_too_short',
        `The pipeline asks a camera for a picture every ${MINIMUM_STILL_INTERVAL_SECONDS} seconds at most, so a shorter interval would not be kept.`,
      );
    }

    const updated = await this.cameras.update(id, body, current.url);
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
   * answers at all. Answered at once: the read takes as long as the camera
   * does, and is asked after below. A read of this camera that is already
   * under way - the poller's, or a press before this one - is joined rather
   * than run a second time beside it.
   */
  @Post(':id/test-captures')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'camera')
  @ApiOperation({ summary: 'Read one picture from a camera to check its settings' })
  @V1Answer(testCapture, {
    status: HttpStatus.ACCEPTED,
    description: 'Running, and asked after through `GET /cameras/{id}/test-captures/{captureId}`.',
  })
  public async testCapture(@CurrentGrant() grant: Grant, @Param('id') id: string): Promise<TestCapture> {
    const camera = await this.cameras.withSecret(id);
    if (!camera) throw notFound('camera_not_found', 'There is no camera with that id.');

    return asReadBy(this.tests.start(camera), grant.grantee);
  }

  /**
   * How a test picture went. A camera that could not be read is a `failed`
   * capture rather than an error: a wrong address is an ordinary outcome of the
   * button, and the reason the camera gave is what the person needs to see. A
   * finished capture is kept for a few minutes, for whoever may start one.
   */
  @Get(':id/test-captures/:captureId')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'camera')
  @ApiOperation({ summary: 'How a test picture went: running, done with its still, or failed and why' })
  @V1Answer(testCapture)
  public testCaptureState(@CurrentGrant() grant: Grant, @Param('id') id: string, @Param('captureId') captureId: string): TestCapture {
    const capture = this.tests.find(id, captureId);
    if (!capture) throw notFound('test_capture_not_found', 'There is no test picture with that id for this camera, or it finished too long ago.');

    return asReadBy(capture, grant.grantee);
  }

  @Get(':id/frames')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'camera')
  @ApiOperation({ summary: 'The stills of one camera, newest first', ...SHARED_READ_OPERATION })
  @V1Answer(mediaPage)
  public frames(@Param('id') id: string, @V1Query(spanQuery) query: SpanQuery, @CurrentGrant() grant: Grant | undefined): Promise<MediaPage> {
    return this.media.page({ cameraId: id, kind: 'still', range: clampRange(grant, query) }, query);
  }

  @Get(':id/timelapses')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'camera')
  @ApiOperation({ summary: 'The films of one camera, newest first', ...SHARED_READ_OPERATION })
  @V1Answer(mediaPage)
  public timelapses(@Param('id') id: string, @V1Query(spanQuery) query: SpanQuery, @CurrentGrant() grant: Grant | undefined): Promise<MediaPage> {
    return this.media.page({ cameraId: id, kind: 'timelapse', range: clampRange(grant, query), granted: clampRange(grant) }, query);
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
  @V1Answer(timelapseAccepted, { status: HttpStatus.ACCEPTED, description: 'Queued, and polled through `GET /media/{id}`.' })
  @V1Answer(timelapseAccepted, { status: HttpStatus.OK, description: 'The film already exists, and `queued` is false.' })
  public async requestTimelapse(
    @Caller() ctx: AccessContext,
    @Param('id') id: string,
    @V1Body(timelapseCreate) body: TimelapseCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TimelapseAccepted> {
    const camera = await this.require(id);
    const { film, queued } = await this.builder.request(camera, body, () => this.besideId(ctx, camera, body.secondCameraId));

    void reply.status(queued ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return { media: this.media.serialise(film), queued };
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
   * where it stands, and what pauses the camera in maintenance and at night.
   */
  private async requireATunnel(deviceId: string | null | undefined): Promise<void> {
    if (!deviceId) throw unprocessable('tunnel_without_device', 'A stream pulled through a tunnel needs the device whose tunnel it is.');
    if (!(await this.cameras.carriesATunnel(deviceId))) {
      throw notFound('device_not_found', 'There is no device with that id to pull a stream through.');
    }
  }
}

/**
 * What the camera said can name the address its owner reaches it at, so it is
 * held back from everybody else who may press the button, as it is in the
 * camera's own state: a member of the tent is told what kind of failure it was,
 * and not where the host's hardware lives.
 */
const asReadBy = (capture: TestCapture, grantee: Grantee): TestCapture =>
  grantee === 'owner' || grantee === 'admin' ? capture : { ...capture, error: null };

/**
 * A device's tunnel carries TCP and nothing else, and RTP over UDP would have
 * to reach the cloud on ports of its own - so a stream pulled through a tunnel
 * over UDP is a camera that never delivers a picture, and is refused rather
 * than stored.
 */
const refuseUdpThroughATunnel = (transport: CameraUpdate['transport']): void => {
  if (transport === 'udp') {
    throw unprocessable('udp_through_tunnel', 'A stream pulled through a device’s tunnel is read over TCP or HTTP; UDP does not pass through it.');
  }
};

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
  changesTheStream(body) || body.transport !== undefined || body.tunnel !== undefined || body.model !== undefined;
