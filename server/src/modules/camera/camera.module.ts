import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { TerpCamDirectService } from './terpcam-direct.service';
import { TerpCamService } from './terpcam.service';

/**
 * The Terp Cam, which has no RTSP and speaks a proprietary P2P protocol. The
 * server runs the P2P client itself, across a relay the controller on the
 * camera's LAN opens, and turns the full-resolution keyframe into a JPEG.
 */
@Module({
  imports: [ModelsModule, MqttModule],
  providers: [TerpCamService, TerpCamDirectService],
  exports: [TerpCamService, TerpCamDirectService],
})
export class CameraModule {}
