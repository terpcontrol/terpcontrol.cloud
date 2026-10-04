import type { PremiumFree } from '@fg2/shared-types/v1';

/**
 * What a camera without Premium gets on this install, in words - worked out
 * from `/me.premium.free` and from nothing else.
 *
 * The served width and the free retention windows are configuration of the
 * install, not numbers in this repository, and `/me` answers each of them as
 * null where the install has set none: a null width is the stored picture
 * whole, and a null window is "kept as long as an entitled camera's", which
 * is what an install whose sweep is off does. So every sentence here names the
 * figure the install gave and, where it gave none, says the true thing rather
 * than the threatening one. The Premium table and a free camera's own line
 * both read from here, which is how the two stay one answer.
 */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The clause a free camera's sentence hangs on: what it is missing here. The
 * films are the one fixed part - free renders stay SD and carry a watermark
 * wherever Premium is enforced at all - and the stills are said as the install
 * serves and keeps them.
 */
export const missingLine = (t: Translate, free: PremiumFree): string => {
  const { stillWidth: width, stillDays: days } = free;
  if (width !== null && days !== null) return t('me.premium.missing.widthAndDays', { width, count: days });
  if (width !== null) return t('me.premium.missing.width', { width });
  if (days !== null) return t('me.premium.missing.days', { count: days });

  return t('me.premium.missing.films');
};

/**
 * The table's cell for the width free stills are served at. `null` for the
 * whole answer is the demo, which has no account to ask and is told that the
 * figure is the install's rather than a number this app made up.
 */
export const servedWidthCell = (t: Translate, free: PremiumFree | null): string => {
  if (free === null) return t('me.premium.table.perInstall');

  return free.stillWidth === null ? t('me.premium.table.whole') : t('me.premium.table.widthPx', { width: free.stillWidth });
};

/**
 * The table's cell for how long free stills are kept. Where the install names
 * no window nothing of a free camera's is deleted, so the cell says what the
 * Premium column says: the whole grow.
 */
export const stillsKeptCell = (t: Translate, free: PremiumFree | null): string => {
  if (free === null) return t('me.premium.table.perInstall');

  return free.stillDays === null ? t('me.premium.table.wholeGrow') : t('me.premium.table.keptDays', { count: free.stillDays });
};
