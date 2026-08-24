# Orchestrator grounding notes (verified by direct file reads)

These were established by reading the repo directly. Treat as VERIFIED ground truth.

## Product & business context (from terpcontrol.com)

- Company: **Novazer GmbH**. Site language **de-DE**. German-first audience; English second.
- Community already lives on **Telegram** (`t.me/+w-XFn8c8pLQyNWFi`) — a Telegram integration meets
  users where they already are, unlike X/Instagram.
- Controller: **289 €** (349 € w/ camera bundle listed as 319 €), CO2 Control sensor upgrade **+59 €**.
- **Release date in schema.org markup: `2026-10`** — the first series is 150 units. Software must land with it.
- Marketing promise: *"Messen. Regeln. Ruhig schlafen."* (Measure. Control. Sleep peacefully.)
  and *"Ein Controller für dein ganzes Zelt"* (one controller for your whole tent).
- Firmware is **open source with a documented REST API** — a public selling point.

## Hardware capability envelope (bounds what is even possible)

- **1× PWM dimming output**, freely assignable to a dimmable lamp OR an exhaust fan. Only one.
- **Up to 32 Tasmota smart sockets** over local WiFi, **with roles and failsafe**. This is the mechanism
  by which user type 4 (full tent: heat, humidifier, dehumidifier, cooler, air) is served.
- Sensors: temperature, humidity, VPD (derived); **CO2 only with the paid upgrade**.
- Local UI: display + rotary knob on the device itself.
- **There is NO irrigation/dosing hardware.** Therefore watering and fertilising are a *logging/journaling*
  problem, not a control problem — unless a user drives a pump through a Tasmota socket.
  Design implication: the feeding feature is about capture speed and recall, not automation.

## Existing data model (shared-types/index.d.ts, 278 lines)

Verified types: `Alarm`, `CloudSettings`, `ShareLink`/`ShareAccess`, `DiaryLifecycleStage`,
`DiaryEntryData`, `DiaryEntry`, `RecipeStep`/`Recipe`/`RecipeTemplate`, `Device`, `DeviceLog`,
`Image`, `User`, `ChartPreset`.

**Confirmed absences — there is no:**
- `Plant` entity of any kind. A grow's identity is a free-text `DiaryEntryData.lifecycleName`
  (default literal `'My Strain'`) attached to a single stage-change entry.
- Watering record, feeding/fertiliser record, nutrient product, reservoir, or schedule entity.
- Harvest/yield entity, batch, or grow-cycle entity.
- Any multi-user access: `Device.owner_id` is a single string. `ShareLink` is **read-only viewing only**
  (`editable` merely means the visitor may change the *view*, not the data).
- Any outbound integration machinery except `Alarm.actionType: 'webhook'`.

`DiaryLifecycleStage = 'germination' | 'seedling' | 'vegetative' | 'flowering' | 'drying' | 'curing'`

## What a user can log today — exactly 5 entry types

From `webapp/src/app/device/diary/diary-entry-modal/diary-entry-modal.component.ts:8-54`:

1. `diary-co2-refill` — co2FillingRest, co2FillingInitial
2. `diary-plant-log` — free text + images
3. `diary-fridge-log` — free text
4. `diary-measurement` — lightMeasurement, distanceMeasurement, tdsMeasurement, ecMeasurement,
   outsideTemperatureMeasurement, phMeasurement
5. `diary-plant-lifecycle` — newLifecycleStage, lifecycleName

**No watering entry. No feeding entry. No plant selection.** Everything lands on one flat per-device timeline.

## Setpoints / goals (the "goal vs actual" raw material EXISTS)

`webapp/src/app/util/grow-presets.ts` defines `GROW_STAGE_PRESETS` with, per stage:
`dayTemperature`, `nightTemperature`, `dayHumidity`, `nightHumidity`, `lightHours`, `lightLimit`,
`co2Enriched`, `co2Ambient`, **`vpdRange: [min, max]`**, `workmode: 'small'|'dry'`.
Stages: seedling, vegetative, flowering, late_flowering, drying.

So targets — including a VPD *band* — already exist in the client. They are simply never drawn against
the measured series. "Goal vs actual" is largely a presentation gap, not a data-collection gap.

## CRITICAL ARCHITECTURAL CONSTRAINT

`grow-presets.ts:31-34` states verbatim:

> Values are written into the existing device configuration fields only — no preset id is ever stored,
> **because the firmware strips unknown keys when it echoes its config back.**

**Consequence: `device.configuration` cannot carry new keys.** Every new concept (plants, feeding
schedules, plant↔socket mapping, club roles) must be stored **cloud-side in MongoDB**, keyed by
device_id. Do not propose designs that stash state in device config. Firmware/MQTT changes are
expensive and gated by a hardware release — prefer cloud-only designs.

Device settings use dotted keys, e.g. `day.temperature`, `night.temperature`, `lights.limit`.

## Frontend stack — decides how new UI must be written

- **Angular ^15.0.0**, **@ionic/angular ^6.1.9**, `@ngx-translate/core ^14`. Capacitor 4.
- **NgModule-based, NOT standalone components.** New UI must be declared in NgModules.
- i18n: `webapp/src/assets/i18n/en.json` (1121 lines) and `de.json` (1117 lines) — a 4-line drift,
  worth checking. **Both languages are mandatory**; the `message-*` key convention maps device log
  messages to translated strings.

## Charting — two libraries are shipped at once

- **`highcharts` ^10.3.3 + `highcharts-angular` ^3.0.0**, used as `highcharts/highstock` with the
  **Boost**, **no-data-to-display** and **highcharts-more** modules. This is the real charting engine
  (`charts.page.ts`, `diagnostics.page.ts`).
- **`ng2-charts` ^4.1.1 + Chart.js + `chartjs-adapter-luxon`** are ALSO imported in the very same files.
- **Highcharts Stock is commercially licensed software.** For a product being sold, and for a repo that
  markets itself as open source, this is a genuine licensing question that a chart overhaul must confront.
  Any concept proposing a chart rewrite should state its licence position explicitly.
- Minor real defect: `charts.page.ts` calls `noData(Highcharts);` **twice** (lines ~27-31).
- `charts.page.ts` is **1205 lines**; `grow-report.component.ts` is **1270 lines**. Both are monoliths.

## The controller has no UI of its own — it borrows the fridge's

`webapp/src/app/devices/` contains `fridge/`, `dryer/`, `fan/`, `light/`, `plug/` — **there is no
`controller/` directory.** A `device_type === 'controller'` is rendered by **`FridgeOverviewComponent`**
and `FridgeSettingComponent`, which branch internally
(e.g. `devices/fridge/overview/overview.component.ts:242`: `if (this.device_type === 'controller' && mode === 'full')`).

This is the single strongest piece of evidence for the redesign: the flagship product shipping in
October 2026 is presented to users through components named after a converted refrigerator.
`AGENTS.md` also instructs that the `dryer` type is dead ("Ignore the `dryer` hardware type").

## Capability detection

The UI keys off `device_type` + `hardwareInfo` (a `Record<string,string>` the device reports), via
helpers in `grow-presets.ts` (`deviceHasCo2`, `deviceControlCapability`) and `socket-info.ts`
(`parseSocketRoles`). Socket **roles** are how the app knows a socket is a heater vs a humidifier.
This is the natural hook for "which of my kit do I actually control" (user types 3/4/5).

## Testing reality

Very few specs exist (`charts.page.spec.ts` is 24 lines; `grow-report.component.spec.ts` is 162).
Any claim that a concept is "fully tested" must reckon with a near-empty test baseline.

## Local verification is available

`./simulate-device.sh` fully simulates a controller over real MQTT — including camera stills, history
backfill, socket pairing and firmware updates. Any implemented concept **can and must** be verified
end-to-end locally against a simulated controller. There is no excuse for unverified UI claims.
