import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { environment } from 'src/environments/environment';
import { DeviceService } from './devices.service';

@Injectable({
  providedIn: 'root'
})
export class DataService {

  private measure_subjects: Map<string, Map<string, BehaviorSubject<number>>> = new Map<string, Map<string, BehaviorSubject<number>>>()
  private measure_avg_subjects: Map<string, Map<string, BehaviorSubject<number>>> = new Map<string, Map<string, BehaviorSubject<number>>>()

  private updateScheduled = false;

  constructor(private http: HttpClient, private devices: DeviceService) {
    this.devices.devices.subscribe((devices) => {
      // Keep existing subjects: templates hold them via async pipes, and a
      // wipe would force every gauge to resubscribe (NaN flash + re-poll)
      // after each device refetch.
      const measures = new Map<string, Map<string, BehaviorSubject<number>>>()
      const averages = new Map<string, Map<string, BehaviorSubject<number>>>()
      devices.map((device) => {
        measures.set(device.device_id, this.measure_subjects.get(device.device_id) ?? new Map<string, BehaviorSubject<number>>())
        averages.set(device.device_id, this.measure_avg_subjects.get(device.device_id) ?? new Map<string, BehaviorSubject<number>>())
      })
      this.measure_subjects = measures;
      this.measure_avg_subjects = averages;
    })

    setInterval(() => {
      this.updateMeasures();
      this.updateAverages();
    }, 10000);
  }

  /**
   * A render pass creates many subjects in a row (one per gauge); polling all
   * known measures once per creation was quadratic — ~120 requests on a
   * two-device list. One deferred sweep covers every subject just created.
   */
  private scheduleUpdate() {
    if (this.updateScheduled) {
      return;
    }
    this.updateScheduled = true;
    setTimeout(() => {
      this.updateScheduled = false;
      this.updateMeasures();
      this.updateAverages();
    }, 50);
  }

  /** One-shot latest value; null when there is no recent data point. */
  public async latest(device: string, measure: string): Promise<number | null> {
    try {
      const data: any = await firstValueFrom(this.http.get(environment.API_URL + '/data/latest/' + device + '/' + measure));
      const value = Number(data?.value);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  public measure(device:string, measure:string) : BehaviorSubject<number> {
    let sub = this.measure_subjects.get(device)?.get(measure);
    if(!sub) {
      sub = new BehaviorSubject<number>(NaN);
      this.measure_subjects.get(device)?.set(measure, sub)
      this.scheduleUpdate();
    }
    return sub;
  }

  public measureAvg(device: string, measure: string, timespan: string = '-1h', interval: string = '1m') : BehaviorSubject<number> {
    let sub = this.measure_avg_subjects.get(device)?.get(measure);
    if(!sub) {
      sub = new BehaviorSubject<number>(NaN);
      this.measure_avg_subjects.get(device)?.set(measure, sub)
      this.scheduleUpdate();
    }
    return sub;
  }

  private updateMeasures() {
    for(let device of this.measure_subjects.entries()) {
      for(let measure of device[1].entries()) {
        this.http.get<number>(environment.API_URL + '/data/latest/' + device[0] + '/' + measure[0]).subscribe((data:any) => {
          if(data && data.value != null) {
            measure[1].next(data.value);
          }
          else {
            measure[1].next(NaN);
          }
        })
      }
    }
  }

  private updateAverages() {
    for(let device of this.measure_avg_subjects.entries()) {
      for(let measure of device[1].entries()) {
        const device_id = device[0];
        const measure_name = measure[0];
        const from = '-1h';
        const to = 'now()';
        const interval = '1m';
        const query = `?from=${from}&to=${to}&interval=${interval}`;
        this.http.get<any>(environment.API_URL + '/data/series/' + device_id + '/' + measure_name + query).subscribe((rows:any[]) => {
          if(Array.isArray(rows) && rows.length > 0) {
            const values = rows.map(r => r._value).filter((v:any) => typeof v === 'number' && !isNaN(v));
            if(values.length > 0) {
              const avg = values.reduce((a:number,b:number)=>a+b,0) / values.length;
              measure[1].next(avg);
              return;
            }
          }
          measure[1].next(NaN);
        }, _err => {
          measure[1].next(NaN);
        });
      }
    }
  }

  public async getSeries(device_id: string, measure: string, from: string, interval: string, to: string = 'now()', method: string = 'mean'): Promise<[number, number][]> {
    let query = `?from=${from}&to=${to}&interval=${interval}&method=${method}`;
    let data:any = await firstValueFrom(this.http.get(environment.API_URL + '/data/series/' + device_id + '/' + measure + query))
    return data.map((row: any) => {return [new Date(row._time).getTime(), row._value]});
  }

  public async getLatest(device_id: string, measure: string): Promise<number> {
    let data = await firstValueFrom(this.http.get<number>(environment.API_URL + '/data/latest/' + device_id + '/' + measure))
    return data;
  }

}
