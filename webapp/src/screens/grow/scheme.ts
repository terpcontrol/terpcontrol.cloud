import type { GrowListItem, SchemeAmount } from '@fg2/shared-types/v1';

/**
 * "Bio·Bloom 2 ml/l": one row of a grid, as it is printed. A week card is
 * handed figures the server has already put the grow's strength on; the grid
 * the grow carries is the scheme as published, and the strength is applied
 * wherever a can is actually dosed.
 */
export const amountLabel = (amount: SchemeAmount): string => `${amount.name} ${amount.value} ${amount.unit}`;

/** The name a scheme is known by: the shipped asset's id, or "own" for one the person made. */
export const schemeName = (grow: GrowListItem, t: (key: string) => string): string => {
  const origin = grow.scheme?.origin;
  if (!origin) return '';
  return origin.type === 'asset' ? origin.assetId.charAt(0).toUpperCase() + origin.assetId.slice(1) : t('grow.ownScheme');
};
