import ui from './ui.module.css';
import { CLOCK, DAY, useZone, zoned } from './zone';

/**
 * When a camera's picture was taken, laid on it the way the camera used to
 * burn its own clock in.
 *
 * The stored still carries no overlay of any kind - a camera paired today is
 * told to stop stamping, and a timelapse or an export is the picture alone - so
 * the time is the screen's to draw. Drawn here, it is the account's zone and
 * the app's date rather than the camera's clock, which was never set and kept
 * its own zone.
 *
 * It sits in the top right corner of the positioned frame it is put in;
 * `className` moves it where that corner is taken.
 */
export function StillStamp({ at, className }: { at: string; className?: string }) {
  const zone = useZone();

  return <span className={`${ui.stillStamp} ${className ?? ''}`}>{zoned(at, zone).toFormat(`${DAY} ${CLOCK}:ss`)}</span>;
}
