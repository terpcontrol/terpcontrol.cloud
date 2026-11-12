import { useRef, useState } from 'react';

/** A stretch of the plot, as fractions of its width; a pinch outwards reaches past 0 and 1. */
export interface Selection {
  from: number;
  to: number;
}

/** A drag narrower than this is a click that wobbled, not a stretch somebody meant. */
const LEAST_SELECTION = 0.02;

/** How far a finger travels sideways before it is moving the cursor rather than resting. */
const SLOP_PX = 8;

/** A pinch that changed the width by less than this was two fingers resting. */
const LEAST_PINCH = 0.15;

interface ScrubDoes {
  /** The cursor follows: a mouse over the plot, a finger dragged across it. */
  onCursor: (fraction: number) => void;
  /** The cursor was set down - a click, a tap, the end of a drag - and stays. */
  onPlace: (fraction: number) => void;
  /** The mouse left without setting it down: the cursor goes back to where it stood. */
  onLeave: () => void;
  /** A stretch was marked with the mouse, or pinched to with two fingers. */
  onZoom: (selection: Selection) => void;
}

/**
 * The gestures of a plot: one cursor, read in a place that stays put, and the
 * stretch to zoom into.
 *
 * The handlers belong to a surface over the plot, so the picture is drawn once
 * per answer and scrubbing costs no redraw. The surface claims sideways
 * gestures only (`touch-action: pan-y`): a thumb still scrolls the page over
 * it, and a touch moves the cursor only once it has travelled sideways or was
 * a tap - a scroll that starts on a plot leaves the cursor where it stood.
 *
 * With a mouse, moving over the plot reads it, a click sets the cursor down and
 * a drag marks a stretch to zoom into. Two fingers pinch: what lay under them
 * when they came down lies under them when they lift.
 */
export const useScrub = ({
  onCursor,
  onPlace,
  onLeave,
  onZoom,
}: ScrubDoes): { handlers: React.HTMLAttributes<HTMLDivElement>; selection: Selection | null } => {
  const touches = useRef(new Map<number, { start: number; now: number; x: number }>());
  const mouseFrom = useRef<number | null>(null);
  const dragging = useRef(false);
  const pinched = useRef<Selection | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const fractionOf = (event: React.PointerEvent<HTMLDivElement>): number | null => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : null;
  };

  const mark = (next: Selection | null) => {
    pinched.current = next;
    setSelection(next && next.from >= 0 && next.to <= 1 ? next : null);
  };

  const end = () => {
    touches.current.clear();
    mouseFrom.current = null;
    dragging.current = false;
    mark(null);
  };

  return {
    selection,
    handlers: {
      onPointerDown: event => {
        const fraction = fractionOf(event);
        if (fraction === null) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (event.pointerType === 'mouse') {
          mouseFrom.current = fraction;
          onCursor(fraction);
        } else {
          touches.current.set(event.pointerId, { start: fraction, now: fraction, x: event.clientX });
        }
      },
      onPointerMove: event => {
        const fraction = fractionOf(event);
        if (fraction === null) return;
        if (event.pointerType === 'mouse') {
          onCursor(fraction);
          if (mouseFrom.current !== null) mark({ from: Math.min(mouseFrom.current, fraction), to: Math.max(mouseFrom.current, fraction) });
          return;
        }

        const touch = touches.current.get(event.pointerId);
        if (!touch) return;
        touch.now = fraction;
        const [one, other] = [...touches.current.values()].sort((a, b) => a.start - b.start);
        if (other) {
          // What lay under each finger when it came down stays under it: the window that makes that true.
          const [left, right] = [Math.min(one.now, other.now), Math.max(one.now, other.now)];
          const scale = (other.start - one.start) / Math.max(0.02, right - left);
          const from = one.start - left * scale;
          mark({ from, to: from + scale });
        } else if (dragging.current || Math.abs(event.clientX - touch.x) > SLOP_PX) {
          dragging.current = true;
          onCursor(fraction);
        }
      },
      onPointerUp: event => {
        const fraction = fractionOf(event);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const marked = pinched.current;
        const pinch = touches.current.size > 1;
        // The second finger of a pinch lifts after the first has ended it, and sets nothing down.
        const own = mouseFrom.current !== null || touches.current.has(event.pointerId);
        end();
        if (marked && (pinch ? Math.abs(marked.to - marked.from - 1) > LEAST_PINCH : marked.to - marked.from >= LEAST_SELECTION)) onZoom(marked);
        else if (!pinch && own && fraction !== null) onPlace(fraction);
      },
      onPointerCancel: () => {
        end();
        onLeave();
      },
      onPointerLeave: event => {
        if (event.pointerType === 'mouse' && mouseFrom.current === null) onLeave();
      },
    },
  };
};
