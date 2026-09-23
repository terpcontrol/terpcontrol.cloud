import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigType } from '@nestjs/config';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { DeviceLive, DeviceSeries, Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { logger } from '@utils/logger';
import { fieldOfMetric, fieldOfOutputMetric, metricOfField, OUTPUT_FIELDS, STORED_FIELDS } from '@common/v1/metrics';
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
}

/** What the device schema fills in, reached only for a device that is not in the database at all. */
const DEFAULT_FACTORS: DeviceFactors = {
  vpdLeafOffsetDay: -2,
  vpdLeafOffsetNight: 0,
  ppfdLuxFactor: DEFAULT_PPFD_LUX_FACTOR,
};

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
    const [rows, factors] = await Promise.all([this.read(liveQuery(this.bucket, deviceId)), this.factorsOf(deviceId)]);
    const latest = latestByField(rows);

    const metrics: DeviceLive['metrics'] = {};
    for (const [field, reading] of latest) {
      // A diagnostic field the API names no metric for is simply not answered.
      const name = metricOfField(field);
      if (name) metrics[name] = metricValueOf(reading.value, reading.measuredAt);
    }

    const readings = readingsOf(field => latest.get(field)?.value ?? null);
    for (const name of ['vpd', 'ppfd'] as const) {
      const value = computedValue(name, readings, factors);
      if (value !== null) metrics[name] = metricValueOf(value, computedAt(name, latest));
    }

    // Only a fan says outright which half of the cycle it is in; a controller
    // and a fridge switch their light by the same schedule, so the light says it
    // for them - which is what their day and night targets are held against.
    const lightOn = flag(latest, fieldOfOutputMetric('light'));
    return { metrics, isDay: flag(latest, DAY_FIELD) ?? lightOn, lightOn };
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
    const [rows, summaries, factors, lamp] = fields.length
      ? await Promise.all([
          this.read(seriesQuery(this.bucket, deviceId, fields, window)),
          this.read(summaryQuery(this.bucket, deviceId, fields, window)),
          this.factorsOf(deviceId),
          this.lampOf(deviceId, request.metrics, window),
        ])
      : [[] as FluxRow[], [] as FluxRow[], DEFAULT_FACTORS, [] as OutputSwitching[]];

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
                factors,
              )
            : valueAt(field, instant);
        return { metric: name, points: pointsOf(grid.instants, at) };
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
    const [series, switchings] = await Promise.all([this.series(deviceId, request), this.switchingsOf(deviceId, outputs, request)]);

    return { series, outputs: outputs.map(output => ({ output, switchings: switchings.get(fieldOfOutputMetric(output)) ?? [] })) };
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

  /** A device's own VPD offsets and lux factor; the defaults for a device that is no longer there. */
  private async factorsOf(deviceId: string): Promise<DeviceFactors> {
    const device = await this.devices.findOne({ id: deviceId }, { settings: 1 }).lean();
    return device ? device.settings : DEFAULT_FACTORS;
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
