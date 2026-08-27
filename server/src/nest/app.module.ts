import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthModule } from './common/auth/auth.module';
import { DemoReadOnlyGuard } from './common/auth/demo-read-only.guard';
import { ApiExceptionFilter } from './common/http-exception.filter';
import { ChartPresetModule } from './modules/chart-preset/chart-preset.module';
import { HealthModule } from './modules/health/health.module';
import { MqttAuthModule } from './modules/mqtt-auth/mqtt-auth.module';

@Module({
  imports: [AuthModule, ChartPresetModule, HealthModule, MqttAuthModule],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
  ],
})
export class AppModule {}
