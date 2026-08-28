import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { Document, Model } from 'mongoose';
import { HttpException } from '@common/http-exception';
import { calculateVpd } from '@utils/calculateVpd';
import { Image } from '@fg2/shared-types';
import { influxConfig } from '../../config/configuration';
import { MODEL } from '../../database/models.module';
import { DeviceService, StatusMessage } from '../device/device.service';

export const VALID_SENSORS = ['temperature', 'humidity', 'avg', 'p', 'i', 'd', 'co2', 'rpm', 'day', 'sensor_type', 'leaf_temperature', 'lux'];

// Lux→PPFD depends on the light spectrum, so it is a per-device calibration
// constant rather than a fixed physical conversion. Default assumes a white
// full-spectrum LED; growers can override it per device in cloud settings.
const DEFAULT_PPFD_LUX_FACTOR = 0.015;

export const VALID_OUTPUTS = ['heater', 'dehumidifier', 'co2', 'light', 'fan', 'relais', 'fan-internal', 'fan-external', 'fan-backwall'];

/**
 * Everything below builds Flux by interpolation, so what may be interpolated is
 * spelled out here. Without this a caller can close the query and append a
 * pipeline of its own - `?to=now()) |> yield() from(bucket: "…"` reads the whole
 * bucket, which holds every device of every customer.
 *
 * A duration as Flux writes it: `-30d`, `1h`, `-1h30m`.
 */
const DURATION = /^-?(?:\d+(?:ns|us|µs|ms|s|m|h|d|w|mo|y))+$/;
// `from` and `to` also take an absolute time, and `to` is usually `now()`.
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
// A field name as this service writes it - `out_` plus an output name, and
// three of those are hyphenated (`out_fan-internal`) - and a device id as the
// server issues it.
const FIELD_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const DEVICE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

// A window has to move forward: Flux rejects `every: -5m` and `every: 0s`, and
// the point of validating here is that the caller hears a 400 rather than that.
const isPositiveDuration = (value: string): boolean =>
  DURATION.test(value) && !value.startsWith('-') && (value.match(/\d+/g) ?? []).some(digits => Number(digits) > 0);

const requireMatch = (value: unknown, pattern: RegExp, name: string): string => {
  const text = String(value ?? '');
  if (!pattern.test(text)) {
    throw new HttpException(400, `Invalid ${name}`);
  }
  return text;
};

const requireInterval = (value: unknown): string => {
  const text = String(value ?? '');
  if (!isPositiveDuration(text)) {
    throw new HttpException(400, 'Invalid interval');
  }
  return text;
};

const requireTimeLiteral = (value: unknown, name: string): string => {
  const text = String(value ?? '');
  if (text === 'now()' || DURATION.test(text) || RFC3339.test(text)) {
    return text;
  }
  throw new HttpException(400, `Invalid ${name}`);
};

@Injectable()
export class DataService {
  private readonly influx: InfluxDB;

  constructor(
    @InjectModel(MODEL.image) private readonly images: Model<Image & Document>,
    @Inject(forwardRef(() => DeviceService)) private readonly devices: DeviceService,
    @Inject(influxConfig.KEY) private readonly config: ConfigType<typeof influxConfig>,
  ) {
    this.influx = new InfluxDB({ url: config.url, token: config.token });
  }

  public async addData(device_id: string, user_id: string, fields: StatusMessage) {
    // create a write API, expecting point timestamps in nanoseconds (can be also 's', 'ms', 'us')
    const writeApi = this.influx.getWriteApi(this.config.org, this.config.bucket, 'ns');
    // setup default tags for all writes through this API
    writeApi.useDefaultTags({ device_id: device_id, user_id: user_id });

    try {
      // write point with the appropriate timestamp
      const point1 = new Point('status');
      for (const sensor of VALID_SENSORS) {
        if (fields.sensors[sensor] != null) {
          point1.floatField(sensor, parseFloat(String(fields.sensors[sensor])));
        }
      }
      for (const output of VALID_OUTPUTS) {
        if (fields.outputs[output] != null) {
          point1.floatField('out_' + output, parseFloat(String(fields.outputs[output])));
        }
      }

      // Use the provided timestamp if available, otherwise use the current timestamp
      const timestamp = fields.timestamp && fields.timestamp > 0 ? fields.timestamp * 1000000000 : new Date();
      point1.timestamp(timestamp);

      writeApi.writePoint(point1);
      await writeApi.close();
    } catch (err) {
      console.log(err);
    }
  }

  public async getSeries(device_id, measure, from, to, interval, method = 'mean'): Promise<{ _time: string; _value: number }[]> {
    if (measure.startsWith('vpd')) {
      return this.getSeriesVpd(device_id, measure, from, to, interval, method);
    }

    if (measure === 'ppfd') {
      return this.getSeriesPpfd(device_id, from, to, interval, method);
    }

    const allowedMethods = ['mean', 'min', 'max', 'sum'];
    if (!allowedMethods.includes(method)) {
      method = allowedMethods[0];
    }

    const queryApi = this.influx.getQueryApi(this.config.org);
    const query = `
      from(bucket: "${this.config.bucket}")
        |> range(start: ${requireTimeLiteral(from, 'from')}, stop: ${requireTimeLiteral(to, 'to')})
        |> filter(fn: (r) => r["_measurement"] == "status")
        |> filter(fn: (r) => r["_field"] == "${requireMatch(measure, FIELD_NAME, 'measure')}")
        |> filter(fn: (r) => r["device_id"] == "${requireMatch(device_id, DEVICE_ID, 'device_id')}")
        |> aggregateWindow(every: ${requireInterval(interval)}, fn: ${method}, createEmpty: true)
        |> yield(name: "${method}")
        |> limit(n: 50000)
    `;
    const rows = await queryApi.collectRows(query);

    return rows.map((row: any) => {
      return { _time: row._time, _value: row._value };
    });
  }

  private async getSeriesVpd(device_id, measure: any, from, to, interval, method): Promise<{ _time: string; _value: number }[]> {
    const tempSeries = await this.getSeries(device_id, 'temperature', from, to, interval, method);
    const humiditySeries = await this.getSeries(device_id, 'humidity', from, to, interval, method);
    const lightSeries = await this.getSeries(device_id, 'out_light', from, to, interval, method);
    const leafTempSeries = await this.getSeries(device_id, 'leaf_temperature', from, to, interval, method);

    const combinedSeries = new Map();
    tempSeries.forEach(t => {
      combinedSeries.set(t._time, { temp: t._value });
    });
    humiditySeries.forEach(h => {
      if (combinedSeries.has(h._time)) {
        combinedSeries.get(h._time).humidity = h._value;
      }
    });
    lightSeries.forEach(l => {
      if (combinedSeries.has(l._time)) {
        combinedSeries.get(l._time).light = l._value;
      }
    });
    leafTempSeries.forEach(lt => {
      if (combinedSeries.has(lt._time)) {
        combinedSeries.get(lt._time).leafTemp = lt._value;
      }
    });

    const cloudSettings = await this.devices.getDeviceCloudSettings(device_id);

    const dayOnly = measure.endsWith('_day');
    const nightOnly = measure.endsWith('_night');

    const result = [];
    for (const [time, values] of combinedSeries.entries()) {
      const isDay = (values.light ?? 0) > 0.5;

      if (values.temp && values.humidity && ((dayOnly && isDay) || (nightOnly && !isDay) || (!dayOnly && !nightOnly))) {
        const leafTemp = this.leafTemperature(values.temp, values.leafTemp, isDay, cloudSettings);
        const vpd = calculateVpd(values.temp, leafTemp, values.humidity);
        result.push({ _time: time, _value: vpd });
      } else {
        result.push({ _time: time, _value: NaN });
      }
    }

    return result;
  }

  // Prefer a measured leaf temperature (e.g. MLX90632) when present, otherwise
  // fall back to air temperature plus the configured day/night offset.
  private leafTemperature(airTemp: number, measuredLeafTemp: number | undefined, isDay: boolean, cloudSettings: any): number {
    if (measuredLeafTemp != null && !isNaN(measuredLeafTemp)) {
      return measuredLeafTemp;
    }
    const leafTempOffset = isDay ? cloudSettings?.vpdLeafTempOffsetDay : cloudSettings?.vpdLeafTempOffsetNight;
    return airTemp + (leafTempOffset ?? 0);
  }

  private async getSeriesPpfd(device_id, from, to, interval, method): Promise<{ _time: string; _value: number }[]> {
    const luxSeries = await this.getSeries(device_id, 'lux', from, to, interval, method);
    const cloudSettings = await this.devices.getDeviceCloudSettings(device_id);
    const factor = cloudSettings?.ppfdLuxFactor ?? DEFAULT_PPFD_LUX_FACTOR;

    return luxSeries.map(l => ({ _time: l._time, _value: l._value == null || isNaN(l._value) ? NaN : l._value * factor }));
  }

  public async getLatest(device_id, measure): Promise<number> {
    if (measure === 'vpd') {
      return this.getLatestVpd(device_id);
    }

    if (measure === 'ppfd') {
      return this.getLatestPpfd(device_id);
    }

    const queryApi = this.influx.getQueryApi(this.config.org);
    const query = `
      from(bucket: "${this.config.bucket}")
        |> range(start: -5m)
        |> filter(fn: (r) => r["_measurement"] == "status")
        |> filter(fn: (r) => r["_field"] == "${requireMatch(measure, FIELD_NAME, 'measure')}")
        |> filter(fn: (r) => r["device_id"] == "${requireMatch(device_id, DEVICE_ID, 'device_id')}")
        |> aggregateWindow(every: 5m, fn: last, createEmpty: false)
        |> yield(name: "mean")
    `;

    const rows = await queryApi.collectRows(query);

    if (rows.length > 0) {
      return rows[rows.length - 1]['_value'];
    } else {
      return NaN;
    }
  }

  private async getLatestVpd(device_id): Promise<number> {
    const temp = await this.getLatest(device_id, 'temperature');
    const humidity = await this.getLatest(device_id, 'humidity');
    const light = await this.getLatest(device_id, 'out_light');
    const measuredLeafTemp = await this.getLatest(device_id, 'leaf_temperature');
    const cloudSettings = await this.devices.getDeviceCloudSettings(device_id);

    if (temp && humidity) {
      const isDay = (light ?? 0) > 0.5;
      const leafTemp = this.leafTemperature(temp, measuredLeafTemp, isDay, cloudSettings);
      return calculateVpd(temp, leafTemp, humidity);
    }

    return NaN;
  }

  private async getLatestPpfd(device_id): Promise<number> {
    const lux = await this.getLatest(device_id, 'lux');
    if (lux == null || isNaN(lux)) {
      return NaN;
    }
    const cloudSettings = await this.devices.getDeviceCloudSettings(device_id);
    const factor = cloudSettings?.ppfdLuxFactor ?? DEFAULT_PPFD_LUX_FACTOR;
    return lux * factor;
  }
}
