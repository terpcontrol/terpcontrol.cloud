import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { HttpException } from '@exceptions/HttpException';
import { DEMO_WRITE_MESSAGE } from '@utils/demo';
import { AuthenticatedRequest, TokenService } from './token.service';

// Endpoints that establish or end a session; they must keep working while a demo
// session is open, and none of them touches device data.
const DEMO_ALLOWED_PATHS = ['/login', '/demologin', '/tokenlogin', '/signup', '/activate', '/refresh', '/logout', '/getreset', '/reset'];

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * A demo session may read, nothing else. Applied globally so no write endpoint
 * can be forgotten, now or when new ones are added.
 */
@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // The router ignores a trailing slash, so the allow-list has to as well.
    const path = (request.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

    if (READ_METHODS.includes(request.method) || DEMO_ALLOWED_PATHS.includes(path)) {
      return true;
    }

    const token = await this.tokens.verifyFirst(request, 'user');
    if (token?.is_demo) {
      throw new HttpException(403, DEMO_WRITE_MESSAGE);
    }

    return true;
  }
}
