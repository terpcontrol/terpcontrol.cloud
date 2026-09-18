import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '@common/auth/token.service';
import { AccessService } from './access.service';
import { AccessContext, Grant, Need, SubjectType } from './access.types';
import { badRequest } from './problem';

/**
 * How a route says what it is allowed to do: `@Requires('manage', 'device')` on
 * the handler, and the guard makes the decision before the handler runs. The
 * need each route declares is the checklist that says what a membership widens,
 * so it is written where the route is and nowhere else.
 *
 * A route whose subject is not a path parameter - creating something, or a list -
 * asks `AccessService` itself, with the subject it worked out.
 */

interface AccessRequirement {
  need: Need;
  subject: SubjectType;
  param: string;
}

const ACCESS_REQUIREMENT = 'v1:access';

/** `param` is the path parameter naming the subject, `id` unless the route spells it otherwise. */
export const Requires = (need: Need, subject: SubjectType, param = 'id'): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_REQUIREMENT, { need, subject, param });

/** A request that has been through the guard carries what it decided. */
export interface AccessRequest extends AuthenticatedRequest {
  grant?: Grant;
}

/**
 * A caller's identity for the decision: the session an auth guard verified, or a
 * share link's token, or neither.
 *
 * The token is read from a header and from the query string, because a picture
 * is fetched by `<img>`, which cannot set a header - the same reason the image
 * token has always been allowed there.
 */
const SHARE_HEADER = 'x-share-token';
const SHARE_PARAMETER = 'share';

export const accessContextOf = (request: AccessRequest): AccessContext => ({
  userId: request.auth?.userId || null,
  isAdmin: request.auth?.isAdmin === true,
  isDemo: request.auth?.isDemo === true,
  shareToken: shareTokenOf(request),
});

const shareTokenOf = (request: AccessRequest): string | null => {
  const header = request.headers[SHARE_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader) return fromHeader;

  const query = (request.query ?? {}) as Record<string, unknown>;
  return typeof query[SHARE_PARAMETER] === 'string' && query[SHARE_PARAMETER] ? (query[SHARE_PARAMETER] as string) : null;
};

/**
 * Decides, it does not authenticate: who the caller is has been established by
 * an auth guard before this, or by nothing at all, which is what a public page
 * and a share link are.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<AccessRequirement | undefined>(ACCESS_REQUIREMENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest<AccessRequest>();
    const id = (request.params as Record<string, string | undefined> | undefined)?.[requirement.param];
    if (!id) throw badRequest('missing_subject', `This route is about a ${requirement.subject} named in its path.`);

    request.grant = await this.access.require(accessContextOf(request), { type: requirement.subject, id }, requirement.need);
    return true;
  }
}

/** What the guard decided: the window a read clamps to, and how much of the answer is serialised. */
export const CurrentGrant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Grant | undefined => context.switchToHttp().getRequest<AccessRequest>().grant,
);

/** The caller, for a route that asks `AccessService` about a subject of its own. */
export const Caller = createParamDecorator((_data: unknown, context: ExecutionContext): AccessContext =>
  accessContextOf(context.switchToHttp().getRequest<AccessRequest>()),
);
