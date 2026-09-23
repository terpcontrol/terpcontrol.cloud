import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigType } from '@nestjs/config';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { DeviceLive, DeviceSeries, Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { logger } from '@utils/logger';
import { fieldOfMetric, fieldOfOutputMetric, metricOfField, outputMetricOfField, OUTPUT_FIELDS, STORED_FIELDS } from '@common/v1/metrics';
import { reportsNoSensor } from '@common/v1/sentinels';
import { metricValueOf } from '@common/v1/value-age';
import { LightStateReader } from '@modules/v1/camera/light-state';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { influxConfig } from '../../config/configuration';
import {
  computedValue,
  DailySummary,
  dailyMeanQuery,
  dailySummariesOf,
  DEFAULT_PPFD_LUX_FACTOR,
  DeviceFactors,
  fieldsFor,
  FluxRow,
  FluxWindow,
  gridOf,
  latestByField,
  liveQuery,
  newestSampleQuery,
  newestSampleSinceQuery,
  oldestSampleQuery,
  OutputSwitching,
  pointsOf,
  rawSamplePredicate,
  readingsOf,
  runningMostOf,
  runningSpansOf,
  seriesQuery,
  stepFor,
  summaryQuery,
  SUMMARY_MEASUREMENT,
  switchingsByField,
  switchingsQuery,
  trendQuery,
} from './flux';

/**
 * The measurement store.
 *
 * Inwards nothing changes: a status message is written into the `status`
 * measurement under the field names the device reports, because deployed
 * firmware and three years of stored points decide those. Outwards the service
 * speaks the API's metric names, through the one shared translation.
 *
 * The samples are tagged by `device_id` alone. Whoever owned a device when a
 * sample arrived used to be tagged beside it and was never read back, and a
 * device changes hands, so the tag said nothing true about older points either.
 */

/**
 * Controller diagnostics the API names no metric for. They keep being written
 * and stay readable in Influx, so a question that is asked one day can be
 * answered from the points that were kept.
 */
/** 1 while the controller is in the day half of its cycle, 0 in the night half. */
const DAY_FIELD = 'day';

const DIAGNOSTIC_FIELDS = ['avg', 'p', 'i', 'd', 'rpm', DAY_FIELD, 'sensor_type'];

/** Every sensor field a device may write: the named metrics, and the diagnostics beside them. */
const SENSOR_FIELDS = [...STORED_FIELDS, ...DIAGNOSTIC_FIELDS];

/** An output is written with an `out_` prefix, which is what the device reports it without. */
const OUTPUT_KEYS = OUTPUT_FIELDS.map(field => ({ key: field.slice('out_'.length), field }));

/**
 * How many of the fleet's "when did this one last write" reads are in flight at
 * once. Eight rather than one because a fleet of a few hundred asked one after
 * another is seconds of a pass spent waiting on round trips, and rather than
 * all of them because the store serves the growers' own screens from the same
 * process, and a background loop is not entitled to the whole of it.
 */
const NEWEST_SAMPLE_LANES = 8;

/**
 * How long a pass may spend asking. Well past what a healthy store needs for a
 * fleet of this size, and short enough that a store which has stopped answering
 * costs one pass rather than every pass after it: what is not asked in the
 * budget is reported unasked, and the caller comes round again a minute later.
 */
const NEWEST_SAMPLES_BUDGET_MS = 20_000;

/** One device and the instant its caller wants its samples counted from. */
export interface DeviceSince {
  deviceId: string;
  since: Date;
}

/** What the store could say about a fleet's last words, and about which of them it could not. */
export interface NewestSamples {
  /** When each device the store answered for last wrote something, for those that wrote anything at all. */
  spokeAt: Map<string, Date>;
  /** The devices the store did not answer for, whose last word is unknown rather than absent. */
  unread: ReadonlySet<string>;
}

/** One status message, in the device's own vocabulary. The device-protocol module translates the rest. */
export interface DeviceSample {
  measuredAt: Date;
  sensors: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

/**
 * Everything one `last()` says about a device. Two of the facts it holds have no
 * metric of their own and are still read from here: which half of its cycle the
 * device says it is in, and whether its light is on. Both ride along with the
 * metrics rather than costing a query each - a card and `/live` are one read.
 */
export interface LiveReading {
  metrics: DeviceLive['metrics'];
  /**
   * The newest value of every output the device has reported driving, with the
   * age and the state the same constant makes of a sensor's. A screen that draws
   * an output needs both, and asking for them as the shortest series there is
   * costs a read and answers nothing at all for a device that fell silent.
   */
  outputs: DeviceLive['outputs'];
  /** Null where the device does not report a day/night cycle at all. */
  isDay: boolean | null;
  /** Null where the device drives no light output. */
  lightOn: boolean | null;
}

export interface SeriesRequest {
  metrics: readonly Metric[];
  outputs?: readonly OutputMetric[];
  startsAt: Date;
  endsAt: Date;
  /** Left out, the server picks a step from the range; too narrow a one for the range is widened. */
  stepSeconds?: number;
}

/** One output over a window, as something that switches rather than as something that averages. */
export interface OutputHistory {
  output: OutputMetric;
  /** In order: the state the window is found in, then every switching after it. Empty where the device reported that output not at all. */
  switchings: OutputSwitching[];
}

/**
 * A device's window as a screen that draws both a curve and a state needs it:
 * the aggregated series, and beside it the switchings the series cannot carry.
 *
 * They are two reads of the same window because they are two questions. What the
 * air was doing is a mean, and a mean of a window is a fair answer at any width.
 * What a lamp was doing is not: averaged, an output says what share of a window
 * it ran for, and a window wider than the cycle averages the cycle away. So the
 * curve keeps the step the window decides and the states are read at a grain of
 * their own - see `switchingsQuery`.
 */
export interface DeviceHistory {
  series: DeviceSeries;
  outputs: OutputHistory[];
  /**
   * The last instant the device wrote anything at all inside the window, or
   * null where it wrote nothing. A bucketed series cannot say this: its points
   * carry the instant their window closed, which is up to a step later than the
   * sample inside it, and a lane drawn to that stamp claims a state for a
   * stretch nothing was heard across.
   */
  lastSampleAt: string | null;
}

/** What the device schema fills in, reached only for a device that is not in the database at all. */
const DEFAULT_FACTORS: DeviceFactors = {
  vpdLeafOffsetDay: -2,
  vpdLeafOffsetNight: 0,
  ppfdLuxFactor: DEFAULT_PPFD_LUX_FACTOR,
};

/**
 * What a device says about itself that a read of its points cannot do without:
 * the factors its computed metrics are worked out with, and the hardware report
 * that says which of the sensors it writes a field for are fitted at all.
 *
 * They are read together because they come out of the same document, so
 * knowing both costs what knowing one used to.
 */
interface DeviceSelf {
  factors: DeviceFactors;
  /** The flat `hardware-info` report. An absent key is "the firmware did not say", which is not "not fitted". */
  hardware: Record<string, string>;
}

const UNKNOWN_DEVICE: DeviceSelf = { factors: DEFAULT_FACTORS, hardware: {} };

@Injectable()
export class DataService implements LightStateReader {
  private readonly influx: InfluxDB;

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @Inject(influxConfig.KEY) private readonly config: ConfigType<typeof influxConfig>,
  ) {
    this.influx = new InfluxDB({ url: config.url, token: config.token });
  }

  /** What a device just reported, stored. A failure is logged and swallowed: a lost sample must not drop the connection. */
  public async writeSample(deviceId: string, sample: DeviceSample): Promise<void> {
    // Org and bucket are required environment - without them there is no
    // database to write to at all.
    const writeApi = this.influx.getWriteApi(this.config.org!, this.config.bucket!, 'ns');
    writeApi.useDefaultTags({ device_id: deviceId });

    try {
      const point = new Point('status');
      for (const field of SENSOR_FIELDS) {
        if (sample.sensors[field] != null) point.floatField(field, parseFloat(String(sample.sensors[field])));
      }
      for (const output of OUTPUT_KEYS) {
        if (sample.outputs[output.key] != null) point.floatField(output.field, parseFloat(String(sample.outputs[output.key])));
      }

      point.timestamp(sample.measuredAt);
      writeApi.writePoint(point);
      await writeApi.close();
    } catch (err) {
      logger.error(`Failed writing measurements for device ${deviceId}: ${err}`);
    }
  }

  /**
   * The newest reading of everything a device measures, each with the age the
   * shared constant makes of it. One query per device, computed metrics
   * included: they are worked out from the same rows.
   */
  public async live(deviceId: string): Promise<LiveReading> {
    const [rows, self] = await Promise.all([this.read(liveQuery(this.bucket, deviceId)), this.selfOf(deviceId)]);
    const latest = latestByField(rows);

    const metrics: DeviceLive['metrics'] = {};
    const outputs: DeviceLive['outputs'] = {};
    for (const [field, reading] of latest) {
      // A diagnostic field the API names no metric for is simply not answered,
      // and neither is one whose sensor the device says it does not have.
      const name = metricOfField(field);
      if (name && !reportsNoSensor(self.hardware, name)) metrics[name] = metricValueOf(reading.value, reading.measuredAt);

      const output = outputMetricOfField(field);
      if (output) outputs[output] = metricValueOf(reading.value, reading.measuredAt);
    }

    const readings = readingsOf(field => latest.get(field)?.value ?? null);
    for (const name of ['vpd', 'ppfd'] as const) {
      const value = computedValue(name, readings, self.factors);
      if (value !== null) metrics[name] = metricValueOf(value, computedAt(name, latest));
    }

    // Only a fan says outright which half of the cycle it is in; a controller
    // and a fridge switch their light by the same schedule, so the light says it
    // for them - which is what their day and night targets are held against.
    const lightOn = flag(latest, fieldOfOutputMetric('light'));
    return { metrics, outputs, isDay: flag(latest, DAY_FIELD) ?? lightOn, lightOn };
  }

  /**
   * Whether a controller's light is on right now, which is what a camera's
   * `nightOff` asks. Null is "nothing is known about that device's light", which
   * is not the same as off - a camera keeps taking pictures rather than stopping
   * for a night nobody can confirm.
   */
  public async isLightOn(deviceId: string): Promise<boolean | null> {
    return (await this.live(deviceId)).lightOn;
  }

  /**
   * A window of history. The range and the step are answered back because the
   * server may have widened the step: a chart asking for seconds over a month
   * gets a coarser one rather than a truncated series.
   */
  public async series(deviceId: string, request: SeriesRequest): Promise<DeviceSeries> {
    const outputs = request.outputs ?? [];
    const window = {
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      stepSeconds: stepFor(request.startsAt, request.endsAt, request.stepSeconds),
    };

    // A window of no width holds no readings, and the store refuses to be asked
    // about one at all: a share link whose range ends before the window a chip
    // asked for begins leaves exactly that.
    const fields = window.endsAt > window.startsAt ? fieldsFor(request.metrics, outputs) : [];
    // The raw samples and, behind them, the days that have already been
    // summarised away. Retention is what makes the second read necessary:
    // without it a chart of last year would be empty on an install that keeps a
    // shorter window, and the readings are not gone - they are a day apart.
    // They never overlap, because a day is summarised and dropped in one act,
    // so the two sets of points go into one grid at the instants they carry.
    // The device itself is read once for both halves: its own factors, which
    // every reading is scaled by, and what its firmware says is fitted, which
    // decides whether a sentinel is a reading at all. The lamp is a read of its
    // own because only VPD asks for it.
    const [rows, summaries, self, lamp] = fields.length
      ? await Promise.all([
          this.read(seriesQuery(this.bucket, deviceId, fields, window)),
          this.read(summaryQuery(this.bucket, deviceId, fields, window)),
          this.selfOf(deviceId),
          this.lampOf(deviceId, request.metrics, window),
        ])
      : [[] as FluxRow[], [] as FluxRow[], UNKNOWN_DEVICE, [] as OutputSwitching[]];

    const grid = gridOf([...summaries, ...rows]);
    const valueAt = (field: string, instant: string): number | null => grid.valuesByField.get(field)?.get(instant) ?? null;
    const isDayAt = dayOfCycleIn(lamp, window);

    return {
      deviceId,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      stepSeconds: window.stepSeconds,
      metrics: request.metrics.map(name => {
        const field = fieldOfMetric(name);
        const at = (instant: string) =>
          field === null
            ? computedValue(
                name,
                readingsOf(input => valueAt(input, instant), isDayAt(instant)),
                self.factors,
              )
            : valueAt(field, instant);
        // A metric the device has no sensor for is answered as the empty series
        // it is, rather than as whatever the store kept before the sensor came
        // out - a panel is built from the points, and a chart of nothing is the
        // honest one.
        return { metric: name, points: pointsOf(grid.instants, reportsNoSensor(self.hardware, name) ? () => null : at) };
      }),
      outputs: outputs.map(name => ({
        output: name,
        points: pointsOf(grid.instants, instant => valueAt(fieldOfOutputMetric(name), instant)),
      })),
    };
  }

  /**
   * The same window, with the outputs answered as the states they are.
   *
   * Two reads rather than one, and they run together. The second costs a scan of
   * the outputs alone and comes back with as many rows as the device switched
   * something, so a season of one lamp is a few hundred rows where the curve
   * beside it is a few hundred windows - the promise that a long range costs
   * what a short one costs still holds.
   */
  public async history(deviceId: string, request: SeriesRequest): Promise<DeviceHistory> {
    const outputs = request.outputs ?? [];
    const [series, switchings, lastSampleAt] = await Promise.all([
      this.series(deviceId, request),
      this.switchingsOf(deviceId, outputs, request),
      this.newestSampleIn(deviceId, outputs, request),
    ]);

    return {
      series,
      outputs: outputs.map(output => ({ output, switchings: switchings.get(fieldOfOutputMetric(output)) ?? [] })),
      lastSampleAt,
    };
  }

  /**
   * One stored metric over a window for several devices at once, keyed by
   * device: the points a sparkline draws, in one query for all of them. A device
   * that wrote nothing in the window has no entry rather than an empty one.
   */
  public async trends(
    deviceIds: readonly string[],
    metric: Metric,
    window: Omit<SeriesRequest, 'metrics' | 'outputs'>,
  ): Promise<Map<string, SeriesPoint[]>> {
    const field = fieldOfMetric(metric);
    if (deviceIds.length === 0 || field === null) return new Map();

    const stepSeconds = stepFor(window.startsAt, window.endsAt, window.stepSeconds);
    const rows = await this.read(trendQuery(this.bucket, deviceIds, field, { ...window, stepSeconds }));

    const byDevice = new Map<string, FluxRow[]>();
    for (const row of rows) {
      if (row.device_id) byDevice.set(row.device_id, [...(byDevice.get(row.device_id) ?? []), row]);
    }

    return new Map(
      [...byDevice].map(([deviceId, own]) => {
        const grid = gridOf(own);
        return [deviceId, pointsOf(grid.instants, instant => grid.valuesByField.get(field)?.get(instant) ?? null)];
      }),
    );
  }

  /** One metric over a window, which is what an engine asks for rather than a whole answer. */
  public async points(deviceId: string, metric: Metric, window: Omit<SeriesRequest, 'metrics' | 'outputs'>): Promise<SeriesPoint[]> {
    const { metrics } = await this.series(deviceId, { ...window, metrics: [metric] });
    return metrics[0].points;
  }

  /** The same, for an output: what an alarm on one reads back after a restart. */
  public async outputPoints(deviceId: string, output: OutputMetric, window: Omit<SeriesRequest, 'metrics' | 'outputs'>): Promise<SeriesPoint[]> {
    const { outputs } = await this.series(deviceId, { ...window, metrics: [], outputs: [output] });
    return outputs[0].points;
  }

  /**
   * When each of several devices last wrote anything, each counted only from
   * the instant its caller named, keyed by device.
   *
   * A device that wrote nothing since its instant is absent from `spokeAt`
   * rather than carried as a null, because "nothing since then" and "nothing
   * ever" are the same answer to the caller: the instant it already has stands.
   * A device the store did not answer for is a different fact and is named in
   * `unread`, because the caller's question is whether a device has fallen
   * silent, and a store that could not be asked is not evidence that it has.
   *
   * The reads are one per device and not one for the set, for the reason
   * `newestSampleSinceQuery` gives. A few at a time, because the caller is a
   * loop over a whole fleet and a fleet's worth of reads one after another is a
   * pass that takes longer than the interval between passes; and under a budget,
   * because the loop this serves protects every device on the install and must
   * come round again even on the day the store is the thing that is ill.
   */
  public async newestSamplesOf(asked: readonly DeviceSince[], budgetMs: number = NEWEST_SAMPLES_BUDGET_MS): Promise<NewestSamples> {
    const spokeAt = new Map<string, Date>();
    const unread = new Set<string>();
    if (asked.length === 0) return { spokeAt, unread };

    const queue = [...asked];
    const until = Date.now() + budgetMs;
    let firstRefusal: unknown = null;

    // One timer for the whole call, which every lane races its read against.
    // The client's own timeout is a socket timeout and only fires on a
    // connection that has gone quiet, so a store that answers slowly rather
    // than not at all can hold a read open for as long as it likes; this is
    // what makes the budget a promise rather than an intention.
    let expire: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<null>(resolve => {
      expire = setTimeout(() => resolve(null), Math.max(0, until - Date.now()));
    });

    const lane = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        // Out of time: the rest are unasked rather than answered, and the pass
        // goes on with what it has.
        if (Date.now() >= until) {
          unread.add(next.deviceId);
          continue;
        }

        // The read is made unable to reject before it is raced. Past the
        // deadline nobody is waiting for it any more, and a rejection with no
        // caller left would reach the handler in `main.ts`, which ends the
        // process - one slow store taking the whole API down with it.
        const read = this.newestSampleSince(next.deviceId, next.since).then(
          at => ({ at }),
          (error: unknown) => {
            firstRefusal ??= error;
            return null;
          },
        );

        const answer = await Promise.race([read, expired]);
        if (!answer) unread.add(next.deviceId);
        else if (answer.at) spokeAt.set(next.deviceId, answer.at);
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(NEWEST_SAMPLE_LANES, queue.length) }, lane));
    } finally {
      clearTimeout(expire);
    }

    // One line for the pass rather than one per device: a store that is down
    // refuses every read, and a fleet's worth of identical lines buries the
    // count, which is the part worth reading.
    if (unread.size > 0)
      logger.warn(`The store did not say when ${unread.size} of ${asked.length} devices last wrote: ${firstRefusal ?? 'out of time'}`);

    return { spokeAt, unread };
  }

  /** The newest raw sample one device wrote since an instant, whatever field it was of. */
  private async newestSampleSince(deviceId: string, since: Date): Promise<Date | null> {
    const rows = await this.read(newestSampleSinceQuery(this.bucket, deviceId, since));
    const instants = rows.map(row => (row._time ? new Date(row._time).getTime() : NaN)).filter(at => Number.isFinite(at));

    return instants.length === 0 ? null : new Date(Math.max(...instants));
  }

  /**
   * The oldest raw sample a device has that is older than an instant, which is
   * where the retention sweep picks up. Null is "nothing that old is left",
   * which is how a device that has been swept says it is done.
   */
  public async oldestSampleBefore(deviceId: string, before: Date): Promise<Date | null> {
    const rows = await this.read(oldestSampleQuery(this.bucket, deviceId, before));
    const instants = rows.map(row => (row._time ? new Date(row._time).getTime() : NaN)).filter(at => Number.isFinite(at));

    return instants.length > 0 ? new Date(Math.min(...instants)) : null;
  }

  /**
   * A stretch of a device's raw samples, read back as one figure a day. The
   * points are answered rather than written so that the sweep decides what to do
   * with them - and so that the arithmetic can be looked at without a store.
   */
  public async dailySummariesOf(deviceId: string, window: { startsAt: Date; endsAt: Date }): Promise<DailySummary[]> {
    return dailySummariesOf(await this.read(dailyMeanQuery(this.bucket, deviceId, window)));
  }

  /**
   * The summaries, stored. They carry the same tag and the same field names as
   * the samples they stand for, so a read of them needs to know nothing but the
   * measurement they are in - and writing the same day twice replaces it, which
   * is what makes a sweep that is interrupted safe to run again.
   */
  public async writeDailySummaries(deviceId: string, summaries: readonly DailySummary[]): Promise<void> {
    if (summaries.length === 0) return;

    const writeApi = this.influx.getWriteApi(this.config.org!, this.bucket, 'ns');
    writeApi.useDefaultTags({ device_id: deviceId });

    for (const day of summaries) {
      const point = new Point(SUMMARY_MEASUREMENT);
      for (const [field, value] of Object.entries(day.fields)) point.floatField(field, value);
      point.timestamp(day.at);
      writeApi.writePoint(point);
    }

    // Unlike a lost sample, a failure here has to reach the caller: the sweep
    // deletes what it has summarised, and deleting after a write that did not
    // happen is how a year of somebody's readings would go missing.
    await writeApi.close();
  }

  /**
   * The raw samples of a stretch, dropped. Only `status` - the summaries just
   * written are a measurement of their own and this must not take them with it.
   *
   * The client package has no delete API, so this is the HTTP one it would call.
   * The range is closed at the start and open at the end, which is what the
   * store does with it, so a chunk that ends where the next begins drops each
   * point exactly once.
   */
  public async dropRawSamples(deviceId: string, startsAt: Date, endsAt: Date): Promise<void> {
    const url = new URL('/api/v2/delete', this.config.url);
    url.searchParams.set('org', this.config.org!);
    url.searchParams.set('bucket', this.bucket);

    const answer = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Token ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ start: startsAt.toISOString(), stop: endsAt.toISOString(), predicate: rawSamplePredicate(deviceId) }),
    });

    if (!answer.ok) throw new Error(`The store refused to drop ${deviceId}'s raw samples: ${answer.status} ${await answer.text()}`);
  }

  private get bucket(): string {
    // Required environment, as in `writeSample`.
    return this.config.bucket!;
  }

  private read(query: string): Promise<FluxRow[]> {
    return this.influx.getQueryApi(this.config.org!).collectRows<FluxRow>(query);
  }

  /**
   * When the lamp ran over this window, for the sake of the metrics that are
   * computed per bucket rather than per sample.
   *
   * VPD is the only one so far: which half of the cycle a bucket belongs to
   * cannot be read off what `out_light` averaged across it, and the switchings
   * are the one thing in the store that says it. The read is the same
   * five-minute-grain scan `history` makes of the outputs that were ticked, so
   * a caller that ticked the light as well pays for one field twice; that is a
   * scan of one field against a wrong figure on a panel the screen draws by
   * default, and the alternative is to make the two reads wait for each other.
   */
  private async lampOf(deviceId: string, metrics: readonly Metric[], window: { startsAt: Date; endsAt: Date }): Promise<OutputSwitching[]> {
    if (!metrics.includes('vpd')) return [];
    const switchings = await this.switchingsOf(deviceId, ['light'], window);

    return switchings.get(fieldOfOutputMetric('light')) ?? [];
  }

  /**
   * The newest raw sample the device wrote inside the window, which is how far a
   * lane may be drawn. `last()` answers one row per field, so the latest of them
   * is the last thing the device said about anything - the question is about the
   * device and not about one of its fields, and a lane whose own field fell
   * silent first is cut by its own points anyway.
   *
   * Only a caller that asked about an output pays for it. Nothing else reads it,
   * so a chart of the climate alone is the read it always was.
   */
  private async newestSampleIn(deviceId: string, outputs: readonly OutputMetric[], window: { startsAt: Date; endsAt: Date }): Promise<string | null> {
    if (outputs.length === 0 || window.endsAt <= window.startsAt) return null;

    const rows = await this.read(newestSampleQuery(this.bucket, deviceId, window));
    const instants = rows.flatMap(row => (row._time ? [new Date(row._time).getTime()] : [])).filter(at => Number.isFinite(at));

    return instants.length === 0 ? null : new Date(Math.max(...instants)).toISOString();
  }

  /** The switchings of the outputs that were asked for, by the field they are stored under. A window of no width holds none. */
  private async switchingsOf(
    deviceId: string,
    outputs: readonly OutputMetric[],
    window: { startsAt: Date; endsAt: Date },
  ): Promise<Map<string, OutputSwitching[]>> {
    if (outputs.length === 0 || window.endsAt <= window.startsAt) return new Map();

    const fields = [...new Set(outputs.map(fieldOfOutputMetric))];
    return switchingsByField(await this.read(switchingsQuery(this.bucket, deviceId, fields, window)));
  }

  /** A device's own VPD offsets, lux factor and hardware report; the defaults for a device that is no longer there. */
  private async selfOf(deviceId: string): Promise<DeviceSelf> {
    const device = await this.devices.findOne({ id: deviceId }, { settings: 1, 'state.hardware': 1 }).lean();
    return device ? { factors: device.settings, hardware: device.state?.hardware ?? {} } : UNKNOWN_DEVICE;
  }
}

/**
 * Which half of the cycle each bucket of a window belongs to: lit for more than
 * half of itself, or dark.
 *
 * `aggregateWindow` stamps a bucket at its end, so the bucket an instant names
 * is the step before it. Anything before the first switching is left unanswered
 * rather than guessed: the switchings are read from the raw samples, and a day
 * old enough to have been summarised away has none - its own averaged light is
 * then the only thing left to read it by, which is what a null falls back to.
 */
const dayOfCycleIn = (lamp: readonly OutputSwitching[], window: FluxWindow): ((instant: string) => boolean | null) => {
  const spans = runningSpansOf(lamp);
  const knownFrom = lamp.length > 0 ? Date.parse(lamp[0].at) : null;
  const step = window.stepSeconds * 1000;

  return instant => {
    const ends = Date.parse(instant);

    return knownFrom === null || ends <= knownFrom ? null : runningMostOf(spans, ends - step, ends);
  };
};

/**
 * How old a computed value is: as old as the stalest reading it was built from.
 * A VPD from a fresh temperature and an hour-old humidity is an hour old.
 */
const computedAt = (name: 'vpd' | 'ppfd', latest: Map<string, { measuredAt: Date }>): Date | null => {
  const inputs = name === 'vpd' ? (['temperature', 'humidity'] as const) : (['lux'] as const);
  const instants = inputs.map(input => latest.get(fieldOfMetric(input) as string)?.measuredAt).filter((at): at is Date => at != null);

  return instants.length === inputs.length ? new Date(Math.min(...instants.map(at => at.getTime()))) : null;
};

/** A field a device writes as 1 or 0, read back as the flag it is. Absent is null, not false. */
const flag = (latest: Map<string, { value: number }>, field: string): boolean | null => {
  const reading = latest.get(field);
  return reading ? reading.value > 0 : null;
};
