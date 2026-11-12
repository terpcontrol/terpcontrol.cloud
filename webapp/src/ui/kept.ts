import { useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router';

/**
 * What a page keeps for one entry of the history: what was opened on it and
 * how far it was scrolled. Coming back to that entry - from what a line opened
 * - finds the page as it was left; opening the page anew starts fresh. It
 * lives as long as the app does and no longer: a reload is a new visit.
 */
const kept = new Map<string, unknown>();

/** Forgets all of it: where a visit ends - and where a test begins, whose pages all stand on the one entry a test router has. */
export const forgetKept = (): void => kept.clear();

/** `useState`, remembered under `name` for the history entry the page stands on. */
export function useKept<T>(name: string, initial: T): [T, (value: T) => void] {
  const id = `${useLocation().key}:${name}`;
  const [value, setValue] = useState<T>(() => (kept.has(id) ? (kept.get(id) as T) : initial));

  return [
    value,
    next => {
      kept.set(id, next);
      setValue(next);
    },
  ];
}

/**
 * Puts the page back where it was scrolled to, once what it draws is there
 * (`ready`) - a browser restores a position before a page that reads its data
 * has anything that tall.
 */
export function useKeptScroll(ready: boolean): void {
  const id = `${useLocation().key}:scroll`;

  useLayoutEffect(() => {
    if (!ready) return undefined;

    const left = kept.get(id);
    if (typeof left === 'number') window.scrollTo(0, left);

    const remember = () => kept.set(id, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [id, ready]);
}
