import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DeviceIdFrom, DeviceOwnerGuard } from '../../common/auth/device-access.guard';
import { AuthContext } from '../../common/auth/token.service';
import { zodBodyAsError } from '../../common/zod-validation.pipe';
import { CreateShare, createShareSchema } from './share.schemas';
import { ShareService } from './share.service';

@ApiTags('share links')
@Controller('share')
export class ShareController {
  constructor(private readonly shares: ShareService) {}

  @Get('resolve/:share_id')
  @ApiOperation({ summary: 'Open a share link: what the visitor is allowed to see' })
  public resolve(@Param('share_id') shareId: string) {
    return this.shares.resolve(shareId);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The links the calling user has handed out' })
  public list(@CurrentUser() user: AuthContext) {
    return this.shares.list(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body', 'error')
  @ApiOperation({ summary: 'Hand out a link to one of the caller´s devices' })
  public create(@CurrentUser() user: AuthContext, @Body(zodBodyAsError(createShareSchema)) body: CreateShare) {
    return this.shares.create(user.userId, body);
  }

  @Post(':share_id/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Stop a link from working, keeping it in the list' })
  public revoke(@CurrentUser() user: AuthContext, @Param('share_id') shareId: string) {
    return this.shares.revoke(user.userId, shareId);
  }

  // Ahead of the parameterised delete, which would otherwise read "inactive" as an id.
  @Delete('inactive')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete every revoked or expired link of the caller' })
  public async removeInactive(@CurrentUser() user: AuthContext) {
    return { status: 'ok', deleted: await this.shares.removeInactive(user.userId) };
  }

  @Delete(':share_id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete a link that is already revoked or expired' })
  public async remove(@CurrentUser() user: AuthContext, @Param('share_id') shareId: string) {
    await this.shares.remove(user.userId, shareId);
    return { status: 'ok' };
  }
}
