import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { EntryKind, GrowHarvest, GrowReport, GrowReportPhase, GrowTotals } from '@fg2/shared-types/v1';
import { type StageSpan, stageSpansOf } from '@fg2/shared-types/v1-schemas';
import { AccessRange, Grant } from '@common/v1/access.types';
import { clampRange, overlapsRange, withinRange } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { Redaction } from '../grow/grow-serialiser';
import { GrowsService } from '../grow/grows.service';
import { DIARY_KINDS, authorIdsOf, peopleOf, serialiseDiaryEntry } from './diary-entries';
import { dayNumberOf, horizonOf, originOf } from './grow-calendar';
import { GrowClimateService } from './grow-climate.service';
import { spacesDuring } from './grow-places';

/**
 * The Report tab: the grow told as chapters, one per phase.
 *
 * A chapter is a stretch of the grow at one stage, with the picture that stands
 * for it, how the tent was kept during it, how much of it was on target and
 * what was done to the plants. It is the same story the public page tells, one
 * level above the week cards.
 *
 * **What it costs.** One read of the grow and its plants, one of the diary that
 * the chapters count, one aggregate for the totals, one of the cameras and one
 * of the people it names. Then per chapter: one time-series read per controller
 * and one Mongo read for its cover. A grow with five phases in a tent with one
 * controller is therefore five Mongo reads and ten more - far less than the
 * week cards, because a phase is weeks long and is read as one window. That is
 * also why the report carries no week cards: the Weeks tab reads those, and a
 * report that repeated them would make opening the second tab cost the first
 * one twice over.
 */

/** The kinds a chapter counts and the totals are of: what a person did, not what a device reported. */
const CHAPTER_KINDS = DIARY_KINDS;

/** How far from the middle of a chapter its cover may have been taken. A phase is weeks long; half a day of slack is nothing. */
const COVER_WINDOW_MS = 12 * 60 * 60 * 1000;

/** A safety net. A grow's human diary is hundreds of lines, not hundreds of thousands. */
const MAX_ENTRIES = 5000;

/** One stretch of the grow at one stage, before it is answered: the shared span with its phase. */
type Chapter = StageSpan<GrowDocument['phases'][number]>;

@Injectable()
export class GrowReportService {
  constructor(
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly grows: GrowsService,
    private readonly climate: GrowClimateService,
  ) {}

  public async read(growId: string, grant: Grant, now: Date = new Date()): Promise<GrowReport> {
    const grow = await this.grows.require(growId);
    const origin = originOf(grow);
    const horizon = horizonOf(grow, now);
    const range = clampRange(grant);

    const [hide, plants, diary, totals] = await Promise.all([
      this.grows.redaction(grant),
      this.grows.plantsOf(growId),
      this.diaryOf(growId, grant),
      this.totalsOf(growId, grant),
    ]);

    const chapters = stageSpansOf(grow, horizon).filter(chapter => overlapsRange(range, chapter.startsAt, chapter.endsAt ?? horizon));
    const told = await Promise.all(chapters.map(chapter => this.chapterOf(chapter, { grow, hide, grant, range, horizon, diary })));

    const named = told.flatMap(chapter => chapter.training);
    const rows = await this.users.find({ id: { $in: authorIdsOf(named) } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();

    return {
      growId: grow.id,
      name: grow.name,
      description: grow.description,
      type: grow.type,
      startedAt: grow.startedAt.toISOString(),
      endedAt: grow.endedAt?.toISOString() ?? null,
      dayCount: dayNumberOf(origin, horizon),
      plantCount: hide.counts ? null : plants.length,
      strains: [...new Set(plants.map(plant => plant.strain))],
      coverMediaId: grow.coverMediaId,
      filmMediaId: grow.filmMediaId,
      // Newest first, which is the order the chapters are read in.
      phases: told.reverse(),
      harvest: harvestOf(plants, hide),
      totals,
      people: peopleOf(named, rows),
    };
  }

  private async chapterOf(chapter: Chapter, world: ReportWorld): Promise<GrowReportPhase> {
    const { grow, horizon } = world;
    const endsAt = chapter.endsAt ?? horizon;
    const spaceIds = spacesDuring(grow, chapter.startsAt, endsAt);
    const entries = world.diary.filter(entry => entry.occurredAt >= chapter.startsAt && entry.occurredAt < endsAt);

    const controllers = await this.climate.controllersIn(spaceIds);
    const [climate, coverMediaId] = await Promise.all([
      // The phase's own snapshot is the band: the store holds readings and never
      // setpoints, so a phase that is over has nothing else to be judged against.
      this.climate.summarise(
        controllers.map(controller => controller.deviceId),
        { startsAt: chapter.startsAt, endsAt },
        chapter.phase.targets ?? controllers[0]?.targets ?? null,
      ),
      this.coverOf(spaceIds, new Date((chapter.startsAt.getTime() + endsAt.getTime()) / 2), world.grant, world.range),
    ]);

    const counted = (kind: EntryKind): number => entries.filter(entry => entry.kind === kind).length;

    return {
      phaseId: chapter.phase.id,
      stage: chapter.phase.stage,
      preset: chapter.phase.preset,
      startedAt: chapter.startsAt.toISOString(),
      endedAt: chapter.endsAt?.toISOString() ?? null,
      dayFrom: chapter.dayFrom,
      // The day before the next chapter's first, so the chapters are a partition
      // of the grow and add up to the day count above them. Null while the phase
      // is the one the grow is in, which is what "\u2192 today" says.
      dayTo: chapter.endsAt ? chapter.dayTo : null,
      dayCount: chapter.dayCount,
      // A chapter tells where the plants stood only to somebody who keeps them:
      // a public diary is a story, and the spaces it names are addresses in
      // somebody's flat that tie it to the rest of their account.
      spaceIds: world.grant.redacted ? null : spaceIds.filter((id): id is string => id !== null),
      coverMediaId,
      climate: climate.climate,
      inBandPercent: climate.inBandPercent,
      waterCount: counted('water'),
      feedCount: counted('feed'),
      // Oldest first, like the diary this was read from: "topped d18 · LST d20"
      // is the order it happened in.
      training: entries.filter(entry => entry.kind === 'training').map(entry => serialiseDiaryEntry(entry, world.hide, world.grant.includeCameras)),
    };
  }

  /**
   * The still nearest the middle of a chapter, which is the picture it is told
   * under.
   *
   * A link that was not made to carry pictures gets none, and is not told that a
   * camera hangs in the tent either: a cover's id is a picture that exists and
   * the instant it was taken at. What is left is searched inside the window, so
   * a chapter that reaches past a link's end is covered by a picture from inside
   * it or by nothing.
   */
  private async coverOf(spaceIds: readonly (string | null)[], middle: Date, grant: Grant, range: AccessRange): Promise<string | null> {
    if (!grant.includeCameras) return null;

    const named = spaceIds.filter((id): id is string => id !== null);
    if (named.length === 0) return null;

    // A camera that has since been removed is a tombstone and its pictures keep
    // their link, so a chapter that is over still has the cover it was taken with.
    const cameras = await this.cameras.find({ spaceId: { $in: named } }, { id: 1 }).lean<CameraDocument[]>();
    if (cameras.length === 0) return null;

    const searched = {
      startsAt: latestOf(new Date(middle.getTime() - COVER_WINDOW_MS), range.startsAt),
      endsAt: earliestOf(new Date(middle.getTime() + COVER_WINDOW_MS), range.endsAt),
    };
    if (searched.startsAt > searched.endsAt) return null;

    const stills = await this.media
      .find(
        {
          cameraId: { $in: cameras.map(camera => camera.id) },
          kind: 'still',
          capturedAt: { $gte: searched.startsAt, $lte: searched.endsAt },
        },
        { id: 1, capturedAt: 1 },
      )
      .lean<Pick<MediaDocument, 'id' | 'capturedAt'>[]>();

    return (
      stills.reduce<Pick<MediaDocument, 'id' | 'capturedAt'> | null>(
        (best, still) =>
          best === null || Math.abs(still.capturedAt.getTime() - middle.getTime()) < Math.abs(best.capturedAt.getTime() - middle.getTime())
            ? still
            : best,
        null,
      )?.id ?? null
    );
  }

  private diaryOf(growId: string, grant: Grant): Promise<EntryDocument[]> {
    return this.entries
      .find({ $and: [{ growId, kind: { $in: CHAPTER_KINDS } }, withinRange('occurredAt', clampRange(grant))] })
      .sort({ occurredAt: 1, id: 1 })
      .limit(MAX_ENTRIES)
      .lean<EntryDocument[]>();
  }

  /**
   * The four numbers above the chapters, counted in the database rather than
   * from the rows that were read. The public page states the same four, so it
   * asks for them here rather than counting a grow's diary a second way.
   *
   * The pictures are counted as pictures and not as entries of a kind. A photo
   * is something a line carries rather than something a line is - an entry of
   * any human kind may name pictures in `mediaIds`, a watering with a picture
   * of the runoff is a watering, and every diary that came from the old app
   * carries its pictures on notes - so counting rows of kind `photo` answered
   * zero over grows holding dozens. Counting them inside the same aggregate
   * keeps them inside the window and the kinds this already clamps to, so a
   * share link cannot be told about a picture from outside its own weeks.
   *
   * A line about a camera's own picture is left out where the reader was not
   * given the cameras, matching the covers and the stills the rest of the page
   * withholds from that reader.
   */
  public async totalsOf(growId: string, grant: Grant): Promise<GrowTotals> {
    const pictures = { $size: { $ifNull: ['$mediaIds', []] } };
    const rows = await this.entries.aggregate<{ _id: EntryKind; count: number; pictures: number }>([
      { $match: { $and: [{ growId, kind: { $in: CHAPTER_KINDS } }, withinRange('occurredAt', clampRange(grant))] } },
      {
        $group: {
          _id: '$kind',
          count: { $sum: 1 },
          pictures: { $sum: grant.includeCameras ? pictures : { $cond: [{ $eq: ['$cameraId', null] }, pictures, 0] } },
        },
      },
    ]);

    const of = (kind: EntryKind): number => rows.find(row => row._id === kind)?.count ?? 0;

    return {
      entryCount: rows.reduce((sum, row) => sum + row.count, 0),
      waterCount: of('water'),
      feedCount: of('feed'),
      photoCount: rows.reduce((sum, row) => sum + row.pictures, 0),
    };
  }
}

interface ReportWorld {
  grow: GrowDocument;
  hide: Redaction;
  grant: Grant;
  /** The window the chapters and everything they are built from are clamped to. */
  range: AccessRange;
  horizon: Date;
  diary: EntryDocument[];
}

const latestOf = (one: Date, other: Date | null): Date => (other && other > one ? other : one);
const earliestOf = (one: Date, other: Date | null): Date => (other && other < one ? other : one);

/**
 * One harvest for the whole grow: when the first plant came down, and what the
 * lot weighed. The report and the public page both state it, and a weight that
 * two places worked out separately is a weight one of them could state wrongly.
 */
export const harvestOf = (plants: readonly PlantDocument[], hide: Redaction): GrowHarvest | null => {
  const harvested = plants.flatMap(plant => (plant.harvest ? [plant.harvest] : []));
  if (harvested.length === 0) return null;

  const total = (weights: (number | null)[]): number | null =>
    weights.some(weight => weight !== null) ? weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0) : null;

  return {
    harvestedAt: new Date(Math.min(...harvested.map(one => one.harvestedAt.getTime()))).toISOString(),
    wetWeightG: hide.weights ? null : total(harvested.map(one => one.wetWeightG)),
    dryWeightG: hide.weights ? null : total(harvested.map(one => one.dryWeightG)),
  };
};
