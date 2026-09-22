import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Me,
  MeUpdate,
  PasswordChange,
  PasswordResetCreate,
  PasswordResetRedemption,
  SignupUser,
  UserActivation,
  UserCreate,
} from '@fg2/shared-types/v1';
import {
  me as meShape,
  meUpdate,
  passwordChange,
  passwordResetCreate,
  passwordResetRedemption,
  signupUser,
  userActivation,
  userCreate,
} from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { AuthContext } from '@common/auth/token.service';
import { RateLimited, RateLimitGuard } from '@common/rate-limit.guard';
import { unauthenticated } from '@common/v1/problem';
import { V1Body } from '@common/zod-validation.pipe';
import { PUBLIC_OPERATION } from '../../../openapi';
import { V1Answer } from '../answer-shape';
import { accountOf } from '../caller';
import { AccountsService } from './accounts.service';
import { PasswordResetService } from './password-reset.service';

const MINUTE = 60 * 1000;

/**
 * The account, from signing up to the settings screens.
 *
 * Three of these routes are open, and each of them is a way to learn who is
 * registered here if it answers carelessly: a sign-up says an address is taken,
 * which it has to, and is rate-limited for it; an activation and a password
 * reset say nothing at all about whether an address has an account.
 */
@ApiTags('account')
@Controller('v1')
@UseGuards(RateLimitGuard)
export class AccountController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly resets: PasswordResetService,
  ) {}

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @RateLimited({ limit: 5, windowMs: MINUTE, message: 'Too many sign-up attempts, please try again later.' })
  @ApiOperation({ summary: 'Sign up', ...PUBLIC_OPERATION })
  @V1Answer(signupUser, { status: HttpStatus.CREATED })
  public async signUp(@V1Body(userCreate) body: UserCreate): Promise<SignupUser> {
    const user = await this.accounts.signUp(body.email, body.handle, body.password);

    // Never the activation code: this route is open, so anyone could otherwise
    // activate an address they do not own.
    const { id, createdAt, email, handle, isActive } = this.accounts.serialise(user);
    return { id, createdAt, email, handle, isActive };
  }

  @Post('users/activations')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Activate an account with the code from its activation mail', ...PUBLIC_OPERATION })
  @ApiNoContentResponse({ description: 'The account is active; sign in with it like any other.' })
  public activate(@V1Body(userActivation) body: UserActivation): Promise<void> {
    return this.accounts.activate(body.activationCode);
  }

  @Post('password-resets')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimited({ limit: 5, windowMs: MINUTE, message: 'Too many password-reset requests, please try again later.' })
  @ApiOperation({ summary: 'Ask for a password recovery mail', ...PUBLIC_OPERATION })
  @ApiAcceptedResponse({ description: 'If that address has an account here, a mail is on its way to it.' })
  public request(@V1Body(passwordResetCreate) body: PasswordResetCreate): Promise<void> {
    return this.resets.request(body.email);
  }

  @Post('password-resets/:token/redemptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimited({ limit: 10, windowMs: MINUTE, message: 'Too many recovery attempts, please try again later.' })
  @ApiOperation({ summary: 'Set a new password with the token from a recovery mail', ...PUBLIC_OPERATION })
  @ApiNoContentResponse({ description: 'The password is changed; sign in with it.' })
  public redeem(@Param('token') token: string, @V1Body(passwordResetRedemption) body: PasswordResetRedemption): Promise<void> {
    return this.resets.redeem(token, body.password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The account this session belongs to' })
  @V1Answer(meShape)
  public async me(@CurrentUser() caller: AuthContext): Promise<Me> {
    return this.accounts.serialiseMe(await this.accounts.require(accountOf(caller)));
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Change what this account owns' })
  @V1Answer(meShape)
  public async update(@CurrentUser() caller: AuthContext, @V1Body(meUpdate) body: MeUpdate): Promise<Me> {
    return this.accounts.serialiseMe(await this.accounts.updateOwn(accountOf(caller), body));
  }

  /**
   * The current password is asked for again, and checked, because a stolen
   * session must not be able to keep itself by locking the owner out.
   */
  @Put('me/password')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimited({ limit: 10, windowMs: MINUTE, message: 'Too many password changes, please try again later.' })
  @ApiOperation({ summary: 'Change this account´s password' })
  @ApiNoContentResponse({ description: 'The password is changed.' })
  public async changePassword(@CurrentUser() caller: AuthContext, @V1Body(passwordChange) body: PasswordChange): Promise<void> {
    const user = await this.accounts.require(accountOf(caller));

    if (!(await this.accounts.verify(user.email, body.currentPassword))) {
      throw unauthenticated('current_password_wrong', 'That is not this account´s current password.');
    }

    await this.accounts.setPassword(user.id, body.newPassword);
    // A recovery link somebody asked for and then remembered their password
    // instead must not outlive the password it would have replaced.
    await this.resets.retire(user.id);
    // Neither must a browser somebody else is holding. Changing a password is
    // what people do when they think it has been seen, and a change that left
    // every other session signed in would be the one thing they were sure it
    // was not. This browser keeps its own session, because being signed out by
    // the act of securing the account is how people learn not to bother.
    await this.accounts.endOtherSessions(user.id, caller.sessionId);
  }
}
