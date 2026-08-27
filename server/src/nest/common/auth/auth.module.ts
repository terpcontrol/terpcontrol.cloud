import { Global, Module } from '@nestjs/common';
import { RateLimitGuard } from '../rate-limit.guard';
import { AdminGuard, AuthGuard } from './auth.guard';
import { DeviceAccessGuard, DeviceOwnerGuard } from './device-access.guard';
import { TokenService } from './token.service';

/**
 * Global so every feature module can name a guard in `@UseGuards` without
 * importing anything.
 */
@Global()
@Module({
  providers: [TokenService, AuthGuard, AdminGuard, DeviceOwnerGuard, DeviceAccessGuard, RateLimitGuard],
  exports: [TokenService, AuthGuard, AdminGuard, DeviceOwnerGuard, DeviceAccessGuard, RateLimitGuard],
})
export class SecurityModule {}
