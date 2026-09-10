import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { TerpCamDirectService } from './terpcam-direct.service';
import { TerpCamP2PService } from './terpcam-p2p.service';
import { TerpCamService } from './terpcam.service';

/**
 * The Terp Cam, which has no RTSP and speaks a proprietary P2P protocol. The
 * server reaches it directly where it can, at full resolution; otherwise the
 * controller on the camera's LAN streams a keyframe back over MQTT. Either way a
 * still is turned into a JPEG and stored here.
 */
@Module({
  imports: [ModelsModule, MqttModule],
  providers: [TerpCamService, TerpCamP2PService, TerpCamDirectService],
  exports: [TerpCamService, TerpCamP2PService, TerpCamDirectService],
})
export class CameraModule {}
