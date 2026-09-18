import { Global, Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { RateLimitGuard } from '../rate-limit.guard';
import { AdminGuard, AuthGuard } from './auth.guard';
import { TokenService } from './token.service';

/**
 * Global so every feature module can name a guard in `@UseGuards` without
 * importing anything.
 */
@Global()
@Module({
  imports: [ModelsModule],
  providers: [TokenService, AuthGuard, AdminGuard, RateLimitGuard],
  exports: [TokenService, AuthGuard, AdminGuard, RateLimitGuard],
})
export class SecurityModule {}
