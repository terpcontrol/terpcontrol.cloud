import type { DeviceCapabilities, SocketRole, SocketTimer, SocketUpdate } from '@fg2/shared-types/v1';
import {
  SOCKET_ADDRESS_MAX_LEN,
  SOCKET_CREDENTIAL_MAX_LEN,
  SOCKET_HOLD_MAX_SECONDS,
  TIMED_SOCKET_ROLES,
} from '@fg2/shared-types/v1-schemas/socket-report.js';

/**
 * What pairing a socket by its address and changing one is made of: the role
 * it switches with, where the device reaches it, its web credentials if it has
 * any, and - for a pump or a timer of one's own - the cycle it repeats.
 *
 * The roles offered are the ones the controller always had, the exhaust that
 * runs on over-temperature and the humidifier that runs under the humidity
 * target, and the two that run on a timer; the others the contract knows wait
 * until they have been tried in a real tent. Of those, only what the device's
 * build announced is offered, because a role it does not know is dropped when
 * its table is loaded.
 */
export const OFFERED_ROLES: readonly SocketRole[] = [
  'heater',
  'dehumidifier',
  'humidifier',
  'exhaust',
  'co2',
  'light',
  'secondary_light',
  'pump',
  'custom_timer',
];

/**
 * The roles a socket can be given at this device. A socket being changed keeps
 * its own role on offer even where it is none of the above: whoever only wants
 * to give it a new address or password must not have to make it something else.
 */
export const rolesFor = (capabilities: DeviceCapabilities, current: SocketRole | null = null): SocketRole[] => {
  const offered = OFFERED_ROLES.filter(role => capabilities.roles.includes(role));
  return current && !offered.includes(current) && capabilities.roles.includes(current) ? [...offered, current] : offered;
};

export const isTimed = (role: SocketRole): boolean => TIMED_SOCKET_ROLES.includes(role);

/** The units a timer is written in, and how many seconds each is. */
export const TIMER_UNITS = [
  { unit: 's', seconds: 1 },
  { unit: 'min', seconds: 60 },
  { unit: 'h', seconds: 3600 },
] as const;

export type TimerUnit = (typeof TIMER_UNITS)[number]['unit'];

/** A span as it is typed: a number and the unit beside it. */
export interface Span {
  value: string;
  unit: TimerUnit;
}

const secondsPer = (unit: TimerUnit): number => TIMER_UNITS.find(one => one.unit === unit)!.seconds;

/** The seconds a typed span stands for, or null while it is not a whole positive number. */
export const secondsOfSpan = (span: Span): number | null => {
  const value = Number(span.value.replace(',', '.'));
  const seconds = Math.round(value * secondsPer(span.unit));
  return span.value.trim() !== '' && Number.isFinite(value) && seconds > 0 ? seconds : null;
};

/** A number of seconds in the coarsest unit it is whole in, as the field shows it. */
export const spanOf = (seconds: number): Span => {
  const unit = [...TIMER_UNITS].reverse().find(one => seconds % one.seconds === 0) ?? TIMER_UNITS[0];
  return { value: String(seconds / unit.seconds), unit: unit.unit };
};

/** Two minutes on, every six hours: a watering pump's cycle, which is the timer people set first. */
export const DEFAULT_TIMER: SocketTimer = { onSeconds: 120, everySeconds: 6 * 3600 };

export interface SocketDraft {
  role: SocketRole | null;
  address: string;
  username: string;
  password: string;
  on: Span;
  every: Span;
}

export const draftFor = (socket: { role: SocketRole; address: string; timer: SocketTimer | null } | null): SocketDraft => {
  const timer = socket?.timer ?? DEFAULT_TIMER;
  return {
    role: socket && socket.role !== '' ? socket.role : null,
    address: socket?.address ?? '',
    username: '',
    password: '',
    on: spanOf(timer.onSeconds),
    every: spanOf(timer.everySeconds),
  };
};

/** The cycle a draft states, or null where it states none or one the firmware would refuse. */
export const timerOf = (draft: Pick<SocketDraft, 'on' | 'every'>): SocketTimer | null => {
  const onSeconds = secondsOfSpan(draft.on);
  const everySeconds = secondsOfSpan(draft.every);
  return onSeconds && everySeconds && onSeconds < everySeconds && everySeconds <= SOCKET_HOLD_MAX_SECONDS ? { onSeconds, everySeconds } : null;
};

/**
 * What is wrong with a draft, by the catalogue's word for it, or null when it
 * can be sent. The address and the credentials are held to what the device
 * can carry; a timer to what the firmware accepts - on for less than its
 * period, and a period of a day at most.
 */
export type SocketProblem = 'role' | 'address' | 'credentials' | 'timer' | 'timerFirmware';

export const problemOf = (draft: SocketDraft, capabilities: DeviceCapabilities): SocketProblem | null => {
  if (!draft.role || !capabilities.roles.includes(draft.role)) return 'role';
  const address = draft.address.trim();
  if (address === '' || address.length > SOCKET_ADDRESS_MAX_LEN || /\s/.test(address)) return 'address';
  if (draft.username.length > SOCKET_CREDENTIAL_MAX_LEN || draft.password.length > SOCKET_CREDENTIAL_MAX_LEN) return 'credentials';
  if (isTimed(draft.role) && !capabilities.socketTimer) return 'timerFirmware';
  if (isTimed(draft.role) && !timerOf(draft)) return 'timer';

  return null;
};

/**
 * The body a draft is sent as. Credentials left empty are left out, which
 * keeps whatever the socket had: re-addressing one must not lock the device out
 * of a socket with a web password of its own.
 */
export const updateOf = (draft: SocketDraft): SocketUpdate => ({
  role: draft.role!,
  address: draft.address.trim(),
  credentials: draft.username !== '' || draft.password !== '' ? { username: draft.username, password: draft.password } : null,
  timer: isTimed(draft.role!) ? timerOf(draft) : null,
});
