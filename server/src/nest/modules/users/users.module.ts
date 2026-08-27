import { Module } from '@nestjs/common';
import UserService from '@services/users.service';
import { UsersController } from './users.controller';

/**
 * The service is the one the Express app already uses. Sharing it rather than
 * copying it keeps a single implementation while the two apps run side by side;
 * it moves into this module once the Express tree is gone.
 */
@Module({
  controllers: [UsersController],
  providers: [UserService],
})
export class UsersModule {}
