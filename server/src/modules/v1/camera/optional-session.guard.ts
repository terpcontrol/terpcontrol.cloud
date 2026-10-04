import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest, isMediaRead, TokenService } from '@common/auth/token.service';

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

    const token = await this.tokens.verifyFirst(request, isMediaRead(request) ? 'image' : 'user');
    const caller = token && (await this.tokens.resolve(token));
    if (caller && token) {
      request.auth = caller;
      request.authTokenType = token.token_type;
    }

    return true;
  }
}
