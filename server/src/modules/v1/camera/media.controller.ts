import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiNoContentResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Media, MediaUpload } from '@fg2/shared-types/v1';
import { media as mediaShape, mediaUpload } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AuthenticatedRequest } from '@common/auth/token.service';
import { AccessGuard, AccessRequest, Caller, Requires } from '@common/v1/access.guard';
import { AccessService, needToEditEntry, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { badRequest, notFound, unprocessable } from '@common/v1/problem';
import { clampRange, outsideRange } from '@common/v1/range';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { MediaDeliveryService } from './media-delivery.service';
import { MediaPresentationService, parseDimension } from './media-presentation.service';
import { MediaService } from './media.service';
import { OptionalSessionGuard } from './optional-session.guard';
import { V1Answer } from '../answer-shape';

/**
 * One picture or film: what is known about it, and its bytes.
 *
 * The bytes themselves go out through `MediaDeliveryService`, which is also
 * where Premium is enforced: a free camera's stills go over the wire smaller
 * while the stored bytes stay whole, so a camera that is extended serves its
 * whole history at full size again. What is decided here is who may look, which
 * is the one thing the public page's own picture route decides differently.
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
    private readonly presentation: MediaPresentationService,
    private readonly delivery: MediaDeliveryService,
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
  public async read(@Param('id') id: string, @Req() request: FastifyRequest): Promise<Media> {
    return this.media.serialise(await this.require(id, request));
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
    const media = await this.require(id, request);
    return this.delivery.deliver(request, reply, media, { width: parseDimension(query.width), height: parseDimension(query.height) });
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

  /**
   * The row, and whether this credential may have it at all.
   *
   * An export is a `media` row like any other and is served by this route on
   * purpose - that is the decision that let a zip need no collection and no
   * lifecycle of its own. What it is not is a picture. The query token this
   * route accepts exists because an `<img>` cannot set a header; it is minted
   * for thirty days and it lives in a URL, which lands in download history, in
   * the clipboard when somebody copies the link, and in every proxy log on the
   * way. That is a fair trade for a still of a tent and no trade at all for a
   * file holding the account's address, every diary line it ever wrote, the
   * handles of everybody it shares with, and every device's whole climate.
   *
   * So an export is handed over to a session and to nothing else. It is refused
   * as missing rather than as forbidden, in the same words an unknown id gets,
   * because a refusal that said "that one exists but not like this" would tell
   * a stranger holding a leaked URL that there is something there to go after.
   */
  private async require(id: string, request: FastifyRequest): Promise<MediaDocument> {
    const media = await this.media.byId(id);
    if (!media) throw notFound('media_not_found', 'There is no picture with that id.');

    if (media.kind === 'export' && (request as AuthenticatedRequest).authTokenType !== 'user') {
      throw notFound('media_not_found', 'There is no picture with that id.');
    }

    if (await this.takenOutsideTheirWindow((request as AccessRequest).grant, media)) {
      throw notFound('media_not_found', 'There is no picture with that id.');
    }

    return media;
  }

  /**
   * Whether the shutter closed outside the window this reader was granted.
   *
   * A grant reaches the tent the camera hangs in, not each of the thousands of
   * pictures it took there, and what let a link reach a still at all is which
   * grow stood in front of that camera - a question about the grow's life and
   * never about the link's fortnight. So a link sent two weeks of a run served
   * every still of it by id, and narrowing a link afterwards, which is what
   * `PATCH /share-links/{id}` exists for, took back the listing and left every
   * picture the holder had already written down. The diary's own by-id route
   * closed the same hole for the same reason.
   *
   * Only a camera's pictures are dated in the sense a window means. A photo
   * somebody uploaded, an avatar and an export are reached through what they
   * belong to, and the two pictures a grow is told under are named by the grow
   * itself - so a reader who may have the page may have the cover on it.
   */
  private async takenOutsideTheirWindow(grant: Grant | undefined, media: MediaDocument): Promise<boolean> {
    if (!grant || media.cameraId === null) return false;
    if (!outsideRange(media.capturedAt, clampRange(grant))) return false;

    return !(await this.media.isAGrowsOwnPicture(media.id));
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
