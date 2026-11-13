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

/** The control used last, by pointer or by keyboard - a click is both, a change is a select's: what the next toast answers. */
let used: Element | null = null;
if (typeof document !== 'undefined') {
  const note = (event: Event) =>
    (used = event.target instanceof Element ? (event.target.closest('button, a, select, input, textarea, label') ?? event.target) : null);
  for (const type of ['click', 'change']) document.addEventListener(type, note, true);
}
export const lastUsed = (): Element | null => used;

/** The room a toast keeps from the box it stands by, from the window's edge and from the control it answers. */
export const GAP = 8;

type Box = { top: number; bottom: number };

/** How far the page moves so that none of `controls` lies under the toasts' box: by the lowest one's overlap; one beside the box asks nothing. */
export const clearance = (controls: readonly Box[], toasts: Box): number =>
  Math.max(0, ...controls.filter(one => one.bottom > toasts.top && one.top < toasts.bottom).map(one => one.bottom - toasts.top + GAP));

/**
 * The room a page keeps under its end: what the toasts ask (`wanted`), and beyond it whatever of the room it has
 * (`has`) the page is scrolled into - that goes only as the page is scrolled back out of it, so nothing jumps when
 * a toast leaves. `scrolled` is the page's scroll, `most` how far it reaches as it stands.
 */
export const roomFor = (wanted: number, has: number, scrolled: number, most: number): number =>
  wanted + Math.max(0, scrolled - Math.max(0, most - (has - wanted)));

/**
 * Where the toasts stand while a sheet is open, so that none lies on it: under
 * its box where the window has the room, else over it, else in the sheet's
 * `foot`. `sheet` is the box without toasts in it, `tall` their height,
 * `clear` what the window keeps free above a sheet.
 */
export const besideSheet = (sheet: Box, tall: number, high: number, clear = 0): Pick<Box, 'top'> | Pick<Box, 'bottom'> | 'foot' => {
  if (high - sheet.bottom >= tall + 2 * GAP) return { top: sheet.bottom + GAP };
  return sheet.top - clear >= tall + 2 * GAP ? { bottom: high - sheet.top + GAP } : 'foot';
};
