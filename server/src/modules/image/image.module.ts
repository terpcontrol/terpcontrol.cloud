import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { CameraModule } from '../camera/camera.module';
import { DeviceLogModule } from '../device/device-log.module';
import { TunnelModule } from '../tunnel/tunnel.module';
import { ImagePresentationService } from './image-presentation.service';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';
import { TimelapseService } from './timelapse.service';
import { WebcamPollerService } from './webcam-poller.service';

/**
 * The pictures of a device: the store they live in, the poller that fills it
 * and the builder that rolls them up into timelapses.
 */
@Module({
  imports: [ModelsModule, TunnelModule, CameraModule, DeviceLogModule],
  controllers: [ImageController],
  providers: [ImageService, ImagePresentationService, TimelapseService, WebcamPollerService],
  exports: [ImageService, WebcamPollerService],
})
export class ImageModule {}
