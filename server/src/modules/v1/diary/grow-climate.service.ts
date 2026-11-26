import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PhaseTargets, SeriesPoint, TimelineDevice } from '@fg2/shared-types/v1';
import { STEERED } from '@fg2/shared-types/v1-schemas';
import { devicesCalledIn } from '@common/v1/device-called';
import { staysWith, stoodIn } from '@common/v1/device-placements';
import { Span } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { DevicePlacement, StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { DataService, DeviceHistory } from '@modules/data/data.service';
import { targetsOf } from '../phase/phase-targets';
import { climateOf, cyclesOf, recordOf } from '../phase/target-record';
import { DeviceChange, changesOf, predecessorsOf } from '../timeline/place-history';
import { steeringOf } from '../timeline/timeline-window';
import { DayDevice, edgesOf } from './day-climate';
import { ClimateSummary, CLIMATE_METRICS, summariseClimate } from './week-climate';

/**
 * How a stretch of a grow was kept, read from the measurement store.
 *
 * A grow is not a device: where it stood is what its placements say, and the
 * climate of a week is whatever the controllers of those places measured. So
 * this walks from the spaces the plants were in to the devices that steer them,
 * and reads one window per device.
 *
 * **What the whole answer costs.** Two time-series reads per stretch per
 * controller, and nothing is cached. They are two because they are two
 * questions: what the air did is a mean, which is a fair answer at any width,
 * and what the lamp did is not - averaged, an output says what share of a window
 * it ran for, on a scale that differs per output. A day of the diary of a tent with one
 * controller is two reads; a page of eight weeks is sixteen, and the second read
 * is a scan of one field that comes back with as many rows as the lamp switched.
 * A stretch a controller's readings left their band in costs a third read, after
 * those two: its raw samples over the ten minutes around where each run began
 * and ended, one script for up to sixty of them - a few hundred rows and
 * about a millisecond a run edge, and nothing for a stretch that held its band.
 * The report reads one window per phase instead - five or six for a whole grow -
 * which is why it carries no days of its own. The reads of one page run
 * together, so the page is as slow as its slowest week rather than as the sum of
 * them.
 */

/** The device type that is a lamp, and switches a tent's day without stating a climate. */
const LIGHT_TYPE = 'light';

/** Narrow enough that a week is a readable curve, wide enough that a week is one query; a longer stretch widens it. */
const CLIMATE_STEP_SECONDS = 900;

/**
 * How finely a day is read: fine enough that an excursion of ten minutes is
 * two windows, and the grain the lamp's switchings are read at anyway. A week
 * of it is two thousand windows a field.
 */
const DAY_STEP_SECONDS = 300;

/**
 * How far before a stretch its read begins. The store answers the state a
 * read opens in and every switching after it, so a lamp that comes on at the
 * very instant a stretch begins would otherwise be the state found, not a
 * switching.
 */
const LEAD_MS = 2 * DAY_STEP_SECONDS * 1000;

/**
 * A safety net, not a budget: a sensor flapping at its band's edge all week
 * must not become a read of every sample of it. Past this many stretches of a
 * week, its runs keep the edges of their windows.
 */
const MAX_EDGES = 240;

/** A device that steers a climate, where it stood and when, and which sensors it says it has. */
export interface Controller {
  deviceId: string;
  placements: readonly DevicePlacement[];
  hardware: Record<string, string>;
}

/** Where a grow stood and when: its placements, or the part of them a split's plants stood in. */
export type GrowStays = readonly { spaceId: string | null; startedAt: Date; endedAt: Date | null }[];

/** What one controller recorded over the parts of a stretch it stood where the grow stood (`alongside`). */
export type RecordedController = DayDevice & { alongside: Span[] };

/** From the first of these stretches to the end of the last. */
const hullOf = (spans: readonly Span[]): Span => ({ startsAt: spans[0].startsAt, endsAt: spans[spans.length - 1].endsAt });

/**
 * A read over the hull of these stretches, told only what it measured inside them: the windows ending in one. A
 * grow that went away for an hour is not told what the place it left measured meanwhile. Its switchings stay whole,
 * the state each window was in.
 */
const keptTo = (history: DeviceHistory, spans: readonly Span[]): DeviceHistory => {
  if (spans.length < 2) return history;
  const inside = (point: SeriesPoint): boolean => {
    const at = Date.parse(point.measuredAt);
    return spans.some(span => at > span.startsAt.getTime() && at <= span.endsAt.getTime());
  };
  const { series } = history;
  return {
    ...history,
    series: {
      ...series,
      metrics: series.metrics.map(row => ({ ...row, points: row.points.filter(inside) })),
      outputs: series.outputs.map(row => ({ ...row, points: row.points.filter(inside) })),
    },
  };
};

@Injectable()
export class GrowClimateService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.targetChange) private readonly targetRecord: Model<StoredTargetChange>,
    private readonly data: DataService,
  ) {}

  /**
   * The devices a stretch of these spaces is read from: every one that states
   * targets, because a week's averages are what the tent was held at and the
   * device that says what it was aiming for is the one that was holding it
   * there - and a Light, which states none but is the lamp itself. It is what
   * switches the tent's day, so its output is what the hours of light are, and
   * its own sensors are the air under it; Charts has always drawn both for the
   * same grow, while the diary day said nothing stood there to average. A plug
   * steers neither and is left out.
   *
   * Every one that stood there inside the stretch, by its placements: a
   * controller that has since been moved out of the tent still speaks for the
   * weeks it kept, and one that came later says nothing of where it stood before.
   */
  public async controllersIn(spaceIds: readonly (string | null)[], span: Span): Promise<Controller[]> {
    const named = spaceIds.filter((id): id is string => id !== null);
    const stood = await stoodIn(this.devices, named, span, { type: 1, configuration: 1, 'state.hardware': 1 });

    return stood
      .map(one => one.device)
      .filter(device => targetsOf(device.configuration) !== null || device.type === LIGHT_TYPE)
      .map(device => ({ deviceId: device.id, placements: device.placements ?? [], hardware: device.state?.hardware ?? {} }));
  }

  /** What the devices some lines of the grow's places name are called there (`calledIn`). */
  public calledIn(deviceIds: readonly (string | null)[], ownerId: string): Promise<TimelineDevice[]> {
    return devicesCalledIn(this.devices, deviceIds, ownerId);
  }

  /**
   * Every device that stood where the grow stood over a stretch, each with the parts of it it did (`staysWith`): what a
   * line of a day names its device among, as Verlauf's lines do among the devices of the window.
   */
  public async alongside(stays: GrowStays, spaceIds: readonly (string | null)[], span: Span): Promise<{ deviceId: string; alongside: Span[] }[]> {
    const named = spaceIds.filter((id): id is string => id !== null);
    const stood = await stoodIn(this.devices, named, span, { type: 1 });

    return stood.flatMap(({ device }) => {
      const alongside = staysWith(device.placements, stays, span);
      return alongside.length > 0 ? [{ deviceId: device.id, alongside }] : [];
    });
  }

  /**
   * When another device took over the climate where the grow stood, over the
   * part of a stretch it stood in each place - as the place's own Verlauf
   * tells it (`changesOf`). The grow moving to another tent is no such change:
   * that is a line somebody wrote. One read of the devices per place.
   */
  public async deviceChanges(placements: GrowStays, span: Span): Promise<DeviceChange[]> {
    const changes = await Promise.all(
      placements.map(async ({ spaceId, startedAt, endedAt }) => {
        const there = {
          startsAt: startedAt > span.startsAt ? startedAt : span.startsAt,
          endsAt: endedAt && endedAt < span.endsAt ? endedAt : span.endsAt,
        };
        if (spaceId === null || there.endsAt <= there.startsAt) return [];

        const stood = await stoodIn(this.devices, [spaceId], there, { type: 1, name: 1, configuration: 1 });
        const leadingId = steeringOf(stood.map(one => one.device))?.id ?? null;
        return changesOf(stood, leadingId, predecessorsOf(stood, leadingId, [spaceId]));
      }),
    );

    return changes.flat();
  }

  /**
   * What each controller recorded over each of these stretches, for the days
   * inside them to be read from (`dayClimateOf`): the curve at a day's grain
   * with the lamp's switchings, and the device's target record over all of
   * them. One history read per stretch per controller, side by side, and the
   * record once per controller; then, where the readings left their band, the
   * raw samples around each run's edges. A controller is read over the parts of a
   * stretch it stood where the grow stood (`staysWith`), and not at all for a
   * stretch it stood elsewhere.
   */
  public async recorded(controllers: readonly Controller[], stays: GrowStays, stretches: readonly Span[]): Promise<RecordedController[][]> {
    if (controllers.length === 0 || stretches.length === 0) return stretches.map(() => []);

    const whole = {
      startsAt: new Date(Math.min(...stretches.map(stretch => stretch.startsAt.getTime()))),
      endsAt: new Date(Math.max(...stretches.map(stretch => stretch.endsAt.getTime()))),
    };
    const [records, histories] = await Promise.all([
      Promise.all(controllers.map(controller => recordOf(this.targetRecord, controller.deviceId, whole))),
      Promise.all(
        stretches.map(stretch =>
          Promise.all(
            controllers.map(async controller => {
              const alongside = staysWith(controller.placements, stays, stretch);
              if (alongside.length === 0) return null;

              // The lead only where the device was already there: before it came, its lamp lit another place.
              const stay = hullOf(alongside);
              const lead = stay.startsAt > stretch.startsAt ? 0 : LEAD_MS;
              const history = await this.data.history(controller.deviceId, {
                startsAt: new Date(stay.startsAt.getTime() - lead),
                endsAt: stay.endsAt,
                metrics: STEERED,
                outputs: ['light'],
                stepSeconds: DAY_STEP_SECONDS,
              });
              return { history: keptTo(history, alongside), alongside };
            }),
          ),
        ),
      ),
    ]);

    return Promise.all(
      histories.map((perController, at) =>
        Promise.all(
          perController.flatMap((read, index): Promise<RecordedController>[] => {
            if (!read) return [];

            const { deviceId, hardware } = controllers[index];
            const device: RecordedController = { ...read, record: records[index].map(climateOf), hardware };
            // The samples around where its readings left their band and came back, which say the minute of it (`dayClimateOf`).
            const edges = edgesOf(device, stretches[at]);
            return [
              edges.length === 0 || edges.length > MAX_EDGES
                ? Promise.resolve(device)
                : this.data.rawSamples(deviceId, STEERED, edges).then(samples => ({ ...device, samples })),
            ];
          }),
        ),
      ),
    );
  }

  /**
   * One stretch, summarised. `targets` is the band the stretch is judged against
   * - the phase's own snapshot, which is the only thing that can draw a band
   * over a phase that is over, because the store holds readings and never
   * setpoints. Null is a stretch with no band, which is summarised and left
   * ungraded rather than judged against whatever a controller happens to run
   * today.
   */
  public async summarise(controllers: readonly Controller[], stays: GrowStays, window: Span, targets: PhaseTargets | null): Promise<ClimateSummary> {
    // Each controller over the parts of the stretch it stood where the plants stood.
    const stood = controllers.flatMap(controller => {
      const alongside = staysWith(controller.placements, stays, window);
      return alongside.length > 0 ? [{ deviceId: controller.deviceId, alongside, stay: hullOf(alongside) }] : [];
    });
    const [histories, records] = await Promise.all([
      Promise.all(
        stood.map(({ deviceId, alongside, stay }) =>
          this.data
            .history(deviceId, { ...stay, metrics: CLIMATE_METRICS, outputs: ['light'], stepSeconds: CLIMATE_STEP_SECONDS })
            .then(history => keptTo(history, alongside)),
        ),
      ),
      // What each device's cycle was, which is what tells its day from its night.
      Promise.all(stood.map(async ({ deviceId, stay }) => [deviceId, cyclesOf(await recordOf(this.targetRecord, deviceId, stay), stay)] as const)),
    ]);

    return summariseClimate(histories, targets, new Map(records));
  }
}
