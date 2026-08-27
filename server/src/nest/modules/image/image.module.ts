import { Module } from '@nestjs/common';
import { ImagePresentationService } from './image-presentation.service';
import { ImageController } from './image.controller';

@Module({
  controllers: [ImageController],
  providers: [ImagePresentationService],
})
export class ImageModule {}
