/** The tabs of a grow's page, in the order they are drawn; each is the last segment of an address. */
export const GROW_TABS = ['weeks', 'plants', 'feeding', 'report'] as const;
export type GrowTab = (typeof GROW_TABS)[number];

export const isGrowTab = (value: string | undefined): value is GrowTab => (GROW_TABS as readonly string[]).includes(value ?? '');
