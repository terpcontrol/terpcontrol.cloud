import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';

import { DataService } from './data.service';

describe('DataService', () => {
  let service: DataService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TranslateModule.forRoot(), HttpClientTestingModule, RouterTestingModule] });
    service = TestBed.inject(DataService);
    http = TestBed.inject(HttpTestingController);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('carries the measurement time alongside the value', fakeAsync(() => {
    (service as any).measure_subjects = new Map([['device-1', new Map()]]);
    (service as any).measure_times = new Map([['device-1', new Map()]]);
    const value = service.measure('device-1', 'temperature');
    const measuredAt = service.measuredAt('device-1', 'temperature');
    tick(50);

    http.expectOne(request => request.url.endsWith('/data/latest/device-1/temperature')).flush({ value: 24.8, t: 1750809600000 });

    expect(value.value).toEqual(24.8);
    expect(measuredAt.value).toEqual(1750809600000);
  }));

  it('reports an unknown measurement time as NaN', fakeAsync(() => {
    (service as any).measure_subjects = new Map([['device-1', new Map()]]);
    (service as any).measure_times = new Map([['device-1', new Map()]]);
    service.measure('device-1', 'temperature');
    const measuredAt = service.measuredAt('device-1', 'temperature');
    tick(50);

    http.expectOne(request => request.url.endsWith('/data/latest/device-1/temperature')).flush({ value: NaN });

    expect(measuredAt.value).toBeNaN();
  }));
});
