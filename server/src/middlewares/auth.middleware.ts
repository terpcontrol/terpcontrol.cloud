import { NextFunction, Response } from 'express';
import { verify } from 'jsonwebtoken';
import { SECRET_KEY } from '@config';
import { HttpException } from '@exceptions/HttpException';
import { DataStoredInToken, RequestWithUser } from '@interfaces/auth.interface';
import deviceModel from '@/models/device.model';
import shareModel from '@/models/share.model';
import { Device, ShareLink } from '@fg2/shared-types';
import { DEMO_WRITE_MESSAGE } from '@utils/demo';

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

const applyToken = (req: RequestWithUser, token: DataStoredInToken) => {
  req.user_id = token.user_id;
  // A demo session is never an account, and never privileged.
  req.is_demo = !!token.is_demo;
  req.is_admin = !req.is_demo && token.is_admin;
};

// Demo sessions reach exactly the devices flagged as demo devices.
const isDemoDevice = async (device_id: string): Promise<boolean> =>
  (await deviceModel.countDocuments({ device_id: device_id, demoDevice: true })) > 0;

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
      next(new HttpException(401, 'Authentication token missing'));
      return;
    }

    const verificationResponse = await verifyFirstMatchingToken(req, 'user');
    if (verificationResponse) {
      applyToken(req, verificationResponse);
      next();
    } else {
      next(new HttpException(401, 'Wrong authentication token'));
    }
  } catch (error) {
    next(new HttpException(401, 'Wrong authentication token'));
  }
};

// Endpoints that establish or end a session; they must keep working while a demo
// session is open, and none of them touches device data.
const DEMO_ALLOWED_PATHS = ['/login', '/demologin', '/tokenlogin', '/signup', '/activate', '/refresh', '/logout', '/getreset', '/reset'];

// A demo session may read, nothing else. Blocking every other request centrally
// means no write endpoint can be forgotten, now or when new ones are added.
export const demoReadOnlyMiddleware = async (req: RequestWithUser, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || DEMO_ALLOWED_PATHS.includes(req.path)) {
    next();
    return;
  }

  const verificationResponse = await verifyFirstMatchingToken(req, 'user');
  if (verificationResponse?.is_demo) {
    next(new HttpException(403, DEMO_WRITE_MESSAGE));
    return;
  }

  next();
};

export const authAdminMiddleware = async (req: RequestWithUser, res: Response, next: NextFunction) => {
  try {
    const Authorization = req.cookies['Authorization'] || (req.header('Authorization') ? req.header('Authorization').split('Bearer ')[1] : null);

    if (Authorization) {
      const secretKey: string = SECRET_KEY;
      const verificationResponse = (await verify(Authorization, secretKey)) as DataStoredInToken;

      if (verificationResponse.is_admin && !verificationResponse.is_demo && verificationResponse.token_type === 'user') {
        applyToken(req, verificationResponse);
        next();
      } else {
        next(new HttpException(401, 'Wrong authentication token'));
      }
    } else {
      next(new HttpException(401, 'Authentication token missing'));
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

    applyToken(req, verificationResponse);
    if (req.is_admin) {
      return true;
    }
    if (req.is_demo) {
      if (await isDemoDevice(device_id)) {
        return true;
      }
    } else {
      const devices: Device[] = await deviceModel.find({ owner_id: req.user_id, device_id: device_id }, { device_id: 1 });
      if (devices.length > 0) {
        return true;
      }
    }

    res.status(403).send(`Device ${device_id} not bound to user ${req.user_id}`);
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
    applyToken(req, verificationResponse);

    if (req.is_admin) {
      return true;
    }

    if (req.is_demo) {
      if (await isDemoDevice(device_id)) {
        return true;
      }
    } else {
      const devices: Device[] = await deviceModel.find({ owner_id: req.user_id, device_id: device_id }, { device_id: 1 });
      if (devices.length > 0) {
        return true;
      }
    }
  }

  const share = await findValidShare(req, device_id);
  if (share) {
    req.share = share;
    return true;
  }

  // 401 only when the session itself is the problem, so clients can tell "log in
  // again" apart from "this account may not see this device".
  if (verificationResponse) {
    res.status(403).send('No access to device');
  } else {
    res.status(401).send(hasToken ? 'Wrong authentication token' : 'Authentication token missing');
  }
  return false;
};
