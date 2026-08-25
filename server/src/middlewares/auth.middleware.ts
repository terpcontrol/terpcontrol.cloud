import { NextFunction, Response } from 'express';
import { verify } from 'jsonwebtoken';
import { SECRET_KEY } from '@config';
import { HttpException } from '@exceptions/HttpException';
import { DataStoredInToken, RequestWithUser } from '@interfaces/auth.interface';
import deviceModel from '@/models/device.model';
import zeltModel from '@/models/zelt.model';
import shareModel from '@/models/share.model';
import { Device, ShareLink } from '@fg2/shared-types';
import { DEMO_WRITE_MESSAGE } from '@utils/demo';
import { schluesselService } from '@services/schluessel.service';

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

/**
 * Verifies the session, then lets the caller decide about the subject. Every
 * guard shares the same two 401 paths and the same 403 tail; keeping them in
 * one place is what stops the next subject from arriving with its own copy.
 */
const authorize = async (
  req: RequestWithUser,
  res: Response,
  tokenType: DataStoredInToken['token_type'],
  allowed: () => Promise<boolean>,
  forbidden: string,
): Promise<boolean> => {
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
    if (await allowed()) {
      return true;
    }

    res.status(403).send(forbidden);
    return false;
  } catch (error) {
    res.status(401).send('Wrong authentication token');
    return false;
  }
};

const ownsDevice = async (user_id: string, device_id: string): Promise<boolean> => {
  const devices: Device[] = await deviceModel.find({ owner_id: user_id, device_id: device_id }, { device_id: 1 });
  return devices.length > 0;
};

export const isUserDeviceMiddelware = async (
  req: RequestWithUser,
  res: Response,
  device_id: string,
  tokenType: DataStoredInToken['token_type'] = 'user',
) =>
  authorize(
    req,
    res,
    tokenType,
    async () => req.is_admin || (req.is_demo ? isDemoDevice(device_id) : ownsDevice(req.user_id, device_id)),
    `Device ${device_id} not bound to user ${req.user_id}`,
  );

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

/**
 * Tent ownership, the second identity next to the device. It is a call, not
 * Express middleware, so every handler that takes a zelt_id has to make it on
 * its first line — the route table test is what proves none of them forgot.
 */
export const isUserZelt = async (req: RequestWithUser, zelt_id: string): Promise<boolean> =>
  !!zelt_id && !!req.user_id && !!(await zeltModel.exists({ zelt_id: zelt_id, besitzer_id: req.user_id }));

export const isUserZeltMiddelware = async (req: RequestWithUser, res: Response, zelt_id: string): Promise<boolean> =>
  authorize(
    req,
    res,
    'user',
    // A demo session reaches demo devices, never a tent: tents are personal
    // diaries and there is no demo tent to fall back to.
    async () => !req.is_demo && (await isUserZelt(req, zelt_id)),
    `Zelt ${zelt_id} not bound to user ${req.user_id}`,
  );

const getSchluesselToken = (req: RequestWithUser): string | null => {
  if (typeof req.query.k === 'string' && req.query.k) return req.query.k;
  return req.header('X-Schluessel') || null;
};

const getApiKey = (req: RequestWithUser): string | null => req.header('x-api-key') || null;

/**
 * A share link is device-keyed and stays that way, so a tent inherits one
 * through the binding that produced the shared data. A tent with no device has
 * no share to inherit - it is shared by handing out a `Schlüssel` instead.
 */
export const findValidShareForZelt = async (req: RequestWithUser, zelt_id: string): Promise<ShareLink | null> => {
  const share = await findValidShare(req);
  if (!share || !zelt_id) return null;

  return (await zeltModel.exists({ zelt_id: zelt_id, 'geraete.geraet_id': share.device_id })) ? share : null;
};

/** The per-Zelt read key (§13.7). Read only, and never a write credential anywhere. */
export const validApiKeyForZelt = async (req: RequestWithUser, zelt_id: string): Promise<boolean> => {
  const token = getApiKey(req);
  // A request that carries no key must never make the guard touch the database,
  // or every call that will be answered by ownership pays for the lookup too.
  if (!token || !zelt_id) return false;

  return !!(await schluesselService.zugangsschluessel(zelt_id, token));
};

/** The club write key (§13.5). Resolving it here is what puts the person on the request. */
export const validSchluessel = async (req: RequestWithUser, zelt_id: string): Promise<boolean> => {
  const token = getSchluesselToken(req);
  if (!token || !zelt_id) return false;

  const schluessel = await schluesselService.schluessel(token);
  if (!schluessel || schluessel.zelt_id !== zelt_id) return false;

  req.schluessel = schluessel;
  return true;
};

// A demo session reaches demo devices, never a tent: tents are personal diaries
// and there is no demo tent to fall back to.
const besitzt = async (req: RequestWithUser, zelt_id: string): Promise<boolean> => !req.is_demo && (await isUserZelt(req, zelt_id));

/**
 * What a reader is asking to see. A share link is issued for one of these and
 * must not open the other: the numbers and the diary are different disclosures,
 * and somebody who shared a chart with a forum did not thereby publish who
 * watered what, the notes about it, or the photographs.
 */
export type Lesegrund = 'charts' | 'diary';

/**
 * Who may read a Zelt: its owner, a share link **issued for what is being
 * asked for**, its read key, or a club key. Like `isUserZelt` this is a call
 * and not Express middleware, so a handler that forgets it is unguarded - the
 * route table test is what proves none of them forgot.
 *
 * §15.1 lists the read endpoints as `Z | S | A` without narrowing, and taken
 * literally that lets a `charts` link read `/api/dinge`. The narrowing is here
 * on purpose: `ShareLink.page` exists precisely so a link discloses one half,
 * and §4.5's rule that a link shared in week 3 must not start leaking sensor
 * data in week 12 is the same principle pointing the other way.
 */
export const darfLesen = async (req: RequestWithUser, zelt_id: string, grund: Lesegrund = 'diary'): Promise<boolean> => {
  if (await besitzt(req, zelt_id)) return true;

  const share = await findValidShareForZelt(req, zelt_id);
  if (share) {
    // A `diary` link is the tent's own share and carries the sensor half only
    // when `charts` was ticked; a `charts` link never carries the diary.
    const darf = grund === 'charts' ? share.page === 'charts' || !!share.charts : share.page === 'diary';
    if (darf) {
      req.share = share;
      return true;
    }
    return false;
  }

  return (await validApiKeyForZelt(req, zelt_id)) || (await validSchluessel(req, zelt_id));
};

/**
 * Who may write to a Zelt: its owner, or a club key. A share link never writes -
 * `ShareLink.editable` unlocked a UI the server refused anyway - and neither
 * does the read key, whose whole purpose is to be pasted into somebody's export
 * script.
 */
export const darfSchreiben = async (req: RequestWithUser, zelt_id: string): Promise<boolean> =>
  (await besitzt(req, zelt_id)) || (await validSchluessel(req, zelt_id));

/**
 * The responding half of the two predicates. A session is verified when one is
 * offered, because ownership needs it - but its absence is not an error here:
 * an api key or a club key carries no session at all.
 */
const zeltZugang = async (
  req: RequestWithUser,
  res: Response,
  zelt_id: string,
  erlaubt: (req: RequestWithUser, zelt_id: string) => Promise<boolean>,
  verweigert: string,
): Promise<boolean> => {
  try {
    const session = await verifyFirstMatchingToken(req, 'user');
    if (session) applyToken(req, session);

    if (await erlaubt(req, zelt_id || '')) {
      return true;
    }

    // 403 as soon as anything identified the caller: a key that may read but not
    // write has not mistyped its password, and telling it to log in again is a
    // lie. 401 stays for the request that offered nothing.
    if (session || getSchluesselToken(req) || getApiKey(req) || getShareToken(req)) {
      res.status(403).send(verweigert);
    } else {
      res.status(401).send(getAuthorizationCandidates(req).length > 0 ? 'Wrong authentication token' : 'Authentication token missing');
    }
    return false;
  } catch (error) {
    res.status(401).send('Wrong authentication token');
    return false;
  }
};

export const darfLesenMiddelware = async (req: RequestWithUser, res: Response, zelt_id: string): Promise<boolean> =>
  zeltZugang(req, res, zelt_id, darfLesen, `No read access to Zelt ${zelt_id}`);

export const darfSchreibenMiddelware = async (req: RequestWithUser, res: Response, zelt_id: string): Promise<boolean> =>
  zeltZugang(req, res, zelt_id, darfSchreiben, `No write access to Zelt ${zelt_id}`);
