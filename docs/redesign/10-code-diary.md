# Terp Control — Diary / Logging subsystem, end to end

Repo: `/home/user/terpcontrol.cloud`, branch `claude/controller-software-user-types-wc1jxn`.
All line numbers verified by reading the files on 2026-08-24.

---

## 0. One-paragraph summary

There is **no diary data model**. There is exactly one collection — `DeviceLog` — that stores *every* event
that ever happens to a device (boot messages, MQTT errors, alarm triggers, recipe steps, config diffs) **and**
the handful of things a user types in by hand. "Diary entries" are just `DeviceLog` rows whose
`categories` array happens to start with the literal string `'diary'`. Everything the UI calls a
"grow cycle", a "phase", a "plant" or a "strain" is **derived at runtime in the browser** by scanning the
whole log stream for rows carrying `data.newLifecycleStage`, sorting them, and cutting the sequence
whenever the stage order rolls back or the free-text `data.lifecycleName` string changes. Nothing is
persisted about a plant. There is exactly one implicit "plant" per device at any time.

---

## 1. File inventory

### Webapp — `webapp/src/app/device/diary/`

| File | Lines | Role |
| --- | --- | --- |
| `diary.page.ts` / `.html` / `.scss` | 139 / 69 / 0 | Shell page. Report switcher + "Add entry" + share button. |
| `diary-entry-modal/diary-entry-modal.component.ts` / `.html` / `.scss` | 292 / 157 / 0 | The one and only manual-entry form. |
| `diary-entries-report/…component.ts` / `.html` / `.scss` | 217 / 34 / 0 | Flat chronological list of log rows. |
| `grow-report/…component.ts` / `.html` / `.scss` / `.spec.ts` | 1270 / 230 / 253 / 162 | Cycle/phase/day timeline + webcam scrubber. The heavyweight. |
| `co2-report/…component.ts` / `.html` / `.scss` | 112 / 19 / 0 | CO₂ cylinder consumption report. |
| `image-viewer-modal/…component.ts` / `.html` / `.scss` | 75 / 26 / 9 | Lightbox. Declared in `log-entry-viewer.module.ts:16`, not in `diary.module.ts`. |
| `diary-query-params.ts` | 110 | URL-state (de)serialisation helpers. |
| `diary.module.ts` / `diary-routing.module.ts` | 44 / 17 | NgModule; route is `path: ''` (mounted at `device/:device_id/diary`, `webapp/src/app/app-routing.module.ts:23-26`, guarded by `AuthGuard`). |

### Webapp — `webapp/src/app/device/log-entry-viewer/`

| File | Lines | Role |
| --- | --- | --- |
| `log-entry-viewer.component.ts` / `.html` / `.scss` | 95 / 31 / 5 | Client-side category filter + client-side pagination (`LOGS_MAX_DISPLAY_COUNT = 100`, line 4). Exports `collectLogCategories`, `matchesLogCategory`, `filterLogsByCategory`. |
| `log-entry-item.component.ts` / `.html` / `.scss` | 97 / 86 / 30 | Renders ONE log row: title, message, `data` key/value list, images, category chips, edit/delete buttons. |
| `log-category-selector.component.ts` / `.html` | 25 / 11 | Multi-select of category slugs. |
| `log-entry-viewer.module.ts` | 31 | Declares + exports all four components (incl. `ImageViewerModalComponent`). |

### Server

| File | Role |
| --- | --- |
| `server/src/models/devicelog.model.ts` (55 lines) | The single mongoose schema behind everything. |
| `server/src/models/images.model.ts` (43 lines) | Image/video blobs stored **inside MongoDB** as `Buffer`. |
| `server/src/services/device.service.ts` | MQTT ingest (`connectMqtt`, l.154-220), `logMessage` (l.662-693), `logStageTransitionIfChanged` (l.701-722), `getDeviceLogs` (l.724-749), `deleteDeviceLogs` (l.751), `deleteDeviceLog` (l.758), `updateDeviceLog` (l.771-815). |
| `server/src/controllers/device.controller.ts` | `getDeviceLogs` (l.426), `deleteDeviceLogs` (l.443), `deleteDeviceLog` (l.453), `addDeviceLog` (l.464), `updateDeviceLog` (l.490). |
| `server/src/routes/device.route.ts` | Log routes at l.1147, 1170, 1197, 1241, 1287. |
| `server/src/controllers/image.controller.ts` (211) + `routes/image.route.ts` (177) | Image GET/POST/DELETE. |
| `server/src/services/image.service.ts` (613) | RTSP polling, user uploads, timelapse generation, thinning/retention. |
| `server/src/services/alarm.service.ts` l.272, l.288 | Writes alarm log rows. |
| `server/src/utils/demo.ts` l.45-50 (`demoLogs`) | Strips URLs from titles/messages for the public demo login. |

**Note:** `server/src/controllers/data.controller.ts` + `routes/data.route.ts` have **nothing** to do with the
diary. They expose only `GET /data/series/:device_id/:measure` and `GET /data/latest/:device_id/:measure`
(InfluxDB time-series). The task brief assumed logs live there; they do not — they live under `/device/logs/*`.

---

## 2. Data model (ground truth)

### `shared-types/index.d.ts`

```ts
// l.107
export type DiaryLifecycleStage = 'germination' | 'seedling' | 'vegetative' | 'flowering' | 'drying' | 'curing';

// l.109-120  — a FLAT bag of 10 optional numbers/strings, no nesting, no units, no arrays
export interface DiaryEntryData {
  co2FillingRest: number;
  co2FillingInitial: number;
  newLifecycleStage: DiaryLifecycleStage;
  lifecycleName: string;              // <- the ONLY thing resembling a plant/strain identity
  lightMeasurement: number;
  distanceMeasurement: number;
  tdsMeasurement: number;
  ecMeasurement: number;
  outsideTemperatureMeasurement: number;
  phMeasurement: number;
}

// l.122-129 — the webapp-side DTO of the modal. NOT stored anywhere in this shape.
export interface DiaryEntry {
  message?: string;
  title: string;
  time: Date;
  category: string;                    // singular!
  data?: Partial<DiaryEntryData>;
  images?: string[];
}

// l.219-231 — what is actually persisted
export interface DeviceLog {
  _id: string;
  device_id: string;
  message?: string;
  title?: string;
  raw?: boolean;
  severity: number;
  time: Date;
  categories?: string[];               // plural! ['diary', 'diary-plant-log']
  deleted?: boolean;
  data?: Partial<DiaryEntryData>;
  images?: string[];                   // array of Image.image_id
}

// l.233-241
export interface Image {
  image_id: string;
  device_id: string;                   // NO log/entry back-reference
  timestamp: number;
  timestampEnd?: number;
  data: Buffer;
  format?: 'jpeg' | 'mp4' | 'user/jpeg';
  duration?: '1d' | '1w' | '1m';
}
```

`DiaryEntry` is a pure UI type: `diary.page.ts:102-113` flattens it into a `DeviceLog`-shaped payload
(`category` → `categories: ['diary', category]`).

### Mongo schema — `server/src/models/devicelog.model.ts`

`data` is `Schema.Types.Mixed` (l.41-44) — schemaless, so **anything** can be written to it and nothing is
validated. `images: [String]` (l.45-48). One compound index (l.50):

```js
deviceLogSchema.index({ device_id: 1, deleted: -1, categories: 1, time: -1 });
```

There is **no** `owner_id`, no `plant_id`, no `cycle_id`, no `entry_type`, no `createdAt/updatedAt`.

---

## 3. Q1 — What exactly can a user record today, and through what UI?

**Single entry point:** `diary.page.html:23-26` → `openEntryModal()` (`diary.page.ts:85-118`) →
`DiaryEntryModalComponent`. Editing an existing entry goes through the same modal from
`diary-entries-report.component.ts:114-168`.

The modal offers **exactly five categories**, hard-coded twice — once as the option list
(`diary-entry-modal.component.html:19-23`) and once as the field whitelist
(`defaultDiaryEntries`, `diary-entry-modal.component.ts:8-55`):

| Category slug | i18n label (`en.json` `diary.categories.*`) | Fields the user can fill |
| --- | --- | --- |
| `diary-plant-log` | "Plant log" | free-text `message` only |
| `diary-plant-lifecycle` | "Stage change" | `newLifecycleStage` (6-value select), `lifecycleName` (free text, default `'My Strain'`) |
| `diary-fridge-log` | "Device log" | free-text `message` only |
| `diary-measurement` | "Measurement" | `lightMeasurement` (ppfd), `distanceMeasurement` (cm), `tdsMeasurement` (ppm), `ecMeasurement` (mS/cm), `outsideTemperatureMeasurement` (°C), `phMeasurement` (no unit) |
| `diary-co2-refill` | "CO₂ refill" | `co2FillingRest` (g), `co2FillingInitial` (g, default 425) |

Plus, on every entry: a `time` (`ion-datetime`, local wall-clock, `.html:27-36`), and **images** — camera
capture (`capture="environment"`) or multi-file picker (`.html:119-128`), uploaded immediately via
`POST /image/:device_id` and remembered as bare `image_id` strings.

`title` is only editable when the category declares it editable — none of the five do
(`isFieldEditable('title')` is false for all, because `defaultDiaryEntries[cat].defaults.title` sits under
`defaults`, not at top level). So in practice the title is always overwritten by the fixed
`message-diary-*` key in `save()` (`.ts:208`: `...(defaultDiaryEntries[this.category].defaults ?? {})`).
**The user can never name an entry.**

Units are hard-coded in a `switch` (`getDiaryDataFieldUnit`, `.ts:274-292`). `phMeasurement` returns `''`.

**Not recordable anywhere:** watering, feeding/nutrients, dose/volume, training (topping/LST/defoliation),
pest/disease observation, pot size, substrate, medium, plant count, plant height as a first-class value
(only "distance measurement"), harvest weight, transplant, seed/clone source, run cost, or free-form tags.

---

## 4. Q2 — Automatic vs. manual entries

There is **no explicit flag**. The distinction is inferred from the `categories` array, in three
mutually inconsistent ways:

1. **Manual entries** are written with `categories: ['diary', <one of the 5 slugs>]`
   (`diary.page.ts:108`, `diary-entries-report.component.ts:142`) and `severity: 0`.
2. **Editability test** — `diary-entries-report.component.ts:110-112`:
   ```ts
   isEditableLog(log) {
     return log.categories?.length === 2 && log.categories[0] === 'diary' && log.categories[1] in defaultDiaryEntries;
   }
   ```
   Exactly two categories, first is `'diary'`, second is a known slug. Nothing else is editable/deletable
   in the UI.
3. **Automatic device entries** arrive over MQTT topic `/devices/<id>/log` (`device.service.ts:185-195`) and
   are stamped `categories: ['device', ...DEVICE_MESSAGE_CATEGORY_MAPPING[key]]`. The mapping
   (`device.service.ts:82-94`) covers 12 message keys → `device-maintenance`, `device-socket`, `device-co2`,
   `device-sensor`, `device-boot`, `device-firmware`, `device-connection`.
4. Other server-written categories: `['recipe', 'recipe-step'|'recipe-confirmation'|'recipe-looped'|'recipe-completed']`
   (`device.service.ts:438,465,491,515`), `['recipe']` (`device.controller.ts:598`),
   `['device','device-firmware']` (`device.service.ts:578`), `['device','device-configuration']`
   (`device.service.ts:1155`), `['alarm','alarm-triggered'|'alarm-resolved'|'alarm-error']`
   (`alarm.service.ts:276,295`), `['webcam','error']` (`image.service.ts:547`).

**The trap:** the server-generated stage transition (`device.service.ts:710-721`) is written with
`categories: ['diary-plant-lifecycle']` — **without** the `'diary'` prefix:

```ts
await this.logMessage(deviceId, {
  title: 'message-diary-plant-lifecycle',
  message: '',
  severity: 0,
  categories: ['diary-plant-lifecycle'],     // <-- no 'diary'
  data: { newLifecycleStage: stage, ...(lastEntry?.data?.lifecycleName ? {lifecycleName: …} : {}) },
});
```

Consequences: it is **not editable** (fails `isEditableLog`), and it is **invisible in the default Entries
report**, whose default filter is `DEFAULT_ENTRY_CATEGORIES = ['diary']`
(`diary-query-params.ts:6`) and whose match test is "any category in the selected set"
(`log-entry-viewer.component.ts:19-25`). The grow report only finds it because it queries the two
lifecycle slugs explicitly (`grow-report.component.ts:142`):
```ts
private static readonly LIFECYCLE_CATEGORIES = ['diary-plant-lifecycle', 'plant-lifecycle'] as const;
```
(`'plant-lifecycle'` is the pre-rename legacy slug, still supported.)

**The `raw` flag** is a third, half-dead signal. `raw: true` means "free text, do not translate"
(`log-translate.service.ts:33,44`). Manual entries set `raw: !(category in defaultDiaryEntries)`
(`diary.page.ts:107`) which — since the picker only offers known categories — is **always `false`**.
And `LogEntryItemComponent.getEntryTitle/getEntryMessage` (`log-entry-item.component.ts:86-92`) force
`raw: false` anyway, with the comment "Some entries (e.g. legacy diary logs) were saved with raw:true even
though their title/message is a translation key."

**The `deleted` flag is not "deleted".** It is a visibility flag meaning "hide from the device overview
log stream". Manual diary entries are created with `deleted: true` (`diary.page.ts:112`), as are config-diff
entries (`device.service.ts:1156`) and manual recipe-step activations (`device.controller.ts:599`).
Server-side (`device.service.ts:739`):
```ts
...(deleted ? {} : { deleted: { $ne: true } }),
```
i.e. the `deleted=1` query parameter means **"include hidden"**, and every diary view passes it
(`diary-entries-report.ts:82`, `grow-report.ts:244,265`, `co2-report.ts:54`, `charts.page.ts:799`).
The device overview tiles (`devices/fridge|dryer|plug|fan|light/overview/*.ts`) call `getLogs(id)` with no
flag, so they see only the non-hidden device chatter.

---

## 5. Q3 — Is there ANY notion of a plant, strain, batch, grow cycle or harvest?

**No persisted entity. None.** Evidence:

* `shared-types/index.d.ts` contains no `Plant`, `Strain`, `Batch`, `Cycle`, or `Harvest` interface.
  `server/src/models/` contains 11 models — `chartpreset, claimcode, device, deviceclass, devicefirmware,
  devicelog, images, password_token, recipe, share, users` — none of them plant-related.
* A repo-wide case-insensitive grep for `strain|harvest|batch|cultivar|phenotype|yield` over
  `webapp/src`, `server/src`, `shared-types` returns only:
  - `grow-report.component.ts:742` → `cycles[i].name = 'My Strain ' + (i + 1);`
  - `diary-entry-modal.component.ts:52,96` → the string literal `'My Strain'` as the default value of
    `data.lifecycleName`
  - `en.json:172` "Visitors can switch reports, change strain and filters…" (share help text)
  - `en.json:316,358,421` — "harvest" only as *prose* inside grow-plan tips, and
    `grow-presets.ts:324,349` → `confirmationKey: 'growPresets.confirmations.harvest'` (a recipe step's
    confirmation text, not a record).

**What exists instead:** `GrowCycle` is a *runtime-only* type built in the browser
(`grow-report.component.ts:29-34`):

```ts
export type GrowCycle = {
  name: string;
  timestampStart: Date;
  timestampEnd?: Date;
  events: Partial<Record<DiaryEntryData['newLifecycleStage'], DeviceLog>>;
}
```

built by `convertEventsToGrowCycles()` (`grow-report.component.ts:691-747`). The algorithm:

1. Take every log with `data.newLifecycleStage` (categories `diary-plant-lifecycle` or `plant-lifecycle`),
   sort ascending by time.
2. Map the stage through `LIFECYCLE_EVENT_ORDER` (`grow-report.component.ts:20-27`:
   germination 0 → seedling 1 → vegetative 2 → flowering 3 → drying 4 → curing 5).
3. **Start a new cycle** when either
   - `hasOrderRollback` — the new stage's ordinal is *lower* than the previous one (l.715), or
   - `hasNameBoundary` — the entry's trimmed `data.lifecycleName` differs from the current cycle's name (l.711-714).
4. Close the previous cycle by setting `timestampEnd` to the *new* entry's time (l.720).
5. Unnamed cycles get a synthetic `'My Strain ' + (i+1)` (l.740-744).
6. Reverse so newest is first (l.746) — the order the picker shows.

So "a grow cycle" = *a monotonically non-decreasing run of stage-change log rows sharing a name string*.
Renaming a plant mid-grow silently forks the history into two cycles; going back from `flowering` to
`vegetative` (re-veg) is indistinguishable from starting a new plant.

The grow **plan** (`Recipe` / `RecipeStep.stage`, `shared-types/index.d.ts:133-154`) is the only other place
stages appear. `RecipeStep.stage?: DiaryLifecycleStage` (l.143) makes a running plan emit
`logStageTransitionIfChanged()` on step advance (`device.service.ts:470,496`) and on manual activation
(`device.controller.ts:606-608`). The stage presets live in `webapp/src/app/util/grow-presets.ts`
(`GROW_STAGE_PRESETS`, l.36+) and set climate targets — they say nothing about a plant.

**Harvest** is not a lifecycle stage. `DiaryLifecycleStage` jumps `flowering → drying`. There is no event,
no weight, no date, no yield anywhere.

---

## 6. Q4 — What breaks if one device has to track MULTIPLE plants with independent stages?

Everything downstream of "one stage sequence per device". Concretely:

1. **`convertEventsToGrowCycles` (`grow-report.component.ts:691-747`) breaks first.** It reads the device's
   lifecycle logs as *one* interleaved sequence. Two plants in different stages produce constant
   `hasOrderRollback` (plant A flowering → plant B seedling) and constant `hasNameBoundary`, so every single
   entry starts a "new cycle". You would get N cycles for N entries, each one day long.
2. **`getStageForTime()` (`.ts:676-689`)** assigns a stage to *every non-lifecycle log in the cycle window*
   by "the last stage change at or before this time". With two plants there is no single answer, so every
   watering note, alarm and config change would be filed under whichever plant changed stage most recently.
3. **`buildTimelineForCycle` / `phaseTimeline` (`.ts:396-494`)** builds one `Map<stage, TimelinePhaseGroup>`,
   i.e. **one phase per stage per cycle**. Two plants both in `vegetative` collapse into one bucket.
   Also note the map is keyed by stage, so a re-veg (vegetative → flowering → vegetative) already merges
   into a single "vegetative" section today.
4. **`buildPhaseSummaries` (`.ts:514-545`)** computes phase duration as "start of this phase → next
   lifecycle event *anywhere on the device*" (`findNextLifecycleEventDate`, l.559-576). Plant B's stage
   change would truncate plant A's phase.
5. **Cycle selection is by start timestamp** — `growCycle` query param is
   `new Date(cycle.timestampStart).getTime()` (`.ts:1265`, `applyRequestedCycleSelection` l.321-336). Two
   plants started in the same minute are indistinguishable in the URL and in share links.
6. **Webcam scrubber (`rebuildWebcamScrubDays`, `.ts:877-920`, and `loadWebcamImage`, l.1238-1251)** maps a
   day of *the selected cycle* to `GET /image/:device_id?timestamp=…`. Images are addressed by
   `(device_id, timestamp)` only (`images.model.ts:38` unique index `{device_id, format, timestamp, duration}`),
   so there is no way to say "the camera looking at plant B".
7. **`checkFixedLifecycleName()` (`diary-entry-modal.component.ts:104-147`)** walks *backwards through all
   lifecycle logs of the device* to decide (a) which name is locked for the current cycle and (b) what the
   "next" stage should be. With multiple plants it picks whichever plant moved last.
8. **The server-side dedupe `logStageTransitionIfChanged` (`device.service.ts:701-722`)** looks at the single
   most recent `diary-plant-lifecycle` entry for the device and *silently skips* the write if the stage
   matches. Two plants entering `flowering` in sequence → the second transition is dropped.
9. **The entry form has no plant selector**, and `lifecycleName` is only editable on the
   `diary-plant-lifecycle` category and is *deleted from the payload* when a cycle name is already fixed
   (`diary-entry-modal.component.ts:197-199`). A plant-log or measurement entry carries **no plant reference
   at all** — it is attached to a cycle purely by timestamp.
10. **CO₂ report (`co2-report.component.ts:58-108`)** and the charts overlay (`charts.page.ts:799`) are
    device-scoped; per-plant slicing is meaningless there.
11. **The `Recipe`** is one per device (`Device.recipe`, `shared-types/index.d.ts:177`) with a single
    `activeStepIndex`. Multiple plants at different stages under one climate controller cannot be expressed
    — and physically, one tent runs one climate.
12. **Share links** carry the cycle in the frozen `query` string (`share.model.ts:38`, `ShareLink.query`);
    "share plant B" has no representation.

**Verdict:** a per-plant diary requires a new persisted entity with a stable id, entries referencing it, and
a rewrite of `convertEventsToGrowCycles` + `buildTimelineForCycle` + `buildPhaseSummaries`. The existing
"cycle" inference should become a one-time migration, not a runtime algorithm.

---

## 7. Q5 — Watering / feeding / pH / EC / TDS

**Watering & feeding: nowhere.** There is no diary category, no `DiaryEntryData` field, no i18n key. A grep
for `water|feed|nutrient|fertil` across `webapp/src`, `server/src`, `shared-types` returns only:
* `webapp/src/app/devices/plug/settings/settings.component.html:606` → `settings.workmode === 'watering'`
  — a *smart-plug output mode* (the plug drives a pump on a schedule). That is device control, not a record:
  it never writes a diary entry, only the generic `message-device-configuration-updated` config diff.
* `webapp/src/app/util/chart-presets.ts:20` and `alarm-presets.ts:55` → `icon: 'water-outline'` (icon names).

**pH / EC / TDS exist only as three numbers on one entry type.** They are fields of `DiaryEntryData`
(`shared-types/index.d.ts:116-119`) exposed by the `diary-measurement` category
(`diary-entry-modal.component.ts:31-44`, form rows `diary-entry-modal.component.html:90-112`).
There is no notion of *what* was measured (runoff? reservoir? input solution?), no volume, no product,
no target, no reservoir identity.

**Who writes `DiaryEntryData`?** Exactly two producers:

1. **The user, through the modal.** `diary-entry-modal.component.ts:193-212` → `diary.page.ts:114`
   `devices.addLog(...)` → `POST /device/logs/:device_id` (`device.route.ts:1241`) →
   `DeviceController.addDeviceLog` (`device.controller.ts:464-488`) → `deviceService.logMessage`
   (`device.service.ts:662-693`) → `deviceLogModel.create({ …, data: msg.data })`.
   Edits take the same path through `PUT /device/logs/:device_id/:log_id` (`device.route.ts:1287`) →
   `updateDeviceLog` (`device.service.ts:771-815`).
2. **The server, for stage transitions only.** `logStageTransitionIfChanged` (`device.service.ts:701-722`)
   writes `data: { newLifecycleStage, lifecycleName? }` and nothing else.

**No device or sensor ever writes `data`.** The MQTT `/log` payload from the firmware is
`{"severity": <int>, "message": "<string>"}` and nothing more — see `firmware/src/fridgecloud.cpp:413-421`:
```cpp
StaticJsonDocument<JSON_OBJECT_SIZE(2) + 32> message_json;
message_json["severity"] = log_queue.front().second;
message_json["message"]  = log_queue.front().first.c_str();
```
(384-byte buffer, max queue `MAX_LOG_QUEUE_LEN`.) So the whole `DiaryEntryData` surface is human-entered.

Server-side validation of `data` is **zero**: `Schema.Types.Mixed` (`devicelog.model.ts:41-44`), and the
controller only checks `title|message`, numeric `severity`, non-empty `categories` array and (on POST) `time`
(`device.controller.ts:471-479`).

---

## 8. Q6 — Pagination / query model, and will it scale?

### API

| Method | Route | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/device/logs/:device_id?from&to&deleted&categories` | none in the router — `isUserDeviceOrShareMiddelware` inside the controller (owner, admin, demo, or share token) | `device.route.ts:1147` |
| DELETE | `/device/logs/:device_id` | `authMiddleware` | `device.route.ts:1170` (soft: sets `deleted:true` on **all** rows, `device.service.ts:751-756`) |
| DELETE | `/device/logs/:device_id/:log_id` | `authMiddleware` + `isUserDeviceMiddelware` | `device.route.ts:1197` (hard delete, `device.service.ts:767`) |
| POST | `/device/logs/:device_id` | `authMiddleware` + `isUserDeviceMiddelware` | `device.route.ts:1241` |
| PUT | `/device/logs/:device_id/:log_id` | `authMiddleware` + `isUserDeviceMiddelware` | `device.route.ts:1287` |
| GET | `/image/:device_id?format&timestamp&duration&image_id&width&height&token&share` | `isUserDeviceOrShareMiddelware(…, 'image')` | `image.route.ts:66` |
| POST | `/image/test/:device_id` | `authMiddleware` | `image.route.ts:109` (one-off RTSP test frame) |
| POST | `/image/:device_id` (multipart `image`) | `authMiddleware` | `image.route.ts:148` |
| DELETE | `/image/:image_id` | `authMiddleware` | `image.route.ts:173` — **never called by the webapp** |

### Query implementation — `device.service.ts:724-749`

```ts
const logs = await deviceLogModel
  .find({ device_id, ...(time range), ...(deleted ? {} : {deleted: {$ne:true}}), ...(categories ? {categories: {$in: categories}} : {}) })
  .sort({ time: -1 })
  .lean();
logs.forEach(log => (log.categories = log.categories?.length > 0 ? log.categories : ['unknown']));
return logs.reverse();
```

**There is no `limit`, no `skip`, no cursor, no total count.** The result is sorted descending, materialised
completely in memory, then `.reverse()`d into ascending order. Pagination is purely client-side:
`LogEntryViewerComponent.updateDisplayLogs()` (`log-entry-viewer.component.ts:62-75`) slices
`filtered` into pages of 100.

### Actual call sites and their blast radius

| Caller | Call | Effect |
| --- | --- | --- |
| `diary-entries-report.component.ts:82` | `getLogs(id, undefined, undefined, true)` | **Every log row the device ever produced**, unbounded, including all device chatter, then filtered in the browser. |
| `grow-report.component.ts:239-245` | `getLogs(id, u, u, true, ['diary-plant-lifecycle','plant-lifecycle'])` | All lifecycle rows ever. |
| `grow-report.component.ts:261-266` | `getLogs(id, from, to, true)` | All rows between the first and last lifecycle event — in practice the whole history. |
| `co2-report.component.ts:54` | `getLogs(id, u, u, true, ['diary-co2-refill'])` | All refills ever, then one InfluxDB series query **per cylinder**, sequentially (`.ts:79`). |
| `diary-entry-modal.component.ts:113,128` | `getLogs(id, undefined, <entry time>, true, ['diary-plant-lifecycle'])` | Re-fetched on **every category change and every stage change** in the form (`(ionChange)="checkFixedLifecycleName()"`). |
| `charts.page.ts:799` | `getLogs(id, fromMs, toMs, true)` | Time-bounded (the only bounded caller). |
| `devices/*/overview/*.ts` | `getLogs(id)` | Non-hidden rows only; `fridge/overview/overview.component.ts:177-198` then collapses consecutive identical rows into a `count`. |

### Scaling verdict

**It will not scale to a rich per-plant diary.** A controller running for a year emits device logs on
every boot, sensor fault, socket event, config change and alarm; `diary-entries-report` fetches all of them
plus all images metadata on every page open. Missing pieces a redesign must add: server-side
`limit`/`skip` (or a `time`-keyed cursor), a total count, server-side text search, and an index that
supports the intended access pattern. The one existing index
(`{device_id:1, deleted:-1, categories:1, time:-1}`, `devicelog.model.ts:50`) is arranged for
"device + category + time", which is usable, but the query never limits so the index only avoids a sort,
not the transfer. Image blobs are stored in MongoDB documents (`images.model.ts:22-25`), which caps a single
photo at the 16 MB BSON limit and makes the log collection's neighbour collection very large.

---

## 9. Categories, severity, and the `message-*` i18n mechanism

### Severity
`severity: number` (`devicelog.model.ts:21-25`, default 0). Used as `0|1|2` everywhere:
* colouring in `log-entry-item.component.html:4` → `tc-text-info` / `tc-text-warning` / `tc-text-danger`;
* three separate Highcharts column series on the charts page (`charts.page.ts:802-820`, "Info/Warning/Critical logs");
* `fridge/overview/overview.component.ts:166` takes the max severity of visible logs for a badge.
**Every manual diary entry is severity 0** (`diary.page.ts:111`), so severity is a device-alert concept
that the diary inherits but never uses.

### Categories
Free-form `string[]`. No enum, no registry — the union of everything ever written. Values seen in code:
`diary`, `diary-plant-log`, `diary-plant-lifecycle`, `diary-fridge-log`, `diary-measurement`,
`diary-co2-refill`, legacy `plant-lifecycle`/`plant-log`, `unknown` (injected server-side when empty,
`device.service.ts:745`), `device`, `device-maintenance`, `device-socket`, `device-co2`, `device-sensor`,
`device-boot`, `device-firmware`, `device-connection`, `device-configuration`, `recipe`, `recipe-step`,
`recipe-confirmation`, `recipe-looped`, `recipe-completed`, `alarm`, `alarm-triggered`, `alarm-resolved`,
`alarm-error`, `webcam`, `error`.

The filter dropdown is populated from whatever the fetched rows contain (`collectLogCategories`,
`log-entry-viewer.component.ts:13-17`). Labels come from `LogTranslateService.getCategoryLabel`
(`log-translate.service.ts:55-59`) which looks up `diary.categories.<slug>` and **falls back to the raw
slug**. `en.json`'s `diary.categories` only defines 20 of them — so users see chips reading
`device-boot`, `alarm-triggered`, `recipe-step`, `webcam`, `error` verbatim.

### The `message-*` mechanism
Titles and messages are stored either as a bare key (`message-diary-plant-log`) or as `key:value`
(`message-co2-low:380`, `message-device-configuration-updated:<diff>`). Resolution is in
`LogTranslateService.translateLogText` (`log-translate.service.ts:61-78`):
1. try `<whole string>-<title|text>` (allows per-value overrides, e.g. `message-device-booted:PANIC-text`);
2. try `<part before ':'>-<title|text>` with `{ value: <part after ':'> }`;
3. try the legacy English-prose patterns in `LEGACY_LOG_TEXTS` (`log-translate.service.ts:102-116`) —
   seven regexes matching old rows such as `/^Plant phase change$/i` → `message-diary-plant-lifecycle`;
4. otherwise return the raw string.

`webapp/src/assets/i18n/en.json` holds **69** `message-*` keys across **43** message bases
(`-title` / `-text` pairs). `de.json` is complete for the diary (2 missing keys overall, none under `diary.*`).
The simulator writes these keys directly: `./simulate-device.sh -d <id> log message-co2-low:380 --severity 1`
(`scripts/simulate-device.mjs:551-552`).

`entry.data` is rendered generically, with no per-type layout
(`log-entry-item.component.html:31-41`):
```html
<li *ngFor="let measurement of entry.data | keyvalue">
  {{ 'diary.labels.' + measurement.key | translate }}:
  {{ measurement.key === 'newLifecycleStage' ? ('diary.lifecycleStages.' + measurement.value | translate) : measurement.value }}
  {{ getDiaryDataFieldUnit(measurement.key) }}
</li>
```
Any new `data` key therefore needs a matching `diary.labels.<key>` and a `getDiaryDataFieldUnit` case, or it
renders as `diary.labels.foo: 3`.

---

## 10. Images and timelapses

### Diary photos (`format: 'user/jpeg'`)
* Upload: modal → `devices.uploadDeviceImage` (`devices.service.ts:260-271`) → `POST /image/:device_id`
  multipart (`express-fileupload`, `app.ts:85`, **no size limit configured**) →
  `ImageController.uploadDeviceImage` (`image.controller.ts:82-109`) →
  `imageService.createDeviceImage` (`image.service.ts:113-123`) which runs the bytes through ImageMagick
  `convert -auto-orient` and stores `{image_id: uuidv4(), device_id, format:'user/jpeg', timestamp, data}`.
* The returned `image_id` is pushed onto `DiaryEntryModalComponent.images` and saved as
  `DeviceLog.images: string[]`. **The `Image` document has no back-reference to the log.**
* Display: `devices.getDeviceImageUrl(device_id, 'user/jpeg', undefined, undefined, imageId)`
  (`devices.service.ts:246-252`) builds `GET /image/<device_id>?timestamp=&token=<image JWT>&share=…&format=user/jpeg&duration=&image_id=<id>`.
  Thumbnails append `&height=100` (`log-entry-item.component.html:51`); the lightbox uses the full URL.
* **Orphans:** `removeImage()` (`diary-entry-modal.component.ts:240-242`) only drops the id from the array;
  `deleteLog()` (`diary-entries-report.component.ts:170-190`) hard-deletes the log row.
  `DELETE /image/:image_id` exists (`image.route.ts:175`) but **nothing in the webapp ever calls it**, and
  user images are excluded from retention/thinning (both filter `format: 'jpeg'`,
  `image.service.ts:288, 404-441`). Diary photos therefore accumulate forever.
* `images.model.ts:38` — unique index on `{device_id, format, timestamp, duration}`. Two user uploads that
  land in the same millisecond for one device collide.

### Webcam stills (`format: 'jpeg'`)
`imageService.readFromRtspStreams()` (`image.service.ts:201-261`) polls every device with
`cloudSettings.rtspStream` every 30 s (`IMAGE_LOAD_INTERVAL_MS`), with exponential backoff to 2 h,
skipping devices in maintenance when `maintenanceWebcamOff`. One ffmpeg keyframe grab per poll
(`readRtspStreamImage`, l.485-562), or the Terp Cam P2P path when the URL starts with `okam://`.
Failures optionally log `message-rtsp-stream-error` with categories `['webcam','error']` (l.543-548).
Retention 3 years (`IMAGE_RETENTION_DAYS`, l.62), progressive thinning in four tiers
(`IMAGE_THINNING_TIERS`, l.67-72).

### Timelapses (`format: 'mp4'`, `duration: '1d'|'1w'|'1m'`)
`compressRtspStreams()` (l.278-313) runs hourly and calls `compressRtspStreamRange()` (l.315-402) for each
window, writing the JPEGs to a temp dir and running `ffmpeg -framerate 25 … -vcodec libx265 -crf 30`
(`convertRtspStreamImagesToVideo`, l.564-609). Rebuild throttles: 1 h / 4 h / 12 h.
**Timelapses are keyed only by `(device_id, timestamp, duration)` — they have no relation to a grow cycle,
a phase, or a diary entry.** The grow report's webcam scrubber does *not* use them; it fetches one still per
day at a chosen time of day (`grow-report.component.ts:1238-1251`).

---

## 11. The grow report — what it actually shows

Rendered by `grow-report.component.html` when `report=growreport`.

1. **Category filter** + **cycle picker** (`ion-select` over `growCycles`, labelled by the derived `name`)
   + a **"Show webcam photos"** toggle (l.6-30).
2. **Cycle header card** (l.44-73): name, start date, end date (if closed), and `totalEventsInSelectedCycle`
   (`.ts:757-764`), plus a chart-link button that navigates to `device/:id/charts` with
   `measures=temperature,image,logs`, `interval=1h`, `useCustom=true`, `vpdMode=day`, the selected log
   categories, and the cycle's date range (`navigateToChartsForCycle` → `navigateToChartsWithDateRange`,
   `.ts:619-656`).
3. **Phase summary list** (l.76-96): one row per phase — stage label, start date, `durationDays`,
   and "total day X – Y" — each with a per-phase chart link and a scroll-to anchor.
   Duration logic (`buildPhaseSummaries`, `.ts:514-545`): from the phase's first day to the *next lifecycle
   event on the device*, except `curing`, which always runs to today.
4. **Vertical timeline** (l.98-176): `phase-section` → `day-section` (labelled
   "Day N (Day in phase: M) • date") → one `<app-log-entry-item>` per event. Between days a
   **gap indicator** whose pixel height is `max(1, gapDays) × 14 px` (`gapLineHeightPx`, `.ts:812-814`)
   with a dot per skipped day, labelled "2 weeks 3 days later" (`formatGapSpan`, `.ts:785-803`).
   The timeline ends with a "Today" dot.
5. **Floating webcam panel** (l.181-229): day label, a time-of-day picker (default 23:59), the still, and an
   `ion-range` scrubbing across every calendar day of the cycle (capped at 3660 days,
   `rebuildWebcamScrubDays`, `.ts:903`). ~370 lines of the component
   (`.ts:827-1251`) implement scroll-linked scrubbing: the marker follows the reading position at 35 % of
   the viewport, snapping to days with entries within 10 px, ticking one day at a time so a fling does not
   teleport (`animateWebcamTowardsIndex`, `.ts:1016-1042`), with a 2.5 s hold-off after manual scrubbing.

What the grow report **does not** show: any aggregate over the cycle (average temp/VPD/DLI, days of light,
CO₂ consumed), any nutrient/watering history, any yield, any comparison between cycles, any export.

---

## 12. Sharing (`ShareLink.page === 'diary'`)

* Model `server/src/models/share.model.ts` — `page` enum `['charts','diary']` (l.20-24), plus
  `editable`, `webcam`, `charts`, `query` (≤2000 chars), `expiresAt`, `revokedAt`, `openCount`, `lastOpenedAt`.
* Creation `share.controller.ts:16-52`: `webcam: !!editable || !!webcam` ("an interactive link always
  includes the webcam"); `charts: page === 'diary' && !!charts` (l.42) — the diary-only flag that lets a
  visitor follow the grow report's chart links.
* The **whole view is frozen in `query`**: the modal snapshots `window.location.search`
  (`share-link-modal.component.ts:68-78`). For a view-only link, `DiaryPage` replaces URL params with
  `lockedParams = new URLSearchParams(share.query)` (`diary.page.ts:67-70`) and every child receives
  `[locked]` + `[lockedParams]`. Parameters currently captured: `report`, `entryCategories`,
  `growCategories`, `growCycle` (the cycle's start timestamp), `webcamViewer`
  (`diary-query-params.ts:3-7`, `grow-report.component.ts:1258-1268`).
* Visitor path: `AuthGuard.canActivateSharedRoute` (`auth.guard.ts:36-66`) resolves the token, and allows
  `page === 'diary'` or `page === 'charts'` when `share.charts` is set.
  `GET /share/resolve/:share_id` (`share.controller.ts:104-129`) increments `openCount` and returns a
  `DeviceAccessInfo` with `isPublic: true` and `cloudSettings.rtspStream` masked to `'1'` when webcam is on
  (`device.service.ts:1354-1384`).
* Image access for share visitors: diary photos (`image_id`) are always allowed; webcam stills/timelapses
  (addressed by timestamp) require `share.webcam` (`image.controller.ts:50-55`).
* **Note (server-side gap):** `findValidShare` (`auth.middleware.ts:70-80`) matches only on
  `share_id` + `device_id` + not revoked/expired — it does **not** check `share.page`. So a `charts` share
  token can call `GET /device/logs/:device_id` for the same device. The page restriction is enforced only in
  the Angular guard.

---

## 13. Q7 — Every awkward/legacy thing a redesign inherits

1. **`DeviceLog` is one table for two unrelated things** — machine telemetry events and human journal
   entries. No `entry_type` discriminator; the split is a string-prefix convention in `categories[0]`.
2. **`deleted` does not mean deleted.** It means "hide from the device overview log list"
   (`device.service.ts:739`, `diary.page.ts:112`). The query param `deleted=1` means "include hidden".
   Consequence: **"Clear logs" on the device overview (`DELETE /device/logs/:device_id`,
   `device.service.ts:751-756`) sets `deleted:true` on every row and does not remove a single diary entry**,
   because the diary always requests hidden rows.
3. **Two delete semantics coexist:** collection-wide soft (`deleteDeviceLogs`) vs. single hard
   (`deleteDeviceLog`, `device.service.ts:767`). The hard delete leaves the attached `Image` docs behind.
4. **`raw` is vestigial.** Always `false` from the modal; forced `false` by the renderer
   (`log-entry-item.component.ts:86-92`) with a comment explaining that historic rows lied about it.
5. **Server-generated lifecycle entries lack the `'diary'` category** (`device.service.ts:714`), so they are
   invisible in the Entries report default filter and not editable — while the identical manual entry is.
6. **Two lifecycle category slugs** must be supported forever: `diary-plant-lifecycle` and the legacy
   `plant-lifecycle` (`grow-report.component.ts:142`, plus `plant-log`/`plant-lifecycle` labels in
   `en.json`).
7. **Seven legacy English-prose regexes** in `log-translate.service.ts:102-116` translate rows written
   before the `message-*` keys existed (`/^Plant phase change$/i` etc.). Any migration must keep these
   matching or the old grow diaries go blank.
8. **`DiaryEntry.category` (singular string) vs `DeviceLog.categories` (array)** — converted by hand in three
   places (`diary.page.ts:108`, `diary-entries-report.component.ts:142`, `…:197 toDiaryEntry`), always
   assuming index 1 is the "real" category.
9. **`defaultDiaryEntries` is a schema-in-a-const** (`diary-entry-modal.component.ts:8-55`). Field visibility
   is decided by `isFieldEditable()` doing `subField in mainFieldValue` on it (`.ts:214-226`), so adding a
   field means touching the const, the template (one hand-written `ion-item` per field), the
   `getDiaryDataFieldUnit` switch (`.ts:274-292`) and `diary.labels.*` in two i18n files.
10. **Title is never user-editable** — always overwritten by `defaults.title` at `save()` (`.ts:208`).
11. **`DiaryEntryData` is a flat bag of ten optionals** with no units, no ranges, no validation
    (`Schema.Types.Mixed`, `devicelog.model.ts:41`). `phMeasurement` has no unit case in the switch.
12. **`'My Strain'` is a hard-coded English literal** used as a default value written into the database
    (`diary-entry-modal.component.ts:52,96`) and as a synthetic cycle label
    (`grow-report.component.ts:742`) — not translated, not a real identity.
13. **Cycle boundaries are inferred, not recorded** (`convertEventsToGrowCycles`, `.ts:691-747`). Renaming
    forks a cycle; a re-veg starts a bogus new one; a skipped stage is silently tolerated.
14. **Cycle identity in URLs/share links is a start timestamp** (`.ts:1265`), so history rewrites (editing an
    entry's time) break existing share links.
15. **No pagination anywhere on the server** (`device.service.ts:724-749` — no `.limit()`), while the client
    paginates at 100 (`log-entry-viewer.component.ts:4`). `diary-entries-report` fetches the device's
    *entire* log history on every open.
16. **The modal re-queries the server on every category/stage change** (`(ionChange)="checkFixedLifecycleName()"`,
    `.html:15,59`) — up to two full lifecycle-log fetches per keystroke-equivalent interaction.
17. **Dead code:** `DiaryEntriesReportComponent.onIncludeSystemEntriesChange()` (`.ts:101-103`) is never
    called from anywhere, and its i18n key `diary.entriesIncludeSystem` (`en.json:709`, `de.json:705`) is
    unused. `disableLogGrouping()` is an empty body labelled "Placeholder for future grouping logic"
    (`.ts:208-210`) wired to `(showAll)` (`.html:31`) — so the "(Message appeared Nx) show all" affordance
    that works on the charts page (`charts.page.ts:1192`) silently does nothing in the diary. Note the
    diary never sets `count` either, so the affordance never appears there.
18. **`Co2ReportComponent.NaN`** (`.ts:110`) is a leftover `protected readonly NaN = NaN;`. The CO₂ report
    also issues one sequential InfluxDB query per cylinder inside a loop (`.ts:76-102`).
19. **~370 of the grow report's 1270 lines are DOM-measuring webcam-scrubber code** (`.ts:827-1251`) that
    reads `getBoundingClientRect()` of `.day-dot` / `.gap-line-vertical` elements and interpolates day
    positions along gap lines. Any change to the timeline markup breaks the scrubber silently.
20. **Category labels leak raw slugs** — `getCategoryLabel` falls back to the slug
    (`log-translate.service.ts:55-59`) and `en.json diary.categories` covers only ~20 of ~28 slugs.
21. **Images live as MongoDB Buffers** (`images.model.ts:22-25`), keyed `{device_id, format, timestamp, duration}`
    with a **unique** index — no per-entry linkage, no GC for diary photos, same-millisecond upload collision.
22. **`express-fileupload` is mounted without limits** (`app.ts:85`).
23. **Share `page` is enforced only client-side** (`auth.guard.ts:49`); `findValidShare`
    (`auth.middleware.ts:70-80`) ignores it.
24. **`GET /device/logs/:device_id` has no router-level auth middleware** (`device.route.ts:1147`) — the
    check lives inside the controller. Easy to miss when adding sibling routes.
25. **Severity is a device-alert concept the diary never uses** — all manual entries are `0`.
26. **`diary.page.scss` and three other diary SCSS files are 0 bytes**; all diary styling that exists is the
    253-line `grow-report.component.scss`.
27. **`getDeviceLogs` mutates its own result** to inject `['unknown']` for empty categories
    (`device.service.ts:745`), which then shows up as a filter option in the UI.
28. **No i18n for user-entered text**, and `diary.confirmDelete` / the modal's "You have unsaved changes"
    prompt (`diary-entry-modal.component.ts:150`) use the native `confirm()` dialog — the latter with an
    untranslated hard-coded English string.

---

## 14. What is genuinely reusable

* `LogEntryViewerModule` (viewer / item / category selector / image lightbox) is cleanly separated and
  already used by the diary, the charts page and the device overviews.
* `LogTranslateService` is a good single point for message resolution, including the legacy fallbacks.
* `diary-query-params.ts` (URL ⟷ view state) and the share-link "frozen query" mechanism generalise to any
  new report.
* The `POST/PUT/DELETE /device/logs/*` shape is fine as an *event* API; what is missing is the entity the
  events would hang off.
* `DiaryLifecycleStage` is already shared between the diary and the grow-plan presets
  (`grow-presets.ts:14`, `RecipeStep.stage`), so stage vocabulary is consistent across the product.
