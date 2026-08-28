import { NextFunction, Response } from 'express';
import { verify } from 'jsonwebtoken';
import { SECRET_KEY } from '@config';
import { HttpException } from '@exceptions/HttpException';
import { DataStoredInToken, RequestWithUser } from '@interfaces/auth.interface';
import deviceModel from '@/models/device.model';
import zeltModel from '@/models/zelt.model';
import shareModel from '@/models/share.model';
import { Device, Ding, DingArt, GESPEICHERTE_ARTEN, Image, ShareLink, Zelt } from '@fg2/shared-types';
import { DEMO_WRITE_MESSAGE } from '@utils/demo';
import { logger } from '@utils/logger';
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
    async () => {
      const erlaubt = !req.is_demo && (await isUserZelt(req, zelt_id));
      // The tent this refusal is about goes to the log and not into the body:
      // a handler that resolves its subject first (a `schluessel_id`, a
      // `ding_id`) would otherwise answer a guess with the tent that owns it.
      if (!erlaubt) logger.info(`Zelt not bound to user: zelt_id=${zelt_id || '-'} user=${req.user_id || '-'} ${req.method} ${req.path}`);

      return erlaubt;
    },
    'Zelt not bound to user',
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
 *
 * "The binding that produced the shared data" is three conditions, not one. The
 * device being in the tent *now* is the weakest of them and on its own it hands
 * a sold controller's link to whoever bought the hardware: §14.9 leaves the
 * seller's binding closed and appends the buyer's, both keyed by the same
 * `geraet_id`, so a match on the id alone follows the device out of the tent it
 * was shared from and into a stranger's diary. The owner has to be the person
 * who issued the link, and the link has to have been issued while the device
 * was in this tent - which is §14.3's forward-only law, the same one
 * `bindungsFenster` applies to the rows one layer down, applied to the reader.
 */
export const findValidShareForZelt = async (req: RequestWithUser, zelt_id: string): Promise<ShareLink | null> => {
  const share = await findValidShare(req);
  if (!share || !zelt_id) return null;

  const zelt: Pick<Zelt, 'besitzer_id' | 'geraete'> = await zeltModel.findOne({ zelt_id: zelt_id }, { _id: 0, besitzer_id: 1, geraete: 1 }).lean();
  if (!zelt || !share.owner_id || zelt.besitzer_id !== share.owner_id) return null;

  // The owner check above is what closes the leak this exists for - a sold
  // controller carrying its old links into the buyer's tent. What remains here
  // is the upper bound: a link must not keep reading a tent after the device it
  // was issued for has left it.
  //
  // There is deliberately no lower bound. A tent backfilled for a device that
  // never came online is dated from the migration, so every link its owner made
  // before today predates its own binding - and refusing those would break
  // working links to punish nothing, since the owner has not changed. A share
  // that outlives a device *within one owner's tents* is the residue, and that
  // is a person reading their own grow.
  const imFenster = (zelt.geraete ?? []).some(
    bindung => bindung.geraet_id === share.device_id && (bindung.bis === undefined || bindung.bis === null || share.createdAt <= bindung.bis),
  );

  return imFenster ? share : null;
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
 * must not open the others: the numbers, the diary and the camera are different
 * disclosures, and somebody who shared a chart with a forum did not thereby
 * publish who watered what, the notes about it, or the inside of their flat.
 */
export type Lesegrund = 'charts' | 'diary' | 'webcam';

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
    if (oeffnet(share, grund)) {
      req.share = share;
      return true;
    }
    return false;
  }

  if (await validApiKeyForZelt(req, zelt_id)) return true;

  // §13.5: a club key reads the diary half. It is handed to a member rather
  // than to the owner and it travels in a URL, so the camera is not part of
  // what it opens.
  return grund !== 'webcam' && (await validSchluessel(req, zelt_id));
};

/**
 * A `diary` link is the tent's own share and carries the sensor half only when
 * `charts` was ticked; a `charts` link never carries the diary. The camera is
 * neither of the two - it is its own tick on both kinds of link, because a
 * picture of the room is not a number and not a sentence.
 */
const oeffnet = (share: ShareLink, grund: Lesegrund): boolean => {
  if (grund === 'charts') return share.page === 'charts' || !!share.charts;
  if (grund === 'webcam') return !!share.webcam;
  return share.page === 'diary';
};

/**
 * The tent an `Image` row belongs to, in both keyings: `zelt_id` on anything
 * written since tents existed, and for everything older the binding that was in
 * force when the picture was taken. The binding window is the whole of it - a
 * sold controller's frames belong to the tent that held it *then* (§14.3), and
 * resolving one to whoever holds the hardware now is how a stranger's picture
 * would be served under this tent's credential.
 *
 * `null` means the row cannot be placed, and an unplaceable row is refused
 * rather than served: every credential below ownership is issued for one tent.
 */
export const zeltDesBildes = async (bild: Pick<Image, 'zelt_id' | 'device_id' | 'timestamp'>): Promise<string | null> => {
  if (bild.zelt_id) return bild.zelt_id;
  if (!bild.device_id) return null;

  const zelte: Pick<Zelt, 'zelt_id' | 'geraete'>[] = await zeltModel
    .find({ 'geraete.geraet_id': bild.device_id }, { _id: 0, zelt_id: 1, geraete: 1 })
    .lean();

  for (const zelt of zelte) {
    const passt = (zelt.geraete ?? []).some(
      bindung =>
        bindung.geraet_id === bild.device_id &&
        bild.timestamp >= bindung.seit &&
        (bindung.bis === undefined || bindung.bis === null || bild.timestamp <= bindung.bis),
    );
    if (passt) return zelt.zelt_id;
  }

  return null;
};

/**
 * Whether this request may be handed *these bytes*, as against the device the
 * URL names.
 *
 * The device is the wrong question for a picture. A share reaches the image
 * endpoint through the device it was issued for, and a `webcam: false` link was
 * then allowed any row it could name by `image_id` - on the reasoning that such
 * a link only ever learned the ids hanging on diary entries. `GET /api/dinge`
 * ended that: the ids of every frame are now a list the same link can ask for,
 * and the supply being closed at that end is not a reason to leave the door
 * open at this one.
 *
 * So the row itself decides. A photograph a person took is the diary half; a
 * camera frame and a timelapse are the camera half, which is its own tick on
 * the link - and both are asked against the tent the row belongs to rather than
 * against the device that happens to point at it today.
 */
export const darfBildLesen = async (req: RequestWithUser, bild: Pick<Image, 'zelt_id' | 'device_id' | 'timestamp' | 'format'>): Promise<boolean> => {
  const zelt_id = await zeltDesBildes(bild);
  if (!zelt_id) return false;

  return darfLesen(req, zelt_id, bild.format === 'user/jpeg' ? 'diary' : 'webcam');
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
      // What the body may not carry (see `VERWEIGERT_LESEN`), kept where the
      // operator can still see it.
      logger.info(`${verweigert}: zelt_id=${zelt_id || '-'} user=${req.user_id || '-'} ${req.method} ${req.path}`);
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

/**
 * The same narrowing as `Lesegrund`, one layer further in: which *arts* a
 * credential is answered with.
 *
 * `darfLesen` decides which endpoint a link reaches, and that is not a
 * disclosure boundary by itself - `GET /api/dinge` answers with every art
 * unless it is told otherwise, so a link shared for the diary was handed the
 * setpoints, the device with its firmware and last-seen, the timelapse and
 * every camera frame. The frames are the sharpest edge of it: `image.controller`
 * lets a `webcam: false` link fetch a still *by image_id* precisely because
 * such a link only ever learned the ids hanging on diary entries, and a list of
 * every frame's id turns that allowance into the bytes.
 *
 * `bild` stays one art for both a photograph and a frame (§5) - the split is
 * `d.quelle`, which is the word the caption prints - so it is the one line the
 * art vocabulary cannot draw and the answer is filtered for it instead.
 */
const RAHMEN_ARTEN: DingArt[] = ['zelt'];
/** What a person wrote, what the tent's own log said, and the pictures they took. */
const TAGEBUCH_ARTEN: DingArt[] = [...GESPEICHERTE_ARTEN, 'ereignis', 'schema', 'bild'];
/** The numbers half: the hardware, its sockets and the setpoints in force. */
const ZAHLEN_ARTEN: DingArt[] = ['geraet', 'dose', 'ziel'];
/** The camera half. A timelapse is camera bytes as much as a still is. */
const KAMERA_ARTEN: DingArt[] = ['kamera', 'film'];

/** What one credential may be answered with. `null` is the owner and the read key: the whole tent. */
interface Sicht {
  arten: DingArt[];
  /** Whether `bild` carries the camera's frames as well as the pictures a person took. */
  kamerabilder: boolean;
}

const sichtDesShares = (share: ShareLink): Sicht => ({
  arten: [
    ...new Set([
      ...RAHMEN_ARTEN,
      ...(share.page === 'diary' ? TAGEBUCH_ARTEN : []),
      ...(share.page === 'charts' || share.charts ? ZAHLEN_ARTEN : []),
      ...(share.webcam ? KAMERA_ARTEN : []),
    ]),
  ],
  kamerabilder: !!share.webcam,
});

/**
 * What the credential on this request may see, or `null` when it may see
 * everything. A club key reads „the diary half" (§13.5) and nothing else: it is
 * handed to a member rather than to the owner, and it travels in a URL.
 */
const sichtDesLesers = (req: RequestWithUser): Sicht | null => {
  if (req.share) return sichtDesShares(req.share);
  if (req.schluessel) return { arten: [...RAHMEN_ARTEN, ...TAGEBUCH_ARTEN], kamerabilder: false };

  return null;
};

/**
 * Drops what the credential may not see out of the answer on its way out.
 *
 * Everything that can be decided by art is decided before the projections run -
 * see below - so this is left with the one distinction an art cannot carry, and
 * with the rows an adapter returns under a different art than it was asked for
 * (`ereignis` answers the legacy diary's own entries as `notiz`).
 */
const filtereDinge = (res: Response, behalte: (ding: Ding) => boolean): void => {
  const antworte = res.json.bind(res);
  res.json = (koerper: unknown) => {
    const dinge = (koerper as { dinge?: unknown } | null)?.dinge;
    if (!Array.isArray(dinge)) return antworte(koerper);

    return antworte({ ...(koerper as object), dinge: (dinge as Ding[]).filter(behalte) });
  };
};

/**
 * Narrows the request to the arts the credential was issued for *before* the
 * handler reads it, so the halves it may not see are never queried, never
 * projected and never paid for - and no id out of them can escape through a
 * field nobody thought to check.
 */
const beschraenkeAufSicht = (req: RequestWithUser, res: Response, sicht: Sicht): void => {
  const erlaubt = new Set<string>(sicht.arten);
  const gefragt = typeof req.query.art === 'string' && req.query.art !== '' ? req.query.art.split(',').map(art => art.trim()) : [...erlaubt];
  const arten = gefragt.filter(art => erlaubt.has(art));

  // Never the empty string: a handler reading `art` cannot tell "nothing" from
  // "everything" and the empty string is how "everything" is spelled. A request
  // asking exclusively for the other half is answered with the cheapest art
  // there is and an answer filtered down to nothing - an empty page, which is
  // what "you were not shared this" looks like on a list endpoint.
  req.query.art = (arten.length > 0 ? arten : RAHMEN_ARTEN).join(',');

  // The filter answers off `erlaubt` rather than off what was asked for: an
  // adapter may answer under a different art than the one it was asked for
  // (`ereignis` returns the legacy diary's own entries as `notiz`), and dropping
  // those would narrow the diary rather than the disclosure. Only a request that
  // asked exclusively for the other half is answered with nothing.
  filtereDinge(
    res,
    arten.length === 0 ? () => false : ding => erlaubt.has(ding.art) && (sicht.kamerabilder || ding.art !== 'bild' || ding.d?.quelle === 'hand'),
  );
};

/**
 * A refusal says no and says nothing else. Naming the tent in the body turns
 * the 403 into an oracle: `PATCH /api/dinge/:ding_id` resolves the Ding before
 * it can know which tent to authorise against, so a body carrying the tent's id
 * tells a stranger that the `ding_id` they guessed exists *and* which tent owns
 * it, which is exactly what `zumSchreiben`'s "refused rather than reported
 * missing" was written to avoid. The id goes to the log instead.
 */
const VERWEIGERT_LESEN = 'No read access to this Zelt';
const VERWEIGERT_SCHREIBEN = 'No write access to this Zelt';

export const darfLesenMiddelware = async (req: RequestWithUser, res: Response, zelt_id: string): Promise<boolean> => {
  if (!(await zeltZugang(req, res, zelt_id, darfLesen, VERWEIGERT_LESEN))) return false;

  const sicht = sichtDesLesers(req);
  if (sicht) beschraenkeAufSicht(req, res, sicht);

  return true;
};

export const darfSchreibenMiddelware = async (req: RequestWithUser, res: Response, zelt_id: string): Promise<boolean> =>
  zeltZugang(req, res, zelt_id, darfSchreiben, VERWEIGERT_SCHREIBEN);
