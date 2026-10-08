import { compare, hash } from 'bcrypt';
import { sameSecret } from '@common/same-secret';

const BCRYPT_COST = 10;

export const hashDevicePassword = (password: string): Promise<string> => hash(password, BCRYPT_COST);

// Stored values created before hashing was introduced are plaintext; bcrypt hashes start with the $2 prefix.
const isHashed = (stored: string): boolean => typeof stored === 'string' && stored.startsWith('$2');

type DevicePasswordCheck = { matches: boolean; legacy: boolean };

// Verifies a presented password against the stored value, transparently supporting
// legacy plaintext records so they can be migrated to a hash on successful auth.
export const verifyDevicePassword = async (presented: string, stored: string): Promise<DevicePasswordCheck> => {
  if (isHashed(stored)) {
    return { matches: await compare(presented ?? '', stored), legacy: false };
  }
  return { matches: sameSecret(presented ?? '', stored ?? ''), legacy: true };
};
