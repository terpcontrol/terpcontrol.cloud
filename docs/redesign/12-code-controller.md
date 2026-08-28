# Terp Control — Device types & how the CONTROLLER is rendered

Repo: `/home/user/terpcontrol.cloud`, branch `claude/controller-software-user-types-wc1jxn`.
All paths below are repo-relative unless absolute. Line numbers from the working tree at time of reading.

---

## 0. Headline answer: there is no `controller` UI

`webapp/src/app/devices/` contains `fridge/`, `dryer/`, `fan/`, `light/`, `plug/` — **no `controller/`**.

A device whose `device_type === 'controller'` is rendered by the **fridge components**, wired up by two
`ngSwitchCase` blocks:

- `webapp/src/app/device/list/list.page.html:105-115` — `*ngSwitchCase="'controller'"` → `<fridge-overview>`
  (identical binding block to `'fridge'` at :94-104 and `'fridge2'` at :83-93).
- `webapp/src/app/device/settings/settings.page.html:14` — `*ngSwitchCase="'controller'"` → `<fridge-settings>`
  (identical to `'fridge'` :12 and `'fridge2'` :13).

Consequences that are visible to a controller owner today:

- `webapp/src/app/devices/fridge/overview/overview.component.html:40` hard-codes the type label:
  `<h3 class="device-type-label">{{'devices.fridge.title' | translate}}</h3>` → **"Terp Control FRIDGE GROW"**
  (en.json and de.json identical). A controller's dashboard card literally says it is a fridge.
- `overview.component.ts:91-94` — when a device has no name, it is named `devices.fridge.title`, i.e. a fresh
  unnamed controller is called "Terp Control FRIDGE GROW".
- There is **no `devices.controller` block** in `webapp/src/assets/i18n/en.json` / `de.json`. The i18n `devices`
  keys are: `fridge`, `fan`, `light`, `plug`, `dryer` + shared buttons.
- Workmode labels reused verbatim: `devices.fridge.workmode-small` = "Small Plants",
  `-temp` = "Greenhouse", `-dry` = "Drying", `-breed` = "Germination", `-off` = "Off",
  `-full` = "Big Plants" (removed for controllers, see §6).
- The whole *expert* settings form (`fridge/settings/configuration/configuration.component.html`) is the fridge
  form with two `deviceType !== 'controller'` opt-outs.

So: **the controller is a second-class citizen of the fridge UI**, differentiated only by a handful of
`device_type === 'controller'` guards and by `hardwareInfo` capability probing.

---

## 1. Exactly how `device_type` drives the UI — every branch point

Device types that exist anywhere in the stack:
`fridge`, `fridge2`, `controller`, `plug`, `fan`, `light`, `dryer` (legacy; AGENTS.md says ignore it),
plus `cam` as a firmware hwtype only. Server-side device classes are seeded in
`server/src/services/device.service.ts:49-80` (`fridge`, `fan`, `light`, `plug`, `controller` —
`controller` description "FG Controller 2.0"). `fridge2` has no class seed but is handled everywhere in the UI.

### 1.1 Component dispatch (the only two `ngSwitch`es)

| File:line | Switch on | Cases |
| --- | --- | --- |
| `webapp/src/app/device/list/list.page.html:77` | `device.device_type` | `fan`→`<fan-overview>`, `fridge2`/`fridge`/`controller`→`<fridge-overview>`, `light`→`<light-overview>`, `plug`→`<plug-overview>`, `dryer`→`<dryer-overview>` |
| `webapp/src/app/device/settings/settings.page.html:10` | `device_type` | `fan`→`<fan-settings>`, `fridge`/`fridge2`/`controller`→`<fridge-settings>`, `light`→`<light-settings>`, `plug`→`<plug-settings>`, `dryer`→`<dryer-settings>` |

Note: `fan-overview`, `light-overview`, `plug-overview`, `dryer-overview` do **not** receive
`device_type`/`hardware_info`; only the fridge family does.

### 1.2 Explicit `=== 'controller'` / list-membership checks

| File:line | Predicate | Effect |
| --- | --- | --- |
| `webapp/src/app/util/grow-presets.ts:137` | `device.device_type === 'controller'` (`deviceHasCo2`) | Only controllers can report *no* CO2 sensor (`hardwareInfo.co2 === 'off'`); fridges always "have CO2". |
| `webapp/src/app/util/grow-presets.ts:158` | `device.device_type !== 'controller'` (`deviceControlCapability`) | Non-controllers always `'full'`. Only controllers get `light_only` / `monitor`. |
| `webapp/src/app/components/aux-devices/aux-devices.component.ts:21` | `['controller','fridge','fridge2']` | Shows `<smart-sockets>` card. |
| `webapp/src/app/components/setup-wizard/setup-wizard.component.ts:21,83` | `CLIMATE_DEVICE_TYPES = ['fridge','fridge2','controller']` | Wizard has stage/plan steps at all. |
| `webapp/src/app/components/setup-wizard/setup-wizard.component.ts:87` | `=== 'controller'` (`isController`) | Adds the `'connections'` wizard step (socket detection). |
| `webapp/src/app/devices/fridge/settings/settings.component.ts:225` | `['fridge','fridge2','controller']` (`canStartPlan`) | "Start grow plan" enabled. |
| `webapp/src/app/devices/fridge/settings/settings.component.ts:439-453` | `deviceType !== 'controller'` → return (`normalizeWorkmodes`) | Rewrites legacy `workmode:'full'` → `'small'` in device settings *and every recipe step*. |
| `webapp/src/app/devices/fridge/settings/configuration/configuration.component.ts:167-172` | `=== 'controller'` | Removes `full` ("Big Plants") from the workmode dropdown; maps a stored `full` to `small`. |
| `webapp/src/app/devices/fridge/settings/configuration/configuration.component.html:174` | `deviceType !== 'controller'` | Hides `settings.externalfan` / `settings.internalfan` rows (controller has no fan outputs). |
| `webapp/src/app/devices/fridge/settings/settings.component.html:182` | `deviceType !== 'controller'` | Hides the "Ext. V. / Int. V." fan summary in the recipe step header. |
| `webapp/src/app/devices/fridge/overview/overview.component.ts:242-244` | `=== 'controller' && mode === 'full'` | Displays the mapped workmode `small`. |
| `webapp/src/app/util/alarm-presets.ts:118` | `deviceType === 'fridge'/'fridge2'` | Alarm preset `running_continuously` gets the label "Fridge running non-stop" instead of "Dehumidifier running non-stop". |
| `webapp/src/app/device/charts/charts.page.ts:129-149` (`measures[].types`) | contains `device_type` | Per-type measure filtering (see §2.3). |
| `webapp/src/app/device/charts/charts.page.html:163` | `['fridge','fridge2','light','controller']` | VPD day/night mode selector visible. |
| `webapp/src/app/diagnostics/diagnostics.page.html:63` | `=== 'fridge'` | Admin diagnostics extras (fridge only). |
| `webapp/src/app/services/chart-presets.service.ts:17` | `device_type` passed | Stored on the ChartPreset, informational only (`shared-types/index.d.ts:273`). |

### 1.3 The *hardware*-driven branches (this is where the controller actually differs)

`device.hardwareInfo` is a free-form `Record<string,string>` (`shared-types/index.d.ts:178`, mongoose
`Schema.Types.Mixed` at `server/src/models/device.model.ts:151`). Keys are set from MQTT log lines
`hardware-info:<key>=<value>` (`server/src/services/device.service.ts:187-188,592-611`; key must match
`/^[a-zA-Z0-9_-]{1,64}$/`, value ≤ 512 chars).

Keys the controller firmware emits:

| key | values | emitted at |
| --- | --- | --- |
| `co2` | `on` / `off` | `firmware/src_hwtype/controller/controller.cpp:784` |
| `leaf_temp` | `on` / `off` | `controller.cpp:793` (MLX90632 present) |
| `ppfd` | `on` / `off` | `controller.cpp:800` (VEML7700 present) |
| `sockets` | csv of connected roles, or `none` | `firmware/src/wifi.cpp:1751` |
| `socket_ips` | csv of `role@ip` | `firmware/src/wifi.cpp:1752` |
| `webcam_did` | O-KAM P2P device id or `none` | consumed at `server/src/services/device.service.ts:608-610` → `reconcileP2PCamera` |
| `claimcode_auth` | `on`/`off` | `device.service.ts:948,1097` |

UI keyed off them:

- `devices/fridge/overview/overview.component.ts:97-101`
  `showCo2Display = hardware_info?.['co2'] !== 'off'`,
  `showLeafTempDisplay = hardware_info?.['leaf_temp'] === 'on'`,
  `showPpfdDisplay = hardware_info?.['ppfd'] === 'on'` → hides/shows the CO2, Leaf Temp, PPFD tiles and the
  CO2 output tile (`overview.component.html:105,121,134,183`).
- `webapp/src/app/util/grow-presets.ts:143-173` `deviceControlCapability()` →
  `'full' | 'light_only' | 'monitor'`, derived **only** from `hardwareInfo.sockets`:
  - climate roles `['dehumidifier','heater','co2']` present → `full`
  - else light roles `['light','secondary_light']` present → `light_only`
  - else → `monitor`
  - `sockets` key **absent** (old firmware) → `full` (fail-open).
  Parsing lives in `webapp/src/app/util/socket-info.ts:9-14` (`'none'` and `''` → `[]`).
- Consumers of the capability:
  - `simple-settings.component.ts:64-76` → `isReference`, `isMonitor` → reference-value banner
    (`simple-settings.component.html:1-6`), monitor-only hints, hides the light-intensity slider
    (`:187`).
  - `grow-assistant-card.component.ts:72-75` → `isReference` → "your device only monitors" hint.
  - `setup-wizard.component.ts:91-101` → `connections` step content + whether the stage/plan steps are shown
    at all (`steps` getter, :66-75: a monitor-only controller gets `['name','connections','done']`).
- `cloud-settings.component.html:23` shows the PPFD lux factor only when `hardwareInfo['ppfd'] === 'on'`.
- `smart-sockets.component.ts:60-83` uses `sockets` / `socket_ips` for per-role connected state and IP.

### 1.4 `class_id`

`class_id` is *not* used by the webapp for any UI decision. It exists on `Device`
(`shared-types/index.d.ts:162`) and drives firmware rollout only (`DeviceClass.firmware_id` /
`beta_firmware_id` / `alpha_firmware_id`, `server/src/models/deviceclass.model.ts`,
`device.service.ts:findUpgradeableDevices`). The webapp only lists classes on the admin `/classes` page.

---

## 2. What a `controller` actually has: sensors and outputs

### 2.1 Firmware (ground truth) — `firmware/src_hwtype/controller/controller.{h,cpp}`

Status document built at `controller.cpp:963-996`:

```
status["sensors"]["temperature"]      = state.temperature;         // °C  (SHT21 or SCD4x or slave/plug)
status["sensors"]["humidity"]         = state.humidity;            // % rH
status["sensors"]["sensor_type"]      = state.sensor_type;         // 0=none 1=SHT 2=SCD 3=slave (enum, not a unit)
status["sensors"]["co2"]              = hasCo2Sensor() ? state.co2 : -1;   // ppm ( -1 == no sensor )
status["sensors"]["leaf_temperature"] = mlx90632_object_temperature;       // °C, only if MLX90632 found
status["sensors"]["lux"]              = veml7700_lux;                      // lux, only if VEML7700 found
status["outputs"]["dehumidifier"]     = state.out_dehumidifier;    // 0/1
status["outputs"]["heater"]           = state.out_heater;          // 0..1 PID duty (charted ×100 for alarms)
status["outputs"]["light"]            = state.out_light;           // 0..100 %
status["outputs"]["co2"]              = hasCo2Sensor() ? state.out_co2 : -1;  // accumulated open ticks per report
```

Sensor detection: `SENSOR_TYPE_NONE=0, SHT=1, SCD=2, SLAVE=3` (`controller.h:74-77`);
`hasCo2Sensor()` is `sensor_type == SENSOR_TYPE_SCD` (`controller.cpp:766-768`). If no sensor was ever
detected the controller enters failsafe and zeroes every output (`controller.cpp:805-813`).

**Physical outputs:** exactly one — `PwmOutput out_light` on `PIN_LIGHT = 21` (`controller.h:64,103`).
Everything else is actuated through **smart sockets over HTTP (Tasmota)**:
`controller.cpp:882-888` builds `SmartSocketOutputStates{dehumidifier_on, heater_on, light_on,
secondary_light_on, co2_on}` and calls `wifiReportSmartSocketOutputs()`.
Roles list: `firmware/src/wifi.cpp:1694-1704` → `back` (menu sentinel), `dehumidifier`, `heater`, `light`,
`secondary_light`, `co2`. Per-role Tasmota `PulseTime` watchdogs at `wifi.cpp:412-419`
(heater 300 s, dehumidifier 600 s, co2 120 s, light/secondary_light 1800 s).
The CO2 valve is a 2 s pulse every 120 s while `co2_avg < target` and it is day
(`controller.cpp:212-258`, `CO2_INJECT_PERIOD=120s`, `CO2_INJECT_DURATION=2s`,
`CO2_OVERSWING_ABORT=300 ppm`).

Control laws:
- Heater: PID (`HEATER_PID_P=0.5, I=0.001, D=100`, `controller.h:87-89`), separate day/night PID instances,
  output 0..1 (`controller.cpp:410-421`).
- Dehumidifier: hysteresis on `humidity_avg` (short 100-sample / long 240-sample avg selectable), gated by a
  temperature override (`temp_limit = target_temp - 1`), `maxDehumidifySeconds` cap and
  `minimalDehumidifierOffTime` anti-short-cycle (`controller.cpp:325-375`).
- "Cooling" in `temp`/`breed` mode reuses the **same `out_dehumidifier` output** as a cooler
  (`controller.cpp:378-408`) — i.e. one socket is dehumidifier *and* cooler depending on mode.
- Light: dims down as temperature exceeds `day.temperature + 1 °C`, floor `LIGHT_MIN_DIM=15 %`, off above
  `+6 °C`; sunrise/sunset linear ramps; capped by `lights.limit` (`controller.cpp:260-323`).

### 2.2 Server storage of measures

`server/src/services/data.service.ts:36-52`: each `sensors.<k>` becomes an Influx field `<k>`, each
`outputs.<k>` becomes `out_<k>`. `VALID_SENSORS` (`data.service.ts:12`) =
`['temperature','humidity','avg','p','i','d','co2','rpm','day','sensor_type','leaf_temperature','lux']`.
Two measures are **derived server-side, not stored**:
- `vpd` — computed from temperature + humidity + `cloudSettings.vpdLeafTempOffsetDay/Night`, day/night
  split via the `out_light` series (`data.service.ts:66-152`); `vpd_day` / `vpd_night` variants.
- `ppfd` = `lux × (cloudSettings.ppfdLuxFactor ?? 0.015)` (`data.service.ts:70,155-159,208-214`).

### 2.3 Full controller measure list as the UI sees it

From `webapp/src/app/device/charts/charts.page.ts:118-150`, entries whose `types` include `'controller'`:

| name | title | unit | notes |
| --- | --- | --- | --- |
| `temperature` | Temperature | °C | default enabled |
| `humidity` | Humidity | % | |
| `vpd` | VPD | kPa | derived |
| `co2` | CO2 | ppm | |
| `leaf_temperature` | Leaf Temperature | °C | **controller-only** |
| `ppfd` | PPFD | µmol/m²/s | **controller-only**, derived from `lux` |
| `out_heater` | Heater | (none) | 0..1 |
| `out_dehumidifier` | Dehumidifier | (none) | 0/1 |
| `out_co2` | CO2 Valve | ` ticks` | aggregated with `method: 'sum'` |
| `out_light` | Lights | (none) | 0..100 |

Not available on controller: `out_fan`, `out_fan-internal/-external/-backwall`, `day`, `rpm`.
`lux` and `sensor_type` are stored but **have no chart entry** — `lux` is only visible indirectly as PPFD.

Overview tiles (`devices/fridge/overview/overview.component.html`):
value gauges for `temperature` (0-50 °C), `humidity` (0-100 %), `vpd` (0-2 kPa), `co2` (0-5000 ppm,
conditional), `leaf_temperature` (0-50 °C, conditional), `ppfd` (0-2000, conditional), plus a webcam still.
Output tiles: `out_heater` (shown as %), `out_dehumidifier` (on/off), `out_co2` (on/off, conditional),
`out_light` (%).

`is_day` in the UI is inferred purely from `out_light >= 0.5` (`overview.component.ts:121-127`) — **not** from
the configured photoperiod.

### 2.4 Test mode

`webapp/src/app/device/testmode/testmode.page.ts:18-26` posts
`{heater, dehumidifier, co2, lights, fanint, fanext, fanbw}` to `POST /device/test/:device_id`
every 5 s. It is admin-only and only offered when `workmode === 'off'` and the device is online
(`overview.component.html:230`). The three fan fields are meaningless on a controller.

---

## 3. Settings: what a user can change, and the `device.configuration` schema

`Device.configuration` is a **JSON string** (`shared-types/index.d.ts:164`; mongoose `String`,
`server/src/models/device.model.ts:34-37`). The server **never validates or normalises it** — it stores the
string and republishes it to `/devices/<id>/configuration` (`device.service.ts:1140-1162`). The only
server-side processing is a flat key diff for the log message (`diffConfigs`, `device.service.ts:1164-1195`).
The device echoes its own config back on `/devices/<id>/configuration` and the server overwrites the string
(`settingsMessage`, `device.service.ts:817-819`).

### 3.1 Canonical shape (what the webapp writes)

From `configuration.component.ts:177-225` (`onSettingsChanged`) — this is the authoritative producer:

```jsonc
{
  "workmode": "off" | "breed" | "temp" | "small" | "full" | "dry" | "exp",
  "daynight": {
    "day": 21600,                      // seconds-of-day UTC, daybreak
    "night": 79200,                    // seconds-of-day UTC, nightfall
    "floating": false,                 // beta only
    "float_start": 1690000000,         // epoch seconds, beta only
    "day_duration": 86400,             // seconds, beta only
    "light_duration": 43200,           // seconds, beta only
    "maxDehumidifySeconds": 0,         // 0 == forever; UI 30..2400 (beta 0..7200)
    "targetHumidityDiff": 5,           // -10..+10 %, hysteresis above target
    "useLongHumidityAvg": false,       // 240 vs 100 sample average
    "linearChange": false,             // linear day/night transition
    "minimalDehumidifierOffTime": 240  // s, UI 240..900 (beta 0..3600)
  },
  "co2":   { "target": 400, "sunsetOff": false },       // ppm, UI 100..10000 step 100
  "day":   { "temperature": 25, "humidity": 60 },        // °C 5..40, % 10..90
  "night": { "temperature": 25, "humidity": 60 },
  "lights":{ "sunrise": 0, "sunset": 0,                  // minutes 0..60 ramp
             "limit": 100,                               // % 0..100
             "maintenanceOn": false },
  "fans":  { "external": 100, "internal": 100 }          // %, hidden for controller
}
```

Defaults are applied on load in `configuration.component.ts:116-152`. They disagree with the other two
default sources: the expert form falls back to `daynight.day = 36000` (10:00 UTC), while
`applyStagePreset` uses `6*3600 = 21600` (`grow-presets.ts:221`) and the controller firmware defaults to
`21600` (`controller.h:27`). Simple mode's `lightStart` getter also assumes `21600`
(`simple-settings.component.ts:206`).
Limits/hysteresis constants: `configuration.component.ts:73-95`.
Simple mode's narrower limits: `simple-settings.component.ts:42-46`
(temperature 5-40, humidity 10-90, **co2 100-2000**).

### 3.2 What the controller firmware actually reads

`firmware/src_hwtype/controller/controller.cpp:455-514` (`loadSettings`) reads **only**:

`workmode` (with `full` → `small` remap, :472-474), `daynight.day`, `daynight.night`,
`daynight.maxDehumidifySeconds`, `daynight.targetHumidityDiff`, `daynight.useLongHumidityAvg`,
`daynight.minimalDehumidifierOffTime`, `co2.target`, `day.temperature`, `day.humidity`,
`night.temperature`, `night.humidity`, `lights.sunrise`, `lights.sunset`, `lights.limit`.

**Silently ignored by the controller but offered in the UI:**

| Setting | UI location | Controller |
| --- | --- | --- |
| `lights.maintenanceOn` | `configuration.component.html:169-172` (always shown, incl. controller) | **not loaded** from cloud config (`loadSettings` has no entry) although the loop uses it (`controller.cpp:877`) — it can only be set on the device's own HMI |
| `co2.sunsetOff` | `configuration.component.html:132-135` | not loaded (fridge does, `fridge.cpp:494`) |
| `daynight.linearChange` | `configuration.component.html:155-158` | not loaded (fridge does, `fridge.cpp:491`) |
| `daynight.floating` / `float_start` / `day_duration` / `light_duration` | beta-gated rows `configuration.component.html:14-48` | **no firmware anywhere reads these** — grep over `firmware/` finds zero hits. Pure cloud fiction today (only referenced in `device.service.ts:1189` diff filtering) |
| `fans.*` | hidden for controller | n/a |

`saveAndUploadSettings()` (`controller.cpp:516-543`) re-serialises **only the keys it knows** — this is why
`grow-presets.ts:33-36` warns that the firmware strips unknown keys and why no preset id is ever stored in
the configuration.

### 3.3 Workmodes and what they gate

`configuration.component.ts:154-161` builds the dropdown: `breed`, `temp`, `small`, `full`, `dry`, `off`
(with `full` filtered out for controllers). `exp` is handled by `parseWorkmode`/`changeWorkmode` but **cannot
be selected** — legacy only.

| workmode | daycycle | humidity | co2 | controller firmware behaviour (`controller.cpp:815-875`) |
| --- | --- | --- | --- | --- |
| `small` | ✅ | ✅ | ✅ | light + dehumidify + heater (+ CO2 if SCD) |
| `temp` | ✅ | ❌ | ✅ | light + cooling (via dehumidifier socket) + heater (+ CO2) |
| `dry` | ❌ | ✅ | ❌ | dehumidify + heater, light forced off |
| `breed` | ❌ | ❌ | ❌ | heater + cooling, light off |
| `off` | ❌ | ❌ | ❌ | everything off |
| `full` | — | — | — | remapped to `small` in firmware and UI |
| `exp` | ✅ | ✅ | ✅ | not handled in `loop()` → falls into the `else` = OFF |

Gating tables live in three places that must agree:
`configuration.component.ts:40-70` (`changeWorkmode`), `settings.component.ts:455-470` (`parseWorkmode`),
`simple-settings.component.ts:85-98` (`hasDaycycle`/`hasHumidity`/`hasCo2`),
plus a fourth partial copy at `grow-assistant-card.component.ts:155,194`. **Four duplicated truth tables.**

### 3.4 Cloud-only settings (`CloudSettings`)

`shared-types/index.d.ts:42-57`, mongoose `device.model.ts:102-119`, endpoints
`GET /device/cloudsettings/:device_id`, `POST /device/cloudsettings`.
Fields: `firmwareChannel` (`stable|beta|alpha|manual`), `pendingFirmware`, `vpdLeafTempOffsetDay/Night`,
`ppfdLuxFactor`, `betaFeatures`, `rtspStream`, `rtspStreamTransport`, `logRtspStreamErrors`,
`tunnelRtspStream`, `maintenanceWebcamOff`, `webcamModel`, deprecated `autoFirmwareUpdate`.
UI: `webapp/src/app/device/cloudsettings/cloud-settings.component.html` (expert only) and
`webapp/src/app/components/aux-devices/webcam-config.component.*`.

Note: an earlier `cloudSettings.controlProfile` (`full|light_only|monitor`) mentioned in commit `9bc906a`
has been **removed**; it is now derived from hardware (`deviceControlCapability`). Zero hits in the tree.

---

## 4. How a user expresses a GOAL today, and where setpoints live

There is exactly **one** notion of a goal: a climate setpoint pair per day/night phase, stored in
`device.configuration`.

- **Temperature target**: `configuration.day.temperature` / `configuration.night.temperature` (°C).
- **Humidity target**: `configuration.day.humidity` / `configuration.night.humidity` (%).
  Dehumidification only starts at `target + daynight.targetHumidityDiff` (default +5 %).
- **CO2 target**: `configuration.co2.target` (ppm), day only.
- **Photoperiod**: `configuration.daynight.day` / `.night` as seconds-of-day **in UTC**; the webapp converts
  with `new Date().getTimezoneOffset()*60` (`configuration.component.ts:107,227-249`;
  `simple-settings.component.ts:48,204-253`).
- **Light intensity**: `configuration.lights.limit` (%).
- **VPD is never a target.** It is only ever *displayed*: computed in
  `webapp/src/app/util/calculateVpd.ts` (Tetens, leaf-temp corrected) and shown as a preview under the
  humidity row (`configuration.component.html:85-91,113-119`, `simple-settings.component.html:214,234`),
  as a gauge on the overview, as a chart series, and as an advisory range in the stage picker
  (`GrowStagePreset.vpdRange`). Nothing regulates to it.

Entry points where a user sets goals:

1. **Stage preset tiles** (simple mode / wizard) → `applyStagePreset()`
   (`webapp/src/app/util/grow-presets.ts:192-235`). Writes `workmode`, `day/night.temperature`,
   `day/night.humidity`, `daynight.night` (keeping the user's `daynight.day`), `lights.sunrise=15`,
   `lights.sunset=15`, `lights.limit`, `co2.target`. Deliberately does **not** touch heater/fan/dehumidify
   tuning.
2. **Simple-mode value rows** (`<value-edit-row>`), writing straight into `target` — which is
   `activeStep.settings` when a plan runs, else `deviceSettings`
   (`simple-settings.component.ts:58-61`).
3. **Expert form** (`fridge-settings-config`), full schema.
4. **Recipe steps**, each carrying a whole settings object.
5. **Setup wizard** finish (`setup-wizard.component.ts:219-288`).

Persist path: `DeviceService.setSettings()` (`webapp/src/app/services/devices.service.ts:289-293`)
→ `POST /device/configure` → `configureDevice()` → Mongo + MQTT publish. A `settingsChanged` Subject
notifies the overview so target gauges update immediately (`overview.component.ts:153-158`).

`detectActiveStagePreset()` (`grow-presets.ts:242-285`) reverse-maps stored values back to a preset id with
tolerances (±0.5 °C, ±2 %, ±5 % light limit, ±60 s photoperiod); mismatch → `'custom'`, `workmode:'off'` →
`'off'`. CO2 and dim ramps are excluded from the comparison on purpose.

---

## 5. The Recipe / RecipeTemplate system, end to end

### 5.1 Data model

`shared-types/index.d.ts:131-154`:

```ts
type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
interface RecipeStep {
  name?: string;
  settings: any;                 // in transit: a JSON *string*; in the webapp editor: parsed object
  durationUnit: DurationUnit;
  duration: number;
  waitForConfirmation: boolean;
  confirmationMessage?: string;
  lastTimeApplied?: number;
  notified?: boolean;
  stage?: DiaryLifecycleStage;   // 'germination'|'seedling'|'vegetative'|'flowering'|'drying'|'curing'
}
interface Recipe {
  steps: RecipeStep[];
  activeStepIndex: number;
  activeSince: number;           // epoch ms; 0 == not running
  loop?: boolean;
  notifications?: 'off' | 'onStep' | 'onConfirmation';
  additionalInfo?: boolean;      // write diary/log messages on transitions
  email?: string;
}
```

Stored embedded on the device (`server/src/models/device.model.ts:124-150`).
`RecipeTemplate` (`shared-types/index.d.ts:257-267`, `server/src/models/recipe.model.ts`) is a named,
optionally `public` list of steps in its own collection — no `activeStepIndex`/`activeSince`.

### 5.2 API

- `GET /device/recipe/:device_id` (`device.route.ts:400`) → the recipe or `{steps:[],activeStepIndex:0,activeSince:0}`
- `POST /device/recipe` (`device.route.ts:431`) — body `{device_id, recipe}`. Resets `lastTimeApplied=0` on
  every step, clears `notified`, logs `message-recipe-step-manually-activated`, and calls
  `logStageTransitionIfChanged()` when the active step changed and carries a `stage`
  (`device.controller.ts:557-620`).
- `GET/POST /device/recipes`, `GET/PUT/DELETE /device/recipes/:template_id` — templates
  (`device.route.ts:452,486,511,551,576`).

### 5.3 The engine

`server/src/services/device.service.ts:396-550`, ticked every **20 s**
(`device.service.ts:110-112`).

1. `deviceModel.find({'recipe.activeSince': {$gt: 0}})`.
2. `stepDurationMs = duration × 60000 × unitFactor` (weeks 10080, days 1440, hours 60, else 1 →
   **an unknown/missing `durationUnit` means minutes**).
3. `remaining <= 0`:
   - `waitForConfirmation` → send one e-mail + one log entry (`message-recipe-step-awaiting-confirmation`),
     set `notified`, and **wait forever** for the user.
   - else advance `activeStepIndex`, reset `activeSince = now`; at the end either `loop` back to 0 or stop
     (`activeSince = 0`). Each transition logs `message-recipe-advanced` / `-looped` / `-completed` and, when
     the new step has a `stage`, `logStageTransitionIfChanged()` writes a diary lifecycle entry.
4. **Applying settings** (`device.service.ts:524-531`): if `lastTimeApplied` is unset or older than **1 hour**
   *and* the device was seen in the last **60 s**, publish `activeStep.settings` to
   `/devices/<id>/configuration` and call `configureDevice()`.

Important consequences:
- The engine only pushes settings to an **online** device (`device.lastseen >= now - 60s`). The webapp warns
  about this (`devices.fridge.recipe.warning`, `devices.fridge.manualModeOfflineWarning`).
- Re-application happens at most hourly, so a manual override on the device survives up to an hour.
- Confirmation gates are the only user-in-the-loop mechanism; they block indefinitely.

### 5.4 Building plans in the UI

`GROW_PLAN_TEMPLATES` (`grow-presets.ts:304-360`):

| plan | steps (preset, days, confirm) |
| --- | --- |
| `photoperiod` | seedling 14 → vegetative 28 ✋(start flowering) → flowering 42 → late_flowering 21 ✋(harvest) → drying 10 ✋(drying done) |
| `autoflower` | seedling 10 → vegetative 18 → flowering 28 (light 18 h) → late_flowering 14 (18 h) ✋ → drying 10 ✋ |

`buildRecipeFromTemplate()` (`grow-presets.ts:368-401`) produces `notifications:'onStep'`,
`additionalInfo:true`, `email = current user's username`, `activeStepIndex = 0`, `activeSince = 0`; the
wizard then sets `activeStepIndex = planStartIndex` and `activeSince = Date.now()`
(`setup-wizard.component.ts:257-268`) and **also pushes the active step's settings immediately** so an
offline device is not left waiting for the server tick.

Expert recipe editor: `devices/fridge/settings/settings.component.html:83-266` — add/remove/move/duplicate
steps, per-step full settings form, template load (append/replace) & save (private/public)
(`settings.component.ts:284-333,526-677`).

Simple mode surface: `simple-settings.component.html:9-70` — stage title + "Day X of Y" progress bar,
editable duration pill for the current and upcoming steps, confirmation banner, "End stage now" (skip),
"Stop plan", "Switch device off". Skipping/stopping is implemented in the parent
(`settings.component.ts:112-190`).

### 5.5 Could Recipes drive a feeding schedule?

**Partially, and badly.**

What works today:
- Time-based phases with arbitrary durations (minutes → weeks) and a `loop` flag.
- `waitForConfirmation` + `confirmationMessage` gives "do this now, then confirm" — a usable nag mechanism.
- `notifications: 'onStep'` sends e-mail; `additionalInfo: true` writes a device-log entry that shows up in
  the diary/log viewer.

What blocks it:
- `RecipeStep.settings` is applied verbatim as the *whole device configuration*. There is no notion of a
  step that carries a task/payload but no climate change — a "feed today" step would have to duplicate the
  climate settings, and the engine would re-push them (`configureDevice`) causing a config-diff log entry
  and an MQTT publish.
- Exactly **one** recipe per device (embedded singleton `device.recipe`), so a feeding schedule cannot run in
  parallel with the climate grow plan.
- Steps are strictly sequential with a single cursor; a repeating "every 3 days" cadence would need `loop`
  on a dedicated recipe, which the single-recipe slot forbids.
- No task/ack model: `waitForConfirmation` **halts the whole plan** until confirmed; a missed feeding would
  freeze the climate stage.
- No structured payload: nutrient product, dose, EC/pH targets have nowhere to live on a step. The nearest
  structure is `DiaryEntryData` (`shared-types/index.d.ts:109-120`: `tdsMeasurement`, `ecMeasurement`,
  `phMeasurement`, `lightMeasurement`, `distanceMeasurement`, `outsideTemperatureMeasurement`,
  `co2FillingRest/Initial`, `newLifecycleStage`, `lifecycleName`) — but that is a **manual diary entry**
  (`diary-entry-modal.component.ts:8-56`, categories `diary-co2-refill`, `diary-plant-log`,
  `diary-fridge-log`, `diary-measurement`, `diary-plant-lifecycle`), not a schedule.
- Notifications are e-mail-only from the recipe engine (`device.service.ts:537-548`); there is no push, and
  the richer webhook targets (`webapp/src/app/util/webhook-targets.ts` — Discord, Telegram, ntfy,
  Home Assistant) are wired to **alarms only**, not to recipes.

Verdict: the recipe engine is a decent *state machine skeleton* (durations, confirmations, diary hooks,
templates) but would need (a) multiple concurrent recipes or a separate task-schedule entity, (b) a step
kind that does not overwrite `configuration`, and (c) a structured payload + ack model to become a feeding
schedule.

---

## 6. "Simple mode" vs expert — what it is and how complete

Introduced in `9bc906a` ("Webapp UX overhaul…"), completed in `c29c821` ("Round out the simple mode…").
Documented (in German) at `docs/einfach-modus.md` — 106 lines, includes the state machine and the preset
value rationale. Worth reading before designing anything.

**Mechanics.** A segmented control at the top of the fridge/controller settings page
(`devices/fridge/settings/settings.component.html:20-29`) toggles `uiMode: 'simple' | 'expert'`, persisted in
`localStorage` under `EXPERT_MODE_STORAGE_KEY = 'app-settings-expert'`
(`webapp/src/app/util/ui-mode.ts:6`; `settings.component.ts:34,108-110`). **Simple is the default.** The
setup wizard forces the user back into simple mode on finish (`setup-wizard.component.ts:274`).

**Simple mode = 4 cards** (`fridge-simple-settings` + `simple-alarms-card`):
1. Reference banner (monitor / light-only controllers).
2. Running plan card *or* stage-preset picker + "Start a grow plan".
3. Maintenance mode ("stepping into the tent").
4. Targets: light on-time & hours & intensity, day targets, night targets, CO2 — each a `<value-edit-row>`
   (label + value pill that expands into a slider + steppers, `value-edit-row.component.ts`), with VPD
   previews and help popovers.
5. Notifications card: alarm list from presets, add via the shared `<alarm-add-modal>`.

**Expert mode adds:** settings-mode select (manual vs recipe), the full recipe editor with templates, the
full `fridge-settings-config` form, `<aux-devices>` (webcam + smart sockets), `<cloud-settings>`, and the
full `<alarms>` editor.

**How complete is it?** By the doc's own table it covers everyday operation. Gaps and rough edges found in
code:

- **Save is a full-page action.** `saveSettings()` (`settings.component.ts:235-272`) always writes settings,
  recipe, alarms **and** cloud settings, then `navigateByUrl('/list')`. There is no per-card save, no dirty
  state, no undo. Several simple-mode actions only mutate local state and rely on a toast
  ("Remember to save your changes!", `settings.component.ts:335-342`, English-only, not translated).
- `<value-edit-row>` in simple mode is bound with `[(value)]` but **without** `(changed)`
  (`simple-settings.component.html:188-193,201-206,208-213,221-226,228-233,246-251`), so
  `deviceSettingsChange` never fires for those edits — it works only because the same object is mutated by
  reference. Fragile.
- Simple mode caps CO2 at 2000 ppm while expert allows 10000 (`simple-settings.component.ts:45` vs
  `configuration.component.ts:76`).
- Simple mode has no way to reach `breed`/`temp` workmodes — presets only produce `small` and `dry`.
- The floating-day mode is only *acknowledged* in simple mode (`simpleSettings.light.floatingNote`), and as
  established in §3.2 no firmware implements it at all.
- Duration editing in the running plan only allows shortening down to the unit currently in progress
  (`activeStepMinDuration`, `simple-settings.component.ts:142-148`).
- Simple mode is only reachable for `fridge`/`fridge2`/`controller`. `plug`, `fan`, `light`, `dryer` have
  their own bespoke settings pages with no simple/expert split at all.

---

## 7. Where user types 3/4/5 hit a wall

**Type 3 — partial control (some sockets, e.g. light + heater only).**
- `deviceControlCapability()` collapses reality into three buckets. Having a `heater` socket but no
  `dehumidifier` already returns `'full'` (`grow-presets.ts:166-168`), so the UI promises humidity control
  the tent cannot deliver: the humidity target row, the humidity deviation warning in the grow assistant,
  and the "Dehumidifier running non-stop" alarm preset all appear.
- The dashboard shows an `out_dehumidifier` and `out_co2` tile regardless of whether those sockets exist
  (`overview.component.html:170-195`; only `out_co2` is gated, and only by the CO2 *sensor*, not the socket).
- Nothing tells the user *which* of their targets is actually actionable. There is no per-role capability
  display outside the wizard's `connections` step, which is a one-time screen.
- Alarm presets are not capability-filtered — only `requiresCo2` exists (`alarm-presets.ts:113-115`).

**Type 4 — full tent (everything on sockets, plus fans / humidifier / AC).**
- **Only 5 socket roles exist**: `dehumidifier`, `heater`, `light`, `secondary_light`, `co2`
  (`firmware/src/wifi.cpp:1694-1704`; mirrored in `webapp/src/app/util/socket-info.ts:7` and whitelisted at
  `server/src/services/device.service.ts:859`). There is **no humidifier, no exhaust fan, no circulation
  fan, no AC/chiller, no pump/irrigation role**. A full tent has nothing to bind those to.
- `dehumidifier` doubles as the cooler in `temp`/`breed` modes (`controller.cpp:378-408`) — one socket, two
  semantics, one chart series, one alarm sensor type. Users cannot tell heat-removal from
  moisture-removal in the data.
- The fan settings (`fans.external`, `fans.internal`) are hidden for controllers and unread by the firmware,
  so the classic "increase exhaust to drop humidity" lever does not exist.
- Humidity can only ever go **down**. There is no humidification path at all.
- Workmodes are mutually exclusive: `temp` gives you cooling but drops humidity control; `small` gives you
  humidity but the same socket becomes a dehumidifier. There is no "cool AND dehumidify" configuration.
- Only **one** webcam per device (`auxDevices.webcam.pickModel` copy: "one webcam per device";
  `cloudSettings.rtspStream` is a single string).

**Type 5 — closed-loop DIY (own sensors/actuators, wants to script it).**
- No public write API for outputs. `POST /device/test/:device_id` exists but is the admin test-mode harness,
  fixed to `{heater, dehumidifier, co2, lights, fanint, fanext, fanbw}`, requires `workmode === 'off'` in the
  UI, and is polled every 5 s with an auto-stop on page leave.
- No MQTT access for users: `/devices/#` is server-internal; device credentials are hashed
  (`server/src/utils/devicepassword.ts`) and MQTT auth goes through `server/src/controllers/mqttauth.controller.ts`.
- No user-defined measures. `VALID_SENSORS` is a hard-coded list (`data.service.ts:12`) and the chart measure
  catalogue is a literal array in a component (`charts.page.ts:118-150`). Bringing an EC/pH/soil-moisture
  probe in is impossible except as a **manual diary entry**.
- Outbound automation exists only as alarm webhooks (`webapp/src/app/util/webhook-targets.ts`, 177 lines:
  Discord, Telegram, ntfy, Home Assistant, generic webhook, optional tunnelling through the device) — one
  webhook per alarm, threshold-triggered, no inbound counterpart.
- Configuration is an opaque unvalidated JSON string, but any key the firmware does not know is dropped the
  moment the device re-serialises its config (`controller.cpp:516-543`), so "stash my own fields in there"
  is not reliable.
- `Recipe` is a singleton per device; no way to run a user script or a second schedule.
- Everything is gated on the cloud: the recipe engine only advances server-side, and only pushes to devices
  seen in the last 60 s.

**Cross-cutting walls for all three:**
- No goal beyond a temp/RH/CO2 setpoint pair. VPD, which is what every serious grower actually steers by, is
  display-only everywhere.
- No per-output manual override in normal operation ("run the dehumidifier for 20 minutes now").
- No scheduling primitive other than the day/night photoperiod and the sequential recipe.
- Saving anything re-writes the whole device configuration and navigates away to `/list`.

---

## 8. Quick file index

| Concern | Path |
| --- | --- |
| Type→component dispatch | `webapp/src/app/device/list/list.page.html:77-131`, `webapp/src/app/device/settings/settings.page.html:10-18` |
| Controller dashboard | `webapp/src/app/devices/fridge/overview/overview.component.{ts,html}` |
| Settings shell (simple/expert switch, recipe editor, save) | `webapp/src/app/devices/fridge/settings/settings.component.{ts,html}` (728/324 lines) |
| Expert settings form | `webapp/src/app/devices/fridge/settings/configuration/configuration.component.{ts,html}` |
| Simple settings | `webapp/src/app/devices/fridge/settings/simple/simple-settings.component.{ts,html}` |
| Simple alarms | `webapp/src/app/devices/fridge/settings/simple/simple-alarms-card.component.{ts,html}` |
| Stage presets, plan templates, capability detection | `webapp/src/app/util/grow-presets.ts` (401 lines) |
| Socket csv parsing | `webapp/src/app/util/socket-info.ts` |
| Alarm presets | `webapp/src/app/util/alarm-presets.ts` |
| Curated chart views | `webapp/src/app/util/chart-presets.ts` |
| Webcam brand templates | `webapp/src/app/util/webcam-models.ts` |
| Webhook/notification targets | `webapp/src/app/util/webhook-targets.ts` |
| VPD | `webapp/src/app/util/calculateVpd.ts`, `server/src/utils/calculateVpd.ts` |
| Simple/expert flag | `webapp/src/app/util/ui-mode.ts` |
| Setup wizard | `webapp/src/app/components/setup-wizard/setup-wizard.component.{ts,html}` |
| Grow assistant strip | `webapp/src/app/components/grow-assistant/grow-assistant-card.component.{ts,html}` |
| Stage picker | `webapp/src/app/components/stage-preset-picker/stage-preset-picker.component.{ts,html}` |
| Numeric edit row | `webapp/src/app/components/value-edit-row/value-edit-row.component.{ts,html}` |
| Gauge tile | `webapp/src/app/components/valuedisplay/valuedisplay.component.{ts,html}` (266 lines) |
| Output tile (**dead code**) | `webapp/src/app/components/outputdisplay/outputdisplay.component.{ts,html}` — `OutputdisplayComponent` is **not declared in `components.module.ts`** and `<app-outputdisplay>` appears in no template; its HTML also references `onicon`/`officon`/`name`, which the class never declares (`outputdisplay.component.ts:10-11` has only `measurement`/`unit`). The overview inlines its own output tiles instead (`overview.component.html:156-210`) |
| Aux hardware (webcam + sockets) | `webapp/src/app/components/aux-devices/*` |
| API client | `webapp/src/app/services/devices.service.ts` |
| Charts (measure catalogue) | `webapp/src/app/device/charts/charts.page.ts:118-150` |
| Recipe engine | `server/src/services/device.service.ts:396-550` |
| Config write + diff | `server/src/services/device.service.ts:1140-1195` |
| hardware-info ingestion | `server/src/services/device.service.ts:592-611` |
| Measure storage | `server/src/services/data.service.ts` |
| Device schema | `server/src/models/device.model.ts`, `server/src/models/recipe.model.ts` |
| Shared types | `shared-types/index.d.ts` (278 lines) |
| Controller firmware | `firmware/src_hwtype/controller/controller.{h,cpp}` (187 / 1215 lines) |
| Smart socket driver + roles | `firmware/src/wifi.cpp:190-520, 1670-1760` |
| Simple-mode design doc (German) | `docs/einfach-modus.md` |
| Device simulator profiles | `scripts/simulate-device.mjs:193-215` |
