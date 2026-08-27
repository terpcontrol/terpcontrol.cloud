import { Injectable } from '@nestjs/common';
import { ShareLink } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import shareModel from '@models/share.model';
import { PlainTextException } from '../http-exception.filter';
import { AuthenticatedRequest, TokenService, TokenType } from './token.service';

// Demo sessions reach exactly the devices flagged as demo devices.
const isDemoDevice = async (deviceId: string): Promise<boolean> => (await deviceModel.countDocuments({ device_id: deviceId, demoDevice: true })) > 0;

const isOwnedBy = async (deviceId: string, userId: string): Promise<boolean> =>
  (await deviceModel.countDocuments({ owner_id: userId, device_id: deviceId })) > 0;

const shareTokenOf = (request: AuthenticatedRequest): string | null => {
  const fromQuery = (request.query as Record<string, unknown> | undefined)?.share;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

  const fromHeader = request.headers['x-share-token'];
  return typeof fromHeader === 'string' && fromHeader ? fromHeader : null;
};

/**
 * Who may touch a device. Guards use it for the routes that name the device in
 * the URL or the body; a handler that only learns the device after a lookup of
 * its own calls the same methods directly.
 */
@Injectable()
export class DeviceAccessService {
  constructor(private readonly tokens: TokenService) {}

  /** True when the caller owns the device, is an admin, or is a demo session on a demo device. */
  public async authenticate(
    request: AuthenticatedRequest,
    deviceId: string,
    tokenType: TokenType = 'user',
  ): Promise<{ allowed: boolean; hasToken: boolean; authenticated: boolean }> {
    const hasToken = this.tokens.candidates(request).length > 0;
    const token = await this.tokens.verifyFirst(request, tokenType);

    if (!token) {
      return { allowed: false, hasToken, authenticated: false };
    }

    request.auth = this.tokens.toContext(token);

    if (request.auth.isAdmin) return { allowed: true, hasToken, authenticated: true };

    const allowed = request.auth.isDemo ? await isDemoDevice(deviceId) : await isOwnedBy(deviceId, request.auth.userId);
    return { allowed, hasToken, authenticated: true };
  }

  public findValidShare(request: AuthenticatedRequest, deviceId: string): Promise<ShareLink | null> {
    const token = shareTokenOf(request);
    if (!token) return Promise.resolve(null);

    return shareModel.findOne({
      share_id: token,
      ...(deviceId ? { device_id: deviceId } : {}),
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: Date.now() } }],
    });
  }

  /** Ownership (or admin) only - no share link may stand in. */
  public async requireOwner(request: AuthenticatedRequest, deviceId: string, tokenType: TokenType = 'user'): Promise<void> {
    const result = await this.authenticate(request, deviceId, tokenType);
    if (result.allowed) return;

    if (!result.hasToken) throw new PlainTextException(401, 'Authentication token missing');
    if (!result.authenticated) throw new PlainTextException(401, 'Wrong authentication token');

    throw new PlainTextException(403, `Device ${deviceId} not bound to user ${request.auth?.userId}`);
  }

  /** Ownership, admin, or a live share link for this device. */
  public async requireAccess(request: AuthenticatedRequest, deviceId: string, tokenType: TokenType = 'user'): Promise<void> {
    const result = await this.authenticate(request, deviceId, tokenType);
    if (result.allowed) return;

    const share = await this.findValidShare(request, deviceId);
    if (share) {
      request.share = share;
      return;
    }

    // 401 only when the session itself is the problem, so clients can tell "log
    // in again" apart from "this account may not see this device".
    if (result.authenticated) throw new PlainTextException(403, 'No access to device');
    throw new PlainTextException(401, result.hasToken ? 'Wrong authentication token' : 'Authentication token missing');
  }
}
