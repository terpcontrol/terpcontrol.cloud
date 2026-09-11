import { MeasurementPoint } from '@fg2/shared-types';

export const DATA_SERVICE = 'DATA_SERVICE';

export interface DataServiceContract {
  getSeries(deviceId: string, measure: string, from: unknown, to: unknown, interval: unknown, method?: string): Promise<MeasurementPoint[]>;
  /** NaN where the device sent nothing recent enough, which reaches a client as null. */
  getLatest(deviceId: string, measure: string): Promise<number>;
}
