import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { HttpException } from '@common/http-exception';
import { AuthenticatedRequest, TokenService } from './token.service';

/** Requires a valid user session and puts it on the request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(protected readonly tokens: TokenService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (this.tokens.candidates(request).length === 0) {
      throw new HttpException(401, 'Authentication token missing');
    }

    const token = await this.tokens.verifyFirst(request, 'user');
    const caller = token && (await this.tokens.resolve(token));
    if (!caller) {
      throw new HttpException(401, 'Wrong authentication token');
    }

    request.auth = caller;
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

    const hasToken =
      !!(request as { cookies?: Record<string, string> }).cookies?.['Authorization'] || !!request.headers.authorization?.split('Bearer ')[1];
    if (!hasToken) {
      throw new HttpException(401, 'Authentication token missing');
    }

    const token = await this.tokens.verifySessionToken(request);
    if (!token || token.token_type !== 'user') {
      throw new HttpException(401, 'Wrong authentication token');
    }

    // The token says who it was; the account row says whether that is still
    // true, and whether it is still an account at all.
    const caller = await this.tokens.resolve(token);
    if (!caller) {
      throw new HttpException(401, 'Wrong authentication token');
    }

    // Signed in, and simply not allowed here - a demo session, or an account
    // that is not an administrator. Answering 401 to that reads as a dead token
    // to any client that refreshes on one, so somebody who is only not an
    // administrator is signed out of the application instead of being told no.
    if (!caller.isAdmin || caller.isDemo) {
      throw new HttpException(403, 'This is for administrators.');
    }

    request.auth = caller;
    return true;
  }
}
