import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminUserCreate, AdminUserPage, AdminUserUpdate, User } from '@fg2/shared-types/v1';
import { adminUserCreate, adminUserPage, adminUserUpdate, user as userShape } from '@fg2/shared-types/v1-schemas';
import { AdminGuard } from '@common/auth/auth.guard';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { AccountDeletionService } from '../account-deletion/account-deletion.service';
import { AccountsService } from '../account/accounts.service';

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
    private readonly deletion: AccountDeletionService,
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
   * The same deletion an account starts for itself, so that what an
   * administrator removes and what a person removes are one thing: the account,
   * everything it owned, and the claims it held on hardware that is still out
   * there. The account this install is configured with is refused, because it is
   * written back by its address on every start.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an account' })
  @ApiNoContentResponse({ description: 'The account is gone, and the devices it had claimed are claimable again.' })
  public remove(@Param('id') id: string): Promise<void> {
    return this.deletion.deleteAccount(id);
  }
}
