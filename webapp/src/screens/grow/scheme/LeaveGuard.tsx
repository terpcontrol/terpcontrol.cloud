import { useContext, useEffect, type ReactNode } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, type Location } from 'react-router';

/** A navigation held back: going on with it, or staying. */
export interface Held {
  proceed: () => void;
  stay: () => void;
}

/**
 * Hand edits that are not saved hold back whatever would leave them: the browser's own leaving - a reload, a closed
 * tab, an address typed - with its own question, and a navigation inside the app with the page's (`asking`, drawn in
 * place of `children` while a navigation waits). Only a change of the address leaves - a sheet's own entry in the
 * history does not -, and not one to where the edits are kept (`stays`).
 *
 * The router holds a navigation back only where it is a data router, which the app's is; drawn under a plain one -
 * a test's - the page keeps the browser's question alone.
 */
export function LeaveGuard({
  dirty,
  stays = () => false,
  asking,
  children,
}: {
  dirty: boolean;
  stays?: (next: Location) => boolean;
  asking: (held: Held) => ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!dirty) return;
    const hold = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only where the event carries a value.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [dirty]);

  return useContext(UNSAFE_DataRouterContext) ? (
    <Blocking dirty={dirty} stays={stays} asking={asking}>
      {children}
    </Blocking>
  ) : (
    children
  );
}

function Blocking({
  dirty,
  stays,
  asking,
  children,
}: {
  dirty: boolean;
  stays: (next: Location) => boolean;
  asking: (held: Held) => ReactNode;
  children: ReactNode;
}) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search) && !stays(nextLocation),
  );

  return blocker.state === 'blocked' ? asking({ proceed: blocker.proceed, stay: blocker.reset }) : children;
}
