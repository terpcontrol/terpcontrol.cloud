import type { Entry, Plant } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { looseFigure, typedFigure } from '@/ui/figures';

/** A harvest's weights as the sheets that write them say them: the harvest sheet, and the one that weighs it again later. */

/** Why a typed weight cannot be sent, or null where it can: nothing typed is no weight, which is allowed. */
export const weightRefusal = (typed: string): 'number' | 'negative' | null => {
  if (typed.trim() === '') return null;
  const value = typedFigure(typed);
  return value === null ? 'number' : value < 0 ? 'negative' : null;
};

/** "300 g wet over 3 plants · 100 g each": what the server will do with the total, before it does it. */
export const shareNote = (t: Translate, count: number, wet: number | null, dry: number | null): string => {
  if (count === 0) return t('grow.lifecycle.harvest.pickSomething');
  if (wet === null && dry === null) return '';

  const each = (total: number) => looseFigure(Math.round((total / count) * 100) / 100);
  const parts = [
    wet === null ? '' : t('grow.lifecycle.harvest.eachWet', { total: looseFigure(wet), each: each(wet), count }),
    dry === null ? '' : t('grow.lifecycle.harvest.eachDry', { total: looseFigure(dry), each: each(dry), count }),
  ];

  return parts.filter(Boolean).join(' · ');
};

/** The plants a harvest line names, as they are called now. */
export const namesOf = (line: Pick<Entry, 'plantIds'>, plants: Plant[]): string =>
  plants
    .filter(plant => line.plantIds.includes(plant.id))
    .map(plant => plant.label)
    .join(', ');

/** What a harvest weighed: the totals typed in for it, either of them left empty. */
export type Weights = { wetWeightG: number | null; dryWeightG: number | null };

/** What a harvest line says it weighed. */
export const weightsOf = (line: Entry): Weights =>
  line.values.kind === 'harvest'
    ? { wetWeightG: line.values.wetWeightG, dryWeightG: line.values.dryWeightG }
    : { wetWeightG: null, dryWeightG: null };

/** "nass 100 g · trocken 22 g": what was typed in for a harvest, as its line in the diary says it. */
export const weightLine = (t: Translate, weights: Weights): string => {
  const { wetWeightG, dryWeightG } = weights;
  const parts = [
    wetWeightG === null ? '' : t('grow.report.wet', { grams: looseFigure(wetWeightG) }),
    dryWeightG === null ? '' : t('grow.report.dry', { grams: looseFigure(dryWeightG) }),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : t('grow.lifecycle.harvest.noWeight');
};
