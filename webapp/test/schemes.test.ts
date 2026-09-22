import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemeWeek } from '@fg2/shared-types/v1-schemas/common.js';
import { dosesFor, schemeWeekOf } from '@fg2/shared-types/v1-schemas/feeding.js';
import { growCreate } from '@fg2/shared-types/v1-schemas/growing.js';
import { AUTOFLOWER_STRENGTH, growSchemeOf, schemeVersionLabel, type SchemeAsset, type SchemeSummary } from '@/api/schemes';

/**
 * The shipped schemes, held against the contract they are written for.
 *
 * Nobody types a grid: it is read off a manufacturer's chart and written down
 * by the `feeding-schemes` skill, which is exactly the kind of work that goes
 * wrong quietly - a week left out, a figure in the unit the chart printed
 * rather than the one the arithmetic wants, a product that stops in the middle
 * of the grid. So every asset is parsed here with the contract's own schemas,
 * and what the new-grow sheet would send is parsed with the route's.
 */

const FOLDER = resolve(process.cwd(), 'public/assets/schemes');

const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(FOLDER, file), 'utf8')) as T;

const index = read<{ schemes: SchemeSummary[] }>('index.json');
const assets = index.schemes.map(summary => read<SchemeAsset>(`${summary.id}.json`));

describe('the shipped feeding schemes', () => {
  it('ships the three the new-grow sheet offers, and no file the index does not name', () => {
    expect(index.schemes.map(scheme => scheme.name)).toEqual(['Biobizz · Light·Mix', 'Biobizz · All·Mix', 'Canna Terra']);
    expect(readdirSync(FOLDER).sort()).toEqual(['index.json', ...index.schemes.map(scheme => `${scheme.id}.json`)].sort());
  });

  it.each(assets.map(asset => [asset.id, asset] as const))('%s is a grid the contract accepts', (_id, asset) => {
    for (const week of asset.grid) expect(schemeWeek.parse(week)).toEqual(week);
  });

  it.each(assets.map(asset => [asset.id, asset] as const))('%s counts its weeks from one without a gap', (_id, asset) => {
    expect(asset.grid.map(week => week.week)).toEqual(Array.from({ length: asset.grid.length }, (_, step) => step + 1));
    expect(asset.flipWeek).toBeGreaterThanOrEqual(1);
    expect(asset.flipWeek).toBeLessThanOrEqual(asset.grid.length);
  });

  /**
   * The flip is the week the light goes to twelve hours, which is the week the
   * chart turns the plant to flower - so it is the first week the grid calls
   * flowering, and a scheme that said otherwise would have the grow's feeding
   * tab disagree with its own rows.
   */
  it.each(assets.map(asset => [asset.id, asset] as const))('%s flips in the week its own grid begins to flower', (_id, asset) => {
    expect(asset.flipWeek).toBe(asset.grid.find(week => week.stage === 'flowering')?.week);
  });

  it.each(assets.map(asset => [asset.id, asset] as const))('%s doses per litre, in a unit the sheet can draw', (_id, asset) => {
    for (const week of asset.grid) {
      for (const amount of week.amounts) {
        expect(amount.unit).toMatch(/^(ml|g)\/l$/);
        if (amount.value !== null) expect(amount.value).toBeGreaterThan(0);
      }
    }
  });

  it.each(assets.map(asset => [asset.id, asset] as const))('%s names every product in every week, so a row never appears twice', (_id, asset) => {
    const products = asset.grid[0].amounts.map(amount => amount.productKey);
    expect(new Set(products).size).toBe(products.length);
    for (const week of asset.grid) expect(week.amounts.map(amount => amount.productKey)).toEqual(products);
  });

  it.each(assets.map(asset => [asset.id, asset] as const))('%s says where its figures came from and when they were read', (_id, asset) => {
    expect(asset.source.url).toMatch(/^https:\/\//);
    expect(asset.source.readAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(asset.notes.length).toBeGreaterThan(0);
  });

  it('is summarised in the index exactly as the asset states it', () => {
    for (const [summary, asset] of index.schemes.map((summary, at) => [summary, assets[at]] as const)) {
      expect(summary.id).toBe(asset.id);
      expect(summary.version).toBe(asset.version);
      expect(summary.flipWeek).toBe(asset.flipWeek);
      expect(summary.weeks).toBe(asset.grid.length);
      expect(summary.plantTypes).toEqual(asset.plantTypes);
      expect(summary.plantTypes.map(type => type.key)).toContain(summary.defaultPlantType);
    }
  });

  it('carries what the chart prints, as the chart prints it', () => {
    const lightMix = assets.find(asset => asset.id === 'biobizz-light-mix')!;
    const week = schemeWeekOf(lightMix.grid, 9)!;

    // The chart's WK 6, where Top·Max goes from 1 to 4 ml/l.
    expect(week.amounts.find(amount => amount.productKey === 'top_max')?.value).toBe(4);
    expect(week.amounts.find(amount => amount.productKey === 'bio_bloom')?.value).toBe(4);
    // Root·Juice is a vegetative product and is over by then, rather than dosed at zero.
    expect(week.amounts.find(amount => amount.productKey === 'root_juice')?.value).toBeNull();
    // The last week is the plain-water one the chart ends on.
    expect(schemeWeekOf(lightMix.grid, 12)!.amounts.every(amount => amount.value === null)).toBe(true);
  });

  it('fills a five litre can the way the contract multiplies', () => {
    const terra = assets.find(asset => asset.id === 'canna-terra')!;

    expect(dosesFor(schemeWeekOf(terra.grid, 10), 5)).toEqual([
      { productKey: 'terra_flores', name: 'Terra Flores', amount: 30, unit: 'ml' },
      { productKey: 'rhizotonic', name: 'Rhizotonic', amount: 2.5, unit: 'ml' },
      { productKey: 'cannazym', name: 'Cannazym', amount: 12.5, unit: 'ml' },
      { productKey: 'cannaboost', name: 'Cannaboost', amount: 10, unit: 'ml' },
      { productKey: 'pk_13_14', name: 'PK 13/14', amount: 7.5, unit: 'ml' },
    ]);
  });
});

describe('an asset on its way into a grow', () => {
  const asset = assets[0];
  const body = (scheme: ReturnType<typeof growSchemeOf>) => ({
    name: 'Spring run',
    type: 'photoperiod',
    plants: [{ strain: 'Amnesia', count: 4 }],
    scheme,
  });

  it('is what POST /grows accepts, with the asset and its version named', () => {
    const scheme = growSchemeOf(asset, { type: 'photoperiod', waterEc: 0.4 });

    expect(growCreate.parse(body(scheme)).scheme).toEqual(scheme);
    expect(scheme.origin).toEqual({ type: 'asset', assetId: asset.id, version: asset.version });
    expect(scheme).toMatchObject({ strength: 1, waterEc: 0.4, plantType: asset.defaultPlantType, flipWeek: asset.flipWeek, edited: false });
    expect(scheme.grid).toEqual(asset.grid);
  });

  it('feeds an autoflower lighter and never flips it', () => {
    const scheme = growSchemeOf(asset, { type: 'autoflower' });

    expect(growCreate.parse(body(scheme)).scheme).toEqual(scheme);
    expect(scheme).toMatchObject({ strength: AUTOFLOWER_STRENGTH, flipWeek: null, waterEc: null });
    expect(dosesFor(schemeWeekOf(scheme.grid, 9), 1, scheme.strength).find(dose => dose.productKey === 'top_max')?.amount).toBe(2);
  });

  it('takes the medium that was chosen rather than the default', () => {
    expect(growSchemeOf(asset, { type: 'photoperiod', plantType: 'coco_mix' }).plantType).toBe('coco_mix');
  });

  it('names its version the way the scheme editor prints it', () => {
    expect(schemeVersionLabel(asset.version)).toBe(`v${asset.version}`);
  });
});
