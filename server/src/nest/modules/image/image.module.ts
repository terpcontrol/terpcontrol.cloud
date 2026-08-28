import { forwardRef, Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { CameraModule } from '../camera/camera.module';
import { DeviceModule } from '../device/device.module';
import { TunnelModule } from '../tunnel/tunnel.module';
import { ImagePresentationService } from './image-presentation.service';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';

@Module({
  imports: [ModelsModule, TunnelModule, CameraModule, forwardRef(() => DeviceModule)],
  controllers: [ImageController],
  providers: [ImageService, ImagePresentationService],
  exports: [ImageService],
})
export class ImageModule {}
