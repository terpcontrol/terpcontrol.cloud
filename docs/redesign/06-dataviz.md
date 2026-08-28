# 06 — Charting & visualisation research for Terp Control

Research date: **2026-08-24**. All external facts below were fetched live; anything I could not verify is
tagged **UNVERIFIED**. Bundle sizes marked "measured" were produced locally in this session with
`esbuild 0.25` + `gzip -9`, not quoted from marketing pages.

---

## 0. Headline

The current chart is *technically* capable (Highcharts Stock) but visually and conceptually wrong: it
overlays up to ~15 semi-transparent **area** series, each on its **own invisible y-axis**, with **no
setpoint, no target band, no day/night shading, and no annotations** — exactly the "dual-scaled axis"
failure mode Stephen Few spent seven pages demolishing, multiplied by fifteen. Meanwhile the library
itself is a proprietary dependency (`highcharts` + `highstock`) inside a repo the vendor's own shop page
calls "quelloffen" (open source), on a publicly reachable SaaS with a no-login demo. The fix is one
project: **replace Highcharts Stock with a tree-shaken Apache-2.0 ECharts 6 build** and redesign around
*setpoint-relative* rendering, *stacked small multiples with a linked crosshair*, and *first-class
annotations*.

---

## 1. What Terp Control charts today (grounded in the code)

### 1.1 Dependencies

`/home/user/terpcontrol.cloud/webapp/package.json`:

| Package | Pinned | Latest (2026-08-24) | Licence | Notes |
|---|---|---|---|---|
| `highcharts` | `^10.3.3` | **13.0.1** | proprietary (`"license": "https://www.highcharts.com/license"`) | 3 majors behind |
| `highcharts-angular` | `^3.0.0` | **5.4.1** | 3.x = "SEE LICENSE IN \<LICENSE\>"; 5.x flipped to **MIT** | 5.x needs Angular ≥19 + Highcharts ≥12.2 |
| `ng2-charts` | `^4.1.1` | **10.0.0** | 4.1.1 = ISC; 5.x+ = MIT | needs `@angular/cdk` ≥14 |
| `chartjs-adapter-luxon` | `^1.3.0` | — | MIT | |
| `chart.js` | **not a direct dependency** | 4.5.1 | MIT | pulled in only as `ng2-charts` peer |

So **two charting stacks ship in the bundle**. `charts.page.ts` imports *both* `ChartType` from `chart.js`
and `BaseChartDirective` from `ng2-charts` **and** `highcharts/highstock` — but only Highcharts is
actually drawn. The Chart.js half is dead weight (also in `diary.module.ts`, `diagnostics.page.ts`).
`diagnostics.page.ts` has the same double import.

Angular is **15**, Ionic Angular **6**, TypeScript **4.8**, zone.js **0.11** — that constrains which
wrapper versions are installable (see §12.4).

Bundle budget in `webapp/angular.json`: `initial` warning **2 MB**, error **5 MB**. Generous — the current
Highstock payload (~132 KB gz) is not near it, and neither would ECharts be.

### 1.2 The chart itself

`/home/user/terpcontrol.cloud/webapp/src/app/device/charts/charts.page.ts` (1205 lines) —
`/home/user/terpcontrol.cloud/webapp/src/app/device/charts/charts.page.html` (328 lines).

Modules loaded (lines 23–31): `highcharts/modules/boost`, `modules/no-data-to-display`,
`highcharts-more`. **`noData(Highcharts)` is called twice** (lines 27 and 30) — harmless, but a smell.
Not loaded: `modules/annotations`, `modules/accessibility`, `modules/pattern-fill`, `modules/xrange`,
`modules/heatmap`.

Series construction (lines ~737–830):

```ts
yAxis.push({ softMin: 0, softMax: measure.max, opposite: measure.right,
             visible: showAxisLabels ? measure.enabled : false, zoomEnabled: false, … })
…
return { name: measure.title, type: "area", data, yAxis: measure.axis,
         color: measureColor, fillOpacity: 0.1, threshold: null, … }
```

Every measure gets **its own y-axis** (`measure.axis = axis`) with an independent `softMin: 0 /
softMax: measure.max`, and every measure is drawn as a **filled area at 10 % opacity**. Axis labels are
suppressed below 320 px width (`showAxisLabels = availableWidth > 320`) — so on a phone the reader gets
N overlapping translucent areas with *no axis at all*.

The 15 declared measures (lines ~120–160) and their hardcoded colours:

| Measure | key | colour | unit | softMax |
|---|---|---|---|---|
| Temperature | `temperature` | `#e05a4e` | °C | 30 |
| Humidity | `humidity` | `#4870c0` | % | 100 |
| VPD | `vpd` | `#50a030` | kPa | 1.6 |
| CO2 | `co2` | `#7a5fb0` | ppm | **1** ← looks like a bug; ppm axis capped by softMax 1 |
| Leaf Temperature | `leaf_temperature` | `#b0743c` | °C | 30 |
| PPFD | `ppfd` | `#e3a008` | µmol/m²/s | 1000 |
| Heater | `out_heater` | `#c2483c` | — | 1 |
| Dehumidifier | `out_dehumidifier` | `#3e8fbf` | — | 1 |
| Fan | `out_fan` | `#2e9e8f` | % | 1 |
| CO2 Valve | `out_co2` | `#8e6fc0` | ticks | (method `sum`) |
| Lights | `out_light` | `#c8a23c` | — | 100 |
| Day | `day` | `#c8a23c` | — | 1 |
| Fan internal/external/backwall | `out_fan-*` | `#2e9e8f` / `#d98e2b` / `#c75d8a` | — | 1 |

Note `Lights` and `Day` are the **same colour** `#c8a23c`; `out_fan` and `out_fan-internal` are both
`#2e9e8f`. Dark mode overrides some of these in `theme.measureColorOverrides` (e.g. `vpd: '#6fbe4a'`,
`out_light: '#f3e27b'`).

Logs are drawn as **`type: 'column'` series at y = 1** on three extra hidden axes, one per severity
(0/1/2), coloured from `theme.logColors.{info,warning,critical}`. That is a spike-plot, not an
annotation layer: it consumes vertical plot area, cannot carry a label, and collides with the data.

Other present behaviour worth keeping: Highstock **`navigator`** + **`rangeSelector`**, a `MutationObserver`
watching the theme attribute to re-theme the chart, `applyHighchartsLocale`, chart presets
(`ChartPresetsService`, `availableCuratedPresets`), share links (`ShareLinkModalComponent`,
`ShareAccess`), a `vpdMode: 'all' | 'day' | 'night'` selector, an `IS_TOUCH_DEVICE` flag from
`matchMedia("(pointer: coarse)")`, and a webcam still / `mp4` timelapse rendered **below** the chart
(`charts.page.html` lines 271–285) with a `.timelapse-progress` bar — *not* linked to the x-axis.

### 1.3 Data pipeline (this matters a lot for what is cheap to build)

- **Time series live in InfluxDB, not Mongo.** `server/src/services/data.service.ts` builds Flux:
  `|> aggregateWindow(every: ${interval}, fn: ${method}, createEmpty: true)` with
  `allowedMethods = ['mean', 'min', 'max', 'sum']` (line 74).
  **`min`/`max`/`mean` for the same window are already one query each.** Min–max envelope bands
  (§3.3) are therefore ~free server-side.
- API: `GET /data/series/:device_id/:measure?from&to&interval&method`
  (`server/src/routes/data.route.ts:63`). The webapp calls it **once per measure**
  (`webapp/src/app/services/data.service.ts:127`) — 15 measures = 15 round trips; `p-limit` is in
  package.json to cap concurrency.
- Derived series are computed server-side: `vpd` (from temperature + humidity + `out_light` +
  `leaf_temperature`), `vpd_day` / `vpd_night`, and `ppfd` (from `lux` × `ppfdLuxFactor`).
- **VPD** — `server/src/utils/calculateVpd.ts`:
  `svp(T) = 0.6108 · exp(17.2694·T / (T + 237.3))` (Tetens), `vpd = svp(T_leaf) − svp(T_air)·RH/100`,
  rounded to 2 dp. Leaf offset defaults `vpdLeafTempOffsetDay = -2`, `vpdLeafTempOffsetNight = 0`
  (`server/src/services/device.service.ts:1292–1297`), selected by day/night in `data.service.ts:150`.
- **Setpoints exist and are addressable.** From `scripts/simulate-device.mjs:206–213`, the device config
  keys are:
  `daynight.day = 21600` (06:00 as **seconds of day**), `daynight.night = 64800` (18:00),
  `day.temperature = 25`, `night.temperature = 21`, `day.humidity = 60`, `night.humidity = 55`,
  `co2.target = 900`, `co2.sunsetOff`, `lights.limit = 100`, `lights.sunrise = 15` (minutes ramp),
  `lights.sunset = 15`, `fans.internal/external`, `workmode`.
  Stored as a JSON string in `device.configuration` (`server/src/models/device.model.ts`).
  **Nothing in the chart reads them.**
- **Alarm thresholds exist**: `Alarm { sensorType, upperThreshold, lowerThreshold, thresholdSeconds,
  isTriggered, lastTriggeredAt, lastResolvedAt, extremeValue }` (`shared-types/index.d.ts:1–24`).
  These are per-sensor min/max bands the user already configured — free target bands. Also unused by the chart.
- **Annotation payloads exist**: `DeviceLog { time, severity, categories[], message, title, data?, images[] }`
  and `DiaryEntry { time, category, title, message, data?: Partial<DiaryEntryData>, images[] }` with
  `DiaryEntryData = { co2FillingRest, co2FillingInitial, newLifecycleStage, lifecycleName,
  lightMeasurement, distanceMeasurement, tdsMeasurement, ecMeasurement, outsideTemperatureMeasurement,
  phMeasurement }` and `DiaryLifecycleStage = germination | seedling | vegetative | flowering | drying |
  curing`.
- **Images**: `Image { image_id, device_id, timestamp, timestampEnd?, data, format: 'jpeg' | 'mp4' |
  'user/jpeg' }`, served by `GET /image/:device_id` (`server/src/routes/image.route.ts:66`).
  `timestampEnd` on `mp4` = a timelapse spanning a range. Timespans in `charts.page.ts` carry an
  `imageIntervalMs` (1 d / 7 d / 30 d) that gates which ranges can show a timelapse.

### 1.4 Missing metrics competitors have

Grepped the whole repo: **no DLI, no dew point** anywhere. Pulse Pro's marketing page lists
"VPD, temperature, relative humidity, light intensity, CO2, dew point, PPFD/PAR, and DLI" and
"**Day & night averages for any selected time period**". Terp has PPFD but does not integrate it to DLI
(`DLI = PPFD × photoperiod_seconds / 1e6` mol·m⁻²·d⁻¹) — a one-line Flux integral over existing data.

---

## 2. Prior art worth stealing from

### 2.1 CGM / diabetes — the solved problem

The **Ambulatory Glucose Profile (AGP)** is the single best template for "actual vs target over a
repeating daily cycle", and it is a *standard*, not a style.

- Standard window: **14 days** of CGM collapsed onto **one 24-hour axis**.
- Five percentile curves — **5th, 25th, 50th, 75th, 95th** — drawn as a bold median line with a **dark
  IQR band (25–75)** and a **lighter interdecile band (5–95)**.
- Target range drawn as a **horizontal band behind everything** (70–180 mg/dL).
- Summary as a **stacked, colour-coded bar**: Time in Range (green), Time Above Range level 1 / level 2,
  Time Below Range level 1 / level 2 (red / dark red).
- Clinical target: **≥70 % TIR** for most people with T1D/T2D (ADA / International Consensus on Time in
  Range, *Diabetes Care* 42(8):1593). The journal page itself returned **HTTP 403** to my fetch, so the
  70 % figure and the level-1/level-2 stratification come from secondary sources (Accu-Chek AGP
  training, novoMEDLINK, AJMC) — **the exact consensus wording is UNVERIFIED**; the *visual grammar* is
  well corroborated across all of them.

**Why it transfers perfectly:** a grow room is a *forced daily cycle* (lights on/off) exactly like a
circadian glucose profile. A 14-day AGP-style "typical day" chart for temperature/RH/VPD, overlaid with
the day and night setpoints, is the single highest-value new chart Terp could ship — and Terp already
has `vpdMode: day|night` proving the team thinks in those terms.

### 2.2 Thermostats

I could **not** verify Nest or ecobee chart internals: `support.ecobee.com/s/articles/Home-IQ` returned
404, the `/hc/en-us/…` variant returned empty content, and my WebSearch budget was exhausted
(200/200 used) before I could locate live URLs. **Nest/ecobee specifics are UNVERIFIED.** From general
knowledge (stale, treat as a hypothesis): ecobee Home IQ / System Monitor draws indoor temperature as a
line, the heat/cool setpoints as a *stepped* line or shaded comfort band, outdoor temperature as a
second line, and equipment runtime as **bars in a separate lane under the chart**. That "runtime lane
under the temperature chart" is the right pattern for Terp's `out_heater` / `out_dehumidifier` /
`out_fan` / `out_co2` / `out_light`, and it maps onto Grafana's documented **state timeline**
visualization (below) rather than onto a 0/1 line jammed into the main plot.

### 2.3 Grafana (verified from the docs source)

- **Time regions** — added in Grafana **10.0** ("Time series time region support",
  `docs/sources/whatsnew/whats-new-in-v10-0.md`). Configured *as an annotation query*: set
  **Query type = Time regions**, then **From** / **To** with days of week + time, plus a timezone that
  defaults to the dashboard's. An **Advanced** toggle accepts **cron syntax** for finer control
  (`docs/sources/visualizations/dashboards/build-dashboards/annotate-visualizations/index.md:292–304`).
  This is *precisely* the day/night lights schedule problem, and Grafana's answer is
  "repeating region defined by wall-clock time-of-day, in an explicit timezone".
- The **Trend** panel explicitly documents what you lose without a time axis: "No annotations or time
  regions / No shared cursor/crosshair / No multi-timezone x-axis"
  (`.../visualizations/trend/index.md`).
- **Time series panel** options that matter:
  - `Fill below to` override — "fills the area between two series", you pick the series the fill stops
    at. **This is the deviation-shading primitive.**
  - Thresholds section with multiple display options.
  - Multiple y-axes via field overrides — the docs' own example is literally "temperature and humidity".
  - Tooltip mode `All` = shared crosshair, hovered series bolded; plus `Values sort order`,
    `Hover proximity`.
  - Annotation options include **`Multi-row annotations`**, **`Annotation clustering`**, and
    **`Hide lines and areas`** — i.e. Grafana's own answer to annotation clutter is *cluster + multi-row*,
    not "draw them all".
- **State timeline** — "data is presented as a series of bars or bands called _state regions_ … the
  region length indicates the duration or frequency of a state". Handles string, numeric **and boolean**
  states; "Each state ends when the next state begins or when there is a `null` value"; null/empty render
  as gaps. **This is the correct visual for every `out_*` output and for `day`.**

### 2.4 Pulse Grow (the closest competitor)

- VPD targets per stage, from `pulsegrow.com/blogs/learn/vpd`:
  **seedlings/clones ≈ 0.8 kPa** (night range 0.6–1.0), **veg ≈ 1.0 kPa** (0.8–1.2),
  **flower 1.2–1.5 kPa** (night 1.0–1.5); "ideal VPD, as a general rule for plant growth, is around
  0.8 – 1.2 kPa".
- Leaf temperature: "1-3 °C or 2-5 °F cooler" than air. Terp's default `-2 °C` day / `0 °C` night sits
  squarely inside that. Pulse ships a **"Custom VPD Chart Maker"** letting users change "the stage, the
  units, and the leaf temperature adjustment", and their static charts are drawn with **"a 0° offset for
  leaf temperature"** as the baseline.
- The classic VPD chart is a **temperature × relative-humidity matrix**, coloured by resulting VPD, with
  stage sweet spots as overlaid zones. Wikipedia's VPD article gives the general horticultural range as
  **0.45–1.25 kPa, ideally ~0.85 kPa**, and "most plants grow well at VPDs of between 0.8 and 0.95 kPa".
- Pulse app claims: unlimited sensors on one dashboard, "**Day & night averages for any selected time
  period**", connectivity/power-outage notifications, chart *sharing* via public links
  (`app.pulsegrow.com/chart-sharing/<id>` — I fetched one; it is a JS app shell, so I could **not**
  inspect their rendering. **Pulse's chart library and visual details are UNVERIFIED.**)

### 2.5 Cold chain / pharma — the "time out of range" analogue

Mean Kinetic Temperature (MKT) is "a calculated temperature that represents the equivalent thermal effect
of temperature variations over time", used because degradation is exponential in temperature so an
arithmetic mean under-reports excursions. The MKT formula weights each sample by its dwell time
(t₁…tₙ), so long excursions dominate. **Directly transferable idea:** a "stress index" for a grow that
weights *how far* and *how long* the room was out of band, rather than a flat % — and, more simply, that
**"time out of range" must be reported as duration, not as a count of alarms.**

### 2.6 Industrial SCADA / HMI

I did not land a verified primary source (ISA-101 is paywalled; my search budget was gone).
**UNVERIFIED**, from general knowledge: High-Performance HMI practice reserves saturated colour
*exclusively* for abnormal conditions, draws normal operation in greys, and puts the target band behind
the trend as a light grey/green field. That principle is worth adopting verbatim and is *the opposite*
of the current Terp chart, where every series is a saturated colour all the time.

---

## 3. Actual vs setpoint — concrete design

### 3.1 The three renderings, ranked

**(a) Target band behind the line — the default.**
A horizontal (or, better, time-varying) shaded band behind the series, no border or a hairline border,
fill at ~8–12 % alpha in a neutral-positive hue; the actual value as a 2 px opaque line on top.
Highcharts: `yAxis.plotBands[{ from, to, color, label, zIndex }]`, mutable at runtime via
`addPlotBand()` / `removePlotBand(id)` (id required for removal). ECharts:
`series.markArea.data = [[{yAxis: lo}, {yAxis: hi}]]` — a two-element array giving the top-left and
bottom-right of the rectangle; each point can be `{yAxis}`, `{xAxis}`, `{coord}`, or pixel `{x,y}`; it
carries `itemStyle` + `label` (default label position `'top'`). Chart.js:
`chartjs-plugin-annotation` **box** annotation with `xMin/xMax/yMin/yMax`, `scaleID`, `drawTime`,
`adjustScaleRange` (MIT).

**(b) Stepped setpoint line + deviation fill — the honest one.**
Terp's setpoint is *not* constant: it steps at `daynight.day` / `daynight.night` between
`day.temperature` and `night.temperature`. Draw it as a **dashed stepped line** (`step: 'left'` in
ECharts / `step: 'left'` in Highcharts) and fill the region **between actual and setpoint**, tinted by
sign (warm = above target, cool = below). Grafana's primitive for this is the **`Fill below to`**
override; ECharts does it with two line series and `areaStyle` + a clip, or a `custom` series; uPlot has
a `bands` array (`high-low-bands.html` demo). Do **not** fill to zero — the current
`type: 'area', threshold: null` fills to the axis minimum, which encodes nothing.

**(c) Colour-by-deviation on the line itself — for the mobile summary tile.**
ECharts `visualMap` **piecewise** with `dimension` + `seriesIndex` + `pieces:[{max: lo, color:…},
{min: lo, max: hi, color:…}, {min: hi, color:…}]` recolours line *segments* by value. One glanceable
sparkline that turns amber where the room drifted. Cheap, and reads at 44 px tall.

### 3.2 Where the band comes from

Three sources, in priority order — and the UI should say which:

1. **Alarm thresholds** (`Alarm.upperThreshold` / `lowerThreshold` per `sensorType`) — the user's own
   declared "acceptable". Draw as a *hard* band edge (1 px dashed, higher contrast).
2. **Setpoint ± hysteresis** from `device.configuration` (`day.temperature`, `night.temperature`, …) —
   draw as a *soft* band. If hysteresis is not exposed in the config, use a fixed tolerance
   (±0.5 °C, ±5 % RH) and label it as such.
3. **Stage-based VPD sweet spot** (§5) — advisory, drawn faintest.

Never draw all three at once by default. One band, a control to switch.

### 3.3 Min/max envelope — free from Influx

When the window is aggregated (`interval` ≥ ~1 m), a single `mean` line is a lie: it hides the
oscillation of a bang-bang controller. Because `aggregateWindow` already supports `min`/`max`, request
three series per measure and draw **mean line + min–max band**, exactly like an AGP IQR band. Cost:
3× requests for the primary measure only (not all 15). This is the single most informative change
per line of code.

### 3.4 Time-in-range metrics (steal the AGP scorecard)

Report, for the visible window and split **day / night** (Terp already has the day/night machinery, and
Pulse advertises day-and-night averages as a feature):

- **% time in band**, **% above**, **% below** — as a single stacked horizontal bar, green / amber / blue,
  with the % in range as the big number. AGP convention: green = in range, red-family = the dangerous
  side. For a grow, *above* and *below* are both bad but differently: use warm for above, cool for below,
  reserve red for "outside alarm threshold" (level-2 equivalent).
- **Longest excursion** (duration, not count) and **total time out of band** — MKT's lesson.
- **Mean / min / max**, day and night separately.
- **Stability**: mean absolute deviation from setpoint, or the IQR width. Growers arguing about
  controllers care about *tightness*, not average.
- Optional **DLI** (mol·m⁻²·d⁻¹) integrated from existing `ppfd`, and **dew point** from T+RH — both
  competitors report them, both are pure arithmetic on data Terp already stores.

Guard rail: a percentage is meaningless if coverage is poor. Report **% of window with data** and grey
out the scorecard below ~80 % coverage (Influx's `createEmpty: true` already yields nulls you can count).

---

## 4. Day/night cycle on the time axis

**The pattern:** repeating vertical plot bands from `daynight.day` (21600 s) to `daynight.night`
(64800 s) *in the device's local timezone*, rendered **behind** everything at very low contrast — a
warm ~5 % tint for the photoperiod on a light theme, and on dark a *lighter* band for day against the
dark ground (invert the tint, do not invert the colour).

Grafana's implementation is the reference (§2.3): a repeating region defined by **day-of-week + time-of-day
+ explicit timezone**, with cron for anything irregular. Copy the timezone requirement — a grow with a
12/12 flip near a DST boundary will otherwise drift by an hour and the user will file a bug.

Refinements:

- **Draw the ramps.** `lights.sunrise` / `lights.sunset` are ramp *minutes* (default 15). Render them as
  a short gradient at each band edge rather than a hard step; growers dimming for 30–60 min will see it.
- **Prefer measured over scheduled.** `out_light` (0–100) is the *actual* dimmer output. Derive the bands
  from `out_light > 0` where the series exists, and fall back to the schedule otherwise. Then a failed
  contactor shows up as a missing band — a genuinely diagnostic visual.
- **Never plot `day` or `out_light` as a line on the value axis.** It is a state, not a quantity.
- Tick strategy: on multi-day ranges, put a **date** tick at each lights-on transition rather than at
  midnight. Growers think in "day 34 of flower", not in calendar days — and `DiaryLifecycleStage` gives
  you the anchor to label "Flower d34".

Who does this well, verifiably: **Grafana** (time regions, documented). Sleep/weather/solar apps do it
too but I could not verify specifics this session — **UNVERIFIED**.

---

## 5. VPD visualisation

Growers want three different VPD views, and conflating them is the usual mistake.

**(1) VPD over time** — the ordinary time series, but with the *stage-appropriate* band behind it:
seedling 0.6–1.0, veg 0.8–1.2, flower 1.2–1.5 kPa (Pulse). Terp already knows the stage from
`DiaryEntry.data.newLifecycleStage` / `DiaryLifecycleStage`, so the band can *change along the x-axis* as
the grow progresses — a stepped band, not a constant one. That is a genuinely novel, correct chart that
no competitor I could verify ships.

**(2) The VPD matrix ("sweet-spot chart")** — temperature on one axis, RH on the other, cells coloured by
resulting VPD, sweet-spot zone outlined per stage. The differentiator versus every static poster:
**plot the room's actual (T, RH) trajectory on it.** A 24-hour path with the current point as a dot and
the last 24 h as a fading tail turns a lookup table into a diagnosis ("you're drifting into the
too-humid corner every night"). ECharts does this with `heatmap` + a `line`/`scatter` series on the same
cartesian grid; Highcharts needs `modules/heatmap`.

**(3) Leaf-temperature offset as an explicit, visible control.** VPD is *entirely* an artefact of the
offset assumption — Terp defaults to `-2 °C` day / `0 °C` night, Pulse publishes charts at `0°` and
teaches 1–3 °C. Two rules:
- Show the assumption **on the chart** ("leaf = air −2.0 °C"), never only in a settings page.
- When a real `leaf_temperature` sensor exists (Terp has the measure for `controller` type), say so and
  drop the offset. Plotting a measured-leaf VPD and an assumed-leaf VPD as two lines is a great
  "why your numbers differ from your neighbour's" explainer.

Formula sanity: Terp's Tetens `0.6108·exp(17.2694·T/(T+237.3))` is the standard form and is fine.
Wikipedia's own article gives only a Rankine-unit polynomial (A = −1.0440397e4 … F = 6.5459673, output
in PSI) rather than Tetens/Buck, so treat *that* page as a poor citation; the general ranges it quotes
(0.45–1.25 kPa; 0.8–0.95 kPa optimum) are consistent with Pulse.

---

## 6. Event annotations without clutter

Terp's annotation payloads are already rich: `DeviceLog{severity 0/1/2, categories[], images[], data?}`
and `DiaryEntry{category, title, data: {ecMeasurement, phMeasurement, tdsMeasurement, lightMeasurement,
distanceMeasurement, …}, images[]}` plus stage changes.

**Layout rule: annotations belong in their own lane, not in the plot.**
Today they are `column` series at y = 1 inside the data plot. Move them to a **12–20 px rail directly
under the x-axis**, aligned to the same scale. This is Grafana's model, it survives zoom, and it frees
the plot.

**Anti-clutter, in the order you should implement it:**

1. **Cluster by pixel proximity.** Grafana's own options are literally `Annotation clustering` and
   `Multi-row annotations`. Bucket events into ~8–12 px bins; a bin with n > 1 renders as one marker with
   a count badge; tapping it opens a list. This is the only technique that scales to a 90-day view.
2. **Rank, then show.** Severity 2 always visible; severity 1 visible when it fits; severity 0 collapses
   into clusters first. Diary "stage change" events are structural — give them a **full-height vertical
   dashed line** with a label at the top, and treat them as a different class from point events.
3. **Category filter chips**, persisted with the chart preset. `collectLogCategories()` already exists.
4. **Two rows max.** Row 1 = diary/user events, row 2 = device/system events. More rows and the rail
   starts competing with the chart.
5. **Never render annotation text inside the plot at default zoom.** Label on hover/tap only; the marker
   carries an icon + colour.

**Library affordances (verified):**
- Highcharts Stock **flags** series: `{type:'flags', onSeries, shape:'flag'|'circlepin'|'squarepin',
  stackDistance: 12 (default), allowOverlapX: null, y: -30, onKey: 'y', useHTML: false, title: 'A'}`.
  `stackDistance` stacks colliding flags vertically — usable, but it stacks *upward into the plot*, and
  the docs do not define behaviour for dense clusters. Not sufficient on its own for 90 days of logs.
- Highcharts **annotations module** (`modules/annotations.js`, included in the standard licence, not a
  separate product): `labels` (data-label-like) and `shapes` limited to **circle, rect, ellipse, path**;
  anchoring by pixel, by axis coordinates (`xAxis`/`yAxis` index), or mixed. **Not currently loaded by
  Terp.**
- ECharts: `markLine` (1-D and 2-D data items) for vertical event lines, `markPoint` for markers,
  `markArea` for spans, and `graphic` elements (including `GraphicComponentImageOption` — real image
  elements) for anything custom. Plus `grid: GridOption[]` so the rail can be its own grid inside the
  *same* chart instance, sharing the x-axis.
- Chart.js: `chartjs-plugin-annotation` (MIT) — box, line, label, ellipse, point, polygon; `drawTime`,
  `adjustScaleRange`, click events.

---

## 7. Photos / timelapse against the time axis

Today: a single `<img>` (or `<video>` for `mp4`) under the chart with a CSS progress bar
(`charts.page.html:271–285`). The image timestamp is chosen from the last data point or "now"; it is not
scrubbable and not aligned to x.

**Target pattern — a film strip that *is* an axis.**

- A strip of thumbnails under the plot, **positioned by timestamp on the same x-scale** (not evenly
  spaced). Uneven capture intervals then read honestly as gaps.
- The chart crosshair and the strip share one cursor: hovering/scrubbing the chart highlights the
  nearest frame; dragging the strip moves the crosshair. ECharts gives you this for free with
  `axisPointer.link` across grids in one instance, or `echarts.connect(groupId)` across instances
  (both verified present in `echarts` 6.1 type definitions: `AxisPointerOption.link?: AxisPointerLink[]`
  and `declare function connect(groupId: string | EChartsType[]): string`).
- Tapping a frame pins it and drops a vertical marker on the chart.

**Delivery technique worth copying: the storyboard sprite + WebVTT index.** Mux documents it precisely:
one sprite image with **50 tiles for assets under 15 minutes, 100 tiles above**, tiles **256×160 px**,
and a WebVTT file whose cues point at regions via the Media Fragments syntax:

```
00:00:00.000 --> 00:01:06.067
https://image.mux.com/{ID}/storyboard.jpg#xywh=0,0,256,160
```

For Terp this means: for a given chart window, the server returns **one** sprite + a small JSON/VTT of
`{t, x, y, w, h}` instead of N image requests. That is what makes a 30-day film strip feel instant on a
phone. Note MDN's WebVTT API page does **not** document image cues — the `#xywh` thumbnail convention is
a de-facto player convention (Mux, JW, Video.js), not a W3C WebVTT feature. A plain JSON index is
equally good and simpler; the value is the **sprite**, not the VTT.

Also: `Image.timestampEnd` already marks `mp4` timelapses as spanning a range — render those as a
*bracket* on the strip, not a point.

---

## 8. Multi-series with different units — the strong opinion

**Do not put temperature, RH, CO₂, VPD, EC and pH on one plot with N y-axes. Ever.**

Stephen Few's *Dual-Scaled Axes in Graphs: Are They Ever the Best Solution?* (Perceptual Edge, March
2008) is the definitive argument, and he walks it to an unqualified conclusion. Verbatim from the PDF:

> "Today, I can't think of a single case when there isn't a better solution than a graph with a
> dual-scaled axis."

> "By independently scaling domestic and international sales in a single graph, we have encouraged
> people to compare their magnitudes, but this is completely meaningless and inaccurate."

> "Because bar graphs are designed for magnitude comparisons, a graph with a dual-scaled axis should
> never exclusively encode values as bars."

> "Notice that a salient feature of this graph is the point where the two lines intersect. … When lines
> are associated with different quantitative scales, however, their intersection means nothing."

> "Whether the lines intersect or not, and if so where, is arbitrary."

> "It is inappropriate to use more than one quantitative scale on a single axis, because, to some degree,
> this encourages people to compare magnitudes of values between them, but this is meaningless."

His two prescribed alternatives: **separate graphs positioned close together** (small multiples), and —
for time series only — **index/normalise to a common percentage scale**.

Terp's current chart is the pathological case: **fifteen** independent scales, each `softMin: 0` with a
different `softMax`, *and* rendered as filled areas so the overlaps compound, *and* with the axis labels
programmatically **hidden below 320 px**. The temperature line crossing the CO₂ line means nothing, and
on a phone there is not even an axis to disprove it.

**The ruling for Terp:**

1. **Default view = stacked small multiples with a shared x-axis and one linked crosshair.**
   4–6 stacked panels, each ~90–120 px tall on mobile, each with its own y-axis, its own unit, its own
   target band, its own colour. One vertical crosshair spans all panels; one tooltip lists every panel's
   value at that instant. This is *more* readable than the overlay, not less — you can see phase
   relationships (RH lags temperature at lights-on) which the overlay destroys.
   ECharts does this natively: `grid: GridOption[]` (multiple grids in one instance) + `axisPointer.link`
   + `tooltip.trigger: 'axis'`.
2. **Allow at most two units on one panel, and only when they are physically coupled and the user opts
   in.** The defensible pairs are (temperature, leaf temperature) — same unit, same scale, *not* dual —
   and (temperature, RH) for the classic inverse-correlation read. Everything else: separate panel.
3. **Never fill to the axis.** Line + optional target band. Area fills only for *bands* (min–max
   envelope, target band, deviation-to-setpoint).
4. **Outputs (`out_*`, `day`) go in a state-timeline lane**, not on a value axis — Grafana's state
   regions model. Boolean and percentage outputs both work: solid bar for on, height/alpha for a dimmer
   percentage.
5. **Normalisation ("% of setpoint" / z-score) is a power-user overlay**, not the default. It is Few's
   sanctioned technique but it is unreadable without a legend, and grow operators think in absolute
   °C / % / ppm.
6. **Cap simultaneous panels at ~6** and make the chart-preset system (already built:
   `ChartPresetsService`, `availableCuratedPresets`) the way users get a curated combination:
   "Climate" (T, RH, VPD), "CO₂ & light" (CO₂, PPFD/DLI), "Equipment" (state lanes), "Root zone"
   (EC, pH, if/when those arrive).

Colour follows from this: with small multiples, each panel needs only **one** strong colour, so the
15-colour palette problem evaporates. Datawrapper's guidance applies — stay "in a small area of the
color wheel" rather than "dancing all over" it.

---

## 9. Mobile-first charting

What actually breaks on a phone, and the fixes:

- **Scroll trapping.** A chart that pans on one-finger drag steals the page scroll. Rules: **one finger
  = page scroll**, **two fingers = pan/zoom**, **long-press or tap = crosshair**. ECharts `dataZoom`
  type `inside` documents exactly this split: "Mobile: when touches and moved with two fingers in
  coordinates on touch screens" for scaling, while "data area can be translated when moving in
  coordinates" for panning. Set `moveOnMouseMove` deliberately and test; `preventDefaultMouseMove`
  defaults to `true`. Terp already computes `IS_TOUCH_DEVICE` from
  `matchMedia("(pointer: coarse)")` — branch the interaction config on it.
- **Range selection beats pinch.** Most users will never pinch. The existing `rangeSelector` presets
  (20 m … 3 y) and the `navigator` are the right primary control; keep them, make the buttons ≥44 px.
- **Tooltip is the wrong metaphor on touch.** There is no hover. Use a **pinned readout header** above the
  chart that updates as the finger moves (the "scrubbing header" pattern), not a floating box under the
  fingertip that the finger occludes. With small multiples this header is a compact table: one row per
  panel.
- **Crosshair snapping** must snap to the nearest sample, and the hit target must be the full plot
  height, not the line.
- **Hiding axis labels below 320 px (current behaviour) is the wrong trade.** Better: shorten the label
  (drop the unit into the panel title), reduce to 3 ticks, use `min`/`max`-only ticks. An axis-less
  chart is not a chart.
- **Legend**: with small multiples, replace the legend with a **title per panel** carrying the colour
  swatch and the current value. Direct labelling beats a legend every time on a narrow screen.
- **Point count vs pixels.** A 390 px-wide phone has ~350 plot pixels. Requesting `1d` at `5s`
  (17,280 points/series, and the interval selector permits it) is ~50 points per pixel of pure waste
  and jank. Either clamp `interval` to the viewport width server-side, or downsample: ECharts
  `series.sampling: 'lttb' | 'average' | 'min' | 'max' | 'minmax' (v5.5+) | 'sum'`; Chart.js
  `decimation` plugin with `algorithm: 'lttb'` (needs `parsing: false`, linear/time scale, line chart,
  `indexAxis: 'x'`; `samples` defaults to canvas width; threshold defaults to 4× canvas width).
  **`'minmax'` is the right default for a bang-bang controller** — LTTB smooths away the very
  oscillation the grower is looking for. Use LTTB for the navigator, min/max for the plot.
- **Renderer.** ECharts' own guidance: Canvas for >1,000 points; SVG for memory-constrained cases and
  many simultaneous instances ("multiple ECharts instances cause browser crashes on low-end Android
  devices"), with SVG's v5.3.0 virtual-DOM rewrite giving "2-10 times performance gains". For Terp:
  **Canvas for the main plot, SVG for small sparkline tiles** if a dashboard shows many at once.

---

## 10. Accessibility & dark mode

- **WCAG 2.2 SC 1.4.11 Non-text Contrast requires 3:1** against adjacent colours for graphical objects
  required to understand the content. The Understanding doc's chart example is explicit: "The graphical
  objects are the lines in the graph, including the background lines for the values, and the colored
  lines with shapes," and "The lines should have 3:1 contrast against their background, but as there is
  little overlap with other lines they do not need to contrast with each other or the graduated lines."
  **Terp's `fillOpacity: 0.1` area fills almost certainly fail 3:1**, and several of the current
  measure colours (`#c8a23c` gold, `#e3a008` amber) are borderline on a white ground.
  Also: if the value is available as text (the scrubbing header), the *line* itself is arguably exempt —
  another argument for the pinned readout.
- **Colourblind-safe palette — use Okabe-Ito.** Exact hex values (verified from
  `clauswilke/colorblindr/R/palettes.R`):
  `#E69F00` orange, `#56B4E9` sky blue, `#009E73` bluish green, `#F0E442` yellow, `#0072B2` blue,
  `#D55E00` vermillion, `#CC79A7` reddish purple, `#999999` grey (or `#000000`).
  Okabe & Ito's own rules: "Use 'warm' and 'cool' colors alternatively. When using two warm colors or
  two cool colors, put distinct differences in brightness or saturation. Avoid combination of colors
  with low saturation or low brightness," and avoid yellow-with-green.
  Terp's current set breaks this: `#e05a4e` (red) with `#b0743c` (brown) is the classic
  deuteranopia collision, and `#50a030` green sits next to `#e3a008` amber.
  Suggested mapping: temperature `#D55E00`, leaf temp `#E69F00`, humidity `#0072B2`, VPD `#009E73`,
  CO₂ `#CC79A7`, PPFD/light `#F0E442` (on dark) / `#E69F00` (on light), neutral/out-of-range `#999999`.
- **Redundant encoding.** Colour must never be the only channel: with small multiples, *position* is the
  primary channel and colour is decoration — which is itself an accessibility win. Add dash patterns for
  setpoint (dashed) vs actual (solid), and shape for annotation classes.
- **Dark mode.** Datawrapper's concrete rules for dark backgrounds: "Stay below 20% saturation" for the
  background and "Don't go full black—keep your lightness between 10% and 25%". Terp's dark theme
  already uses `#1d2330` tooltips / `#3b475c` borders, which is in that band. Invert *lightness*, not
  hue: keep the same hue per measure, raise its lightness on dark (Terp already does this for a few
  measures via `measureColorOverrides` — extend it to all of them, systematically).
  ECharts has a first-class `darkMode?: boolean | 'auto'` option plus `setDarkMode()` (verified in the
  6.1 type defs), which auto-adjusts label/axis colours — much less code than Terp's current
  hand-written 30-property `ChartTheme` object plus `MutationObserver`.
- **Screen readers.** Highcharts' accessibility module (keyboard nav, screen readers, sonification,
  patterns/contrast, voice input, tactile export) is included in every Highcharts licence and Highsoft
  says to always include it — **Terp does not load it**. ECharts has an `aria` option
  (`AriaOption` is exported from the 6.1 types) but it is weaker. If accessibility is a hard
  requirement, that is the one real argument for staying on Highcharts. Otherwise: render a
  `<table>` of the visible data behind a "view as table" disclosure — cheaper, more useful, and works
  in every library.

---

## 11. Library comparison — measured, not marketing

### 11.1 Sizes

**Measured this session** (downloaded from jsDelivr, `gzip -9`; and for tree-shaken builds, bundled with
`esbuild 0.25 --bundle --minify --format=esm`):

| Build | raw | gzip |
|---|---:|---:|
| **uPlot 1.6.32** (`uPlot.iife.min.js`) | 49.9 KB | **21.5 KB** (+ 0.8 KB CSS) |
| uPlot 1.6.32 bundled via esbuild | 50.8 KB | 22.5 KB |
| **Chart.js 4.5.1** (`chart.umd.js`) | 203.6 KB | **68.8 KB** |
| Observable Plot 0.6.17 (`plot.umd.min.js`) | 204.3 KB | 67.2 KB (375.5 / 125.0 KB incl. d3 per bundlephobia) |
| **Highcharts 13.0.1** (`highcharts.js`) | 273.2 KB | **99.4 KB** |
| **Highcharts 13.0.1** (`highstock.js`) | 373.2 KB | **132.5 KB** |
| Highcharts 10.3.3 (`highstock.js`) — *what Terp ships* | 401.6 KB | **132.7 KB** |
| **ECharts 6.1.0 tree-shaken**: Line + Grid + Tooltip + AxisPointer + MarkArea + MarkLine + DataZoom + Legend + CanvasRenderer | 578.6 KB | **195.6 KB** |
| ECharts 6.1.0 tree-shaken, "everything Terp could want" (+Bar, Scatter, Custom, Heatmap, MarkPoint, VisualMap, Graphic, Toolbox, Brush, Title, Dataset) | 725.7 KB | **243.9 KB** |
| ECharts 5.6.0 tree-shaken, same minimal set | 542.9 KB | **180.9 KB** |
| ECharts 5.6.0 tree-shaken, same extended set | 682.7 KB | **226.0 KB** |
| ECharts 6.1.0 full (`echarts.min.js`) | 1095.6 KB | 359.3 KB |
| ECharts 6.1.0 `echarts.simple.min.js` | 488.6 KB | 164.9 KB |
| ApexCharts 6.10.0 (`apexcharts.min.js`) | 930.4 KB | 261.2 KB |
| Plotly 3.7.0 (`plotly.min.js`) | 4737.5 KB | **1429.5 KB** |

Reality check: **tree-shaken ECharts is ~63 KB gzip larger than the Highstock bundle Terp ships today**
(195.6 vs 132.7). That is real but small next to an Angular 15 + Ionic 6 app with a 2 MB warning budget,
and it buys `markArea`/`markLine`/`visualMap`/multi-grid/`darkMode` that Terp currently emulates by hand
or does without. Also note Terp currently pays for Chart.js + ng2-charts on top, for nothing.

### 11.2 Performance (uPlot's public benchmark, 166,650 data points)

From the uPlot README, rendering 166,650 points. Author-run and therefore self-interested, but the
methodology and code are public and the *ordering* matches independent experience:

| Library | Size | Done | JS (ms) | Heap peak / final | CPU, 10 s mousemove |
|---|---|---|---|---|---|
| uPlot 1.6.24 | 47.9 KB | 34 ms | 51 | 21 MB / 3 MB | 218, 360, 146, 196 |
| Chart.js 4.2.1 | 254 KB | 38 ms | 90 | 29 MB / 10 MB | 1154, 46, 165, 235 |
| ECharts 5.4.1 | 1000 KB | 55 ms | 148 | **17 MB / 3 MB** | 1943, 444, 203, 208 |
| dygraphs 2.2.1 | 132 KB | 90 ms | 163 | 88 MB / 42 MB | 1438, 371, 174, 268 |
| **Highcharts 10.3.3** ← *Terp's exact version* | 413 KB | — | **416** | **97 MB / 55 MB** | 1286, 824, 205, 242 |
| Plotly.js 2.18.2 | 3600 KB | 310 ms | 655 | 104 MB / 70 MB | 1814, 163, 25, 208 |
| ApexCharts 3.37.1 | 503 KB | 685 ms | 694 | 175 MB / 46 MB | 1708, 421, 106, 207 |
| amCharts 5.3.7 | 625 KB | — | 1601 | 147 MB / 121 MB | 9171, 71, 460, 167 |

Two things jump out: **Highcharts 10.3.3 is 8× slower to first render than uPlot and holds 4.6× the
peak heap of ECharts** — on a mid-range Android that is the difference between usable and not. And
ECharts has the **lowest heap of the mainstream libraries**, which matters more than raw ms for a phone.

Terp's realistic worst case: `1d` at `5s` = **17,280 points/series**; with 6 enabled measures that is
~104k points and 6 HTTP requests. The `intervals` list allows any pairing, so a user *can* reach this.
Highcharts' Boost module (loaded) kicks in at `boostThreshold: 5000` per series (chart-level
`seriesThreshold: 50`) — and boost **disables** non-circle markers, dash styles, stacking, negative
colours, animation, per-series line width, and renders areas as 1 px columns. So above 5k points/series
Terp silently loses dash styles and per-series line width — i.e. exactly the encodings needed for
"setpoint dashed / actual solid". **That alone disqualifies the current architecture from the redesign.**

### 11.3 Licence & project health (fetched 2026-08-24)

| Library | Latest | Licence | GitHub stars | Last push | Open issues |
|---|---|---|---|---|---|
| Chart.js | 4.5.1 | **MIT** | 67,660 | 2026-05-27 | 579 |
| Apache ECharts | **6.1.0** | **Apache-2.0** | 67,141 | 2026-08-04 | 1,542 |
| visx | — | MIT | 21,019 | 2026-06-22 | 148 |
| ApexCharts | 6.10.0 | **NOASSERTION** — see below | 15,134 | 2026-08-24 | 312 |
| Highcharts | 13.0.1 | **proprietary** | 12,479 | 2026-08-24 | 641 |
| uPlot | 1.6.32 | **MIT** | 10,447 | 2026-04-22 | 149 |
| Observable Plot | 0.6.17 | ISC | 5,358 | 2026-07-13 | 346 |

**ApexCharts is no longer freely usable and most people have not noticed.** npm reports
`"license": "SEE LICENSE IN LICENSE"` for 6.10.0, and the LICENSE file defines a **Community tier limited
to organisations with "less than $2 million USD in annual revenue"**; at "$2M USD or more annually, you
must purchase one of our paid licenses." Pricing page: **Community free (<$2M revenue), Pro
$349/developer/year, Premium $599/developer/year, OEM/Embedded $14,999/year.** An OEM licence is
required when "embedding ApexCharts into a product or platform used by other people"; not required if
"your app simply renders static charts and users cannot configure or interact with them." Also bars
"Use in competing charting products" and "Redistribution in toolkits, SDKs, or platforms."
**Verdict: avoid.** The revenue threshold is a licence tripwire that fires on success.

**Highcharts pricing (shop.highcharts.com, fetched today):** Core **$366/seat/yr**, Stock **+$366/seat**,
Maps +$128, Gantt +$73, Dashboards $264/seat, Grid Pro $316/seat, Highcharts for Python $110/yr.
Terp imports `highcharts/highstock`, so it needs **Core + Stock = $732/seat/year**, times the number of
developers who "will be simultaneously working with the API and/or the source code" (the licence's own
definition of a developer seat). Multi-seat and SaaS pricing is quote-only.
The licence text is unambiguous about SaaS: "use of the Licensed Software in connection with a publicly
accessible website or webpage made available to users outside of the Licensee's organization shall be
deemed use in an External Application and will require a SaaS License." terpcontrol.cloud has a
**public, no-login demo** (terpcontrol.com advertises `https://terpcontrol.cloud/demo`, "ohne
Anmeldung"), and the controller sells for **€289** — this is squarely commercial SaaS.
There is **no LICENSE file in the repo and no Highcharts licence artefact anywhere in it**
(I grepped: the only hits are the two lines in `webapp/package.json`).
Whether Terp holds a Highcharts SaaS licence off-repo is **UNVERIFIED** — but if the intent is to publish
the cloud as open source (terpcontrol.com calls it "quelloffen"), **Highcharts source cannot be
redistributed under an OSS licence**, and that conflict is structural, not a paperwork problem.

### 11.4 Angular integration reality on Angular 15

| Wrapper | Latest | Angular peer |
|---|---|---|
| `highcharts-angular` | 5.4.1 | ≥19 (and Highcharts ≥12.2). 4.0.x = ≥16. **3.1.x = ≥11** ← last one usable on Angular 15 |
| `ngx-echarts` | 22.0.0 | ≥22. 21.0.0 = ≥21, 20.0.x = ≥20. **≤19.0.0 declares no `@angular/core` peer at all** ← installs cleanly on Angular 15 |
| `ng2-charts` | 10.0.0 | ≥21 (needs `@angular/cdk`). **4.1.1 = ≥14** ← what Terp has |

So on Angular 15 today: `ngx-echarts@16–19` installs without a peer conflict. **But you don't need a
wrapper at all.** ECharts' imperative API (`echarts.init(el)`, `setOption(opts, {notMerge, lazyUpdate})`,
`resize()`, `dispose()`) wraps in ~50 lines of Angular directive with a `ResizeObserver` — and that
directive is the natural home for the theme/dark-mode plumbing Terp already has. Given the wrapper
ecosystem's Angular-version churn (a new major per Angular release), **hand-rolling is the lower-risk
choice** and unblocks a future Angular upgrade.

### 11.5 Feature matrix for *this* problem

| Need | ECharts 6 | Highcharts Stock | Chart.js 4 | uPlot | Plotly | Observable Plot | visx |
|---|---|---|---|---|---|---|---|
| Band between two values (target band) | `markArea` ✅ | `plotBands` ✅ | plugin ✅ | `bands` (demo) ⚠️ | ✅ | ✅ | manual |
| Band between two *series* (min–max envelope) | 2 series + `areaStyle`/custom ⚠️ | `arearange` (highcharts-more) ✅ | `fill: {target: n}` ✅ | `bands` ✅ | ✅ | `areaY` ✅ | manual |
| Vertical repeating regions (day/night) | `markArea` on x ✅ | `xAxis.plotBands` ✅ | plugin box ✅ | `draw` hook ⚠️ | shapes ✅ | `rect` ✅ | manual |
| Event annotations w/ labels | `markLine`+`markPoint`+`graphic` ✅ | flags + annotations module ✅ | plugin ✅ | plugin demo ⚠️ | ✅ | manual ⚠️ | manual |
| Stacked panels, one linked crosshair | **`grid[]` + `axisPointer.link` + `connect()` ✅✅** | multi-`yAxis` in one pane; separate charts need manual sync ⚠️ | manual sync ⚠️ | `sync-cursor` demo ✅ | subplots ✅ | `facet` ✅ (no crosshair) | manual |
| State timeline (outputs on/off) | `custom` series ⚠️ | `xrange` module ✅ | manual ⚠️ | `timeline-discrete` demo ⚠️ | ✅ | `barX` ✅ | manual |
| Colour line by value range | `visualMap` piecewise ✅✅ | `zones` ✅ | `segment` ✅ | `stroke` fn ⚠️ | ✅ | ✅ | manual |
| Downsampling built in | `sampling: lttb/minmax/…` ✅ | Boost (lossy, disables features) ⚠️ | `decimation` (lttb/minmax) ✅ | none (do it yourself) ❌ | none | none | none |
| Touch pinch/pan | `dataZoom: inside` (documented 2-finger) ✅ | built-in ✅ | `chartjs-plugin-zoom` ✅ | `zoom-touch` demo ⚠️ | ✅ | ❌ | manual |
| Range navigator | `dataZoom: slider` ✅ | `navigator`+`rangeSelector` ✅✅ | none ❌ | `zoom-ranger` demo ⚠️ | rangeslider ✅ | ❌ | manual |
| Dark mode | `darkMode: 'auto'` + `setDarkMode()` ✅ | manual theme object ⚠️ | manual ⚠️ | CSS ⚠️ | template ✅ | manual | manual |
| Heatmap for VPD matrix | built in ✅ | `modules/heatmap` ✅ | plugin ⚠️ | `latency-heatmap` demo ⚠️ | ✅ | `cell` ✅ | manual |
| Accessibility module | `aria` (weak) ⚠️ | **best in class ✅✅** | weak ⚠️ | none ❌ | some ⚠️ | SVG+ARIA ⚠️ | you write it |
| Licence for commercial SaaS | **Apache-2.0, free ✅** | **paid, $732/seat/yr + SaaS licence ❌** | MIT ✅ | MIT ✅ | MIT ✅ | ISC ✅ | MIT ✅ |
| Angular 15 without a wrapper | trivial ✅ | trivial ✅ | trivial ✅ | trivial ✅ | trivial ✅ | trivial ✅ | React-only ❌ |

uPlot's own **Non-Goals**, verbatim, are the reason it is not the answer here despite winning every
benchmark: "No data parsing, aggregation, summation or statistical processing / No transitions or
animations / **No collision avoidance for axis tick labels** / No stacked series / **No built-in drag
scrolling/panning due to ambiguous native zoom/selection behavior**." It *can* do all of it — the repo
ships 99 demo files including `annotations.html`, `high-low-bands.html`, `timeline-discrete.html`,
`zoom-touch.html`, `zoom-ranger.html`, `sync-cursor.html`, `latency-heatmap.html`, `draw-hooks.html` —
but every one of those is a hand-rolled plugin you would own forever.

---

## 12. Recommendation

### 12.1 Firm call: **Apache ECharts 6, tree-shaken, no Angular wrapper.**

Reasoning, in the order that decides it:

1. **Licence.** Apache-2.0 removes a live commercial/legal exposure on a paid product with a public
   demo and open-source intent. Highcharts is $732/seat/yr *plus* a quote-only SaaS licence and cannot
   be redistributed in an open repo. ApexCharts' $2M revenue cliff is a trap. This alone decides it.
2. **It has every primitive this redesign needs as configuration, not as a plugin you maintain:**
   `grid[]` + `axisPointer.link` (small multiples with a linked crosshair — the core of §8),
   `markArea` / `markLine` / `markPoint` (target bands, day/night, annotations),
   `visualMap` piecewise (colour by deviation), `dataZoom: inside|slider` (documented two-finger touch),
   `sampling: 'lttb'|'minmax'|…` (honest downsampling that doesn't disable dash styles the way Boost
   does), `darkMode: 'auto'`, `graphic` image elements, and a built-in heatmap for the VPD matrix.
   All verified against the 6.1.0 type definitions and the ECharts docs source, not from memory.
3. **Memory.** 17 MB peak vs Highcharts' 97 MB on 166k points. On low-end Android that is the whole game.
4. **Cost of the change is bounded.** +63 KB gzip vs today's Highstock, minus the Chart.js/ng2-charts
   dead weight that can be deleted at the same time (~69 KB gzip of chart.js alone).
5. **Angular risk is avoidable** by writing the ~50-line directive rather than adopting `ngx-echarts`,
   whose majors track Angular's.

**Runner-up, and when to pick it instead:** if screen-reader/keyboard accessibility is a hard
compliance requirement and there is budget, Highcharts' accessibility module is genuinely best in class
and no OSS library matches it — but then you must also **upgrade 10.3.3 → 13.x** (3 majors, and 10.3.3
is the slow, memory-hungry version in the benchmark), buy Core+Stock seats, and give up on shipping the
cloud as open source.

**Do not pick:** ApexCharts (licence cliff, worst benchmark of the mainstream set), Plotly (1.43 MB
gzip — 10× the budget of everything else), visx (React-only, impossible in Angular), Observable Plot
(no interaction model, no crosshair, no zoom — it is a *static figure* generator).

**Keep uPlot in your back pocket** for one specific job: a dashboard of many simultaneous sparkline
tiles, where 21.5 KB and 3 MB final heap beat everything. It is a poor fit for the main interactive
chart.

### 12.2 What to build, in order

1. **Delete the dual stack.** Remove `chart.js` / `ng2-charts` / `chartjs-adapter-luxon` imports from
   `charts.page.ts`, `charts.module.ts`, `diary.module.ts`, `diagnostics.*`. Pure win, no design debate.
   (Also fix the duplicate `noData(Highcharts)` call and the `CO2 … max: 1` entry, which looks wrong for
   a ppm axis.)
2. **Small multiples + linked crosshair + pinned scrubbing header.** The single biggest readability win.
3. **Setpoint band + stepped setpoint line + deviation fill**, sourced from `device.configuration`
   (`day.temperature`, `night.temperature`, `day.humidity`, `night.humidity`, `co2.target`) and
   `Alarm.upper/lowerThreshold`. No new backend work.
4. **Day/night plot bands** from `daynight.day`/`daynight.night` (+ `lights.sunrise`/`sunset` ramps),
   preferring measured `out_light` where available. Timezone-explicit.
5. **Annotation rail** under the x-axis with pixel-proximity clustering, severity ranking, and
   full-height dashed lines for `DiaryLifecycleStage` changes.
6. **Time-in-range scorecard** (day/night split, % in / above / below, longest excursion, coverage %).
   `aggregateWindow` already gives you min/max/mean; the rest is arithmetic in the API layer.
7. **Min–max envelope** on the primary measure (3 Influx queries instead of 1).
8. **Output state-timeline lane** for `out_*` and `day`.
9. **Film strip** on the x-scale, sprite-backed, cursor-linked to the chart.
10. **VPD stage band + VPD matrix with the room's trajectory** — the differentiating feature.
11. **Okabe-Ito palette, 3:1 contrast audit, `darkMode: 'auto'`**, and a "view as table" disclosure.
12. **DLI and dew point** — cheap derived series that close a competitive gap.

### 12.3 Backend changes implied (all small)

- Add `method` values or a combined endpoint returning `{mean, min, max}` per window to avoid 3× the
  requests.
- Expose parsed `device.configuration` setpoints on the device access payload so the chart can draw the
  band without a second round trip.
- A `/data/scorecard/:device_id` endpoint computing time-in-range server-side (Flux can do it; doing it
  client-side on downsampled data would be wrong — you must compute TIR on **raw** samples, not on
  `mean`-aggregated windows, or excursions vanish). **This is the subtle correctness trap in the whole
  design.**
- A sprite/index endpoint for the film strip.

---

## 13. Risks, dead ends and honest gaps

- **Highcharts licensing is the sharpest risk.** No LICENSE file in the repo; no licence artefact for
  Highcharts anywhere in it; the product is commercial (€289 controller) with a public no-login demo;
  the vendor's own site calls the cloud "quelloffen". Whether a SaaS licence is held privately is
  **UNVERIFIED** — but redistributing Highcharts source in an open-source repo is not curable by buying
  seats.
- **Time-in-range computed on aggregated data is wrong.** `aggregateWindow(fn: mean)` destroys
  excursions. TIR/TOR must be computed on raw samples server-side. Easy to get wrong and impossible to
  notice by eye.
- **Boost silently degrades encodings.** Above `boostThreshold: 5000` points/series, dash styles and
  per-series line width stop working — so a "dashed setpoint vs solid actual" design would break at
  exactly the zoom levels where it matters, on the current stack.
- **ECharts is bigger than Highstock here** (195.6 vs 132.7 KB gzip, measured). Don't pretend otherwise;
  justify it on licence, memory and features.
- **Wrapper churn is real**: `ngx-echarts` ships a major per Angular major, and Angular 15 is already
  several behind. Hand-roll the directive.
- **Could not verify:** Nest and ecobee chart internals (404 / empty pages, search budget exhausted);
  Pulse Grow's charting library and in-app chart design (JS app shell); AROYA crop-steering chart
  specifics (`support.aroya.io` DNS failure); Neatleaf (connection timeout); TrolMaster and Growlink
  chart details (marketing pages only); ISA-101 / High-Performance HMI primary text (paywalled);
  the exact ADA time-in-range consensus wording (*Diabetes Care* returned HTTP 403).
- **WebSearch budget was exhausted at 200/200 early in the session**, so everything after that is
  WebFetch against URLs I could construct or find via GitHub code search. That biases coverage toward
  documentation and away from blog-post design critique — the design opinions in §8 lean on one strong
  primary source (Few) plus Grafana's shipped behaviour, rather than a broad survey.
- **uPlot's benchmark is run by uPlot's author.** The ordering is consistent with independent
  experience, but treat the absolute numbers as indicative.
- **`echarts.simple.min.js` (164.9 KB gz) is not a shortcut** — it omits most components Terp needs.
  Tree-shake properly.

---

## 14. Source list

- Stephen Few, *Dual-Scaled Axes in Graphs: Are They Ever the Best Solution?*, Perceptual Edge, March 2008 — https://www.perceptualedge.com/articles/visual_business_intelligence/dual-scaled_axes.pdf
- Grafana docs (repo source): time series panel, state timeline, annotate-visualizations (time regions), trend panel — https://github.com/grafana/grafana/tree/main/docs/sources
- Apache ECharts docs & option source — https://echarts.apache.org/handbook/en/basics/import/ , https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/ , https://github.com/apache/echarts-doc
- ECharts 6.1.0 TypeScript definitions (installed locally) — `node_modules/echarts/types/dist/shared.d.ts`
- Highcharts: plot bands & lines — https://www.highcharts.com/docs/chart-concepts/plot-bands-and-plot-lines ; flags — https://www.highcharts.com/docs/stock/flag-series , https://api.highcharts.com/highstock/plotOptions.flags ; boost — https://www.highcharts.com/docs/advanced-chart-features/boost-module ; annotations — https://www.highcharts.com/docs/advanced-chart-features/annotations-module ; accessibility — https://www.highcharts.com/docs/accessibility/accessibility-module ; licence — https://shop.highcharts.com/license ; pricing — https://shop.highcharts.com/
- ApexCharts pricing — https://apexcharts.com/pricing/ ; licence — https://raw.githubusercontent.com/apexcharts/apexcharts.js/main/LICENSE
- uPlot README (benchmark + non-goals) — https://github.com/leeoniya/uPlot ; demo listing via jsDelivr data API
- Chart.js decimation — https://www.chartjs.org/docs/latest/configuration/decimation.html ; annotation plugin — https://www.chartjs.org/chartjs-plugin-annotation/latest/
- npm registry (`registry.npmjs.org/<pkg>/latest` and full metadata) for versions, licences, peer deps
- Okabe-Ito palette — https://jfly.uni-koeln.de/color/ ; hex values from https://github.com/clauswilke/colorblindr `R/palettes.R`
- WCAG 2.2 SC 1.4.11 Non-text Contrast — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- Datawrapper, *What to consider when choosing colors* — https://www.datawrapper.de/blog/beautifulcolors/
- AGP / time-in-range: https://www.accu-chek.co.uk/training/cgm/agp-report , https://www.novomedlink.com/diabetes/hcp-education/clinical/time-in-range/clinical-use/understand-ambulatory-glucose-profile.html , https://www.ajmc.com/view/ada-issues-timeinrange-targets-for-cgm-use
- Mean kinetic temperature — https://en.wikipedia.org/wiki/Mean_kinetic_temperature
- VPD — https://pulsegrow.com/blogs/learn/vpd , https://support.pulsegrow.com/en/articles/4261358-what-is-vpd-and-vpd-charts , https://en.wikipedia.org/wiki/Vapour-pressure_deficit
- Pulse Pro product page — https://pulsegrow.com/products/pulse-pro
- Mux storyboard / timeline hover previews — https://www.mux.com/docs/guides/create-timeline-hover-previews
- Terp Control shop — https://terpcontrol.com/
- Terp Control codebase — `/home/user/terpcontrol.cloud/` (paths cited inline)
