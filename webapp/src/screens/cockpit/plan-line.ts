import type { DateTime } from 'luxon';
import type { Plan } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { DAY_MS, HOUR_MS } from '@/ui/days';
import { activeStep, isGoing, isOpenEnded, isWaiting, leftMs, nextStepIndex, readingAt } from '../control/plan-clock';

/**
 * "Flower, 12 more days, then late flower": where a running plan stands and
 * when it changes the targets next, in the words of the cockpit's plan line.
 */

/** "12 days", or "5 hours" on the last day: a step is counted in the unit a grower plans by, rounded up so it never reads short. */
const leftWords = (t: Translate, ms: number): string =>
  ms >= DAY_MS ? t('planLine.days', { count: Math.ceil(ms / DAY_MS) }) : t('planLine.hours', { count: Math.max(1, Math.ceil(ms / HOUR_MS)) });

export const planLineOf = (t: Translate, plan: Plan, now: DateTime): string | null => {
  if (!plan.state || !isGoing(plan.state)) return null;
  const step = activeStep(plan);
  if (!step) return null;
  // A paused plan sets nothing, but one that stands still unnoticed is a grow that stops moving on.
  if (plan.state.status === 'paused') return t('planLine.paused', { step: step.name });

  const at = readingAt(plan.state, now);
  const next = nextStepIndex(plan);
  const nextName = next === null ? null : (plan.steps[next]?.name ?? null);
  if (isWaiting(plan, at)) return t('planLine.waiting', { step: step.name });
  if (isOpenEnded(step.duration)) return t('planLine.openEnded', { step: step.name });

  const left = leftMs(plan, at);
  if (left === null) return nextName ? t('planLine.changing', { step: step.name, next: nextName }) : t('planLine.ending', { step: step.name });

  return nextName
    ? t('planLine.left', { step: step.name, left: leftWords(t, left), next: nextName })
    : t('planLine.leftLast', { step: step.name, left: leftWords(t, left) });
};
