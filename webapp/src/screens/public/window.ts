import { DateTime } from 'luxon';
import { VALUE_AGE } from '@fg2/shared-types/v1-schemas/value-age.js';

/**
 * Whether the window a public page was built for still reaches the present.
 *
 * The server answers the window every week and every picture below has been
 * clamped to, and an open-ended one is clamped to the instant it answered - so
 * its end is what the page is current as of. A window that was narrowed to a
 * day last month makes the whole page a snapshot, and a snapshot is dimmed and
 * dated rather than passed off as today.
 *
 * The threshold is the contract's own, the one every live value on every other
 * screen is judged stale by, rather than a second number invented here.
 */
export const windowIsCurrent = (endsAt: string | null, now: DateTime): boolean =>
  endsAt === null || now.toMillis() - DateTime.fromISO(endsAt).toMillis() <= VALUE_AGE.staleSeconds * 1000;
