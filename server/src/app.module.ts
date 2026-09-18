import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DemoReadOnlyGuard } from './common/auth/demo-read-only.guard';
import { SecurityModule } from './common/auth/auth.module';
import { ProblemExceptionFilter } from './common/v1/problem.filter';
import { V1CommonModule } from './common/v1/v1.module';
import { configNamespaces } from './config/configuration';
import { validateEnvironment } from './config/validate-environment';
import { DatabaseModule } from './database/database.module';
import { MigrationsModule } from './migrations/migrations.module';
import { AlarmModule } from './modules/alarm/alarm.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { DataModule } from './modules/data/data.module';
import { DeviceProtocolModule } from './modules/device-protocol/device-protocol.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { MqttModule } from './modules/mqtt/mqtt.module';
import { MqttAuthModule } from './modules/mqtt-auth/mqtt-auth.module';
import { TunnelModule } from './modules/tunnel/tunnel.module';
import { AccountModule } from './modules/v1/account/account.module';
import { AdminUsersModule } from './modules/v1/admin-users/admin-users.module';
import { CameraModule } from './modules/v1/camera/camera.module';
import { DeviceModule } from './modules/v1/device/device.module';
import { FleetModule } from './modules/v1/fleet/fleet.module';
import { PhaseModule } from './modules/v1/phase/phase.module';
import { PlanModule } from './modules/v1/plan/plan.module';
import { SessionsModule } from './modules/v1/sessions/sessions.module';
import { WiringModule } from './wiring.module';

/**
 * The server, assembled: the ground it stands on, the transports it speaks, the
 * loops that run without a caller, and the slices of `/v1`.
 *
 * The order here is the order of dependence rather than anything Nest enforces -
 * it builds the graph from the imports of each module - so it reads as what
 * rests on what. `WiringModule` is last because it is what joins the slices to
 * each other, and the migrations run before any of this serves: `main.ts` calls
 * the runner between building the application and letting it listen.
 */
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
    MigrationsModule,
    SecurityModule,
    V1CommonModule,

    // The transports: a broker connection, a mail sender, and the relay that
    // reaches a device's own network through its MQTT connection.
    MqttModule,
    MailModule,
    TunnelModule,

    // The boundary towards the hardware, and the broker's authentication
    // backend, which answers about the same credentials.
    DeviceProtocolModule,
    MqttAuthModule,

    // The stores and the engines that run without anybody asking.
    DataModule,
    PhaseModule,
    PlanModule,
    AlarmModule,
    CameraModule,
    FleetModule,

    // The routes of `/v1`.
    SessionsModule,
    AccountModule,
    AdminUsersModule,
    DeviceModule,

    // The probes, and the daily sweep for records nothing can reach any more.
    HealthModule,
    CleanupModule,

    WiringModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemExceptionFilter },
    { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
  ],
})
export class AppModule {}
