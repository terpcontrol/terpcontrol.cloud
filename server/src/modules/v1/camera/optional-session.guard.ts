import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest, TokenService } from '@common/auth/token.service';

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
 */
@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = await this.tokens.verifyFirst(request, 'image');
    const caller = token && (await this.tokens.resolve(token));
    if (caller) request.auth = caller;

    return true;
  }
}
