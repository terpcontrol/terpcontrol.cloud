import { Module } from '@nestjs/common';
import MqttAuthService from '@services/mqttauth.service';
import { MqttAuthController } from './mqtt-auth.controller';

@Module({
  controllers: [MqttAuthController],
  providers: [MqttAuthService],
})
export class MqttAuthModule {}
