import ui from './ui.module.css';
import { CLOCK, DAY, useZone, zoned } from './zone';

/**
 * When a camera's picture was taken, laid on it where the camera used to burn
 * its own clock in.
 *
 * A stored still carries no overlay - a camera paired now is told to stop
 * stamping, and a film or an export is the picture alone - so the time is the
 * screen's to draw: in the account's zone and the app's date, where the camera's
 * clock kept a zone of its own. It sits in the bottom right corner of the
 * positioned frame it is put in; `className` moves it where that corner is taken.
 */
export function StillStamp({ at, className }: { at: string; className?: string }) {
  const zone = useZone();

  return <span className={`${ui.stillStamp} ${className ?? ''}`}>{zoned(at, zone).toFormat(`${DAY} ${CLOCK}:ss`)}</span>;
}
