import type { PlanStep } from '@fg2/shared-types/v1';
import { StoredPlan } from '@database/schemas/v1/plans.schema';

/**
 * What a plan wants said out loud, provided by the notifications part.
 *
 * The plan knows that a step has started waiting and nothing about who keeps the
 * tent or what they asked to be told on; the other side knows both and nothing
 * about recipes. It is optional, as the alarms' routing is: a plan that waits
 * still writes its diary line and still sends its own mail where nothing is
 * wired in here.
 */
export const PLAN_ANNOUNCER = 'plan:announcer';

export interface PlanAnnouncer {
  /** A step that is waiting for somebody to confirm it, asked about once however often the plan is re-read. */
  askedToConfirm(plan: StoredPlan, step: PlanStep): Promise<void>;
}
