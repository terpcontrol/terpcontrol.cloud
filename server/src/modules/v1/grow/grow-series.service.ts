import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { GrowMeasurementSeries, GrowSeries, GrowSeriesPoint, GrowSeriesRange, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { growOriginOf } from '@fg2/shared-types/v1-schemas';
import { Grant } from '@common/v1/access.types';
import { badRequest } from '@common/v1/problem';
import { withinRange } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { DataService } from '@modules/data/data.service';
import { READING_KINDS, readingsIn } from '../diary/diary-entries';
import { horizonOf } from '../diary/grow-calendar';
import { chartSeriesOf } from '../timeline/chart-series';
import { shownCameras } from '../timeline/frames';
import { TimelineWindow, narrowedTo, windowOf } from '../timeline/timeline-window';
import { spacesDuring } from './grow-places';
import { Redaction } from './grow-serialiser';
import { GrowsService } from './grows.service';

/**
 * The Charts view, as one answer.
 *
 * A grow is not a device and not a tent: where it stood is what its placements
 * say, so the climate of a range is whatever the controllers of those places
 * measured, pooled into one line per metric the same way the Timeline tab pools
 * them. That is deliberate to the point of being the reason this reads through
 * the timeline's own arithmetic rather than its own: a band drawn here and a
 * band drawn there are the same band, and a grower comparing the two screens
 * must not find them disagreeing about what was being aimed at.
 *
 * What is new here is that the client chooses the lines. The timeline stacks
 * the panels it decides on; the Charts view draws what was ticked - VPD among
 * them, which the timeline leaves out on purpose - beside the outputs and the
 * grow's own measurements, which come from the diary rather than from the
 * measurement store.
 *
 * **What the whole answer costs.** One read of the grow, one of the devices
 * standing where it stood, one of the diary over the window, two or three of
 * the target record of the device the band is drawn from, and two
 * time-series reads per device - the windowed curve, and the switchings of the
 * outputs that were ticked. A long range costs no more than a short one,
 * because the step follows from the width of the window and the switchings are
 * as many as the tent really switched.
 */

/**
 * A safety net, not a page size. A season of hand-logged readings is hundreds of
 * lines; a script writing one a minute is not, and a chart must not become a
 * read of everything. The newest are kept, as on the timeline, because the far
 * end of a long range is the part nobody is looking at.
 */
const MAX_READING_ENTRIES = 2000;

/** What the route was asked for, after the query string has been checked against the contract. */
export interface GrowSeriesQuery {
  range: GrowSeriesRange;
  metrics?: readonly Metric[];
  outputs?: readonly OutputMetric[];
  measurements?: readonly string[];
  /** The two ends of a `custom` range, and what a rolling range counts back from. */
  from?: Date;
  to?: Date;
  /** The step somebody chose; left out, the width of the window decides it. */
  stepSeconds?: number;
}

@Injectable()
export class GrowSeriesService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.targetChange) private readonly targetRecord: Model<StoredTargetChange>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    private readonly grows: GrowsService,
    private readonly data: DataService,
  ) {}

  public async read(grant: Grant, growId: string, asked: GrowSeriesQuery, hide: Redaction, now: Date = new Date()): Promise<GrowSeries> {
    const grow = await this.grows.require(growId);
    const window = this.windowFor(grow, grant, asked, now);
    const keys = this.keysOf(grow, asked.measurements ?? []);

    const metrics = asked.metrics ?? [];
    const outputs = asked.outputs ?? [];
    const spaceIds = spacesDuring(grow, window.startsAt, window.endsAt).filter((id): id is string => id !== null);

    const [devices, cameras] = await Promise.all([
      metrics.length > 0 || outputs.length > 0 ? this.devicesIn(spaceIds) : Promise.resolve([]),
      shownCameras(this.cameras, spaceIds, grant.includeCameras),
    ]);
    const [charts, readings] = await Promise.all([
      chartSeriesOf(
        { data: this.data, targetRecord: this.targetRecord, media: this.media },
        grant,
        grow,
        devices,
        cameras,
        window,
        { metrics, outputs },
        now,
      ),
      keys.length > 0 ? this.readingEntriesIn(grow.id, window) : Promise.resolve([]),
    ]);

    return {
      growId: grow.id,
      range: asked.range,
      originAt: growOriginOf(grow).toISOString(),
      dayFrom: window.dayFrom,
      dayTo: window.dayTo,
      measurements: measurementsOf(keys, readings, hide),
      ...charts,
    };
  }

  /**
   * The window the chips mean. Four of them are the timeline's, worked out from
   * the same grow; `custom` is two instants somebody picked and is the only one
   * that can be asked for without naming a width at all, so it is the only one
   * that can be refused.
   *
   * A rolling chip counts back from where the grow's own record stops rather
   * than from now. Here the grow is what is being asked about, so `24 h` on a
   * grow harvested a month ago means its last day and not the last day of the
   * calendar: without this the chip printed "day 246-247" over an empty panel
   * while every other screen of the same grow said it lasted 218 days. The
   * clamp is applied here and not in `windowOf`, which the tent's Timeline
   * shares: a tent whose grow has ended is still a live tent, and its "last
   * 24 h" has to end now.
   */
  private windowFor(grow: GrowDocument, grant: Grant, asked: GrowSeriesQuery, now: Date): TimelineWindow {
    if (asked.range !== 'custom') {
      return windowOf(asked.range, grant, grow, asked.to ?? new Date(Math.min(horizonOf(grow, now).getTime(), now.getTime())), asked.stepSeconds);
    }

    // A range whose end comes before its start never gets here: the query is
    // refused as it is read, the way every route taking a range refuses one.
    if (!asked.from || !asked.to) {
      throw badRequest(
        'range_required',
        'A custom range names both of its ends.',
        (['from', 'to'] as const)
          .filter(end => !asked[end])
          .map(end => ({ field: end, code: 'required', detail: 'Name `from` and `to`, or ask for one of the range chips instead.' })),
      );
    }
    if (asked.to.getTime() === asked.from.getTime()) {
      throw badRequest('range_required', 'A custom range ends after it begins.', [
        { field: 'to', code: 'too_small', detail: 'A chart over one instant has nothing to draw; `to` comes after `from`.' },
      ]);
    }

    return narrowedTo({ startsAt: asked.from, endsAt: asked.to }, grant, grow, now, asked.stepSeconds);
  }

  /**
   * The definitions the asked-for keys name. A key the grow does not define is
   * refused rather than answered as a series with no readings in it, which would
   * read as "nothing was ever measured" and send somebody looking for the
   * readings they know they wrote.
   */
  private keysOf(grow: GrowDocument, asked: readonly string[]): string[] {
    const defined = new Set(grow.measurements.map(definition => definition.key));
    const unknown = asked.filter(key => !defined.has(key));
    if (unknown.length > 0) {
      throw badRequest('measurement_not_defined', `This grow measures nothing called ${unknown.join(', ')}.`, [
        { field: 'measurements', code: 'unknown', detail: "A series names one of the grow's own `measurements[]`." },
      ]);
    }

    return [...new Set(asked)];
  }

  /**
   * Whatever stands where the grow stood over the window. A grow that moved
   * between tents is read from the controllers of both, because the line the
   * chart draws is what its plants lived through and not what one tent did.
   *
   * A device knows only where it stands now, so a controller that has since been
   * moved out is not read for the days it kept - the same limit the week cards
   * already have.
   */
  private devicesIn(spaceIds: readonly string[]): Promise<StoredDevice[]> {
    if (spaceIds.length === 0) return Promise.resolve([]);

    return this.devices
      .find({ spaceId: { $in: spaceIds } })
      .sort({ createdAt: 1, id: 1 })
      .lean<StoredDevice[]>();
  }

  /**
   * The entries that carry readings, over the window. A reading taken while
   * watering is a reading, so all three kinds that can hold one are read - the
   * week card counts them the same way, and a chart that only counted the
   * Measure tile would draw a different history of the same grow.
   */
  private async readingEntriesIn(growId: string, window: TimelineWindow): Promise<EntryDocument[]> {
    const rows = await this.entries
      .find({ $and: [{ growId, kind: { $in: READING_KINDS } }, withinRange('occurredAt', window)] })
      .sort({ occurredAt: -1, id: -1 })
      .limit(MAX_READING_ENTRIES)
      .lean<EntryDocument[]>();

    // Read newest first so the net above cuts the far end, drawn oldest first.
    return rows.reverse();
  }
}

/** One line per definition asked for, with the readings of it that the window holds. */
const measurementsOf = (keys: readonly string[], entries: readonly EntryDocument[], hide: Redaction): GrowMeasurementSeries[] =>
  keys.map(key => ({
    key,
    points: entries.flatMap(entry =>
      readingsIn(entry).flatMap((reading): GrowSeriesPoint[] =>
        reading.key === key
          ? [
              {
                measuredAt: entry.occurredAt.toISOString(),
                value: reading.value,
                // Which plant a reading was taken on is a plant count told one
                // reading at a time, so it goes where the count goes.
                plantId: hide.counts ? null : reading.plantId,
                entryId: entry.id,
              },
            ]
          : [],
      ),
    ),
  }));
