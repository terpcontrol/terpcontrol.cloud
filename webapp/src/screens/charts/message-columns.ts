import type { Entry, Severity } from '@fg2/shared-types/v1';
import { at } from '../timeline/window';

/**
 * What the messages under the charts are sorted and placed by: four plain
 * kinds of line, and the window cut into columns.
 */

export type MessageCategory = 'device' | 'alarm' | 'plan' | 'diary';

export const MESSAGE_CATEGORIES: MessageCategory[] = ['device', 'alarm', 'plan', 'diary'];

/** How many columns the lane is cut into: narrow enough to tap on a phone, enough to place a line within the window. */
export const COLUMNS = 48;

export const categoryOf = (entry: Pick<Entry, 'kind' | 'source'>): MessageCategory => {
  if (entry.kind === 'alarm' || entry.source === 'alarm') return 'alarm';
  if (entry.kind === 'plan' || entry.source === 'plan') return 'plan';
  if (entry.kind === 'system' || entry.source === 'device') return 'device';
  return 'diary';
};

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export interface Column {
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
