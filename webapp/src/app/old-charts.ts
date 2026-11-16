import { timelinePath } from '@/app/places';
import { viewParams, withParams, WIDTHS } from '@/screens/timeline/view';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/ui/days';

/**
 * What a bookmark of the old charts page asked for, in Verlauf's words. The
 * old address named a device and carried its whole view in the query, and
 * growers kept such addresses, so they are read once here rather than dropped.
 */

/** The old page's widths, in milliseconds. */
const TIMESPANS: Record<string, number> = {
  '20m': 20 * MINUTE_MS,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '12h': 12 * HOUR_MS,
  '1d': DAY_MS,
  '3d': 3 * DAY_MS,
  '1w': 7 * DAY_MS,
  '2w': 14 * DAY_MS,
  '1m': 30 * DAY_MS,
  '3m': 90 * DAY_MS,
  '6m': 180 * DAY_MS,
  '1y': 365 * DAY_MS,
  '3y': WIDTHS[WIDTHS.length - 1],
};

const CHIPS: Record<number, '7d' | '30d'> = { [7 * DAY_MS]: '7d', [30 * DAY_MS]: '30d' };

const INTERVALS: Record<string, number> = {
  '5s': 5,
  '10s': 10,
  '20s': 20,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 4 * 3600,
  '1d': 24 * 3600,
  '1w': 7 * 24 * 3600,
};

/** The old page's names for its curves, which are the device's own field names, and what Verlauf ticks for each. */
const MEASURES: Record<string, string> = {
  temperature: 'temperature',
  humidity: 'humidity',
  vpd: 'vpd',
  co2: 'co2',
  leaf_temperature: 'leafTemperature',
  ppfd: 'ppfd',
  out_light: 'light',
  out_heater: 'outputs',
  out_dehumidifier: 'outputs',
  out_fan: 'outputs',
  out_co2: 'outputs',
  'out_fan-internal': 'outputs',
  'out_fan-external': 'outputs',
  'out_fan-backwall': 'outputs',
  logs: 'diary',
};

const instantOf = (value: string | null): number | null => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

export const timelineAddressOf = (spaceId: string, old: URLSearchParams): string => {
  const width = TIMESPANS[old.get('timespan') ?? ''] ?? null;
  const measures = (old.get('measures') ?? '').split(',').filter(Boolean);
  const from = instantOf(old.get('date'));
  const to = instantOf(old.get('dateEnd'));
  const vpd = old.get('vpdMode');
  // A start with an end was a zoom; a start alone was the window stepped back to it.
  const fixed = from !== null && to !== null && from < to ? { from, to } : from !== null && width !== null ? { from, to: from + width } : null;
  const ticked = [...new Set(measures.flatMap(name => (MEASURES[name] ? [MEASURES[name]] : [])))];

  const view = viewParams({
    ...(fixed ? { fixed } : width === null ? {} : CHIPS[width] ? { range: CHIPS[width] } : width === DAY_MS ? {} : { last: width }),
    ...(measures.length > 0 ? { show: [...ticked, ...(measures.includes('logs') ? ['machine'] : [])] } : {}),
    ...(vpd === 'day' || vpd === 'night' ? { vpdHalf: vpd } : {}),
    ...(INTERVALS[old.get('interval') ?? ''] ? { stepSeconds: INTERVALS[old.get('interval') ?? ''] } : {}),
  });

  return `/timeline?${withParams(new URLSearchParams(timelinePath(spaceId).split('?')[1]), view).toString()}`;
};
