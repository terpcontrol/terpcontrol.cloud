import { zoomValue } from '@/screens/charts/address';
import { instant, WIDTHS, type Width } from '@/screens/charts/span';

/**
 * What a bookmark of the old charts page asked for, in the words the Charts
 * view reads its own address in.
 *
 * The old page kept its whole view in the address - the timespan, the curves,
 * the step, the VPD half, auto-update, a stretch picked by date, the picture and
 * the messages - and people bookmarked it that way. Sent on as the bare place,
 * every one of those bookmarks opened on the default day. Only the old page's
 * own log categories have no counterpart: they were the firmware's keys, and
 * the messages are filtered by four plain kinds of line now.
 */

const TIMESPANS: Record<string, Width> = {
  '20m': '20m',
  '1h': '1h',
  '6h': '6h',
  '12h': '12h',
  '1d': '24h',
  '3d': '3d',
  '1w': '7d',
  '2w': '14d',
  '1m': '30d',
  '3m': '90d',
  '6m': '180d',
  '1y': '1y',
  '3y': '3y',
};

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

/** The old page's names for its curves, which are the device's own field names, and what the Charts view calls each. */
const MEASURES: Record<string, string> = {
  temperature: 'temperature',
  humidity: 'humidity',
  vpd: 'vpd',
  co2: 'co2',
  leaf_temperature: 'leafTemperature',
  ppfd: 'ppfd',
  out_heater: 'out.heater',
  out_dehumidifier: 'out.dehumidifier',
  out_fan: 'out.fan',
  out_co2: 'out.co2',
  out_light: 'out.light',
  'out_fan-internal': 'out.fanInternal',
  'out_fan-external': 'out.fanExternal',
  'out_fan-backwall': 'out.fanBackwall',
};

/** An instant the old page wrote, as the contract spells one; null where it wrote none or nothing that reads as one. */
const instantOf = (value: string | null): number | null => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

export const chartsAddressOf = (spaceId: string, old: URLSearchParams): string => {
  const next = new URLSearchParams({ space: spaceId });
  const range = TIMESPANS[old.get('timespan') ?? ''];
  if (range) next.set('range', range);

  const measures = (old.get('measures') ?? '').split(',').filter(Boolean);
  const shown = measures.flatMap(name => (MEASURES[name] ? [MEASURES[name]] : []));
  if (measures.length > 0) next.set('show', shown.join(','));
  if (measures.includes('logs')) next.set('msgs', '1');
  if (measures.includes('image')) next.set('cam', '1');

  const vpd = old.get('vpdMode');
  if (vpd === 'day' || vpd === 'night') next.set('vpd', vpd);
  if (old.get('autoUpdate') === 'true') next.set('live', '1');
  const step = INTERVALS[old.get('interval') ?? ''];
  if (step) next.set('step', String(step));

  // Two dates were a stretch of the old page's own; one was where a timespan started.
  const from = instantOf(old.get('date'));
  const to = instantOf(old.get('dateEnd'));
  if (from !== null && to !== null && from < to) next.set('zoom', zoomValue({ from, to }));
  else if (from !== null && range) next.set('at', instant(from + WIDTHS[range]));

  return `/charts?${next.toString()}`;
};
