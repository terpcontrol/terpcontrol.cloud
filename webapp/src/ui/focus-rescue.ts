import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Catches the focus when the control that had it is taken off the page or
 * disabled - Pause turned into Start, a Delete replaced by its question, a
 * question answered, a step removed, a button waiting for the server - and puts
 * it on the nearest control left where it was. A browser drops it on the body
 * instead, and a screen reader then starts again from the top of the page.
 *
 * Nearest is the first control inside the closest container of the lost one
 * that is still on the page: the Done that took Save's place, the Start beside
 * where Pause stood, the next step in the list. A new page is left alone - the
 * page's heading takes the focus there (`app/shell/page-title.ts`).
 */
export function useFocusRescue() {
  useEffect(() => {
    let held: { element: HTMLElement; ancestors: HTMLElement[]; path: string } | null = null;
    let frame = 0;

    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target === document.body) return;
      const ancestors: HTMLElement[] = [];
      for (let node = event.target.parentElement; node && node !== document.body; node = node.parentElement) ancestors.push(node);
      held = { element: event.target, ancestors, path: location.pathname };
    };

    const rescue = () => {
      frame = 0;
      if (!held || location.pathname !== held.path) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const { element, ancestors } = held;
      if (element.isConnected && !element.matches(':disabled')) return;
      for (const container of ancestors) {
        if (!container.isConnected || container.closest('[inert]')) continue;
        const next = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
          one => one !== element && !one.closest('[hidden], [aria-hidden="true"], [inert]'),
        );
        if (next) {
          next.focus({ preventScroll: true });
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
