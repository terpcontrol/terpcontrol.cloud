import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { EntryKind, GrowWeekCard, GrowWeekCardPage, GrowWeekDay, GrowWeekFeeding, GrowWeekReading, SchemeAmount } from '@fg2/shared-types/v1';
import { Grant } from '@common/v1/access.types';
import { decodeCursor, pageOf } from '@common/v1/pages';
import { clampRange, overlapsRange } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { Redaction } from '../grow/grow-serialiser';
import { GrowsService } from '../grow/grows.service';
import { DIARY_KINDS, READING_KINDS, authorIdsOf, peopleOf, serialiseDiaryEntry } from './diary-entries';
import { DAY_MS, GrowWeekSpan, dayNumberOf, horizonOf, originOf, pictureHourIn, weeksOf } from './grow-calendar';
import { GrowClimateService } from './grow-climate.service';
import { spacesDuring } from './grow-places';

/**
 * The week cards the grow page is made of.
 *
 * A week is not stored anywhere: it is seven of the grow's own days, and every
 * figure on the card is what the diary, the feeding scheme, the cameras and the
 * measurement store said during them. A card is therefore assembled per read -
 * and because that costs a time-series query per week per controller, a page is
 * a screenful and the client asks for the next one as somebody scrolls.
 *
 * **What a page costs.** Once per page: the grow, its diary over the page, its
 * recent readings, its reminders, its cameras, its controllers, the week films
 * and the people it names - eight Mongo reads. Once per week in the page: one
 * time-series read per controller and one Mongo read for the seven thumbnails.
 * A page of eight weeks of a tent with one controller is eight Mongo reads and
 * sixteen more, and the sixteen run together, so the page takes as long as its
 * slowest week rather than as long as all of them.
 *
 * A grow that ran half a year is four such pages. Nothing is cached: the newest
 * week changes every time a device reports, and a cache that had to be right
 * about that would be a cache of the whole grow.
 */

/** How many weeks a page holds. Each one costs a time-series read, so a page is a screenful rather than a year. */
const DEFAULT_WEEKS = 8;
const MAX_WEEKS = 26;

/** How many diary lines a card carries. The card draws two or three and says how many more there are. */
const ENTRIES_PER_WEEK = 10;

/**
 * How far from the middle of a day a still may be taken and still stand for that
 * day. Wide enough that a camera taking one picture an hour fills the strip,
 * narrow enough that reading a week of thumbnails is not reading a week of
 * pictures - stills are thinned as they age, so an older week answers a handful
 * of rows and only the newest answers many.
 */
const STILL_WINDOW_MS = 90 * 60 * 1000;

/** No screen has a control for how often a grow is fed, so the rhythm is read from its reminders. */
const FEEDS_PER_WEEK_WITHOUT_A_REMINDER = 3;

/** A safety net, not a page size: a week of human logging is a dozen lines, and a runaway alarm must not become a read of everything. */
const MAX_ENTRIES_PER_PAGE = 2000;

/** Far enough back that a measurement logged months ago still gives this week's reading something to have changed from. */
const READING_LOOKBACK = 500;

interface PageRequest {
  limit?: number;
  cursor?: string;
}

/** Everything a card is built from that was read once for the whole page. */
interface PageWorld {
  grow: GrowDocument;
  hide: Redaction;
  grant: Grant;
  origin: Date;
  plannedFeeds: number;
  diary: EntryDocument[];
  readings: EntryDocument[];
  cameraIds: string[];
  controllers: { deviceId: string; spaceId: string | null }[];
  films: Pick<MediaDocument, 'id' | 'capturedAt'>[];
}

@Injectable()
export class GrowWeeksService {
  constructor(
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly grows: GrowsService,
    private readonly climate: GrowClimateService,
  ) {}

  public async page(growId: string, grant: Grant, query: PageRequest, now: Date = new Date()): Promise<GrowWeekCardPage> {
    const grow = await this.grows.require(growId);
    const origin = originOf(grow);
    const range = clampRange(grant);

    // Newest first, which is the order the grow page reads in.
    const lived = weeksOf(origin, horizonOf(grow, now)).filter(week => overlapsRange(range, week.startsAt, week.endsAt));
    const page = pageOf(after(lived.reverse(), query.cursor), limitOf(query.limit), week => ({ at: week.startsAt, id: String(week.weekNumber) }));
    if (page.items.length === 0) return { items: [], nextCursor: null, people: [] };

    const span = { startsAt: page.items[page.items.length - 1].startsAt, endsAt: page.items[0].endsAt };
    const spaceIds = spacesDuring(grow, span.startsAt, span.endsAt);
    const cameras = await this.camerasIn(spaceIds);

    const [hide, diary, readings, controllers, plannedFeeds, films] = await Promise.all([
      this.grows.redaction(grant),
      this.diaryIn(grow.id, span),
      this.readingsBefore(grow.id, span.endsAt),
      this.climate.controllersIn(spaceIds),
      this.feedsPerWeek(grow.id),
      this.weekFilms(cameras, span),
    ]);

    const world: PageWorld = {
      grow,
      hide,
      grant,
      origin,
      plannedFeeds,
      diary,
      readings,
      cameraIds: cameras.map(camera => camera.id),
      controllers,
      films,
    };
    const cards = await Promise.all(page.items.map(week => this.cardOf(week, world)));

    const named = cards.flatMap(card => card.entries);
    const rows = await this.users.find({ id: { $in: authorIdsOf(named) } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();

    return { items: cards, nextCursor: page.nextCursor, people: peopleOf(named, rows) };
  }

  private async cardOf(week: GrowWeekSpan, world: PageWorld): Promise<GrowWeekCard> {
    const { grow, origin } = world;
    const here = spacesDuring(grow, week.startsAt, week.endsAt);
    const deviceIds = world.controllers.filter(controller => here.includes(controller.spaceId)).map(controller => controller.deviceId);
    const entries = world.diary.filter(entry => entry.occurredAt >= week.startsAt && entry.occurredAt < week.endsAt);
    // The last instant inside the week, not the first outside it: a phase that
    // begins exactly where the week ends belongs to the next week.
    const phase = headlinePhaseAt(grow, new Date(week.endsAt.getTime() - 1));

    const [climate, days] = await Promise.all([
      // A week card states how the tent was kept, not how well: judging it needs
      // a band, and the band belongs to the phase, which is what the report's
      // chapters are told against.
      this.climate.summarise(deviceIds, week, null),
      this.daysOf(week, world.cameraIds),
    ]);

    const counted = (kind: EntryKind): number => entries.filter(entry => entry.kind === kind).length;

    return {
      weekNumber: week.weekNumber,
      dayFrom: week.dayFrom,
      dayTo: week.dayTo,
      startsAt: week.startsAt.toISOString(),
      endsAt: week.endsAt.toISOString(),
      stage: phase?.stage ?? null,
      preset: phase?.preset ?? null,
      stageWeek: phase ? week.weekNumber - weekNumberOf(origin, phase.startedAt) + 1 : null,
      deviceIds,
      climate: climate.climate,
      lightHours: climate.lightHours,
      days,
      feeding: feedingOf(grow, week.weekNumber, world.plannedFeeds),
      readings: readingsOf(grow, world.readings, week),
      waterCount: counted('water'),
      feedCount: counted('feed'),
      entries: entries.slice(0, ENTRIES_PER_WEEK).map(entry => serialiseDiaryEntry(entry, world.hide, world.grant.includeCameras)),
      entryCount: entries.length,
      timelapseMediaId: filmOf(world.films, week),
    };
  }

  /**
   * The seven thumbnails: for each day of the week, the still taken nearest the
   * middle of it. One read per week rather than one per day, and only the
   * pictures around each of the seven hours rather than every picture the
   * cameras took.
   */
  private async daysOf(week: GrowWeekSpan, cameraIds: string[]): Promise<GrowWeekDay[]> {
    const days = Array.from({ length: week.dayTo - week.dayFrom + 1 }, (_, index) => {
      const startsAt = new Date(week.startsAt.getTime() + index * DAY_MS);
      return { dayNumber: week.dayFrom + index, startsAt, nearest: pictureHourIn(startsAt) };
    });

    const stills =
      cameraIds.length === 0
        ? []
        : await this.media
            .find(
              {
                $and: [
                  { cameraId: { $in: cameraIds }, kind: 'still' },
                  {
                    $or: days.map(day => ({
                      capturedAt: {
                        $gte: new Date(day.nearest.getTime() - STILL_WINDOW_MS),
                        $lte: new Date(day.nearest.getTime() + STILL_WINDOW_MS),
                      },
                    })),
                  },
                ],
              },
              { id: 1, cameraId: 1, capturedAt: 1 },
            )
            .lean<Pick<MediaDocument, 'id' | 'cameraId' | 'capturedAt'>[]>();

    return days.map(day => {
      const closest = nearestTo(stills, day.nearest);

      return {
        dayNumber: day.dayNumber,
        startsAt: day.startsAt.toISOString(),
        mediaId: closest?.id ?? null,
        cameraId: closest?.cameraId ?? null,
        capturedAt: closest?.capturedAt.toISOString() ?? null,
      };
    });
  }

  private diaryIn(growId: string, span: { startsAt: Date; endsAt: Date }): Promise<EntryDocument[]> {
    return this.entries
      .find({ growId, kind: { $in: DIARY_KINDS }, occurredAt: { $gte: span.startsAt, $lt: span.endsAt } })
      .sort({ occurredAt: -1, id: -1 })
      .limit(MAX_ENTRIES_PER_PAGE)
      .lean<EntryDocument[]>();
  }

  /** Every reading up to the end of the page, newest first: a week's change is against the newest one before it. */
  private readingsBefore(growId: string, endsAt: Date): Promise<EntryDocument[]> {
    return this.entries
      .find({ growId, kind: { $in: READING_KINDS }, occurredAt: { $lt: endsAt } })
      .sort({ occurredAt: -1, id: -1 })
      .limit(READING_LOOKBACK)
      .lean<EntryDocument[]>();
  }

  /**
   * A removed camera is included: it is a tombstone and its pictures keep their
   * link, so a week that is over keeps the thumbnails it was watched with.
   */
  private camerasIn(spaceIds: readonly (string | null)[]): Promise<CameraDocument[]> {
    const named = spaceIds.filter((id): id is string => id !== null);
    if (named.length === 0) return Promise.resolve([]);

    return this.cameras.find({ spaceId: { $in: named } }, { id: 1 }).lean<CameraDocument[]>();
  }

  /** The week films the timelapse builder has already made, so a card points at one rather than asking for it to be built. */
  private weekFilms(cameras: CameraDocument[], span: { startsAt: Date; endsAt: Date }): Promise<Pick<MediaDocument, 'id' | 'capturedAt'>[]> {
    if (cameras.length === 0) return Promise.resolve([]);

    return this.media
      .find(
        {
          cameraId: { $in: cameras.map(camera => camera.id) },
          kind: 'timelapse',
          window: 'week',
          capturedAt: { $gte: span.startsAt, $lt: span.endsAt },
        },
        { id: 1, capturedAt: 1 },
      )
      .lean<Pick<MediaDocument, 'id' | 'capturedAt'>[]>();
  }

  /**
   * How many feeds a week is supposed to have. No screen has a control for it,
   * so it is read from the grow's own rhythm: the feed reminder, else the water
   * reminder, else three.
   */
  private async feedsPerWeek(growId: string): Promise<number> {
    const rows = await this.reminders.find({ 'subject.type': 'grow', 'subject.id': growId }, { kind: 1, everyDays: 1 }).lean<ReminderDocument[]>();
    const rhythm = rows.find(row => row.kind === 'feed' && row.everyDays) ?? rows.find(row => row.kind === 'water' && row.everyDays);

    return rhythm?.everyDays ? Math.max(1, Math.floor(7 / rhythm.everyDays)) : FEEDS_PER_WEEK_WITHOUT_A_REMINDER;
  }
}

const nearestTo = <T extends { capturedAt: Date }>(rows: readonly T[], instant: Date): T | null =>
  rows.reduce<T | null>((best, row) => {
    const distance = Math.abs(row.capturedAt.getTime() - instant.getTime());
    if (distance > STILL_WINDOW_MS) return best;

    return best === null || distance < Math.abs(best.capturedAt.getTime() - instant.getTime()) ? row : best;
  }, null);

const filmOf = (films: readonly Pick<MediaDocument, 'id' | 'capturedAt'>[], week: GrowWeekSpan): string | null =>
  films.find(film => film.capturedAt >= week.startsAt && film.capturedAt < week.endsAt)?.id ?? null;

const weekNumberOf = (origin: Date, at: Date): number => Math.floor((dayNumberOf(origin, at) - 1) / 7) + 1;

/**
 * The phase the grow as a whole was in when the week ended, which is what the
 * week is named after. A phase scoped to some of the plants is a split, and a
 * split is told in the timeline rather than by renaming the week everybody else
 * is still in.
 */
const headlinePhaseAt = (grow: GrowDocument, at: Date): GrowDocument['phases'][number] | null => {
  const started = grow.phases.filter(phase => phase.startedAt <= at);
  const spine = started.filter(phase => phase.plantIds === null);

  return latest(spine.length > 0 ? spine : started);
};

const latest = (phases: GrowDocument['phases']): GrowDocument['phases'][number] | null =>
  phases.reduce<GrowDocument['phases'][number] | null>((best, phase) => (best && best.startedAt > phase.startedAt ? best : phase), null);

/**
 * What the scheme says to feed this week, with the grow's own strength already
 * applied so that nobody multiplies it twice. "Not this week" stays null rather
 * than becoming a zero dose.
 */
const feedingOf = (grow: GrowDocument, weekNumber: number, plannedCount: number): GrowWeekFeeding | null => {
  const scheme = grow.scheme;
  if (!scheme) return null;

  const amounts: SchemeAmount[] = (scheme.grid.find(week => week.week === weekNumber)?.amounts ?? []).map(amount => ({
    ...amount,
    value: amount.value === null ? null : round(amount.value * scheme.strength),
  }));

  return { amounts, plannedCount };
};

/**
 * Where each of the grow's own measurements stood at the end of the week, and by
 * how much it moved. The newest reading of a key inside the week is where it
 * stands; the newest one before the week began is what it moved from, and there
 * being none is what leaves the change null.
 */
const readingsOf = (grow: GrowDocument, entries: readonly EntryDocument[], week: GrowWeekSpan): GrowWeekReading[] =>
  grow.measurements.flatMap(definition => {
    // The entries are newest first, so the first match is the newest reading.
    const newest = (from: Date, until: Date): { value: number; at: Date } | undefined =>
      entries
        .filter(entry => entry.occurredAt >= from && entry.occurredAt < until)
        .flatMap(entry =>
          readingsIn(entry).flatMap(reading => (reading.key === definition.key ? [{ value: reading.value, at: entry.occurredAt }] : [])),
        )
        .at(0);

    const stands = newest(week.startsAt, week.endsAt);
    if (!stands) return [];

    const was = newest(new Date(0), week.startsAt);
    return [{ key: definition.key, value: stands.value, change: was ? round(stands.value - was.value) : null, measuredAt: stands.at.toISOString() }];
  });

const readingsIn = (entry: EntryDocument): { key: string; value: number }[] => ('readings' in entry.values ? entry.values.readings : []);

const round = (value: number): number => Math.round(value * 100) / 100;

const limitOf = (limit?: number): number => (!limit || limit < 1 ? DEFAULT_WEEKS : Math.min(Math.trunc(limit), MAX_WEEKS));

/**
 * The weeks after the one the cursor names. A week is worked out rather than
 * queried, so the cursor is found in the list instead of filtering a collection
 * by it.
 */
const after = (weeks: GrowWeekSpan[], cursor?: string): GrowWeekSpan[] => {
  if (!cursor) return weeks;

  const { id } = decodeCursor(cursor);
  const index = weeks.findIndex(week => String(week.weekNumber) === id);

  return index < 0 ? [] : weeks.slice(index + 1);
};
