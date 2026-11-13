import type { ChartView, ChartViewDefinition, Metric, OutputMetric, TimelineRange } from '@fg2/shared-types/v1';
import type { TimelineAsk } from '@/api/timeline';
import { instantOf } from '@/ui/age';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/ui/days';
import { zonedAt } from '@/ui/zone';
import { momentOf } from './window';

/**
 * Verlauf's whole view, as its address carries it: which stretch of time, where
 * the cursor stands, what is drawn. A reload, a bookmark and a link sent to
 * somebody open on the same picture, and every link into Verlauf - a diary
 * line, an alert, a day of the camera - is written and read here and nowhere
 * else.
 */

export const RANGES: TimelineRange[] = ['24h', '7d', '30d', 'phase', 'grow'];

/** The chips that are a width ending now. */
const ROLLING: Partial<Record<TimelineRange, number>> = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };

/**
 * The widths a zoom steps through, each a few times the one before: from the
 * three years the old charts reached down to five minutes of single samples,
 * by way of the hour a grower thinks in.
 */
export const WIDTHS = [
  5 * MINUTE_MS,
  20 * MINUTE_MS,
  HOUR_MS,
  6 * HOUR_MS,
  DAY_MS,
  3 * DAY_MS,
  7 * DAY_MS,
  30 * DAY_MS,
  90 * DAY_MS,
  365 * DAY_MS,
  3 * 365 * DAY_MS,
];

const NARROWEST = WIDTHS[0];
const WIDEST = WIDTHS[WIDTHS.length - 1];

/** The steps "Abstand der Punkte" offers beside the automatic one, in seconds. */
export const STEPS = [5, 60, 600, 3600];

/**
 * From this width on the server works VPD out from means over a grain and draws every step as whole grains: no
 * step finer than a grain is offered there, and VPD's low and high are those of the grains' means.
 */
export const GRAINED_FROM_MS = 3 * DAY_MS;

/** The grain of a window that wide, in minutes: five, and more only past four and a half months (the server's `deficitGrainFor`). */
export const grainMinutes = (span: Span): number => Math.max(5, Math.ceil((span.to - span.from) / 1000 / 40_000 / 300) * 5);

export const VPD_HALVES = ['all', 'day', 'night'] as const;
export type VpdHalf = (typeof VPD_HALVES)[number];

export interface Span {
  from: number;
  to: number;
}

export interface View {
  range: TimelineRange;
  /** A window that stands still: stepped back to, zoomed into, a day somebody opened. */
  fixed: Span | null;
  /** A width ending now that no chip names, in milliseconds. */
  last: number | null;
  /** Where the cursor stands; null rests at the end of the window. */
  at: number | null;
  growId: string | null;
  deviceId: string | null;
  /** The curves ticked, by their keys; null leaves the choice to the page. */
  show: string[] | null;
  /** All curves in one picture. */
  one: boolean;
  stepSeconds: number | null;
  vpdHalf: VpdHalf;
  /** What is laid over the curves: an earlier grow on the same grow days, or another place at the same hours. */
  compare: { kind: 'grow' | 'space'; id: string } | null;
  /** The reading a link was about, scrolled to and marked. */
  focus: string | null;
}

const compareOf = (value: string | null): View['compare'] => {
  const [kind, id] = (value ?? '').split(':');
  return (kind === 'grow' || kind === 'space') && id ? { kind, id } : null;
};

export const viewOf = (params: URLSearchParams): View => {
  const [from, to] = [momentOf(params.get('from')), momentOf(params.get('to'))];
  const fixed = from !== null && to !== null && from < to ? { from, to } : null;
  const last = Number(params.get('last')) * 1000;
  const step = Number(params.get('step'));

  return {
    range: RANGES.find(range => range === params.get('range')) ?? '24h',
    fixed,
    last: fixed === null && last >= NARROWEST && last <= WIDEST ? last : null,
    at: momentOf(params.get('at')),
    growId: params.get('grow'),
    deviceId: params.get('device'),
    show: params.has('show') ? (params.get('show') ?? '').split(',').filter(Boolean) : null,
    one: params.get('one') === '1',
    stepSeconds: Number.isInteger(step) && step >= 5 ? step : null,
    vpdHalf: VPD_HALVES.find(half => half === params.get('vpd')) ?? 'all',
    compare: compareOf(params.get('compare')),
    focus: params.get('focus'),
  };
};

const instant = (time: number): string => instantOf(zonedAt(time, 'UTC'));

/** The address parameters a change of the view comes to; a default is written as no parameter at all. */
export const viewParams = (over: Partial<View>): Record<string, string | null> => ({
  ...('range' in over ? { range: over.range === '24h' ? null : (over.range ?? null) } : {}),
  ...('fixed' in over ? { from: over.fixed ? instant(over.fixed.from) : null, to: over.fixed ? instant(over.fixed.to) : null } : {}),
  ...('last' in over ? { last: over.last ? String(Math.round(over.last / 1000)) : null } : {}),
  ...('at' in over ? { at: over.at == null ? null : instant(over.at) } : {}),
  ...('growId' in over ? { grow: over.growId ?? null } : {}),
  ...('deviceId' in over ? { device: over.deviceId ?? null } : {}),
  ...('show' in over ? { show: over.show ? over.show.join(',') : null } : {}),
  ...('one' in over ? { one: over.one ? '1' : null } : {}),
  ...('stepSeconds' in over ? { step: over.stepSeconds ? String(over.stepSeconds) : null } : {}),
  ...('vpdHalf' in over ? { vpd: over.vpdHalf && over.vpdHalf !== 'all' ? over.vpdHalf : null } : {}),
  ...('compare' in over ? { compare: over.compare ? `${over.compare.kind}:${over.compare.id}` : null } : {}),
  ...('focus' in over ? { focus: over.focus ?? null } : {}),
});

/** An address with those parameters set and the emptied ones gone. */
export const withParams = (params: URLSearchParams, over: Record<string, string | null>): URLSearchParams => {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(over)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return next;
};

/** A window as the page knows it before any answer: its two ends, and whether it ends now and follows it. */
export interface Window extends Span {
  live: boolean;
}

/** The day around a moment: what a link that names one opens on where the chip's own window does not hold it. */
const around = (at: number, now: number): Span => {
  const to = Math.min(now, at + DAY_MS / 2);
  return { from: to - DAY_MS, to };
};

/**
 * The window a view names, or null for a stretch of a grow, which only the
 * server's answer knows the ends of. `now` is the page's clock.
 */
export const windowOf = (view: View, now: number): Window | null => {
  // A window named past now - today, to its midnight - ends now and follows it until its own end has come.
  if (view.fixed && view.fixed.from < now)
    return view.fixed.to > now ? { from: view.fixed.from, to: now, live: true } : { ...view.fixed, live: false };
  if (view.last) return { from: now - view.last, to: now, live: true };

  const width = ROLLING[view.range];
  if (width === undefined) return null;
  // A moment further back than the chip reaches is shown with its own day around it.
  if (view.at !== null && view.at < now - width) return { ...around(view.at, now), live: false };
  return { from: now - width, to: now, live: true };
};

/** What the server is asked for a view. A stretch of a grow the address names no grow for is read as the last day instead. */
export const askOf = (view: View, window: Window | null, share: string | null = null): TimelineAsk => {
  // A named window is asked as it was named, its end in the future included: the server ends it now, and the
  // answer is kept under one key while the clock moves through it.
  const named = view.fixed && window && window.from === view.fixed.from ? view.fixed : window && (!window.live || view.last !== null) ? window : null;

  return {
    range: shownRange(view),
    growId: view.growId,
    ...(named ? { from: instant(named.from), to: instant(named.to) } : {}),
    stepSeconds: view.stepSeconds,
    deviceId: view.deviceId,
    share,
    // A stretch of a grow ends where it ends; asking again would redraw the same picture.
    follows: window !== null && window.live,
  };
};

/** Whether a range is a width ending now rather than a stretch of a grow. */
export const isRolling = (range: TimelineRange): boolean => ROLLING[range] !== undefined;

/** The range a view comes to: a stretch of a grow the address names no grow for is the last day. */
const shownRange = (view: View): TimelineRange => (isRolling(view.range) || view.growId ? view.range : '24h');

/** The chip a window is one of: its own while nothing moved it, and the rolling one of the same width where it was stepped. */
export const chipOf = (view: View, window: Window | null): TimelineRange | null => {
  if (view.fixed === null && view.last === null && (window === null || window.live)) return shownRange(view);
  if (window === null) return null;
  return (Object.keys(ROLLING) as TimelineRange[]).find(range => Math.abs((ROLLING[range] as number) - (window.to - window.from)) < 1000) ?? null;
};

/** A window as the view holds it: one that reaches now follows it, as a chip where its width is a chip's. */
const held = (span: Span, now: number, at: number | null): Partial<View> => {
  const width = span.to - span.from;
  if (span.to < now - 1000) return { fixed: span, last: null, at };

  const chip = (Object.keys(ROLLING) as TimelineRange[]).find(range => Math.abs((ROLLING[range] as number) - width) < 1000);
  return { fixed: null, last: chip ? null : width, ...(chip ? { range: chip } : {}), at };
};

/** One step of the arrows: the window moved back or on by its own width, and never past now. */
export const stepped = (window: Span, direction: -1 | 1, now: number): Partial<View> => {
  const width = window.to - window.from;
  const to = Math.min(now, window.to + direction * width);
  return held({ from: to - width, to }, now, null);
};

/** The next width of the ladder, narrower (`1`) or wider (`-1`); null at either end of it. */
export const nextWidth = (width: number, direction: -1 | 1): number | null =>
  (direction === 1 ? [...WIDTHS].reverse().find(one => one < width * 0.99) : WIDTHS.find(one => one > width * 1.01)) ?? null;

/** The same width ending now: the way back from wherever the arrows and the zoom led. */
export const toNow = (window: Span, now: number): Partial<View> => held({ from: now - (window.to - window.from), to: now }, now, null);

/**
 * Zoomed in or out by one width of the ladder. The cursor keeps its instant
 * and its place on the screen; without one a window that follows now keeps
 * following it, and one that stands still keeps its middle.
 */
export const zoomed = (
  window: Window,
  cursor: number | null,
  direction: -1 | 1,
  now: number,
  around: number | null = cursor,
): Partial<View> | null => {
  const width = nextWidth(window.to - window.from, direction);
  if (width === null) return null;

  // What the zoom holds still: the cursor, or the spot a wheel was turned over.
  const anchor = around ?? (window.from + window.to) / 2;
  const share = (anchor - window.from) / (window.to - window.from);
  const to = Math.min(now, anchor - share * width + width);
  return around === null && window.live ? held({ from: now - width, to: now }, now, null) : held({ from: to - width, to }, now, cursor);
};

/** A stretch marked on the plot or pinched to, as fractions of the window, made the window: no narrower than the ladder and never past now. */
export const selected = (window: Span, fractions: Span, cursor: number | null, now: number): Partial<View> => {
  const span = window.to - window.from;
  const middle = window.from + ((fractions.from + fractions.to) / 2) * span;
  const width = Math.min(WIDEST, Math.max(NARROWEST, (fractions.to - fractions.from) * span));
  const to = Math.min(now, middle + width / 2);
  const next = { from: to - width, to };
  return held(next, now, cursor !== null && cursor >= next.from && cursor <= next.to ? cursor : null);
};

/** The calendar day an instant falls on, where the reader's clock is. Today's ends in the future, and is shown up to now (`windowOf`). */
export const dayHolding = (at: number, zone: string | null): Span => {
  const start = zonedAt(at, zone).startOf('day');
  return { from: start.toMillis(), to: start.plus({ days: 1 }).toMillis() };
};

/** The same day as a link names it: two instants. */
export const dayWindow = (at: number, zone: string | null): { from: string; to: string } => {
  const day = dayHolding(at, zone);
  return { from: instant(day.from), to: instant(day.to) };
};

/** What a saved view keeps of the one on screen: the question - which curves, over what stretch, how - and never its readings. */
export const definitionOf = (
  view: View,
  drawn: { metrics: Metric[]; measurements: string[]; outputs: OutputMetric[]; deviceIds: string[]; growId: string | null },
): ChartViewDefinition => ({
  deviceIds: drawn.deviceIds,
  growId: drawn.growId,
  metrics: drawn.metrics,
  outputs: drawn.outputs,
  measurements: drawn.measurements,
  span: view.fixed
    ? { kind: 'fixed', range: { startsAt: instant(view.fixed.from), endsAt: instant(view.fixed.to) } }
    : view.range === 'phase' || view.range === 'grow'
      ? { kind: view.range }
      : { kind: 'last', forSeconds: Math.round((view.last ?? (ROLLING[view.range] as number)) / 1000) },
  layout: view.one ? 'overlay' : 'stacked',
  intervalSeconds: view.stepSeconds ?? 0,
});

/** A saved view, as the change of the address that opens it. A stretch of a grow is opened where the place has one, else as the last day. */
export const appliedOf = ({ definition }: ChartView, growId: string | null): Partial<View> => {
  const { span } = definition;
  const from = span.kind === 'fixed' ? momentOf(span.range.startsAt) : null;
  const to = span.kind === 'fixed' ? momentOf(span.range.endsAt) : null;
  const last = span.kind === 'last' ? span.forSeconds * 1000 : null;
  const chip = (Object.keys(ROLLING) as TimelineRange[]).find(range => ROLLING[range] === last);
  const stretch = (span.kind === 'phase' || span.kind === 'grow') && growId !== null ? span.kind : null;

  return {
    range: stretch ?? chip ?? '24h',
    growId: stretch ? growId : null,
    fixed: from !== null && to !== null && from < to ? { from, to } : null,
    last: last !== null && !chip ? Math.min(WIDEST, Math.max(NARROWEST, last)) : null,
    at: null,
    show: [
      ...definition.metrics,
      ...definition.measurements.map(key => `m.${key}`),
      ...(definition.outputs.includes('light') ? ['light'] : []),
      ...(definition.outputs.some(output => output !== 'light') ? ['outputs'] : []),
      'diary',
      'machine',
    ],
    one: definition.layout === 'overlay',
    stepSeconds: definition.intervalSeconds >= 5 ? definition.intervalSeconds : null,
  };
};
