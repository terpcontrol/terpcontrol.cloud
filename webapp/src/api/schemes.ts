import { useQuery } from '@tanstack/react-query';
import type { GrowScheme, GrowType, SchemeWeek } from '@fg2/shared-types/v1';

/**
 * The feeding schemes the app ships: a manufacturer's published chart, read
 * into the contract's grid and laid down as a JSON asset beside the catalogues.
 *
 * They are not the API's. The server never reads a scheme - a grow carries the
 * grid it was started with, so a chart corrected next spring leaves every grow
 * already running exactly as it was fed. What an asset is, therefore, is a
 * starting point: the new-grow sheet takes one, `growSchemeOf` turns it into
 * the `GrowScheme` the grow is created with, and from that moment the two have
 * nothing more to do with each other. `origin.version` is what says which
 * reading of the chart a grow took, and it is why the assets are versioned
 * rather than quietly corrected in place.
 *
 * `.claude/skills/feeding-schemes` is how they are re-read from the
 * manufacturers' current charts.
 */

/** Where the assets sit in the bundle. Static files, so they are fetched rather than asked of the API. */
const FOLDER = '/assets/schemes';

/** What a grow's `scheme.plantType` may be set to: the medium or plant type the chart is published for. */
export interface SchemePlantType {
  key: string;
  name: string;
}

/** The chart a scheme was read from, so a figure can always be taken back to what printed it. */
export interface SchemeSource {
  title: string;
  url: string;
  readAt: string;
}

/** One line of the index: enough to offer a scheme without reading its grid. */
export interface SchemeSummary {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
  plantTypes: SchemePlantType[];
  defaultPlantType: string;
  weeks: number;
  flipWeek: number;
  source: SchemeSource;
}

/**
 * A whole scheme. `notes` is written for whoever reads the asset next - how the
 * chart's columns became weeks, which figure of a printed range was taken - and
 * never for the screen, which is why it is not in the catalogues.
 */
export interface SchemeAsset extends Omit<SchemeSummary, 'weeks'> {
  notes: string[];
  grid: SchemeWeek[];
}

interface SchemeIndex {
  schemes: SchemeSummary[];
}

const readAsset = async <T>(file: string, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(`${FOLDER}/${file}`, { signal });
  if (!response.ok) throw new Error(`scheme asset ${file}: ${response.status}`);
  return (await response.json()) as T;
};

export const schemesKey = ['schemes'];

export const schemeKey = (id: string | null) => ['schemes', id];

/**
 * An asset ships with the build and cannot change under a running app, so it is
 * read once and kept: nothing is gained by asking for it again on every focus.
 */
const FOREVER = { staleTime: Infinity, gcTime: Infinity } as const;

/**
 * Every scheme the build carries, in the order the index lists them. A build
 * with no schemes folder answers an empty list rather than an error, because a
 * client without them is a client that asks one question less - and a sheet
 * that could not tell the two apart would draw a refusal where there is
 * nothing to refuse.
 */
export const useSchemes = () =>
  useQuery({
    queryKey: schemesKey,
    queryFn: async ({ signal }) => (await readAsset<SchemeIndex>('index.json', signal).catch(() => ({ schemes: [] }))).schemes,
    ...FOREVER,
  });

/** One scheme with its grid, read when somebody has chosen it. */
export const useScheme = (id: string | null) =>
  useQuery({
    queryKey: schemeKey(id),
    queryFn: ({ signal }) => readAsset<SchemeAsset>(`${id}.json`, signal),
    enabled: id !== null,
    ...FOREVER,
  });

/** The chip a scheme is known by, which is the chart's own year and month. */
export const schemeVersionLabel = (version: string): string => `v${version}`;

/**
 * Half the published amounts for an autoflower. It never gets the 12/12 flip,
 * so it spends its whole life under a long day and runs the shorter season of
 * a smaller plant; the charts are written for a photoperiod, and a grower who
 * feeds an autoflower the printed figures is the one who burns the tips.
 */
export const AUTOFLOWER_STRENGTH = 0.5;

/**
 * The scheme a `POST /grows` carries, from the asset somebody picked.
 *
 * The grid goes across as published - what the grower changes afterwards is
 * theirs and sets `edited` - and everything else is the reading of it: how
 * strong, on what water, which of the chart's media, and the week the light is
 * flipped, which an autoflower does not have at all.
 */
export const growSchemeOf = (
  asset: SchemeAsset,
  { type, plantType, waterEc = null }: { type: GrowType; plantType?: string; waterEc?: number | null },
): GrowScheme => ({
  origin: { type: 'asset', assetId: asset.id, version: asset.version },
  strength: type === 'autoflower' ? AUTOFLOWER_STRENGTH : 1,
  waterEc,
  plantType: plantType ?? asset.defaultPlantType,
  flipWeek: type === 'autoflower' ? null : asset.flipWeek,
  edited: false,
  grid: asset.grid,
});
