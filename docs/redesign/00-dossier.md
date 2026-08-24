# Terp Control — Grounding Dossier for the Concept Redesign

**Compiled:** 2026-08-24 · **Sources:** 11 research reports in this directory + direct reads of
`/home/user/terpcontrol.cloud` on branch `claude/controller-software-user-types-wc1jxn`.
**Audience:** the concept-design team. This is your only briefing. It is written to be *checked*, not believed.

## How to read the evidence tags

| Tag | Meaning |
| --- | --- |
| **[CODE]** | Read from the repository. File and line given. Non-negotiable fact about today's app. |
| **[VERIFIED]** | A researcher hit the endpoint / read the primary document in this session. |
| **[DOC]** | Official vendor documentation. |
| **[SECONDARY]** | Blog, aggregator, trade press. Directionally useful, individually shaky. |
| **[MARKETING]** | Vendor self-reported. Not audited. Do not size a business case on it. |
| **[UNVERIFIED]** | Could not be confirmed. Treat as rumour. Never put it on a slide. |
| **[INFERRED]** | This dossier's own reconstruction, not found in any source. Flagged wherever used. |

Anything not tagged is a synthesis judgement by this dossier and is arguable.

---

# 1. Current state truth

## 1.1 The product and its physical envelope

- Company **Novazer GmbH**, site language **de-DE**. German-first audience, English second. [VERIFIED]
- Controller **€289** (€319–349 with camera), CO₂ sensor upgrade **+€59**. schema.org release date in the
  shop markup: **2026-10** — first series 150 units. **The software ships with the hardware.** [VERIFIED]
- Marketing promise: *"Messen. Regeln. Ruhig schlafen."* / *"Ein Controller für dein ganzes Zelt."* [VERIFIED]
- Community already lives on **Telegram** (`t.me/+w-XFn8c8pLQyNWFi`). [VERIFIED]
- Firmware is open source with a documented REST API — a public selling point. [VERIFIED]

**Hardware capability envelope — this bounds every concept:** [CODE, firmware]

- **Exactly one physical output**: `PwmOutput out_light` on `PIN_LIGHT = 21`
  (`firmware/src_hwtype/controller/controller.h:64,103`). Everything else is a **Tasmota smart socket over
  local HTTP**.
- **Exactly five socket roles exist anywhere in the stack**: `dehumidifier`, `heater`, `light`,
  `secondary_light`, `co2` (`firmware/src/wifi.cpp:1694-1704`; mirrored in
  `webapp/src/app/util/socket-info.ts:7`; server whitelist `server/src/services/device.service.ts:859`).
  **There is no humidifier, no exhaust fan, no circulation fan, no AC/chiller, no irrigation pump role.**
- `out_dehumidifier` **doubles as the cooler** in `temp`/`breed` workmodes (`controller.cpp:378-408`) — one
  socket, two meanings, one chart series, one alarm sensor type. Users cannot tell heat-removal from
  moisture-removal in the data.
- **Humidity can only ever go down.** There is no humidification path.
- Sensors: temperature, humidity (SHT21/SCD4x/slave-plug), CO₂ (**only with the SCD4x upgrade**, `-1`
  otherwise), optional leaf temperature (MLX90632), optional lux (VEML7700). VPD and PPFD are **derived
  server-side**, never stored.
- **There is no irrigation or dosing hardware.** Watering and fertilising are therefore a *logging and
  recall* problem, not a control problem — unless a user drives a pump through a socket.
- One webcam per device (`cloudSettings.rtspStream` is a single string).

## 1.2 Stack versions — resolved from `webapp/package-lock.json` [CODE]

| Package | Declared | Resolved |
| --- | --- | --- |
| `@angular/core` | `^15.0.0` | **15.1.1** |
| `@ionic/angular` | `^6.1.9` | **6.5.0** |
| `ionicons` | `^6.0.3` | 6.1.1 |
| `@ngx-translate/core` | `^14.0.0` | 14.0.0 |
| `highcharts` / `highcharts-angular` | `^10.3.3` / `^3.0.0` | 10.3.3 / 3.0.0 |
| `ng2-charts` (+ `chart.js`, `chartjs-adapter-luxon`) | `^4.1.1` | 4.1.1 (chart.js 4.2.0) — **dead weight** |
| `luxon` / `date-fns` / `rxjs` / `typescript` | | 3.2.1 / 2.30.0 / 7.5.7 / 4.8.4 |
| `@capacitor/core` | `4.6.2` | 4.6.2 (scaffold only; no `android/`, no `ios/`) |

Server: Express 4 + Mongoose 8 + MongoDB, InfluxDB 2 for time series, RabbitMQ + MQTT plugin as the device
bus. Shared types are a hand-maintained `shared-types/index.d.ts` (278 lines) imported by both sides as
`@fg2/shared-types`.

## 1.3 Route / page map — respect this exactly [CODE `webapp/src/app/app-routing.module.ts`]

| Path | Guard | What it is today |
| --- | --- | --- |
| `''` | — | redirect → `/list` |
| `/list` | `AuthGuard` | Device list; **when exactly one device is claimed, that device's dashboard**. Empty account → `.tc-hero` onboarding + claim-code input. Hosts the setup-wizard modal. |
| `/device/:device_id/charts` | `AuthGuard` (+share bypass) | The whole charts feature, one 1205-line component |
| `/device/:device_id/diary` | `AuthGuard` (+share) | Report switcher: `entries` \| `growreport` \| `co2report` |
| `/device/:device_id/settings` | `AuthGuard` | `ngSwitch` on `device_type` → `fan-settings` / **`fridge-settings`** / `light-settings` / `plug-settings` / `dryer-settings` |
| `/device/:device_id/testmode` | `AuthGuard` | Admin-only raw output toggles. Untranslated, German warning text |
| `/diagnostics` | `IsAdminGuard` | Stale fork of the charts page |
| `/login`, `/demo`, `/link-expired`, `/connection-error` | — | |
| `/account` | `AuthGuard` | Change password, logout. That is all. |
| `/shares` | `AuthGuard` | Share links: active/inactive, copy, revoke, delete |
| `/classes` | **NONE** | Admin fleet + firmware management — **no route guard at all**; only the menu link is admin-gated |
| `**` | — | 404 |

**Navigation model:** one `ion-split-pane` + `ion-menu`. Menu = Devices `/list`, Shared links `/shares`,
Account `/account` (+ Diagnostics, Fleet for admins — both wrongly use the `mail` icon), then dark-mode
toggle, Install app, Logout. **No tab bar, no FAB (`<ion-fab>` = 0 hits), no back button, no device
switcher, no breadcrumb.** Cross-navigation happens through six outline buttons on the device overview
(Charts, Settings, Testmode, Maintenance, Diary, Setup) and deep links from the grow assistant / grow report.

## 1.4 The data model — verbatim from `shared-types/index.d.ts` [CODE]

These are the types designers must design against. Everything a concept invents beyond these is **new
persistence work**.

```ts
export type DiaryLifecycleStage =
  'germination' | 'seedling' | 'vegetative' | 'flowering' | 'drying' | 'curing';   // note: NO harvest

export interface DiaryEntryData {          // a FLAT bag of ten optionals. No units. No nesting. No arrays.
  co2FillingRest: number;
  co2FillingInitial: number;
  newLifecycleStage: DiaryLifecycleStage;
  lifecycleName: string;                   // <- the ONLY thing resembling a plant/strain identity
  lightMeasurement: number;                // ppfd
  distanceMeasurement: number;             // cm
  tdsMeasurement: number;                  // ppm
  ecMeasurement: number;                   // mS/cm
  outsideTemperatureMeasurement: number;   // °C
  phMeasurement: number;                   // NO unit case in getDiaryDataFieldUnit()
}

export interface DiaryEntry {              // UI-only DTO. Never persisted in this shape.
  message?: string; title: string; time: Date; category: string;   // singular!
  data?: Partial<DiaryEntryData>; images?: string[];
}

export interface DeviceLog {               // THE one collection behind every event in the product
  _id: string; device_id: string;
  message?: string; title?: string; raw?: boolean;
  severity: number;                        // 0 | 1 | 2
  time: Date;
  categories?: string[];                   // plural! e.g. ['diary', 'diary-plant-log']
  deleted?: boolean;                       // does NOT mean deleted — see §1.5
  data?: Partial<DiaryEntryData>;          // Schema.Types.Mixed, ZERO server-side validation
  images?: string[];                       // bare image_id strings, no back-reference
}

export interface Image {
  image_id: string; device_id: string;     // NO log / entry / plant back-reference
  timestamp: number; timestampEnd?: number;
  data: Buffer;                            // stored INSIDE MongoDB
  format?: 'jpeg' | 'mp4' | 'user/jpeg';
  duration?: '1d' | '1w' | '1m';
}

export interface Device {
  _id?: string; name?: string; device_id: string; username: string; password: string;
  class_id: string; device_type: string;
  configuration: string;                   // a JSON STRING. Unvalidated. Firmware strips unknown keys.
  owner_id: string;                        // A SINGLE STRING. Not an array. Not indexed.
  serialnumber: number; lastseen: number;
  current_firmware: string; pending_firmware?: string;  // deprecated
  fwupdate_start: number; fwupdate_end: number;
  alarms?: [Alarm];
  firmwareSettings?: FirmwareSettings; cloudSettings?: CloudSettings;
  maintenance_mode_until?: number;
  recipe?: Recipe;                         // exactly ONE per device, embedded
  hardwareInfo?: Record<string, string>;   // free-form, filled from MQTT log lines
  demoDevice?: boolean;
}

export interface Alarm {
  name?: string; disabled?: boolean; alarmId: string; sensorType: string;
  upperThreshold?: number | null; lowerThreshold?: number | null;   // <- unused by the chart
  actionType: 'email' | 'webhook' | 'info'; additionalInfo?: boolean; actionTarget: string;
  cooldownSeconds?: number; isTriggered?: boolean; lastTriggeredAt?: number; lastResolvedAt?: number;
  retriggerSeconds?: number; extremeValue?: number; latestDataPointTime?: number;
  webhookMethod?: 'GET' | 'POST' | 'PUT'; webhookHeaders?: { [key: string]: string };
  webhookTriggeredPayload?: string; webhookResolvedPayload?: string;
  thresholdSeconds?: number; reportWebhookErrors?: boolean; tunnelWebhook?: boolean;
}

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export interface RecipeStep {
  name?: string; settings: any;            // applied as the WHOLE device configuration
  durationUnit: DurationUnit; duration: number;
  waitForConfirmation: boolean; confirmationMessage?: string;
  lastTimeApplied?: number; notified?: boolean; stage?: DiaryLifecycleStage;
}
export interface Recipe {
  steps: RecipeStep[]; activeStepIndex: number; activeSince: number;   // 0 == not running
  loop?: boolean; notifications?: 'off' | 'onStep' | 'onConfirmation';
  additionalInfo?: boolean; email?: string;
}

export type SharePage = 'charts' | 'diary';
export interface ShareLink {
  share_id: string; device_id: string; owner_id?: string; page: SharePage;
  editable: boolean;   // "visitors may change the VIEW" — NOT a write grant
  webcam: boolean; charts?: boolean;
  query?: string;      // <=2000 chars: the frozen URL query string IS the shared view
  createdAt: number; expiresAt?: number | null; revokedAt?: number | null;
  openCount: number; lastOpenedAt?: number | null;
}

export interface ChartPreset {
  preset_id: string; owner_id?: string; name: string;
  device_type?: string;
  query: string;       // the SAME URL query-string format as a share link
  createdAt: number;
}
```

**Confirmed absences.** There is no `Plant`, `Strain`, `Batch`, `Cycle`, `Harvest`, `Watering`, `Feeding`,
`Nutrient`, `Reservoir`, `Schedule`, `Role`, `Member`, `Team` or `Tenant` entity anywhere. A repo-wide grep
for `strain|harvest|batch|cultivar|phenotype|yield` across `webapp/src`, `server/src` and `shared-types`
returns three literal hits: `'My Strain'` as a hardcoded default value, `'My Strain ' + (i+1)` as a
synthetic cycle label, and prose inside grow-plan tips. [CODE]

**Time series live in InfluxDB, not Mongo.** Measurement `status`, tags `{device_id, user_id}`. Two hard
allowlists gate the vocabulary — anything else is **silently dropped**: [CODE `server/src/services/data.service.ts:12,19`]

```ts
VALID_SENSORS = ['temperature','humidity','avg','p','i','d','co2','rpm','day',
                 'sensor_type','leaf_temperature','lux'];
VALID_OUTPUTS = ['heater','dehumidifier','co2','light','fan','relais',
                 'fan-internal','fan-external','fan-backwall'];   // stored prefixed `out_`
```

## 1.5 What the diary actually is

**There is no diary data model.** [CODE, report 10]

Every "diary entry" is a row in the single `DeviceLog` collection whose `categories[0] === 'diary'`. That
one collection also stores boot messages, MQTT errors, alarm transitions, recipe steps and config diffs.
There is no `entry_type` discriminator; the split is a string-prefix convention.

**A user can record exactly five things** (hard-coded twice: option list in
`diary-entry-modal.component.html:19-23`, field whitelist `defaultDiaryEntries` in
`diary-entry-modal.component.ts:8-55`):

| Category | Fields the user can fill |
| --- | --- |
| `diary-plant-log` | free-text `message` only |
| `diary-plant-lifecycle` | `newLifecycleStage` (6-value select) + `lifecycleName` (free text, default `'My Strain'`) |
| `diary-fridge-log` | free-text `message` only |
| `diary-measurement` | light (ppfd), distance (cm), TDS (ppm), EC (mS/cm), outside temp (°C), pH (no unit) |
| `diary-co2-refill` | `co2FillingRest` (g), `co2FillingInitial` (g, default 425) |

Plus a timestamp and images. **The title is never user-editable** — `save()` overwrites it with the fixed
`message-diary-*` key (`.ts:208`). **Not recordable anywhere:** watering, feeding, nutrients, dose, volume,
training (topping/LST/defoliation), pest/disease, pot size, substrate, medium, plant count, plant height as
a first-class value, harvest weight, transplant, seed/clone source, cost, tags.

**A "grow cycle" is inferred at runtime in the browser, never stored.** `convertEventsToGrowCycles()`
(`grow-report.component.ts:691-747`) scans lifecycle log rows and **starts a new cycle whenever the stage
ordinal rolls back, or the trimmed `lifecycleName` string differs**. Renaming a plant mid-grow forks the
history. A re-veg fabricates a new plant. Cycle identity in URLs and share links is the cycle's **start
timestamp** — editing an entry's time breaks existing share links.

**Legacy traps a redesign inherits:** [CODE]

1. **`deleted` does not mean deleted.** It means "hide from the device overview log stream". Manual diary
   entries are *created* with `deleted: true` (`diary.page.ts:112`); the query param `deleted=1` means
   "include hidden". Consequence: **"Clear logs" (`DELETE /device/logs/:device_id`) removes nothing from
   the diary.**
2. **The server's own stage-transition entry is written with `categories: ['diary-plant-lifecycle']` —
   without the `'diary'` prefix** (`device.service.ts:714`). It is therefore not editable and **invisible
   in the default Entries report**, while the identical manual entry is visible and editable.
3. **No server-side pagination at all.** `getDeviceLogs` has no `.limit()`, no cursor, no count. The
   Entries report fetches the device's *entire* log history on every page open
   (`diary-entries-report.component.ts:82`). Pagination is client-side at 100 rows.
4. Two lifecycle category slugs must be supported forever (`diary-plant-lifecycle` and legacy
   `plant-lifecycle`), plus **seven legacy English-prose regexes** in `log-translate.service.ts:102-116`
   that keep pre-i18n rows readable.
5. **Diary photos leak forever.** `DELETE /image/:image_id` exists and is never called by the webapp;
   retention/thinning filters `format:'jpeg'` only, so `user/jpeg` blobs accumulate. The unique index
   `{device_id, format, timestamp, duration}` means two uploads in the same millisecond collide.
6. `express-fileupload` is mounted with **no size limit**; images are Mongo `Buffer`s capped by the 16 MB
   BSON limit with no graceful failure path.
7. `raw` is vestigial (always false, forced false by the renderer). `severity` is a device-alert concept the
   diary inherits and never uses (every manual entry is 0). `diary.page.scss` and three other diary SCSS
   files are 0 bytes.

**The grow report** (1270 lines) shows: cycle picker, cycle header with event count, per-phase summary
(start date, duration days, "total day X–Y") with chart deep-links, a day-by-day vertical timeline with
time-scaled gap lines, and a floating webcam scrubber. **~370 of its lines are DOM-measuring scroll-linked
scrubber code** reading `getBoundingClientRect()` of `.day-dot` / `.gap-line-vertical`. It shows **no
aggregates, no yield, no cycle comparison and no export.**

## 1.6 What the chart actually is

One `<highcharts-chart constructorType="stockChart">` driven by a 1205-line component. [CODE, reports 06 & 11]

- **Up to 15 measures, each on its own independent hidden y-axis**, each drawn as `type: 'area',
  fillOpacity: 0.1, threshold: null`, each with `softMin: 0` and its own `softMax`. Axis labels are
  suppressed below 320 px width. On a phone you get N overlapping translucent areas **with no axis at all**.
- **No setpoint. No target band. No day/night shading. No annotations.** Nothing in the chart pipeline
  knows what the device was supposed to be doing.
- Events are three plain `column` series of constant height 1 on hidden 0..1 axes, coloured by severity.
  Reading one requires **hovering**, which does nothing on touch. Highstock's `flags` series is never used.
- Live mode re-fetches **everything** every 10 s (all series + all logs + a `router.navigate`), with no
  incremental update and no `?since=`.
- Series titles (`Temperature`, `Humidity`, `Critical logs`) are **hardcoded English** while the page chrome
  is translated. A German user sees English legends and tooltips.
- Dark mode is a second hand-maintained Highcharts palette applied via a `MutationObserver` on `body.class`.
- `noData(Highcharts)` is registered twice; `CO2` carries `max: 1` for a ppm series; `Lights` and `Day` share
  the colour `#c8a23c`; `out_fan` and `out_fan-internal` share `#2e9e8f`.
- **The URL query string *is* the view model** — and it is also the on-disk format of every saved chart
  preset and every share link. Parameters: `measures` (incl. pseudo-values `image`, `logs`), `date`,
  `dateEnd`, `vpdMode`, `autoUpdate`, `useCustom`, `timespan`, `interval`, `logs`, `share`. It is duplicated
  in five places. **Changing it breaks existing presets and every share link in circulation.**
- Webcam: hovering any point loads a still after 500 ms; when *no* measure is enabled and auto-update is
  off, it swaps to an mp4 timelapse. Only the `1d`/`1w`/`1m` timespans carry a timelapse.
- Interval is **not constrained by timespan**: `3y` × `5s` ≈ 18.9 M aggregation windows is one dropdown away.
  The `limit(n: 50000)` guard is piped **after** `yield()` and therefore does not bound the result.
- **`from`, `to`, `interval` and `measure` are interpolated raw into Flux.** Only `method` is allowlisted.
  Any concept that widens the measure vocabulary must fix this first.

## 1.7 What the controller UI actually is

**There is no controller UI.** [CODE, report 12]

`webapp/src/app/devices/` contains `fridge/`, `dryer/`, `fan/`, `light/`, `plug/` — **no `controller/`**.
A `device_type === 'controller'` is rendered by the **fridge** components, wired by two `ngSwitchCase` lines
(`list.page.html:105-115`, `settings.page.html:14`), differentiated only by ~12 `device_type === 'controller'`
guards and by `hardwareInfo` capability probing.

Consequences visible to a paying customer today:

- `overview.component.html:40` hard-codes the type label `{{'devices.fridge.title'|translate}}` →
  **"Terp Control FRIDGE GROW"**. A controller's dashboard card literally says it is a fridge.
- An unnamed controller is *named* `devices.fridge.title` (`overview.component.ts:91-94`).
- There is **no `devices.controller` block** in `en.json` or `de.json`.
- Workmode labels are the fridge's: "Small Plants", "Greenhouse", "Drying", "Germination", "Big Plants".

**Capability detection** is derived from hardware, never stored:
`deviceControlCapability()` (`grow-presets.ts:143-173`) reads the `hardwareInfo.sockets` CSV →
`'full'` if **any** of dehumidifier/heater/co2 is paired, else `'light_only'` if any light role, else
`'monitor'`. **Absent key (old firmware) fails open to `'full'`.** So a heater-only tent is shown humidity
targets, a humidity-deviation warning and a dehumidifier alarm preset it can never act on.

**A goal is only ever a setpoint pair.** `device.configuration` (a JSON string):

```jsonc
{ "workmode": "off|breed|temp|small|full|dry|exp",
  "daynight": { "day": 21600, "night": 79200,          // seconds-of-day, UTC
                "floating": false, "float_start": 0, "day_duration": 86400, "light_duration": 43200,
                "maxDehumidifySeconds": 0, "targetHumidityDiff": 5, "useLongHumidityAvg": false,
                "linearChange": false, "minimalDehumidifierOffTime": 240 },
  "co2":    { "target": 400, "sunsetOff": false },
  "day":    { "temperature": 25, "humidity": 60 },
  "night":  { "temperature": 25, "humidity": 60 },
  "lights": { "sunrise": 0, "sunset": 0, "limit": 100, "maintenanceOn": false },
  "fans":   { "external": 100, "internal": 100 } }        // hidden for controller, unread by firmware
```

The controller firmware (`controller.cpp:455-514`) reads **only 15 of these keys**. Silently ignored while
being offered in the UI: `lights.maintenanceOn`, `co2.sunsetOff`, `daynight.linearChange`, and the entire
`daynight.floating` / `float_start` / `day_duration` / `light_duration` beta feature — **which no firmware
anywhere reads. Zero grep hits across `firmware/`. It is a dead control.**

**VPD is never a target.** It is computed (`calculateVpd.ts`, Tetens, leaf-offset corrected) and only
*displayed*: a preview under the humidity row, a gauge, a chart series, and an advisory `vpdRange` in the
stage picker. Nothing regulates to it.

**Stage presets already exist and already carry a VPD band** (`GROW_STAGE_PRESETS`, `grow-presets.ts:37-118`):

| stage | day/night °C | day/night %RH | light h | limit % | CO₂ enriched | vpdRange kPa |
| --- | --- | --- | --- | --- | --- | --- |
| seedling | 24 / 21 | 70 / 65 | 18 | 40 | 400 | 0.4–0.8 |
| vegetative | 26 / 22 | 62 / 58 | 18 | 80 | 900 | 0.8–1.1 |
| flowering | 25 / 20 | 50 / 50 | 12 | 100 | 1000 | 1.2–1.5 |
| late_flowering | 24 / 18 | 45 / 45 | 12 | 100 | 400 | 1.3–1.6 |
| drying | 18 / 18 | 58 / 58 | — (workmode `dry`) | — | 400 | 0.9–1.3 |

**So "goal vs actual" is a presentation gap, not a data-collection gap.** The targets exist client-side and
are simply never drawn against the measured series.

**Recipe engine** (`device.service.ts:396-550`, ticked every 20 s): sequential steps with durations
(minutes→weeks), `waitForConfirmation`, `loop`, e-mail notifications, diary stage hooks, public/private
templates. Hard limits: **one recipe per device**; `RecipeStep.settings` is applied as the *whole* device
configuration; settings are re-pushed at most **hourly** and **only to a device seen in the last 60 s**;
`waitForConfirmation` **halts the entire plan indefinitely**. An unknown `durationUnit` silently means
*minutes*.

**Simple vs Expert** is the only progressive-disclosure precedent: an `ion-segment` at the top of fridge/
controller settings, persisted in `localStorage['app-settings-expert']`, **simple by default**, forced back
to simple by the setup wizard. Documented in German at `docs/einfach-modus.md` (106 lines) — read it before
designing anything in this area. Simple mode = reference banner, running-plan card *or* stage picker,
maintenance mode, target rows, notifications card. Expert adds the recipe editor, the full settings form,
aux devices, cloud settings and the full alarm editor. **Save is a full-page action** that writes settings +
recipe + alarms + cloud settings together and then navigates away to `/list`. No per-card save, no dirty
state, no undo.

## 1.8 Auth and ownership — one equality test

```ts
// server/src/middlewares/auth.middleware.ts:172
const devices = await deviceModel.find({ owner_id: req.user_id, device_id: device_id }, { device_id: 1 });
```

**That line is the authorisation model.** [CODE, report 13]

- `Device.owner_id` is a single `String`, **not indexed**, not an array.
- Claiming a device is a **silent transfer**: `findOneAndUpdate({device_id}, {owner_id: user_id})` with no
  check on and no notification to the previous owner.
- **Share links are read-only, full stop.** `editable` means "visitors may change the *view*". Only four
  handlers accept a share token: `getSeries`, `getLatest`, `getDeviceLogs`, `getDeviceImage`.
- Two global escape hatches: `is_admin` short-circuits everything; `POST /tokenlogin` mints a 5-minute
  **admin JWT with `user_id: ''`** for anyone holding `AUTOMATION_TOKEN` — a fleet-wide root key.
- `isUserDeviceMiddelware` is **not real Express middleware** — it is an awaited helper each controller must
  remember to call. `DELETE /device/logs/:device_id` already forgot (not exploitable, but it is the failure
  mode of the pattern).
- **`POST /device/claimcode` is unauthenticated** for any device that has not reported
  `hardwareInfo.claimcode_auth === 'on'`. Knowing a `device_id` — which appears in every webapp URL — is
  enough to mint a claim code and take the device. **Treat as a blocker to fix before any concept that
  surfaces device ids more widely.**
- **There is no migration tooling.** No migrate-mongo, no versioned migrations, no `schemaVersion`. The
  house style is: optional field + read-time normaliser + (if needed) an idempotent boot-time backfill in a
  service constructor. **A new required field is a breaking change with no tool to apply it.**
- Rate limiting exists **only on `/auth`**. `cors()` is called with no options (reflects any origin) while
  the auth token rides in a cookie; only `sameSite:lax` stands between that and CSRF.
- JWTs cannot be revoked. `imageToken` is valid **30 days** and is deliberately URL-embeddable.

## 1.9 The design system that exists (and is genuinely good)

[CODE, report 14] **100 % NgModule. Zero standalone components** (`grep -rn standalone` → two unrelated hits).

- Tokens in `webapp/src/theme/variables.scss` (light in `:root`, dark in `body.dark`). Brand blue
  `#2d4b95` (structure) + green `#50a030` (**the primary CTA colour**). Full blue-tinted step-50…950 scale
  for both themes.
- Custom tokens: `--tc-radius-sm/md/lg` (6/12/20px), `--tc-shadow-sm/md/lg`, `--tc-gradient-panel`,
  `--tc-gradient-step`, `--tc-halo`, `--tc-surface-subtle`, and `--tc-text-danger/-warning/-success/-info`
  (which exist because the `--ion-color-*` fills are unreadable as text on light surfaces).
- Reusable classes in `theme/brand.scss`: `.tc-hero`, `.tc-panel` (unused), `.tc-eyebrow`, `.tc-step-badge`,
  `.tc-pill` (+ `--green/--warning/--muted`), `.tc-preset-card` (+ `__title/__subtitle/.active`), `.tc-lift`,
  `.tc-field-hint`, `.tc-text-*`. Global overrides make `ion-button` non-uppercase 600-weight, `ion-card`
  12px radius + border, `ion-badge` a pill, and `ion-card.ion-color` a tinted surface with a 4px accent
  border.
- **`ion-card` is the universal container** — 86 cards vs 7 `ion-list`.
- Dark mode via `ThemeService` toggling `body.dark`, `localStorage['app-dark-mode']`, following
  `prefers-color-scheme` live when unset. Component convention: `:host-context(body.dark)`.
- Typography: Inter from Google Fonts. **~700 KB of unused fonts** (OpenSans, BalooBhaina, icomoon) ship with
  no `@font-face`; two templates reference icomoon classes that render nothing.
- **~30 MB of unused wizard videos** in `webapp/src/assets/wizard/` (23 `.mp4`: `connect.mp4`, `teachin.mp4`,
  `sockettype_*.mp4`, `overview.mp4`, …) are copied into every production build and referenced nowhere.
  An obvious missed opportunity for any guided flow.

**The reusable inventory a concept should build from, not around:**

| Piece | What it already does |
| --- | --- |
| `value-display` | 266-line SVG gauge: value arc + limit arc, needle, 1 h average line, target line, HSL colour interpolation, renders `—` for missing values |
| `value-edit-row` | **The canonical numeric setting row.** Tap → expands into `[−] ion-range [+]`, fully ARIA-annotated, step-aware rounding |
| `stage-preset-picker` | Grid of `.tc-preset-card`s over `GROW_STAGE_PRESETS`, subtitle `24/21 °C · 70 % · 18 h` + `VPD 0.4–0.8 kPa` |
| `grow-assistant-card` | Running-plan header, live range check (±1.5 °C, ±7 % RH) producing green/warning pills, 4 stage tips, deep link to a chart preset |
| `setup-wizard` | 289-line adaptive onboarding: `name → [connections] → stage → plan → done`, hardware-aware step list, editable phase durations, real error text (`HTTP <status> — <path> — <message>`) |
| `LogEntryViewerModule` | `app-log-entry-viewer` (100/page pagination + `collectLogCategories`/`matchesLogCategory`/`filterLogsByCategory`), `app-log-entry-item` (severity colours, repeat counts, `data` list with units, image thumbnails → fullscreen modal, category chips, edit/delete), `app-log-category-selector`, `app-image-viewer-modal` |
| `ShareLinkModule` | View-only vs interactive, optional "include charts", expiry picker, copy button |
| `rangeGuard` directive | Slider inert until its row is tapped, disarms 8 s after last interaction — mobile scroll protection |
| `KeyedCache` (`util/keyed-cache.ts`) | **Mandatory** for any derived-array template getter, or `ngFor` rebuilds the DOM every change-detection cycle |
| `diary-query-params.ts` | The URL⟷view-state convention (`mergeDiaryQueryParams`, `parseDiaryReport`) |

**Dead / broken, do not reuse:** `app-outputdisplay` (not declared, not used, template binds non-existent
members), `TimestampPipe` (returns `0` unconditionally), `.wider-popover`/`.dialog-fullscreen` declared
inside component SCSS where Ionic overlays can never see them (any new overlay class must go in
`global.scss`).

## 1.10 i18n

`@ngx-translate/core` 14 + `TranslateHttpLoader` fetching `assets/i18n/<lang>.json` **at runtime**.
Language = browser language. **There is no language switcher and no persisted preference.**
`en.json` = 885 leaf keys / 93 top-level sections; `de.json` = 883. **Exactly two keys drift**
(`diagnostics.serialnumber`, `diagnostics.show`, missing in `de.json`). Nothing missing from `en.json`.

The `message-*` convention (69 flat top-level keys, 43 bases) is resolved by `LogTranslateService`:
`<full>-<title|text>` → `<base before ':'>-<suffix>` with `{value: after-colon}` → seven legacy English-prose
regexes → raw string. Interpolation is mustache only — **no ICU, no pluralisation**; the codebase hand-rolls
plurals.

**Real i18n bugs that render raw keys today:** `settings.limits.overtemperature.enabled` /
`.undertemperature.enabled` / `.time.enabled` (plug settings checkboxes), **`simpleSettings.light.floatingNote`
(live and user-visible)**, `devices.plug.settings.heater-day`/`-night`, and the entire missing `buttons.*`
and `outputs.*` sections. Hardcoded untranslated text: the German Plantalytix migration block in
`login.page.html`, all of testmode/diagnostics/classes, and a native `confirm('You have unsaved changes…')`
in the diary entry modal.

## 1.11 Test reality

29 spec files, **38 `it()` blocks**, 24 of which are a lone `it('should create')`. Only
`grow-report.component.spec.ts` (5 tests over `convertEventsToGrowCycles`) and `round.pipe.spec.ts` (4) test
anything. **`app.component.spec.ts` still asserts an Ionic scaffold menu containing 'Inbox'/'Outbox' and
cannot pass.** CI runs `lint:fix` + build and **never runs `ng test`**. Do not gate delivery on the suite;
do write tests in the `grow-report.component.spec.ts` style (plain class construction with stubs).

**Local verification is available and there is no excuse for unverified UI claims:** `./simulate-device.sh`
fully simulates a controller over real MQTT — registration, claiming, history backfill, camera stills,
socket pairing, firmware updates, forced sensor values.

---

# 2. The seven user types

> **HONESTY FLAG.** The canonical seven-type list was in the original brief to the orchestrator and is **not
> recorded anywhere in the research corpus or the repository.** Three types are anchored by verbatim
> references in the reports; the other four are **[INFERRED]** by this dossier from
> `deviceControlCapability()`'s three-bucket model plus the six external research topics that were
> commissioned. **Confirm the real list with the owner before any concept is judged against it** — see Open
> Question 1. Each type below states what is anchored and what is reconstruction.

### Type 1 — Monitor-only (no sockets paired) [INFERRED, but the capability bucket is [CODE]]

*Anchor:* `deviceControlCapability()` returns `'monitor'` when no climate and no light role is paired; the
UI already has a "reference values" banner and a monitor-only wizard path (`['name','connections','done']`).

- **Needs:** trustworthy readings with an age on them; VPD; alerts that reach the phone; a chart that
  answers "is my tent OK"; history to compare against next run.
- **Today:** gets the full fridge dashboard including a dehumidifier tile and a humidity target row it can
  never act on. The wizard correctly skips stage/plan; nothing else in the app does.
- **Gap:** the app promises control it cannot deliver. No "this device only measures" mode outside two
  banners. No time-in-range verdict — the chart is decoration.

### Type 2 — Light-only (dimmable lamp on the PWM output or a `light` socket) [INFERRED; bucket is [CODE]]

- **Needs:** photoperiod and dimming that are obviously correct; sunrise/sunset ramps; verification that the
  lamp actually did what the schedule said; DLI.
- **Today:** `deviceControlCapability()` returns `'light_only'`, which hides the light-intensity slider in
  simple mode and shows a hint. `out_light` is plotted as a 0–100 line on a value axis. `is_day` on the
  overview is inferred from `out_light >= 0.5`, **not** from the configured photoperiod.
- **Gap:** no DLI anywhere in the repo. No day/night shading on the chart. A failed contactor is invisible.

### Type 3 — Partial control (some sockets: e.g. light + heater) **[ANCHORED — report 12 §7 verbatim]**

- **Needs:** to know *which* of the targets the app shows are actually actionable, and to not be nagged
  about the ones that are not.
- **Today:** having a `heater` socket but no `dehumidifier` already returns `'full'`
  (`grow-presets.ts:166-168`). The humidity target row, the grow-assistant humidity deviation warning and the
  "Dehumidifier running non-stop" alarm preset all appear. Alarm presets are not capability-filtered — only
  `requiresCo2` exists. The dashboard shows `out_dehumidifier` and `out_co2` tiles regardless of whether
  those sockets exist.
- **Gap:** capability is collapsed from per-role truth (which `hardwareInfo.sockets` already carries) into
  three buckets, and the per-role view exists only inside the one-time wizard `connections` step.

### Type 4 — Full tent (everything on sockets: heat, humidifier, dehumidifier, cooler, air) **[ANCHORED — orchestrator notes verbatim]**

- **Needs:** to bind every piece of kit to a role and steer the room by VPD.
- **Today:** **only five socket roles exist.** There is no humidifier, no exhaust fan, no circulation fan,
  no AC/chiller. `dehumidifier` doubles as the cooler depending on workmode. `fans.external`/`fans.internal`
  are hidden for controllers and unread by the firmware, so the classic "raise exhaust to drop humidity"
  lever does not exist. Workmodes are mutually exclusive: `temp` gives cooling but drops humidity control;
  `small` gives humidity but the same socket becomes a dehumidifier. There is no "cool AND dehumidify".
- **Gap:** the type the marketing promise ("ein Controller für dein ganzes Zelt") is written for is the type
  the firmware cannot currently express. **Anything a concept invents here needs new firmware roles + a new
  server whitelist + new UI. That is the most expensive gap in the document.**

### Type 5 — Closed-loop DIY (own sensors/actuators, wants to script it) **[ANCHORED — report 12 §7 verbatim]**

- **Needs:** a read/write API, their own measures, MQTT or webhook access, Home Assistant.
- **Today:** **no public write API for outputs.** `POST /device/test/:device_id` is the admin test harness
  (fixed field set, requires `workmode === 'off'`, auto-stops on page leave). MQTT is server-internal.
  `VALID_SENSORS` is hard-coded and the chart measure catalogue is a literal array inside a component, so an
  EC/pH/soil-moisture probe can only enter as a **manual diary entry**. Outbound automation exists only as
  per-alarm webhooks. `device.configuration` cannot carry custom keys — the firmware strips them on echo.
- **Gap:** this is the highest-advocacy, most sceptical segment in the market (report 04: they write their
  own Go apps rather than use anyone's), and the product currently has nothing for them.

### Type 6 — Club / multi-user (Anbauverein, or simply two people and one tent) [INFERRED from the commissioned research topic + report 05]

- **Needs (club):** room-scoped roles, a participation/duty log (§ 17 Abs. 2 KCanG demands members
  participate *eigenhändig*), device-attested environmental records their compliance platform can ingest,
  date-range export with an anonymise toggle.
- **Needs (household — the far larger case):** two people, one grow, separate logins, **separate
  notifications**.
- **Today:** `owner_id` is one string. Share links are read-only. Claiming is a silent takeover.
  `DeviceLog` has **no actor field** — with several writers you cannot tell who changed a setting.
  Shares, chart presets and recipe templates each carry their own singular `owner_id`, and
  `RecipeTemplate.name` is **globally unique across all users** (two growers cannot both have "Autoflower").
- **Gap:** greenfield. See §6 for what to build and what to refuse.

### Type 7 — Diary keeper / publisher (wants a record, wants to share it) [INFERRED from the commissioned research topics 01 & 03]

- **Needs:** a per-plant record with photos, feeding and watering; a weekly summary; a link they can paste
  into a forum, Telegram or Discord; ideally a push to GrowDiaries.
- **Today:** five entry types, no plant entity, no watering, no feeding, no harvest, no yield, no export, no
  aggregates, no public link (share links are per-view and unlisted, not a published diary). Timelapses
  exist but have **no relation to a grow cycle, phase or entry**.
- **Gap:** see §4 — every outbound platform is closed, so this must be built as *export + assisted publish*,
  not sync.

---

# 3. Hard constraints

These are not preferences. A concept that violates one of them is not implementable in this codebase for
this release.

1. **Angular 15.1.1 + Ionic 6.5.0, NgModule only.** A new page = folder + `x.module.ts` +
   `x-routing.module.ts` + `loadChildren`. A new shared component is declared **and exported** in
   `components.module.ts`. Introducing standalone components would be the first instance in the codebase.
   `tsconfig` is strict with `strictTemplates`. Ionic 6 means the Ionic-7 form-control `label`/
   `labelPlacement` API is **not available** — the codebase uses `ion-label position="floating"`.
2. **`device.configuration` cannot carry new keys.** `grow-presets.ts:31-34` states it verbatim: the
   firmware strips unknown keys when it echoes its config back. **Every new concept — plants, feeding
   schedules, plant↔socket mapping, roles — must be stored cloud-side in MongoDB, keyed by `device_id`.**
3. **Firmware/MQTT changes are expensive and gated by an October 2026 hardware release.** Prefer cloud-only
   designs. A concept requiring a new socket role, a new sensor field or a new MQTT topic must say so
   explicitly and be costed as firmware work: new role plumbing (`firmware/src/wifi.cpp:1694-1704`) **and** a
   new server whitelist (`device.service.ts:859`) **and** new UI.
4. **One writing account per device.** Any multi-user concept requires a new membership collection and a
   rewrite of `auth.middleware.ts:172` and `:207`, plus loosening ~10 owner-scoped service queries. It is
   not a flag.
5. **No migration tooling exists.** New fields must be optional, with a read-time normaliser and, if
   required, an idempotent boot-time backfill.
6. **en + de are both mandatory, in the same commit.** The bundle is 885/883 and worth keeping that way.
   Log/diary strings must use the `message-*` + `-title`/`-text` convention. No ICU plurals available.
7. **Mobile-first, and the phone is genuinely hostile today.** Chart pan requires Ctrl, zoom requires Shift,
   the log interaction is hover-driven, axis labels are hidden below 320 px, and there is no service worker
   (the app is installable but **not offline-capable**). Component SCSS budget is **2 kB warn / 4 kB error**.
8. **Three restricted modes must work on every new screen:** share/view-only (`locked`, `canEdit`,
   `webcamAllowed`, `chartsAllowed` via `resolveDeviceAccessInfo`), demo session (`auth.isDemo`, saves
   disabled), and public view (menu button swapped for a theme toggle). Missing any of these breaks share
   links.
9. **Shareable view state belongs in query params**, and the existing format is persisted user data
   (presets + share links). Extend it; do not redefine it without a back-compat path in `applyViewParams`.
10. **The API has no server-side pagination for logs and no rate limiting outside `/auth`.** Any concept
    that multiplies rows (per-plant entries, feed events, tasks) must budget the pagination work.
11. **No community feed.** Report 04 read ~200 App Store reviews across TrolMaster and VIVOSUN, both of
    which ship one; **not a single review praised it.** It is permanent moderation cost. (This constrains
    scope; it does *not* forbid a public shareable diary link — see §4.)
12. **Never ship a `KCanG-konform` badge or any compliance warranty.** See §6.

---

# 4. External integration reality

## 4.1 Grow-diary platforms — verdict table

| Platform | Public API | OAuth | Import | Export | Webhooks | **Verdict** |
| --- | --- | --- | --- | --- | --- | --- |
| **GrowDiaries** (449.7K visits/mo, ~29 % DACH) | **No** [VERIFIED] | No | No | No | No | **Not at all.** Export-and-paste only. |
| **Grow with Jane** (500K+ Play installs) | **No** [VERIFIED] | No | No | GDPR request only | No | **Forbidden.** ToS §(c)(7) bans scraping outright. |
| **SuperGreenLab** (GPL-3, negligible reach) | Yes, live | Bearer JWT | — | Public reads unauthenticated | — | **2-way technically possible.** Schema donor only. |
| **Discourse** (autoflower.org, social.growithjane.com) | Yes [DOC] | User API Keys | — | — | **Yes, native** | **1-way publish + read-back comments. The best real target.** |
| **XenForo 2.3** (rollitup.org, 420magazine.com) | Yes, live [VERIFIED] | **OAuth2 + PKCE** | — | — | Add-ons only | **1-way publish.** Admin must register the client. |
| **Percy's Grow Room** (WordPress + wpForo) | `wp-json` open but **no wpForo namespace** [VERIFIED] | — | — | — | — | **Not at all.** |
| **SeedFinder** (strain DB) | **DEAD since 2024-07-01** [VERIFIED] | — | — | — | — | **Do not plan on it.** All endpoints 404. |
| **Pulse Grow** | Yes, OpenAPI 3.0.4, `x-api-key` | — | — | — | No (pull-only) | Not a sink. **Copy its shape.** |
| **AC Infinity** | Reverse-engineered only | — | — | **CSV export exists** | No | Inbound migration via user CSV only. |
| **TrolMaster** | Request-form, **$15/mo per device**, read-only | — | — | — | No | **No scenario justifies paying it.** |
| **Weedmaps / Leafly** | "not onboarding new integrations" / cut in 2016 | — | — | — | — | Closed doors, not slow ones. |
| **Cannanas / 420cloud** (German CSC SaaS) | Cannanas: **public OpenAPI, 185 paths** [VERIFIED] | Bearer | — | PDF/CSV/XLSX | Not documented | **Business development, and the highest-upside one.** |

**Key facts a concept must not get wrong:**

- **Rename the feature.** "Sync to grow diaries" is unachievable against every target and will generate
  support tickets. Ship **"Export week" / "Share diary"**.
- **CORRECTION to a widely-repeated claim:** GrowDiaries' ToS does **not** forbid robots/spiders/scraping.
  The full 26,892-byte `/terms` page was read; there is no anti-automation clause, and the URL the
  circulating quote is attributed to (`/terms/privacy`) returns **404**. [VERIFIED] **Do not repeat that
  quote internally or to counsel — it will not survive checking.** The barrier is *technical* (Cloudflare),
  not contractual, and circumventing an access-control measure carries its own § 202a StGB / CFAA-flavoured
  exposure and gets **the customer's** account banned, not ours.
- **"GrowDiaries has an API" is half-true and dangerous.** `/api/v1/` exists (`robots.txt` disallows it; one
  endpoint is known from a public scraper) but it is internal, undocumented, Cloudflare-gated, and actively
  churning — a brand-new Android app shipped **5 Aug 2026**. Anything built on it breaks.
- **Grow with Jane is a hard no.** ToS §(c)(7) *"strip, scrape, or mine data"*, §(d)(1) reverse engineering,
  §(d)(4) circumventing access controls — and the backend is Firebase (project `jane-14027`), so a write
  path means impersonating their client. [VERIFIED]
- **Two-way sync has no precedent anywhere in this market.** Only SuperGreenLab is technically capable and
  nobody has shipped grow-diary conflict resolution. Promising 2-way means inventing the category *and*
  owning the merge-conflict UX. Scope v1 to one-way publish + read-back comments on Discourse.
- **"Self-serve" forum APIs still need one admin email each.** Discourse needs our redirect in
  `allowed_user_api_auth_redirects`; XenForo needs the admin to create the key or register the OAuth2 client.
  Plan a per-forum outreach list, not zero-touch onboarding.
- **Dead but still in listicles:** `autoflower.net` now 301s to the **BC Society of Respiratory Therapists**;
  `growbuddy.com` is **NXDOMAIN**; `api.otreeba.com` does not connect; Trellis is gone. Do not put them on a
  roadmap slide.
- **Vendor numbers are marketing.** GrowDiaries "350,000 users / 90,000 diaries" and Grow with Jane
  "650,000 growers / 1M growlogs" are self-reported. The independently checkable figures are far smaller —
  Grow with Jane's own forum has **162 monthly-active users**. Conversely, Grow with Jane's tiny web traffic
  understates it because it is app-first with 500K+ installs. Rank by audience, not by Similarweb.

**The data model that matters.** GrowDiaries is **week-bucketed**; Grow with Jane is **day-indexed with
named stages** (germination Day 1–3 → seedling 4–10 → vegetative 11–49 → flowering 50–115 → drying 116–124 →
curing 125+). **Store both a day counter and derived week buckets, or one export is permanently lossy.**
GrowDiaries' per-week numeric fields — Height cm, Light Schedule hrs, Day Air Temp, Night Air Temp, Air
Humidity %, Solution Temp, Substrate Temp, pH, EC, PPM/TDS, Pot Size L, Watering Volume L, Lamp Distance cm —
are **11 of ~16 already measured or derivable by a Terp Control controller.** Nutrients are stored as
**catalogue product × ml/L**; a free-text nutrient field will not export.

**There is NO interchange standard.** GitHub topic `grow-diary` has exactly 4 repos; the nearest candidate
schema has 3 stars and is inactive USDA horticulture metadata. Zapier has zero grow-journal apps. No IFTTT
service. Make.com only via Discourse. **If Terp Control publishes a clean JSON diary schema it is the
first — that costs one documentation page.**

## 4.2 Social platforms — viability given cannabis content policy

**The structural insight: the platforms with strict cannabis policies are exactly the platforms that require
app review, and the permissive ones are exactly the ones with no gatekeeper. The review process *is* the
enforcement mechanism.** There is no configuration where Terp Control gets Instagram/TikTok/Threads access
"carefully".

| Platform | Cost | Gate | **Verdict** |
| --- | --- | --- | --- |
| **Discord webhooks** | Free | **None — no auth at all** | **BUILD. Works today with existing code.** 5 req / 2 s per webhook, 2000 chars, 10 embeds, multipart files, 20 MB free tier. |
| **Telegram bots** | Free | Bot token | **BUILD. Works today with existing code.** 30 msg/s free; photos 10 MB multipart / 5 MB by URL. |
| **Generic webhook** | Free | None | **BUILD.** Transitively unlocks n8n, Make, Zapier, IFTTT, Home Assistant, ntfy, Matrix, Postiz — and moves the entire platform-policy problem to the user's side of the trust boundary. |
| **Bluesky** | Free | **No key, no portal, no review** | **Tier 2.** 1,666 creates/hour, 11,666/day. Guidelines prohibit only *unlawful commerce*. `createSession` capped at **300/day** — cache sessions. |
| **Mastodon** | Free | Per-instance app registration | **Tier 2.** 300 req / 5 min per account and per IP. The Server Covenant says nothing about drugs. |
| **X / Twitter** | **$0.015/post, $0.200 if it contains a URL** | OAuth2 PKCE | **Tier 3 at best.** The link surcharge is decisive: 500 users × 4 posts/mo = $30 without links, **$400 with**. At 5,000 × 8 with links: **$8,000/month**. BYO-credentials or strip links. |
| **YouTube** | Free within quota | **Audit + quota extension form** | Tier 3. New projects get 100 `videos.insert`/day. Verify whether unaudited projects are still locked to `private` before promising public timelapses. |
| **Instagram** | — | App Review + Business Verification + screencast | **NEVER BUILD.** Also requires media on a **publicly accessible unauthenticated URL** for Meta to fetch — a privacy failure for a cannabis product independent of the policy problem. |
| **Threads** | — | Same Meta queue | **NEVER BUILD.** |
| **TikTok** | — | ToS-compliance audit | **NEVER BUILD.** Without the audit every post is **silently restricted to private viewing**. It would ship a feature that appears to work while posting nothing anyone can see. |
| **Reddit** | Manual approval since Nov 2025 | Ticket queue | **NEVER AUTO-POST.** Large cannabis subs enforce self-promotion rules strictly; this bans users and blacklists the brand in the communities that matter most. |
| **Facebook / Signal** | — | — | **NEVER BUILD.** Signal has no official bot API. |
| **Ayrshare** and managed aggregators | **$8.99 per social profile** | — | **Dead end for consumer SaaS** — cost scales with user count, ~$9k/month at 1,000 connected users. |

**The asymmetry that settles it:** a failed Discord post means the user revokes a webhook. A failed Instagram
post means **the user loses their Instagram account with no appeal, and Terp Control was the proximate
cause.** Offer "copy formatted post to clipboard" + a share link instead, so a human makes the decision.

**§ 6 KCanG is the sharpest German constraint:** *"Werbung und jede Form des Sponsorings für Cannabis und
für Anbauvereinigungen sind verboten"*, fines up to **€30,000**, read broadly to cover social media ads,
paid influencer cooperation and merchandise. Berlin clubs reportedly shut their social channels entirely.
**An auto-appended "Powered by Terp Control" footer on thousands of German users' cannabis grow posts is the
single riskiest string in the whole feature.** No court ruling squarely on grow-equipment advertising under
§ 6 was found [UNVERIFIED] — get counsel before shipping any branded footer. Also: X's Developer Policy
*contractually requires* showing the user exactly what will be posted before publishing, and its automation
rules ban "duplicative or substantially similar content over multiple accounts you control" — which is
precisely what identical templated grow-update boilerplate looks like.

**What Terp Control already has** (this materially changes the build estimate — most of Tier 1 exists):
`server/src/utils/webhookTemplate.ts` does `{{placeholder}}` substitution in `'json'` mode (escapes so
substitution can never produce invalid JSON) and `'url'` mode (`encodeURIComponent`). `alarm.service.ts`
supports GET/POST/PUT, custom headers, separate triggered/resolved payloads, `reportWebhookErrors` device-log
entries and tunnelled delivery through the grower's own controller. **Missing is only: a non-alarm trigger,
image attachment, and a preset library.**

**Sharp edges if that machinery is reused:** raw `http`/`https` `request()` with **no timeout, no retry, no
queue, no SSRF guard and no allowlist**, fire-and-forget. It fires only on alarm state transitions — there is
**no generic event bus** to hang "diary entry created" or "harvest logged" on.

## 4.3 What Terp Control should be instead

Every outbound target is closed. **Being the platform others integrate *to* matters more than integrating
*out*.** Copy Pulse Grow's shape verbatim — `x-api-key` header, keys scoped per grow, quotas measured in
datapoints (Hobbyist 4,800 / Enthusiast 24,000 / Professional 120,000 per day), OpenAPI + Redoc — plus
outbound webhooks. Pulse's API is **read-only**; Terp Control owns the hardware and can offer writes, which
is a real structural advantage no monitoring vendor has.

---

# 5. Feeding schedule reality

## 5.1 What shipping manufacturer schedules actually entails

**There is no such thing as "the feed chart" for a brand.** Every major brand publishes a *matrix*,
cross-cut by 3–6 independent axes. The naive `week[1..12]` model is wrong.

**Nine axes a data model must represent** (each traceable to a real chart) [VERIFIED-PRIMARY]:

1. **Time index — four incompatible schemes.** Absolute weeks (BioBizz 12, GH 13, Athena 13);
   phase-relative weeks (Athena, Mills, H&G, Advanced Nutrients); **named phases with variable-length week
   ranges** (CANNA: *"Cultivation period in weeks: 2–4"*, "Vegetative phase II — up to growth stagnation");
   event-triggered (Fox Farm hydro *"4 days before 12/12"*, Hesi *"every second watering"*).
2. **Run-length adaptation — three different manufacturer answers.** Repeat a week (Advanced Nutrients);
   **reshape the curve** (House & Garden stores one array per flower length 6–12 weeks; the 8-week entry is
   `[6.5,7.5,8.5,9.5,9,7.5,7.5,7.5]` and the 12-week is
   `[6.5,7.5,7.5,8.5,9.5,10.5,10.5,10,7.5,7.5,7.5,7.5]` — **the peak moves**); or "adjust it yourself,
   strain dependent" (Athena, verbatim on the sheet). **Silently truncating an 8-week chart onto a 10-week
   cultivar is the failure mode that makes the whole feature untrustworthy.**
3. **Feed strength / strategy.** `light|medium|heavy` (Mills, CANNA); `normal|aggressive` (H&G);
   `High Irrigation-Fast Dryback | General Use | Low Irrigation-Heavy Feeding` (GH — an *irrigation* axis,
   not a strength axis).
4. **Water source is a first-class axis, not an option.** Mills ships two entire charts (tap EC 0.7 / RO
   EC 0.0). Metrop ships two. CANNA takes an EC band and sells HYDRO as separate Soft and Hard products.
   Terra Aquatica switches SKU at **70 ppm Ca**. Dutch Pro adds a fourth cut: "WITHOUT EXTRA CO₂".
5. **Substrate is the primary key and it is brand-specific.** Plagron's calculator's first question lists
   **15 named Plagron substrates**. "Coco" is not one thing.
6. **Nine unit systems are in active use:** ml/L, ml/10 L, ml/100 L (Metrop only), ml/US gal, g/L, g/10 L,
   tsp and tbsp per US gal *including fractions* (Fox Farm), **drops/10 L** (Hesi SuperVit), **dilution ratio
   1:5000** (Aptus), and **"bottle treats N litres"** (BAC: 1 L → 10,000 L).
7. **A dose is not a scalar.** Range (`5–13`, `30–40`, the string `"12–18"`); zero-that-means-stop
   (MagNifiCal `8,8,8,8,8,0,0`); **literal strings** (Remo's `"water"`, GH's `"Flush only"`, Athena's
   `"Use as pH up"`); conditional (`Cannazym 50 if substrate reused`); frequency-qualified (`1-2x a week`).
8. **Targets attached to a step.** EC, PPM500, PPM700, pH (**split per medium inside one cell** — Athena:
   *"5.5–5.8 (Coco/Rockwool) 5.9–6.2 (Peat based mediums)"*), N ppm, photoperiod hours, water temperature.
9. **Non-dose rows that carry meaning.** Mixing order, equipment caveats ("Do not use with NetaFlex"),
   parallel programmes (Athena's IPM spray table), footnote markers (`*`, `**`, `***`) that a naive parser
   silently drops.

**THE single most important domain fact:** CANNA publishes **`EC +`, not EC**. Verbatim from the official
PDF: *"EC+ value is based in mS/cm when EC water = 0.0 at 25 °C, pH 6.0. **Add the EC of the tap water that
is used to the recommended EC.**"* If source water is EC 0.4 and the chart says 1.4–1.8, the meter should
read 1.8–2.2. **A UI that alarms against the raw chart value is actively wrong.** The schema needs
`ec_basis: absolute | delta_over_source`.

**Second most important:** three PPM scales are in circulation — 500 (NaCl, Hanna/Milwaukee, most North
American meters), 640 (KCl, European agricultural), 700 (KCl, Bluelab Truncheon). At EC 1.8 a Bluelab reads
**1260** and a Hanna reads **900 — for the same liquid.** This is repeatedly cited as the #1 cause of
accidental over/under-feeding. **Store EC as canonical; never render a bare "ppm" number.**

**Machine-readability, ranked:** Tier A — Mills (a webpack module `main_bbbe0412.js` exporting
`{product: {light|medium|heavy: {weekCount: [dose…]}}}` plus a pseudo-product `EC`), House & Garden (plain JS
arrays), Remo (HTML with `data-gallons`/`data-litres` on every cell), General Hydroponics (server-rendered
HTML with absolute week + phase-relative index + photoperiod + N ppm + EC + PPM500 per row). Tier B — PDFs
with a text layer, **which require coordinate-aware extraction** (plain text returns cells in stream order
and is useless). Tier D — **Dutch Pro's soil chart is a 3.4 MB raster with no text layer at all: OCR only.**

**Do not seed from third-party transcriptions.** Proven, not asserted: for the same CANNA Terra veg stage,
hyjo.co.uk publishes Terra Vega at **30–50 ml/10 L** (matching the official chart) while veridiangrow.com
publishes **10–30**. A ~3× divergence that would burn or starve a crop.

## 5.2 The legal verdict

**The question everyone asks is the wrong one.** Under *Feist v. Rural Telephone*, 499 U.S. 340 (1991) the
numbers are facts and *"may be copied at will"*, with only thin protection for selection/coordination/
arrangement. **But Terp Control is EU-based, and the EU sui generis database right (Directive 96/9/EC)
applies:** it protects the *contents*, requires **no originality** (only proof of substantial investment in
obtaining/verifying/presenting), runs **15 years**, and bars extraction or re-utilisation of a **substantial
part**. Repeated and systematic extraction of even *insubstantial* parts is caught where it conflicts with
normal exploitation.

Applied honestly: **shipping one brand's complete chart is extraction of a substantial part. Shipping twenty
is twenty counts of it.** The US "facts are free" argument does not save you in the EU — that gap is exactly
why the right exists, and a German company is a far more reachable defendant than an anonymous Play Store
developer.

**Verified restrictive terms:** CANNA's disclaimer Art. 3 claims rights in *"text… data files… formats,
software, brands"* and states verbatim *"It is not allowed to put the website, or any part thereof, at the
disposal of third parties in any way whatsoever and/or to duplicate it other than by downloading and viewing
on a single computer and/or printing a hard copy."* Athena claims IP in *"information, data, software… and
compilations"*. Advanced Nutrients: *"Deep linking to internal pages of this Site is expressly prohibited
without prior written consent"* — which would nominally forbid even the link-only model. (Doubtful
post-*Svensson* C-466/12, but relying on that means litigating it.)

**Copying brand prose is straightforward copyright infringement independent of the facts question.** CANNA's
*"Vegetative phase II — up to growth stagnation after fructification"* and BioBizz's *"A plant will not die
from too little nutrients, but it won't survive an overdose"* are expressive text. **Never ship those
strings. Paraphrase every description.**

**Trademark is the manageable part:** nominative fair use (US) / referential use under Art. 14(1)(c) EUTMR
following CJEU *Gillette v LA-Laboratories* C-228/03. Four conditions, of which the operative one is
**word marks only — no logos, no brand colours, no bottle photography, no trade dress**, nothing suggesting
sponsorship, and honest commercial practices. Restaurant-nutrition calculators are the working precedent.
**Risk escalates sharply if a brand name leaks into Terp Control's own branding** — a "CANNA Mode" feature
name or brand names in store keywords moves the use from referential to trademark use and forfeits the
defence.

**No enforcement precedent exists in this niche.** No cease-and-desist, DMCA notice, takedown or lawsuit
involving a fertiliser feed chart and an app could be found despite several search phrasings. **This is
absence of evidence, not evidence of safety.** GrowBro (Google Play `com.pascalotti.growtracker`) reproduces
and names brands verbatim in its store listing (*"Built-in feeding schedules for popular brands (Hesi,
BioBizz, Advanced Nutrients)"*) with a Pro tier and no visible licence, apparently unenforced.
FeedSchedules.com does the exact opposite, verbatim: *"We link directly to each brand's official source… We
don't reproduce the charts themselves."* Grow with Jane ships nothing and markets user-added brands.

**There is no licensing programme, API, or data feed from any plant-nutrient manufacturer.** This was
searched for specifically. Do not plan around acquiring one off the shelf.

## 5.3 The recommended safe approach

**Posture D + E as the foundation, B layered on top, F pursued in parallel:**

1. **Build the schedule engine brand-agnostic and user-editable FIRST.** That is the durable asset and it
   carries zero IP risk.
2. **Seed it with ownerless schedules** — Lucas Formula (0-5-10 / 0-8-16), generic per-medium EC ladders,
   Jack's 321 — so it is useful on day one with **nothing borrowed**. Free win; do this regardless.
3. **Add brand charts on top as a separate, versioned, hot-swappable content collection in MongoDB** — never
   baked into the webapp bundle — so any single brand can be removed in **one DB update**. Source each one
   from the brand's own calculator or PDF. Every entry carries `source_url`, `retrieved_at`,
   `chart_version`, `kind` (official_pdf / official_calculator / manual_transcription). That block serves
   three purposes at once: the legal posture, FeedSchedules-style "last verified" honesty as a *user-facing
   feature*, and protection against the ~3× transcription errors found in the wild.
4. **Publish a takedown address and a documented notice-and-action policy BEFORE shipping.** A brand that
   can email you and get removal in 48 hours sends an email; a brand that cannot sends a lawyer.
5. **Pursue written permission from brands in parallel.** It is a week of effort and nobody else has it.
   Brand-locked schedules drive bottle sales — which is exactly why every one of them built a calculator.
   GrowDiaries proves brands will engage (Gold Label, Green House Feeding, Bio Tabs and Living Soils have
   official accounts there). **A written yes from three brands converts the biggest risk into the biggest
   moat.**
6. **A liability disclaimer is separate from and as necessary as the IP one.** The app instructs people to
   apply chemicals to a crop. Adopt CANNA's own framing in your own words — their chart says the guidelines
   *"aren't an iron law"* and depend on temperature, humidity, species, root volume, substrate moisture and
   watering strategy — and never present a computed dose as an instruction without a "verify / start low"
   affordance. Note the feature **amplifies any unit-conversion bug**, and with nine unit systems in play
   (including drops/10 L and 1:5000 ratios) conversion bugs are likely and their consequences physical.

**Do not:** drive the server-side wizards (CANNA Grow Guide, Plagron's POST flow, Advanced Nutrients'
calculator) to harvest their outputs. That is systematic extraction plus terms-of-use breach plus probable
unauthorised-access framing. It is the most legally aggressive option available.

**German-law specifics were NOT researched in depth** — UWG § 4 Nr. 3 (supplementary protection against
imitation) and UrhG §§ 87a–87e (the national DB right implementation). **This is the one place where a
couple of hours of German IP counsel is clearly worth the cost, and it must happen before shipping any brand
data, not after.**

## 5.4 What actually makes this a *Terp Control* feature

**The chart data is the commodity; the closed loop is the product.** Every serious brand already ships a
calculator for its own line, and **none of them can see the grow.** Terp Control has live telemetry and the
photoperiod the device itself is running:

- **Auto-detect the 18/6 → 12/12 flip from `out_light` history** to place the grower on the correct bloom
  week. CANNA and GH both put photoperiod hours directly in the chart. No bottle-brand calculator can do
  this, because they have no device.
- **Move EC/pH alarm bands as the schedule advances** instead of setting them once. This is the strongest
  argument for the feature living in a *controller* rather than a standalone app.
- Overlay target-vs-measured EC per step on the charts page.
- Warn on runoff-vs-input EC divergence > 20 % and on cumulative top-off volume > 20–30 % of reservoir.

**That asymmetry — the value is not where the legal exposure is — should settle the data-posture decision.**

**UX primitives worth stealing:** Remo's six inputs (Grow Medium, Units, **Batches Per Week**, Vegetation
Weeks, Flower Cycle Weeks, Flush Weeks) are the correct set; **batch volume, not reservoir size**, serves the
hand-waterer with a 10 L can and the DWC grower with a 100 L reservoir identically. House & Garden and
Plagron both emit a **shopping list**, and H&G converts totals into purchasable bottle sizes — the
highest-value non-obvious feature in the space. **Mixing order as an ordered checklist** (silica → base A →
base B → Cal-Mag → additives → **pH last**) with a running volume is the cheapest possible fix for a genuine
failure mode (gypsum precipitation, silica reacting with phosphate; *"Adding pH- can increase EC"*).
**Advance the schedule by feed events ("step N of M") with a soft calendar mapping**, not by wall-clock
weeks — growers feed Tue/Fri and slip. Ship an **autoflower strength multiplier (×0.25–0.5, no 12/12 flip
event)**: essentially no manufacturer chart has an auto column, so this is a real gap fillable without
borrowing anything.

**Flush means three different things** and the UI must not conflate them: pre-harvest flush (scheduled by
every brand), corrective flush (~3× pot volume, event-driven), routine leaching to run-off in coco (which
BioBizz explicitly contradicts for organic soil: *"Water 2-3 times a week, no need to water till run-off"*).
And the honest science: the **Rx Green Technologies 2019 trial** (0/7/10/14-day flush) found no significant
difference in terpenes, THC, yield or mineral content, and taste panels **statistically preferred the
un-flushed** samples. One trial, one cultivar — not settled. **Present flush as "your chosen brand's schedule
calls for this", never as "this is necessary."**

---

# 6. Compliance & privacy line

## 6.1 What German clubs actually need

**§ 26 KCanG** (unchanged since 20.6.2024, verified on gesetze-im-internet.de) requires continuous
documentation of: source of propagation material (name, first name, address); stock in grams/units; cannabis
grown in grams; destroyed quantities; and **for every hand-over the member's Name, Vorname, Geburtsjahr +
grams + THC content + date**. Retention **5 years**; electronic submission on request; **anonymised** annual
filing by **31 January**; plus a separate 31-January report broken down by strain and average THC and CBD.

**§ 17 Abs. 2** requires members to participate *"eigenhändig"* in cultivation. **This is the only
legally-motivated multi-user/attribution requirement a grow controller can credibly own**, and it is why
every club platform ships a member duty/participation journal.

**§ 28 Abs. 2** empowers the authority to *"digitale Daten sicherstellen"* (seize digital data); § 28 Abs. 5
permits onward transmission to other agencies for prosecution. **No prior judicial approval is required.**
German press characterises § 26 as resembling *"einer Vorratsdatenspeicherung"*.

**§ 26 Abs. 5 contains an explicit nemo-tenetur carve-out** — the club's representative may refuse to answer
where the answer would expose them or a relative to prosecution. **The legislator itself flagged the
documentation duty as a self-incrimination hazard.**

## 6.2 The market is already served — do not try to win it

~20 dedicated compliance SaaS products at **€0.50–1.00 per member per month**. Cannanas claims **>250
licensed clubs** ("more than half of all licensed Anbauvereinigungen"), ships a **public OpenAPI with 185
paths**, and **already names GrowControl, TrolMaster and Siemens PLC as IoT integrations**. 420cloud sells
"unlimitierte Sensor-Einbindung" at €1/member/month and states it is "working on the appropriate API".
Practitioner guides put club software at **€50–100/month for 100 members**; Cannavigia's €599/month
Cultivation module marks the ceiling and belongs to a GACP/EU-GMP audience.

**Winning the compliance race would mean owning 23 differing authority export formats** (per-Land plus five
NRW Bezirksregierungen and three Berlin district offices — proven by Cannanas' `authority_id` enum), 5-year
retention, an Art. 28 AVV with every club, a DSFA, and liability for wrong exports. **Do not.**

**Cannanas' `CreateDiaryRequest.measurements` has 40 numeric fields that read like a grow-controller
telemetry dump** — `air_temperature, air_humidity, air_co2, air_throughput, water/wastewater/soil ph+ec+ppm,
soil_humidity, nutrition_n/p/k, light_lux/lumen/candela/ppfd/temperature/distance, thc, cbd` plus 12
plant-observation fields. Entries attach to `zone_id`, `strain_id`, `plant_id`, `batch_id` or `harvest_id`.
**Zones carry `streams.video[].url`** — club software already expects a per-grow-room camera stream URL,
which Terp Control's webcam fills directly. **There is no sensor-ingestion endpoint in the public API. The
IoT path is private and unclaimed.**

## 6.3 The line — what to keep and what to refuse

| **Keep** (device-observed, thing-scoped) | **Refuse** (person-scoped, product-scoped) |
| --- | --- |
| Room/zone climate time series (temp, RH, VPD, CO₂, PPFD) | Who consumed what, when |
| Setpoints, schedules, actuator states, alarms | Member identity, DOB, address, membership number |
| Irrigation events, EC/pH readings | Per-member dispensing quantities and THC content |
| Photos of a plant/room the user chose to take | Payments, credits, quotas, POS |
| A task record ("flush done"), optionally with an actor | A permanent, non-deletable inventory of grams |
| Harvest wet/dry weight — **if the user opts in** | Anything requiring a real name |

**Hard "do not build" list:**

1. **Do not store per-member consumption or dispensing records** (§ 26 Abs. 1 Nr. 5/6). Arguably Art. 9 GDPR
   health data (German counsel Nimrod cites Recital 35 and CJEU C-184/20), triggers DSFA and probable DPO,
   Art. 82 damages exposure — for data a grow controller has no need for.
2. **Do not become the club's system of record for § 26.**
3. **Do not require identity to use a device.** Pseudonymous accounts, no phone number, no real-name
   enforcement.
4. **Do not collect or infer location.** No GPS, no IP-geolocation persistence, no "growers near you", no
   persisted timezone-from-IP.
5. **Do not build a public/social grow feed with real identities.** That is how a hobby becomes a target list.
6. **Do not make the audit log undeletable for the account owner.** Tamper-evidence protects a *regulated*
   club against its own staff; it **victimises an unregulated grower**. Immutability must be a deliberate,
   opt-in, club-scoped mode — never global.
7. **Do not retain telemetry indefinitely by default.** A light schedule flipping 18/6 → 12/12 is a legible
   harvest calendar. (**Note: today the InfluxDB bucket is created with no retention and there are zero
   downsample tasks. Raw 5-second samples are kept forever.** [CODE])
8. **Do not ship analytics or ad SDKs.**
9. **Do not host outside the EU for EU users, and say so plainly.** German advisers publish "servers outside
   Europe" as a red flag when clubs choose software; HelloHanf is listed as US-hosted precisely as the thing
   to reject.
10. **Do not claim compliance.** Even Cannanas' own AI compliance endpoint says *"Not legal advice."*

**The anti-pattern, named:** Grow With Jane processes data on Google Firebase in the US and Ireland, runs
Google AdSense behavioural tracking with IP addresses, states it *"may be required to reveal personal data
upon request of public authorities"* and may use data *"in Court"*, pushes criminal-prosecution risk onto the
user, and caps liability at **$5**.

**Jurisdiction mode is not optional, and the privacy-maximal one is the default:**

- **Club mode** (DE/MT): attribution on, participation logging, longer retention, export tooling, visible
  audit log — because the law *requires* it.
- **Private / prohibition mode** (default): attribution off, no per-plant weights prompted, short retention,
  no community, **one-tap wipe** — because the law *punishes* it. Spain is the inverse of Germany: no
  statutory reporting duty, clubs in a grey zone, Barcelona pursuing closures — there a detailed member
  ledger is **evidence, not compliance**.

## 6.4 Where Terp Control can actually win here

**Be the device-attested environmental layer those systems consume.** A value the controller recorded with
its own clock and identity beats a hand-typed diary number in an inspection — **and it requires storing zero
personal data.** Target `POST /v1/clubs/{clubId}/diaries` with a `measurements` payload; register the device
as a zone; publish the camera as `zones.streams.video[].url`. Contact `integration@cannanas.club`.

**Build multi-user around things, not people.** Room/device-scoped roles with a **`:self` tier** — copied
straight from Cannanas' `charges:create:self` / `member:journals:self-checkin` pattern: a member logs their
own work, sees the room, sees nobody else. **The one legally-motivated multi-user feature worth owning is a
participation/duty log** (`PLANNED → PENDING_APPROVAL → COMPLETED → REJECTED`, with a `regulatory_relevance`
flag) serving § 17 Abs. 2. Everything else about attribution is operational convenience and must be opt-in.

**Audit trail = append-only event log + compensating corrections instead of edits** (the `dispense:storno`
pattern). Skip cryptographic immutability as a default. **Ship a `NONE | PSEUDONYMIZED | ANONYMIZED` toggle
on every export and default to anonymised.**

**Metrc is a dead end for a controller** — a government system requiring per-state licensed-integrator
status, RFID tags, strict lifecycle ordering, and a separate API instance per jurisdiction. Its only useful
lesson is the *shape* of the lifecycle model, which the German platforms have already copied.

**Neither 21 U.S.C. § 863 (US paraphernalia) nor MDA 1971 s.9A (UK) covers cultivation equipment or
software.** The product is not the legal risk. **The cloud-held, timestamped, attributed record is.**

---

# 7. Charting verdict

## 7.1 Library

**Recommendation: migrate to Apache ECharts 6, tree-shaken, with a hand-rolled ~50-line Angular directive
instead of `ngx-echarts`.**

The reasoning, in the order that decides it:

1. **Licence.** Highcharts is proprietary. Terp Control imports `highcharts/highstock`, so it needs Core +
   Stock = **$732/seat/year**, plus a **quote-only SaaS licence** — the licence text is unambiguous: *"use of
   the Licensed Software in connection with a publicly accessible website or webpage made available to users
   outside of the Licensee's organization shall be deemed use in an External Application and will require a
   SaaS License."* terpcontrol.com sells a €289 controller and advertises a public no-login demo at
   `terpcontrol.cloud/demo`, and calls the cloud *"quelloffen"*. **There is no LICENSE file in the repo and
   no Highcharts licence artefact anywhere in it.** Whether a licence is held off-repo is **[UNVERIFIED]** —
   but **redistributing Highcharts source under an OSS licence is not curable by buying seats.** This alone
   decides it.
2. **Every primitive the redesign needs is configuration, not a plugin you maintain forever:** `grid[]` +
   `axisPointer.link` + `echarts.connect()` (small multiples with a linked crosshair), `markArea` /
   `markLine` / `markPoint` (target bands, day/night, annotations), `visualMap` piecewise (colour by
   deviation), `dataZoom: inside` (documented two-finger touch), `sampling: 'lttb'|'minmax'|…`,
   `darkMode: 'auto'` + `setDarkMode()`, `graphic` image elements, built-in heatmap for the VPD matrix. All
   verified against the 6.1.0 type definitions, not from memory.
3. **Memory.** In uPlot's public benchmark (166,650 points): **Highcharts 10.3.3 — Terp's exact version —
   416 ms JS, 97 MB peak heap. ECharts 5.4.1 — 148 ms, 17 MB peak** (the lowest of the mainstream set). On a
   mid-range Android that is the whole game.
4. **Boost already breaks the design.** Highcharts Boost is loaded and activates at 5,000 points/series. It
   **disables dash styles and per-series line width**, which are exactly the encodings a "dashed setpoint vs
   solid actual" design needs. Terp's realistic worst case (`1d` @ `5s` = 17,280 points/series) is one
   dropdown away.

**Be honest about the cost: tree-shaken ECharts is BIGGER than what ships today — 195.6 KB gz vs 132.7 KB gz
for Highstock (both measured with esbuild 0.25 + gzip -9).** Do not sell the migration on bundle size. Part
of it is repaid by deleting Chart.js (68.8 KB gz of pure waste). `echarts.simple.min.js` is not a shortcut.

**Do not pick:** **ApexCharts** — npm reports `SEE LICENSE IN LICENSE`; the Community tier is limited to
organisations under **$2M annual revenue**, Pro $349/dev/yr, **OEM/Embedded $14,999/yr**; and it posted the
second-worst render in the benchmark. **Plotly** — 1,429.5 KB gzip, ~10× everything else. **visx** —
React-only. **Observable Plot** — no crosshair, no zoom; it is a static figure generator. **Keep uPlot in
your back pocket** for many simultaneous sparkline tiles (21.5 KB, 3 MB final heap) — it is the wrong choice
for the main chart because its stated Non-Goals include *"No collision avoidance for axis tick labels"* and
*"No built-in drag scrolling/panning"*.

**Angular wrapper reality on Angular 15:** `highcharts-angular` 5.x needs Angular ≥19; `ng2-charts` 10 needs
≥21; `ngx-echarts` ≤19.0.0 declares **no `@angular/core` peer at all** and installs cleanly. **But hand-roll
the directive** — the wrapper ecosystem ships a major per Angular major, and this decouples the chart from
the framework upgrade path.

## 7.2 Visual techniques worth adopting

1. **Stacked small multiples with a shared x-axis and one linked crosshair.** 4–6 panels, ~90–120 px each on
   mobile. Stephen Few's *Dual-Scaled Axes* paper is unqualified — verbatim: *"Today, I can't think of a
   single case when there isn't a better solution than a graph with a dual-scaled axis"*; *"When lines are
   associated with different quantitative scales, however, their intersection means nothing"*; *"Whether the
   lines intersect or not, and if so where, is arbitrary."* **Terp runs fifteen independent scales
   simultaneously, as filled areas, with the axes programmatically hidden on a phone.** Small multiples are
   *more* readable, not less — you can see RH lagging temperature at lights-on, which the overlay destroys.
   Allow at most two units on one panel and only when physically coupled (temp + leaf temp; temp + RH).
2. **Draw the setpoint, not just the reading.** A **dashed stepped** setpoint line (it steps at
   `daynight.day`/`night` between `day.temperature` and `night.temperature`), a soft target band behind it,
   and a **signed deviation fill between actual and setpoint**. Never fill to the axis — the current
   `type:'area', threshold:null` encodes nothing. Band source priority, one at a time and labelled:
   **alarm thresholds** (hard edge, the user's own declared acceptable) > **setpoint ± tolerance** (soft) >
   **stage VPD sweet spot** (advisory).
3. **An AGP-style scorecard.** From diabetes CGM, the solved version of exactly this problem: % time in /
   above / below band as one stacked bar, **split day vs night** (Pulse markets exactly this), longest
   excursion **as a duration** (Mean Kinetic Temperature's lesson: excursions must be reported as duration,
   not as a count of alarms), total time out of band, mean/min/max, and a stability metric (MAD from
   setpoint). **Report data-coverage % and grey out the scorecard below ~80 %.**
   **CRITICAL CORRECTNESS TRAP: time-in-range must be computed server-side on RAW Influx samples, never on
   `aggregateWindow(fn:mean)` output — averaging destroys the excursions the metric exists to count, and the
   error is invisible by eye.**
4. **Day/night shading derived from measured `out_light > 0` where available**, falling back to the
   `daynight` schedule, with `lights.sunrise`/`sunset` ramp gradients at the edges, **in an explicit
   timezone** (copy Grafana's time-regions model — a 12/12 flip near a DST boundary will otherwise drift an
   hour and generate bug reports). A failed contactor then shows as a *missing band* — a diagnostic, not
   decoration.
5. **An annotation rail under the x-axis, not columns inside the plot.** 12–20 px, pixel-proximity
   clustering (8–12 px bins with count badges — Grafana's own options are literally "Annotation clustering"
   and "Multi-row annotations"), severity ranking, **max two rows** (row 1 user events, row 2 device events),
   category filter chips (`collectLogCategories` already exists), and **full-height dashed lines for
   lifecycle stage changes**. Highcharts flags' `stackDistance: 12` does not scale to 90 days of logs.
6. **Outputs go in a state-timeline lane** below the chart (Grafana's state-regions model), not as 0/1 lines
   fighting for the value axis. Region length = duration; null renders as a gap.
7. **Min/max envelope on the primary measure.** `aggregateWindow` already supports `min`/`max`, so it costs
   one extra query each. A single `mean` line is a lie about a bang-bang controller. Use
   **`sampling: 'minmax'` for the plot** — LTTB smooths away the very oscillation the grower is looking for —
   and LTTB for the navigator.
8. **The differentiating chart nobody verifiably ships: a VPD chart whose target band CHANGES along the
   x-axis** as the grow moves through `DiaryLifecycleStage` (seedling 0.6–1.0 → veg 0.8–1.2 → flower
   1.2–1.5 kPa, per Pulse), plus a **VPD temperature × RH matrix with the room's last-24 h trajectory plotted
   on it** — which turns a static poster into a diagnosis ("you drift into the too-humid corner every
   night"). **Make the leaf-temperature offset visible on the chart itself** ("leaf = air −2.0 °C"), not
   buried in settings — VPD is entirely an artefact of that assumption. When a real `leaf_temperature` sensor
   exists, say so and drop the offset.
9. **A film strip that *is* an axis.** Thumbnails positioned by timestamp on the same x-scale (so uneven
   capture intervals read honestly as gaps), sharing one cursor with the chart. Delivery: **one sprite +
   index per window** instead of N image requests (Mux's storyboard pattern: 50 tiles under 15 min / 100
   above, 256×160 px). `Image.timestampEnd` already marks mp4 timelapses as spanning a range — render those
   as a bracket, not a point. *(The `#xywh` WebVTT convention is a de-facto player convention, not a W3C
   feature; a plain JSON index is equally good — the value is the sprite.)*
10. **Mobile interaction rules.** One finger = page scroll, two fingers = pan/zoom, tap/long-press =
    crosshair. **Replace the floating tooltip with a pinned scrubbing header above the chart** (a compact
    table, one row per panel) — there is no hover on touch and a fingertip occludes a tooltip. Range-selector
    presets stay the primary control with ≥44 px targets. **Stop hiding axis labels below 320 px** — shorten
    to 3 ticks and move the unit into the panel title instead. An axis-less chart is not a chart.
11. **Colour.** Adopt **Okabe-Ito** (verified hex): `#E69F00` orange, `#56B4E9` sky blue, `#009E73` bluish
    green, `#F0E442` yellow, `#0072B2` blue, `#D55E00` vermillion, `#CC79A7` reddish purple, `#999999` grey.
    Terp's current set breaks the rules — `#e05a4e` red next to `#b0743c` brown is the classic deuteranopia
    collision. **`fillOpacity: 0.1` area fills almost certainly fail WCAG 2.2 SC 1.4.11's 3:1 non-text
    contrast requirement.** With small multiples, position is the primary channel and colour is decoration —
    which is itself an accessibility win. Use `darkMode: 'auto'` instead of the hand-written 30-property
    theme + `MutationObserver`, and add a **"view as table" disclosure** (no OSS library matches Highcharts'
    accessibility module, and Terp does not load that module today anyway).
12. **Add DLI and dew point.** Pure arithmetic on data already stored (`DLI = PPFD × photoperiod / 1e6`), and
    it closes a named competitive gap against Pulse Pro, which advertises both.

**Free cleanup with no design debate:** delete `chart.js` / `ng2-charts` / `chartjs-adapter-luxon` from
`charts.page.ts`, `charts.module.ts`, `diary.module.ts` and `diagnostics.*`; fix the duplicate `noData()`
call and the `CO2 … softMax: 1` entry.

**Small backend additions unlock most of this:** a combined `{mean,min,max}` response to replace 3× round
trips; parsed setpoints on the device access payload; a raw-sample scorecard endpoint; a sprite+index
endpoint for the film strip.

---

# 8. The gap list

Prioritised. **P0** = the product is not credible at the October 2026 launch without it. **P1** = the
redesign's actual differentiators. **P2** = valuable, sequenced after. **P3** = business development or
later. Each gap names its evidence.

### P0 — credibility and correctness

1. **The controller has no UI. It is branded as a fridge.** A controller's dashboard card reads "Terp
   Control FRIDGE GROW"; an unnamed controller is *named* that. No `devices.controller` i18n block exists.
   *[CODE `overview.component.html:40`, `overview.component.ts:91-94`]* — the cheapest credibility fix in the
   document is a naming pass; the real fix is a controller shell (or a capability-driven device shell), which
   is greenfield: the two `ngSwitchCase` lines are the entire integration surface to change.
2. **`POST /device/claimcode` is unauthenticated** for devices that have not reported
   `claimcode_auth='on'`; combined with `claimDevice`'s unconditional owner overwrite, knowing a `device_id`
   — which appears in every webapp URL — is enough to steal a device. *[CODE `device.route.ts:606`,
   `device.service.ts:1097-1134`]* **Blocker for any concept that surfaces device ids more widely.**
3. **Capability is collapsed into three buckets and fails open.** A heater-only tent is shown humidity
   targets, a humidity deviation warning and a dehumidifier alarm preset it can never act on; missing
   `hardwareInfo.sockets` (old firmware) returns `'full'`. *[CODE `grow-presets.ts:143-173`]* The per-role
   truth already exists in the CSV and is only shown in the one-time wizard step.
4. **Dead controls are shipped as if they worked.** The entire `daynight.floating` beta feature is read by
   **no firmware anywhere**; `lights.maintenanceOn`, `co2.sunsetOff` and `daynight.linearChange` are offered
   to controllers and silently ignored. *[CODE `controller.cpp:455-514`, zero grep hits in `firmware/`]*
5. **Nothing distinguishes live from stale from offline.** Every value is rendered as if current. This is the
   **#1 complaint across all five consumer brands** ("the app will say a fan is running at 10 speed but the
   fan will not be running") and is nearly free to fix. *[report 04, verbatim App Store reviews]*
6. **"Clear logs" deletes nothing from the diary**, because `deleted` is a visibility flag and the diary
   always requests hidden rows. The moment the diary becomes the product's centrepiece this reads as a
   data-loss bug. *[CODE `device.service.ts:739,751-756`, `diary.page.ts:112`]*
7. **The server's own stage-transition entries are invisible in the Entries report and not editable**, while
   the identical manual entry is both. *[CODE `device.service.ts:714`]*
8. **Flux injection + self-DoS on `/data/series`.** `measure`, `from`, `to`, `interval` interpolated raw;
   `3y × 5s` ≈ 18.9 M windows is one dropdown away; the `limit(n:50000)` guard is piped after `yield()` and
   does not bound the result. *[CODE `data.service.ts:80-89`]* **Must be fixed before any concept widens the
   measure vocabulary.**
9. **No server-side pagination for logs.** The Entries report fetches the device's entire history on every
   open. *[CODE `device.service.ts:724-749`]*
10. **No retention or downsampling anywhere in InfluxDB.** Raw 5-second samples are kept forever, which is
    both a cost curve and — per §6 — an evidentiary liability. *[CODE `docker-compose.yaml:38-43`, zero Influx
    tasks in the repo]*
11. **Six live i18n bugs render raw keys**, one of them user-visible (`simpleSettings.light.floatingNote`);
    chart series names are hardcoded English while the page chrome is translated. *[CODE]*

### P1 — the differentiators

12. **There is no plant.** No `Plant`, `Strain`, `Batch`, `Cycle` or `Harvest` entity; a grow's identity is a
    free-text string on one log row, and cycle boundaries are *inferred in the browser* by string comparison.
    Renaming forks the history; a re-veg fabricates a new plant. **A per-plant diary cannot be layered onto
    `DeviceLog`** — it needs a new persisted entity with a stable id and a foreign key on entries, and
    `convertEventsToGrowCycles` should become a one-time backfill migration, not a runtime algorithm.
13. **Harvest is not even a lifecycle stage** (`flowering → drying`). There is no date, no weight, no yield.
    **"How did this grow do?" is unanswerable from the data.**
14. **Watering and feeding do not exist anywhere** — no category, no field, no i18n key. The only hits for
    `water|feed|nutrient|fertil` in the whole repo are a pump workmode that writes no diary entry and two
    icon names. pH/EC/TDS exist only as three bare numbers on one entry type, with **no notion of what was
    measured** (runoff? reservoir? input?), no volume, no product, no target.
15. **Nothing draws the goal against the actual.** Setpoints, alarm thresholds and per-stage `vpdRange` all
    exist client-side and none of them reach the chart. This is the single highest-leverage change in the
    document and **it needs no new API.** *[CODE `grow-presets.ts`, `shared-types:6-7`, `charts.page.ts`]*
16. **The chart is 15 independent hidden y-axes of translucent area with the axes hidden on mobile.** See §7.
17. **Events are height-1 columns readable only by hovering** — unusable on touch, on a mobile-first product.
18. **No fused timeline.** Nobody in the market puts environment + machine state + human actions on one
    x-axis with the target drawn on it. *"Every grow-app on the market owns exactly one third of the problem."*
    Terp Control already stores all three; **the fusion view is the product.** *[report 04 §12]*
19. **VPD is display-only.** It is what every serious grower steers by, it is computed everywhere in the app,
    and it can be made an *expressible goal* **cloud-side, with no firmware change**, by translating a VPD
    band into the existing day/night temperature+humidity setpoints.
20. **No day-of-stage x-axis and no run-over-run comparison.** Pulse users explicitly asked for "day 5 of
    veg"; Pulse half-shipped it as Batch & Phase; **nobody offers the comparison**, which is the retention
    feature for a repeat home grower.
21. **No time-in-range verdict.** Zero competitors overlay setpoint vs actual or report time-in-band. This
    turns a chart from decoration into a verdict.
22. **Alerts have no consolidation, severity grading, acknowledge, snooze or repeat-until-resolved.**
    Growlink (a $250/month commercial product) is the only vendor with repeat semantics; Spider Farmer users
    are *begging for any push notification at all*. The best design in the entire research was written by a
    hobbyist: *"one consolidated, severity-graded notification with mute and pause actions rather than
    spamming you per sensor."*
23. **No multi-user of any kind.** Two people and one tent is unserved by every vendor: Pulse charges
    $10/user and got a public backlash thread; everyone else says share the password. **Free household
    multi-user is cheap for Terp Control and structurally hard for AC Infinity to match.** Requires a
    membership collection + rewriting two authorisation queries + an actor field on log rows.
24. **The camera is a tile, not evidence on the timeline.** Terp Control already captures 30 s stills and
    builds three timelapse durations hourly. **Timelapses have no relation to a cycle, phase or entry.**
    Scrubbing the chart should move the image; nobody connects camera frames to sensor time.
25. **Scheduling cannot express real horticulture.** No every-N-days irrigation, no multiple pulses per
    photoperiod, no offsets relative to lights-on/lights-off, no stage-aware setpoint ramps, no device
    interlocks. Each maps to a named verbatim complaint about a shipping competitor. The recipe engine is a
    usable state-machine skeleton but is **one per device**, **overwrites the whole configuration**, pushes at
    most **hourly** and **only to a device online within 60 s**, and `waitForConfirmation` **halts the entire
    plan indefinitely**.
26. **Export omits actuator state.** An AC Infinity 4★ reviewer asked for precisely this and no vendor
    provides it. Terp Control has no export at all — no CSV, no PNG, no exporting module.

### P2 — sequenced after

27. **No "Export week" / weekly aggregate entity.** Store the per-week aggregate as a first-class persisted
    row, not a chart query: **that table IS the export.** Store both a day counter and derived week buckets.
28. **No public shareable diary URL.** Copy the `growithjane.com/growlog/{slug}-{5char}` shape. It is the
    universal integration — works in every forum, Discord, Reddit and Telegram **with nobody's permission** —
    and per report 01 is the single highest-ROI item on the integration list. (Distinct from a community
    feed, which §3 forbids.)
29. **No BBCode / Markdown post generator with hot-linked image URLs.** XenForo and Discourse both render
    remote images, which collapses "integrate with RollItUp, THCFarmer, ICMag and Percy's" — four platforms
    with no usable API between them — into **one copy button**.
30. **"Update destinations" (Discord + Telegram + generic webhook), decoupled from alarms.** Tier 0 ships
    *this week with no backend code*: document the recipes and add two presets to the existing alarm webhook
    editor. Tier 1 generalises it: manual "Post update", schedule, diary entry, phase change, harvest.
31. **No brand-agnostic, user-editable feeding schedule engine**, seeded with ownerless schedules. See §5.3.
32. **No documented public API and no Home Assistant integration.** Pulse's API is read-only; AC Infinity's
    must be reverse-engineered. Owning this converts the highest-advocacy, most sceptical segment — the
    people currently writing their own Go apps — into users. Publish the cloud-outage behaviour explicitly:
    every experienced grower has watched Grobo, Seedo, Cloudponics and Leaf brick themselves.
33. **No accessibility, unit-switching or language switching.** VIVOSUN's reviews call out unzoomable small
    text and no dark mode; a Spider Farmer update removed Fahrenheit and cost them stars.
34. **The web app is not marketed.** Pulse, Growlink and AROYA have web; **AC Infinity, TrolMaster, Mars
    Hydro, Spider Farmer and VIVOSUN are phone-only.** The Angular/Ionic stack gives this for free and "big
    screen, real charts" is where growers actually analyse.
35. **The setup wizard is barely discoverable** (no "re-run setup" in the menu) and has no illustrations —
    while 30 MB of already-shot wizard videos sit unreferenced in `assets/wizard/`.
36. **Four duplicated workmode gating truth tables** and a save path that rewrites everything and navigates
    away to `/list`. Consolidate before layering new goal types on top.

### P3 — business development, not sprints

37. **Cannanas / 420cloud integration** (`integration@cannanas.club`). The market window is closing: 420cloud
    already sells "unlimitierte Sensor-Einbindung" and says it is building the controller API; Cannanas
    already lists GrowControl and TrolMaster as live integrations. **If Terp Control waits, the interface
    gets defined without it.**
38. **Written permission from three nutrient brands.** Converts §5's biggest risk into its biggest moat.
39. **GrowDiaries / Grow with Jane partnership emails.** Budget emails, not sprints. Expect GrowDiaries to
    try to sell banners (€599–€3,699/month, advertising only, no data access).
40. **Publish and name a JSON grow-diary schema.** No interchange standard exists; the first mover defines it
    and it costs one documentation page.

---

# 9. Open questions — decisions only the owner can make

1. **What are the seven user types, verbatim?** Types 3, 4 and 5 are anchored in the research; 1, 2, 6 and 7
   are this dossier's reconstruction. **Every concept will be judged against this list, so it must be exact
   before judging starts.** In particular: is Type 6 the German *Anbauverein* or the two-person household?
   The product implications diverge sharply (§6).
2. **Does Terp Control hold a Highcharts licence?** Nothing in the repo indicates one. If yes, is it a SaaS
   licence, and does the intent to publish the cloud as open source ("quelloffen" on terpcontrol.com) still
   stand? **These two facts are jointly incompatible** — Highcharts source cannot be redistributed under an
   OSS licence regardless of how many seats are bought. The charting recommendation in §7 hinges on this.
3. **Is the October 2026 release scope firm, and is any firmware change in it?** Everything about Type 4
   (humidifier, exhaust fan, AC/chiller, pump roles) is firmware work. If the answer is "no firmware", say so
   now and concepts will design within five socket roles.
4. **Which data posture on nutrient brand charts** — D+E only (ownerless + user-generated), or D+E+B (add
   brand charts as a removable layer)? This is a legal-appetite decision, not a design one, and it needs
   **German IP counsel on UWG § 4 Nr. 3 and UrhG §§ 87a–87e before any brand data ships.**
5. **Is Terp Control willing to be a cloud that stores harvest weights and plant counts at all?** Report 05
   says default them off (they are the exact facts separating a lawful 3-plant hobby from a 3-year offence);
   report 10 says harvest must be a first-class event with a date and a weight or the diary is pointless.
   **Both are right. The resolution is the jurisdiction-mode switch — but somebody has to choose the
   default**, and this dossier recommends privacy-maximal.
6. **What is the retention policy?** Today: infinite for telemetry, 3 years for webcam JPEGs, forever for
   diary photos. A deliberate answer is needed for the product, the cost curve and §6.
7. **Will there be a subscription, and what does it gate?** Every consumer competitor charges **zero** for app
   features. Pulse's $10/user triggered a public complaint thread **specifically because it was not disclosed
   pre-purchase**. If there is one, it must be on the product page before purchase and must never gate
   alerts, control, or seeing your own current data.
8. **Is the branded footer on user-generated posts acceptable risk?** § 6 KCanG bans cannabis advertising and
   sponsoring with fines to €30,000, read broadly. No court ruling on grow-equipment advertising was found.
   **Get counsel before shipping any branded footer.**
9. **Does the multi-user rewrite land in this release?** It is a membership collection + rewriting
   `auth.middleware.ts:172` and `:207` + loosening ~10 owner-scoped queries + an actor field on log rows +
   an account-lookup-by-email endpoint that does not exist (and must be designed against enumeration abuse).
   **It cannot be bolted on as a flag.** Note `PUT /users/:id` is currently broken and `RecipeTemplate.name`
   is globally unique — the user/template CRUD surface needs repair before it can be extended.
10. **Is offline capability in scope?** There is no service worker. Any concept framed as "works on the tent
    floor with bad wifi" requires adding `@angular/service-worker` — a new dependency and build change.
11. **Is native app distribution in scope?** Capacitor is a dependency but `capacitor.config.ts` is untouched
    scaffold (`io.ionic.starter` / `customer-app`) and there are no `android/`/`ios/` projects, despite
    App Store and Play badge assets sitting in `src/assets`.
12. **Verify before promising** (each is [UNVERIFIED] in the corpus): whether AC Infinity, VIVOSUN or Pulse
    have quietly shipped setpoint bands on charts (report 04's headline claim is from docs and review text,
    not hands-on use); whether YouTube still locks unaudited projects' uploads to private; whether X bills
    media uploads separately; whether BudLabs exposes an unauthenticated backend API; whether the
    `limit`-after-`yield` bug produces a no-op or a duplicate result set (needs a live Influx).

---

# Appendix A — where the reports disagree, and how to read it

1. **Chart library: migrate vs. hidden regression.** Report 06 recommends ECharts firmly. Report 11 warns
   that **Highstock's implicit `dataGrouping` — never configured anywhere — is the only thing keeping a
   4,320-point render cheap, and switching libraries silently removes that safety net.** Both are correct.
   The resolution: the migration is right on licence and memory, *and* explicit downsampling
   (`sampling: 'minmax'`) is not optional polish — it is the replacement for a load-bearing default nobody
   knew was there.
2. **Boost: blocker or no-op?** Report 06 says Boost activates at 5,000 points/series and disables dash
   styles, which *"alone disqualifies the current architecture"*. Report 11 says that with Stock
   dataGrouping active, Boost *"will rarely engage"*. Unresolved without a live test. The conclusion holds
   either way, but do not use "Boost breaks dashes" as the headline argument until it is observed.
3. **Bundle size direction.** Report 06 measured tree-shaken ECharts at **195.6 KB gz vs Highstock's
   132.7 KB** — i.e. the migration makes the bundle *bigger*. Report 11 describes the Chart.js dead stack as
   *"~500 KB of bundle for nothing"* while report 06 measured chart.js at 68.8 KB gz. **Trust the measured
   gzip figures (06); 11's "~500 KB" is uncompressed-ish and overstated.**
4. **Harvest weights: record or refuse.** Report 10 says harvest must be a first-class event with a date and
   weight. Report 05 says plant counts and harvest weights are precisely the facts separating a lawful hobby
   from a 3-year offence and must not be defaulted on. See Open Question 5.
5. **"No competitor draws setpoint bands."** Report 04 makes this its headline claim but flags it is from
   vendor docs, review text and screenshots-in-prose. Report 06 independently notes Pulse ships a **"VPD
   guidance overlay"** and per-stage VPD targets. **Soften the claim to "no competitor draws a general
   setpoint band with a time-in-range verdict" and verify by installing AC Infinity, VIVOSUN and Pulse before
   making it a marketing line.**
6. **GrowDiaries ToS.** Report 01 explicitly corrects the widely-repeated anti-scraping quote as **false** —
   the clause does not exist and the cited URL 404s. If any other document in this project repeats it,
   report 01 is the one that read the full 26,892-byte terms page.
7. **i18n counts.** The orchestrator notes say `en.json` 1121 lines / `de.json` 1117 (4-line drift); report
   14 says 885 vs 883 *leaf keys* (2-key drift). Both are right — lines ≠ keys. Use the key counts.
8. **Community feed vs public diary link.** Report 04 says *do not build a community feed* (zero of ~200
   reviews praised one; permanent moderation cost). Report 01 says a public shareable diary URL is the
   highest-ROI integration item. These are not in conflict: **a link you can paste anywhere is not a feed you
   must moderate.** Report 05 adds the constraint that binds them — no real identities.
9. **Reddit evidence is entirely absent.** Report 04 states plainly that reddit.com is blocked at the fetch
   layer and there are **zero Reddit citations** in the competitor research; App Store reviews were
   substituted. All star ratings in this dossier are **iOS only**, and growers skew Android — treat rating
   counts as a floor, never as a market-size proxy. VIVOSUN's 4.74★/8,172 is not supported by its own review
   text and looks review-solicited.
