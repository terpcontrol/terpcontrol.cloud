import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ShareLink } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import shareModel from '@models/share.model';
import { PlainTextException } from '../http-exception.filter';
import { AuthenticatedRequest, TokenService, TokenType } from './token.service';

export type DeviceIdSource = 'params' | 'body';

const DEVICE_ID_SOURCE = 'device-id-source';
const DEVICE_TOKEN_TYPE = 'device-token-type';

/** Where in the request the device id sits; defaults to the route parameter. */
export const DeviceIdFrom = (source: DeviceIdSource) => SetMetadata(DEVICE_ID_SOURCE, source);

/** The picture routes authorize the long-lived image token as well. */
export const DeviceTokenType = (tokenType: TokenType) => SetMetadata(DEVICE_TOKEN_TYPE, tokenType);

const readDeviceId = (request: AuthenticatedRequest, source: DeviceIdSource): string => {
  const container = (source === 'body' ? request.body : request.params) as Record<string, unknown> | undefined;
  const value = container?.['device_id'];
  return typeof value === 'string' ? value : '';
};

// Demo sessions reach exactly the devices flagged as demo devices.
const isDemoDevice = async (deviceId: string): Promise<boolean> =>
  (await deviceModel.countDocuments({ device_id: deviceId, demoDevice: true })) > 0;

const isOwnedBy = async (deviceId: string, userId: string): Promise<boolean> =>
  (await deviceModel.countDocuments({ owner_id: userId, device_id: deviceId })) > 0;

const shareTokenOf = (request: AuthenticatedRequest): string | null => {
  const fromQuery = (request.query as Record<string, unknown> | undefined)?.share;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

  const fromHeader = request.headers['x-share-token'];
  return typeof fromHeader === 'string' && fromHeader ? fromHeader : null;
};

const findValidShare = async (request: AuthenticatedRequest, deviceId: string): Promise<ShareLink | null> => {
  const token = shareTokenOf(request);
  if (!token) return null;

  return shareModel.findOne({
    share_id: token,
    ...(deviceId ? { device_id: deviceId } : {}),
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: Date.now() } }],
  });
};

/**
 * Base for the two device checks: resolves the caller, then leaves the decision
 * about a caller who is neither owner nor admin to the subclass.
 */
abstract class BaseDeviceGuard implements CanActivate {
  constructor(protected readonly tokens: TokenService, protected readonly reflector: Reflector) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const source = this.reflector.getAllAndOverride<DeviceIdSource>(DEVICE_ID_SOURCE, [context.getHandler(), context.getClass()]) ?? 'params';
    const tokenType = this.reflector.getAllAndOverride<TokenType>(DEVICE_TOKEN_TYPE, [context.getHandler(), context.getClass()]) ?? 'user';

    const deviceId = readDeviceId(request, source);
    const hasToken = this.tokens.candidates(request).length > 0;
    const token = await this.tokens.verifyFirst(request, tokenType);

    if (token) {
      request.auth = this.tokens.toContext(token);

      if (request.auth.isAdmin) return true;
      if (request.auth.isDemo ? await isDemoDevice(deviceId) : await isOwnedBy(deviceId, request.auth.userId)) {
        return true;
      }
    }

    return this.refuse(request, deviceId, { hasToken, authenticated: !!token });
  }

  protected abstract refuse(
    request: AuthenticatedRequest,
    deviceId: string,
    caller: { hasToken: boolean; authenticated: boolean },
  ): Promise<boolean>;
}

/** Ownership (or admin) only - no share link may stand in. */
@Injectable()
export class DeviceOwnerGuard extends BaseDeviceGuard {
  protected async refuse(request: AuthenticatedRequest, deviceId: string, caller: { hasToken: boolean; authenticated: boolean }): Promise<boolean> {
    if (!caller.hasToken) throw new PlainTextException(401, 'Authentication token missing');
    if (!caller.authenticated) throw new PlainTextException(401, 'Wrong authentication token');

    throw new PlainTextException(403, `Device ${deviceId} not bound to user ${request.auth?.userId}`);
  }
}

/** Ownership, admin, or a live share link for this device. */
@Injectable()
export class DeviceAccessGuard extends BaseDeviceGuard {
  protected async refuse(request: AuthenticatedRequest, deviceId: string, caller: { hasToken: boolean; authenticated: boolean }): Promise<boolean> {
    const share = await findValidShare(request, deviceId);
    if (share) {
      request.share = share;
      return true;
    }

    // 401 only when the session itself is the problem, so clients can tell "log
    // in again" apart from "this account may not see this device".
    if (caller.authenticated) throw new PlainTextException(403, 'No access to device');
    throw new PlainTextException(401, caller.hasToken ? 'Wrong authentication token' : 'Authentication token missing');
  }
}
