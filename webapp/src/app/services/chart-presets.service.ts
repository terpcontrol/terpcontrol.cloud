import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChartPreset } from '@fg2/shared-types';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ChartPresetsService {
  constructor(private http: HttpClient) {}

  public async list(): Promise<ChartPreset[]> {
    return await firstValueFrom(this.http.get<ChartPreset[]>(environment.API_URL + '/chartpresets'));
  }

  public async create(name: string, query: string, device_type?: string): Promise<ChartPreset> {
    return await firstValueFrom(this.http.post<ChartPreset>(environment.API_URL + '/chartpresets', { name, query, device_type }));
  }

  public async remove(preset_id: string): Promise<void> {
    await firstValueFrom(this.http.delete(environment.API_URL + '/chartpresets/' + preset_id));
  }
}
