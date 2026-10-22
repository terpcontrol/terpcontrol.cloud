import { DateTime } from 'luxon';
import type { EntryCreate } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { instantOf } from '@/ui/age';
import type { LogTarget, TileKind } from './log-context';

/** What a written line says it is, and what it is written against. Shared by the tiles, the details and the toast. */

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

/** What a write or a correction says about when: nothing unless somebody dated the line, so a write means "now" and a correction "as it was". */
export const occurredAt = (dated: Date | null): Pick<EntryCreate, 'occurredAt'> =>
  dated ? { occurredAt: instantOf(DateTime.fromJSDate(dated)) } : {};
