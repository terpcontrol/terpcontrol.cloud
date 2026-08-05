import { createHmac, timingSafeEqual } from 'node:crypto';
import { SECRET_KEY } from '@config';

// Garmin watches fetch images through a route that cannot carry the JWT image token:
// the URL travels from the watch to the phone before it is fetched, and the ~400
// character URL a JWT produces does not survive it. This is the same grant expressed
// compactly - it authorises reading one device's images until it expires, and it fits
// in a path segment with no query string at all.
//
//   <expiry, base36 minutes>-<first 22 chars of the base64url HMAC>   (~30 characters)
//
// It is scoped to a single device instead of to a user so that verifying it needs no
// database lookup, and it is only ever handed to someone who already proved they own
// that device.

const SIGNATURE_LENGTH = 22;
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

const sign = (device_id: string, expiryMinutes: number): string =>
  createHmac('sha256', SECRET_KEY).update(`image|${device_id}|${expiryMinutes}`).digest('base64url').slice(0, SIGNATURE_LENGTH);

export const createImageUrlToken = (device_id: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string => {
  const expiryMinutes = Math.floor((Date.now() + ttlSeconds * 1000) / 60_000);
  return `${expiryMinutes.toString(36)}-${sign(device_id, expiryMinutes)}`;
};

export const verifyImageUrlToken = (device_id: string, token: unknown): boolean => {
  if (typeof token !== 'string') {
    return false;
  }

  const separator = token.indexOf('-');
  if (separator <= 0) {
    return false;
  }

  const expiryMinutes = parseInt(token.slice(0, separator), 36);
  if (!Number.isFinite(expiryMinutes) || expiryMinutes * 60_000 <= Date.now()) {
    return false;
  }

  const supplied = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(sign(device_id, expiryMinutes));

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};
