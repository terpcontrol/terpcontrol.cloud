import { randomInt } from 'node:crypto';

// The characters a code is made of: those that cannot be read as one another off
// a small display, a screen or over a telephone - no O or 0, no I, J, L or 1, no Q.
const ALPHABET = 'ABCDEFGHKMNPRSTUVWXYZ23456789';

/** A code somebody reads off one thing and types into another: an invite, or a device's claim code. */
export const readableCode = (length: number): string => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
