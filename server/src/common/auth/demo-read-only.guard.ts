import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { isUnder, routePath } from '@common/route-path';
import { DEMO_WRITE_MESSAGE } from '@utils/demo';
import { AuthenticatedRequest, TokenService } from './token.service';

/**
 * What a demo session may still do, which is end itself and start again: the
 * tour has to be leavable, and `DELETE /v1/sessions/{id}` is how a client signs
 * itself out. Everything else that opens a session is called without one and is
 * never seen by this guard at all.
 */
const DEMO_ALLOWED_PREFIXES = ['/v1/sessions'];

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
    // The router ignores a trailing slash as well as case, so the allow-list does too.
    const path = routePath(request.url).replace(/\/+$/, '') || '/';

    if (READ_METHODS.includes(request.method) || DEMO_ALLOWED_PREFIXES.some(allowed => isUnder(path, allowed))) {
      return true;
    }

    const token = await this.tokens.verifyFirst(request, 'user');
    if (token?.is_demo) {
      throw new HttpException(DEMO_WRITE_MESSAGE, 403);
    }

    return true;
  }
}
