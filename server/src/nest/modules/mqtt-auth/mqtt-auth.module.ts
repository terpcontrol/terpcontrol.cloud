import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { MqttAuthController } from './mqtt-auth.controller';
import { MqttAuthService } from './mqtt-auth.service';

@Module({
  imports: [ModelsModule, MqttModule],
  controllers: [MqttAuthController],
  providers: [MqttAuthService],
})
export class MqttAuthModule {}
