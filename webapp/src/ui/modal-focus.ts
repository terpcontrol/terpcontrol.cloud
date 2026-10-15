import { useEffect, useRef, type RefObject } from 'react';
import { ANNOUNCER } from './live-region';

/** Everything inside a panel that a Tab can land on, in the order it would. */
const STOPS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes everything but `panel` inert - every sibling of it and of each of its
 * ancestors - and returns how to undo exactly that. `aria-modal` alone does not
 * keep VoiceOver on iOS or TalkBack inside a dialog: swiping walks on into the
 * page behind it. The app's live region stays heard.
 */
const inertOutside = (panel: HTMLElement): (() => void) => {
  const made: Element[] = [];
  for (let node: HTMLElement = panel; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.hasAttribute('inert') || sibling.hasAttribute(ANNOUNCER)) continue;
      sibling.setAttribute('inert', '');
      made.push(sibling);
    }
  }
  return () => made.forEach(element => element.removeAttribute('inert'));
};

/**
 * What makes an element announced as a dialog behave like one: the focus goes
 * into it when it opens, stays inside it while it is there, comes back out to
 * whatever had it when it closes, Escape closes it, and the page behind it
 * cannot be reached while it is open. The ref it answers is
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
    const release = panel.current ? inertOutside(panel.current) : () => {};

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
      release();
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  return panel;
}
