import type { GrowListItem, SchemeAmount } from '@fg2/shared-types/v1';

/** "Bio·Bloom 2 ml/l": the amount as the scheme prints it, with the grow's strength already applied by the server. */
export const amountLabel = (amount: SchemeAmount): string => `${amount.name} ${amount.value} ${amount.unit}`;

/** The name a scheme is known by: the shipped asset's id, or "own" for one the person made. */
export const schemeName = (grow: GrowListItem, t: (key: string) => string): string => {
  const origin = grow.scheme?.origin;
  if (!origin) return '';
  return origin.type === 'asset' ? origin.assetId.charAt(0).toUpperCase() + origin.assetId.slice(1) : t('grow.ownScheme');
};
