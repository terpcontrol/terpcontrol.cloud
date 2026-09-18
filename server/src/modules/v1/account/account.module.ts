import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { MailModule } from '@modules/mail/mail.module';
import { AccountController } from './account.controller';
import { AccountsService } from './accounts.service';
import { PasswordResetService } from './password-reset.service';

/**
 * The account: `users` and the recovery links that lead back into it.
 *
 * Both services are exported, because signing in reads the same rows and an
 * administrator writes them - so the sessions and admin modules build on this
 * one rather than each reaching into the collection themselves.
 */
@Module({
  imports: [ModelsModule, MailModule],
  controllers: [AccountController],
  providers: [AccountsService, PasswordResetService],
  exports: [AccountsService, PasswordResetService],
})
export class AccountModule {}
