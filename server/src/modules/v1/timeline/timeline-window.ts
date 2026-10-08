import type { TimelineRange } from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf, spineOf } from '@fg2/shared-types/v1-schemas';
import { Grant } from '@common/v1/access.types';
import { clampRange } from '@common/v1/range';
import { stepFor as storeStepFor } from '@modules/data/flux';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { SETTLE_SECONDS, cycleOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { horizonOf } from '../diary/grow-calendar';
import { targetsOf } from '../phase/phase-targets';
import { TargetStretch } from './timeline-series';

/**
 * What a range chip means in instants.
 *
 * `24 h`, `7 d` and `30 d` are windows ending where the request points; `Phase` and
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

/**
 * The ranges that are a width back from an instant rather than a stretch of a
 * grow. A month is what a place with nothing growing in it has instead of a
 * phase: read at the same 480 windows, it comes to an hour and a half a point,
 * sixteen to a day, which still draws every night of the month apart.
 */
const ROLLING_MS = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS, '30d': 30 * 24 * HOUR_MS } as const;

export interface TimelineWindow {
  startsAt: Date;
  endsAt: Date;
  stepSeconds: number;
  /** The grow's own day counter at each end, which is the "day 33–34" beside the range chips. */
  dayFrom: number | null;
  dayTo: number | null;
}

/**
 * The window a range names, narrowed to what the caller was granted. A share
 * link asking for the whole grow is answered its own week of it, and a window
 * the clamp leaves nothing of is answered as nothing rather than as a refusal.
 *
 * The instant a rolling range counts back from is narrowed first. `24 h` through
 * a link that closed last week is the last day of that week and not the last day
 * of this one, which would be a window the clamp leaves nothing of at all.
 */
export const windowOf = (range: TimelineRange, grant: Grant, grow: GrowDocument | null, asOf: Date, askedStep?: number): TimelineWindow => {
  const granted = grant.range.endsAt;
  const at = granted && granted < asOf ? granted : asOf;

  return narrowedTo(grow && (range === 'phase' || range === 'grow') ? stretchOf(range, grow, at) : rollingOf(range, at), grant, grow, at, askedStep);
};

/**
 * The same narrowing, for a window somebody named outright rather than by a
 * chip. The two instants of a custom range are as much subject to the clamp as
 * a chip's are, and the day counter is counted across them the same way.
 */
export const narrowedTo = (
  asked: { startsAt: Date; endsAt: Date },
  grant: Grant,
  grow: GrowDocument | null,
  asOf: Date,
  askedStep?: number,
): TimelineWindow => {
  const clamped = clampRange(grant, asked);
  const startsAt = clamped.startsAt ?? asked.startsAt;
  const endsAt = new Date(Math.max(startsAt.getTime(), (clamped.endsAt ?? asked.endsAt).getTime()));

  return { startsAt, endsAt, stepSeconds: stepFor(startsAt, endsAt, askedStep), ...daysOf(grow, asOf, startsAt, endsAt) };
};

/**
 * The grow's own day counter at each end of the window, which is the "day
 * 33-34" the chips are drawn beside.
 *
 * It counts inside the grow's own calendar at both ends. `growDayAt` floors at
 * 1, so a window reaching back before the grow began has always read as day 1;
 * nothing floored the other end, and a window four months after a grow that
 * lasted 218 days was answered "day 347-352" - a figure no other screen of that
 * grow will ever print. Where the window and the grow's calendar do not meet at
 * all there is no day to name, and both ends are nothing rather than the first
 * or the last.
 */
const daysOf = (grow: GrowDocument | null, asOf: Date, startsAt: Date, endsAt: Date): Pick<TimelineWindow, 'dayFrom' | 'dayTo'> => {
  if (!grow) return { dayFrom: null, dayTo: null };

  const origin = growOriginOf(grow);
  const horizon = horizonOf(grow, asOf);
  if (endsAt <= origin || startsAt > horizon) return { dayFrom: null, dayTo: null };

  const last = growDayAt(origin, horizon);
  // The last instant inside the window rather than the first outside it: a
  // window ending where day 35 begins is still day 34.
  const inside = new Date(Math.max(startsAt.getTime(), endsAt.getTime() - 1));

  return { dayFrom: Math.min(growDayAt(origin, startsAt), last), dayTo: Math.min(growDayAt(origin, inside), last) };
};

const rollingOf = (range: TimelineRange, at: Date): { startsAt: Date; endsAt: Date } => ({
  startsAt: new Date(at.getTime() - (range === '7d' || range === '30d' ? ROLLING_MS[range] : ROLLING_MS['24h'])),
  endsAt: at,
});

/**
 * Nothing later than the instant asked about, and nothing after the grow ended.
 * The phase is the spine phase standing at that instant - a phase scoped to some
 * of the plants is a split, told in the event rail rather than by giving the
 * tent a second timeline - so it runs up to the instant itself.
 */
const stretchOf = (range: 'phase' | 'grow', grow: GrowDocument, at: Date): { startsAt: Date; endsAt: Date } => {
  const horizon = new Date(Math.min(horizonOf(grow, at).getTime(), at.getTime()));
  const phase = range === 'phase' ? spineOf(grow.phases, horizon).at(-1) : undefined;

  return { startsAt: phase?.startedAt ?? growOriginOf(grow), endsAt: horizon };
};

const stepFor = (startsAt: Date, endsAt: Date, asked?: number): number => {
  // A step somebody chose - the charts page offers five seconds to a week - is
  // held to the store's own rule for one.
  if (asked && asked > 0) return storeStepFor(startsAt, endsAt, asked);

  const seconds = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 1000));
  return Math.max(MIN_STEP_SECONDS, Math.ceil(seconds / PANEL_WINDOWS));
};

/**
 * The device a place's band is the targets of: the first standing there whose
 * configuration states any, which is the one the cockpit judges the place's
 * readings against.
 */
export const steeringOf = (devices: readonly StoredDevice[]): StoredDevice | null =>
  devices.find(device => targetsOf(device.configuration) !== null) ?? null;

/**
 * The stretches the bands are drawn over: the grow's own phases, clipped to the
 * window, and cut again wherever the steering device's record says its targets
 * moved.
 *
 * The record is what the device really aimed at, so wherever it reaches it is
 * what a band is drawn from - over a phase's snapshot as well. A snapshot is
 * what ran when the phase was written; somebody who puts the tent on another
 * preset, or nudges the humidity, a week into the phase has the cockpit judge
 * the tent against the new figures from that moment, and a Timeline still
 * banding the rest of the phase by the old ones said the opposite of the
 * cockpit about the same reading.
 *
 * Where the record does not reach - a window older than the record itself - the
 * phase's snapshot is the best there is. A phase that has none borrows what is
 * known for the one stretch where now and then are the same thing - a grow
 * still running, drawn as far as the instant the read is about - and is drawn
 * against nothing anywhere else. A fridge set for a flowering run in September
 * is not what a January seedling week was aimed at, which is the same reason
 * the report refuses to grade a chapter it has no snapshot for.
 *
 * A tent with no grow in it is the other way round: there is no past to mistake
 * the configuration for, and the live view would otherwise lose its band
 * altogether. What is borrowed is the nearest thing known about the stretch:
 * the first row of the record where there is one, which is closer to that
 * stretch than the configuration of today.
 */
export const stretchesOf = (
  grow: GrowDocument | null,
  devices: StoredDevice[],
  window: TimelineWindow,
  asOf: Date,
  record: readonly StoredTargetChange[] = [],
): TargetStretch[] => {
  const steering = steeringOf(devices);
  const moves = record.filter(row => row.deviceId === steering?.id).sort((one, other) => one.at.getTime() - other.at.getTime());
  const borrowed = moves.length > 0 ? moves[0].targets : steering ? targetsOf(steering.configuration) : null;
  const borrowedCycle = moves.length > 0 ? (moves[0].cycle ?? null) : steering ? cycleOf(steering.type, steering.configuration) : null;
  const spine = grow ? spineOf(grow.phases, window.endsAt) : [];
  const running = grow !== null && grow.endedAt === null;
  const phases = spine.flatMap((phase, index) => {
    const startsAt = new Date(Math.max(phase.startedAt.getTime(), window.startsAt.getTime()));
    const endsAt = new Date(Math.min(spine[index + 1]?.startedAt.getTime() ?? window.endsAt.getTime(), window.endsAt.getTime()));
    if (endsAt <= startsAt) return [];

    const steered = running && endsAt >= asOf;
    const targets = phase.targets ?? (steered ? borrowed : null);
    return [{ startsAt, endsAt, phaseId: phase.id, stage: phase.stage, targets, cycle: phase.targets || !steered ? null : borrowedCycle }];
  });
  const stretches =
    phases.length > 0
      ? phases
      : [{ startsAt: window.startsAt, endsAt: window.endsAt, phaseId: null, stage: null, targets: borrowed, cycle: borrowedCycle }];

  return joined(stretches.flatMap(stretch => recorded(stretch, moves)));
};

/**
 * Whether a row is somebody changing something, and so starts an hour the
 * climate is given to follow: not a row that only added the cycle to a record
 * written before cycles were.
 */
const settles = (before: StoredTargetChange, row: StoredTargetChange): boolean =>
  !((before.cycle ?? null) === null && JSON.stringify(before.targets) === JSON.stringify(row.targets));

/**
 * A stretch cut where the record says the targets or the cycle moved, each
 * piece drawn against the row standing at its start - and cut again where the
 * hour after a change ends, the piece before it carrying what stood before the
 * change (`settling`).
 */
const recorded = (stretch: TargetStretch, moves: readonly StoredTargetChange[]): TargetStretch[] => {
  const settleEnds = moves.flatMap((row, index) =>
    index > 0 && settles(moves[index - 1], row) ? [new Date(row.at.getTime() + SETTLE_SECONDS * 1000)] : [],
  );
  const inside = [...moves.map(row => row.at), ...settleEnds].filter(at => at > stretch.startsAt && at < stretch.endsAt);
  const edges = [...new Set([stretch.startsAt, ...inside, stretch.endsAt].map(at => at.getTime()))]
    .sort((one, other) => one - other)
    .map(at => new Date(at));

  return edges.slice(0, -1).map((startsAt, index) => {
    const at = moves.reduce((found, row, index) => (row.at <= startsAt ? index : found), -1);
    const standing = at >= 0 ? moves[at] : undefined;
    const before = at > 0 ? moves[at - 1] : undefined;
    const settling = standing && before && settles(before, standing) && startsAt.getTime() < standing.at.getTime() + SETTLE_SECONDS * 1000;
    return {
      ...stretch,
      startsAt,
      endsAt: edges[index + 1],
      targets: standing ? standing.targets : stretch.targets,
      cycle: standing ? (standing.cycle ?? null) : (stretch.cycle ?? null),
      settling: settling ? { at: standing.at.getTime(), targets: before.targets ?? null, cycle: before.cycle ?? null } : null,
    };
  });
};

/** Neighbours of one phase aimed at the same figures by the same cycle are one stretch, so a row that confirmed a snapshot draws no seam. */
const joined = (stretches: readonly TargetStretch[]): TargetStretch[] =>
  stretches.reduce<TargetStretch[]>((kept, stretch) => {
    const last = kept.at(-1);
    const same = (key: 'targets' | 'cycle' | 'settling') => JSON.stringify(last?.[key] ?? null) === JSON.stringify(stretch[key] ?? null);
    if (last && last.phaseId === stretch.phaseId && same('targets') && same('cycle') && same('settling')) {
      return [...kept.slice(0, -1), { ...last, endsAt: stretch.endsAt }];
    }
    return [...kept, stretch];
  }, []);
