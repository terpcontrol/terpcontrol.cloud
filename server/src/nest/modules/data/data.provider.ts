export const DATA_SERVICE = 'DATA_SERVICE';

export interface DataServiceContract {
  getSeries(
    deviceId: string,
    measure: string,
    from: unknown,
    to: unknown,
    interval: unknown,
    method?: string,
  ): Promise<{ _time: string; _value: number }[]>;
  getLatest(deviceId: string, measure: string): Promise<number>;
}
