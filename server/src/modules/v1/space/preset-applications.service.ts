import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { GrowDecision, GrowthStage, PresetApplication, PresetApplicationCreate, PresetPlanEffect } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { unprocessable } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { NOTHING_HIDDEN } from '../grow/grow-serialiser';
import { GrowsService } from '../grow/grows.service';
import { PhaseWriterService } from '../phase/phase-writer.service';
import { stepAfterActive } from '../plan/plan-steps';
import { PlanService } from '../plan/plan.service';
import { ClimatePresetsService } from './climate-presets.service';
import { SpacesService } from './spaces.service';

/**
 * Applying a climate preset to a space: the phase tiles on the tent screen.
 *
 * A preset is a climate on top of a botanical stage, and applying one is two
 * things at once - the controllers standing here are put on it, and the grow
 * standing here enters the stage. Neither invents the other: a tent with no grow
 * in it still has its climate written, and nothing is created by a controller
 * merely being on.
 *
 * Nothing of the application is stored. What lasts is the phase, the devices'
 * settings and the diary line the phase writer leaves, so the answer states what
 * happened rather than a row that could be read back afterwards.
 *
 * The write itself is `ClimatePresetsService`, which a grow entering a phase
 * with a preset of its own reaches through `CLIMATE_PRESETS`. What is here is
 * everything around it: which grow the stage is for, and what a plan running in
 * the same tent has to do about it.
 */

/** What a plan's pause says it is waiting for, so the plan card can say why it stopped. */
const PAUSED_BY_A_PRESET = 'A climate preset was applied by hand.';

/** What a client may do about the grow when a preset is applied to a space with none in it. */
const DECISIONS: GrowDecision[] = ['start_grow', 'move_grow', 'climate_only'];

@Injectable()
export class PresetApplicationsService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.grow) private readonly growRows: Model<GrowDocument>,
    private readonly climate: ClimatePresetsService,
    private readonly spaces: SpacesService,
    private readonly phases: PhaseWriterService,
    private readonly plans: PlanService,
    private readonly grows: GrowsService,
    private readonly access: AccessService,
  ) {}

  public async apply(ctx: AccessContext, spaceId: string, body: PresetApplicationCreate): Promise<PresetApplication> {
    const space = await this.spaces.require(spaceId);
    const preset = body.preset ?? null;
    const decision = body.decision ?? null;
    const appliedAt = new Date();

    // The plan first, and the climate after it: the engine re-applies its step
    // hourly, so a preset written beside a plan that is still running would be
    // undone within the hour.
    const planEffect = await this.nudgePlan(spaceId, body.stage, ctx.userId);
    const applied = await this.climate.writeTo(spaceId, body.stage, preset);

    const growId = await this.growHere(ctx, spaceId, decision, body.growId ?? null, appliedAt);
    const controller = applied.at(0) ?? null;

    const phase =
      growId === null
        ? null
        : await this.phases.setPhase({
            growId,
            stage: body.stage,
            preset,
            source: 'preset',
            // A preset wrote the phase, so nobody picked the stage: that is what
            // the "auto" tag on the grow card is drawn from.
            setBy: null,
            plantIds: null,
            deviceId: controller?.deviceId ?? null,
            spaceId,
            targets: controller?.targets ?? null,
            startedAt: appliedAt,
          });

    // No grow here, nothing said about it, and a space that has not been told to
    // stop asking. The climate has been written either way, so somebody who
    // closes that sheet has still changed the tent.
    const asks = growId === null && decision === null && space.presetPrompt === 'ask';

    return {
      spaceId,
      stage: body.stage,
      preset,
      appliedAt: appliedAt.toISOString(),
      deviceIds: applied.map(device => device.deviceId),
      growId,
      // The phase the grow already stood in is not appended again, and the
      // answer names it rather than claiming nothing happened.
      phaseId: phase?.id ?? (growId === null ? null : await this.standingPhase(growId, body.stage, preset)),
      growDecisionNeeded: asks,
      decisions: asks ? DECISIONS : [],
      planEffect,
    };
  }

  /**
   * The grow the phase goes on: the one standing here, or the one the client
   * answered with.
   *
   * `move_grow` is the only decision that does anything here. `start_grow` is
   * the new-grow sheet, which carries a name and the plants and is `POST
   * /grows`; `climate_only` is the tent changed and the grows left alone. Both
   * come back so that the question is not asked a second time.
   */
  private async growHere(
    ctx: AccessContext,
    spaceId: string,
    decision: GrowDecision | null,
    growId: string | null,
    startedAt: Date,
  ): Promise<string | null> {
    const standing = await this.phases.growInSpace(spaceId);
    if (standing !== null || decision !== 'move_grow') return standing;

    if (!growId) {
      throw unprocessable('grow_not_named', 'Moving a grow here needs the grow it is.', [
        { field: 'growId', code: 'required', detail: '`growId` goes with the decision `move_grow`.' },
      ]);
    }

    // Moving a grow is managing it as well as the space, and the guard on the
    // route has only decided about the space.
    await this.access.require(ctx, subjectRef('grow', growId), 'manage');
    await this.grows.addPlacement(ctx, growId, { spaceId, startedAt: startedAt.toISOString() }, ctx.userId, NOTHING_HIDDEN);

    return growId;
  }

  /**
   * What the preset does to a plan running in this space.
   *
   * The engine re-applies its step hourly, so the two cannot both hold the tent.
   * A plan whose next step carries the stage that was asked for is simply moved
   * on to it - the person and the plan want the same thing - and one that does
   * not is paused, which leaves the tent on the preset until somebody picks the
   * plan up again.
   */
  private async nudgePlan(spaceId: string, stage: GrowthStage, by: string | null): Promise<PresetPlanEffect> {
    const here = await this.devices.find({ spaceId }, { id: 1 }).lean<Pick<StoredDevice, 'id'>[]>();

    for (const device of here) {
      const plan = await this.plans.forDevice(device.id);
      if (!plan || plan.state.status !== 'running') continue;

      const next = stepAfterActive(plan);
      const carriesTheStage = next !== null && plan.steps[next]?.stage === stage;
      await this.plans.transition(device.id, carriesTheStage ? { kind: 'skip' } : { kind: 'pause', reason: PAUSED_BY_A_PRESET }, by);

      return carriesTheStage ? 'skipped' : 'paused';
    }

    return 'none';
  }

  /** The phase a grow already stands in, for an application that appended none. */
  private async standingPhase(growId: string, stage: GrowthStage, preset: string | null): Promise<string | null> {
    const grow = await this.growRows.findOne({ id: growId }, { phases: 1 }).lean<Pick<GrowDocument, 'phases'>>();
    const matching = (grow?.phases ?? []).filter(phase => phase.stage === stage && phase.preset === preset);

    return (
      matching.reduce<GrowDocument['phases'][number] | null>((best, phase) => (best && best.startedAt > phase.startedAt ? best : phase), null)?.id ??
      null
    );
  }
}
