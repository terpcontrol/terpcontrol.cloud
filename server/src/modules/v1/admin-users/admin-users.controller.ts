import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminUserCreate, AdminUserPage, AdminUserUpdate, User } from '@fg2/shared-types/v1';
import { adminUserCreate, adminUserPage, adminUserUpdate, user as userShape } from '@fg2/shared-types/v1-schemas';
import { AdminGuard } from '@common/auth/auth.guard';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { AccountsService } from '../account/accounts.service';
import { PasswordResetService } from '../account/password-reset.service';
import { SessionsService } from '../sessions/sessions.service';

/**
 * The accounts, as an administrator manages them.
 *
 * An administrator is the one other reader of somebody's address and the only
 * reader of an activation code, which together are the whole of `User` - so
 * there is no narrower admin shape, and these routes answer the resource itself.
 */
@ApiTags('admin')
@Controller('v1/admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly resets: PasswordResetService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Every account' })
  @V1Answer(adminUserPage)
  public list(@V1Query(pageQuery) query: PageQuery): Promise<AdminUserPage> {
    return this.accounts.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an account' })
  @V1Answer(userShape, { status: HttpStatus.CREATED })
  public async create(@V1Body(adminUserCreate) body: AdminUserCreate): Promise<User> {
    return this.accounts.serialise(await this.accounts.createAsAdmin(body));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One account' })
  @V1Answer(userShape)
  public async byId(@Param('id') id: string): Promise<User> {
    return this.accounts.serialise(await this.accounts.require(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change an account, its password included' })
  @V1Answer(userShape)
  public async update(@Param('id') id: string, @V1Body(adminUserUpdate) body: AdminUserUpdate): Promise<User> {
    return this.accounts.serialise(await this.accounts.updateAsAdmin(id, body));
  }

  /**
   * The account, what it was signed in with and any recovery link outstanding
   * for it. What it owned - devices, spaces, grows - goes with the resumable
   * deletion an account starts for itself, and not from here.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an account' })
  @ApiNoContentResponse({ description: 'The account is gone.' })
  public async remove(@Param('id') id: string): Promise<void> {
    await this.accounts.remove(id);
    await this.sessions.revokeAllOf(id);
    await this.resets.retire(id);
  }
}
