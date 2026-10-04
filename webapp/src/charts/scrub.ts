import { useRef, useState } from 'react';

/** A stretch of the plot, as fractions of its width. */
export interface Selection {
  from: number;
  to: number;
}

/** A drag narrower than this is a click that wobbled, not a stretch somebody meant. */
const LEAST_SELECTION = 0.02;

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
 *
 * With a mouse, pressing and dragging also marks a stretch, and letting go
 * zooms the chart into it - what the old charts did. A thumb's drag is the
 * cursor and nothing else, so a phone zooms with the button beside the cards.
 */
export const useScrub = (
  onFraction: (fraction: number) => void,
  onSelect?: (selection: Selection) => void,
): { handlers: React.HTMLAttributes<HTMLDivElement>; selection: Selection | null } => {
  const dragging = useRef(false);
  const start = useRef<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const fractionOf = (event: React.PointerEvent<HTMLDivElement>): number | null => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : null;
  };

  const end = () => {
    dragging.current = false;
    start.current = null;
    setSelection(null);
  };

  return {
    selection,
    handlers: {
      onPointerDown: event => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        const fraction = fractionOf(event);
        if (fraction === null) return;
        onFraction(fraction);
        if (onSelect && event.pointerType === 'mouse') start.current = fraction;
      },
      onPointerMove: event => {
        if (!dragging.current && event.pointerType !== 'mouse') return;
        const fraction = fractionOf(event);
        if (fraction === null) return;
        onFraction(fraction);
        if (dragging.current && start.current !== null)
          setSelection({ from: Math.min(start.current, fraction), to: Math.max(start.current, fraction) });
      },
      onPointerUp: event => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (onSelect && selection && selection.to - selection.from >= LEAST_SELECTION) onSelect(selection);
        end();
      },
      onPointerCancel: end,
    },
  };
};
