import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiShape } from '@common/api-shape';
import { AccountResult, UserAccount } from '@fg2/shared-types';
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
  @ApiShape(['UserAccount'])
  public list(): Promise<UserAccount[]> {
    return this.users.findAllUser();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One account, by its database id' })
  @ApiShape('AccountResult')
  public async byId(@Param('id') id: string): Promise<AccountResult> {
    return { data: await this.users.findUserById(id), message: 'findOne' };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an account' })
  @ApiShape('AccountResult', { status: HttpStatus.CREATED })
  public async create(@Body(zodBody(createUserSchema)) body: CreateUser): Promise<AccountResult> {
    return { data: await this.users.createUser(body), message: 'created' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Change an account´s name, password or admin flag' })
  @ApiShape('AccountResult')
  public async update(@Param('id') id: string, @Body(zodBody(updateUserSchema)) body: UpdateUser): Promise<AccountResult> {
    return { data: await this.users.updateUser(id, body as CreateUser), message: 'updated' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an account' })
  @ApiShape('AccountResult')
  public async remove(@Param('id') id: string): Promise<AccountResult> {
    return { data: await this.users.deleteUser(id), message: 'deleted' };
  }
}
