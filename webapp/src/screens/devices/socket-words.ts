import { DateTime } from 'luxon';
import { serverNow } from '@/api/clock';
import type { Translate } from '@/i18n/i18n';
import { ageLabel, durationLabel, leftLabel } from '@/ui/age';
import type { SocketRowModel } from './sockets';

/** A smart socket in words, wherever one is named. */

/** The socket's name: the role, numbered where the role holds more than one socket - two lamps are two sockets called "Licht". */
export const socketName = (t: Translate, row: SocketRowModel): string =>
  row.ordinal === null ? t(row.titleKey) : t('devices.socket.numbered', { name: t(row.titleKey), number: row.ordinal });

/** The hold on a socket, where something is forcing it. */
export const forcedOf = (row: SocketRowModel) => (row.override && row.override.state !== 'auto' ? row.override : null);

/**
 * What the socket is doing: on or off as the device last reported it, and
 * whether its role switches it ("Auto") or a person holds it and for how much
 * longer. A socket that was answering and stopped says since when.
 *
 * What is left of a hold is read off the clock as it is drawn: a countdown
 * rounds up, and against the page's beat - up to ten seconds old when a table
 * arrives - four hours just asked for read "5 h".
 */
export const socketState = (t: Translate, row: SocketRowModel, now: DateTime): string => {
  const forced = forcedOf(row);
  if (forced) {
    const left = leftLabel(forced.validUntil, DateTime.max(now, serverNow()));
    return t('devices.socket.forced', { state: t(`devices.socket.${forced.state}`), left });
  }
  if (row.state === 'unknown') {
    return row.stateChangedAt ? t('devices.socket.quiet', { age: ageLabel(row.stateChangedAt, now) }) : t('devices.socket.unknownState');
  }

  return `${t(`devices.socket.${row.state}`)} · ${t('devices.socket.byItself')}`;
};

/** The cycle a timed socket repeats, or nothing. */
export const socketCycle = (t: Translate, row: SocketRowModel): string | null =>
  row.timer ? t('devices.socket.timer', { on: durationLabel(row.timer.onSeconds), every: durationLabel(row.timer.everySeconds) }) : null;
