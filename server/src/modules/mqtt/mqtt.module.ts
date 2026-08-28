import { Module } from '@nestjs/common';
import { MqttClientService } from './mqtt-client.service';

/**
 * The broker connection on its own, so the services that publish to devices can
 * take it without depending on each other.
 */
@Module({
  providers: [MqttClientService],
  exports: [MqttClientService],
})
export class MqttModule {}
