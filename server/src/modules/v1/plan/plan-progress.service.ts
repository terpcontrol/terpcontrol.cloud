import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PlanStep, PlanTransitionKind } from '@fg2/shared-types/v1';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredPlan, StoredPlanState } from '@database/schemas/v1/plans.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { logger } from '@utils/logger';
import { MailService } from '@modules/mail/mail.service';
import { targetsOf } from '../phase/phase-targets';
import { PhaseWriterService } from '../phase/phase-writer.service';
import { activeStep, completed, running, stepAfterActive } from './plan-steps';

/**
 * Everything that happens when a plan moves: the tick decides *when*, a
 * transition decides *that*, and both leave the same marks behind - the new
 * state, the diary line, the mail, and the phase a step's stage puts the grow
 * into.
 *
 * The state is written down before anything is sent or announced. Sending can
 * fail - there may be no broker, and the device may have been given up since the
 * plan was read - and a step change worked out but never stored is worked out
 * again twenty seconds later, with another diary entry and another mail each
 * time.
 */

/** Where a plan's device stands, which is what a diary line is filed under. */
interface DevicePlace {
  spaceId: string | null;
  growId: string | null;
  ownerId: string | null;
  configuration: Record<string, unknown> | null;
}

@Injectable()
export class PlanProgressService {
  constructor(
    @InjectModel(MODEL_V1.plan) private readonly plans: Model<StoredPlan>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly entries: EntryWriterService,
    private readonly phases: PhaseWriterService,
    private readonly mail: MailService,
  ) {}

  /**
   * On to the step that follows: the next one, the first one again when the plan
   * loops, or the end of it. `transition` names the person's doing; the engine
   * simply running out the clock passes null.
   */
  public async moveOn(plan: StoredPlan, now: Date, transition: PlanTransitionKind | null, by: string | null = null): Promise<StoredPlan> {
    const next = stepAfterActive(plan);
    const looped = next !== null && next !== plan.state.activeStepIndex + 1;
    const moved = await this.store(plan, next === null ? completed() : running(next, now));
    const step = activeStep(moved);

    logger.info(
      next === null
        ? `Recipe completed for device ${plan.deviceId}`
        : `${looped ? 'Looping recipe to step' : 'Advancing to next recipe step'} ${next} for device ${plan.deviceId}`,
    );

    const place = await this.place(moved);
    const number = moved.state.activeStepIndex + 1;

    if (next === null || !step) {
      await this.announce(moved, place, transition, by, 'message-recipe-completed', []);
      await this.notify(
        moved,
        place,
        'on_step',
        `Recipe completed on device ${plan.deviceId}`,
        `The recipe has completed all steps on device ${plan.deviceId}.`,
      );
      return moved;
    }

    if (looped) {
      await this.announce(moved, place, transition, by, 'message-recipe-looped', [step.name]);
      await this.notify(
        moved,
        place,
        'on_step',
        `Recipe looped to step #1 on device ${plan.deviceId}`,
        `The recipe has looped back to step #1 ${step.name}.`,
      );
    } else {
      await this.announce(moved, place, transition, by, 'message-recipe-advanced', [`${number} (${step.name})`]);
      await this.notify(
        moved,
        place,
        'on_step',
        `Recipe advanced to step #${number} on device ${plan.deviceId}`,
        `The recipe has advanced to step #${number} ${step.name}`,
      );
    }

    await this.setPhase(moved, place, step);
    return moved;
  }

  /**
   * A step somebody has to confirm has run out. It asks once: the plan stands
   * still until a person answers, and the engine comes past every twenty seconds.
   */
  public async awaitConfirmation(plan: StoredPlan, now: Date): Promise<StoredPlan> {
    const step = activeStep(plan);
    if (!step || plan.notify.mode === 'off' || plan.state.confirmationNotifiedAt) return plan;

    const asked = await this.store(plan, { ...plan.state, confirmationNotifiedAt: now });
    const place = await this.place(asked);
    const number = asked.state.activeStepIndex + 1;
    const message = step.confirmationMessage || 'No additional information provided.';

    await this.announce(asked, place, null, null, 'message-recipe-step-awaiting-confirmation', [`${number} (${step.name}) - ${message}`]);
    await this.notify(
      asked,
      place,
      'any',
      `Recipe step #${number} waiting for confirmation on device ${plan.deviceId}`,
      `Please confirm the completion of step #${number} ${step.name}: ${message}`,
    );

    return asked;
  }

  /**
   * A step somebody activated: starting a plan that was stopped, or resuming one
   * that has run to its end. The clock starts over, and the step's stage is the
   * grow's, exactly as when the engine reaches the step itself.
   */
  public async activate(plan: StoredPlan, index: number, now: Date, transition: PlanTransitionKind, by: string | null): Promise<StoredPlan> {
    const started = await this.store(plan, running(index, now));
    const step = activeStep(started);
    if (!step) return started;

    const place = await this.place(started);
    await this.announce(started, place, transition, by, 'message-recipe-step-manually-activated', [`${index + 1} (${step.name})`]);
    await this.setPhase(started, place, step);

    return started;
  }

  /** The plan as it stands after a state of its own - a pause, a resumed clock, a step that was applied. */
  public async store(plan: StoredPlan, state: StoredPlanState): Promise<StoredPlan> {
    await this.plans.updateOne({ id: plan.id }, { $set: { state } }).exec();
    return { ...plan, state };
  }

  private async setPhase(plan: StoredPlan, place: DevicePlace, step: PlanStep): Promise<void> {
    // A plan step without a stage leaves the grow where it is, and a controller
    // running in a space nobody grows in invents no grow to put a phase on.
    if (!step.stage || !place.growId) return;

    await this.phases.setPhase({
      growId: place.growId,
      stage: step.stage,
      preset: step.preset,
      source: 'plan',
      setBy: null,
      plantIds: null,
      deviceId: plan.deviceId,
      spaceId: place.spaceId,
      targets: targetsOf(place.configuration),
    });
  }

  /** The diary line, when the plan writes them. `transition` is null for what the engine did on its own. */
  private async announce(
    plan: StoredPlan,
    place: DevicePlace,
    transition: PlanTransitionKind | null,
    by: string | null,
    key: string,
    params: string[],
  ): Promise<void> {
    if (!plan.notify.writeEntries) return;

    await this.entries.write({
      source: 'plan',
      authorId: by,
      growId: place.growId,
      spaceId: place.spaceId,
      deviceId: plan.deviceId,
      severity: 'info',
      message: { key, params },
      values: { kind: 'plan', planId: plan.id, stepIndex: plan.state.activeStepIndex, transition },
    });
  }

  /**
   * The mail the plan sends. `on_step` goes only to a plan that asked for every
   * step; `any` is the confirmation, which any setting but `off` is asked about.
   */
  private async notify(plan: StoredPlan, place: DevicePlace, when: 'on_step' | 'any', subject: string, text: string): Promise<void> {
    if (plan.notify.mode === 'off' || (when === 'on_step' && plan.notify.mode !== 'on_step')) return;

    const to = plan.notify.email ?? (await this.ownerAddress(place.ownerId));
    if (!to) return;

    // A mail that could not be sent must not repeat the step change it announces.
    try {
      await this.mail.send({ to, subject: `[TERP CONTROL] ${subject}`, text });
    } catch (error) {
      logger.error(`Failed to send recipe step notification email for device ${plan.deviceId}: ${error}`);
    }
  }

  private async ownerAddress(ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;

    const owner = await this.users.findOne({ id: ownerId }, { email: 1 }).lean<{ email: string }>().exec();
    return owner?.email ?? null;
  }

  public async place(plan: StoredPlan): Promise<DevicePlace> {
    const device = await this.devices
      .findOne({ id: plan.deviceId }, { spaceId: 1, ownerId: 1, configuration: 1 })
      .lean<Pick<StoredDevice, 'spaceId' | 'ownerId' | 'configuration'>>()
      .exec();

    return {
      spaceId: device?.spaceId ?? null,
      growId: await this.phases.growInSpace(device?.spaceId ?? null),
      ownerId: device?.ownerId ?? null,
      configuration: device?.configuration ?? null,
    };
  }
}
