/** A handle as somebody typed it: the at-sign people type out of habit is not part of the name. */
export const typedHandle = (typed: string): string => typed.trim().replace(/^@/, '');

/**
 * Whether a handle typed to confirm what cannot be taken back is the one asked
 * for. The prompt is set in the small caps this app labels with, so somebody
 * whose handle is `admin` reads "TYPE ADMIN TO CONFIRM" and types ADMIN, and a
 * phone capitalises the first letter of a one-word handle whether it was meant
 * or not - so neither case nor the at-sign is held against whoever types it.
 * The whole handle still has to be written out by hand.
 */
export const matchesHandle = (typed: string, handle: string): boolean => typedHandle(typed).toLowerCase() === handle.toLowerCase();

/** Two letters of the handle, which is the only name anyone is shown. */
export const initials = (handle: string): string => handle.slice(0, 2).toUpperCase();
