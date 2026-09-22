import { useRef } from 'react';

/**
 * Dragging across a plot moves the cursor.
 *
 * A tooltip that follows the pointer cannot be read on a phone at all - the
 * thumb is over it - so every chart in the app is read by a cursor whose values
 * are pinned somewhere that stays put. The handlers belong to the surface over
 * the plot rather than to the chart: the picture is drawn once per answer and
 * the cursor is a couple of elements over it, so scrubbing costs no redraw.
 *
 * The surface claims horizontal gestures only, so a thumb still scrolls the
 * page vertically over it, and the pointer is captured on the way down so a
 * drag that wanders off the plot keeps scrubbing.
 */
export const useScrub = (onFraction: (fraction: number) => void): React.HTMLAttributes<HTMLDivElement> => {
  const dragging = useRef(false);
  const report = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) onFraction(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  };

  return {
    onPointerDown: event => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      report(event);
    },
    onPointerMove: event => {
      if (dragging.current || event.pointerType === 'mouse') report(event);
    },
    onPointerUp: event => {
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => {
      dragging.current = false;
    },
  };
};
