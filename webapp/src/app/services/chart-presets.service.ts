import { Injectable } from '@angular/core';
import { ChartPreset } from '@fg2/shared-types';
import { ApiClient } from '../api/api.client';
import { api } from '../api/api.routes';

@Injectable({
  providedIn: 'root',
})
export class ChartPresetsService {
  constructor(private client: ApiClient) {}

  public async list(): Promise<ChartPreset[]> {
    return await this.client.fetch(api.chartPresets.list());
  }

  public async create(name: string, query: string, device_type?: string): Promise<ChartPreset> {
    return await this.client.fetch(api.chartPresets.create(name, query, device_type));
  }

  public async remove(preset_id: string): Promise<void> {
    await this.client.fetch(api.chartPresets.remove(preset_id));
  }
}
