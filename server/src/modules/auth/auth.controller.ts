import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { verify } from 'jsonwebtoken';
import { HttpException } from '@common/http-exception';
import { DataStoredInToken, TokenData } from '@common/auth/auth.interface';
import { AuthService } from './auth.service';
import { DEMO_USER_ID } from '@utils/demo';
import { logger } from '@utils/logger';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthContext } from '../../common/auth/token.service';
import { authConfig } from '../../config/configuration';
import { RateLimited, RateLimitGuard } from '../../common/rate-limit.guard';
import { zodBody } from '../../common/zod-validation.pipe';
import { Activation, activationSchema, Login, loginSchema, PasswordReset, passwordResetSchema, Signup, signupSchema } from './auth.schemas';
import { PUBLIC_OPERATION } from '../../openapi';

const MINUTE = 60 * 1000;

@ApiTags('authentication')
@Controller()
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @RateLimited({ limit: 5, windowMs: MINUTE, message: 'Too many sign-up attempts, please try again later.' })
  @ApiOperation({ summary: 'Create an account', ...PUBLIC_OPERATION })
  public async signUp(@Body(zodBody(signupSchema)) body: Signup) {
    const user = await this.auth.signup(body);

    // Never the password hash, and never the activation code: the endpoint is
    // open, so anyone could otherwise activate an address they do not own.
    return { data: { username: user.username, user_id: user.user_id, is_active: user.is_active }, message: 'signup' };
  }

  @Post('activate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Activate an account with the code from its activation mail', ...PUBLIC_OPERATION })
  public async activate(@Body(zodBody(activationSchema)) body: Activation) {
    await this.auth.activate(body);
    return { message: 'activated' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimited({ limit: 10, windowMs: MINUTE, message: 'Too many login attempts, please try again later.' })
  @ApiOperation({ summary: 'Sign in with a username and password', ...PUBLIC_OPERATION })
  public async logIn(@Body(zodBody(loginSchema)) body: Login, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { userToken, refreshToken, imageToken, findUser } = await this.auth.login(body);

    this.setAuthCookie(request, reply, userToken);

    return {
      user: { username: findUser.username, user_id: findUser.user_id, is_admin: findUser.is_admin },
      userToken,
      refreshToken,
      imageToken,
    };
  }

  // Separate budget from the login endpoint so demo visitors behind one address
  // cannot throttle the sign-in of the people who have an account there.
  @Post('demologin')
  @HttpCode(HttpStatus.OK)
  @RateLimited({ limit: 20, windowMs: MINUTE, message: 'Too many demo-login attempts, please try again later.' })
  @ApiOperation({ summary: 'Open the read-only demo, without an account', ...PUBLIC_OPERATION })
  public demoLogIn(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { userToken, refreshToken, imageToken } = this.auth.demoLogin();

    this.setAuthCookie(request, reply, userToken);

    return {
      user: { username: 'demo', user_id: DEMO_USER_ID, is_admin: false, is_demo: true },
      userToken,
      refreshToken,
      imageToken,
    };
  }

  @Post('tokenlogin')
  @HttpCode(HttpStatus.OK)
  @RateLimited({ limit: 20, windowMs: MINUTE, message: 'Too many token-login attempts, please try again later.' })
  @ApiOperation({ summary: 'Exchange the automation token for a short admin session', ...PUBLIC_OPERATION })
  public async loginWithToken(@Body() body: { token?: unknown }, @Req() request: FastifyRequest) {
    try {
      return await this.auth.loginWithToken(body?.token as string);
    } catch (error) {
      if (error instanceof HttpException && error.status === 401) {
        logger.warn(`[/tokenlogin] auth failure from ip=${request.ip} ua="${request.headers['user-agent'] ?? ''}"`);
      }
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trade a refresh token for a fresh set of tokens', ...PUBLIC_OPERATION })
  public async refresh(@Body() body: { token?: unknown }, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = body?.token;
    if (!token || typeof token !== 'string') {
      throw new HttpException(401, 'Authentication token missing');
    }

    let verified: DataStoredInToken;
    try {
      verified = (await verify(token, this.config.secretKey)) as DataStoredInToken;
    } catch {
      throw new HttpException(401, 'Wrong authentication token');
    }

    if (!verified.user_id || verified.token_type !== 'refresh') {
      throw new HttpException(401, 'Wrong authentication token');
    }

    const tokens = await this.auth.refresh(verified);
    this.setAuthCookie(request, reply, tokens.userToken);

    return tokens;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Clear the session cookie' })
  public logOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply.clearCookie('Authorization', { httpOnly: true, sameSite: 'lax', secure: request.protocol === 'https', path: '/' });
    return {};
  }

  @Post('changepass')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Set a new password for the calling account' })
  public async changePassword(@CurrentUser() user: AuthContext, @Body(zodBody(loginSchema)) body: Login) {
    await this.auth.changePassword(user.userId, body.password);
    return {};
  }

  @Post('getreset')
  @HttpCode(HttpStatus.CREATED)
  @RateLimited({ limit: 5, windowMs: MINUTE, message: 'Too many password-reset requests, please try again later.' })
  @ApiOperation({ summary: 'Mail a password recovery link', ...PUBLIC_OPERATION })
  public async getPasswordToken(@Body(zodBody(loginSchema)) body: Login) {
    await this.auth.generatePasswordToken(body.username);
    return { message: 'sent' };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password with a recovery token', ...PUBLIC_OPERATION })
  public async resetPassword(@Body(zodBody(passwordResetSchema)) body: PasswordReset) {
    await this.auth.changePasswordWithToken(body.token, body.password);
    return {};
  }

  /**
   * Issues the Authorization cookie for the just-minted user token. Secure is
   * set only when the original request reached us over HTTPS so plain-HTTP
   * deployments keep working; this relies on the proxy hop being trusted, which
   * is what recovers the original protocol.
   */
  private setAuthCookie(request: FastifyRequest, reply: FastifyReply, token: TokenData): void {
    void reply.setCookie('Authorization', token.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.protocol === 'https',
      maxAge: token.expiresIn,
      path: '/',
    });
  }
}
