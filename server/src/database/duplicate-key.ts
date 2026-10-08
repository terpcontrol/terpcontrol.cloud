/** Mongo says 11000 when a unique index refuses a write; the driver types it as an unknown error. */
export const isDuplicateKey = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
