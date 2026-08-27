import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SecurityModule } from './common/auth/auth.module';
import { DemoReadOnlyGuard } from './common/auth/demo-read-only.guard';
import { ApiExceptionFilter } from './common/http-exception.filter';
import { AuthModule } from './modules/auth/auth.module';
import { ChartPresetModule } from './modules/chart-preset/chart-preset.module';
import { DataModule } from './modules/data/data.module';
import { HealthModule } from './modules/health/health.module';
import { ImageModule } from './modules/image/image.module';
import { MqttAuthModule } from './modules/mqtt-auth/mqtt-auth.module';
import { ShareModule } from './modules/share/share.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [SecurityModule, AuthModule, ChartPresetModule, DataModule, HealthModule, ImageModule, MqttAuthModule, ShareModule, UsersModule],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
  ],
})
export class AppModule {}
