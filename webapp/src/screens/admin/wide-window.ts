import { useEffect, useState } from 'react';

/**
 * Whether the window has room for the fleet screens.
 *
 * It is the breakpoint the desktop rail appears at, because the rail is the
 * only way in: below it there is no ADMIN section to tap, so anybody who is
 * there followed a link, and what they get is the sentence saying so rather
 * than a table folded into a column it cannot be read in.
 *
 * A browser without `matchMedia` - a test's - is answered yes, so a screen
 * under test is the screen and not its refusal.
 */
export const ADMIN_MIN_WIDTH = 900;

export const useWideWindow = (): boolean => {
  const [wide, setWide] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia(`(min-width: ${ADMIN_MIN_WIDTH}px)`).matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(min-width: ${ADMIN_MIN_WIDTH}px)`);
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);

  return wide;
};
