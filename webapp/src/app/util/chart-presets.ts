export interface CuratedChartPreset {
  id: string;
  icon: string;
  measures: string[];
  timespan: string;
  interval?: string;
  vpdMode?: 'all' | 'day' | 'night';
}

/**
 * One-tap analysis views for the charts page. A preset is offered when the
 * device provides enough of its series (all single-series presets, at least
 * two otherwise) — so e.g. the light/canopy view only appears on controllers.
 */
export const CURATED_CHART_PRESETS: CuratedChartPreset[] = [
  { id: 'climate', icon: 'thermometer-outline', measures: ['temperature', 'humidity', 'vpd'], timespan: '1d' },
  { id: 'vpd', icon: 'leaf-outline', measures: ['vpd'], timespan: '1w', vpdMode: 'day' },
  { id: 'co2', icon: 'cloud-outline', measures: ['co2', 'out_co2'], timespan: '1d' },
  { id: 'light', icon: 'sunny-outline', measures: ['out_light', 'leaf_temperature', 'ppfd'], timespan: '1d' },
  { id: 'drying', icon: 'water-outline', measures: ['temperature', 'humidity'], timespan: '2w' },
];

export function availableCuratedPresets(availableMeasureNames: string[]): CuratedChartPreset[] {
  return CURATED_CHART_PRESETS.filter(preset => {
    const available = preset.measures.filter(name => availableMeasureNames.includes(name));
    return available.length >= Math.min(2, preset.measures.length);
  });
}
