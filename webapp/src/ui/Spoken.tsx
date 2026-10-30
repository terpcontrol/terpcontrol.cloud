import type { ReactNode } from 'react';
import ui from './ui.module.css';

/**
 * Drawn one way and read aloud another. The screen keeps its short forms - "Ø 1 Std",
 * "08:00–20:00", "4 min" - which a screen reader spells out as "Durchmesser", skips
 * the dash of, or reads letter by letter; the reader hears `said` instead. Nothing
 * that can be pressed goes into `children`: it would be hidden with them.
 */
export function Spoken({ said, children }: { said: string; children: ReactNode }) {
  if (children === said) return <>{children}</>;
  return (
    <>
      <span aria-hidden>{children}</span>
      <span className={ui.visuallyHidden}>{said}</span>
    </>
  );
}

/** The " · " between the parts of a line, read as the pause a comma makes rather than as "Mittelpunkt" or nothing. */
export function Dot() {
  return <Spoken said=", "> · </Spoken>;
}
