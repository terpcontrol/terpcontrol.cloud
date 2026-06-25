import { compare, hash } from 'bcrypt';
import { timingSafeEqual } from 'crypto';

const BCRYPT_COST = 10;

export const hashDevicePassword = (password: string): Promise<string> => hash(password, BCRYPT_COST);

// Stored values created before hashing was introduced are plaintext; bcrypt hashes start with the $2 prefix.
const isHashed = (stored: string): boolean => typeof stored === 'string' && stored.startsWith('$2');

const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a ?? '', 'utf8');
  const bufB = Buffer.from(b ?? '', 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
};

export type DevicePasswordCheck = { matches: boolean; legacy: boolean };

// Verifies a presented password against the stored value, transparently supporting
// legacy plaintext records so they can be migrated to a hash on successful auth.
export const verifyDevicePassword = async (presented: string, stored: string): Promise<DevicePasswordCheck> => {
  if (isHashed(stored)) {
    return { matches: await compare(presented ?? '', stored), legacy: false };
  }
  return { matches: constantTimeEquals(presented, stored), legacy: true };
};
