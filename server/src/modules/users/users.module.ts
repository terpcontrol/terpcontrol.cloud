import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { UserService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [ModelsModule],
  controllers: [UsersController],
  providers: [UserService],
  exports: [UserService],
})
export class UsersModule {}
