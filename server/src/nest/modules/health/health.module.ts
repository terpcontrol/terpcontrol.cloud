import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ModelsModule],
  controllers: [HealthController],
})
export class HealthModule {}
