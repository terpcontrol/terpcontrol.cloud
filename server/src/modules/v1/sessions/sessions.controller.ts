import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AutomationSession, SessionCreate, SessionPage, SessionResult, SessionTokens } from '@fg2/shared-types/v1';
import {
  automationSession,
  automationSessionCreate,
  sessionCreate,
  sessionPage,
  sessionRefresh,
  sessionResult,
  sessionTokens,
} from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { AuthContext } from '@common/auth/token.service';
import { RateLimited, RateLimitGuard } from '@common/rate-limit.guard';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { PUBLIC_OPERATION } from '../../../openapi';
import { V1Answer } from '../answer-shape';
import { accountOf } from '../caller';
import { SessionsService } from './sessions.service';

const MINUTE = 60 * 1000;

/** Which browser this is, so that a person can tell two of their own sessions apart. */
const userAgentOf = (request: FastifyRequest): string | null => {
  const reported = request.headers['user-agent'];
  return typeof reported === 'string' && reported.length > 0 ? reported : null;
};

/**
 * Signing in, and everything that follows from it.
 *
 * The three ways in have budgets of their own on purpose: demo visitors behind
 * one address must not be able to throttle the sign-in of the people who have an
 * account here, and neither must a script working through the automation token.
 *
 * Opening a session answers 201 because one is created: it is a row that the
 * account screen lists and that `DELETE` below ends. Renewing one answers 200,
 * because it replaces the tokens of a session that already exists.
 */
@ApiTags('sessions')
@Controller('v1/sessions')
@UseGuards(RateLimitGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimited({ limit: 10, windowMs: MINUTE, message: 'Too many sign-in attempts, please try again later.' })
  @ApiOperation({ summary: 'Sign in with an e-mail address and password', ...PUBLIC_OPERATION })
  @V1Answer(sessionResult, { status: HttpStatus.CREATED })
  public logIn(@V1Body(sessionCreate) body: SessionCreate, @Req() request: FastifyRequest): Promise<SessionResult> {
    return this.sessions.logIn(body.email, body.password, body.stayLoggedIn === true, userAgentOf(request));
  }

  /**
   * Takes no arguments at all, and therefore reads no body: a client that has to
   * send `{}` to open the demo would be sending it because a schema wanted it,
   * not because the route did.
   */
  @Post('demo')
  @HttpCode(HttpStatus.CREATED)
  @RateLimited({ limit: 20, windowMs: MINUTE, message: 'Too many demo sessions, please try again later.' })
  @ApiOperation({ summary: 'Open the read-only demo, without an account', ...PUBLIC_OPERATION })
  @V1Answer(sessionResult, { status: HttpStatus.CREATED })
  public demo(@Req() request: FastifyRequest): Promise<SessionResult> {
    return this.sessions.openDemo(userAgentOf(request));
  }

  @Post('automation')
  @HttpCode(HttpStatus.OK)
  @RateLimited({ limit: 20, windowMs: MINUTE, message: 'Too many automation sign-ins, please try again later.' })
  @ApiOperation({ summary: "Trade the install's automation token for a short administrator session", ...PUBLIC_OPERATION })
  @V1Answer(automationSession)
  public automation(@V1Body(automationSessionCreate) body: { token: string }): AutomationSession {
    return this.sessions.automation(body.token);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Spend a refresh token for a fresh set of tokens', ...PUBLIC_OPERATION })
  @V1Answer(sessionTokens)
  public refresh(@V1Body(sessionRefresh) body: { refreshToken: string }): Promise<SessionTokens> {
    return this.sessions.refresh(body.refreshToken);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The sessions this account is signed in with' })
  @V1Answer(sessionPage)
  public list(@CurrentUser() caller: AuthContext, @V1Query(pageQuery) query: PageQuery): Promise<SessionPage> {
    return this.sessions.list(accountOf(caller), query);
  }

  @Delete()
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End every other session of this account, keeping the one asking' })
  @ApiNoContentResponse({ description: 'The other sessions are gone.' })
  public async revokeOthers(@CurrentUser() caller: AuthContext): Promise<void> {
    await this.sessions.revokeOthers(accountOf(caller), caller.sessionId);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End one session, which is also how a client signs itself out' })
  @ApiNoContentResponse({ description: 'The session is gone.' })
  public revoke(@CurrentUser() caller: AuthContext, @Param('id') id: string): Promise<void> {
    return this.sessions.revoke(accountOf(caller), id);
  }
}
