import { useEffect, useRef } from 'react';

/**
 * Back closes the sheet on top instead of leaving the page under it.
 *
 * A sheet is not an address, but on a phone Back is how anything opened is put
 * away, and a Back that took the page along with the sheet took the reader out
 * of the app from Start. So an open sheet stands on a history entry of its
 * own - the page's address and the router's state again, marked - and going
 * back from it closes the sheet.
 *
 * A sheet closed any other way leaves that entry behind as `SPENT` rather
 * than stepping back itself: a step back races the navigation a sheet's own
 * button may have started in the same breath, and loses it. The next sheet
 * takes a spent entry over, so a page gathers one however many sheets it
 * opens, and Back from a spent entry is passed on to the page - the press was
 * meant for it. An entry whose sheet is gone without a word - the page was
 * loaded again over it - is spent like any other.
 */
const SPENT = 'spent';

interface Open {
  mark: number;
  close: () => void;
  byBack: boolean;
}

const open: Open[] = [];

type Marked = { sheet?: unknown; key?: unknown } | null;
const entry = () => {
  const state = window.history.state as Marked;
  return { sheet: state?.sheet, key: state?.key };
};
/** The entry on screen as it was last seen, which is what a step is measured from. */
let was = entry();

/** Whether an entry's mark is nobody's: no sheet that is open stands on it. */
const spent = (mark: unknown): boolean => mark !== undefined && !open.some(one => one.mark === mark);

/** Puts a sheet on its entry: the spent one a sheet before it left, or a new one. */
const stand = (sheet: Open) => {
  const state = window.history.state as Record<string, unknown> | null;
  if (spent(state?.sheet)) window.history.replaceState({ ...state, sheet: sheet.mark }, '');
  else window.history.pushState({ ...state, sheet: sheet.mark }, '');
  sheet.byBack = false;
  was = entry();
};

const onPop = () => {
  const left = was;
  was = entry();
  const top = open[open.length - 1];
  if (top) {
    top.byBack = true;
    top.close();
    // A sheet that did not go - it is busy, or asks first - stands on an entry of its own again.
    setTimeout(() => open.includes(top) && stand(top), 0);
  } else if (spent(left.sheet) && was.sheet === undefined && was.key === left.key) window.history.back();
};

// Listened to from the start: an entry a sheet left spent is stepped back from long after the sheet has gone.
window.addEventListener('popstate', onPop);

/**
 * `stands` is false for a sheet that takes no entry: one that is an address of its own, which Back leaves, and the
 * question a held-back navigation asks - the router is still stepping back onto the page then, and an entry taken
 * under that step would cut the page's own off the history.
 */
export const useBackCloses = (onClose: () => void, stands: boolean): void => {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!stands) return;
    // A mark of its own, which no entry from before a reload carries.
    const sheet: Open = { mark: Math.random(), close: () => close.current(), byBack: false };
    stand(sheet);
    open.push(sheet);

    return () => {
      open.splice(open.indexOf(sheet), 1);
      const now = window.history.state as Record<string, unknown> | null;
      if (!sheet.byBack && now?.sheet === sheet.mark) window.history.replaceState({ ...now, sheet: SPENT }, '');
      was = entry();
    };
  }, [stands]);
};
