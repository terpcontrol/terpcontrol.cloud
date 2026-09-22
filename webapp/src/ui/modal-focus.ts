import { useEffect, useRef, type RefObject } from 'react';

/** Everything inside a panel that a Tab can land on, in the order it would. */
const STOPS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What makes an element announced as a dialog behave like one: the focus goes
 * into it when it opens, stays inside it while it is there, comes back out to
 * whatever had it when it closes, and Escape closes it. The ref it answers is
 * put on the panel, which needs `tabIndex={-1}` to be able to hold the focus.
 *
 * It lives here rather than inside either of the modals the app draws, because
 * a dialog that leaves the focus behind it strands a keyboard-only grower on
 * the page underneath - and that is not a thing worth getting right once per
 * overlay.
 *
 * The focus is placed once, on opening, and never again: a screen that
 * re-renders on a clock would otherwise take the cursor out of the field being
 * typed in every few seconds. The close handler is held in a ref for the same
 * reason, because callers write it inline and it is a new function on every
 * render.
 */
export function useModalFocus<T extends HTMLElement>(onClose: () => void): RefObject<T | null> {
  const panel = useRef<T>(null);
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const before = document.activeElement;
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;

      const stops = [...panel.current.querySelectorAll<HTMLElement>(STOPS)];
      const inside = document.activeElement instanceof Node && panel.current.contains(document.activeElement);
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (stops.length > 0 && inside && document.activeElement !== edge) return;

      event.preventDefault();
      const wrap = event.shiftKey ? stops[stops.length - 1] : stops[0];
      (wrap ?? panel.current).focus();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  return panel;
}
