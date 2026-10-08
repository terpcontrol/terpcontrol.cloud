import type { GrowthStage } from '@fg2/shared-types/v1';

/** The six stages in the order a grow passes them. Not the contract's enum order by accident: it is that order. */
export const STAGES: GrowthStage[] = ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing'];
