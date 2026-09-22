import type { GrowthStage, SchemeWeek } from '@fg2/shared-types/v1';

/**
 * The grid, as the editor changes it.
 *
 * Every function here answers with a new grid and touches nothing it was given,
 * so that the screen holds one draft and compares it with what the grow
 * carries: that comparison is the whole of "there is something to save", and it
 * only means anything while the grid before it is still the grid before it.
 *
 * The arithmetic that *reads* a grid - which week a day falls in, what one can
 * of water takes - is `@fg2/shared-types/v1-schemas/feeding.js` and belongs to
 * the contract, because the server does the same sum. What is here is only the
 * shape of the table, which nothing but this editor changes.
 */

/** A row: one product, named once however many weeks dose it. */
export interface Product {
  productKey: string;
  name: string;
  unit: string;
}

/**
 * Every product the grid names, in the order the weeks first name them. A
 * well-formed grid states every product in every week, but one assembled by
 * hand need not, and a row that appears late is still a row.
 */
export const productsOf = (grid: readonly SchemeWeek[]): Product[] => {
  const products = new Map<string, Product>();
  for (const week of grid) {
    for (const amount of week.amounts) {
      if (!products.has(amount.productKey)) products.set(amount.productKey, { productKey: amount.productKey, name: amount.name, unit: amount.unit });
    }
  }
  return [...products.values()];
};

/** What that week doses of that product, where null is "not this week" and a week that never names it is the same answer. */
export const valueAt = (grid: readonly SchemeWeek[], weekNumber: number, productKey: string): number | null =>
  grid.find(week => week.week === weekNumber)?.amounts.find(amount => amount.productKey === productKey)?.value ?? null;

/**
 * One cell, changed. A week that had no row for the product gains one, because
 * a figure typed into an empty cell is a figure the grower meant.
 */
export const withValue = (grid: readonly SchemeWeek[], weekNumber: number, product: Product, value: number | null): SchemeWeek[] =>
  grid.map(week => {
    if (week.week !== weekNumber) return week;
    const known = week.amounts.some(amount => amount.productKey === product.productKey);
    return {
      ...week,
      amounts: known
        ? week.amounts.map(amount => (amount.productKey === product.productKey ? { ...amount, value } : amount))
        : [...week.amounts, { ...product, value }],
    };
  });

/** A product added to every week at once, dosed nowhere until a cell says so. */
export const withProduct = (grid: readonly SchemeWeek[], product: Product): SchemeWeek[] =>
  grid.map(week => ({ ...week, amounts: [...week.amounts, { ...product, value: null }] }));

export const withoutProduct = (grid: readonly SchemeWeek[], productKey: string): SchemeWeek[] =>
  grid.map(week => ({ ...week, amounts: week.amounts.filter(amount => amount.productKey !== productKey) }));

/**
 * A key nothing else in the grid uses, made from what was typed. The key is
 * what ties a dose to the product it is a dose of, so two rows that shared one
 * would be one row wherever the grid is read.
 */
export const productKeyFor = (name: string, taken: readonly Product[]): string => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'product';
  let key = base;
  for (let suffix = 2; taken.some(product => product.productKey === key); suffix += 1) key = `${base}_${suffix}`;
  return key;
};

/** The last week again, as the next one: the commonest edit at the end of a grid that ran out before the plants did. */
export const withLastWeekRepeated = (grid: readonly SchemeWeek[]): SchemeWeek[] => {
  const last = grid[grid.length - 1];
  if (!last) return [...grid];
  return [...grid, { ...last, week: last.week + 1, amounts: last.amounts.map(amount => ({ ...amount })) }];
};

/** How many weeks of the grid are flowering, which is the length a grower judges a scheme by. */
export const flowerWeeks = (grid: readonly SchemeWeek[]): number => grid.filter(week => week.stage === 'flowering').length;

/**
 * A longer bloom, by repeating the last week of it. Charts are printed for the
 * strain the manufacturer had in mind, and a strain that takes ten weeks is fed
 * the last week's figures for the weeks the chart does not reach - which is
 * what a grower does anyway, and is better done where it can be seen.
 *
 * It only ever lengthens: shortening would throw away weeks somebody may have
 * edited, and a scheme longer than the grow simply runs out unread.
 */
export const withFlowerWeeks = (grid: readonly SchemeWeek[], count: number): SchemeWeek[] => {
  let next = [...grid];
  while (flowerWeeks(next) < count) {
    const last = next[next.length - 1];
    if (!last) break;
    next = [...next, { ...last, week: last.week + 1, stage: 'flowering', amounts: last.amounts.map(amount => ({ ...amount })) }];
  }
  return next;
};

/**
 * The flip moved, and the stages with it.
 *
 * A week's stage and the flip week are two statements about the same day, and a
 * grid whose bloom column starts somewhere its stages do not say "flowering"
 * contradicts itself wherever it is read - the week cards, the feed sheet, the
 * charts' phase band. So moving the flip restages the grid rather than leaving
 * the two to disagree; what came before the flip keeps whatever it was, since
 * germinating and rooting are distinctions the flip knows nothing about.
 *
 * An autoflower has no flip at all, and its stages are left exactly as they are.
 */
export const withFlipWeek = (grid: readonly SchemeWeek[], flipWeek: number | null): SchemeWeek[] => {
  if (flipWeek === null) return [...grid];
  return grid.map(week => ({ ...week, stage: week.week >= flipWeek ? 'flowering' : beforeFlip(week.stage) }));
};

const beforeFlip = (stage: GrowthStage | null): GrowthStage | null => (stage === 'flowering' ? 'vegetative' : stage);
