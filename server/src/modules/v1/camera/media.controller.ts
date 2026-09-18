import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiNoContentResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import parseRange from 'range-parser';
import { Media, MediaUpload } from '@fg2/shared-types/v1';
import { media as mediaShape, mediaUpload } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, Requires } from '@common/v1/access.guard';
import { AccessService, needToEditEntry, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { badRequest, notFound, unprocessable } from '@common/v1/problem';
import { logger } from '@utils/logger';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CamerasService } from './cameras.service';
import { EntitlementService } from './entitlement.service';
import { MediaPresentationService, narrowestOf, parseDimension } from './media-presentation.service';
import { MediaService } from './media.service';
import { OptionalSessionGuard } from './optional-session.guard';
import { V1Answer } from '../answer-shape';

/**
 * One picture or film: what is known about it, and its bytes.
 *
 * This is the one place a stored picture is served, which is why it is also the
 * one place Premium is enforced: a free camera's stills go over the wire smaller
 * while the stored bytes stay whole, so a camera that is extended serves its
 * whole history at full size again. Nothing else in the server asks what a
 * camera is entitled to.
 */
/** What the store holds: stills and photos as they were taken, films as they were rendered. */
const STORED_BYTES = {
  'image/jpeg': { schema: { type: 'string', format: 'binary' } },
  'image/png': { schema: { type: 'string', format: 'binary' } },
  'video/mp4': { schema: { type: 'string', format: 'binary' } },
};

@ApiTags('media')
@Controller('v1/media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly cameras: CamerasService,
    private readonly entitlement: EntitlementService,
    private readonly presentation: MediaPresentationService,
    private readonly access: AccessService,
  ) {}

  /**
   * A picture somebody took, against a grow or a space and never against a
   * device: a phone is not hardware this cloud knows, and the grow is what the
   * picture is of.
   *
   * It is uploaded on its own rather than inside the entry, because a photo
   * entry is written the instant the shutter closes and the bytes take as long
   * as the connection takes. The entry that carries it names it in `mediaIds`
   * afterwards; a picture that never reaches one is removed by the daily sweep.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'kind'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'The picture, in whatever format the phone took it.' },
        kind: { type: 'string', enum: ['photo', 'avatar'] },
        growId: { type: 'string' },
        spaceId: { type: 'string' },
        capturedAt: { type: 'string', format: 'date-time', description: 'When it was taken. Defaults to now.' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a picture for the diary' })
  @V1Answer(mediaShape, { status: HttpStatus.CREATED })
  public async upload(@Caller() ctx: AccessContext, @Body() body: Record<string, unknown>): Promise<Media> {
    const bytes = fileOf(body);
    const upload = parseUpload(body);

    // A photo belongs to whatever it is of, and writing to that is logging. An
    // avatar belongs to the account that is uploading it and to nothing else.
    if (upload.kind === 'photo') {
      if (!upload.growId && !upload.spaceId) {
        throw badRequest('photo_about_nothing', 'A photo is of a grow or of a space.', [
          { field: 'growId', code: 'required', detail: 'Name a growId or a spaceId.' },
        ]);
      }
      if (upload.growId) await this.access.require(ctx, subjectRef('grow', upload.growId), 'log');
      if (upload.spaceId) await this.access.require(ctx, subjectRef('space', upload.spaceId), 'log');
    }

    const stored = await this.presentation.asStoredJpeg(bytes).catch(() => {
      throw unprocessable('not_a_picture', 'That file could not be read as a picture.');
    });

    return this.media.serialise(
      await this.media.storeBytes(
        {
          kind: upload.kind,
          mime: 'image/jpeg',
          growId: upload.kind === 'photo' ? (upload.growId ?? null) : null,
          spaceId: upload.kind === 'photo' ? (upload.spaceId ?? null) : null,
          uploadedBy: ctx.userId,
          capturedAt: upload.capturedAt ? new Date(upload.capturedAt) : new Date(),
        },
        stored,
      ),
    );
  }

  @Get(':id')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'media')
  @ApiOperation({ summary: 'What is known about one picture or film' })
  @V1Answer(mediaShape)
  public async read(@Param('id') id: string): Promise<Media> {
    return this.media.serialise(await this.require(id));
  }

  @Get(':id/content')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'media')
  @ApiQuery({ name: 'width', required: false, description: 'A thumbnail rather than the whole picture. Never enlarged.' })
  @ApiQuery({ name: 'height', required: false })
  @ApiOperation({ summary: 'The bytes of a picture or film' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The file itself, in the type it was stored as.', content: STORED_BYTES })
  @ApiResponse({ status: HttpStatus.PARTIAL_CONTENT, description: 'The byte range a <video> element asked for.', content: STORED_BYTES })
  public async content(
    @Param('id') id: string,
    @Query() query: { width?: string; height?: string },
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const media = await this.require(id);
    const asked = { width: parseDimension(query.width), height: parseDimension(query.height) };
    const size = narrowestOf(asked, await this.servedWidth(media));

    // Rewriting a picture needs all of it in memory, and only a still is ever
    // rewritten - a film is neither resized nor marked - so the whole-buffer
    // path stays off the videos, which run to tens of megabytes.
    if (media.mime.startsWith('image/') && (size.width || size.height)) {
      const resized = await this.presentation.resize(await this.media.download(media.id), size);
      await reply.header('Content-type', media.mime).header('Cache-Control', 'max-age=3600').send(resized);
      return;
    }

    await this.stream(request, reply, media);
  }

  /**
   * Deleting one's own photo is logging; deleting somebody else's is managing -
   * the same rule the diary entry that carries it is edited by.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete a picture' })
  @ApiNoContentResponse({ description: 'The picture is gone, and so are its bytes.' })
  public async remove(@Param('id') id: string, @Caller() ctx: AccessContext): Promise<void> {
    // Which grow or camera it belongs to is only known after the lookup, so the
    // decision cannot be a guard on this route.
    const media = await this.media.byId(id);
    if (!media) throw notFound('media_not_found', 'There is no picture with that id.');

    await this.access.require(ctx, subjectRef('media', id), needToEditEntry(ctx, media.uploadedBy));
    await this.media.delete(id);
  }

  /** Nothing but a still of a camera is ever narrowed, and only where an install enforces a tier. */
  private async servedWidth(media: MediaDocument): Promise<number | undefined> {
    if (media.kind !== 'still' || media.cameraId === null || !this.entitlement.enforced) return undefined;

    const camera = await this.cameras.byId(media.cameraId);
    return camera ? this.entitlement.servedStillWidth(camera) : undefined;
  }

  private async require(id: string): Promise<MediaDocument> {
    const media = await this.media.byId(id);
    if (!media) throw notFound('media_not_found', 'There is no picture with that id.');
    return media;
  }

  /**
   * The stored bytes, straight out of the bucket. A film runs to tens of
   * megabytes, so it is piped rather than buffered, and byte ranges are honoured
   * - a <video> element asks for them, and Safari will not start playing without
   * a 206.
   */
  private async stream(request: FastifyRequest, reply: FastifyReply, media: MediaDocument): Promise<void> {
    // -1 is "asked for bytes we do not have", -2 "asked in a way we cannot read".
    const header = request.headers.range;
    const ranges = header ? parseRange(media.bytes, header, { combine: true }) : undefined;

    void reply.header('Content-type', media.mime).header('Cache-Control', 'max-age=3600').header('Accept-Ranges', 'bytes');

    if (ranges === -1) {
      await reply.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).header('Content-Range', `bytes */${media.bytes}`).send();
      return;
    }

    // Several ranges at once would need a multipart body no client here asks for.
    const range = Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1 ? ranges[0] : undefined;

    if (range) {
      void reply
        .status(HttpStatus.PARTIAL_CONTENT)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${media.bytes}`)
        .header('Content-Length', range.end - range.start + 1);
    } else {
      void reply.header('Content-Length', media.bytes);
    }

    const stream = this.media.read(media.id, range);
    stream.on('error', error => {
      logger.error(`Failed streaming media ${media.id}: ${error}`);
      // The status line is long gone by the time a chunk fails, so cutting the
      // connection is all that is left to tell the client the body is short.
      reply.raw.destroy();
    });

    await reply.send(stream);
  }
}

/**
 * The bytes off the multipart body. Fastify attaches a file field as a buffer
 * and every other field as a string, so the picture is whichever field is one -
 * `file` by name, and `image` because that is what the old route called it.
 */
const fileOf = (body: Record<string, unknown>): Buffer => {
  const file = body?.file ?? body?.image;
  if (!Buffer.isBuffer(file) || file.length === 0) {
    throw badRequest('file_missing', 'The picture is sent as a file field named `file`.', [
      { field: 'file', code: 'required', detail: 'No file field arrived with the request.' },
    ]);
  }

  return file;
};

/** Everything beside the bytes, checked against the contract rather than read field by field. */
const parseUpload = (body: Record<string, unknown>): MediaUpload => {
  const { file: _file, image: _image, ...fields } = body ?? {};
  const parsed = mediaUpload.safeParse(fields);

  if (!parsed.success) {
    throw badRequest(
      'validation_failed',
      'The fields beside the picture do not match what this route accepts.',
      parsed.error.issues.map(issue => ({ field: issue.path.join('.'), code: issue.code, detail: issue.message })),
    );
  }

  return parsed.data;
};
