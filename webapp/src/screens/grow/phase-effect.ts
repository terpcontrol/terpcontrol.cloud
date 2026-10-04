import { DateTime } from 'luxon';
import type { GrowListItem, GrowthStage, Phase } from '@fg2/shared-types/v1';

/**
 * What correcting or withdrawing a phase would do, said before it is done.
 *
 * The day counter is the server's. It rides on every answer that carries a grow
 * and nothing here recounts it; what is worked out here is the *difference* -
 * moving a phase's start three days later takes three days off whatever the
 * server last said. That is arithmetic on two dates and needs no clock, which
 * is why a sheet can promise it. The moment the change lands the server answers
 * again and every figure on the screen is its own once more.
 *
 * A grow whose plants are not all in the same phase is the one case nothing is
 * promised about the stage: the headline is then the largest group's, which is
 * a fact about the plants rather than about the dates, and guessing at it would
 * be the sheet inventing a second day counter.
 */

const DAY_MS = 86_400_000;

/** Whole days from one instant to another, counted as the serialiser counts them: elapsed, not calendar. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((DateTime.fromISO(to).toMillis() - DateTime.fromISO(from).toMillis()) / DAY_MS);

const byDate = (one: Phase, other: Phase): number => one.startedAt.localeCompare(other.startedAt);

/** The phases as the contract states them, oldest first, whatever order they arrived in. */
export const phasesInOrder = (grow: GrowListItem): Phase[] => [...grow.phases].sort(byDate);

/** A counter before and after, so a sentence can name both. */
export interface Shift {
  from: number;
  to: number;
}

export interface PhaseEffect {
  /** The grow's day counter, where the change moves what it counts from. */
  growDay: Shift | null;
  /** The day of the phase the grow stands in, where the change moves its start. */
  phaseDay: Shift | null;
  /** What the grow reads as afterwards, where the change moves the headline. */
  stage: { from: GrowthStage; to: GrowthStage } | null;
  /** The grow is left with no phase, so it has no stage and no day counter until one is entered. */
  noPhaseLeft: boolean;
  /** Nothing above moves: a phase in the middle of the story changes the order it is told in and nothing else. */
  timelineOnly: boolean;
}

const ms = (instant: string): number => DateTime.fromISO(instant).toMillis();

/** Where the grow's days count from: its start or its earliest phase, whichever came first - the server's `growOriginOf`. */
const originOf = (startedAt: string, phases: Phase[]): string =>
  phases[0] && ms(phases[0].startedAt) < ms(startedAt) ? phases[0].startedAt : startedAt;

/**
 * The grow's start after the change. The server carries a start that stood on
 * the first phase along with it, and leaves one that came before every phase
 * where it is - so the sheet promises the same.
 */
const startAfter = (grow: GrowListItem, before: Phase[], after: Phase[]): string =>
  before[0] && after[0] && ms(before[0].startedAt) === ms(grow.startedAt) ? after[0].startedAt : grow.startedAt;

/** The phase a grow reads as: the latest one. Only asked where every phase covers every plant. */
const headlineOf = (phases: Phase[]): Phase | null => phases.at(-1) ?? null;

const effectOf = (grow: GrowListItem, before: Phase[], after: Phase[]): PhaseEffect => {
  // A split has put the plants into phases of their own, and which of them is
  // the headline follows from how many plants are in each.
  const split = grow.summary.groups.length > 0;
  const headBefore = split ? null : headlineOf(before);
  const headAfter = split ? null : headlineOf(after);

  const growShift = after[0] ? daysBetween(originOf(grow.startedAt, before), originOf(startAfter(grow, before, after), after)) : 0;
  const ownShift = headBefore && headAfter && headBefore.id === headAfter.id ? daysBetween(headBefore.startedAt, headAfter.startedAt) : 0;
  const moved = !split && (headBefore?.stage !== headAfter?.stage || headBefore?.preset !== headAfter?.preset);

  const growDay =
    grow.summary.dayNumber !== null && after.length > 0 && growShift !== 0
      ? { from: grow.summary.dayNumber, to: Math.max(1, grow.summary.dayNumber - growShift) }
      : null;
  const phaseDay =
    grow.summary.phaseDay !== null && ownShift !== 0 ? { from: grow.summary.phaseDay, to: Math.max(1, grow.summary.phaseDay - ownShift) } : null;
  // Only where there is a phase on both sides of the change: a grow left with
  // none reads as nothing, which `noPhaseLeft` says on its own.
  const stage = moved && headBefore && headAfter ? { from: headBefore.stage, to: headAfter.stage } : null;

  return {
    growDay,
    phaseDay,
    stage,
    noPhaseLeft: after.length === 0,
    timelineOnly: after.length > 0 && growDay === null && phaseDay === null && stage === null,
  };
};

/** A phase given a different stage, a different preset or a different day. */
export const correctionEffect = (
  grow: GrowListItem,
  phase: Phase,
  draft: { stage: GrowthStage; preset: string | null; startedAt: string },
): PhaseEffect => {
  const before = phasesInOrder(grow);
  const after = before.map(one => (one.id === phase.id ? { ...one, ...draft } : one)).sort(byDate);

  return effectOf(grow, before, after);
};

/** A phase the grow never entered, taken back out of the story. */
export const withdrawalEffect = (grow: GrowListItem, phase: Phase): PhaseEffect => {
  const before = phasesInOrder(grow);

  return effectOf(
    grow,
    before,
    before.filter(one => one.id !== phase.id),
  );
};
