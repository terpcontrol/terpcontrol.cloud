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
  /**
   * A step that is waiting for somebody to confirm it, asked about once per
   * person however often the plan is re-read.
   *
   * It answers whether the ask is settled - whether everybody who keeps the tent
   * has now heard it, or wanted to hear nothing of the sort. False means only
   * that somebody is being kept quiet at this moment, and that asking again
   * later will reach them; the plan re-attempts on that answer, so a question
   * that fell into a person's night is put again once their night is over.
   */
  askedToConfirm(plan: StoredPlan, step: PlanStep): Promise<boolean>;
}
