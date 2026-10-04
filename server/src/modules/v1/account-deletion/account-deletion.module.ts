import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { AccountModule } from '../account/account.module';
import { DeviceModule } from '../device/device.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AccountDeletionService } from './account-deletion.service';
import { MeDeletionController } from './me-deletion.controller';

/**
 * Deleting an account, as its own slice.
 *
 * It is a leaf on purpose. The cascade has to revoke the sessions, and the
 * sessions are built on the account - so a cascade living in the account module
 * would point back at the module that points at it, and Nest resolves that graph
 * without a word and then never finishes starting. Keeping it here, with its own
 * route for the account deleting itself, is what means the account module never
 * has to know this exists.
 *
 * It borrows three services because each of them is the single definition of
 * something: what ending every session means, what retiring every recovery link
 * means, and what giving a device up means. Everything else it does is a delete
 * over a collection, so the modules that own those collections' routes are left
 * out - their own delete paths archive, tombstone or defer to a sweep, which is
 * right for one person ending one thing and wrong for an account that is going.
 */
@Module({
  imports: [ModelsModule, AccountModule, SessionsModule, DeviceModule],
  controllers: [MeDeletionController],
  providers: [AccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
