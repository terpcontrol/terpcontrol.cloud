import { DateTime } from 'luxon';
import type { DurationUnit, Plan, PlanStep, PlanState, StepDuration } from '@fg2/shared-types/v1';
import { countdownLabel as wordsLeftFor, spanLabel as wordsFor } from '@/ui/age';

/**
 * Where a plan stands, read the way the server reads it.
 *
 * The plan is the one thing on these screens that moves without anybody asking:
 * the engine walks it every twenty seconds, so between two reads the step the
 * device is on may already be over. What is worked out here is therefore not a
 * second opinion but the same arithmetic the engine does - `pausedElapsedMs`
 * plus the clock since `stepStartedAt`, against the step's own length - so the
 * screen says what the next pass will do rather than what it would like to be
 * true. The instants are all the server's; only the reading of them is ours.
 *
 * Which of the five moves are offered is the same question asked once: the
 * server refuses the rest, and a button that is only there to be refused is a
 * button that has told somebody nothing.
 */

const UNIT_MS: Readonly<Record<DurationUnit, number>> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
};

export const DURATION_UNITS: DurationUnit[] = ['minutes', 'hours', 'days', 'weeks'];

/**
 * A step with no length to measure runs until somebody moves it on by hand, and
 * is never over - which is the server's own reading, and the reason a plan that
 * loops does not walk itself through every step on one tick.
 */
export const durationMs = ({ value, unit }: StepDuration): number => (value > 0 ? value * UNIT_MS[unit] : Number.POSITIVE_INFINITY);

export const isOpenEnded = (duration: StepDuration): boolean => !Number.isFinite(durationMs(duration));

export const activeStep = (plan: Plan): PlanStep | null => plan.steps[plan.state.activeStepIndex] ?? null;

/** What the step has served, across every pause it has been through. */
export const elapsedMs = (state: PlanState, now: DateTime): number =>
  state.pausedElapsedMs + (state.stepStartedAt ? Math.max(0, now.toMillis() - DateTime.fromISO(state.stepStartedAt).toMillis()) : 0);

export const isOver = (plan: Plan, now: DateTime): boolean => {
  const step = activeStep(plan);
  return step !== null && elapsedMs(plan.state, now) >= durationMs(step.duration);
};

/** How much of the step is left, or null where it has no length or is already over. */
export const leftMs = (plan: Plan, now: DateTime): number | null => {
  const step = activeStep(plan);
  if (!step) return null;

  const left = durationMs(step.duration) - elapsedMs(plan.state, now);
  return Number.isFinite(left) && left > 0 ? left : null;
};

/** How far through the step the device is, for the bar. Null where there is nothing to be a fraction of. */
export const throughStep = (plan: Plan, now: DateTime): number | null => {
  const step = activeStep(plan);
  if (!step) return null;

  const total = durationMs(step.duration);
  return Number.isFinite(total) && total > 0 ? Math.min(1, elapsedMs(plan.state, now) / total) : null;
};

/**
 * Which step follows the one the plan stands on: the next, the first again when
 * it loops, or none, which is where the plan ends.
 */
export const nextStepIndex = (plan: Plan): number | null => {
  if (plan.state.activeStepIndex < plan.steps.length - 1) return plan.state.activeStepIndex + 1;
  return plan.loop ? 0 : null;
};

/** Whether the step is standing still waiting to be answered, rather than running out its clock. */
export const isWaiting = (plan: Plan, now: DateTime): boolean =>
  plan.state.status === 'running' && (activeStep(plan)?.waitForConfirmation ?? false) && isOver(plan, now);

/**
 * The five moves, offered only where the server would take them. Each condition
 * is the one in `PlanService`, and a move that is not offered is one that would
 * come back as a refusal rather than as a change.
 */
export interface Moves {
  confirm: boolean;
  skip: boolean;
  extend: boolean;
  pause: boolean;
  /** Also "start": a plan at rest has no clock to continue, so starting one is a resume. */
  resume: boolean;
  /** Stopping is not one of the five and not a deletion: the steps stay and the plan stands at the first again. */
  stop: boolean;
}

export const movesOf = (plan: Plan, now: DateTime): Moves => {
  const { status } = plan.state;
  const going = status === 'running' || status === 'paused';

  return {
    confirm: isWaiting(plan, now),
    skip: going && activeStep(plan) !== null,
    extend: going,
    pause: status === 'running',
    resume: status !== 'running' && plan.steps.length > 0,
    stop: going,
  };
};

/** How long the step has been over, which for a step that waits is how long it has been waiting. */
export const overdueMs = (plan: Plan, now: DateTime): number | null => {
  const step = activeStep(plan);
  if (!step || isOpenEnded(step.duration)) return null;

  const over = elapsedMs(plan.state, now) - durationMs(step.duration);
  return over > 0 ? over : null;
};

/**
 * A span of milliseconds in the words every other age on a screen is put in.
 * The app has one way of saying "4 min" and this borrows it rather than
 * rounding a second time. A span is a length and not an instant, so no clock
 * comes into it.
 *
 * What the step has served and how long it has been standing still are both
 * ages and are written by this. What it has left to run is not - a countdown
 * floored the way an age is would read a day short for the whole of its first
 * day, and the card states the step's own length one line above it, where the
 * shortfall is there to be read off.
 */
export const spanLabel = (ms: number): string => (Number.isFinite(ms) ? wordsFor(ms / 1000) : '—');

/** The same, for what is still to come: rounded up, so a step never reads shorter than what is left of it. */
export const countdownLabel = (ms: number): string => (Number.isFinite(ms) ? wordsLeftFor(ms / 1000) : '—');
