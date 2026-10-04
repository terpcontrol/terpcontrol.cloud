import { useState } from 'react';
import type { GrowScheme } from '@fg2/shared-types/v1';

/**
 * A grid somebody is part way through changing, and the stored grid it was
 * changed against.
 *
 * Both halves matter. The draft alone cannot say whether anybody else has moved
 * the grid underneath it, and a screen that cannot say that is a screen that
 * silently puts an old table back over a fellow grower's correction.
 */
export interface SchemeEdit {
  draft: GrowScheme | null;
  against: GrowScheme | null;
}

/**
 * The edit outlives the tab it was made on.
 *
 * The grow page mounts one tab at a time, so tapping Weeks and coming back
 * unmounts the editor - and a grid is a table somebody works across, which is
 * exactly the kind of unsaved work that must not disappear without a word. One
 * grow's worth is held, because a grid is filled in in one sitting and starting
 * on another grow is the end of that sitting.
 */
let held: { growId: string; edit: SchemeEdit } | null = null;

/** Nothing held, which is what a freshly opened tab has and what leaving the account behind has to leave behind with it. */
export const forgetSchemeEdit = () => {
  held = null;
};

export const useSchemeEdit = (growId: string): [SchemeEdit | null, (edit: SchemeEdit | null) => void] => {
  const [edit, setEdit] = useState<SchemeEdit | null>(held?.growId === growId ? held.edit : null);

  return [
    edit,
    next => {
      held = next ? { growId, edit: next } : null;
      setEdit(next);
    },
  ];
};

/** Whether two grids say the same thing, which is what "there is something to save" and "somebody else has saved" are both read off. */
export const sameScheme = (one: GrowScheme | null, other: GrowScheme | null): boolean => JSON.stringify(one) === JSON.stringify(other);
