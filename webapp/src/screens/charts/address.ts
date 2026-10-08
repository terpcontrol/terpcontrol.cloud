import { CHART_METRICS, CHART_OUTPUTS } from '@/api/charts';
import { VPD_HALVES, type ChartSettings } from '@/ui/advanced/item';
import { momentOf } from '../timeline/window';
import type { Picked } from './cards';
import { instant, type Zoom } from './span';
import { STEPS } from './steps';

/** The fine settings as the address carries them; anything it does not recognise is the default. */
export const settingsOf = (params: URLSearchParams): ChartSettings => {
  const step = Number(params.get('step'));
  const half = params.get('vpd');

  return {
    stepSeconds: STEPS.includes(step) ? step : null,
    vpdHalf: VPD_HALVES.find(one => one === half) ?? 'all',
    live: params.get('live') === '1',
  };
};

/**
 * The curves an address names: a metric by its name, an output and a grow's own
 * measurement each behind a prefix of its own, comma separated. Nothing named is
 * the board's own pick; named and empty is every curve turned off.
 */
const OUTPUT_MARK = 'out.';
const MEASUREMENT_MARK = 'm.';

export const pickedOf = (value: string | null): Picked | null => {
  if (value === null) return null;
  const names = value.split(',').filter(Boolean);
  return {
    metrics: CHART_METRICS.filter(metric => names.includes(metric)),
    outputs: CHART_OUTPUTS.filter(output => names.includes(OUTPUT_MARK + output)),
    measurements: names.filter(name => name.startsWith(MEASUREMENT_MARK)).map(name => name.slice(MEASUREMENT_MARK.length)),
  };
};

export const showOf = (picked: Picked): string =>
  [...picked.metrics, ...picked.outputs.map(output => OUTPUT_MARK + output), ...picked.measurements.map(key => MEASUREMENT_MARK + key)].join(',');

/** The zoom an address names, as two instants, or null where it names none or two that are not a stretch. */
export const zoomOf = (value: string | null): Zoom | null => {
  const [from, to] = (value ?? '').split('~').map(momentOf);
  return from != null && to != null && from < to ? { from, to } : null;
};

/** A zoom as the address writes it. */
export const zoomValue = (zoom: Zoom): string => `${instant(zoom.from)}~${instant(zoom.to)}`;
