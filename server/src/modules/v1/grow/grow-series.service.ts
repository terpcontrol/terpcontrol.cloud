import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { GrowMeasurementSeries, GrowSeries, GrowSeriesPoint, GrowSeriesRange } from '@fg2/shared-types/v1';
import { growOriginOf } from '@fg2/shared-types/v1-schemas';
import { localOf } from '@common/v1/local-time';
import { Grant } from '@common/v1/access.types';
import { badRequest } from '@common/v1/problem';
import { withinRange } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { READING_KINDS, readingsIn } from '../diary/diary-entries';
import { horizonOf } from '../diary/grow-calendar';
import { TimelineWindow, narrowedTo, windowOf } from '../timeline/timeline-window';
import { Redaction } from './grow-serialiser';
import { GrowsService } from './grows.service';

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
  measurements?: readonly string[];
  /** The two ends of a `custom` range, and what a rolling range counts back from. */
  from?: Date;
  to?: Date;
}

/**
 * A grow's own measurements over one range, as one answer: the readings
 * somebody wrote into its diary, each as it was taken, at no step at all. The
 * window is the Timeline's for the same chip, worked out from the same grow, so
 * a reading drawn on the grow's Messwerte and on the tent's Verlauf is dated the
 * same; the climate of that window is Verlauf's read.
 *
 * **What it costs.** One read of the grow and one of the diary over the window.
 */
@Injectable()
export class GrowSeriesService {
  constructor(
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    private readonly grows: GrowsService,
  ) {}

  public async read(grant: Grant, growId: string, asked: GrowSeriesQuery, hide: Redaction, now: Date = new Date()): Promise<GrowSeries> {
    const grow = await this.grows.require(growId);
    const zone = await this.grows.zoneOf(grow);
    const window = this.windowFor(grow, zone, grant, asked, now);
    const keys = this.keysOf(grow, asked.measurements ?? []);

    const readings = keys.length > 0 ? await this.readingEntriesIn(grow.id, window) : [];

    return {
      growId: grow.id,
      range: asked.range,
      originAt: localOf(growOriginOf(grow), zone).startOf('day').toJSDate().toISOString(),
      dayFrom: window.dayFrom,
      dayTo: window.dayTo,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      measurements: measurementsOf(keys, readings, hide),
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
  private windowFor(grow: GrowDocument, zone: string | null, grant: Grant, asked: GrowSeriesQuery, now: Date): TimelineWindow {
    if (asked.range !== 'custom') {
      return windowOf(asked.range, grant, grow, zone, asked.to ?? new Date(Math.min(horizonOf(grow, now).getTime(), now.getTime())));
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

    return narrowedTo({ startsAt: asked.from, endsAt: asked.to }, grant, grow, zone, now);
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
   * The entries that carry readings, over the window. A reading taken while
   * watering is a reading, so all three kinds that can hold one are read - the
   * diary day counts them the same way, and a chart that only counted the
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
