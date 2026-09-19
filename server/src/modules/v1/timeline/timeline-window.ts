import type { TimelineRange } from '@fg2/shared-types/v1';
import { Grant } from '@common/v1/access.types';
import { clampRange } from '@common/v1/range';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { dayNumberOf, horizonOf, originOf } from '../diary/grow-calendar';

/**
 * What a range chip means in instants.
 *
 * `24 h` and `7 d` are windows ending where the request points; `Phase` and
 * `Grow` are stretches of one grow, which is why the route insists on being told
 * which grow before it will answer either.
 *
 * The step follows from the width of the window rather than from the rate the
 * device reported at, so every range is read with the same number of windows and
 * a grow costs what a day costs. That is also what makes a long range coarse in
 * one respect that matters: at hours to the window a light output is the mean of
 * a dozen switchings, so the night shading of a whole grow says which part of a
 * day was mostly dark and nothing finer.
 */

/** How many windows a panel is drawn with, whatever the range. More than a phone has pixels, few enough to be one read. */
const PANEL_WINDOWS = 480;

/** No device reports faster than this, so a narrower window would only interpolate. */
const MIN_STEP_SECONDS = 60;

const HOUR_MS = 60 * 60 * 1000;

/** The two ranges that are a width back from an instant rather than a stretch of a grow. */
const ROLLING_MS = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS } as const;

export interface TimelineWindow {
  startsAt: Date;
  endsAt: Date;
  stepSeconds: number;
  /** The grow's own day counter at each end, which is the "day 33–34" beside the range chips. */
  dayFrom: number | null;
  dayTo: number | null;
}

/**
 * The spine phase an instant falls in: the last phase of the whole grow that had
 * begun by then. A phase scoped to some of the plants is a split and is told in
 * the event rail rather than by giving the tent a second timeline.
 */
export const phaseAt = (grow: GrowDocument, at: Date): GrowDocument['phases'][number] | null =>
  spineOf(grow)
    .filter(phase => phase.startedAt <= at)
    .at(-1) ?? null;

export const spineOf = (grow: GrowDocument): GrowDocument['phases'] =>
  grow.phases.filter(phase => phase.plantIds === null).sort((one, other) => one.startedAt.getTime() - other.startedAt.getTime());

/**
 * The window a range names, narrowed to what the caller was granted. A share
 * link asking for the whole grow is answered its own week of it, and a window
 * the clamp leaves nothing of is answered as nothing rather than as a refusal.
 *
 * The instant a rolling range counts back from is narrowed first. `24 h` through
 * a link that closed last week is the last day of that week and not the last day
 * of this one, which would be a window the clamp leaves nothing of at all.
 */
export const windowOf = (range: TimelineRange, grant: Grant, grow: GrowDocument | null, asOf: Date): TimelineWindow => {
  const granted = grant.range.endsAt;
  const at = granted && granted < asOf ? granted : asOf;
  const asked = grow && (range === 'phase' || range === 'grow') ? stretchOf(range, grow, at) : rollingOf(range, at);
  const clamped = clampRange(grant, asked);
  const startsAt = clamped.startsAt ?? asked.startsAt;
  const endsAt = new Date(Math.max(startsAt.getTime(), (clamped.endsAt ?? asked.endsAt).getTime()));
  const origin = grow ? originOf(grow) : null;

  return {
    startsAt,
    endsAt,
    stepSeconds: stepFor(startsAt, endsAt),
    dayFrom: origin ? dayNumberOf(origin, startsAt) : null,
    // The last instant inside the window rather than the first outside it: a
    // window ending where day 35 begins is still day 34.
    dayTo: origin ? dayNumberOf(origin, new Date(Math.max(startsAt.getTime(), endsAt.getTime() - 1))) : null,
  };
};

const rollingOf = (range: TimelineRange, at: Date): { startsAt: Date; endsAt: Date } => ({
  startsAt: new Date(at.getTime() - (range === '7d' ? ROLLING_MS['7d'] : ROLLING_MS['24h'])),
  endsAt: at,
});

/** Nothing later than the instant asked about, and nothing after the grow ended. */
const stretchOf = (range: 'phase' | 'grow', grow: GrowDocument, at: Date): { startsAt: Date; endsAt: Date } => {
  const horizon = new Date(Math.min(horizonOf(grow, at).getTime(), at.getTime()));
  const phase = range === 'phase' ? phaseAt(grow, horizon) : null;
  if (!phase) return { startsAt: originOf(grow), endsAt: horizon };

  const ends = spineOf(grow).find(one => one.startedAt > phase.startedAt)?.startedAt ?? null;
  return { startsAt: phase.startedAt, endsAt: ends && ends < horizon ? ends : horizon };
};

const stepFor = (startsAt: Date, endsAt: Date): number => {
  const seconds = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 1000));

  return Math.max(MIN_STEP_SECONDS, Math.ceil(seconds / PANEL_WINDOWS));
};
