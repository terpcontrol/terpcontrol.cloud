import type { StillDeletion } from '@fg2/shared-types/v1';

/**
 * Which stills of a span are picked for deletion: one by one, or the whole span
 * but those tapped off again. Nothing is picked at first, so taking one picture
 * out never means tapping a thousand others off.
 */
export interface Picked {
  all: boolean;
  /** One by one: the picked ones. The whole span: the ones tapped off again. */
  ids: ReadonlySet<string>;
}

export const NOTHING: Picked = { all: false, ids: new Set() };

export const isPicked = (picked: Picked, id: string): boolean => picked.all !== picked.ids.has(id);

export const toggled = (picked: Picked, id: string): Picked => {
  const ids = new Set(picked.ids);
  if (!ids.delete(id)) ids.add(id);

  return { all: picked.all, ids };
};

/** How many stills go: `total` is every still of the span, `kept` the ones a diary holds on to, which never go. */
export const countOf = (picked: Picked, total: number, kept: number): number =>
  picked.all ? Math.max(total - kept - picked.ids.size, 0) : picked.ids.size;

/** What is asked of the server; null while nothing is picked. */
export const deletionOf = (picked: Picked, span: { startsAt: string; endsAt: string }): StillDeletion | null => {
  if (picked.all) return { ...span, except: [...picked.ids] };

  return picked.ids.size > 0 ? { ids: [...picked.ids] } : null;
};
