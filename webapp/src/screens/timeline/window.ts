import { DateTime } from 'luxon';
import type { Metric, SpaceTimeline, TimelineAlarm, TimelinePanel, TimelineSpan, TimelineTarget, TimelineTargets } from '@fg2/shared-types/v1';
import { MINUTE_MS } from '@/ui/days';

/**
 * The arithmetic Verlauf's panels share: where an instant sits in the window,
 * which band applied there, and which picture belongs to it.
 */

export const at = (iso: string): number => new Date(iso).getTime();

/** The instant an address names, or null where it names none or something that is not one. */
export const momentOf = (value: string | null): number | null => {
  if (!value) return null;
  const moment = DateTime.fromISO(value);
  return moment.isValid ? moment.toMillis() : null;
};

/** Where an instant sits across the window, 0 at its left edge and 1 at its right. */
export const fractionOf = (time: number, from: number, to: number): number =>
  to <= from ? 0 : Math.min(1, Math.max(0, (time - from) / (to - from)));

export const spans = (list: TimelineSpan[], time: number): boolean => list.some(span => at(span.startsAt) <= time && time <= at(span.endsAt));

/**
 * One stretch of the window over which the same target held: a phase's targets
 * cut by the night. Day and night are aimed at differently, so a window drawn
 * against one of them would show half of it as a long fall out of band.
 */
interface Stretch {
  from: number;
  to: number;
  target: TimelineTarget;
  /** In a night, whose target it is. */
  dark: boolean;
  /**
   * In the hour after a switch between day and night (and a fridge's ramp
   * before it), or after somebody changed the targets: the band reaches over
   * both, which is what the reading is judged by then - a fridge cooling into
   * its night is on its way, not out of band.
   */
  changing: boolean;
  /**
   * One climate held round the clock - a drying room, a germination, 24 or 0
   * hours of light - which has no day and night to tell its band by: what it
   * held instead, which names the band. Null for a day and a night.
   */
  held: ConstantHold | null;
}

/** What a stretch holds where nothing alternates (`TimelineTargets.held`). */
type ConstantHold = Exclude<NonNullable<TimelineTargets['held']>, 'schedule'>;

const constantOf = (targets: TimelineTargets): ConstantHold | null =>
  targets.held === undefined || targets.held === 'schedule' ? null : targets.held;

/** Both halves' bands as one, around the setpoint of the half the device is changing to; none where either half has none. */
const changingTarget = (to: TimelineTarget | null, other: TimelineTarget | null): TimelineTarget | null =>
  to && other ? { setpoint: to.setpoint, band: { low: Math.min(to.band.low, other.band.low), high: Math.max(to.band.high, other.band.high) } } : null;

export const stretchesOf = (panel: TimelinePanel, nights: TimelineSpan[], from: number, to: number, transitions: TimelineSpan[] = []): Stretch[] =>
  joinedHeld(piecesOf(panel, nights, from, to, transitions));

/** One climate round the clock is one stretch, however often a night or a switch cut the window under it. */
const joinedHeld = (stretches: Stretch[]): Stretch[] =>
  stretches.reduce<Stretch[]>((kept, stretch) => {
    const last = kept.at(-1);
    const same =
      last !== undefined &&
      last.held !== null &&
      last.held === stretch.held &&
      last.changing === stretch.changing &&
      last.to === stretch.from &&
      JSON.stringify(last.target) === JSON.stringify(stretch.target);
    return same ? [...kept.slice(0, -1), { ...last, to: stretch.to }] : [...kept, stretch];
  }, []);

const piecesOf = (panel: TimelinePanel, nights: TimelineSpan[], from: number, to: number, transitions: TimelineSpan[]): Stretch[] =>
  cut(from, to, nights, panel.targets, transitions).flatMap((piece): Stretch[] => {
    const targets = panel.targets.find(one => at(one.startsAt) <= piece.from && at(one.endsAt) >= piece.to);
    if (!targets) return [];

    // One climate round the clock is one band through the whole stretch, whatever the night does.
    const held = constantOf(targets);
    if (held) {
      const target = held === 'always_day' ? targets.day : targets.night;
      return target ? [{ from: piece.from, to: piece.to, target, dark: false, changing: targets.settling === true, held }] : [];
    }

    // The hour after somebody changed the targets comes with its band already
    // reaching over what held before; a switch between the halves is widened here.
    const own = piece.dark ? targets.night : targets.day;
    const target = piece.changing && !targets.settling ? changingTarget(own, piece.dark ? targets.day : targets.night) : own;
    const changing = piece.changing || targets.settling === true;

    return target ? [{ from: piece.from, to: piece.to, target, dark: piece.dark, changing, held: null }] : [];
  });

/**
 * The window split where the night began and ended, where one phase handed
 * over to the next, and where a change between day and night began and was
 * over. Each edge has to cut it: a band that only moved with the night would
 * carry the old phase's target through the half of the cycle the grow was
 * moved on in.
 */
const cut = (
  from: number,
  to: number,
  nights: TimelineSpan[],
  targets: TimelineTargets[],
  transitions: TimelineSpan[],
): { from: number; to: number; dark: boolean; changing: boolean }[] => {
  const inside = [...nights, ...targets, ...transitions]
    .flatMap(span => [at(span.startsAt), at(span.endsAt)])
    .filter(edge => edge > from && edge < to);
  const edges = [...new Set([from, ...inside, to])].sort((one, other) => one - other);

  return edges.slice(0, -1).map((edge, index) => {
    const middle = (edge + edges[index + 1]) / 2;
    return { from: edge, to: edges[index + 1], dark: spans(nights, middle), changing: spans(transitions, middle) };
  });
};

/** Only what this panel is about: an alarm the health loop raised without a metric belongs on the rail, not over a curve. */
export const alarmsOf = (alarms: TimelineAlarm[], metric: Metric): TimelineAlarm[] => alarms.filter(alarm => alarm.metric === metric);

/** The least a picture may stand from the cursor and still be the picture of that moment. */
const FRAME_REACH_MIN = 10 * MINUTE_MS;

/**
 * The picture of the moment the cursor is on, or null where the camera took
 * none near it - before it was paired, or in a stretch it could not be read.
 * The nearest picture was shown however far away it was: a cursor on yesterday
 * at 09:52, light off, stood under a lit picture from today at 00:46. Near is
 * twice the camera's usual spacing in the window, so a camera that fires once
 * an hour is not called absent between two of its pictures.
 */
export const frameNear = (camera: SpaceTimeline['cameras'][number] | undefined, time: number) => {
  const frame = frameAt(camera?.frames ?? [], time);
  if (!camera || !frame) return null;
  const gaps = camera.frames
    .slice(1)
    .map((one, index) => at(one.capturedAt) - at(camera.frames[index].capturedAt))
    .sort((one, other) => one - other);
  const usual = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0;
  return Math.abs(at(frame.capturedAt) - time) <= Math.max(FRAME_REACH_MIN, 2 * usual) ? frame : null;
};

/** The frame to show at the cursor: the newest picture taken by then, and the oldest there is before the first one was taken. */
const frameAt = <F extends { capturedAt: string }>(frames: readonly F[], time: number): F | null => {
  if (frames.length === 0) return null;
  let found = frames[0];
  for (const frame of frames) {
    if (at(frame.capturedAt) > time) break;
    found = frame;
  }
  return found;
};
