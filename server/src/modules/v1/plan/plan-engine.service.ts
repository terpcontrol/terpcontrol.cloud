import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BackgroundWork } from '@common/background-work';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { logger } from '@utils/logger';
import { DEVICE_CONFIGURATION_WRITER, DeviceConfigurationWriter } from './device-configuration.port';
import { PlanProgressService } from './plan-progress.service';
import { activeStep, isOver } from './plan-steps';

/** The loop that walks the running plans: what is over moves on, and what is running is kept on its step. */

const TICK_MS = 20 * 1000;

/** A step is re-sent at most once an hour, and only to a device that is answering. */
const REAPPLY_INTERVAL_MS = 60 * 60 * 1000;
const APPLY_LAST_SEEN_MS = 60 * 1000;

/** As much of a device as a send is decided by. */
type Answering = Pick<StoredDevice, 'state' | 'configuration'>;

@Injectable()
export class PlanEngineService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.plan) private readonly plans: Model<StoredPlan>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @Inject(DEVICE_CONFIGURATION_WRITER) private readonly configuration: DeviceConfigurationWriter,
    private readonly progress: PlanProgressService,
  ) {}

  /** The loop used to start as this file was imported, before the database was necessarily up. */
  public onModuleInit(): void {
    this.work.repeat('The grow plans', () => this.run(), TICK_MS);
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  /**
   * One pass over every plan that is running. A paused one keeps its clock where
   * it stopped and is not read. `now` is the whole pass's, so a plan is not
   * measured against a clock that moved while the plan before it was written.
   */
  public async run(now: Date = new Date()): Promise<void> {
    const plans = await this.plans.find({ 'state.status': 'running' }).lean<StoredPlan[]>().exec();

    for (const plan of plans) {
      // A pass walks every plan and awaits as it goes, so it can outlive the
      // server; stopping here keeps it off a connection that is closing.
      if (this.work.isStopped) break;

      // One plan must not end the pass: its device may have been given up since
      // the list was read, and this runs on a timer with no caller to report to.
      try {
        await this.runPlan(plan, now);
      } catch (error) {
        logger.error(`Failed running the grow plan of device ${plan.deviceId}: ${error}`);
      }
    }
  }

  private async runPlan(plan: StoredPlan, now: Date): Promise<void> {
    const step = activeStep(plan);
    if (!step) return;

    const current = !isOver(plan, now)
      ? plan
      : step.waitForConfirmation
        ? await this.progress.awaitConfirmation(plan, now)
        : await this.progress.moveOn(plan, now, null);

    await this.applyStep(current, now);
  }

  /**
   * The step is re-sent hourly, because a device that was reconfigured by hand,
   * or that came back with an older document, is otherwise left running
   * something the plan did not ask for. A device that is not answering is left
   * alone: the send would be recorded as done for the hour it covers.
   *
   * A device that has never sent its own document is left alone too, and for
   * good. The merge has nothing to merge into, so what would reach the hardware
   * is the step's few sections as the whole configuration, and the firmware
   * reads every key that is missing from one as its compile-time default - which
   * would put the work mode, the light schedule, the dehumidifier's timings and
   * the dimming ramps back to factory values that were never the tent's and that
   * nothing here has a copy of. Refusing the plan when it is written keeps this
   * from being reached at all; this guard is for the plans written before that
   * refusal existed, and for the same reason: a write nothing can undo is worse
   * than a step that does not arrive. Neither is announced from here - the plan
   * screen says it, in the sentence the manual targets page says it in - and
   * `lastAppliedAt` is left alone, as it is for a device that is not answering,
   * so the step goes out on the pass after the document finally arrives.
   */
  private async applyStep(plan: StoredPlan, now: Date): Promise<void> {
    const step = activeStep(plan);
    if (!step || plan.state.status !== 'running') return;

    const { lastAppliedAt } = plan.state;
    if (lastAppliedAt && lastAppliedAt.getTime() > now.getTime() - REAPPLY_INTERVAL_MS) return;

    const device = await this.deviceFor(plan.deviceId);
    if (!this.isAnswering(device, now)) return;
    const writes = Object.keys(step.settings ?? {}).length > 0;
    if (writes && Object.keys(device?.configuration ?? {}).length === 0) return;

    try {
      // A step that writes nothing is sent nothing: an empty document is not an
      // empty change to the firmware, which rebuilds its whole settings from it.
      if (writes && (await this.configuration.applyConfiguration(plan.deviceId, step.settings))) {
        logger.info(`Applied recipe step ${plan.state.activeStepIndex} to device ${plan.deviceId}`);
      }

      // That it was applied is written down only once it has been, so a send
      // that failed is tried again on the next pass rather than being marked
      // done for the hour the check covers.
      await this.progress.store(plan, { ...plan.state, lastAppliedAt: now });
    } catch (error) {
      logger.error(`Could not apply recipe step ${plan.state.activeStepIndex} to device ${plan.deviceId}: ${error}`);
    }
  }

  /** The two things a send is decided by, read in one go: when the device last spoke, and whether it ever sent its settings. */
  private deviceFor(deviceId: string): Promise<Answering | null> {
    return this.devices.findOne({ id: deviceId }, { 'state.lastSeenAt': 1, configuration: 1 }).lean<Answering | null>().exec();
  }

  private isAnswering(device: Answering | null, now: Date): boolean {
    const lastSeenAt = device?.state?.lastSeenAt;
    return !!lastSeenAt && lastSeenAt.getTime() >= now.getTime() - APPLY_LAST_SEEN_MS;
  }
}
