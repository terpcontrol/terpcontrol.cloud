import { NextFunction, Response } from 'express';
import { verify } from 'jsonwebtoken';
import { SECRET_KEY } from '@config';
import { HttpException } from '@exceptions/HttpException';
import { DataStoredInToken, RequestWithUser } from '@interfaces/auth.interface';
import deviceModel from '@/models/device.model';
import shareModel from '@/models/share.model';
import { Device, ShareLink } from '@fg2/shared-types';

const isImageQueryTokenAllowed = (req: RequestWithUser): boolean => req.method === 'GET' && req.path.startsWith('/image/');

const getAuthorization = (req: RequestWithUser) => {
  const fromCookie = req.cookies['Authorization'];
  if (fromCookie) return fromCookie;

  const header = req.header('Authorization');
  if (header) {
    const parts = header.split('Bearer ');
    if (parts[1]) return parts[1];
  }

  if (isImageQueryTokenAllowed(req) && typeof req.query.token === 'string') {
    return req.query.token;
  }

  return null;
};

const getShareToken = (req: RequestWithUser): string | null => {
  if (typeof req.query.share === 'string' && req.query.share) return req.query.share;
  return req.header('X-Share-Token') || null;
};

export const findValidShare = async (req: RequestWithUser, device_id?: string): Promise<ShareLink | null> => {
  const token = getShareToken(req);
  if (!token) return null;

  return shareModel.findOne({
    share_id: token,
    ...(device_id ? { device_id } : {}),
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: Date.now() } }],
  });
};

export const authMiddleware = async (req: RequestWithUser, res: Response, next: NextFunction) => {
  try {
    const Authorization = getAuthorization(req);

    if (Authorization) {
      const secretKey: string = SECRET_KEY;
      const verificationResponse = (await verify(Authorization, secretKey)) as DataStoredInToken;
      if (verificationResponse.user_id && verificationResponse.token_type === 'user') {
        req.user_id = verificationResponse.user_id;
        req.is_admin = verificationResponse.is_admin;
        next();
      } else {
        next(new HttpException(401, 'Wrong authentication token'));
      }
    } else {
      next(new HttpException(404, 'Authentication token missing'));
    }
  } catch (error) {
    next(new HttpException(401, 'Wrong authentication token'));
  }
};

export const authAdminMiddleware = async (req: RequestWithUser, res: Response, next: NextFunction) => {
  try {
    const Authorization = req.cookies['Authorization'] || (req.header('Authorization') ? req.header('Authorization').split('Bearer ')[1] : null);

    if (Authorization) {
      const secretKey: string = SECRET_KEY;
      const verificationResponse = (await verify(Authorization, secretKey)) as DataStoredInToken;

      if (verificationResponse.is_admin && verificationResponse.token_type === 'user') {
        req.user_id = verificationResponse.user_id;
        req.is_admin = verificationResponse.is_admin;
        next();
      } else {
        next(new HttpException(401, 'Wrong authentication token'));
      }
    } else {
      next(new HttpException(404, 'Authentication token missing'));
    }
  } catch (error) {
    console.log(error);
    next(new HttpException(401, 'Wrong authentication token'));
  }
};

export const isUserDeviceMiddelware = async (
  req: RequestWithUser,
  res: Response,
  device_id: string,
  tokenType: DataStoredInToken['token_type'] = 'user',
) => {
  try {
    const Authorization = getAuthorization(req);

    if (Authorization) {
      const secretKey: string = SECRET_KEY;
      const verificationResponse = (await verify(Authorization, secretKey)) as DataStoredInToken;
      if (verificationResponse.user_id && verificationResponse.token_type === tokenType) {
        req.user_id = verificationResponse.user_id;
        req.is_admin = verificationResponse.is_admin;
        if (req.is_admin) {
          return true;
        }
        const devices: Device[] = await deviceModel.find({ owner_id: req.user_id, device_id: device_id }, { device_id: 1 });
        if (devices.length > 0) {
          return true;
        }

        res.status(401).send(`Device ${device_id} not bound to user ${req.user_id}`);
        return false;
      } else {
        res.status(401).send('Wrong authentication token');
        return false;
      }
    } else {
      res.status(401).send('Authentication token missing');
      return false;
    }
  } catch (error) {
    res.status(401).send('Wrong authentication token');
    return false;
  }
};

export const isUserDeviceOrShareMiddelware = async (
  req: RequestWithUser,
  res: Response,
  device_id: string,
  tokenType: DataStoredInToken['token_type'] = 'user',
) => {
  const Authorization = getAuthorization(req);

  if (Authorization) {
    try {
      const secretKey: string = SECRET_KEY;
      const verificationResponse = (await verify(Authorization, secretKey)) as DataStoredInToken;

      if (verificationResponse.user_id && verificationResponse.token_type === tokenType) {
        req.user_id = verificationResponse.user_id;
        req.is_admin = verificationResponse.is_admin;

        if (req.is_admin) {
          return true;
        }

        const devices: Device[] = await deviceModel.find({ owner_id: req.user_id, device_id: device_id }, { device_id: 1 });
        if (devices.length > 0) {
          return true;
        }
      }
    } catch (_error) {
      // Fall back to the share-link check.
    }
  }

  const share = await findValidShare(req, device_id);
  if (share) {
    req.share = share;
    return true;
  }

  res.status(401).send(Authorization ? 'Wrong authentication token or no access to device' : 'Authentication token missing');
  return false;
};
