import type { DateTime } from 'luxon';
import type { Plan } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/ui/days';
import { activeStep, isGoing, isOpenEnded, isWaiting, leftMs, nextStepIndex, readingAt } from '@/screens/control/plan-clock';
import { stepTitle } from '@/screens/control/plan-labels';

/**
 * "Flower, 12 more days, then late flower": where a running plan stands and
 * when it changes the targets next, as the targets' row on Start says it.
 */

/**
 * "12 days", "5 hours" on the last day, "40 minutes" in the last hour: a step
 * is counted in the unit it still has more than one of, rounded up so it never
 * reads short - and a step of a few minutes is not said to have an hour left.
 */
const leftWords = (t: Translate, ms: number): string => {
  if (ms >= DAY_MS) return t('planLine.days', { count: Math.ceil(ms / DAY_MS) });
  if (ms >= HOUR_MS) return t('planLine.hours', { count: Math.ceil(ms / HOUR_MS) });
  return t('planLine.minutes', { count: Math.max(1, Math.ceil(ms / MINUTE_MS)) });
};

export const planLineOf = (t: Translate, plan: Plan, now: DateTime): string | null => {
  if (!plan.state || !isGoing(plan.state)) return null;
  const active = activeStep(plan);
  if (!active) return null;
  // A step is named as Steuerung names it: its own name, else its number in the reader's language.
  const step = { name: stepTitle(t, active.name, plan.state.activeStepIndex) };
  // A paused plan sets nothing, but one that stands still unnoticed is a grow that stops moving on.
  if (plan.state.status === 'paused') return t('planLine.paused', { step: step.name });

  const at = readingAt(plan.state, now);
  const next = nextStepIndex(plan);
  const nextName = next === null || !plan.steps[next] ? null : stepTitle(t, plan.steps[next].name, next);
  if (isWaiting(plan, at)) return t('planLine.waiting', { step: step.name });
  if (isOpenEnded(active.duration)) return t('planLine.openEnded', { step: step.name });

  const left = leftMs(plan, at);
  if (left === null) return nextName ? t('planLine.changing', { step: step.name, next: nextName }) : t('planLine.ending', { step: step.name });

  return nextName
    ? t('planLine.left', { step: step.name, left: leftWords(t, left), next: nextName })
    : t('planLine.leftLast', { step: step.name, left: leftWords(t, left) });
};
