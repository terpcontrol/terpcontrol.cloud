import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SecurityModule } from './common/auth/auth.module';
import { configNamespaces } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AlarmModule } from './modules/alarm/alarm.module';
import { validateEnvironment } from './config/validate-environment';
import { DemoReadOnlyGuard } from './common/auth/demo-read-only.guard';
import { ApiExceptionFilter } from './common/http-exception.filter';
import { AuthModule } from './modules/auth/auth.module';
import { ChartPresetModule } from './modules/chart-preset/chart-preset.module';
import { DataModule } from './modules/data/data.module';
import { DeviceModule } from './modules/device/device.module';
import { HealthModule } from './modules/health/health.module';
import { ImageModule } from './modules/image/image.module';
import { MqttAuthModule } from './modules/mqtt-auth/mqtt-auth.module';
import { ShareModule } from './modules/share/share.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configNamespaces,
      validate: validateEnvironment,
      // The same file the server has always read, and the process environment
      // still wins over it.
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}.local`,
      cache: true,
    }),
    DatabaseModule,
    SecurityModule,
    AuthModule,
    ChartPresetModule,
    AlarmModule,
    DataModule,
    DeviceModule,
    HealthModule,
    ImageModule,
    MqttAuthModule,
    ShareModule,
    UsersModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
  ],
})
export class AppModule {}
