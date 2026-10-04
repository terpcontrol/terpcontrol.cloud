import type { GrowthStage } from '@fg2/shared-types/v1';

/** The six stages in the order a grow passes them. Not the contract's enum order by accident: it is that order. */
export const STAGES: GrowthStage[] = ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing'];

/**
 * Which week of the grow a day of it falls in: week 1 is days 1 to 7, so it
 * lines up with the feeding grid's first row.
 *
 * It takes a *grow* day. Handing it a phase's own day counter looks like it
 * works and answers a different question - how many sevens of that phase have
 * gone by, rather than which of the grow's weeks the stage is in - and that is
 * the arithmetic that made the header and the week card beneath it disagree.
 * Which week of a stage the grow is in is `summary.stageWeek`, answered by the
 * server so that every screen drawing it draws the same figure.
 */
export const weekOfGrowDay = (dayNumber: number | null): number | null => (dayNumber === null ? null : Math.floor((dayNumber - 1) / 7) + 1);
