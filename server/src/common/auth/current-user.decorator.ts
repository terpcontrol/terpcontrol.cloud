import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ShareLink } from '@fg2/shared-types';
import { AuthContext, AuthenticatedRequest } from './token.service';

/** The caller a guard put on the request. Only valid behind one of the auth guards. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.auth ?? { userId: '', isAdmin: false, isDemo: false };
});

/** The share link the request came in on, when it did. */
export const CurrentShare = createParamDecorator((_data: unknown, context: ExecutionContext): ShareLink | undefined => {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().share;
});
