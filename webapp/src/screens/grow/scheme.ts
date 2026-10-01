import type { GrowListItem, SchemeAmount } from '@fg2/shared-types/v1';

/**
 * "Bio·Bloom 2 ml/l": one row of a grid, as it is printed. A week card is
 * handed figures the server has already put the grow's strength on; the grid
 * the grow carries is the scheme as published, and the strength is applied
 * wherever a can is actually dosed.
 */
export const amountLabel = (amount: SchemeAmount): string => `${amount.name} ${amount.value} ${amount.unit}`;

/** "Biobizz Light Mix" for the asset id "biobizz-light-mix": the words of the id, each with its capital, and no slug. */
export const assetTitle = (assetId: string): string =>
  assetId
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** The name a scheme is known by: the shipped asset's, or "own" for one the person made. */
export const schemeName = (grow: GrowListItem, t: (key: string) => string): string => {
  const origin = grow.scheme?.origin;
  if (!origin) return '';
  return origin.type === 'asset' ? assetTitle(origin.assetId) : t('grow.ownScheme');
};
