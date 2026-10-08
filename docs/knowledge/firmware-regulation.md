---
summary: Changing how a fridge or tent controller regulates, or explaining it in the app - day and night by UTC, the work modes, ramps, CO2 dosing, heat dimming of the lamp, the dehumidifier and cooling rules, and the quirks left as they are
updated: 2026-10-08
source: agent sessions 2026-10-01..04 that read fridge.cpp and controller.cpp for the app's help texts; Chris (2026-08-20, heater); checked against the code on 2026-10-08; Chris (second light, CO2 at night, 2026-09-28)
paths:
  - firmware/src_hwtype/fridge/**
  - firmware/src_hwtype/controller/**
---
# Firmware regulation: fridge and controller

How `firmware/src_hwtype/fridge/fridge.cpp` and `firmware/src_hwtype/controller/controller.cpp` turn the settings
document into outputs. Keys and defaults are in [device-protocol.md 7.1](../device-protocol.md#71-keys-per-hardware-type),
what each smart-socket role follows (humidifier, exhaust ...) in
[6.3](../device-protocol.md#63-the-socket-table-chunked-and-reassembled), the heater, the safety stops and the failsafe
in [firmware.md](firmware.md#safety-stops-and-failsafe).

A fridge drives its own pins: one compressor (the output the firmware calls the dehumidifier - it cools and dries;
the cabinet has no separate dehumidifier), heater, CO2 valve, lamp and three fans (clip `fan-external`, inner
`fan-internal`, back wall `fan-backwall`). A tent controller drives only its lamp and everything else through smart
sockets; it cannot cool by itself.

On a fridge the cloud writes some figures itself (`server/src/modules/device-protocol/class-rules.ts`):
`daynight.linearChange` 1, `co2.sunsetOff` 1, the dehumidifier tuning from the humidity target, and a compressor
rest of at least 240 s.

## Day and night

- Day and night come from the UTC clock alone; the window arithmetic, which modes have a day, and the windows the
  cloud rewrites because the ramps would misread them are in
  [device-protocol.md 7.3](../device-protocol.md#73-times-of-day).
- By day the day temperature and humidity hold, together with `co2.target` and `lights.limit`; by night the night
  values.
- The lamp can be dark inside the window without it becoming night: `lights.limit` 0, heat dimming, a light override
  from the cloud (it sets only the output), the maintenance light.

## Work modes

`MODE_*` in `fridge.h` and `controller.h`; `off` is the default, so a device nobody has set regulates nothing.

| Mode | What runs |
| --- | --- |
| `small`, `full` | Standard: lamp, CO2 by day, dehumidifying, heating. On a fridge `full` (energy saving) differs only in the back-wall fan while the compressor rests: off instead of 50 %; both run it at 100 % while the compressor runs. A controller reads `full` as `small` |
| `temp` | Greenhouse: lamp, CO2, heating; the compressor (controller: the dehumidifier output) only cools - on above target + 0.8 °C, off below target + 0.3 °C; humidity is not regulated. The app does not offer it on controllers, where those sockets would become the tent's cooling |
| `breed` | Germination: night temperature around the clock, dark, no CO2. A fridge heats, and cools with its compressor while a dehumidifier socket rests; a controller heats, and cools with the exhaust by the standard rule, its dehumidifier output off |
| `dry` | Drying: night temperature and humidity around the clock, dark, no CO2; dehumidifies and heats |
| `off`, unknown, `exp` | Nothing is regulated; outputs off (a fridge also stops its fans). A number such as `2` reads as unknown |

## Ramps and CO2

- `lights.sunrise` and `lights.sunset` are ramps in minutes inside the window (15 by default). A fridge glides its
  temperature and humidity targets through them when `daynight.linearChange > 0`; a controller switches at once.
- CO2 is dosed by day - and with `co2.night` at night too, for roots in deep water culture, which breathe round the
  clock (Chris, 2026-09-28) - while the mean of 20 readings is below `co2.target` and the device is not in
  maintenance, and stops above target + 300 ppm. Controller (only with its SCD sensor): the valve socket opens 2 s
  every 120 s. Fridge: a 0.2 s pulse every 120 s that doubles while CO2 stays low and halves once it is reached; with
  `co2.sunsetOff` no dosing during the evening ramp (a rule by day only: with `co2.night` dosing resumes at night). The reported `co2` output is valve-open time in ticks, not
  openings.

## Lamp

- Heat dimming: from the day target (on a fridge the gliding target) + 1 °C it dims linearly to 15 % at + 2 °C, holds
  15 %, and is off above + 7 °C. The output follows its target by 1 % of the gap per second.
- In maintenance the lamp is capped at 15 % by day; `lights.maintenanceOn` (read by the fridge only) holds it at 15 %
  whatever the time.
- A second light on a `secondary_light` socket (typically an under-canopy bar) is not a copy of the lamp (Chris,
  2026-09-28): it comes on in the middle of the sunrise ramp and goes off in the middle of the sunset ramp - a hard
  switch cannot follow a dimmed ramp, and following the lamp to the end kept it on through the whole sunset - and it
  stays off in maintenance, whatever the lamp does, so it does not dazzle whoever works under it. A light override
  holds it like the lamp. Controller: `state.light_ramp`; fridge: `sunrise_factor` / `sunset_factor`, each ≥ 0.5.

## Dehumidifier and cooling

- Dehumidifying (on a fridge the compressor) starts when the humidity is above target + `targetHumidityDiff`, and
  stops when the mean of 100 readings (240 with `useLongHumidityAvg > 0`) is below target, or after
  `maxDehumidifySeconds` (0 means no limit). It is held off once the air is more than 1 °C below the temperature
  target, until it is back above it, because the compressor cools as it dries.
- `minimalDehumidifierOffTime` is the least rest between runs, cooling included; it keeps the compressor from
  short-cycling. The firmware defaults to 240 s and clamps nothing; the cloud holds a fridge at 240 s or more
  (`MIN_COMPRESSOR_REST_SECONDS`).
- Cooling (`temp`, a fridge's `breed`): on above target + 0.8 °C, off below target + 0.3 °C, with the same rest; the
  back-wall fan runs at 100 %.

## Quirks

- Left in the firmware on purpose, and explained in the app (2026-10-03): the ramp arithmetic around 00:00 UTC
  ([device-protocol.md 7.3](../device-protocol.md#73-times-of-day)) - a controller's window across midnight UTC has
  no morning ramp, and an off time within one ramp length after 00:00 UTC or an on time within one ramp length
  before it cuts that ramp short - and an unknown work mode, or `exp`, regulating nothing.
- Found by reading the code on 2026-10-08, not decided yet: the dehumidifier's rest and its maximum run (when set)
  are measured in UTC seconds of the day, so both end early at 00:00 UTC.
