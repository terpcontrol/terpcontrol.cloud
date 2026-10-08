import { timingSafeEqual } from 'node:crypto';

/**
 * A comparison whose duration says nothing about how much of the secret was
 * right, nor how long it is. Both sides are padded to one length first, because
 * the comparison itself refuses buffers of different sizes - and the lengths are
 * compared afterwards, in bytes, so a prefix is not accepted.
 */
export const sameSecret = (supplied: string, expected: string): boolean => {
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const width = Math.max(a.length, b.length, 32);

  return timingSafeEqual(Buffer.concat([a], width), Buffer.concat([b], width)) && a.length === b.length;
};
