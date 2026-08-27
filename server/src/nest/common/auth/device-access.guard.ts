import { applyDecorators, BadRequestException, CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorKey } from '../zod-validation.pipe';
import { DeviceAccessService } from './device-access.service';
import { AuthenticatedRequest, TokenType } from './token.service';

export type DeviceIdSource = 'params' | 'body';

const DEVICE_ID_SOURCE = 'device-id-source';
const DEVICE_ID_ERROR_KEY = 'device-id-error-key';
const DEVICE_TOKEN_TYPE = 'device-token-type';

/**
 * Where in the request the device id sits; defaults to the route parameter.
 * `errorKey` picks the shape of the refusal for a request that names no device,
 * because a few routes have always answered `{ error }` rather than
 * `{ message }`.
 */
export const DeviceIdFrom = (source: DeviceIdSource, errorKey: ErrorKey = 'message') =>
  applyDecorators(SetMetadata(DEVICE_ID_SOURCE, source), SetMetadata(DEVICE_ID_ERROR_KEY, errorKey));

/** The picture routes authorize the long-lived image token as well. */
export const DeviceTokenType = (tokenType: TokenType) => SetMetadata(DEVICE_TOKEN_TYPE, tokenType);

const readDeviceId = (request: AuthenticatedRequest, source: DeviceIdSource): string => {
  const container = (source === 'body' ? request.body : request.params) as Record<string, unknown> | undefined;
  const value = container?.['device_id'];
  return typeof value === 'string' ? value : '';
};

/** Resolves where the device id lives and hands the decision to the access service. */
abstract class BaseDeviceGuard implements CanActivate {
  constructor(protected readonly access: DeviceAccessService, protected readonly reflector: Reflector) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const source = this.reflector.getAllAndOverride<DeviceIdSource>(DEVICE_ID_SOURCE, [context.getHandler(), context.getClass()]) ?? 'params';
    const tokenType = this.reflector.getAllAndOverride<TokenType>(DEVICE_TOKEN_TYPE, [context.getHandler(), context.getClass()]) ?? 'user';

    const deviceId = readDeviceId(request, source);
    // A request that names no device is malformed rather than forbidden. The
    // guard runs before the body is validated, so it answers that itself.
    if (!deviceId) {
      const errorKey = this.reflector.getAllAndOverride<ErrorKey>(DEVICE_ID_ERROR_KEY, [context.getHandler(), context.getClass()]) ?? 'message';
      throw new BadRequestException(errorKey === 'error' ? { error: 'Missing device_id' } : 'device_id is required');
    }

    await this.check(request, deviceId, tokenType);
    return true;
  }

  protected abstract check(request: AuthenticatedRequest, deviceId: string, tokenType: TokenType): Promise<void>;
}

/** Ownership (or admin) only - no share link may stand in. */
@Injectable()
export class DeviceOwnerGuard extends BaseDeviceGuard {
  // Declared explicitly: TypeScript only emits the parameter types a subclass
  // needs for injection when the subclass has its own constructor.
  constructor(access: DeviceAccessService, reflector: Reflector) {
    super(access, reflector);
  }

  protected check(request: AuthenticatedRequest, deviceId: string, tokenType: TokenType): Promise<void> {
    return this.access.requireOwner(request, deviceId, tokenType);
  }
}

/** Ownership, admin, or a live share link for this device. */
@Injectable()
export class DeviceAccessGuard extends BaseDeviceGuard {
  constructor(access: DeviceAccessService, reflector: Reflector) {
    super(access, reflector);
  }

  protected check(request: AuthenticatedRequest, deviceId: string, tokenType: TokenType): Promise<void> {
    return this.access.requireAccess(request, deviceId, tokenType);
  }
}
