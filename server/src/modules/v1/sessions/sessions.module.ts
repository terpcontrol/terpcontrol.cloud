import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { AccountModule } from '../account/account.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

/** Signing in, renewing, listing and revoking. The credentials it checks are the account module's. */
@Module({
  imports: [ModelsModule, AccountModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
