import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import type { Metric, SpaceTimeline, TimelineAlarm, TimelineCamera, TimelineGrow, TimelineRange } from '@fg2/shared-types/v1';
import { outputMetric } from '@fg2/shared-types/v1-schemas';
import { Grant } from '@common/v1/access.types';
import { badRequest, notFound } from '@common/v1/problem';
import { withinRange } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { DataService } from '@modules/data/data.service';
import { DIARY_KINDS, MACHINE_KINDS, authorIdsOf, peopleOf, readingNamesOf, serialiseDiaryEntry } from '../diary/diary-entries';
import { NOTHING_HIDDEN, Redaction, redactionOf } from '../grow/grow-serialiser';
import { SpaceLiveService } from '../space/space-live.service';
import { SpacesService } from '../space/spaces.service';
import { PANEL_METRICS, lanesOf, nightsOf, panelsOf } from './timeline-series';
import { TimelineWindow, stretchesOf, windowOf } from './timeline-window';

/**
 * The Timeline tab, as one answer.
 *
 * Every part of it is a view of the same window - the frame above the panels,
 * the curves, the band that applied, the night, the alarms, the lanes and the
 * rail - so it is answered together. A screen that asked for them separately
 * would draw six windows that disagree at their edges and would have to scrub
 * them into agreement afterwards.
 *
 * **What the whole answer costs, for every range.** Up to ten reads of Mongo -
 * the space, the devices standing in it, the grows that have stood in it, the
 * alerts overlapping the window, the metrics their rules watch, the diary over
 * the window and the machines' own lines over it, the cameras, one aggregation
 * for the frames, and the people the rail names - and two time-series reads per
 * device in the space, the curve and the switchings behind it. The last two of
 * the Mongo reads are skipped where there is nothing to look up, and a redacted
 * reader reads the diary alone. A third time-series read per device is paid by
 * a window with no curves in it at all, and by no other: it is the one window
 * that cannot say for itself whether this place measures - see `lastReadingOf`.
 *
 * A long range costs no more than a short one, because the step follows from
 * the width of the window: `24 h` and a four-month grow are both one read of a
 * few hundred windows per device. What a long range costs instead is resolution
 * - see `timeline-window.ts`. The second read is the outputs, and it is not
 * windowed at all: it answers the instants they switched at, which is a few
 * hundred rows over a season and the only thing a coarse window cannot say.
 *
 * Nothing here writes, and nothing it answers is a handle to write with: the
 * rail carries lines to open, never a task to tick off, so the answer a
 * read-only link is served is the answer its owner is served, clamped to the
 * link's window.
 */

/**
 * How many steps the slider above the panels has. A camera takes a still every
 * 30 seconds, so a day of one camera is 2880 pictures: the frames are thinned in
 * the database to one per step rather than read out and dropped here.
 */
const FRAME_SLOTS = 120;

/** A safety net, not a page size: a season of human logging is hundreds of lines, and a runaway alarm must not become a read of everything. */
const MAX_EVENTS = 500;

/**
 * The same net over a device's own log and the plan's bookkeeping, held
 * separately from the one above it.
 *
 * Both nets cut the far end of a newest-first read, so a single net over both
 * groups would let one failing capture every thirty seconds spend the whole of
 * it and push the grower's own notes off the far end of a wide window - the
 * lines the rail exists for would be the first to go. Read apart, a chatty
 * device can only ever crowd out other chatter. It is the smaller number
 * because a machine's log is a stream to scrub past rather than a record read
 * line by line, and because lines this close together share one mark anyway.
 */
const MAX_MACHINE_EVENTS = 200;

@Injectable()
export class TimelineService {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    @InjectModel(MODEL_V1.alarmRule) private readonly rules: Model<StoredAlarmRule>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly places: SpacesService,
    private readonly live: SpaceLiveService,
    private readonly data: DataService,
  ) {}

  public async read(grant: Grant, spaceId: string, asked: TimelineQuery, now: Date = new Date()): Promise<SpaceTimeline> {
    const at = asked.at ?? now;
    const [space, devices, stood] = await Promise.all([
      this.places.require(spaceId),
      this.live.devicesIn([spaceId]),
      // Every grow that has ever stood here, newest first: the one the bands are
      // of and the ones the rail is of are both in this one read.
      this.grows
        .find({ placements: { $elemMatch: { spaceId } } })
        .sort({ startedAt: -1, id: -1 })
        .lean<GrowDocument[]>(),
    ]);

    const grow = this.growFor(asked, stood, spaceId);
    const window = windowOf(asked.range, grant, grow, at);
    const growIds = stood.filter(one => stoodDuring(one, spaceId, window)).map(one => one.id);

    const [series, alerts, recorded, cameras] = await Promise.all([
      Promise.all(
        devices.map(device =>
          this.data.history(device.id, {
            ...spanOf(window),
            metrics: PANEL_METRICS,
            // Every output in the same read: a lane is whatever the device
            // reported rather than whatever was asked for.
            outputs: outputMetric.options,
          }),
        ),
      ),
      this.alerts
        .find({ $and: [raisedHere(spaceId, devices), { startedAt: { $lte: window.endsAt } }, openInto(window.startsAt)] })
        .sort({ startedAt: 1 })
        .lean<StoredAlert[]>(),
      this.eventsOf(grant, spaceId, growIds, window),
      grant.includeCameras
        ? this.cameras.find({ spaceId, removedAt: null }).sort({ createdAt: 1, id: 1 }).lean<CameraDocument[]>()
        : Promise.resolve([]),
    ]);

    const [watched, frames, hide] = await Promise.all([this.metricsOf(alerts), this.framesOf(cameras, window), this.redactionFor(grant)]);
    const told = recorded.entries.map(entry => serialiseDiaryEntry(entry, hide, grant.includeCameras));
    const people = await this.users.find({ id: { $in: authorIdsOf(told) } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();
    const panels = panelsOf(
      series.map(one => one.series),
      stretchesOf(grow, devices, window),
    );

    return {
      spaceId: space.id,
      name: space.name,
      kind: space.kind,
      range: asked.range,
      growId: grow?.id ?? null,
      dayFrom: window.dayFrom,
      dayTo: window.dayTo,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      stepSeconds: series.length === 0 ? 0 : window.stepSeconds,
      deviceIds: devices.map(device => device.id),
      panels,
      lastReadingAt: panels.length > 0 ? null : await this.lastReadingOf(devices),
      nights: nightsOf(series, window),
      alarms: alerts.map(alert => alarmOf(alert, watched.get(alert.ruleId ?? '') ?? null)),
      outputs: lanesOf(series, window),
      events: told,
      machineEvents: recorded.machine,
      // A reader who is shown one grow's week is not shown what else has stood
      // in the room, so the chips they have not got are answered as none.
      grows: grant.redacted ? [] : stood.map(one => growOf(one)),
      readingNames: readingNamesOf(stood),
      cameras: cameras.map(camera => ({ cameraId: camera.id, name: camera.name, frames: frames.get(camera.id) ?? [] })),
      people: peopleOf(told, people),
    };
  }

  /**
   * Everything the space recorded inside the window, oldest first, which is the
   * order the rail is read in.
   *
   * The whole record, not the diary half of it: a capture that keeps failing and
   * a plan that stepped are precisely what somebody scrubs a tent's timeline to
   * find, and the tent's own Latest list already shows them, so a rail that left
   * them out said "nothing was written here" over lines the screen before it had
   * just listed. The two groups are read under nets of their own so that neither
   * can spend the other's - see `MAX_MACHINE_EVENTS`.
   *
   * A redacted reader is the exception and keeps the diary-only rail. A share
   * link and a public page are given what happened to the grow, and a device's
   * line carries its own diagnostics verbatim - a failing capture's byte counts,
   * a socket's role, an address - which is the inside of somebody's flat rather
   * than the story of their grow. Widening the rail must not widen what a link
   * hands out, so the kinds a stranger never sees stay the kinds a stranger
   * never sees.
   *
   * How many machine lines the window held is answered beside them, because the
   * net is silent otherwise: a four-month grow in a chatty tent holds thousands
   * and the rail drew two hundred of them with nothing on the screen to say that
   * the first months carried more than nothing.
   */
  private async eventsOf(grant: Grant, spaceId: string, growIds: string[], window: TimelineWindow): Promise<SpaceEvents> {
    const recordedHere = { $or: [{ spaceId }, { growId: { $in: growIds } }] };
    const of = (kinds: readonly string[]) => ({ $and: [recordedHere, { kind: { $in: kinds } }, withinRange('occurredAt', window)] });
    // Newest first so that a net cuts the far end of a long range rather than
    // the days somebody is most likely looking at.
    const newest = (kinds: readonly string[], net: number) =>
      this.entries.find(of(kinds)).sort({ occurredAt: -1, id: -1 }).limit(net).lean<EntryDocument[]>();

    if (grant.redacted) return { entries: (await newest(DIARY_KINDS, MAX_EVENTS)).reverse(), machine: { shown: 0, total: 0 } };

    const [diary, machine] = await Promise.all([newest(DIARY_KINDS, MAX_EVENTS), newest(MACHINE_KINDS, MAX_MACHINE_EVENTS)]);
    // Counted only where the net actually bit. Under the net the read is the
    // count, and the alternative would be a second pass over the entries of
    // every tent on every refresh to learn a number nothing would draw.
    const total = machine.length < MAX_MACHINE_EVENTS ? machine.length : await this.entries.countDocuments(of(MACHINE_KINDS));

    return {
      entries: [...diary, ...machine].sort((one, other) => one.occurredAt.getTime() - other.occurredAt.getTime() || one.id.localeCompare(other.id)),
      machine: { shown: machine.length, total },
    };
  }

  /**
   * The grow the bands and the day counter are of. A named one has to have stood
   * in this space, or the tent would draw a band from a grow in somebody else's
   * room; without a name it is the grow standing here now, newest first as the
   * tent page lists them - which the two rolling ranges manage without and the
   * two stretches of a grow cannot.
   */
  private growFor(asked: TimelineQuery, stood: GrowDocument[], spaceId: string): GrowDocument | null {
    if (!asked.growId) {
      // There is no such thing as the phase of a tent: a tent may hold two grows
      // at once, and neither of them is the one the chips meant.
      if (asked.range === 'phase' || asked.range === 'grow') {
        throw badRequest('grow_required', `The ${asked.range} range is a stretch of one grow, so it has to name which.`);
      }

      // Standing here now, not merely having stood here once: a grow that moved
      // out in spring is what the rail still carries and not what the bands are of.
      return stood.find(grow => grow.placements.some(one => one.spaceId === spaceId && one.endedAt === null)) ?? null;
    }

    const named = stood.find(grow => grow.id === asked.growId);
    if (!named) throw notFound('grow_not_found', 'There is no grow with that id standing in this space.');

    return named;
  }

  /**
   * When anything standing here last measured one of the panels' metrics,
   * whenever that was - inside the window, or months before it.
   *
   * A screen with no curves has two sentences to choose between and no way of
   * its own to choose: a place where nothing measures, and a place that
   * measures and has been quiet across this window. `panels` is empty in both
   * cases, by design - a metric every point of which is null has no panel - and
   * the window holds nothing that could tell them apart, because the fact that
   * decides it lies outside the window. So the store is asked, and asked only
   * where there is nothing to draw: a window with curves in it has already
   * answered the question by having them, and this costs a read per device that
   * a timeline would otherwise not pay.
   *
   * A space holding only a plug, a light or a fan measures none of these
   * metrics in any window and answers null, which is what keeps "nothing
   * measures here" the right sentence for the 84 such spaces of the restored
   * database rather than telling their owners the hardware went quiet.
   */
  private async lastReadingOf(devices: StoredDevice[]): Promise<string | null> {
    if (devices.length === 0) return null;

    const live = await Promise.all(devices.map(device => this.data.live(device.id)));
    const measured = live.flatMap(one =>
      PANEL_METRICS.flatMap(metric => {
        const measuredAt = one.metrics[metric]?.measuredAt;
        return measuredAt ? [measuredAt] : [];
      }),
    );

    return measured.length === 0 ? null : measured.reduce((newest, one) => (new Date(one) > new Date(newest) ? one : newest));
  }

  /**
   * What each alert's rule watched: an alert stores the reading, its rule the
   * metric the reading is of. A rule on an output names no metric.
   */
  private async metricsOf(alerts: StoredAlert[]): Promise<Map<string, Metric>> {
    const ruleIds = [...new Set(alerts.flatMap(alert => (alert.ruleId ? [alert.ruleId] : [])))];
    if (ruleIds.length === 0) return new Map();

    const rules = await this.rules.find({ id: { $in: ruleIds } }, { id: 1, watch: 1 }).lean<Pick<StoredAlarmRule, 'id' | 'watch'>[]>();
    return new Map(rules.flatMap(rule => (rule.watch.kind === 'reading' ? [[rule.id, rule.watch.metric] as [string, Metric]] : [])));
  }

  /**
   * The frames the slider steps through: at most one per step, per camera, and
   * all of them in one aggregation. The slot a picture falls in is grouped in
   * the database, because the alternative is reading a day of stills out to keep
   * a hundred of them.
   */
  private async framesOf(cameras: CameraDocument[], window: TimelineWindow): Promise<Map<string, TimelineCamera['frames']>> {
    if (cameras.length === 0) return new Map();

    const slotMs = Math.max(1, Math.floor((window.endsAt.getTime() - window.startsAt.getTime()) / FRAME_SLOTS));
    const rows = await this.media.aggregate<{ _id: { cameraId: string }; mediaId: string; capturedAt: Date }>([
      {
        $match: {
          cameraId: { $in: cameras.map(camera => camera.id) },
          kind: 'still',
          capturedAt: { $gte: window.startsAt, $lte: window.endsAt },
        },
      },
      { $sort: { capturedAt: 1 } },
      {
        $group: {
          _id: { cameraId: '$cameraId', slot: { $floor: { $divide: [{ $subtract: ['$capturedAt', window.startsAt] }, slotMs] } } },
          mediaId: { $first: '$id' },
          capturedAt: { $first: '$capturedAt' },
        },
      },
      { $sort: { capturedAt: 1 } },
    ]);

    const frames = new Map<string, TimelineCamera['frames']>();
    for (const row of rows) {
      const own = frames.get(row._id.cameraId) ?? [];
      frames.set(row._id.cameraId, [...own, { mediaId: row.mediaId, capturedAt: row.capturedAt.toISOString() }]);
    }

    return frames;
  }

  /** Whose privacy applies to what the rail says; nothing is hidden from an owner or a member. */
  private async redactionFor(grant: Grant): Promise<Redaction> {
    if (!grant.redacted) return NOTHING_HIDDEN;

    const owner = grant.privacyOwnerId ? await this.users.findOne({ id: grant.privacyOwnerId }, { privacy: 1 }).lean<StoredUser>() : null;
    return redactionOf(true, owner?.privacy);
  }
}

/** The rail's lines, and how many of the machines' own the window held behind the two hundred it was given. */
interface SpaceEvents {
  entries: EntryDocument[];
  machine: { shown: number; total: number };
}

/** A grow the stretch chips may be pointed at, which is any that has stood here. */
const growOf = (grow: GrowDocument): TimelineGrow => ({
  growId: grow.id,
  name: grow.name,
  startedAt: grow.startedAt.toISOString(),
  endedAt: grow.endedAt?.toISOString() ?? null,
});

/** What the route was asked for, after the query string has been checked against the contract. */
export interface TimelineQuery {
  range: TimelineRange;
  growId?: string;
  /** The instant the window ends at; now, unless somebody scrubbed back. */
  at?: Date;
}

/** The window on its own, for the readers that take a window and nothing else. */
const spanOf = (window: TimelineWindow): { startsAt: Date; endsAt: Date; stepSeconds: number } => ({
  startsAt: window.startsAt,
  endsAt: window.endsAt,
  stepSeconds: window.stepSeconds,
});

/** An alert of this space, or of a device standing in it. */
const raisedHere = (spaceId: string, devices: StoredDevice[]): FilterQuery<StoredAlert> => ({
  $or: [{ spaceId }, { deviceId: { $in: devices.map(device => device.id) } }],
});

/**
 * An alert that had not been resolved before the window began. Its own
 * `startedAt` is answered as it happened even where that is before the window:
 * an alarm open across the whole of a shared week is a fact about that week, and
 * moving its start to the edge would say it began there.
 */
const openInto = (startsAt: Date): FilterQuery<StoredAlert> => ({ $or: [{ resolvedAt: null }, { resolvedAt: { $gte: startsAt } }] });

/** Whether the grow's plants stood in this space at any point in the window. */
const stoodDuring = (grow: GrowDocument, spaceId: string, window: TimelineWindow): boolean =>
  grow.placements.some(
    placement =>
      placement.spaceId === spaceId && placement.startedAt <= window.endsAt && (placement.endedAt === null || placement.endedAt >= window.startsAt),
  );

const alarmOf = (alert: StoredAlert, metric: Metric | null): TimelineAlarm => ({
  alertId: alert.id,
  kind: alert.kind,
  severity: alert.severity,
  metric,
  startedAt: alert.startedAt.toISOString(),
  endedAt: alert.resolvedAt?.toISOString() ?? null,
  value: alert.value,
  extremeValue: alert.extremeValue,
});
