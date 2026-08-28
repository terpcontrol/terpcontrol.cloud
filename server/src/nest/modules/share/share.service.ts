import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { DeviceAccessInfo, ShareLink } from '@fg2/shared-types';
import { MODEL } from '../../database/models.module';

import { DeviceService } from '../device/device.service';
import { CreateShare } from './share.schemas';

const MAX_QUERY_LENGTH = 2000;

// Matches expired (numeric expiresAt in the past) and revoked shares; a null
// expiresAt never matches $lt, so links without expiry stay untouched.
const inactiveShareFilter = () => ({ $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $lt: Date.now() } }] });

@Injectable()
export class ShareService {
  constructor(@InjectModel(MODEL.share) private readonly shares: Model<ShareLink & Document>, private readonly deviceService: DeviceService) {}

  public list(ownerId: string) {
    return this.shares.find({ owner_id: ownerId }).sort({ createdAt: -1 }).lean().exec();
  }

  public create(ownerId: string, request: CreateShare) {
    const expiresAt = request.expires_at === null || request.expires_at === undefined ? null : Number(request.expires_at);
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
      throw new BadRequestException({ error: 'expires_at must be in the future' });
    }

    return this.shares.create({
      share_id: randomBytes(24).toString('base64url'),
      device_id: request.device_id,
      owner_id: ownerId,
      page: request.page,
      editable: !!request.editable,
      // An interactive link always includes the webcam, since visitors could turn it on anyway.
      webcam: !!request.editable || !!request.webcam,
      // Only diary links carry chart links (from the grow report) that need extra access.
      charts: request.page === 'diary' && !!request.charts,
      query: typeof request.query === 'string' ? request.query.slice(0, MAX_QUERY_LENGTH) : undefined,
      createdAt: Date.now(),
      expiresAt,
    });
  }

  public async revoke(ownerId: string, shareId: string) {
    const share = await this.shares.findOneAndUpdate(
      { share_id: shareId, owner_id: ownerId, revokedAt: null },
      { $set: { revokedAt: Date.now() } },
      { new: true },
    );

    if (!share) {
      throw new NotFoundException({ error: 'Share link not found' });
    }

    return share;
  }

  public async remove(ownerId: string, shareId: string): Promise<void> {
    const result = await this.shares.deleteOne({ share_id: shareId, owner_id: ownerId, ...inactiveShareFilter() });

    if (result.deletedCount === 0) {
      throw new NotFoundException({ error: 'Share link not found or still active (revoke it first)' });
    }
  }

  public async removeInactive(ownerId: string): Promise<number> {
    const result = await this.shares.deleteMany({ owner_id: ownerId, ...inactiveShareFilter() });
    return result.deletedCount;
  }

  /** Resolves a live link, counting the visit, and describes the device behind it. */
  public async resolve(shareId: string): Promise<DeviceAccessInfo> {
    const share = await this.shares.findOneAndUpdate(
      {
        share_id: shareId,
        revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: Date.now() } }],
      },
      { $inc: { openCount: 1 }, $set: { lastOpenedAt: Date.now() } },
      { new: true },
    );

    if (!share) {
      throw new NotFoundException({ error: 'Share link not found, expired, or revoked' });
    }

    const accessInfo = await this.deviceService.getSharedDeviceAccessInfo(share);
    if (!accessInfo) {
      throw new NotFoundException({ error: 'Device not found' });
    }

    return accessInfo;
  }
}
