import type { DateTime } from 'luxon';
import type { Translate } from '@/i18n/i18n';
import { ageLabel, durationLabel, leftLabel } from '@/ui/age';
import type { SocketRowModel } from './sockets';

/**
 * A smart socket in words, wherever one is named: on its own page, in the list
 * of a device's sockets and in the rows that lead to it.
 */

/**
 * The socket's name: the role, numbered where the role holds more than one
 * socket. Two lamps in one tent are two sockets called "Licht", and a person
 * switching one of them off has to know which one they have got.
 */
export const socketName = (t: Translate, row: SocketRowModel): string =>
  row.ordinal === null ? t(row.titleKey) : t('devices.socket.numbered', { name: t(row.titleKey), number: row.ordinal });

/** The hold on a socket, where something is forcing it. */
export const forcedOf = (row: SocketRowModel) => (row.override && row.override.state !== 'auto' ? row.override : null);

/**
 * What the socket is doing: on or off as the device last reported it, and
 * whether its role switches it ("Auto") or a person holds it and for how much
 * longer. A socket that was answering and stopped says since when; one the
 * device says nothing about says that.
 */
export const socketState = (t: Translate, row: SocketRowModel, now: DateTime): string => {
  const forced = forcedOf(row);
  if (forced) return t('devices.socket.forced', { state: t(`devices.socket.${forced.state}`), left: leftLabel(forced.validUntil, now) });
  if (row.state === 'unknown') {
    return row.stateChangedAt ? t('devices.socket.quiet', { age: ageLabel(row.stateChangedAt, now) }) : t('devices.socket.unknownState');
  }

  return `${t(`devices.socket.${row.state}`)} · ${t('devices.socket.byItself')}`;
};

/** The cycle a timed socket repeats, or nothing. */
export const socketCycle = (t: Translate, row: SocketRowModel): string | null =>
  row.timer ? t('devices.socket.timer', { on: durationLabel(row.timer.onSeconds), every: durationLabel(row.timer.everySeconds) }) : null;
