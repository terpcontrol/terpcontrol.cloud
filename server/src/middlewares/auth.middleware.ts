import { NextFunction, Response } from 'express';
import { verify } from 'jsonwebtoken';
import { SECRET_KEY } from '@config';
import { HttpException } from '@exceptions/HttpException';
import { DataStoredInToken, RequestWithUser } from '@interfaces/auth.interface';
import deviceModel from '@/models/device.model';
import shareModel from '@/models/share.model';
import { Device, ShareLink } from '@fg2/shared-types';

const isImageQueryTokenAllowed = (req: RequestWithUser): boolean => req.method === 'GET' && req.path.startsWith('/image/');

// All tokens a request may carry. The browser attaches the Authorization cookie
// (a 'user' token) even to <img> requests whose URL carries an 'image' token, so
// callers must consider every candidate instead of just the first one.
const getAuthorizationCandidates = (req: RequestWithUser): string[] => {
  const candidates: string[] = [];

  const fromCookie = req.cookies['Authorization'];
  if (fromCookie) candidates.push(fromCookie);

  const header = req.header('Authorization');
  if (header) {
    const parts = header.split('Bearer ');
    if (parts[1]) candidates.push(parts[1]);
  }

  if (isImageQueryTokenAllowed(req) && typeof req.query.token === 'string') {
    candidates.push(req.query.token);
  }

  return candidates;
};

// A full user session is at least as privileged as the URL-embeddable image token.
const matchesTokenType = (actual: DataStoredInToken['token_type'], expected: DataStoredInToken['token_type']): boolean =>
  actual === expected || (expected === 'image' && actual === 'user');

const verifyFirstMatchingToken = async (req: RequestWithUser, tokenType: DataStoredInToken['token_type']): Promise<DataStoredInToken | null> => {
  for (const candidate of getAuthorizationCandidates(req)) {
    try {
      const verified = (await verify(candidate, SECRET_KEY)) as DataStoredInToken;
      if (verified.user_id && matchesTokenType(verified.token_type, tokenType)) {
        return verified;
      }
    } catch (_error) {
      // Invalid or expired: try the next token.
    }
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
    if (getAuthorizationCandidates(req).length === 0) {
      next(new HttpException(404, 'Authentication token missing'));
      return;
    }

    const verificationResponse = await verifyFirstMatchingToken(req, 'user');
    if (verificationResponse) {
      req.user_id = verificationResponse.user_id;
      req.is_admin = verificationResponse.is_admin;
      next();
    } else {
      next(new HttpException(401, 'Wrong authentication token'));
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
    if (getAuthorizationCandidates(req).length === 0) {
      res.status(401).send('Authentication token missing');
      return false;
    }

    const verificationResponse = await verifyFirstMatchingToken(req, tokenType);
    if (!verificationResponse) {
      res.status(401).send('Wrong authentication token');
      return false;
    }

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
  const hasToken = getAuthorizationCandidates(req).length > 0;

  const verificationResponse = await verifyFirstMatchingToken(req, tokenType);
  if (verificationResponse) {
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

  const share = await findValidShare(req, device_id);
  if (share) {
    req.share = share;
    return true;
  }

  res.status(401).send(hasToken ? 'Wrong authentication token or no access to device' : 'Authentication token missing');
  return false;
};
