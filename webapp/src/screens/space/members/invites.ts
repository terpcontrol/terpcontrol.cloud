import { DateTime } from 'luxon';
import type { Invite, MemberRole } from '@fg2/shared-types/v1';
import { appUrl } from '@/ui/clipboard';
import { instantOf } from '@/ui/age';

/**
 * What the invite block and the invite sheet work out from a code, kept out
 * of the drawing so that the tests can ask the same questions of the same
 * answers.
 *
 * Every word said about a link is read off the row the server answered - its
 * role, the instant it ends, how often it was redeemed - and never off what
 * the sheet asked for. The one question put to this browser's clock is which
 * codes are still live, and that only decides what is listed: the date a row
 * carries is the server's, and is what the row says.
 */

/** The three lives the board offers a link: a day, a week, or until it is revoked. */
export type Validity = 'day' | 'week' | 'never';

export const VALIDITIES: Validity[] = ['day', 'week', 'never'];

export const ROLES: MemberRole[] = ['can_log', 'can_manage'];

/**
 * The instant a link made now would end, as the contract carries one. `null`
 * is the body's own word for a link that never expires; leaving the field out
 * would let the server fill in a week, which is not what was chosen.
 */
export const expiresAtFor = (validity: Validity, now: DateTime): string | null =>
  validity === 'never' ? null : instantOf(now.plus(validity === 'day' ? { hours: 24 } : { days: 7 }));

/** Whether a code still opens anything: not taken back, and not past the instant the server gave it. */
export const isLive = (invite: Invite, now: DateTime): boolean =>
  invite.revokedAt === null && (invite.expiresAt === null || DateTime.fromISO(invite.expiresAt) > now);

/** The codes that still open something, newest first as the server lists them. */
export const liveInvites = (invites: Invite[], now: DateTime): Invite[] => invites.filter(invite => isLive(invite, now));

/** The address a code is handed out as: the one that opens the invitation. */
export const inviteAddress = (code: string): string => appUrl(`/join/${code}`);

/** The same address as a host reads it off a phone: the scheme is not part of what anybody says aloud. */
export const shownAddress = (code: string): string => inviteAddress(code).replace(/^https?:\/\//, '');

/** Where a typed code goes, said without the scheme for the same reason. */
export const codeEntryAddress = (): string => appUrl('/join').replace(/^https?:\/\//, '');

/** "29 Sep", and the year only where it is not this one. */
export const dayLabel = (at: string, now: DateTime, locale: string): string => {
  const day = DateTime.fromISO(at).setLocale(locale);

  return day.toFormat(day.year === now.year ? 'd LLL' : 'd LLL yyyy');
};
