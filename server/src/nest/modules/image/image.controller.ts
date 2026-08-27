import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { HttpException } from '@exceptions/HttpException';
import { imageService } from '@services/image.service';
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
  constructor(private readonly presentation: ImagePresentationService, private readonly access: DeviceAccessService) {}

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
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Share links without webcam access may still fetch diary photos (image_id),
    // but not the webcam stills and timelapses addressed by timestamp.
    if (share && !share.webcam && !query.image_id) {
      await reply.status(HttpStatus.FORBIDDEN).send();
      return;
    }

    const image = await imageService.getDeviceImage(
      deviceId,
      String(query.format),
      Number(query.timestamp),
      String(query.duration || ''),
      String(query.image_id ?? ''),
    );

    const source = image
      ? {
          body: await this.presentation.withOfflineOverlay(image, Number(query.timestamp), !!query.image_id),
          contentType: image.format === 'mp4' ? 'video/mp4' : 'image/jpeg',
        }
      : await this.presentation.placeholder(String(query.format));

    // The placeholder is resized like a real picture, so a caller asking for a
    // thumbnail gets one either way.
    const rendered = await this.presentation.render(source.body, source.contentType, {
      width: parseResizeDimension(query.width),
      height: parseResizeDimension(query.height),
    });

    await this.send(reply, rendered);
  }

  @Post(':device_id')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add a photo to the device´s diary' })
  public async upload(@Param('device_id') deviceId: string, @Body() body: { image?: unknown; timestamp?: unknown }) {
    const file = body?.image;
    if (!Buffer.isBuffer(file)) {
      throw new HttpException(400, 'Image file is missing or invalid');
    }

    const timestamp = Number(body?.timestamp);
    const image = await imageService.createDeviceImage(deviceId, file, Number.isFinite(timestamp) ? timestamp : undefined);

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
      const image = await imageService.testRtspStream(deviceId, {
        rtspStream,
        rtspStreamTransport: typeof body?.rtspStreamTransport === 'string' ? body.rtspStreamTransport : undefined,
        tunnelRtspStream: !!body?.tunnelRtspStream,
      });

      await reply.header('Content-type', 'image/jpeg').header('Cache-Control', 'no-store').send(image);
    } catch (error) {
      // The stream belongs to the caller's network, so a failure to read it is
      // an upstream problem rather than a bad request.
      throw new HttpException(502, String((error as Error)?.message ?? 'Failed to read an image from the webcam stream').slice(0, 2000));
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
    const image = await imageService.getImageById(imageId);
    if (!image) {
      throw new NotFoundException({ status: 'not found' });
    }

    await this.access.requireOwner(request, image.device_id, 'user');

    if (!(await imageService.deleteImage(imageId))) {
      throw new NotFoundException({ status: 'not found' });
    }

    return { status: 'ok' };
  }

  private async send(reply: FastifyReply, rendered: RenderedImage): Promise<void> {
    // A picture is worth caching; the placeholder sent when rendering failed is
    // not - it would pin the failure in front of the device for an hour.
    const cacheControl = rendered.status === HttpStatus.OK ? 'max-age=3600' : 'no-store';

    await reply.status(rendered.status).header('Content-type', rendered.contentType).header('Cache-Control', cacheControl).send(rendered.body);
  }
}
