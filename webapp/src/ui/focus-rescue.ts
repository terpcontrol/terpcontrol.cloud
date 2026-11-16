import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** True while the rescue itself is placing the focus. */
let placing = false;

/**
 * Whether the focus just arrived by the rescue rather than by a person: what
 * opens when somebody tabs onto it - an explanation - stays shut then, because
 * nobody went there.
 */
export const focusIsRescued = (): boolean => placing;

/**
 * Catches the focus when the control that had it is taken off the page or
 * disabled - Pause turned into Start, a Delete replaced by its question, a
 * question answered, a step removed, a button waiting for the server - and puts
 * it on the nearest control left where it was. A browser drops it on the body
 * instead, and a screen reader then starts again from the top of the page.
 *
 * Nearest is, inside the closest container of the lost one that is still on
 * the page, the first control after the place the lost part stood in - the
 * Done that took Save's place, the Start where Pause stood, the next step in
 * the list, the link under a card that went - and the last one before it
 * where nothing follows. A new page is left alone - the page's heading takes
 * the focus there (`app/shell/page-title.ts`).
 */
export function useFocusRescue() {
  useEffect(() => {
    /** The control that has the focus and every element above it, each with what stood in front of it. */
    let held: { element: HTMLElement; way: { node: HTMLElement; before: Element | null }[]; path: string } | null = null;
    let frame = 0;

    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target === document.body) return;
      const way: { node: HTMLElement; before: Element | null }[] = [];
      for (let node: HTMLElement | null = event.target; node && node !== document.body; node = node.parentElement) {
        way.push({ node, before: node.previousElementSibling });
      }
      held = { element: event.target, way, path: location.pathname };
    };

    const rescue = () => {
      frame = 0;
      if (!held || location.pathname !== held.path) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const { element, way } = held;
      if (element.isConnected && !element.matches(':disabled')) return;
      for (let level = 1; level < way.length; level++) {
        const container = way[level].node;
        if (!container.isConnected || container.closest('[inert]')) continue;
        const left = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          one => one !== element && !one.closest('[hidden], [aria-hidden="true"], [inert]'),
        );
        // What stood in front of the part that is gone says where it stood - unless that went or moved too.
        const { before } = way[level - 1];
        const after = (one: HTMLElement) =>
          !before!.contains(one) && Boolean(before!.compareDocumentPosition(one) & Node.DOCUMENT_POSITION_FOLLOWING);
        const next = before && before.parentElement === container ? (left.find(after) ?? left[left.length - 1]) : left[0];
        if (next) {
          placing = true;
          next.focus({ preventScroll: true });
          placing = false;
          return;
        }
      }
    };

    const watch = () => {
      if (!frame) frame = requestAnimationFrame(rescue);
    };

    document.addEventListener('focusin', onFocus);
    const observer = new MutationObserver(watch);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => {
      document.removeEventListener('focusin', onFocus);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
}
