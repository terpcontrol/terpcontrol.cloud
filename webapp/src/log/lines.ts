import type { EntryCreate } from '@fg2/shared-types/v1';
import type { LogTarget, TileKind } from './log-context';

/** What a written line says it is, and what it is written against. Shared by the tiles, the details and the toast. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Watered · Spring run · Day 34": what the toast says it wrote, in the words the timeline uses. */
export const lineLabel = (t: Translate, kind: TileKind, target: LogTarget): string =>
  [t(`home.entryKind.${kind}`), target.label, target.dayNumber === null ? '' : t('home.card.dayN', { day: target.dayNumber })]
    .filter(Boolean)
    .join(' · ');

/**
 * Where a line goes. A grow keeps its diary when it moves between tents, so a
 * line about a grow names the grow and never the tent it happens to stand in.
 */
export const about = (target: LogTarget): Pick<EntryCreate, 'growId' | 'spaceId' | 'plantIds'> => ({
  growId: target.growId ?? undefined,
  spaceId: target.spaceId ?? undefined,
  plantIds: target.plantIds.length > 0 ? target.plantIds : undefined,
});

/**
 * What one tap writes. A feed names its water and nothing else - "log as
 * planned" - because the doses are the server's to read off the grow's own grid
 * at the week the feed happened in.
 */
export const oneTapBody = (kind: TileKind, target: LogTarget, litres: number | null): EntryCreate => {
  switch (kind) {
    case 'water':
      return { kind: 'water', ...about(target), values: { kind: 'water', litres } };
    case 'feed':
      return { kind: 'feed', ...about(target), values: { kind: 'feed', litres } };
    case 'training':
      return { kind: 'training', ...about(target), values: { kind: 'training' } };
    default:
      return { kind: 'visit', ...about(target), values: { kind: 'visit' } };
  }
};
