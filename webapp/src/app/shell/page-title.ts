import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

const APP = 'Terp Control';

/**
 * Names the page after its heading and, on a new address, takes a screen reader
 * there.
 *
 * Every screen already has one `<h1>`, often drawn only once its data is in, so
 * the title follows the heading rather than a list of routes: the window and
 * the tab say "Blue Dream tent – Terp Control" and a screen reader announces
 * the page it arrived on. A heading that holds controls as well - a place
 * picker - names the page in its `data-title`.
 *
 * After a navigation the link that was pressed is gone and focus falls to the
 * body, where a screen reader user is lost; the heading takes it instead. Where
 * the pressed control is still on the page - a tab bar inside the screen -
 * focus stays with it.
 */
export function usePageTitle(main: React.RefObject<HTMLElement | null>) {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    const root = main.current;
    if (!root) return;
    const arriving = !first.current;
    first.current = false;
    let focused = !arriving || root.contains(document.activeElement);
    const name = () => {
      const heading = root.querySelector('h1');
      const text = (heading?.dataset.title ?? heading?.textContent)?.trim();
      document.title = text ? `${text} – ${APP}` : APP;
      if (heading && !focused) {
        focused = true;
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    };
    name();
    const observer = new MutationObserver(name);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    // A heading drawn after this long belongs to something the person did on the page, not to arriving.
    const settle = window.setTimeout(() => (focused = true), 3000);
    return () => {
      observer.disconnect();
      window.clearTimeout(settle);
    };
  }, [pathname, main]);
}
