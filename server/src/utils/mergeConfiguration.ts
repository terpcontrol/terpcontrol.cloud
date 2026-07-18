const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepMerge = (existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...existing };

  for (const [key, incomingValue] of Object.entries(incoming)) {
    const existingValue = merged[key];
    // Arrays are replaced rather than merged: they are ordered values, not sets
    // of named settings, so a per-index merge would be meaningless.
    merged[key] = isPlainObject(existingValue) && isPlainObject(incomingValue) ? deepMerge(existingValue, incomingValue) : incomingValue;
  }

  return merged;
};

/**
 * Merges an incoming device configuration into the stored one.
 *
 * The configuration is stored as a single document, but a client only sends the
 * fields its own version knows about. Overwriting wholesale therefore drops
 * every setting the sender is unaware of: an app that predates a firmware field
 * silently resets that field to the device default on each save, and the loss is
 * invisible because the app then reads back its own truncated config.
 *
 * Deleting a setting is deliberately not expressible this way. The schema is
 * fixed and only ever grows, so an absent key means "unknown to the sender",
 * never "remove this".
 */
export const mergeConfiguration = (existingJson: string | undefined, incomingJson: string): string => {
  if (!existingJson) {
    return incomingJson;
  }

  let existing: unknown;
  let incoming: unknown;
  try {
    existing = JSON.parse(existingJson);
    incoming = JSON.parse(incomingJson);
  } catch {
    // A malformed stored config must not block the device from being
    // reconfigured, which is the way out of exactly that state.
    return incomingJson;
  }

  if (!isPlainObject(existing) || !isPlainObject(incoming)) {
    return incomingJson;
  }

  return JSON.stringify(deepMerge(existing, incoming));
};
