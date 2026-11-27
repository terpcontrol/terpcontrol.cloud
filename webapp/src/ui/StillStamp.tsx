import type { CSSProperties } from 'react';
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
 * picture; `className` moves it where that corner is taken.
 *
 * A picture fitted whole into a frame of another shape - a turned camera's
 * portrait still in a landscape frame - leaves bands beside it, and the corner
 * of the frame is on a band. Given the picture's `ratio` (width / height, from
 * `useStillRatio`) the stamp keeps to the picture's own corner; the frame it is
 * put in is then a size container (`ui.stillFrame`), and on a picture too narrow
 * for the stamp's one line the time goes under the date. Without it the picture
 * is taken to fill the frame.
 */
export function StillStamp({ at, ratio, className }: { at: string; ratio?: number | null; className?: string }) {
  const zone = useZone();

  return (
    <span className={ui.stillBox} data-fitted={ratio ? '' : undefined} style={ratio ? ({ '--still-ratio': ratio } as CSSProperties) : undefined}>
      <span className={`${ui.stillStamp} ${className ?? ''}`}>
        <span>{zoned(at, zone).toFormat(DAY)}</span> <span>{zoned(at, zone).toFormat(`${CLOCK}:ss`)}</span>
      </span>
    </span>
  );
}
