import type { Plan, PlanState, PlanTemplate } from '@fg2/shared-types/v1';
import { StoredPlanTemplate } from '@database/schemas/v1/plan-templates.schema';
import { StoredPlan, StoredPlanState } from '@database/schemas/v1/plans.schema';

/** The stored documents as the contract has them: instants as ISO strings, and nothing a reader may not see. */

const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

const stateOf = (state: StoredPlanState): PlanState => ({
  status: state.status,
  activeStepIndex: state.activeStepIndex,
  stepStartedAt: iso(state.stepStartedAt),
  pausedElapsedMs: state.pausedElapsedMs,
  pauseReason: state.pauseReason,
  lastAppliedAt: iso(state.lastAppliedAt),
  confirmationNotifiedAt: iso(state.confirmationNotifiedAt),
  confirmationAskedAt: iso(state.confirmationAskedAt),
  confirmationAskTriedAt: iso(state.confirmationAskTriedAt),
});

/**
 * `notify.email` is an address somebody typed - often their own, sometimes a
 * partner's - and a plan is readable by whoever may read the device, which
 * through a share link on the tent is somebody outside the household. It is
 * answered to whoever may manage the device and to nobody else; that the plan
 * writes somewhere is not the secret, so the mode and the diary switch stay
 * visible either way.
 *
 * `mayManage` is the narrower of the two things `access()` hands back: everybody
 * who may manage a device reads it unredacted, and a member who may only log
 * does not - which is the quieter direction for an address that is not theirs.
 */
export const planOf = (plan: StoredPlan, mayManage: boolean): Plan => ({
  id: plan.id,
  createdAt: plan.createdAt.toISOString(),
  deviceId: plan.deviceId,
  templateId: plan.templateId,
  name: plan.name,
  steps: plan.steps,
  loop: plan.loop,
  notify: { mode: plan.notify.mode, email: mayManage ? plan.notify.email : null, writeEntries: plan.notify.writeEntries },
  state: stateOf(plan.state),
});

/** A template runs nothing, so it has no state and nothing in it is anybody's address. */
export const planTemplateOf = (template: StoredPlanTemplate): PlanTemplate => ({
  id: template.id,
  createdAt: template.createdAt.toISOString(),
  ownerId: template.ownerId,
  name: template.name,
  isPublic: template.isPublic,
  steps: template.steps,
});
