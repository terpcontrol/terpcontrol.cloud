import { Provider } from '@nestjs/common';
import { dataService } from '@services/data.service';

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

/**
 * The measurement service is still the module-level instance the Express app
 * uses. Injecting it through a token keeps the controller free of that detail,
 * so it becomes a provider proper without the controller changing.
 */
export const dataServiceProvider: Provider = { provide: DATA_SERVICE, useValue: dataService };
