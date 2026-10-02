import type { DateTime } from 'luxon';
import type { Me, NotificationCategory } from '@fg2/shared-types/v1';
import { isConfigured, routedChannels } from '@/screens/control/alarms/rules';
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

/**
 * What can call on this account, as rows of the routing grid: a device's
 * alarms, a camera's warning that it stopped delivering, and the reminders of
 * a diary. Somebody who keeps a diary without a device has no critical alarm
 * that could ever reach them, and was offered only that.
 */
export interface Callers {
  steering: boolean;
  cameras: boolean;
  diary: boolean;
}

export const callingRows = ({ steering, cameras, diary }: Callers): NotificationCategory[] => [
  ...(steering ? (['alerts'] as const) : []),
  ...(cameras ? (['warnings'] as const) : []),
  ...(diary ? (['tasks'] as const) : []),
];

/** Whether a row of the grid arrives anywhere: routed to a channel this account can be reached on. */
export const rowReaches = (me: Me, row: NotificationCategory): boolean =>
  (me.notifications.routing[row] ?? []).some(channel => isConfigured(me, channel));

/**
 * Whether what calls on this account reaches it. With a device that is its
 * critical alarms, as it always was; without one, any of what can call -
 * a reminder or a camera's warning - arriving anywhere is enough.
 */
export const callsReach = (me: Me, rows: NotificationCategory[]): boolean =>
  rows.includes('alerts') ? alarmsReach(me) : rows.length === 0 || rows.some(row => rowReaches(me, row));

/** Where the one tap sends mail: the address the person already set, or else the one they sign in with - which is what the server does. */
export const mailAddressOf = (me: Me): string => me.notifications.channels.email ?? me.email;
