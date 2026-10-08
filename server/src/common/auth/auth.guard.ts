import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthContext, AuthenticatedRequest, TokenService, isMediaRead, sessionCredential } from './token.service';

/** Requires a valid user session and puts it on the request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (this.tokens.candidates(request).length === 0) {
      throw new HttpException('Authentication token missing', 401);
    }

    if (!(await this.tokens.authenticate(request, 'user'))) {
      throw new HttpException('Wrong authentication token', 401);
    }

    return true;
  }
}

/**
 * A session where there is one, and nobody where there is not.
 *
 * `AccessGuard` decides but does not authenticate, and a picture of a camera is
 * read by three kinds of caller: its owner with a session, a stranger with a
 * share link, and nobody at all on a public page. A guard that refused the last
 * two would make every such route a member-only route.
 *
 * A token that is present and no longer answers to anybody is simply not a
 * session - whether it was never signed here, or its session has been revoked,
 * or the account it named is gone. The decision then has a share link to go on,
 * or refuses on its own.
 *
 * The image token is minted for thirty days and is meant to sit in a URL; that
 * is right for a picture and wrong for anything else. So it is a session on the
 * media reads only: anywhere else behind this guard it is nobody, and a copied
 * picture address opens that picture rather than the diary, the tent and the
 * cameras around it. Which kind of token proved it is put on the request too,
 * because one media row - an export - is not a picture either.
 */
@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.tokens.authenticate(request, isMediaRead(request) ? 'image' : 'user');
    return true;
  }
}

/**
 * Requires an admin session. Unlike the user guard it never looks at the
 * URL-embeddable image token, and a demo session is refused outright.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = await this.admit(request);
    return true;
  }

  /**
   * The administrator behind a request, or the refusal for anybody else. Apart
   * from `canActivate` because a route that takes a large body asks it before
   * that body is read, which is before any guard runs.
   */
  public async admit(request: FastifyRequest): Promise<AuthContext> {
    if (!sessionCredential(request)) {
      throw new HttpException('Authentication token missing', 401);
    }

    const token = await this.tokens.verifySessionToken(request);
    if (!token || token.token_type !== 'user') {
      throw new HttpException('Wrong authentication token', 401);
    }

    // The token says who it was; the account row says whether that is still
    // true, and whether it is still an account at all.
    const caller = await this.tokens.resolve(token);
    if (!caller) {
      throw new HttpException('Wrong authentication token', 401);
    }

    // Signed in, and simply not allowed here - a demo session, or an account
    // that is not an administrator. Answering 401 to that reads as a dead token
    // to any client that refreshes on one, so somebody who is only not an
    // administrator is signed out of the application instead of being told no.
    if (!caller.isAdmin || caller.isDemo) {
      throw new HttpException('This is for administrators.', 403);
    }

    return caller;
  }
}
