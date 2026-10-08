import type { ChartViewSpan } from '@fg2/shared-types/v1';
import { instantOf } from '@/ui/age';
import { DAY_MS, endOfDayOn, HOUR_MS, MINUTE_MS, startOfDayOn } from '@/ui/days';
import { zoned, zonedAt } from '@/ui/zone';

/**
 * Which stretch of time the Charts view draws, as the chips and the arrows
 * name it, and the window that comes to.
 *
 * Four kinds of stretch. A rolling width - the last hour, the last year -
 * which ends now, or at an instant somebody stepped back to with the arrows or
 * picked; the stretch of a grow, its phase or the whole of it, which the
 * grow's own calendar names; two days somebody typed; and a zoom, two instants
 * somebody narrowed the window to on the chart itself, which stands in for
 * whichever of the others it was taken from until it is reset.
 */

/** Every rolling width there is, narrowest first: twenty minutes to three years, which is what the old charts offered. */
export const WIDTHS = {
  '20m': 20 * MINUTE_MS,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '12h': 12 * HOUR_MS,
  '24h': DAY_MS,
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '14d': 14 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
  '180d': 180 * DAY_MS,
  '1y': 365 * DAY_MS,
  '3y': 3 * 365 * DAY_MS,
} as const;

export type Width = keyof typeof WIDTHS;

/** The widths a chip stands for from the start; the rest are one tap further, behind "+ more". */
export const EVERYDAY: Width[] = ['1h', '24h', '7d', '30d'];

export const RARE: Width[] = (Object.keys(WIDTHS) as Width[]).filter(width => !EVERYDAY.includes(width));

export type ChartRange = Width | 'phase' | 'grow' | 'custom';

export const isWidth = (range: string | null): range is Width => range !== null && range in WIDTHS;

/** A stretch a grow's own calendar names; only these can be counted in its days. */
export const isStretch = (range: ChartRange): range is 'phase' | 'grow' => range === 'phase' || range === 'grow';

export const rangeFrom = (asked: string | null, hasGrow: boolean): ChartRange =>
  isWidth(asked) || asked === 'custom' || (hasGrow && (asked === 'phase' || asked === 'grow')) ? asked : '24h';

/** A zoom: two instants on the chart itself. */
export interface Zoom {
  from: number;
  to: number;
}

/**
 * The window a stretch comes to: a grow's own range, which the grow's answer
 * works out, or two instants, which either answer takes. Null where the
 * question is not finished - a custom range with an end still to pick.
 */
export type ChartWindow = { kind: 'grow'; range: 'phase' | 'grow' } | { kind: 'span'; from: number; to: number };

interface SpanInput {
  range: ChartRange;
  /** The two days of a custom range, as the date fields speak them. */
  from: string;
  to: string;
  /** Where a rolling width ends when somebody stepped back from now; null is now. */
  at: number | null;
  zoom: Zoom | null;
  /** Now, as the screen last settled it: a live chart moves it on, nothing else does. */
  now: number;
  /** A grow that has ended is charted up to its end, not up to a now it is no longer part of. */
  endedAt: number | null;
  zone: string | null;
}

/** Where a rolling width ends when nobody stepped back: now, or where the grow being charted ended. */
export const liveEnd = (now: number, endedAt: number | null): number => (endedAt !== null && endedAt < now ? endedAt : now);

export const windowOf = (input: SpanInput): ChartWindow | null => {
  if (input.zoom) return { kind: 'span', ...input.zoom };
  if (isStretch(input.range)) return { kind: 'grow', range: input.range };
  if (input.range === 'custom') {
    const days = dayBounds(input.from, input.to, input.zone);
    return days ? { kind: 'span', from: days.from, to: days.to } : null;
  }

  const to = input.at ?? liveEnd(input.now, input.endedAt);
  return { kind: 'span', from: to - WIDTHS[input.range], to };
};

/**
 * The two date fields are days and the window takes instants, so a custom range
 * runs from the first moment of one day to the last of the other, in the zone
 * the account names: a day chosen at either end is a day a grower means whole,
 * and whole where their tent stands rather than where they happen to be
 * reading. Null where either end is missing or cannot be read.
 */
export const dayBounds = (from: string, to: string, zone: string | null): { from: number; to: number } | null => {
  if (!from || !to) return null;
  const start = startOfDayOn(from, zone).getTime();
  const end = endOfDayOn(to, zone).getTime();

  return Number.isNaN(start) || Number.isNaN(end) ? null : { from: start, to: end };
};

/** An instant as the contract spells one: UTC to the millisecond, so two of them sort in the order they run. */
export const instant = (time: number): string => instantOf(zonedAt(time, 'UTC'));

/**
 * One step of the arrows: the window moved back or on by its own width. A step
 * on that would reach past now is the live window again rather than a window
 * ending in the future.
 */
export const stepped = (range: Width, at: number | null, end: number, direction: -1 | 1): number | null => {
  const next = (at ?? end) + direction * WIDTHS[range];
  return next >= end ? null : next;
};

/**
 * Narrower around the cursor: a third of the window, kept inside it. What a
 * plus does on a phone, where a thumb dragging across the chart is already the
 * cursor.
 */
export const zoomedIn = (from: number, to: number, cursor: number): Zoom => {
  const width = (to - from) / 3;
  const start = Math.min(Math.max(from, cursor - width / 2), to - width);

  return { from: start, to: start + width };
};

/** A zoom narrower than this is drawn at a finer step than any device reports at; it goes no further. */
export const NARROWEST_ZOOM = 10 * MINUTE_MS;

/** What a saved view keeps instead of the chip: a rolling width, two instants, or a stretch read off the grow. */
export const spanOf = (range: ChartRange, from: string, to: string, zone: string | null): ChartViewSpan => {
  if (isStretch(range)) return { kind: range };
  if (range === 'custom') {
    const days = dayBounds(from, to, zone);
    return { kind: 'fixed', range: { startsAt: days ? instant(days.from) : null, endsAt: days ? instant(days.to) : null } };
  }

  return { kind: 'last', forSeconds: WIDTHS[range] / 1000 };
};

/**
 * The chip a saved span comes back as. A width the chips cannot name is read as
 * the nearest one that can, and the two instants of a fixed one are read back
 * into date fields where the account is, because they were cut there.
 */
export const rangeOfSpan = (span: ChartViewSpan, zone: string | null): { range: ChartRange; from?: string; to?: string } => {
  if (span.kind === 'phase' || span.kind === 'grow') return { range: span.kind };
  if (span.kind === 'last') {
    const ms = span.forSeconds * 1000;
    const nearest = (Object.keys(WIDTHS) as Width[]).reduce((best, one) => (Math.abs(WIDTHS[one] - ms) < Math.abs(WIDTHS[best] - ms) ? one : best));
    return { range: nearest };
  }

  const day = (iso: string | null) => (iso ? (zoned(iso, zone).toISODate() ?? undefined) : undefined);
  return { range: 'custom', from: day(span.range.startsAt), to: day(span.range.endsAt) };
};
