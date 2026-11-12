import type { LoggedLine } from './Toasts';

/** A toast with nothing left to answer for: written or told, and neither failed nor being taken back. */
const settled = (line: LoggedLine): boolean => line.state === 'saved' && !line.undoing;

/** How many toasts stand at once: a third would cover the page it is about. */
const MOST = 2;

/**
 * The toasts with `line` added, and never more than two of them. A toast from
 * the same control takes its predecessor's place - five steps of one stepper
 * are one answer - and beyond that the oldest settled one goes. A line still
 * on its way, or one that failed, is never the one to go: it is the only
 * place its failure is said.
 */
export const withRoom = (lines: LoggedLine[], line: LoggedLine): LoggedLine[] => {
  const others = lines.filter(one => !(line.from !== undefined && one.from === line.from && settled(one)));
  const going = new Set(
    others
      .filter(settled)
      .slice(0, Math.max(0, others.length + 1 - MOST))
      .map(one => one.key),
  );

  return [...others.filter(one => !going.has(one.key)), line];
};
