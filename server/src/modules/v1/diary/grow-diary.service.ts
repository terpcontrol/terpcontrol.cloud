import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { z } from 'zod';
import type { GrowDiaryDay, GrowDiaryPage, GrowDiaryWeek } from '@fg2/shared-types/v1';
import { growOriginOf, growWeekOfDay } from '@fg2/shared-types/v1-schemas';
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
import { DiaryDay, DiaryWeek, diaryDayAt, diaryWeeksOf } from './diary-calendar';
import { DIARY_KINDS, serialiseDiaryEntry } from './diary-entries';
import { DayStill, WeekFilm, stillsOfDays, weekFilmsOf } from './diary-pictures';
import { headlinePhaseAt, horizonOf, pictureHourIn, weeksAfter } from './grow-calendar';
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
 * the machines' over the page, the cameras and the controllers where it stood,
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

/**
 * What a device says about itself that is also something that happened to the
 * grow: it lost power, its CO2 ran low, a sensor failed, somebody opened the
 * tent or changed what it aims at, a socket it switches could not be reached.
 * Everything else a device logs - firmware, its connection, the camera's own
 * plumbing - is the place's record and stays in Verlauf.
 */
const DEVICE_LINES_OF_A_GROW = [
  'message-device-booted',
  'message-co2-low',
  'message-ext-sensor-fail',
  'message-ext-sensor-deviate',
  'message-maintenance-mode-activated',
  'message-maintenance-mode-activated-remote',
  'message-device-configuration-updated',
  'message-smart-socket-address-lost',
  'message-smart-socket-cmd-failed',
];

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
    const owner = await this.users.findOne({ id: grow.ownerId }, { preferences: 1 }).lean<Pick<StoredUser, 'preferences'> | null>();
    const zone = owner?.preferences?.timezone ?? null;
    const origin = growOriginOf(grow);
    const horizon = horizonOf(grow, now);
    const range = clampRange(grant);

    // Newest first, which is the order a diary is read in.
    const lived = diaryWeeksOf(origin, horizon, zone).filter(week => overlapsRange(range, week.startsAt, week.endsAt));
    const page = pageOf(weeksAfter(lived.reverse(), query.cursor), limitOf(query.limit), week => ({
      at: week.startsAt,
      id: String(week.weekNumber),
    }));
    if (page.items.length === 0) return { items: [], nextCursor: null, people: [] };

    // What the reader may see of the page, and of that what the grow lived
    // through: the first date begins at midnight and the grow some hours later.
    const seen = seenOf({ startsAt: page.items[page.items.length - 1].startsAt, endsAt: laterOf(page.items[0].endsAt, horizon, false) }, range);
    const life = { startsAt: laterOf(seen.startsAt, origin, true), endsAt: seen.endsAt };
    const spaceIds = spacesDuring(grow, life.startsAt, life.endsAt);
    const named = spaceIds.filter((id): id is string => id !== null);
    // A link that was not made to carry pictures is not told that a camera exists either.
    const cameraIds = grant.includeCameras && named.length > 0 ? await this.camerasIn(named) : [];
    const days = page.items.flatMap(week => week.days.map(day => ({ day, life: lifeOf(day, life) })).filter(one => one.life !== null));

    const [hide, lines, controllers, films, stills] = await Promise.all([
      this.grows.redaction(grant),
      this.linesIn(grow, seen, isOutsider(grant) ? [] : named),
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

    const world: PageWorld = { grow, grant, hide, range, origin, horizon, zone, lines, stills, films };
    const weeks = page.items.map(week =>
      this.weekOf(
        week,
        world,
        (recordedOf.get(week.weekNumber) ?? []).map((device, index) => ({ ...device, spaceId: controllers[index].spaceId })),
      ),
    );

    const people = await peopleNamed(
      this.users,
      weeks.flatMap(week => week.days.flatMap(day => day.entries.map(entry => entry.authorId))),
    );

    return { items: weeks, nextCursor: page.nextCursor, people };
  }

  private weekOf(week: DiaryWeek, world: PageWorld, devices: PlacedDevice[]): GrowDiaryWeek {
    const { grow, origin, horizon, zone } = world;
    // A week that is over is named after the stage standing at its middle,
    // the week still running after the stage the grow is in now.
    const over = week.endsAt <= horizon;
    const phase = headlinePhaseAt(grow, over ? new Date((week.startsAt.getTime() + week.endsAt.getTime()) / 2) : new Date(horizon.getTime() - 1));
    const film = world.films.find(one => one.capturedAt >= week.startsAt && one.capturedAt < week.endsAt) ?? null;

    return {
      weekNumber: week.weekNumber,
      dayFrom: week.dayFrom,
      dayTo: week.dayTo,
      stage: phase?.stage ?? null,
      preset: phase?.preset ?? null,
      stageWeek: phase ? Math.max(1, week.weekNumber - growWeekOfDay(diaryDayAt(origin, phase.startedAt, zone)) + 1) : null,
      film: film
        ? {
            mediaId: film.id,
            dayFrom: diaryDayAt(origin, film.capturedAt, zone),
            // A film's end is the first instant after its span, and no later than the grow has lived.
            dayTo: diaryDayAt(origin, new Date(Math.min((film.endsAt ?? film.capturedAt).getTime(), horizon.getTime()) - 1), zone),
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
        )
      : { climate: null, events: [] };

    return {
      date: day.date,
      dayNumber: day.dayNumber,
      startsAt: seen.startsAt.toISOString(),
      endsAt: seen.endsAt.toISOString(),
      still: still?.cameraId ? { mediaId: still.id, cameraId: still.cameraId, capturedAt: still.capturedAt.toISOString() } : null,
      climate,
      events,
      entries: world.lines
        .filter(entry => entry.occurredAt >= seen.startsAt && entry.occurredAt < seen.endsAt)
        .map(entry => serialiseDiaryEntry(entry, world.hide, world.grant)),
    };
  }

  /**
   * The lines of the page, newest first: the grow's own diary, and what the
   * devices and the plan wrote in the places it stood while it stood there. A
   * machine's line names its place and no grow, so it is found by the place
   * and kept by the placement; the plan's lines about another grow sharing
   * the tent are that grow's.
   */
  private async linesIn(grow: GrowDocument, span: Span, spaceIds: string[]): Promise<EntryDocument[]> {
    const during = { occurredAt: { $gte: span.startsAt, $lt: span.endsAt } };
    const [diary, machines] = await Promise.all([
      this.entries
        .find({ growId: grow.id, kind: { $in: DIARY_KINDS }, ...during })
        .sort({ occurredAt: -1, id: -1 })
        .limit(MAX_ENTRIES_PER_PAGE)
        .lean<EntryDocument[]>(),
      spaceIds.length === 0
        ? Promise.resolve([])
        : this.entries
            .find({
              $and: [
                { spaceId: { $in: spaceIds }, growId: { $in: [null, grow.id] }, ...during },
                { $or: [{ kind: 'plan' }, { kind: 'system', 'message.key': { $in: DEVICE_LINES_OF_A_GROW } }] },
              ],
            })
            .sort({ occurredAt: -1, id: -1 })
            .limit(MAX_ENTRIES_PER_PAGE)
            .lean<EntryDocument[]>(),
    ]);
    const stoodThere = (entry: EntryDocument): boolean =>
      grow.placements.some(
        placement =>
          placement.spaceId === entry.spaceId &&
          placement.startedAt <= entry.occurredAt &&
          (placement.endedAt === null || placement.endedAt > entry.occurredAt),
      );

    return [...diary, ...machines.filter(stoodThere)].sort(
      (one, other) => other.occurredAt.getTime() - one.occurredAt.getTime() || other.id.localeCompare(one.id),
    );
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
  const midday = pictureHourIn(day.startsAt);
  return { nearest: running || midday > lived.endsAt ? lived.endsAt : midday, darkToo: !running };
};

const limitOf = (limit?: number): number => (!limit || limit < 1 ? DEFAULT_WEEKS : Math.min(Math.trunc(limit), MAX_WEEKS));
