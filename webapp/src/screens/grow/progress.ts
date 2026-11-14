import { growWeekOfDay } from '@fg2/shared-types/v1-schemas/feeding.js';
import type { GrowthStage } from '@fg2/shared-types/v1';
import { useGrow } from '@/api/grows';
import type { Translate } from '@/i18n/i18n';
import { STAGES } from '@/ui/stages';

/** The stages a grow is harvested after: once it dries, nothing is left to wait for. */
const GROWING = STAGES.indexOf('drying');

/**
 * How far along a grow is. Where it is fed by a scheme, the scheme's weeks are
 * the length it was planned at: `fill` is the days gone of the days planned,
 * and what is left to the scheme's last week is said. Without one nothing
 * states a length and no harvest is promised: `fill` is null, and `reached` -
 * how many of the stages the grow has entered - is all there is to draw
 * (`GrowBar`).
 */
export const useProgress = (grow: {
  growId: string;
  stage: GrowthStage | null;
  dayNumber: number | null;
}): { fill: number | null; reached: number; weeksLeft: number | null } => {
  const weeks = useGrow(grow.growId).data?.scheme?.grid.length ?? null;
  const reached = grow.stage ? STAGES.indexOf(grow.stage) + 1 : 0;
  if (weeks && grow.dayNumber !== null && reached <= GROWING) {
    return { fill: Math.min(1, grow.dayNumber / (weeks * 7)), reached, weeksLeft: Math.max(0, weeks - growWeekOfDay(grow.dayNumber)) };
  }
  return { fill: null, reached, weeksLeft: null };
};

/** "Tag 29" of a grow, wherever it stands beside the grow's name or stage; nothing for one that has not begun. */
export const growDay = (t: Translate, grow: { dayNumber: number | null }): string | null =>
  grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null;

/**
 * "Blüte · 1 von 2 Pflanzen": a grow whose plants went their own ways, named by the stage at its head with how many
 * of its plants stand in it - the stage's week and a list of counts read as if the whole grow flowered ("Blüte,
 * Woche 1 · 1 Blüte, 1 Veg"). `said` is the stage as the caller names it. Null for a grow whose plants are all in one
 * stage, or whose counts are hidden.
 */
export const splitWords = (
  t: Translate,
  said: string,
  headline: GrowthStage | null,
  groups: readonly { stage: GrowthStage; count: number | null }[],
): string | null => {
  const counted = groups.filter(group => group.count !== 0);
  if (headline === null || counted.length < 2 || counted.some(group => group.count === null)) return null;
  const total = counted.reduce((sum, group) => sum + group.count!, 0);
  const part = counted.filter(group => group.stage === headline).reduce((sum, group) => sum + group.count!, 0);

  return part > 0 && part < total ? t('grow.splitOf', { stage: said, part, count: total }) : null;
};
