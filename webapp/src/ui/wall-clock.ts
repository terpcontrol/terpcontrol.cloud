import type { DateTime } from 'luxon';
import { roundTheClock } from '@fg2/shared-types/v1-schemas/day-night.js';

const HOUR_SECONDS = 60 * 60;

/**
 * How far the account's wall clock is ahead of UTC right now, in seconds.
 *
 * A configuration document holds seconds past midnight UTC, so a tent in Berlin
 * that lights at eight is stored as six in summer. The times the app shows and
 * takes are the clock on the wall where the account is kept - the zone the
 * server reads the same account's quiet hours in, not wherever the phone
 * reading this happens to be - and they are turned into the document's seconds
 * at today's offset. The server remembers that offset and moves the seconds
 * when it changes, so eight stays eight when the clocks go back; read the same
 * way, the app goes on saying eight.
 */
export const offsetOf = (now: DateTime, zone: string | null): number => (zone ? now.setZone(zone) : now.toLocal()).offset * 60;

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/**
 * "08:00": seconds past midnight UTC on the account's wall clock, to the
 * nearest minute - a light written to go off a second before midnight goes off
 * at midnight as far as anybody reading a clock is concerned.
 */
export const wallClock = (seconds: number, offset: number): string => {
  const there = roundTheClock(Math.round((seconds + offset) / 60) * 60);
  return `${twoDigits(Math.floor(there / HOUR_SECONDS))}:${twoDigits(Math.floor((there % HOUR_SECONDS) / 60))}`;
};

/** "08:00" on the account's wall clock as the document's seconds past midnight UTC, or null for what is not a time of day. */
export const secondsOf = (time: string, offset: number): number | null => {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return roundTheClock(hours * HOUR_SECONDS + minutes * 60 - offset);
};
