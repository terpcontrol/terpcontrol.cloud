import type { z } from 'zod';
import type { notificationCategory } from './accounts.js';
import type { severity } from './common.js';

type Severity = z.infer<typeof severity>;
type NotificationCategory = z.infer<typeof notificationCategory>;

/**
 * Which row of the routing grid an alarm falls in, decided once for both ends.
 *
 * The server announces by it and the alarm rules page says by it where a rule
 * will go, so it is the contract's rather than either side's - a copy in each
 * would be two answers to the same question. Critical alarms are `alerts`,
 * wanted where they wake somebody; warnings are `warnings`, read in the
 * morning; an info rule is in neither row and stays in the inbox. Like
 * `VALUE_AGE`, this module carries no schema, so a client imports it on its
 * own without pulling zod in.
 */
export const alertCategory = (severity: Severity): NotificationCategory | null =>
  severity === 'critical' ? 'alerts' : severity === 'warning' ? 'warnings' : null;

/** What the always-on offline rule the cloud keeps for every device is called, which is the name its lines in the diary carry. */
export const OFFLINE_RULE_NAME = 'Device offline';

/**
 * A critical alarm repeats until it is resolved, so a tent that is too hot is
 * said again every half hour rather than once to whoever happened to hold the
 * phone; a warning is read in the morning and is said once. It is written on a
 * rule when the rule is made, so a person can still turn a rule's repeat off
 * and have it stay off.
 */
export const CRITICAL_REPEAT_SECONDS = 30 * 60;

export const repeatSecondsOf = (severity: Severity): number => (severity === 'critical' ? CRITICAL_REPEAT_SECONDS : 0);

/**
 * The least time between two mails of one rule, whatever the rule says: a mail
 * costs the reader more than a webhook does, so a rule delivering by mail
 * cannot fire or repeat more often than this. Zero for every other delivery.
 */
export const mailFloorSecondsOf = (delivery: { mode: string; custom: { channel: string } | null }): number =>
  delivery.mode === 'custom' && delivery.custom?.channel === 'email' ? 5 * 60 : 0;

/**
 * Why nothing an alarm raises would reach a person right now, or null while
 * they are listening. A mute is absolute, on purpose: somebody who taps "mute
 * all" while they work on a tent means every alarm the tent is about to raise.
 * Quiet hours are a night's sleep, and a critical alarm is worth interrupting
 * one. The server holds a message back by it and the alarm rules page says by
 * it why a rule would reach nobody.
 */
export const silenceOf = (severity: Severity, muted: boolean, quiet: boolean): 'muted' | 'quiet' | null =>
  muted ? 'muted' : quiet && severity !== 'critical' ? 'quiet' : null;

/**
 * Whether a minute of the day lies in quiet hours. The window has no date on
 * it: it is minutes from the person's own midnight, which each end reads on the
 * account's clock, so the same setting means the same night wherever it is
 * read. A window that crosses midnight has its start after its end, which is
 * what the two branches are.
 */
export const inQuietWindow = (quiet: { fromMinute: number; toMinute: number } | null, minute: number): boolean =>
  quiet !== null &&
  (quiet.fromMinute <= quiet.toMinute
    ? minute >= quiet.fromMinute && minute < quiet.toMinute
    : minute >= quiet.fromMinute || minute < quiet.toMinute);
