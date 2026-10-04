import { Module } from '@nestjs/common';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';
import { AccountModule } from '../account/account.module';
import { AdminUsersController } from './admin-users.controller';

/**
 * The admin half of the accounts. It owns no service of its own: an
 * administrator does to somebody else's account exactly what that account can do
 * to itself - reading it, changing it, deleting all of it - so the same services
 * answer, and only who may ask differs.
 */
@Module({
  imports: [AccountModule, AccountDeletionModule],
  controllers: [AdminUsersController],
})
export class AdminUsersModule {}
