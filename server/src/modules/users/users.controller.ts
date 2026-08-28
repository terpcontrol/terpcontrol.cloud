import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@fg2/shared-types';
import { UserService } from './users.service';
import { AdminGuard } from '../../common/auth/auth.guard';
import { zodBody } from '../../common/zod-validation.pipe';
import { CreateUser, createUserSchema, UpdateUser, updateUserSchema } from './users.schemas';

@ApiTags('users')
@Controller('users')
@UseGuards(AdminGuard)
export class UsersController {
  constructor(private readonly users: UserService) {}

  @Get()
  @ApiOperation({ summary: 'Every account, without password hashes' })
  public list(): Promise<User[]> {
    return this.users.findAllUser();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One account, by its database id' })
  public async byId(@Param('id') id: string) {
    return { data: await this.users.findUserById(id), message: 'findOne' };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an account' })
  public async create(@Body(zodBody(createUserSchema)) body: CreateUser) {
    return { data: await this.users.createUser(body), message: 'created' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Change an account´s name, password or admin flag' })
  public async update(@Param('id') id: string, @Body(zodBody(updateUserSchema)) body: UpdateUser) {
    return { data: await this.users.updateUser(id, body as CreateUser), message: 'updated' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an account' })
  public async remove(@Param('id') id: string) {
    return { data: await this.users.deleteUser(id), message: 'deleted' };
  }
}
