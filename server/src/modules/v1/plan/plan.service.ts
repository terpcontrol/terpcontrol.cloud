import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { PlanReplace, PlanTransition, StepDuration } from '@fg2/shared-types/v1';
import { badRequest, conflict, notFound } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { PlanProgressService } from './plan-progress.service';
import { activeStep, durationMs, elapsedMs, isOver, positionIn, stepsOf, stopped } from './plan-steps';

/**
 * The plan a device is being run by, and what a person does to it.
 *
 * The steps are what the plan *is* and are written as a whole, where confirming,
 * skipping, extending, pausing and resuming are moves of `plans.state` and
 * nothing else: they say where in those steps the device stands. A pause keeps
 * what the step has already served and stops its clock, so a plan picked up a
 * week later continues the step rather than starting it again.
 *
 * Nothing here speaks to a device. What a step asks of one is an opaque fragment
 * of that firmware's own configuration document, and it reaches the hardware
 * through the engine's hourly pass and the one module that speaks the protocol -
 * so writing a plan changes what the device will be told, never what it is told
 * in this request.
 */
@Injectable()
export class PlanService {
  constructor(
    @InjectModel(MODEL_V1.plan) private readonly plans: Model<StoredPlan>,
    private readonly progress: PlanProgressService,
  ) {}

  public async forDevice(deviceId: string): Promise<StoredPlan | null> {
    return this.plans.findOne({ deviceId }).lean<StoredPlan>().exec();
  }

  /** The plan of a device that has one. A device that has none is not running anything, which is not the same as not existing. */
  public async require(deviceId: string): Promise<StoredPlan> {
    const plan = await this.forDevice(deviceId);
    if (!plan) throw notFound('plan_not_found', 'This device is not running a plan.');

    return plan;
  }

  /**
   * The plan a client wrote, in place of whatever the device had.
   *
   * A device runs one plan, so there is nothing to choose between: the first
   * write creates it and every later one replaces it. What is written is the
   * plan - its steps, its name, whether it loops and where it writes - and never
   * where it stands, which is `state` and moves only through a transition or
   * through the engine's own clock. A plan that is new is created at rest: the
   * plan screen's "start" is a `resume`, and a plan that ran the moment it was
   * saved would put a tent on a step nobody had looked at yet.
   */
  public async replace(deviceId: string, body: PlanReplace): Promise<StoredPlan> {
    const existing = await this.forDevice(deviceId);
    const steps = stepsOf(body.steps);
    const now = new Date();

    const written = {
      templateId: body.templateId,
      name: body.name,
      steps,
      loop: body.loop,
      notify: body.notify,
      state: existing ? positionIn(existing.state, existing.steps, steps, now) : stopped(),
    };

    // Upserted rather than created after a look: `deviceId` is unique, which is
    // the model saying one plan per device, and two saves that crossed would
    // otherwise be a duplicate key rather than the later of the two winning.
    await this.plans.updateOne({ deviceId }, { $setOnInsert: { id: uuidv4(), createdAt: now }, $set: written }, { upsert: true }).exec();

    return this.require(deviceId);
  }

  /**
   * Putting the plan away. It keeps its steps and stands at its first one again,
   * which is what "Stop recipe" has always left behind and what `resume` picks
   * up; pausing is the stop that keeps the clock.
   *
   * The device is left running whatever the last step gave it. Stopping a plan
   * says nothing about what a tent should be doing instead, and a controller put
   * back to some default because a plan ended would be a change nobody asked
   * for.
   */
  public async stop(deviceId: string): Promise<StoredPlan> {
    const plan = await this.require(deviceId);
    return this.progress.store(plan, stopped());
  }

  public async transition(deviceId: string, transition: PlanTransition, by: string | null = null): Promise<StoredPlan> {
    const plan = await this.require(deviceId);
    const now = new Date();

    switch (transition.kind) {
      case 'confirm':
        return this.confirm(plan, now, by);
      case 'skip':
        return this.skip(plan, now, by);
      case 'extend':
        return this.extend(plan, transition.by);
      case 'pause':
        return this.pause(plan, transition.reason, now);
      case 'resume':
        return this.resume(plan, now, by);
    }
  }

  /** The answer the step was waiting for. It is the step's end, so the plan moves on as it would have on its own. */
  private async confirm(plan: StoredPlan, now: Date, by: string | null): Promise<StoredPlan> {
    const step = activeStep(plan);
    if (plan.state.status !== 'running' || !step?.waitForConfirmation || !isOver(plan, now)) {
      throw conflict('nothing_to_confirm', 'This plan is not waiting to be confirmed.');
    }

    return this.progress.moveOn(plan, now, 'confirm', by);
  }

  /** On to the next step before its time is up, which is also how a step that waits is passed over. */
  private async skip(plan: StoredPlan, now: Date, by: string | null): Promise<StoredPlan> {
    if (!activeStep(plan) || (plan.state.status !== 'running' && plan.state.status !== 'paused')) {
      throw conflict('plan_not_running', 'This plan has no step to skip.');
    }

    return this.progress.moveOn(plan, now, 'skip', by);
  }

  /**
   * More time on the step the device is on. The plan itself is not touched - the
   * step keeps the duration it was written with - the clock is put back, and a
   * step that had already asked for its confirmation asks again when the longer
   * time is up.
   */
  private async extend(plan: StoredPlan, by: StepDuration): Promise<StoredPlan> {
    const moreMs = durationMs(by);
    if (!Number.isFinite(moreMs)) throw badRequest('invalid_duration', 'A step is extended by a length greater than zero.');

    if (plan.state.status !== 'running' && plan.state.status !== 'paused') {
      throw conflict('plan_not_running', 'This plan has no step to extend.');
    }

    return this.progress.store(plan, {
      ...plan.state,
      stepStartedAt: plan.state.stepStartedAt ? new Date(plan.state.stepStartedAt.getTime() + moreMs) : null,
      pausedElapsedMs: plan.state.stepStartedAt ? plan.state.pausedElapsedMs : Math.max(0, plan.state.pausedElapsedMs - moreMs),
      confirmationNotifiedAt: null,
      confirmationAskedAt: null,
      confirmationAskTriedAt: null,
    });
  }

  /** The clock stops where it is. The device keeps the settings the step gave it; nothing is sent. */
  private async pause(plan: StoredPlan, reason: string | null, now: Date): Promise<StoredPlan> {
    if (plan.state.status !== 'running') throw conflict('plan_not_running', 'Only a running plan can be paused.');

    return this.progress.store(plan, {
      ...plan.state,
      status: 'paused',
      stepStartedAt: null,
      pausedElapsedMs: elapsedMs(plan.state, now),
      pauseReason: reason,
    });
  }

  /**
   * The clock runs again. A plan that was stopped or has run to its end has no
   * clock to continue, so resuming starts it on the step it stands at - which is
   * the only way a plan is started, and is what the plan screen's "start" does.
   */
  private async resume(plan: StoredPlan, now: Date, by: string | null): Promise<StoredPlan> {
    if (plan.state.status === 'running') throw conflict('plan_already_running', 'This plan is already running.');
    if (plan.steps.length === 0) throw conflict('plan_has_no_steps', 'A plan without steps has nothing to run.');

    if (plan.state.status === 'paused') {
      return this.progress.store(plan, { ...plan.state, status: 'running', stepStartedAt: now, pauseReason: null });
    }

    const index = plan.state.activeStepIndex < plan.steps.length ? plan.state.activeStepIndex : 0;
    return this.progress.activate(plan, index, now, 'resume', by);
  }
}
