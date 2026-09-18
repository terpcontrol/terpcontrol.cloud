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
  DEFAULT_PPFD_LUX_FACTOR,
  DeviceFactors,
  fieldsFor,
  FluxRow,
  gridOf,
  latestByField,
  liveQuery,
  pointsOf,
  readingsOf,
  seriesQuery,
  stepFor,
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

    const fields = fieldsFor(request.metrics, outputs);
    const [rows, factors] = fields.length
      ? await Promise.all([this.read(seriesQuery(this.bucket, deviceId, fields, window)), this.factorsOf(deviceId)])
      : [[] as FluxRow[], DEFAULT_FACTORS];

    const grid = gridOf(rows);
    const valueAt = (field: string, instant: string): number | null => grid.valuesByField.get(field)?.get(instant) ?? null;

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
                readingsOf(input => valueAt(input, instant)),
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

  private get bucket(): string {
    // Required environment, as in `writeSample`.
    return this.config.bucket!;
  }

  private read(query: string): Promise<FluxRow[]> {
    return this.influx.getQueryApi(this.config.org!).collectRows<FluxRow>(query);
  }

  /** A device's own VPD offsets and lux factor; the defaults for a device that is no longer there. */
  private async factorsOf(deviceId: string): Promise<DeviceFactors> {
    const device = await this.devices.findOne({ id: deviceId }, { settings: 1 }).lean();
    return device ? device.settings : DEFAULT_FACTORS;
  }
}

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
