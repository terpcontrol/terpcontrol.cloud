import type { GrowthStage } from '@fg2/shared-types/v1';

/** The six stages in the order a grow passes them. Not the contract's enum order by accident: it is that order. */
export const STAGES: GrowthStage[] = ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing'];

/** "Flower · wk 2": the week of the phase, counted from its first day like the grow's own week. */
export const weekOfPhase = (phaseDay: number | null): number | null => (phaseDay === null ? null : Math.floor((phaseDay - 1) / 7) + 1);
