import type { DateTime } from 'luxon';
import type { Me, NotificationCategory, NotificationChannel, Severity } from '@fg2/shared-types/v1';
import { alertCategory } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import type { Translate } from '@/i18n/i18n';
import { isAhead } from '@/ui/age';
import { CHANNELS } from './settings';

/**
 * Whether anything reaches this account when something goes wrong.
 *
 * Every account starts with no channel at all, the device-offline rule the
 * cloud keeps included, so a grower who never opened the notification settings
 * believes they are watched over and is not. These are the questions the
 * notice that says so, and the claim step that offers the fix, are drawn from.
 */

/** What a screen says about a channel: its name, and whether the account has it to be reached on at all. */
export interface RoutedChannel {
  channel: NotificationChannel;
  configured: boolean;
}

/** A channel is configured when the account has given it something to deliver to; push, when some browser of it is subscribed. */
export const isConfigured = (me: Me, channel: NotificationChannel): boolean =>
  channel === 'push' ? me.pushSubscribed : me.notifications.channels[channel] !== null;

/**
 * Where a routed rule of this severity goes, read off the account's own grid.
 * Which row that is belongs to the contract rather than to this screen, so the
 * server announcing and the screen saying so cannot drift apart.
 *
 * A row may name a channel the account cannot be reached on - push before any
 * browser has subscribed, e-mail before an address is confirmed - and that is
 * carried rather than hidden: saying "push" of a rule nothing would arrive from
 * is the one thing an alarm screen must not do.
 */
export const routedChannels = (me: Me | undefined, severity: Severity): RoutedChannel[] => {
  const category = alertCategory(severity);
  const named = me && category ? (me.notifications.routing[category] ?? []) : [];

  return CHANNELS.filter(channel => named.includes(channel)).map(channel => ({ channel, configured: me !== undefined && isConfigured(me, channel) }));
};

/** Whether a routed alarm of this severity arrives on a channel this account can be reached on. */
export const severityReaches = (me: Me, severity: Severity): boolean => routedChannels(me, severity).some(routed => routed.configured);

/** "push + e-mail", with a channel the account has not set up marked as the dead end it is. */
export const channelsLabel = (t: Translate, channels: RoutedChannel[]): string =>
  channels
    .map(routed => {
      const name = t(`alarms.channel.${routed.channel}`);
      return routed.configured ? name : t('alarms.channelOff', { channel: name });
    })
    .join(' + ');

/** Whether a critical alarm - a device gone offline, a tent too warm - reaches this account on a channel it can be reached on. */
export const alarmsReach = (me: Me): boolean => severityReaches(me, 'critical');

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
interface Callers {
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
