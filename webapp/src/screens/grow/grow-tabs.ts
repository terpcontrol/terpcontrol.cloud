/** The tabs of a grow's page, in the order they are drawn. The diary is the page's own address, each other tab a segment under it. */
export const GROW_TABS = ['diary', 'pictures', 'plants', 'feeding', 'report'] as const;
export type GrowTab = (typeof GROW_TABS)[number];

/** The tab an address names: the diary where it names none, null where it names nothing a grow has. */
export const growTabOf = (segment: string | undefined): GrowTab | null =>
  segment === undefined ? 'diary' : (GROW_TABS as readonly string[]).includes(segment) && segment !== 'diary' ? (segment as GrowTab) : null;

/** The address of a tab under a grow's own. */
export const growTabPath = (base: string, tab: GrowTab): string => (tab === 'diary' ? base : `${base}/${tab}`);
