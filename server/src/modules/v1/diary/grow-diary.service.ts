import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { z } from 'zod';
import type { GrowDayEvent, GrowDiaryDay, GrowDiaryPage, GrowDiaryWeek } from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf, growWeekOfDay } from '@fg2/shared-types/v1-schemas';
import { AccessRange, Grant, isOutsider } from '@common/v1/access.types';
import { pageOf } from '@common/v1/pages';
import { peopleNamed } from '@common/v1/people';
import { Span, clampRange, overlapsRange, seenOf } from '@common/v1/range';
import { pageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { spacesDuring } from '../grow/grow-places';
import { Redaction } from '../grow/grow-serialiser';
import { GrowsService } from '../grow/grows.service';
import { DayDevice, dayClimateOf } from './day-climate';
import { DIARY_KINDS, TOLD_OF_MACHINES, serialiseDiaryEntry, toldOf, writtenFor } from './diary-entries';
import { DayStill, WeekFilm, stillsOfDays, weekFilmsOf } from './diary-pictures';
import { DiaryDay, DiaryWeek, dateStartOf, diaryWeeksOf, headlinePhaseAt, horizonOf, middayOf, weeksAfter } from './grow-calendar';
import { GrowClimateService } from './grow-climate.service';

/**
 * A grow's diary as it writes itself: a card per day, a week of them at a time.
 *
 * Nothing of a day is stored. Its picture is the cameras', its climate and
 * what the devices did are read from the measurement store, and its lines are
 * the entries dated to it - so a day reads the same whether or not anybody
 * typed anything, and a correction of the record corrects the diary.
 *
 * **What a page costs.** Once: the grow and its owner, the grow's lines and
 * the plan's over the page, the cameras and the controllers where it stood,
 * the week films, each controller's target record and the people named. Per
 * week and controller one history read of the store, and per page one read of
 * the stills around every day's midday plus two per day that had none there.
 * The weeks' reads run side by side.
 */

/** A page is what a phone shows before somebody asks for more: the days of this week and the two before it. */
const DEFAULT_WEEKS = 3;
const MAX_WEEKS = 12;

export const diaryQuery = pageQuery.extend({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `How many weeks one read answers: ${DEFAULT_WEEKS} when left out, and ${MAX_WEEKS} when more than that is asked for - each week is a read of every controller that stood with the grow.`,
    ),
});

/** A safety net, not a page size: a runaway alarm or a device restarting in a loop must not become a read of everything. */
const MAX_ENTRIES_PER_PAGE = 2000;

/** How many lines from before the grow began the last page carries. They are a slip of the date, not a diary of their own. */
const MAX_EARLIER = 200;

/** A film this short is the first frames of a week that has only begun: nothing to watch yet. */
const SHORTEST_FILM_SECONDS = 2;

/** What a controller recorded over a week, and the place it stands in. */
type PlacedDevice = DayDevice & { spaceId: string | null };

/** Everything the days of a page are built from that was read once for all of them. */
interface PageWorld {
  grow: GrowDocument;
  grant: Grant;
  hide: Redaction;
  range: AccessRange;
  origin: Date;
  horizon: Date;
  zone: string | null;
  lines: EntryDocument[];
  /** When the devices of the place were in maintenance; none for a reader from outside. */
  maintenance: Span[];
  stills: Map<number, DayStill>;
  films: WeekFilm[];
}

@Injectable()
export class GrowDiaryService {
  constructor(
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly grows: GrowsService,
    private readonly climate: GrowClimateService,
  ) {}

  public async page(growId: string, grant: Grant, query: z.infer<typeof diaryQuery>, now: Date = new Date()): Promise<GrowDiaryPage> {
    const grow = await this.grows.require(growId);
    const zone = await this.grows.zoneOf(grow);
    const origin = growOriginOf(grow);
    const horizon = horizonOf(grow, now);
    const range = clampRange(grant);

    // Newest first, which is the order a diary is read in.
    const lived = diaryWeeksOf(origin, horizon, zone).filter(week => overlapsRange(range, week.startsAt, week.endsAt));
    const page = pageOf(weeksAfter(lived.reverse(), query.cursor), limitOf(query.limit), week => ({
      at: week.startsAt,
      id: String(week.weekNumber),
    }));
    if (page.items.length === 0) return { items: [], nextCursor: null, people: [], earlier: [] };

    // What the reader may see of the page, and of that what the grow lived
    // through: the first date begins at midnight and the grow some hours later.
    const seen = seenOf({ startsAt: page.items[page.items.length - 1].startsAt, endsAt: laterOf(page.items[0].endsAt, horizon, false) }, range);
    const life = { startsAt: laterOf(seen.startsAt, origin, true), endsAt: seen.endsAt };
    const spaceIds = spacesDuring(grow, life.startsAt, life.endsAt);
    const named = spaceIds.filter((id): id is string => id !== null);
    // A link that was not made to carry pictures is not told that a camera exists either.
    const cameraIds = grant.includeCameras && named.length > 0 ? await this.camerasIn(named) : [];
    const days = page.items.flatMap(week => week.days.map(day => ({ day, life: lifeOf(day, life) })).filter(one => one.life !== null));

    const [hide, { lines, maintenance }, earlier, controllers, films, stills] = await Promise.all([
      this.grows.redaction(grant),
      this.linesIn(grow, grant, seen, isOutsider(grant) ? [] : named),
      // What was dated to before the grow began has no day, and stands after the last of them.
      page.nextCursor === null ? this.earlierThan(grow, grant, dateStartOf(origin, zone), range) : Promise.resolve([]),
      this.climate.controllersIn(spaceIds),
      weekFilmsOf(this.media, cameraIds, seen, range),
      stillsOfDays(
        this.media,
        cameraIds,
        days.map(({ day, life: lived }) => ({ key: day.dayNumber, ...lived!, ...pictureOf(day, lived!, horizon, grow) })),
        life,
      ),
    ]);
    // One read of the store per week of the page, each over the part of the week the grow lived and the reader may see.
    const stretches = page.items.map(week => lifeOf(week, life));
    const recorded = await this.climate.recorded(
      controllers,
      stretches.filter((stretch): stretch is Span => stretch !== null),
    );
    const recordedOf = new Map(
      page.items.filter((_week, index) => stretches[index] !== null).map((week, index) => [week.weekNumber, recorded[index]] as const),
    );

    const world: PageWorld = { grow, grant, hide, range, origin, horizon, zone, lines, maintenance, stills, films };
    const weeks = page.items.map(week =>
      this.weekOf(
        week,
        world,
        (recordedOf.get(week.weekNumber) ?? []).map((device, index) => ({ ...device, spaceId: controllers[index].spaceId })),
      ),
    );

    const before = earlier.map(entry => serialiseDiaryEntry(entry, hide, grant));
    const people = await peopleNamed(this.users, [
      ...weeks.flatMap(week => week.days.flatMap(day => day.entries.map(entry => entry.authorId))),
      ...before.map(entry => entry.authorId),
    ]);

    return { items: weeks, nextCursor: page.nextCursor, people, earlier: before };
  }

  private weekOf(week: DiaryWeek, world: PageWorld, devices: PlacedDevice[]): GrowDiaryWeek {
    const { grow, origin, horizon, zone } = world;
    // A week that is over is named after the stage standing at its middle,
    // the week still running after the stage the grow is in now.
    const over = week.endsAt <= horizon;
    const phase = headlinePhaseAt(grow, over ? new Date((week.startsAt.getTime() + week.endsAt.getTime()) / 2) : new Date(horizon.getTime() - 1));
    // A film is cut on the calendar's weeks, which are not the grow's: it is this week's where most of it lies here,
    // which is where its middle does.
    const film =
      world.films.find(one => (one.lengthSeconds ?? SHORTEST_FILM_SECONDS) >= SHORTEST_FILM_SECONDS && within(week, middleOf(one, horizon))) ?? null;
    const last = week.days[week.days.length - 1]?.dayNumber ?? week.dayFrom;

    return {
      weekNumber: week.weekNumber,
      dayFrom: week.dayFrom,
      dayTo: week.dayTo,
      stage: phase?.stage ?? null,
      preset: phase?.preset ?? null,
      stageWeek: phase ? Math.max(1, week.weekNumber - growWeekOfDay(growDayAt(origin, phase.startedAt, zone)) + 1) : null,
      film: film
        ? {
            mediaId: film.id,
            // Named by those of its days that are this week's.
            dayFrom: Math.max(week.dayFrom, growDayAt(origin, film.capturedAt, zone)),
            // A film's end is the first instant after its span, and no later than the grow has lived.
            dayTo: Math.min(last, growDayAt(origin, new Date(endOf(film, horizon).getTime() - 1), zone)),
            lengthSeconds: film.lengthSeconds ?? null,
          }
        : null,
      days: [...week.days].reverse().flatMap(day => this.dayOf(day, world, devices) ?? []),
    };
  }

  private dayOf(day: DiaryDay, world: PageWorld, devices: PlacedDevice[]): GrowDiaryDay | null {
    const seen = lifeOf(day, seenOf({ startsAt: day.startsAt, endsAt: laterOf(day.endsAt, world.horizon, false) }, world.range));
    if (!seen) return null;

    // The day's lines are filed by the date; its climate and its picture are of the hours the grow lived.
    const life = lifeOf(seen, { startsAt: world.origin, endsAt: world.horizon });
    const still = world.stills.get(day.dayNumber) ?? null;
    // Only the controllers standing where the grow stood that day speak for it.
    const here = life ? spacesDuring(world.grow, life.startsAt, life.endsAt) : [];
    const { climate, events } = life
      ? dayClimateOf(
          devices.filter(device => here.includes(device.spaceId)),
          life,
          world.grow.endedAt === null && day.endsAt > world.horizon,
        )
      : { climate: null, events: [] };
    // What the devices did, and how well they kept to their targets, is for the people who keep the place: a page
    // anybody may open says how the day was and what was done to the plants.
    const outsider = isOutsider(world.grant);
    const switched: GrowDayEvent[] = world.maintenance.flatMap(run => {
      const part = lifeOf(run, seen);
      return part
        ? [{ kind: 'maintenance' as const, at: part.startsAt.toISOString(), endedAt: run.endsAt > part.endsAt ? null : part.endsAt.toISOString() }]
        : [];
    });

    return {
      date: day.date,
      dayNumber: day.dayNumber,
      startsAt: seen.startsAt.toISOString(),
      endsAt: seen.endsAt.toISOString(),
      still: still?.cameraId ? { mediaId: still.id, cameraId: still.cameraId, capturedAt: still.capturedAt.toISOString() } : null,
      climate: climate && outsider ? { ...climate, inBandFraction: null } : climate,
      events: outsider ? [] : [...events, ...switched].sort((one, other) => one.at.localeCompare(other.at)),
      entries: world.lines
        .filter(entry => entry.occurredAt >= seen.startsAt && entry.occurredAt < seen.endsAt)
        .map(entry => serialiseDiaryEntry(entry, world.hide, world.grant)),
    };
  }

  /**
   * The lines of the page, newest first: the grow's own diary - what people
   * wrote and the alarms raised where it stood, which name the grow - and the
   * plan's steps there. A plan's line names its place and not always a grow,
   * so it is found by the place and kept by the placement; one about another
   * grow sharing the tent is that grow's. Beside them the lines that say
   * maintenance went on and off, which are told as stretches and not as lines.
   */
  private async linesIn(grow: GrowDocument, grant: Grant, span: Span, spaceIds: string[]): Promise<{ lines: EntryDocument[]; maintenance: Span[] }> {
    const during = { occurredAt: { $gte: span.startsAt, $lt: span.endsAt } };
    const [diary, machines] = await Promise.all([
      this.entries
        .find({ growId: grow.id, kind: { $in: DIARY_KINDS }, ...during, ...writtenFor(grant) })
        .sort({ occurredAt: -1, id: -1 })
        .limit(MAX_ENTRIES_PER_PAGE)
        .lean<EntryDocument[]>(),
      spaceIds.length === 0
        ? Promise.resolve([])
        : this.entries
            .find({
              $and: [{ spaceId: { $in: spaceIds }, growId: { $in: [null, grow.id] }, ...during }, TOLD_OF_MACHINES],
            })
            .sort({ occurredAt: -1, id: -1 })
            .limit(MAX_ENTRIES_PER_PAGE)
            .lean<EntryDocument[]>(),
    ]);
    const there = machines.filter(entry =>
      grow.placements.some(
        placement =>
          placement.spaceId === entry.spaceId &&
          placement.startedAt <= entry.occurredAt &&
          (placement.endedAt === null || placement.endedAt > entry.occurredAt),
      ),
    );

    return toldOf([...diary, ...there]);
  }

  /** What was written to the grow for a moment before the date it began on, newest first, inside the reader's window. */
  private earlierThan(grow: GrowDocument, grant: Grant, firstDate: Date, range: AccessRange): Promise<EntryDocument[]> {
    if (range.endsAt && range.endsAt <= (range.startsAt ?? firstDate)) return Promise.resolve([]);

    return this.entries
      .find({
        growId: grow.id,
        kind: { $in: DIARY_KINDS },
        ...writtenFor(grant),
        occurredAt: { $lt: range.endsAt && range.endsAt < firstDate ? range.endsAt : firstDate, ...(range.startsAt ? { $gte: range.startsAt } : {}) },
      })
      .sort({ occurredAt: -1, id: -1 })
      .limit(MAX_EARLIER)
      .lean<EntryDocument[]>();
  }

  /** A removed camera is included: it is a tombstone and its pictures keep their link. */
  private async camerasIn(spaceIds: string[]): Promise<string[]> {
    const rows = await this.cameras.find({ spaceId: { $in: spaceIds } }, { id: 1 }).lean<Pick<CameraDocument, 'id'>[]>();
    return rows.map(camera => camera.id);
  }
}

/** The later of two instants, or with `later` false the earlier. */
const laterOf = (one: Date, other: Date, later: boolean): Date => (one > other === later ? one : other);

/** The part of a stretch inside another, or nothing where they do not meet. */
const lifeOf = (stretch: Span, within: Span): Span | null => {
  const startsAt = laterOf(stretch.startsAt, within.startsAt, true);
  const endsAt = laterOf(stretch.endsAt, within.endsAt, false);
  return endsAt > startsAt ? { startsAt, endsAt } : null;
};

/**
 * Which picture stands for a day: the one taken nearest midday - and for the
 * day still running the newest taken in the light, which is what is growing
 * there now. Until its lamp has come on that day has no picture yet.
 */
const pictureOf = (day: DiaryDay, lived: Span, horizon: Date, grow: GrowDocument): { nearest: Date; darkToo: boolean } => {
  const running = grow.endedAt === null && day.endsAt > horizon;
  const midday = middayOf(day);
  return { nearest: running || midday > lived.endsAt ? lived.endsAt : midday, darkToo: !running };
};

/** Where a film ends: the first instant after its span, and no later than the grow has lived. */
const endOf = (film: WeekFilm, horizon: Date): Date => laterOf(film.endsAt ?? film.capturedAt, horizon, false);

const middleOf = (film: WeekFilm, horizon: Date): Date => new Date((film.capturedAt.getTime() + endOf(film, horizon).getTime()) / 2);

const within = (span: Span, at: Date): boolean => at >= span.startsAt && at < span.endsAt;

const limitOf = (limit?: number): number => (!limit || limit < 1 ? DEFAULT_WEEKS : Math.min(Math.trunc(limit), MAX_WEEKS));
