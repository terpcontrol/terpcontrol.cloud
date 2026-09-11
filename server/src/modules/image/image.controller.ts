import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiShape } from '@common/api-shape';
import { FastifyReply, FastifyRequest } from 'fastify';
import parseRange from 'range-parser';
import { Image, ImageUploadResult } from '@fg2/shared-types';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';
import { withoutCredentials } from '@common/log-path';
import { ImageService } from './image.service';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentShare } from '../../common/auth/current-user.decorator';
import { DeviceAccessGuard, DeviceOwnerGuard, DeviceTokenType } from '../../common/auth/device-access.guard';
import { DeviceAccessService } from '../../common/auth/device-access.service';
import { AuthenticatedRequest } from '../../common/auth/token.service';
import { ImagePresentationService, parseResizeDimension, RenderedImage } from './image-presentation.service';

interface ImageQuery {
  format?: string;
  timestamp?: string;
  duration?: string;
  image_id?: string;
  width?: string;
  height?: string;
}

@ApiTags('pictures')
@Controller('image')
export class ImageController {
  constructor(
    private readonly presentation: ImagePresentationService,
    private readonly access: DeviceAccessService,
    private readonly images: ImageService,
  ) {}

  @Get(':device_id')
  @UseGuards(DeviceAccessGuard)
  // The picture URL goes into an <img> tag, which cannot set headers, so these
  // routes take the long-lived image token as well as a session.
  @DeviceTokenType('image')
  @ApiQuery({ name: 'format', required: false, description: "'jpeg', 'mp4' for a timelapse, or 'user/jpeg' for an uploaded photo" })
  @ApiQuery({ name: 'timestamp', required: false, description: 'Epoch milliseconds; the newest picture at or before it' })
  @ApiQuery({ name: 'duration', required: false, enum: ['1d', '1w', '1m'] })
  @ApiQuery({ name: 'image_id', required: false })
  @ApiQuery({ name: 'width', required: false })
  @ApiQuery({ name: 'height', required: false })
  @ApiOperation({ summary: 'A webcam still, a timelapse, or an uploaded photo' })
  public async byDevice(
    @Param('device_id') deviceId: string,
    @Query() query: ImageQuery,
    @CurrentShare() share: { webcam?: boolean } | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Share links without webcam access may still fetch diary photos (image_id),
    // but not the webcam stills and timelapses addressed by timestamp.
    if (share && !share.webcam && !query.image_id) {
      await reply.status(HttpStatus.FORBIDDEN).send();
      return;
    }

    const image = await this.images.getDeviceImage(
      deviceId,
      String(query.format),
      Number(query.timestamp),
      String(query.duration || ''),
      String(query.image_id ?? ''),
    );

    const size = { width: parseResizeDimension(query.width), height: parseResizeDimension(query.height) };

    if (image) {
      const contentType = image.format === 'mp4' ? 'video/mp4' : 'image/jpeg';
      const caption = this.presentation.offlineCaption(image, Number(query.timestamp), !!query.image_id);
      const resizes = contentType.startsWith('image/') && !!(size.width || size.height);

      // Rewriting the picture needs all of it in memory. Only stills are ever
      // rewritten - a timelapse is neither resized nor captioned - and one still
      // is a few hundred kilobytes, so the whole-buffer path stays off the videos.
      if (caption || resizes) {
        const data = await this.images.readImageData(image);
        const body = caption ? await this.images.addOfflineOverlay(data, caption) : data;
        await this.send(reply, await this.presentation.render(body, contentType, size));
        return;
      }

      await this.stream(request, reply, image, contentType);
      return;
    }

    // The placeholder is resized like a real picture, so a caller asking for a
    // thumbnail gets one either way.
    const placeholder = await this.presentation.placeholder(String(query.format));
    await this.send(reply, await this.presentation.render(placeholder.body, placeholder.contentType, size));
  }

  @Post(':device_id')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add a photo to the device´s diary' })
  @ApiShape('ImageUploadResult', { status: HttpStatus.CREATED })
  public async upload(@Param('device_id') deviceId: string, @Body() body: { image?: unknown; timestamp?: unknown }): Promise<ImageUploadResult> {
    const file = body?.image;
    if (!Buffer.isBuffer(file)) {
      throw new HttpException(400, 'Image file is missing or invalid');
    }

    const timestamp = Number(body?.timestamp);
    const image = await this.images.createDeviceImage(deviceId, file, Number.isFinite(timestamp) ? timestamp : undefined);

    return { image_id: image.image_id, device_id: image.device_id, timestamp: image.timestamp, format: image.format };
  }

  @Post('test/:device_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'Read one frame from a webcam stream, to check the settings' })
  public async testWebcam(
    @Param('device_id') deviceId: string,
    @Body() body: { rtspStream?: unknown; rtspStreamTransport?: unknown; tunnelRtspStream?: unknown },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const rtspStream = typeof body?.rtspStream === 'string' ? body.rtspStream.trim() : '';
    if (!rtspStream) {
      throw new HttpException(400, 'rtspStream is missing or invalid');
    }

    try {
      const image = await this.images.testRtspStream(deviceId, {
        rtspStream,
        rtspStreamTransport: typeof body?.rtspStreamTransport === 'string' ? body.rtspStreamTransport : undefined,
        tunnelRtspStream: !!body?.tunnelRtspStream,
      });

      await reply.header('Content-type', 'image/jpeg').header('Cache-Control', 'no-store').send(image);
    } catch (error) {
      // The stream belongs to the caller's network, so a failure to read it is
      // an upstream problem rather than a bad request.
      // The message quotes the ffmpeg command line, which carries the camera's
      // credentials - and the filter writes every refusal to the log.
      throw new HttpException(
        502,
        withoutCredentials(String((error as Error)?.message ?? 'Failed to read an image from the webcam stream')).slice(0, 2000),
      );
    }
  }

  @Delete(':image_id')
  // A session is required up front: without it, the lookup below would answer
  // 401 for a picture that exists and 404 for one that does not, which tells a
  // stranger which ids are real.
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete a stored picture' })
  public async remove(@Param('image_id') imageId: string, @Req() request: AuthenticatedRequest) {
    // Which device the picture belongs to is only known after the lookup, so the
    // ownership check cannot be a guard on this route.
    const image = await this.images.getImageById(imageId);
    if (!image) {
      throw new NotFoundException({ status: 'not found' });
    }

    await this.access.requireOwner(request, image.device_id, 'user');

    if (!(await this.images.deleteImage(imageId))) {
      throw new NotFoundException({ status: 'not found' });
    }

    return { status: 'ok' };
  }

  /**
   * Serve the stored bytes straight from the image store. A timelapse runs to
   * tens of megabytes, so it is piped rather than buffered, and byte ranges are
   * honoured - a <video> element asks for them, and Safari will not start
   * playing without a 206.
   */
  private async stream(request: FastifyRequest, reply: FastifyReply, image: Image, contentType: string): Promise<void> {
    const size = this.images.imageSize(image);
    // -1 is "asked for bytes we do not have", -2 "asked in a way we cannot read".
    const header = request.headers.range;
    const ranges = size === undefined || !header ? undefined : parseRange(size, header, { combine: true });

    void reply.header('Content-type', contentType).header('Cache-Control', 'max-age=3600');
    if (size !== undefined) {
      void reply.header('Accept-Ranges', 'bytes');
    }

    if (ranges === -1) {
      await reply.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).header('Content-Range', `bytes */${size}`).send();
      return;
    }

    // Several ranges at once would need a multipart body no client here asks for.
    const range = Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1 ? ranges[0] : undefined;

    if (range) {
      void reply
        .status(HttpStatus.PARTIAL_CONTENT)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1);
    } else if (size !== undefined) {
      void reply.header('Content-Length', size);
    }

    const stream = this.images.readImageStream(image, range);
    stream.on('error', error => {
      logger.error(`Failed streaming image ${image.image_id}: ${error}`);
      // The status line is long gone by the time a chunk fails, so cutting the
      // connection is all that is left to tell the client the body is short.
      reply.raw.destroy();
    });

    await reply.send(stream);
  }

  private async send(reply: FastifyReply, rendered: RenderedImage): Promise<void> {
    // A picture is worth caching; the placeholder sent when rendering failed is
    // not - it would pin the failure in front of the device for an hour.
    const cacheControl = rendered.status === HttpStatus.OK ? 'max-age=3600' : 'no-store';

    await reply.status(rendered.status).header('Content-type', rendered.contentType).header('Cache-Control', cacheControl).send(rendered.body);
  }
}
