import { useRef } from 'react';

/**
 * Where focus goes when the control that had it is taken off the page: the save
 * bar goes away with its Save button once the save is through, and focus would
 * fall to the body, where a screen reader user has lost their place. `land()`
 * moves it to the element the ref holds, once that is drawn, and only where
 * nothing else took it meanwhile.
 */
export function useFocusLanding<T extends HTMLElement>() {
  const target = useRef<T>(null);
  const land = () =>
    requestAnimationFrame(() => {
      const element = target.current;
      if (!element || (document.activeElement && document.activeElement !== document.body)) return;
      element.tabIndex = -1;
      element.focus({ preventScroll: true });
    });
  return { target, land };
}
