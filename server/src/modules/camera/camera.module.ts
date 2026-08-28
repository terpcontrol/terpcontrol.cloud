import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { OkamCamService } from './okam-cam.service';
import { OkamP2PService } from './okam-p2p.service';

/**
 * The O-KAM camera: the controller on its LAN speaks the proprietary P2P
 * protocol and streams a keyframe back over MQTT, which is turned into a still
 * here.
 */
@Module({
  imports: [ModelsModule, MqttModule],
  providers: [OkamCamService, OkamP2PService],
  exports: [OkamCamService, OkamP2PService],
})
export class CameraModule {}
