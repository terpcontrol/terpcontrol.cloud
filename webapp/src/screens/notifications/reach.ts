import type { DateTime } from 'luxon';
import type { Me } from '@fg2/shared-types/v1';
import { routedChannels } from '@/screens/control/alarms/rules';
import { isAhead } from '@/ui/age';

/**
 * Whether anything reaches this account when something goes wrong.
 *
 * Every account starts with no channel at all, the device-offline rule the
 * cloud keeps included, so a grower who never opened the notification settings
 * believes they are watched over and is not. These are the questions the
 * notice that says so, and the claim step that offers the fix, are drawn from.
 */

/** Whether a critical alarm - a device gone offline, a tent too warm - reaches this account on a channel it can be reached on. */
export const alarmsReach = (me: Me): boolean => routedChannels(me, 'critical').some(channel => channel.configured);

/** The channels a critical alarm actually arrives on. */
export const reachedBy = (me: Me) => routedChannels(me, 'critical').filter(channel => channel.configured);

/**
 * How long "Later" puts the notice away. A week rather than for good, because
 * what it is about is the one thing the cloud is for to somebody with one
 * device; the settings page and every rule that reaches nobody still say so
 * in the meantime.
 */
export const LATER_DAYS = 7;

/** Whether "Later" is still holding the notice back. */
export const putAway = (me: Me, now: DateTime): boolean => isAhead(me.preferences.notifyLaterUntil ?? null, now);

/** Where the one tap sends mail: the address the person already set, or else the one they sign in with - which is what the server does. */
export const mailAddressOf = (me: Me): string => me.notifications.channels.email ?? me.email;
