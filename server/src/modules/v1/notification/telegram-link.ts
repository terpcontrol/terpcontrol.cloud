import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The one-time secret that connects a chat to an account.
 *
 * Telegram's deep link carries at most 64 characters from a small alphabet, so
 * this cannot be a signed document of the shape the session tokens are - there
 * is no room for one. It is instead the smallest thing that answers the two
 * questions the webhook has to ask: whose account is this, and is the link
 * still good.
 *
 * Fixed widths rather than separators, because the alphabet a deep link allows
 * is the alphabet base64url already uses and no character is left over to
 * divide the parts with. The signature is read off the end, the expiry before
 * it, and whatever is in front of them is the account.
 *
 * Twelve bytes of signature is ninety-six bits: nobody guesses one, and the
 * whole token is over within the quarter of an hour anyway.
 */

/** Long enough to open the link on a phone, short enough that a screenshot of it is worth nothing tomorrow. */
export const LINK_VALID_MS = 15 * 60 * 1000;

const EXPIRY_LENGTH = 8;
const SIGNATURE_LENGTH = 16;

/** Telegram's own limit on the payload of a `?start=` link. */
const MAX_LENGTH = 64;

const UUID = /^[0-9a-f]{32}$/i;

/** A uuid is sixteen bytes and costs twenty-two characters; anything else is spelled out and tagged as such. */
const packId = (userId: string): string => {
  const hex = userId.replace(/-/g, '');

  return UUID.test(hex) ? `u${Buffer.from(hex, 'hex').toString('base64url')}` : `s${Buffer.from(userId, 'utf8').toString('base64url')}`;
};

const unpackId = (packed: string): string | null => {
  const bytes = Buffer.from(packed.slice(1), 'base64url');
  if (packed[0] === 's') return bytes.toString('utf8') || null;
  if (packed[0] !== 'u' || bytes.length !== 16) return null;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const sign = (secret: string, body: string): string => createHmac('sha256', secret).update(body).digest('base64url').slice(0, SIGNATURE_LENGTH);

const matches = (one: string, other: string): boolean => {
  const a = Buffer.from(one, 'utf8');
  const b = Buffer.from(other, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
};

/** The token itself, or null for an account whose id will not fit into a deep link. */
export const mintTelegramLink = (secret: string, userId: string, validUntil: Date): string | null => {
  const body = `${packId(userId)}${Math.floor(validUntil.getTime() / 60000)
    .toString(36)
    .padStart(EXPIRY_LENGTH, '0')}`;
  const token = `${body}${sign(secret, body)}`;

  return token.length > MAX_LENGTH ? null : token;
};

/** Whose account the token names, or null where it is forged, malformed or over. */
export const readTelegramLink = (secret: string, token: string, at: Date = new Date()): string | null => {
  if (token.length <= EXPIRY_LENGTH + SIGNATURE_LENGTH + 1) return null;

  const body = token.slice(0, -SIGNATURE_LENGTH);
  if (!matches(token.slice(-SIGNATURE_LENGTH), sign(secret, body))) return null;

  const validUntil = parseInt(body.slice(-EXPIRY_LENGTH), 36) * 60000;
  if (!Number.isFinite(validUntil) || validUntil < at.getTime()) return null;

  return unpackId(body.slice(0, -EXPIRY_LENGTH));
};
