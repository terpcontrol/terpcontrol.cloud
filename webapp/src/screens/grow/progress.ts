import { growWeekOfDay } from '@fg2/shared-types/v1-schemas/feeding.js';
import type { GrowthStage } from '@fg2/shared-types/v1';
import { useGrow } from '@/api/grows';
import type { Translate } from '@/i18n/i18n';
import { STAGES } from '@/ui/stages';

/** The stages a grow is harvested after: once it dries, nothing is left to wait for. */
const GROWING = STAGES.indexOf('drying');

/**
 * How far along a grow is. Where it is fed by a scheme, the scheme's weeks are
 * the length it was planned at: the bar fills by the days gone, and what is
 * left to the scheme's last week is said. Without one nothing states a length,
 * so the bar fills by the stages reached and no harvest is promised.
 */
export const useProgress = (grow: {
  growId: string;
  stage: GrowthStage | null;
  dayNumber: number | null;
}): { fill: number; weeksLeft: number | null } => {
  const weeks = useGrow(grow.growId).data?.scheme?.grid.length ?? null;
  const at = grow.stage ? STAGES.indexOf(grow.stage) : -1;
  if (weeks && grow.dayNumber !== null && at < GROWING) {
    return { fill: Math.min(1, grow.dayNumber / (weeks * 7)), weeksLeft: Math.max(0, weeks - growWeekOfDay(grow.dayNumber)) };
  }
  return { fill: (at + 1) / STAGES.length, weeksLeft: null };
};

/** "Tag 29" of a grow, wherever it stands beside the grow's name or stage; nothing for one that has not begun. */
export const growDay = (t: Translate, grow: { dayNumber: number | null }): string | null =>
  grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null;
