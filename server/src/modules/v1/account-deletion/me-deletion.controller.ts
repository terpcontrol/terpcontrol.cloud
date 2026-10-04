import { Controller, Delete, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@common/auth/auth.guard';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { AuthContext } from '@common/auth/token.service';
import { accountOf } from '../caller';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Leaving: the account and everything it is.
 *
 * It sits here rather than beside the other account routes so that the account
 * module does not have to import the cascade - the cascade needs the sessions,
 * and the sessions are built on the account.
 */
@ApiTags('account')
@Controller('v1')
@UseGuards(AuthGuard)
export class MeDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  /**
   * The answer comes when the deletion is done rather than when it is started,
   * so what a client reads next is a server that has already forgotten the
   * account. An account with years of pictures makes this a long request.
   */
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete this account and everything it owns' })
  @ApiNoContentResponse({ description: 'The account is gone, and the devices it had claimed are claimable again.' })
  public remove(@CurrentUser() caller: AuthContext): Promise<void> {
    return this.deletion.deleteAccount(accountOf(caller));
  }
}
