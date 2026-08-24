# Terp Control — Charts subsystem & data pipeline (code map, ground truth)

Repo: `/home/user/terpcontrol.cloud`, branch `claude/controller-software-user-types-wc1jxn`.
Everything below was read from source. Line numbers are from the files as they exist on this branch.

---

## 0. File inventory

| Concern | Path |
| --- | --- |
| Charts page (the whole feature, one component) | `webapp/src/app/device/charts/charts.page.ts` (1205 lines) |
| Charts template | `webapp/src/app/device/charts/charts.page.html` (328 lines) |
| Charts styles | `webapp/src/app/device/charts/charts.page.scss` (239 lines) |
| Charts NgModule | `webapp/src/app/device/charts/charts.module.ts` |
| Charts routing | `webapp/src/app/device/charts/charts-routing.module.ts` |
| Charts spec (stub only) | `webapp/src/app/device/charts/charts.page.spec.ts` (24 lines, "should create") |
| Curated presets | `webapp/src/app/util/chart-presets.ts` |
| Highcharts i18n helper | `webapp/src/app/util/highcharts-locale.ts` |
| Series HTTP client | `webapp/src/app/services/data.service.ts` |
| Preset HTTP client | `webapp/src/app/services/chart-presets.service.ts` |
| Share links | `webapp/src/app/services/share.service.ts`, `webapp/src/app/components/share-link/share-link-modal.component.ts` |
| Server: series API | `server/src/controllers/data.controller.ts`, `server/src/routes/data.route.ts` |
| Server: Influx access | `server/src/services/data.service.ts` (218 lines — the *only* place Influx is touched) |
| Server: presets | `server/src/models/chartpreset.model.ts`, `controllers/chartpreset.controller.ts`, `routes/chartpreset.route.ts` |
| Server: sample ingest | `server/src/services/device.service.ts:154-220` (MQTT dispatch), `:552-557` (`statusMessage`) |
| Server: webcam stills + timelapse | `server/src/services/image.service.ts`, `controllers/image.controller.ts` |
| Shared types | `shared-types/index.d.ts` (`ChartPreset` :269-278, `ShareLink` :74-93, `DeviceLog` :219-231, `Image` :233-241) |
| Admin clone of the charts page | `webapp/src/app/diagnostics/diagnostics.page.ts` (198 lines) |

---

## 1. Chart library, version, wiring

**Highcharts Stock 10.3.3** via **highcharts-angular 3.0.0**. `chart.js 4.2.0` + `ng2-charts 4.1.1` +
`chartjs-adapter-luxon 1.3.0` are also installed and imported, but render nothing on this page — dead legacy.

Exact versions from `webapp/package-lock.json`:

```
node_modules/highcharts            10.3.3
node_modules/highcharts-angular    3.0.0
node_modules/chart.js              4.2.0
node_modules/ng2-charts            4.1.1
node_modules/chartjs-adapter-luxon 1.3.0
```

Wiring, `webapp/src/app/device/charts/charts.page.ts:1-30`:

```ts
import {ChartType} from 'chart.js';                    // :2  — only used for `lineChartType`, never rendered
import {BaseChartDirective} from 'ng2-charts';         // :3  — @ViewChild'd at :213, never used
import 'chartjs-adapter-luxon';                        // :4  — side-effect import, unused
import * as Highcharts from 'highcharts/highstock';    // :7
import {YAxisOptions} from 'highcharts/highstock';     // :8

declare var require: any;                              // :22
let Boost = require('highcharts/modules/boost');       // :23
let noData = require('highcharts/modules/no-data-to-display');
let More = require('highcharts/highcharts-more');

Boost(Highcharts);                                     // :27
noData(Highcharts);                                    // :28
More(Highcharts);                                      // :29
noData(Highcharts);                                    // :30  — registered twice (copy/paste)
```

Both chart stacks are imported in the NgModule (`charts.module.ts:8-9`, `:22-23`):
`NgChartsModule` **and** `HighchartsChartModule`. `webapp/src/app/device/diary/diary.module.ts:7-8` imports both too
and uses **neither** (the diary has no chart; it only *links* to the charts page).

Template, `charts.page.html:261-267` — a single `<highcharts-chart>` in Stock mode:

```html
<highcharts-chart
  *ngIf="loaded"
  [Highcharts]="Highcharts"
  constructorType="stockChart"
  [options]="chartOptions"
  [(update)]="updateFlag"
  (chartInstance)="onChartInstance($event)"></highcharts-chart>
```

The whole option object is rebuilt on every load (`charts.page.ts:844-846`) and pushed by flipping `updateFlag`.
No `Highcharts.Chart` API is used except `reflow()`/`redraw()`/`zoomOut()` (`:1021`, `:1197-1204`).

Locale: `applyHighchartsLocale()` (`webapp/src/app/util/highcharts-locale.ts:27-46`) sets month/weekday names,
decimal separator, `lang.noData` etc. and disables the credits line. Called once in `ngOnInit` (`charts.page.ts:494`).

**Missing/never used:** `highcharts/modules/annotations`, `flags` series, `xrange`, `heatmap`, `plotBands`,
`plotLines`, `Highcharts.Chart.addSeries`/`setData` (no incremental update), `boost` configuration,
`dataGrouping` configuration, `tooltip.shared`, `crosshair`, `exporting`/CSV download.

---

## 2. Exact data flow: device sample → storage → API → chart

### 2.1 Device → MQTT

Firmware buffers samples and publishes them in bulk.
`firmware/src/fridgecloud.h:31-33`:

```cpp
static constexpr unsigned int MAX_BUFFER_LEN = 120;
static constexpr unsigned int SAMPLE_INTERVAL = 5;
static constexpr unsigned int UPLOAD_INTERVAL = 1;
```

`firmware/src/fridgecloud.cpp:479-529` (`Fridgecloud::updateStatus`): every 5th call it stamps the JSON with the
device's epoch seconds (`status["timestamp"] = epochTime`), pushes it into `status_buffer`, and because
`UPLOAD_INTERVAL == 1` immediately calls `uploadStatus()`, which publishes to `/devices/<id>/bulk`
(`:112-113`, `:531-553`). Buffer overflow logs `message-buffer-overflow`.

Payload shape (`server/src/services/device.service.ts:33-40`):

```ts
export type StatusMessage = {
  sensors: { [key: string]: number };
  outputs: { [key: string]: number };
  timestamp: number;   // epoch SECONDS, device clock
};
```

What a Controller sends (`firmware/src_hwtype/controller/controller.cpp:970-990`):
`sensors.temperature`, `sensors.humidity`, `sensors.sensor_type`, `sensors.co2` (-1 when no sensor),
optional `sensors.leaf_temperature` (MLX90632), optional `sensors.lux` (VEML7700);
`outputs.dehumidifier`, `outputs.heater`, `outputs.light`, `outputs.co2`.

### 2.2 MQTT → server

`server/src/services/device.service.ts:158-215` subscribes to `/devices/#` and switches on `topic.split('/')[3]`:

* `case 'status'` (:166-169) — `this.statusMessage(device, { ...JSON.parse(msg), timestamp: undefined })`
  → **server clock is used**.
* `case 'bulk'` (:170-173) — `this.statusMessage(device, JSON.parse(msg))` → **device clock is used**.
* `case 'log'` (:184-194) → Mongo `devicelogs`.
* `case 'configuration'` (:196-198) → `settingsMessage()` → overwrites `device.configuration` (a JSON **string**).

`statusMessage` (:552-557) fans out to exactly two consumers:

```ts
await dataService.addData(device.device_id, device.owner_id, message);
await alarmService.onDataReceived(device.device_id, message);
```

### 2.3 Server → InfluxDB (write)

`server/src/services/data.service.ts:34-63`:

```ts
const writeApi = influxdb_client.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET, 'ns');
writeApi.useDefaultTags({ device_id: device_id, user_id: user_id });
const point1 = new Point('status');
for (const sensor of VALID_SENSORS)  if (fields.sensors[sensor]  != null) point1.floatField(sensor, ...);
for (const output of VALID_OUTPUTS)  if (fields.outputs[output] != null) point1.floatField('out_' + output, ...);
const timestamp = fields.timestamp && fields.timestamp > 0 ? fields.timestamp * 1000000000 : new Date();
point1.timestamp(timestamp);
writeApi.writePoint(point1); await writeApi.close();
```

* Measurement: **`status`**. Tags: `device_id`, `user_id`. Fields: one float per sensor/output.
* Allowlists (`data.service.ts:12` and `:19`) — this is the canonical field vocabulary:

```ts
export const VALID_SENSORS = ['temperature','humidity','avg','p','i','d','co2','rpm','day','sensor_type','leaf_temperature','lux'];
export const VALID_OUTPUTS = ['heater','dehumidifier','co2','light','fan','relais','fan-internal','fan-external','fan-backwall'];
```

  Outputs are stored prefixed: `out_heater`, `out_light`, `out_fan-backwall`, …
* Client: `new InfluxDB({ url: 'http://influxdb:8086', token: INFLUXDB_TOKEN })` — **host hardcoded**
  (`data.service.ts:11`) even though `docker-compose.yaml:107` passes `INFLUXDB_HOST`.
* A fresh `WriteApi` is created **and closed per sample** — no batching at all.
* `const INFLUXDB_DB = 'devices'` (`:8`) and `influxConnect()` (`:26-32`) are dead code.

### 2.4 API

`server/src/routes/data.route.ts`:

* `GET /data/series/:device_id/:measure?from=&to=&interval=&method=` → `:63`
* `GET /data/latest/:device_id/:measure` → `:94`
* `GET /chartpresets`, `POST /chartpresets`, `DELETE /chartpresets/:preset_id` (`chartpreset.route.ts:34,71,96`)
* `GET /device/logs/:device_id?from=&to=&deleted=&categories=` (`device.route.ts:1147`)
* `GET /image/:device_id?timestamp=&format=&duration=&image_id=&token=&share=` (`image.route.ts`)

`data.controller.ts:7-24` — auth via `isUserDeviceOrShareMiddelware` (owner, admin, demo device, or a valid share
link), then straight into the service. Responds **`201`** to a GET (`:18`, `:30`) — cosmetic wart, but the webapp
does not care.

Read query, `server/src/services/data.service.ts:79-95`:

```ts
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
return rows.map((row: any) => ({ _time: row._time, _value: row._value }));
```

`method` is allowlisted to `['mean','min','max','sum']` (`:74-78`). **`from`, `to`, `interval` and `measure` are
not validated at all** — they are interpolated raw into Flux (see §8 Risks).

Two virtual measures are computed server-side, not stored:

* **VPD** — `getSeriesVpd` (`:97-142`). Fires **four** more `getSeries` calls (temperature, humidity, out_light,
  leaf_temperature), joins them on the aggregation timestamp string, reads `cloudSettings` from Mongo, decides
  day/night from `out_light > 0.5`, and computes `calculateVpd(temp, leafTemp, humidity)`.
  `leafTemperature()` (`:144-152`) prefers a measured MLX90632 value, else `airTemp + cloudSettings.vpdLeafTempOffsetDay|Night`.
  `measure` may be `vpd`, `vpd_day`, `vpd_night`; the filtered-out half becomes `NaN` → serialised by
  `res.json` as **`null`**.
* **PPFD** — `getSeriesPpfd` (`:154-160`): `lux * (cloudSettings.ppfdLuxFactor ?? 0.015)` (`DEFAULT_PPFD_LUX_FACTOR`, `:17`).

`getLatest` (`:162-189`) is a separate query, hardcoded to `range(start: -5m) |> aggregateWindow(every: 5m, fn: last)`.
It feeds the gauges on the overview pages via `DataService.measure()` polling every 10 s
(`webapp/src/app/services/data.service.ts:32-35, 86-99`).

### 2.5 API → chart

`webapp/src/app/services/data.service.ts:127-131`:

```ts
public async getSeries(device_id, measure, from, interval, to = 'now()', method = 'mean'): Promise<[number, number][]> {
  let query = `?from=${from}&to=${to}&interval=${interval}&method=${method}`;
  let data: any = await firstValueFrom(this.http.get(environment.API_URL + '/data/series/' + device_id + '/' + measure + query));
  return data.map((row: any) => [new Date(row._time).getTime(), row._value]);
}
```

Note the **argument order differs from the server's** (`from, interval, to` here vs `from, to, interval` in
`dataService.getSeries`) — a trap that has already been stepped in once elsewhere
(`webapp/src/app/device/diary/co2-report/co2-report.component.ts:79` gets it right only by luck of naming).

`ChartsPage.loadData()` (`charts.page.ts:706-885`) is the whole rendering pipeline:

1. `:716-719` compute `from`/`to` as ISO strings from `selectedDate` (or `now - timespan`) + timespan duration.
2. `:721-727` assign axis sides: first enabled measure gets `nav: true` (shown in the navigator), then
   alternate `right` left/right/left/… .
3. `:737-767` build **one yAxis per *filtered* measure** (enabled or not) with `softMin: 0`, `softMax: measure.max`,
   `opposite: measure.right`, `visible: showAxisLabels ? measure.enabled : false`, `zoomEnabled: false`,
   8px labels, unit suffix via `Highcharts.numberFormat`. `measure.axis = axis` is monkey-patched onto the object (`:766`).
4. `:769-797` `Promise.all` over all filtered measures; each enabled one issues one HTTP request. Series are
   `type: "area"`, `fillOpacity: 0.1`, `threshold: null`, `tooltip.valueDecimals: 2`, `valueSuffix: unit`.
   A trailing `null` point is popped (`:775-777`) and the array is re-sorted by x (`:779`).
5. `:799` if `showLogs`: `devices.getLogs(device_id, fromMs, toMs, true)` — note `deleted = true`, so
   soft-deleted entries (which is how **configuration-change logs** are stored) are included.
6. `:802-831` push three extra `column` series (Info/Warning/Critical), each on its own hidden `min:0, softMax:1` axis.
7. `:833-835` stale-response guard via `currentDataLoadStartTime`.
8. `:842-847` set `chart.animation`, re-apply theme, assign `yAxis`/`series`, flip `updateFlag`.
9. `:855-860` pick the webcam still/timelapse timestamp and load it.
10. `:868-884` serialise the whole view into query params and `router.navigate(..., {replaceUrl: true})`.

---

## 3. Time ranges, intervals, payload size, downsampling

### Timespans — `charts.page.ts:75-110` (13 entries)

| name | duration | defaultInterval | highlight (quick button) | imageIntervalMs (timelapse allowed) |
| --- | --- | --- | --- | --- |
| 20m | 20 m | 5s | | |
| 1h | 1 h | 10s | ✔ | |
| 6h | 6 h | 10s | | |
| 12h | 12 h | 10s | | |
| 1d | 24 h | 20s | ✔ | 86400000 |
| 3d | 3 d | 1m | ✔ | |
| 1w | 7 d | 15m | ✔ | 7×86400000 |
| 2w | 14 d | 30m | | |
| 1m | 30 d | 1h | ✔ | 30×86400000 |
| 3m | 90 d | 4h | | |
| 6m | 180 d | 1d | | |
| 1y | 1 y (31536000000 ms) | 1w | | |
| 3y | 3 y | 1w | | |

### Intervals — `charts.page.ts:112`

`['5s','10s','20s','1m','5m','15m','30m','1h','4h','1d','1w']` — a flat list, **not filtered by the selected
timespan**. Selecting a timespan resets the interval to its default (`:1034-1039`), but the user can then pick any
interval, including `3y` × `5s`.

### Points per request (interval is the only lever)

* `1d` @ `20s` (default) = **4 320 points per series**
* `1h` @ `10s` = 360
* `1w` @ `15m` = 672
* `1m` @ `1h` = 720
* `3y` @ `1w` = 156
* Worst legal case `3y` @ `5s` ≈ **18.9 million windows** requested from Influx.

`createEmpty: true` means gaps are materialised as `null` rows, so the row count is `range / interval` regardless
of how much data actually exists.

### Downsampling — what exists and what does not

* **Storage:** none. The bucket is created by `docker-compose.yaml:38-43` with no
  `DOCKER_INFLUXDB_INIT_RETENTION`, i.e. **infinite retention**, and there are **no Influx tasks / continuous
  queries / downsampled buckets anywhere in the repo**. Raw 5-second samples are kept forever.
  (Compare: webcam JPEGs *are* thinned and expired — `image.service.ts:62-71`, `IMAGE_RETENTION_DAYS = 3*365`.)
* **Query time:** `aggregateWindow(every: interval, fn: method)` is the only aggregation, and the interval comes
  straight from the UI dropdown.
* **Client:** Highcharts **Stock** has `dataGrouping` enabled by default (nothing in this codebase disables or
  configures it), so the *displayed* series is grouped down to roughly pixel resolution with `average`
  approximation for `area` series. This is invisible in the code and is the only thing keeping a 4 320-point
  render cheap. `dataGroup` is read once, at `charts.page.ts:274-275`, to map a hovered log column back to the
  individual log timestamps it groups.
* **Boost:** the module is registered (`:23`, `:27`) but never configured. With Stock dataGrouping active it will
  rarely engage; Highcharts' default `boostThreshold` is 5 000 points per series.
* The `|> limit(n: 50000)` at `data.service.ts:88` sits **after `|> yield()`**, so it does not cap the yielded
  result (at best it is a no-op; at worst Flux emits a second, duplicate result set that `collectRows` also
  returns). Either way there is **no effective server-side cap on response size**.

---

## 4. Setpoints / targets — what exists, what is missing

**Short answer: no. Nothing in the charts pipeline knows what the device was *supposed* to be doing.**

* The chart only ever plots Influx fields from measurement `status` — measured sensor values and actuator
  outputs. There is no `target`/`setpoint` field in `VALID_SENSORS`/`VALID_OUTPUTS`
  (`server/src/services/data.service.ts:12,19`) and the firmware never publishes one
  (`firmware/src_hwtype/controller/controller.cpp:970-990`).
* Setpoints live in **Mongo, as a single JSON string, current-value-only**:
  `Device.configuration: string` (`shared-types/index.d.ts:164`), written by
  `deviceService.configureDevice()` (`device.service.ts:1140-1162`) and by the device's own echo
  `settingsMessage()` (`:817-819`). Structure (from `webapp/src/app/devices/fridge/settings/configuration/configuration.component.html`):
  `settings.day.temperature`, `settings.day.humidity`, `settings.night.*`, `settings.daynight.day|night|floating|float_start|day_duration|light_duration`, `settings.lights.limit`, `settings.workmode`, `settings.co2`.
  **There is no history collection, no versioning, no `updatedAt` per key.**
* The only trace of past setpoints is a *log line*: `configureDevice` diffs old vs new config
  (`diffConfigs`, `device.service.ts:1164-1195`) and writes a `DeviceLog` with
  `title: 'message-device-configuration-updated'`, `message: 'message-device-configuration-updated:<multi-line text diff>'`,
  `categories: ['device','device-configuration']`, **`deleted: true`** (`:1150-1157`).
  The text is human-readable only (`    day.temperature: 24 -> 26`) — parsing it back into numbers is possible but
  ugly. Because the charts page fetches logs with `deleted = true` (`charts.page.ts:799`), these entries *do*
  already reach the chart, as anonymous info-severity columns.
* Target **bands** exist in the webapp but never reach the chart: `GROW_STAGE_PRESETS`
  (`webapp/src/app/util/grow-presets.ts:37-...`, interface at `:13-28`) carries `dayTemperature`, `nightTemperature`, `dayHumidity`,
  `nightHumidity`, `lightHours`, `lightLimit`, `co2Enriched`, `co2Ambient` and an explicit
  **`vpdRange: [min, max]`** per stage (seedling `[0.4,0.8]`, vegetative `[0.8,1.1]`, …). These drive the stage
  preset picker and the grow assistant only.
* **Alarm thresholds** are also available per device and unused by the chart:
  `Alarm.upperThreshold` / `lowerThreshold` (`shared-types/index.d.ts:6-7`), stored on `Device.alarms`
  (`:173`). Ready-made values in `webapp/src/app/util/alarm-presets.ts` (e.g. heat_day upper 30 °C,
  humidity_high 60 % in flowering / 75 % otherwise).
* `Recipe` / `RecipeStep` (`shared-types/index.d.ts:133-154`) carries `settings: any` per step plus
  `activeSince`, `activeStepIndex`, `lastTimeApplied` and `stage`. A recipe timeline *is* effectively a schedule of
  setpoints, but only the active step's settings are ever applied; there is no stored record of which step was
  active at time T.

**What plotting goal-vs-actual would need:**
1. A time-series of the setpoint — either write `target_temperature` / `target_humidity` / `target_co2` /
   `target_vpd` as Influx fields on each sample (cheapest: the server already has `device.configuration` in hand
   inside `statusMessage`), or a proper `configuration_history` Mongo collection with typed values.
2. A day/night resolver, because the target alternates: today `out_light > 0.5` is the only day/night signal
   available to the server (`data.service.ts:130`), and the schedule (`daynight.day`/`night` seconds-of-day,
   or `floating` + `float_start` + `day_duration`) is only parsed in the webapp.
3. Chart-side support: Highcharts `plotBands`/`plotLines` per yAxis, or a second step-line series
   (`step: 'left'`). Neither is used anywhere today.

---

## 5. Events / log entries on charts today

They exist, but as three plain column series, not annotations.

`charts.page.ts:802-831`:

```ts
[0, 1, 2].forEach(severity => {
  const logs = deviceLogs.filter(l => l.severity === severity)
                         .filter(l => matchesLogCategory(l, this.selectedLogCategories));
  series.push({
    name: severity == 2 ? 'Critical logs' : (severity == 1 ? 'Warning logs' : 'Info logs'),
    type: 'column',
    data: logs.map(log => [log.time.getTime(), 1]),
    yAxis: yAxis.length,
    color: severity == 2 ? theme.logColors.critical : (severity == 1 ? theme.logColors.warning : theme.logColors.info),
    visible: true, grouping: true, ...
  });
  yAxis.push({ min: 0, softMax: 1, visible: false, zoomEnabled: false, ... });
});
```

* Every log becomes a bar of constant height 1 on a hidden 0..1 axis. There is no title, no icon, no message on
  the chart itself — only colour by severity.
* These three series are pushed **unconditionally**, even when `showLogs` is false (then with empty data), so the
  legend always shows three log entries.
* Hovering a column (`plotOptions.series.point.events.mouseOver`, `:262-280`) reads `target.dataGroup` to recover
  every log timestamp inside the grouped bar, writes them into `selectedLogs` and re-runs `filterLogs()` — the
  side list (`charts.page.html:290-324`) then narrows to those entries. That is the whole "click an event to read
  it" interaction, and it is hover-driven, so it does not work on touch.
* The side list is `app-log-entry-viewer` with client-side de-duplication of consecutive identical lines
  (`filterLogs`, `:1131-1184`, produces a `count` badge) and 100-per-page pagination
  (`log-entry-viewer.component.ts:4`, `:60-80`). Category filtering via `app-log-category-selector`
  (`charts.page.html:299-303`), state kept in the `logs` query param.
* Highstock's native `flags` series type — the obvious right tool — is **not used anywhere**.
* Diary entries are the same `DeviceLog` documents (`data?: Partial<DiaryEntryData>`, `images?: string[]`,
  `shared-types/index.d.ts:219-231`), so photos and measurements (pH, EC, TDS, light, distance) already sit on the
  same timeline and are already fetched — but the chart only ever reads `log.time` and `log.severity`.

---

## 6. Webcam / timelapse integration with charts

Two modes, decided by `isAnimatedImage()` (`charts.page.ts:1112-1114`):

```ts
isAnimatedImage(): boolean {
  return this.showImage && !this.hasEnabledMeasures() && !this.autoUpdate;
}
```

* **Still (jpeg)** — whenever any measure is enabled. `loadDeviceImage(timestamp)` (`:1081-1103`) builds
  `GET /image/<device_id>?timestamp=…&token=…&share=…&format=jpeg&duration=` and binds it to
  `<img>` (`charts.page.html:271`). The timestamp is whatever the mouse last hovered
  (`plotOptions.series.point.events.mouseOver` at `:263-270`, debounced by `IMAGE_LOAD_DELAY_MS = 500`, `:34`),
  or the last data point after a reload (`:855-859`). **This is the "scrub the chart, watch the tent" feature.**
* **Timelapse (mp4)** — only when *no* measure is enabled, image on, auto-update off. Then
  `format='mp4'`, `duration = selectedTimespan.name`, and the chart column is replaced by a looping muted
  `<video>` with a manual progress bar (`charts.page.html:272-286`, `onVideoTimeUpdate` `:1105-1110`).
  Only the timespans carrying `imageIntervalMs` (`1d`, `1w`, `1m`) are offered
  (`getAvailableTimespans()`, `:613-616`), and the timespan is force-corrected at `:861-863`.
  `getAnimatedImageTimestamp()` (`:679-682`) deliberately uses the **window end** rounded up to 5 s, because the
  server picks the video whose aligned start is `<= timestamp`.
* Layout: when image or logs are on, the chart column shrinks to 50 % (`charts.page.html:260`, `:269`).
* The camera toggle is hidden unless `cloudSettings.rtspStream` is set (`charts.page.html:89`, forced off at
  `charts.page.ts:540-542`).

Server side, `server/src/services/image.service.ts`:

* Stills are pulled from the RTSP stream / P2P camera every `IMAGE_LOAD_INTERVAL_MS = 30_000` (`:36`) and stored
  as `Image` documents in **Mongo** (`models/images.model.ts`, `format: 'jpeg' | 'mp4' | 'user/jpeg'`).
* Timelapses are rebuilt hourly (`COMPRESS_INTERVAL_MS`, `:38`) by `compressRtspStreamRange`
  (`:315-400`) for three durations: `1d` (frame every 2 min), `1w` (14 min), `1m` (60 min), at
  `TIMELAPSE_FRAME_RATE = 25` fps (`:73-74`), via `ffmpeg` (`:567-604`), throttled by
  `pLimit(10)` (`:78`) and `FFMPEG_THROTTLE_MS` (`:49`). Refresh throttles: daily 1 h, weekly 4 h, monthly 12 h
  (`:45-47`).
* Retention: raw JPEGs expire after `3*365` days (`:62`, `:286-294`) and are progressively thinned
  (`IMAGE_THINNING_TIERS`, `:66-71`: >1 d → 1/min, >7 d → 1/5 min, >30 d → 1/15 min, >90 d → 1/h).
* `GET /image/:device_id` (`controllers/image.controller.ts:47-80`) uses a separate `'image'` token type,
  refuses webcam stills to share links without `share.webcam` (`:52-55`), falls back to
  `assets/no-image_placeholder.{mp4,png}` and stamps an "Offline since …" caption on stale latest stills
  (`:168-177`).

---

## 7. Share links (`page='charts'`) and view reconstruction

**The URL *is* the view model.** `loadData()` writes it, `applyViewParams()` reads it, share links and presets
both store the same query string.

Serialised params — `charts.page.ts:868-883`:

| param | value |
| --- | --- |
| `measures` | comma list of enabled measure `name`s **plus** the pseudo-measures `image` and `logs` |
| `date` | ISO start of the window (`''` = live) |
| `dateEnd` | ISO end; when both set, a fixed range (timespan controls hidden) |
| `vpdMode` | `all` \| `day` \| `night` (only when vpd enabled) |
| `autoUpdate` | `'true'`/`'false'` |
| `useCustom` | `'true'`/`'false'` — whether the detailed timespan/interval row is shown |
| `timespan` | timespan `name` (`1d`, `1w`, …) |
| `interval` | interval string (`20s`, `1h`, …) |
| `logs` | comma list of selected log categories |
| `share` | the share token, re-appended when present |

Reconstruction — `applyViewParams(queryParams)` (`:565-600`): sets `measure.enabled` per name, `showImage` /
`showLogs` from the pseudo-measures, `vpdMode`, `autoUpdate`, `useCustom`, timespan (which also resets the
interval to the timespan default, `:585`) then interval, `date`/`dateEnd`, `logs`. Any `date` forces
`autoUpdate = false` (`:597-599`).

Creating a link — `ShareLinkModalComponent.createLink()`
(`webapp/src/app/components/share-link/share-link-modal.component.ts:64-87`): it grabs
`window.location.search`, deletes `share`, and posts it as `query` together with
`page: 'charts'`, `editable`, `webcam: webcamActive`, `expires_at`. The charts page passes
`webcamActive: this.showImage` (`charts.page.ts:1065-1075`).

Opening a link:

1. `AuthGuard.canActivateSharedRoute` (`webapp/src/app/auth/auth.guard.ts:36-66`) maps the route path to a
   `SharePage`, resolves the token, and allows it when `share.page === page` **or** (`page === 'charts'` and
   `share.charts` — the diary-link-with-charts case, `:49`).
2. `ChartsPage.ngOnInit` (`:510-527`) resolves access info, computes
   `locked = !!share && !share.editable && share.page !== 'diary'`, then applies **either** the link's stored
   query (`Object.fromEntries(new URLSearchParams(share.query))`) when locked, **or** the live URL params.
3. `locked` hides every control (`charts.page.html:76`, `:117`, `:131`, `:236`, `:298`) and the preset bar
   (`charts.page.ts:534`).
4. `ShareService.linkFor()` (`share.service.ts:86-90`) rebuilds
   `${origin}/device/${device_id}/${page}?${query}&share=${share_id}`.
5. The token rides on every API call as the `X-Share-Token` header (`auth/auth.interceptor.ts:69`) and as
   `&share=` on image URLs (`devices.service.ts:249-251`).

Other entries into the charts URL:

* Grow report per-cycle / per-phase link (`device/diary/grow-report/grow-report.component.ts:641-656`):
  `{ date, dateEnd, measures: 'temperature,image,logs', useCustom: 'true', vpdMode: 'day', interval: '1h', logs, share? }`.
* Grow assistant card (`components/grow-assistant/grow-assistant-card.component.ts:206-213`):
  drying → `{measures:'temperature,humidity', timespan:'2w'}`, otherwise `{measures:'temperature,humidity,vpd', timespan:'1d'}`.
* Fridge overview gauge click (`devices/fridge/overview/overview.component.ts:352-354`): `{ measures: <one name> }`.

### Presets

Stored server-side as the *same* query string. `ChartPreset` (`shared-types/index.d.ts:269-278`):
`preset_id, owner_id, name, device_type?, query, createdAt`. Mongo schema `server/src/models/chartpreset.model.ts`
(`owner_id` indexed, `preset_id` unique). Controller limits (`chartpreset.controller.ts:6-8`):
50 presets/user, name ≤ 60 chars, query ≤ 2000 chars.

`buildPresetQuery()` (`charts.page.ts:924-941`) deliberately omits `date`, `dateEnd`, `autoUpdate` and `share`.
Curated presets (`webapp/src/app/util/chart-presets.ts:15-21`) are hardcoded client-side and offered only when the
device provides at least `min(2, preset.measures.length)` of the required measures (`:23-28`):

```ts
{ id: 'climate', measures: ['temperature','humidity','vpd'],            timespan: '1d' }
{ id: 'vpd',     measures: ['vpd'],                                      timespan: '1w', vpdMode: 'day' }
{ id: 'co2',     measures: ['co2','out_co2'],                            timespan: '1d' }
{ id: 'light',   measures: ['out_light','leaf_temperature','ppfd'],      timespan: '1d' }
{ id: 'drying',  measures: ['temperature','humidity'],                   timespan: '2w' }
```

The preset bar is only shown for a logged-in owner: `!isPublic && !locked && !shareToken && !!auth.current_user.value`
(`charts.page.ts:534`).

---

## 8. Measures / series definition and labelling per device type

**One hardcoded array, `charts.page.ts:118-150`.** Filtered by device type at `:529-530`:
`this.filtered_measures = this.measures.filter(m => m.types.includes(this.device_type))`.

| name | title (hardcoded EN) | unit | `max` (softMax) | `method` | device types |
| --- | --- | --- | --- | --- | --- |
| `temperature` | Temperature | °C | 30 | mean | fridge, fridge2, fan, light, plug, dryer, controller |
| `humidity` | Humidity | % | 100 | mean | same as above |
| `vpd` | VPD | kPa | 1.6 | mean | same as above |
| `co2` | CO2 | ppm | **1** | mean | fridge, fridge2, plug, controller |
| `leaf_temperature` | Leaf Temperature | °C | 30 | mean | controller |
| `ppfd` | PPFD | µmol/m²/s | 1000 | mean | controller |
| `out_heater` | Heater | – | 1 | mean | fridge, fridge2, dryer, controller |
| `out_dehumidifier` | Dehumidifier | – | 1 | mean | fridge, fridge2, dryer, controller |
| `out_fan` | Fan | % | 1 | mean | fan |
| `out_co2` | CO2 Valve | ` ticks` | – | **sum** | fridge, fridge2, controller |
| `out_light` | Lights | – | 100 | mean | fridge, fridge2, light, controller |
| `day` | Day | – | 1 | mean | fan |
| `out_fan-internal` | Fan (internal) | – | 1 | mean | fridge, fridge2 |
| `out_fan-external` | Fan (external) | – | 1 | mean | fridge, fridge2 |
| `out_fan-backwall` | Fan (backwall) | – | 1 | mean | fridge, fridge2 |

Plus commented-out `avg`, `p`, `i`, `d` at `:132`, `:139-141`.

Each entry also carries `icon` (→ `assets/icon/<icon>.svg` and `<icon>_off.svg`, `charts.page.html:79-80`),
`color` (light theme) and a `txt` field that is **never read anywhere**.

Labelling:

* `title` goes into `series.name` → legend + tooltip. **Hardcoded English, never passed through
  `TranslateService`.** Same for `'Critical logs' / 'Warning logs' / 'Info logs'` (`:808`).
  Only the chrome (`charts.title`, `charts.timespan`, `charts.interval`, `charts.vpd-mode.*`, `chartPresets.*`)
  is translated — see `webapp/src/assets/i18n/en.json` keys `charts` and `chartPresets`.
* Dark-mode colours are a **second, parallel palette** keyed by measure name
  (`theme.measureColorOverrides`, `:359-375`) that must be kept in sync with the `color` field by hand.
* Units are appended twice: once in the axis label formatter (`:748-750`) and once in `tooltip.valueSuffix` (`:794`).

**Four different vocabularies for the same physical quantity:**

1. firmware/MQTT: `sensors.temperature`, `outputs.heater`
2. Influx fields: `temperature`, `out_heater` (`server/src/services/data.service.ts:12,19`)
3. chart measure names: Influx names + virtual `vpd`, `vpd_day`, `vpd_night`, `ppfd`
4. alarm `sensorType`: `temperature`, `humidity`, `co2`, `co2_valve`, `dehumidifier`, `fan`, `heater`, `light`
   (`server/src/services/alarm.service.ts:338-359` — note `heater` is multiplied by 100 there, `:353`)

`sensor_type`, `rpm`, `lux`, `avg`, `p`, `i`, `d`, `out_relais` are written to Influx but have no chart measure.

---

## 9. Concrete performance limits

* **Requests per render:** one HTTP request per enabled measure, in parallel (`charts.page.ts:769-797`), plus one
  for logs, plus one image URL. Enabling VPD costs **4 extra Influx queries + 1 Mongo read** on the server
  (`data.service.ts:98-123`); enabling PPFD costs 1 extra Influx query + 1 Mongo read.
  So "Climate check" (temperature + humidity + vpd) = 3 HTTP requests → **6 Influx queries**.
* **Points per series:** 4 320 at the `1d`/`20s` default; user-selectable up to ~18.9 M windows (`3y` @ `5s`).
  No UI guard, no server cap that works (§3).
* **Series count:** measures (≤ 15) + 3 log series. yAxis count = filtered measures + 3, all overlaid on one plot
  area.
* **Auto-update:** a full re-fetch of *everything* every 10 s (`charts.page.ts:549-557`) — no incremental
  `series.addPoint`, no `?since=` parameter. At `1d`/`20s` with 3 measures that is 3 × 4 320 points re-downloaded
  and re-parsed six times a minute, plus a `router.navigate` per cycle (`:884`).
* **Hover cost:** `plotOptions.series.point.events.mouseOver` fires for **every** point and schedules a 500 ms
  `setTimeout` calling `loadDeviceImage()` (`:263-270`) — which awaits `auth.getImageToken()` — even when
  `showImage` is false (the early return is inside `loadDeviceImage`, `:1082-1084`). Sweeping the mouse across a
  chart queues hundreds of timers.
* **Server:** one `WriteApi` created and closed per incoming sample (`data.service.ts:36,59`); the MQTT handler
  does a `deviceModel.findOne` per message (`device.service.ts:163`) plus a `findOneAndUpdate` for `lastseen`
  (`:236`). Influx is reachable only at the hardcoded `http://influxdb:8086`.
* **Logs:** the entire window's logs are fetched and held in memory (`deviceLogs`), de-duplicated on the client
  (`filterLogs`, `:1131-1184` — runs `getFilteredLogs()` **three times** per call, `:1181-1183`), and paginated at
  100 rows (`log-entry-viewer.component.ts:4`).
* **Chart height** is fixed at `calc(100vh - 180px)` (`charts.page.scss:3`) regardless of how many toolbars are
  actually rendered above it.

---

## 10. What is ugly / limiting (specific, with refs)

1. **`softMin: 0` on every axis** — `charts.page.ts:757`. A 20–28 °C temperature curve is drawn on a 0–30 axis, so
   the interesting variation is squashed into the top ~25 % of the plot. This is the single biggest readability
   problem and it is one line.
2. **Every measure gets its own overlaid y-axis**, alternating left/right (`:722-727`, `:758`). Two series with
   different scales are drawn on top of each other in one rectangle. There are **no panes**, no stacked charts,
   no synchronised multi-chart layout.
3. **`max: 1` on the CO2 measure** (`:135`) — `softMax` of 1 for a ppm series. Harmless in practice but plainly a
   copy/paste from the boolean outputs, and evidence the axis config was never really designed.
4. **Series names are hardcoded English** (`:120-150`, `:808`) while the rest of the page is translated. A German
   user sees "Temperature / Humidity / Critical logs" in the legend and tooltip.
5. **Two parallel colour palettes** — `measure.color` (`:122+`) and `theme.measureColorOverrides` (`:359-375`) —
   that must be edited together. `#e05a4e` vs `#ff7a6b` etc.
6. **Dark mode is detected by `MutationObserver` on `document.body.class` + a `localStorage` read**
   (`:304-308`, `:504-508`) and then rebuilds the entire options object (`applyChartTheme`, `:384-491`). No CSS
   variables, no `styledMode`.
7. **The three log column series are always pushed, even with `showLogs` off** (`:802-831`), so the legend
   permanently carries "Info logs / Warning logs / Critical logs" with empty data.
8. **Events are bars of height 1, not flags/annotations** (§5). No title, no icon, no message on the chart; the
   only way to read one is to *hover* it, which does nothing on touch.
9. **Interval is not constrained by timespan** (`:112` vs `:75-110`). `3y` × `5s` is one dropdown away from an
   18.9 M-window Flux query.
10. **The `limit(n: 50000)` guard is placed after `yield()`** (`server/src/services/data.service.ts:87-88`), so it
    does not bound the returned result. Needs verification against a live Influx, but the ordering is wrong either
    way.
11. **Flux string interpolation with unvalidated input** (`data.service.ts:80-89`): `measure` (a path param),
    `from`, `to` and `interval` (query params) go straight into the query. `method` is the only one allowlisted
    (`:74-78`). `VALID_SENSORS` exists three lines above and is not used for reads. Both an injection surface and
    a DoS surface.
12. **Dead chart stack**: `chart.js` + `ng2-charts` + `chartjs-adapter-luxon` are imported in `charts.page.ts:2-4`,
    `@ViewChild(BaseChartDirective) chart` at `:213`, `lineChartType` at `:155`, all unused; `NgChartsModule` is in
    `charts.module.ts:22`; `diary.module.ts:7-8` imports both chart modules and renders no chart. ~500 KB of
    bundle for nothing.
13. **`noData(Highcharts)` is called twice** (`charts.page.ts:28` and `:30`).
14. **`webapp/src/app/diagnostics/diagnostics.page.ts` is a stale fork of the charts page** (its own `measures`
    array at `:55-72` with `types: ['fridge','foo']`, its own timespans, `#f00`/`#00f` colours). Any change to the
    measure catalogue has to be made twice or the admin view rots further.
15. **The URL is the only state container.** `loadData()` ends with a `router.navigate` (`:884`); with
    `autoUpdate` on that runs every 10 s. There is no view model object, no `ChartView` type in `shared-types`, and
    the same query-string format is duplicated in `buildPresetQuery()` (`:924-941`), `applyViewParams()`
    (`:565-600`), the share modal (`share-link-modal.component.ts:68-78`) and the grow report
    (`grow-report.component.ts:642-654`).
16. **`filtered_measures: any[]`** (`:153`) with `measure.axis` monkey-patched on at `:766`, `measure: any` in the
    series builder (`:769`), and a `// @ts-ignore` at `:729`/`:841`. No `Measure` interface exists.
17. **No incremental/live update path** — `updateFlag` re-applies the entire options object each time (`:846`).
18. **No export.** No CSV, no PNG, no `exporting` module; the only way to get data out is the raw API.
19. **Desktop-only interactions**: pan requires Ctrl (`:243-246`), zoom requires Shift (`:247-257`),
    `singleTouch: false`, and the navigator is disabled on touch devices or short viewports
    (`:32`, `:296-298`). On a phone the chart is effectively read-only, and the log-selection interaction
    (hover-driven, `:262-280`) is unreachable.
20. **Only one device per chart.** Every route is `device/:device_id/charts` (`app-routing.module.ts:18-21`); there
    is no way to compare two tents, and no room-level or multi-device view anywhere in the API either
    (`/data/series/:device_id/:measure`).
21. **A view-only share link does not restrict the data API** — `isUserDeviceOrShareMiddelware`
    (`middlewares/auth.middleware.ts:186-228`) grants the share access to *any* measure of that device, not just
    the ones in `share.query`. Only the *UI* is locked (`charts.page.ts:518`).
22. `charts.page.spec.ts` is the CLI-generated stub. There is **no test coverage** of `applyViewParams`,
    `buildPresetQuery`, `loadData`, the VPD day/night split, or `availableCuratedPresets`.

---

## 11. Quick reference: everything the chart could plot but does not

| Data | Where it already lives | Chart today |
| --- | --- | --- |
| Setpoints day/night (temp, humidity, CO2, light hours/limit) | `Device.configuration` JSON string (current value only) | ✘ |
| Setpoint change history | text diff inside `DeviceLog` `message-device-configuration-updated` (`device.service.ts:1149-1157`), stored with `deleted:true` | shown as an unlabelled info column |
| Stage target bands incl. `vpdRange` | `webapp/src/app/util/grow-presets.ts` `GROW_STAGE_PRESETS` | ✘ |
| Alarm thresholds (`upperThreshold`/`lowerThreshold`) | `Device.alarms` (`shared-types/index.d.ts:6-7`) | ✘ |
| Alarm trigger/resolve times (`lastTriggeredAt`, `lastResolvedAt`, `extremeValue`) | `Alarm` (`shared-types/index.d.ts:13-16`) | ✘ (only the resulting log line) |
| Recipe steps / stage transitions | `Recipe.steps[].stage`, `activeSince` (`shared-types/index.d.ts:133-154`); diary `newLifecycleStage` in `DiaryEntryData` | ✘ |
| Diary measurements (pH, EC, TDS, lux, distance, outside temp) | `DeviceLog.data: Partial<DiaryEntryData>` (`shared-types/index.d.ts:109-120`) | ✘ (list only) |
| Diary/webcam photos | `DeviceLog.images[]`, `Image` collection | stills scrub with hover; diary photos not on the chart |
| `lux`, `rpm`, `sensor_type`, `out_relais` | written to Influx (`data.service.ts:12,19`) | ✘ (only `lux`→`ppfd` derived) |
| Maintenance windows (`maintenance_mode_until`) | `Device` (`shared-types/index.d.ts:176`) | ✘ |
| Firmware version changes | `DeviceLog` `message-firmware-update-complete-with-ids` | column only |
| Device offline gaps | derivable from `lastseen` / `ONLINE_TIMEOUT = 10 min` (`device.service.ts:45`) | ✘ (renders as `null` gaps) |
