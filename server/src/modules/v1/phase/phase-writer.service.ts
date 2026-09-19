import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { GrowthStage, PhaseSource, PhaseTargets } from '@fg2/shared-types/v1';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { notFound } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
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

/**
 * A phase that was entered wrongly, field by field. Absent is "leave it as it
 * is", which is why every one of them is optional rather than nullable: `null`
 * is a value two of them really take.
 */
export interface PhaseCorrection {
  stage?: GrowthStage;
  preset?: string | null;
  startedAt?: Date;
  plantIds?: string[] | null;
}

@Injectable()
export class PhaseWriterService {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly entries: EntryWriterService,
    // The writer states a phase; this is what it takes to un-state one. A
    // correction and a withdrawal are not new lines, so they do not go through
    // the writer above, and the line they move is found by the phase it names.
    @InjectModel(MODEL_V1.entry) private readonly entryRows: Model<EntryDocument>,
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

    await this.rereadThresholds(phase);
    return phase;
  }

  /**
   * A phase that was entered with the wrong stage or on the wrong day.
   *
   * The phase and the diary line that announced it are one fact told twice, so
   * both move: a week card takes its stage from the phases and its lines from
   * the diary, and a diary still saying "entered flowering" on a day the grow
   * did not would read as the correction never having happened.
   *
   * Who put the grow there is not corrected with it. `source` and `setBy` say
   * who decided, and a mistyped date does not change that - nor does it change
   * which controller the targets were read from, so the snapshot the phase draws
   * its band from stays the one that was really running.
   */
  public async correctPhase(growId: string, phaseId: string, changes: PhaseCorrection): Promise<StoredPhase> {
    const grow = await this.grows.findOne({ id: growId }).lean<GrowDocument>().exec();
    if (!grow) throw notFound('grow_not_found', 'There is no grow with that id.');

    const standing = grow.phases.find(phase => phase.id === phaseId);
    if (!standing) throw notFound('phase_not_found', 'There is no phase of that grow with that id.');

    const corrected: StoredPhase = {
      ...standing,
      stage: changes.stage ?? standing.stage,
      preset: changes.preset === undefined ? standing.preset : changes.preset,
      startedAt: changes.startedAt ?? standing.startedAt,
      plantIds: changes.plantIds === undefined ? standing.plantIds : changes.plantIds,
    };

    // Kept in order, because the corrected date may have moved the phase past
    // the one that followed it, and the contract answers `phases[]` by date.
    const phases = [...grow.phases.filter(phase => phase.id !== phaseId), corrected].sort(byDate);
    await this.grows.updateOne({ id: growId }, { $set: { phases } }).exec();

    await this.entryRows
      .updateOne(
        { growId, kind: 'phase', 'values.phaseId': phaseId },
        {
          $set: {
            occurredAt: corrected.startedAt,
            plantIds: corrected.plantIds ?? [],
            'values.stage': corrected.stage,
            'values.preset': corrected.preset,
          },
        },
      )
      .exec();

    // Only where the correction changed the phase the grow stands in now: the
    // thresholds are what the alarm engine watches today, and re-reading them
    // from a stage that ended in spring would arm the tent for spring.
    if (phases[phases.length - 1]?.id === phaseId && (corrected.stage !== standing.stage || corrected.preset !== standing.preset)) {
      await this.rereadThresholds(corrected);
    }

    return corrected;
  }

  /**
   * A phase that never happened: the stage was picked by mistake, or twice. The
   * line that announced it goes with it, because a diary entry naming a phase
   * that is gone points at nothing.
   *
   * The day counter follows: it counts from the earliest phase, so withdrawing
   * the first one is how a grow whose start was recorded wrongly gets its days
   * back.
   */
  public async removePhase(growId: string, phaseId: string): Promise<void> {
    // Asked of the document rather than of the write: a grow carries timestamps,
    // so a `$pull` that matched no phase still counts as a modification.
    const grow = await this.grows.findOne({ id: growId }, { phases: 1 }).lean<Pick<GrowDocument, 'phases'>>().exec();
    if (!grow?.phases.some(phase => phase.id === phaseId)) throw notFound('phase_not_found', 'There is no phase of that grow with that id.');

    await this.grows.updateOne({ id: growId }, { $pull: { phases: { id: phaseId } } }).exec();
    await this.entryRows.deleteMany({ growId, kind: 'phase', 'values.phaseId': phaseId }).exec();
  }

  /** The thresholds are the alarm engine's, and a stage that could not be announced to it must not undo the phase the grow is in. */
  private async rereadThresholds(phase: StoredPhase): Promise<void> {
    if (!phase.deviceId) return;

    try {
      await this.alarms?.applyStage(phase.deviceId, phase.stage, phase.preset);
    } catch (error) {
      logger.error(`Could not re-read the stage thresholds of device ${phase.deviceId}: ${error}`);
    }
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

const byDate = (one: StoredPhase, other: StoredPhase): number => one.startedAt.getTime() - other.startedAt.getTime();

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
