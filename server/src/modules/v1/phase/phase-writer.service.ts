import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ProjectionType } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { GrowthStage, PhaseSource, PhaseTargets } from '@fg2/shared-types/v1';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { notFound } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument, PhaseDocument } from '@database/schemas/v1/grows.schema';
import { hasWorkModes } from '@modules/device-protocol/work-modes';
import { logger } from '@utils/logger';
import { DevicePlacement } from '../device/placement.port';
import { spacesNow, standingIn } from '../grow/grow-places';
import { latestPhase } from '../grow/grow-serialiser';
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

interface PhaseRequest {
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
  /**
   * False where the phase is only recorded and nothing wrote a climate with it.
   * A place's alarm thresholds follow the climate written there, and that write
   * moves them itself (`DeviceConfigurationService.store`), so a phase moves
   * none - but for one only recorded over a place that already runs the stage's
   * own mode, whose climate it then is (see `rereadThresholds`). Left out, the
   * climate was written.
   */
  climateWritten?: boolean;
}

/**
 * A phase that was entered wrongly, field by field. Absent is "leave it as it
 * is", which is why every one of them is optional rather than nullable: `null`
 * is a value two of them really take.
 */
interface PhaseCorrection {
  stage?: GrowthStage;
  preset?: string | null;
  startedAt?: Date;
  plantIds?: string[] | null;
}

@Injectable()
export class PhaseWriterService implements DevicePlacement {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly entries: EntryWriterService,
    // The writer states a phase; this is what it takes to un-state one. A
    // correction and a withdrawal are not new lines, so they do not go through
    // the writer above, and the line they move is found by the phase it names.
    @InjectModel(MODEL_V1.entry) private readonly entryRows: Model<EntryDocument>,
    // The thresholds a stage binds are written on every device standing where
    // the phase's plants do, and the phase names only the controller whose
    // climate it snapshots.
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @Optional() @Inject(STAGE_ALARMS) private readonly alarms: StageAlarms | null = null,
  ) {}

  /**
   * Puts a grow into a phase. Answers the phase it appended, or null when the
   * grow is not there or already stands in that phase: the same stage twice in a
   * row - two flowering steps, a re-saved plan, a preset applied again - is not
   * a phase change and leaves no second entry in the diary.
   */
  public async setPhase(request: PhaseRequest): Promise<PhaseDocument | null> {
    const grow = await this.grows.findOne({ id: request.growId }).lean<GrowDocument>().exec();
    if (!grow) return null;

    const standing = currentPhase(grow, request.plantIds);
    if (standing && standing.stage === request.stage && standing.preset === request.preset) return null;

    const phase: PhaseDocument = {
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

    if (request.climateWritten === false && (await this.runsItsMode(grow, phase))) await this.rereadThresholds(grow, phase);
    return phase;
  }

  /**
   * A phase that was entered with the wrong stage or on the wrong day.
   *
   * The phase and the diary line that announced it are one fact told twice, so
   * both move: a day of the diary takes its stage from the phases and its lines from
   * the diary, and a diary still saying "entered flowering" on a day the grow
   * did not would read as the correction never having happened.
   *
   * Who put the grow there is not corrected with it. `source` and `setBy` say
   * who decided, and a mistyped date does not change that - nor does it change
   * which controller the targets were read from, so the snapshot the phase draws
   * its band from stays the one that was really running.
   */
  public async correctPhase(growId: string, phaseId: string, changes: PhaseCorrection): Promise<PhaseDocument> {
    const grow = await this.grows.findOne({ id: growId }).lean<GrowDocument>().exec();
    if (!grow) throw notFound('grow_not_found', 'There is no grow with that id.');

    const standing = grow.phases.find(phase => phase.id === phaseId);
    if (!standing) throw notFound('phase_not_found', 'There is no phase of that grow with that id.');

    const corrected: PhaseDocument = {
      ...standing,
      stage: changes.stage ?? standing.stage,
      preset: changes.preset === undefined ? standing.preset : changes.preset,
      startedAt: changes.startedAt ?? standing.startedAt,
      plantIds: changes.plantIds === undefined ? standing.plantIds : changes.plantIds,
    };

    // Kept in order, because the corrected date may have moved the phase past
    // the one that followed it, and the contract answers `phases[]` by date.
    const phases = [...grow.phases.filter(phase => phase.id !== phaseId), corrected].sort(byDate);
    const startedAt = startCarriedBy(grow, phases);
    await this.grows.updateOne({ id: growId }, { $set: { phases, ...(startedAt ? { startedAt } : {}) } }).exec();

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

    // A correction writes no climate - it repairs the record - and so moves no
    // threshold: they are the climate's that was written.
    return corrected;
  }

  /**
   * A phase that never happened: the stage was picked by mistake, or twice. The
   * line that announced it goes with it, because a diary entry naming a phase
   * that is gone points at nothing.
   *
   * The day counter follows where the grow's start stood on that phase, so
   * withdrawing the first one is how a grow whose start was recorded wrongly
   * gets its days back.
   *
   * Withdrawing the phase the grow stands in puts it back in the one before,
   * and writes no device: the place's climate, and the thresholds that follow
   * it, stay as they are.
   */
  public async removePhase(growId: string, phaseId: string): Promise<void> {
    // Asked of the document rather than of the write: a grow carries timestamps,
    // so a `$pull` that matched no phase still counts as a modification.
    const grow = await this.grows.findOne({ id: growId }).lean<GrowDocument>().exec();
    if (!grow?.phases.some(phase => phase.id === phaseId)) throw notFound('phase_not_found', 'There is no phase of that grow with that id.');

    const left = grow.phases.filter(phase => phase.id !== phaseId);
    const startedAt = startCarriedBy(grow, left);
    await this.grows.updateOne({ id: growId }, { $pull: { phases: { id: phaseId } }, ...(startedAt ? { $set: { startedAt } } : {}) }).exec();
    await this.entryRows.deleteMany({ growId, kind: 'phase', 'values.phaseId': phaseId }).exec();
  }

  /**
   * The thresholds the stage binds, on every device standing where the phase's
   * plants do - a plug in the tent measures the same air as the controller -
   * and on the controller the phase names, which is the same set unless the
   * plants have since been moved. Only for a stage recorded over a place that
   * already runs its mode: any other stage merely recorded - beside another
   * grow, or seeds sprouting somewhere a lamp burns - would arm the place for a
   * climate nobody set (a second grow started in Veg closed the flowering grow's
   * open "too humid" while the air stayed at 62 %).
   */
  private async rereadThresholds(grow: GrowDocument, phase: PhaseDocument): Promise<void> {
    if (!this.alarms) return;

    const here = await this.devices.find({ spaceId: { $in: spacesOf(grow, phase.plantIds) } }, { id: 1 }).lean<Pick<StoredDevice, 'id'>[]>();
    const deviceIds = new Set([...here.map(device => device.id), ...(phase.deviceId ? [phase.deviceId] : [])]);

    for (const deviceId of deviceIds) await this.applyStageTo(deviceId, phase);
  }

  /**
   * Whether the place already runs the stage's own mode - germinates or dries, set so under Steuerung or at the device -
   * on every device there that has work modes: the climate in force is then the stage's, and a phase recorded over it
   * takes its bands.
   */
  private async runsItsMode(grow: GrowDocument, phase: PhaseDocument): Promise<boolean> {
    const mode = MODE_OF_STAGE[phase.stage];
    if (!mode) return false;

    const here = await this.devices
      .find({ spaceId: { $in: spacesOf(grow, phase.plantIds) } }, { type: 1, 'configuration.workmode': 1 })
      .lean<Pick<StoredDevice, 'type' | 'configuration'>[]>();
    const steering = here.filter(device => hasWorkModes(device.type));
    return steering.length > 0 && steering.every(device => device.configuration?.workmode === mode);
  }

  /**
   * A device that has just been stood in a space takes the thresholds the
   * place is watched by: the stage the bands of the devices already there come
   * from, or where none has any, the phase of the plants standing there longest -
   * so that a controller claimed into a tent in flower is watched like the tent
   * is, and not by a stage recorded beside it. Where neither is, no climate was
   * written there, and the device drops the bands it brought: a fan claimed into
   * a new place had first been joined to a tent in flower, and watched an empty
   * drying tent for 60 %.
   */
  public async restateThresholds(deviceId: string, spaceId: string): Promise<void> {
    const others = await this.devices.find({ spaceId, id: { $ne: deviceId } }, { id: 1 }).lean<Pick<StoredDevice, 'id'>[]>();
    const watched = others.length > 0 ? await this.alarms?.stageOf(others.map(device => device.id)) : null;
    if (watched) return this.applyStageTo(deviceId, watched);

    const grow = await this.standingGrow<GrowDocument>(spaceId, undefined, 1);
    const standing = grow ? phaseStandingIn(grow, spaceId) : null;
    if (standing) return this.applyStageTo(deviceId, standing);

    try {
      await this.alarms?.dropStage(deviceId);
    } catch (error) {
      logger.error(`Could not take the stage thresholds off device ${deviceId}: ${error}`);
    }
  }

  /** The thresholds are the alarm engine's, and a device that could not be told must not undo the phase the grow is in. */
  private async applyStageTo(deviceId: string, { stage, preset }: Pick<PhaseDocument, 'stage' | 'preset'>): Promise<void> {
    try {
      await this.alarms?.applyStage(deviceId, stage, preset);
    } catch (error) {
      logger.error(`Could not re-read the stage thresholds of device ${deviceId}: ${error}`);
    }
  }

  /**
   * What is growing in a place right now, as an id and nothing more: the grow
   * whose placement there is still open, the one begun last where two stand.
   * Null when there is none - a controller merely being on invents no grow.
   */
  public async growIdIn(spaceId: string | null): Promise<string | null> {
    if (!spaceId) return null;

    const grow = await this.standingGrow<Pick<GrowDocument, 'id'>>(spaceId, { id: 1 });
    return grow?.id ?? null;
  }

  /** Whether the grow - or the plants named - stand in this phase already, which putting them there again does not begin. */
  public async standsInPhase(growId: string, stage: GrowthStage, preset: string | null, plantIds: string[] | null): Promise<boolean> {
    const grow = await this.grows.findOne({ id: growId }).lean<GrowDocument>().exec();
    const standing = grow ? currentPhase(grow, plantIds) : null;
    return standing !== null && standing.stage === stage && standing.preset === preset;
  }

  /** Whether this grow stands in the space now: its placement there is open and it has not ended. */
  public async standsIn(growId: string, spaceId: string | null): Promise<boolean> {
    return spaceId !== null && (await this.grows.exists({ id: growId, ...standingIn(spaceId) }).exec()) !== null;
  }

  /**
   * The grow standing in a space: the one begun last, the id breaking a tie,
   * because two grows can share a tent while one is on its way out - or with
   * `order` 1 the one begun first.
   */
  private standingGrow<T>(spaceId: string, projection?: ProjectionType<GrowDocument>, order: 1 | -1 = -1): Promise<T | null> {
    return this.grows.findOne(standingIn(spaceId), projection).sort({ startedAt: order, id: order }).lean<T>().exec();
  }

  /** The phase a grow already stands in with this stage and preset, for a request that appended none. */
  public async standingPhase(growId: string, stage: GrowthStage, preset: string | null): Promise<PhaseDocument | null> {
    const grow = await this.grows.findOne({ id: growId }, { phases: 1 }).lean<Pick<GrowDocument, 'phases'>>().exec();
    return latestPhase((grow?.phases ?? []).filter(phase => phase.stage === stage && phase.preset === preset));
  }
}

/** The work mode a stage puts a device into with its climate, for the two stages that have one of their own. */
const MODE_OF_STAGE: Partial<Record<GrowthStage, string>> = { germination: 'breed', drying: 'dry' };

const byDate = (one: PhaseDocument, other: PhaseDocument): number => one.startedAt.getTime() - other.startedAt.getTime();

const earliestOf = (phases: PhaseDocument[]): Date | null =>
  phases.reduce<Date | null>((first, phase) => (first && first <= phase.startedAt ? first : phase.startedAt), null);

/**
 * Where the grow's start goes when its first phase is corrected or withdrawn.
 *
 * Every day of a grow is counted from one origin - its start or its earliest
 * phase, whichever came first - and a grow made on the new-grow sheet has both
 * on the same instant. Moving that first phase two days later, or taking back a
 * germination entered by mistake, would otherwise leave the start behind where
 * the mistake put it, and the day counter would go on counting from it. So a
 * start that stood on the first phase moves with it. A start that was earlier
 * than every phase - a grow written down first and put into a stage days later -
 * is a start of its own and stays; a grow left with no phase keeps it too.
 */
const startCarriedBy = (grow: Pick<GrowDocument, 'phases' | 'startedAt'>, phases: PhaseDocument[]): Date | null => {
  const before = earliestOf(grow.phases);
  const after = earliestOf(phases);
  if (!before || !after || before.getTime() !== grow.startedAt.getTime()) return null;

  return after.getTime() === before.getTime() ? null : after;
};

/** Where the plants a phase is about stand now: the latest phase written over the same scope. */
const currentPhase = (grow: GrowDocument, plantIds: string[] | null): PhaseDocument | null =>
  latestPhase(grow.phases.filter(phase => sameScope(phase.plantIds, plantIds)));

/** Whether two scopes share a plant. Null is every plant of the grow, so it overlaps anything. */
const overlap = (one: string[] | null, other: string[] | null): boolean =>
  one === null || other === null || one.some(plantId => other.includes(plantId));

/** The spaces the plants of a scope stand in now: `spacesNow` of the placements that cover one of them, each once. */
const spacesOf = (grow: GrowDocument, plantIds: string[] | null): string[] => [
  ...new Set(spacesNow({ placements: grow.placements.filter(placement => overlap(placement.plantIds, plantIds)) })),
];

/** The phase the plants standing in a space are in: the latest one written over any of them. */
const phaseStandingIn = (grow: GrowDocument, spaceId: string): PhaseDocument | null => {
  const placed = grow.placements.filter(placement => placement.endedAt === null && placement.spaceId === spaceId);
  return latestPhase(grow.phases.filter(phase => placed.some(placement => overlap(placement.plantIds, phase.plantIds))));
};

const sameScope = (one: string[] | null, other: string[] | null): boolean => {
  if (one === null || other === null) return one === other;
  if (one.length !== other.length) return false;

  const sorted = [...other].sort();
  return [...one].sort().every((id, index) => id === sorted[index]);
};
