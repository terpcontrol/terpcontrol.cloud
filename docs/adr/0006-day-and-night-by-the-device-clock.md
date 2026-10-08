---
summary: Why the cloud, the app and the simulator decide day and night exactly as the firmware does - by the device's clock window and work mode, never by the lamp - through one shared module, and how a switch between the halves is judged - read before touching day-night.ts, setpoints, the climate verdict, night bands or how a light window is written
updated: 2026-10-08
source: rewrite commits of 2026-10-01 to 10-03 merged with PR #104; checked against shared-types/, server/ and scripts/simulate-device.mjs on 2026-10-08; codebase cleanup (2026-10-08)
paths:
  - shared-types/src/v1/day-night.ts
  - server/src/modules/v1/device/setpoints.ts
  - server/src/modules/v1/device/held-targets.ts
  - server/src/modules/v1/overview/climate-verdict.ts
  - firmware/src_hwtype/fridge/fridge.cpp
  - firmware/src_hwtype/controller/controller.cpp
---
# ADR 0006: Day and night are the device's clock, not the lamp

- **Status:** accepted on 2026-10-03; built and merged with #104 on 2026-10-04.
- **Date:** 2026-10-03
- **Touches:** `shared-types/src/v1/day-night.ts`, `server/` (setpoints, verdict, Timeline, diary), `webapp/`,
  `scripts/simulate-device.mjs`
- **Builds on:** [ADR 0001](0001-app-rewrite-data-model.md) (the target record, the work mode) and
  [ADR 0005](0005-device-times-on-the-wall-clock.md) (the times on the wall clock).

## Context

A fridge and a tent controller decide day and night by their clock alone. Between the two times of their
document, seconds past midnight UTC, it is day, otherwise night; drying, germination and switched off have no day
at all. Whether the lamp really shines changes nothing about which targets hold.

The cloud read it off the lamp instead: light output above zero was day. A lamp held off at noon, set to 0 %,
dimmed by the heat or at 15 % in maintenance turned the cockpit's day into night while the fridge went on heating
to its day target - "night target 22 °C, 3.9 °C too high", and CO2 "no target at night" while the valve dosed -
and the same wrong half went into the verdict, the status line's "since", the Timeline's night bands and the
diary's day and night averages. And every evening read "too warm since 20:02" and every morning "too cold since
08:02", because the band jumped to the other half at once while a fridge needs about forty minutes to follow and
glides its targets along the dimming ramps besides.

## Decision

- **One arithmetic, the firmware's.** `shared-types/src/v1/day-night.ts` copies the firmware's expressions one for
  one: strict comparisons, windows that run past midnight UTC, the ramps worked out unsigned and without going round
  the clock, and the work modes that have no day. It has no schema and imports only the schema-free document reader
  (`configuration-fields.ts`), so the server, the app and the simulator all run the same code. It was checked against
  a harness compiled from the fridge's and the controller's own code on every second of the day for every window and
  ramp tried; that harness was a one-off, and `server/test/unit/day-night.spec.ts` and
  `server/test/specs/day-night.spec.ts` keep the cases.
- **Everything that names a half follows from it**: the live targets (`setpoints.active`, with `period`, `cycle`,
  `since`, `until` and `transition`), the cards, the climate verdict and its excursions, the night bands of the
  Timeline, a space and a grow, and the diary's day and night averages.
- **A switch is given time.** While a fridge glides and for an hour after any switch (`SETTLE_SECONDS`), a reading
  anywhere between the two halves' bands is on target: the card says so (`transition`), the verdict counts no
  excursion, the Timeline draws the span as a transition and CO2 is not judged. A reading outside both bands is
  still named.
- **The past is the schedule's too.** The target record keeps the cycle beside the targets (ADR 0001), so nights
  over the past are the schedule's from the moment it was recorded; where the record says nothing, the lamp shades
  them as before.
- **Every light window is written one way**, by one function, whether it comes from the targets, a preset, a plan
  step, a claim, a phase or the clock moving. 24 hours of light is a day that never ends - both times past any time
  of day, the night one second before the day - where it used to be a window one second short of a day, which left
  two seconds of night daily and a half-hour dip through both ramps. 0 hours is always night. A light going off at
  midnight UTC on the dot goes off a second earlier, because the firmware drops a ramp it finds running all day.
  None of this needed a firmware change.
- **An AIR fan is the exception**, because its firmware goes by its light sensor: it keeps doing so in the cloud
  (`cycle: 'sensor'`).

## Consequences

- A change to how the firmware decides day and night (`fridge.cpp`, `controller.cpp`) changes `day-night.ts` in
  the same pull request, or the cloud judges against a half the device does not hold.
- Migration 021 put the stored light windows into the one shape, turned the windows the old recipes copied into
  every plan step into light hours (ADR 0001), and gave every target record its current cycle.
- Saving the targets in a mode that leaves some of them alone keeps the stored ones: the day while drying or
  germinating, the humidities in the greenhouse mode, the night with 24 hours of light and the day with none.
