import type { Entry, Severity } from '@fg2/shared-types/v1';
import { at } from '../timeline/window';

/**
 * What the messages under the charts are sorted and placed by: four plain
 * kinds of line, and the window cut into columns.
 */

export type MessageCategory = 'device' | 'alarm' | 'plan' | 'diary';

export const MESSAGE_CATEGORIES: MessageCategory[] = ['device', 'alarm', 'plan', 'diary'];

/** How many columns the lane is cut into: narrow enough to tap on a phone, enough to place a line within the window. */
const COLUMNS = 48;

export const categoryOf = (entry: Pick<Entry, 'kind' | 'source'>): MessageCategory => {
  if (entry.kind === 'alarm' || entry.source === 'alarm') return 'alarm';
  if (entry.kind === 'plan' || entry.source === 'plan') return 'plan';
  if (entry.kind === 'system' || entry.source === 'device') return 'device';
  return 'diary';
};

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

interface Column {
  from: number;
  to: number;
  entries: Entry[];
  /** The worst of what was written in it; null for an empty column and for lines nobody graded. */
  severity: Severity | null;
}

/** The window cut into columns, each holding the lines written in it. */
export const columnsOf = (entries: readonly Entry[], from: number, to: number, count = COLUMNS): Column[] => {
  const width = (to - from) / count;
  const columns: Column[] = Array.from({ length: count }, (_, index) => ({
    from: from + index * width,
    to: from + (index + 1) * width,
    entries: [],
    severity: null,
  }));

  for (const entry of entries) {
    const time = at(entry.occurredAt);
    if (time < from || time > to || width <= 0) continue;
    const column = columns[Math.min(count - 1, Math.floor((time - from) / width))];
    column.entries.push(entry);
    if (entry.severity && (column.severity === null || RANK[entry.severity] > RANK[column.severity])) column.severity = entry.severity;
  }

  return columns;
};

/** How far from a finger a column with lines in it is still the one meant. */
const REACH_PX = 20;

/** The column with lines in it nearest to where the lane was tapped, within reach; null where none is. */
export const nearestColumn = (columns: readonly Column[], x: number, width: number): number | null => {
  if (width <= 0 || columns.length === 0) return null;
  const tapped = Math.min(columns.length - 1, Math.max(0, Math.floor((x / width) * columns.length)));
  const reach = Math.max(1, Math.ceil((REACH_PX / width) * columns.length));
  for (let distance = 0; distance <= reach; distance += 1) {
    for (const index of [tapped - distance, tapped + distance]) if (columns[index]?.entries.length) return index;
  }
  return null;
};
