import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { TunnelService } from './tunnel.service';

/**
 * The relay that reaches a device's own network through its MQTT connection -
 * how the server reads a webcam that is only visible from the grow tent.
 */
@Module({
  imports: [MqttModule],
  providers: [TunnelService],
  exports: [TunnelService],
})
export class TunnelModule {}
