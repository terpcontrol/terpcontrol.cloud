import { NextFunction, Response } from 'express';
import { randomBytes } from 'crypto';
import { RequestWithUser } from '@/interfaces/auth.interface';
import { isUserDeviceMiddelware } from '@/middlewares/auth.middleware';
import shareModel from '@/models/share.model';
import { deviceService } from '@services/device.service';
import { SharePage } from '@fg2/shared-types';

const SHARE_PAGES: SharePage[] = ['charts', 'diary'];

// Matches expired (numeric expiresAt in the past) and revoked shares; a null
// expiresAt never matches $lt, so links without expiry stay untouched.
const inactiveShareFilter = () => ({ $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $lt: Date.now() } }] });

class ShareController {
  public create = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const { device_id, page, editable, webcam, valid_days, query } = req.body ?? {};

      if (!device_id || !SHARE_PAGES.includes(page)) {
        return res.status(400).json({ error: 'Missing device_id or invalid page' });
      }

      const validDays = valid_days === null || valid_days === undefined ? null : Number(valid_days);
      if (validDays !== null && (!Number.isFinite(validDays) || validDays <= 0)) {
        return res.status(400).json({ error: 'Invalid valid_days' });
      }

      if (!(await isUserDeviceMiddelware(req, res, device_id))) {
        return;
      }

      const share = await shareModel.create({
        share_id: randomBytes(24).toString('base64url'),
        device_id,
        owner_id: req.user_id,
        page,
        editable: !!editable,
        // An interactive link always includes the webcam, since visitors could turn it on anyway.
        webcam: !!editable || !!webcam,
        query: typeof query === 'string' ? query.slice(0, 2000) : undefined,
        createdAt: Date.now(),
        expiresAt: validDays === null ? null : Date.now() + validDays * 86400000,
      });

      res.status(201).json(share);
    } catch (error) {
      next(error);
    }
  };

  public list = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const shares = await shareModel.find({ owner_id: req.user_id }).sort({ createdAt: -1 }).lean().exec();
      res.status(200).json(shares);
    } catch (error) {
      next(error);
    }
  };

  public revoke = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const share = await shareModel.findOneAndUpdate(
        { share_id: req.params.share_id, owner_id: req.user_id, revokedAt: null },
        { $set: { revokedAt: Date.now() } },
        { new: true },
      );

      if (!share) {
        return res.status(404).json({ error: 'Share link not found' });
      }

      res.status(200).json(share);
    } catch (error) {
      next(error);
    }
  };

  public remove = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const result = await shareModel.deleteOne({ share_id: req.params.share_id, owner_id: req.user_id, ...inactiveShareFilter() });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Share link not found or still active (revoke it first)' });
      }

      res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  };

  public removeInactive = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const result = await shareModel.deleteMany({ owner_id: req.user_id, ...inactiveShareFilter() });
      res.status(200).json({ status: 'ok', deleted: result.deletedCount });
    } catch (error) {
      next(error);
    }
  };

  public resolve = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const share = await shareModel.findOneAndUpdate(
        {
          share_id: req.params.share_id,
          revokedAt: null,
          $or: [{ expiresAt: null }, { expiresAt: { $gt: Date.now() } }],
        },
        { $inc: { openCount: 1 }, $set: { lastOpenedAt: Date.now() } },
        { new: true },
      );

      if (!share) {
        return res.status(404).json({ error: 'Share link not found, expired, or revoked' });
      }

      const accessInfo = await deviceService.getSharedDeviceAccessInfo(share);
      if (!accessInfo) {
        return res.status(404).json({ error: 'Device not found' });
      }

      res.status(200).json(accessInfo);
    } catch (error) {
      next(error);
    }
  };
}

export default ShareController;
