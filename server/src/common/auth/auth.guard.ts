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
    if (!token) {
      throw new HttpException(401, 'Wrong authentication token');
    }

    request.auth = this.tokens.toContext(token);
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
    if (!token?.is_admin || token.is_demo || token.token_type !== 'user') {
      throw new HttpException(401, 'Wrong authentication token');
    }

    request.auth = this.tokens.toContext(token);
    return true;
  }
}
