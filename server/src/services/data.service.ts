import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { INFLUXDB_BUCKET, INFLUXDB_ORG, INFLUXDB_TOKEN } from '@/config';
import { deviceService, StatusMessage } from '@services/device.service';
import { calculateVpd } from '@utils/calculateVpd';
import imageModel from '@models/images.model';
import { Image } from '@fg2/shared-types';

const INFLUXDB_DB = 'devices';
// You can generate a Token from the "Tokens Tab" in the UI

const influxdb_client = new InfluxDB({ url: 'http://influxdb:8086', token: INFLUXDB_TOKEN });
export const VALID_SENSORS = ['temperature', 'humidity', 'avg', 'p', 'i', 'd', 'co2', 'rpm', 'day', 'sensor_type', 'leaf_temperature', 'lux'];

// Lux→PPFD depends on the light spectrum, so it is a per-device calibration
// constant rather than a fixed physical conversion. Default assumes a white
// full-spectrum LED; growers can override it per device in cloud settings.
const DEFAULT_PPFD_LUX_FACTOR = 0.015;

export const VALID_OUTPUTS = ['heater', 'dehumidifier', 'co2', 'light', 'fan', 'relais', 'fan-internal', 'fan-external', 'fan-backwall'];

class DataService {
  constructor() {
    // this.influxConnect();
  }

  private async influxConnect() {
    // let names = await influxdb_client.getDatabaseNames()
    // console.log(names)
    // if (!names.includes(INFLUXDB_DB)) {
    //   return influxdb_client.createDatabase(INFLUXDB_DB);
    // }
  }

  public async addData(device_id: string, user_id: string, fields: StatusMessage) {
    // create a write API, expecting point timestamps in nanoseconds (can be also 's', 'ms', 'us')
    const writeApi = influxdb_client.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET, 'ns');
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

    const queryApi = influxdb_client.getQueryApi(INFLUXDB_ORG);
    const query = `
      from(bucket: "${INFLUXDB_BUCKET}")
        |> range(start: ${from}, stop: ${to})
        |> filter(fn: (r) => r["_measurement"] == "status")
        |> filter(fn: (r) => r["_field"] == "${measure}")
        |> filter(fn: (r) => r["device_id"] == "${device_id}")
        |> aggregateWindow(every: ${interval}, fn: ${method}, createEmpty: true)
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

    const cloudSettings = await deviceService.getDeviceCloudSettings(device_id);

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
    const cloudSettings = await deviceService.getDeviceCloudSettings(device_id);
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

    const queryApi = influxdb_client.getQueryApi(INFLUXDB_ORG);
    const query = `
      from(bucket: "${INFLUXDB_BUCKET}")
        |> range(start: -5m)
        |> filter(fn: (r) => r["_measurement"] == "status")
        |> filter(fn: (r) => r["_field"] == "${measure}")
        |> filter(fn: (r) => r["device_id"] == "${device_id}")
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
    const cloudSettings = await deviceService.getDeviceCloudSettings(device_id);

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
    const cloudSettings = await deviceService.getDeviceCloudSettings(device_id);
    const factor = cloudSettings?.ppfdLuxFactor ?? DEFAULT_PPFD_LUX_FACTOR;
    return lux * factor;
  }
}
export const dataService = new DataService();
