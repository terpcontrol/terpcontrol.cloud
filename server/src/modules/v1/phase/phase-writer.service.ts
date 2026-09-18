import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { GrowthStage, PhaseSource, PhaseTargets } from '@fg2/shared-types/v1';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { logger } from '@utils/logger';
import { STAGE_ALARMS, StageAlarms } from './stage-alarms.port';

/**
 * The one place a phase is appended to a grow.
 *
 * A grow's `phases[]` is the single truth for its day counter, its stage and the
 * "auto" tag, and three things put a grow into a phase: a person picking the
 * stage, a plan step carrying one, and a climate preset applied to a space. They
 * have to leave the same three marks behind - the phase, the diary entry that
 * says so, and the alarm thresholds the stage binds - so they all come through
 * here instead of each appending a phase of its own.
 */

export type StoredPhase = GrowDocument['phases'][number];

export interface PhaseRequest {
  growId: string;
  stage: GrowthStage;
  /** The climate preset applied on top of the stage, such as `late_flowering`. */
  preset: string | null;
  source: PhaseSource;
  /** The user who picked the stage; null when a plan or a preset wrote it. */
  setBy: string | null;
  /** Null is every plant of the grow; a list is the scope of a split. */
  plantIds: string[] | null;
  /** The controller the targets were read from, if any. */
  deviceId: string | null;
  spaceId: string | null;
  targets: PhaseTargets | null;
  startedAt?: Date;
}

@Injectable()
export class PhaseWriterService {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly entries: EntryWriterService,
    @Optional() @Inject(STAGE_ALARMS) private readonly alarms: StageAlarms | null = null,
  ) {}

  /**
   * Puts a grow into a phase. Answers the phase it appended, or null when the
   * grow is not there or already stands in that phase: the same stage twice in a
   * row - two flowering steps, a re-saved plan, a preset applied again - is not
   * a phase change and leaves no second entry in the diary.
   */
  public async setPhase(request: PhaseRequest): Promise<StoredPhase | null> {
    const grow = await this.grows.findOne({ id: request.growId }).lean<GrowDocument>().exec();
    if (!grow) return null;

    const standing = currentPhase(grow, request.plantIds);
    if (standing && standing.stage === request.stage && standing.preset === request.preset) return null;

    const phase: StoredPhase = {
      id: uuidv4(),
      stage: request.stage,
      preset: request.preset,
      startedAt: request.startedAt ?? new Date(),
      source: request.source,
      plantIds: request.plantIds,
      deviceId: request.deviceId,
      targets: request.targets,
      setBy: request.setBy,
    };

    // The phase before the entry that announces it: an entry naming a phase that
    // was never appended points at nothing, where a phase whose entry failed is
    // merely a phase nobody was told about.
    await this.grows.updateOne({ id: grow.id }, { $push: { phases: phase } }).exec();

    await this.entries.write({
      source: request.source,
      authorId: request.setBy,
      growId: grow.id,
      spaceId: request.spaceId,
      deviceId: request.deviceId,
      plantIds: request.plantIds ?? [],
      occurredAt: phase.startedAt,
      values: { kind: 'phase', phaseId: phase.id, stage: phase.stage, preset: phase.preset },
    });

    if (request.deviceId) {
      // The thresholds are the alarm engine's, and a stage that could not be
      // announced to it must not undo the phase the grow is in.
      try {
        await this.alarms?.applyStage(request.deviceId, phase.stage, phase.preset);
      } catch (error) {
        logger.error(`Could not re-read the stage thresholds of device ${request.deviceId}: ${error}`);
      }
    }

    return phase;
  }

  /**
   * The grow standing in a space: the one whose placement there is still open.
   * Null when there is none - a controller merely being on invents no grow.
   */
  public async growInSpace(spaceId: string | null): Promise<string | null> {
    if (!spaceId) return null;

    const grow = await this.grows
      .findOne({ endedAt: null, placements: { $elemMatch: { spaceId, endedAt: null } } }, { id: 1 })
      .sort({ startedAt: -1 })
      .lean<{ id: string }>()
      .exec();

    return grow?.id ?? null;
  }
}

/** Where the plants a phase is about stand now: the latest phase written over the same scope. */
const currentPhase = (grow: GrowDocument, plantIds: string[] | null): StoredPhase | null =>
  grow.phases
    .filter(phase => sameScope(phase.plantIds, plantIds))
    .reduce<StoredPhase | null>((latest, phase) => (latest && latest.startedAt > phase.startedAt ? latest : phase), null);

const sameScope = (one: string[] | null, other: string[] | null): boolean => {
  if (one === null || other === null) return one === other;
  if (one.length !== other.length) return false;

  const sorted = [...other].sort();
  return [...one].sort().every((id, index) => id === sorted[index]);
};
