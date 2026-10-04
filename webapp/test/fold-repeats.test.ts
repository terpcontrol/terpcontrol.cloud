import { describe, expect, it } from 'vitest';
import type { Entry } from '@fg2/shared-types/v1';
import { foldRepeats } from '@/ui/entries';

/** A tent's latest lines fold a run of one machine line said again and again into one row. */
const line = (id: string, occurredAt: string, over: Partial<Entry> = {}): Entry =>
  ({
    id,
    occurredAt,
    source: 'device',
    kind: 'system',
    deviceId: 'fridge',
    cameraId: null,
    mediaIds: [],
    text: null,
    message: { key: 'message-aux-command-failed', params: ['cam_capture'] },
    ...over,
  }) as Entry;

describe('folding repeated lines', () => {
  it('counts a run of the same machine line and keeps when it began', () => {
    const folded = foldRepeats([
      line('c', '2026-09-24T21:25:00Z'),
      line('b', '2026-09-24T21:18:00Z'),
      line('a', '2026-09-24T21:10:00Z'),
      line('m', '2026-09-24T21:06:00Z', { message: { key: 'message-maintenance-mode-activated-remote', params: ['4'] } }),
    ]);

    expect(folded.map(({ entry, count, since }) => [entry.id, count, since])).toEqual([
      ['c', 3, '2026-09-24T21:10:00Z'],
      ['m', 1, '2026-09-24T21:06:00Z'],
    ]);
  });

  it('never folds what a person wrote, nor a line from another device', () => {
    const watered = { source: 'human' as const, kind: 'water' as const, message: null, text: 'watered' };
    expect(foldRepeats([line('b', '2026-09-24T21:18:00Z', watered), line('a', '2026-09-24T21:10:00Z', watered)])).toHaveLength(2);
    expect(foldRepeats([line('b', '2026-09-24T21:18:00Z'), line('a', '2026-09-24T21:10:00Z', { deviceId: 'tent' })])).toHaveLength(2);
  });
});
