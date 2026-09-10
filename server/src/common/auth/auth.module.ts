import { Global, Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { RateLimitGuard } from '../rate-limit.guard';
import { AdminGuard, AuthGuard } from './auth.guard';
import { DeviceAccessGuard, DeviceOwnerGuard } from './device-access.guard';
import { DeviceAccessService } from './device-access.service';
import { TokenService } from './token.service';

/**
 * Global so every feature module can name a guard in `@UseGuards` without
 * importing anything.
 */
@Global()
@Module({
  imports: [ModelsModule],
  providers: [TokenService, DeviceAccessService, AuthGuard, AdminGuard, DeviceOwnerGuard, DeviceAccessGuard, RateLimitGuard],
  exports: [TokenService, DeviceAccessService, AuthGuard, AdminGuard, DeviceOwnerGuard, DeviceAccessGuard, RateLimitGuard],
})
export class SecurityModule {}
