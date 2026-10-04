import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthContext, AuthenticatedRequest } from './token.service';

/** The caller a guard put on the request. Only valid behind one of the auth guards. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.auth ?? { userId: '', isAdmin: false, isDemo: false, sessionId: null };
});
