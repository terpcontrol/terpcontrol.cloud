---
summary: Why the cloud, the app and the simulator decide day and night exactly as the firmware does - by the device's clock window and work mode, never by the lamp - through one shared module, how a switch between the halves is judged, and how a plug without a lamp tells day from night for its VPD - read before touching day-night.ts, setpoints, the climate verdict, night bands, a VPD's leaf offset or how a light window is written
updated: 2026-10-08
source: rewrite commits of 2026-10-01 to 10-03 merged with PR #104; checked against shared-types/, server/ and scripts/simulate-device.mjs on 2026-10-08; codebase cleanup (2026-10-08); Chris (a plug's day for its VPD, 2026-10-08)
paths:
  - shared-types/src/v1/day-night.ts
  - server/src/modules/v1/device/setpoints.ts
  - server/src/modules/v1/device/held-targets.ts
  - server/src/modules/v1/overview/climate-verdict.ts
  - firmware/src_hwtype/fridge/fridge.cpp
  - firmware/src_hwtype/controller/controller.cpp
  - firmware/src_hwtype/plug/plug.cpp
  - server/src/modules/data/data.service.ts
  - server/src/modules/v1/camera/still-daylight.service.ts
---
# ADR 0006: Day and night are the device's clock, not the lamp

- **Status:** accepted on 2026-10-03; built and merged with #104 on 2026-10-04. Amended on 2026-10-08 (a device
  without a lamp, for its VPD).
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
- *Amended 2026-10-08 (Chris):* **a device without a lamp, for its VPD.** The cloud works a VPD out with the
  device's leaf offset for the half it is in (`vpdOf`, `modules/data/flux.ts`), and a controller's, a fridge's and a
  LIGHT's half is still read off their lamp. A stand-alone smart plug has no lamp and reports no day, so its VPD
  took the night's offset round the clock. Now, in this order:
  1. **Its own schedule**, where it runs one (`usedaynight`): day is its window exactly as `plug.cpp` decides
     `state.is_day` - the comparisons above, in every work mode, 06:00 to 22:00 UTC where the document states no
     times (`plugScheduleOf`, `day-night.ts`). Without `usedaynight`, the firmware's default, it holds its day's
     switch points round the clock and nothing reads its day, so it is no schedule.
  2. **Otherwise the cameras in its space**: a camera that finds its tent dark switches to its night (infrared) mode
     and sends grey, so a grey still is night and a colour one day. Each still is measured once, when it is stored
     (`monochromeOf`, `media.monochrome`); the newest still of any camera in the space at or before the instant
     decides, for as long as it speaks for its camera: ten of the camera's intervals (five minutes at 30 s), when
     every screen calls the camera stopped (`CAMERA_STILLS`) - one interval would flip the half to night at every
     missed capture, and a stopped camera says nothing of a lamp that went out after it - plus, over the past, the
     gap thinning has left by the still's age, or a chart of last month reads as nights again
     (`stillSpeaksForMs`, `StillDaylightService`). Stills from before the measurement count as unknown; they were
     not measured afterwards, which would decode every stored picture.
  3. **Otherwise the night**, as before.

  A live reading takes the half at its own instant, a window of a series at its middle (the half that held for most
  of a window with one switch, as the lamp's majority is read). It costs nothing with a schedule and two reads per
  answer without one - the space's camera rows and one aggregation of their stills by half steps - never one per
  point. Only the VPD follows: a plug still holds no targets and shades no nights (`cycleOf` is unchanged), and the
  app works out no VPD of a reading itself - its VPD band comes from targets, which a plug has none of. An AIR
  fan's VPD was left as it was: it takes the night's offset too, although the fan reports its day, because no
  read hands that day to `vpdOf`. The cases are kept by
  `server/test/unit/plug-schedule.spec.ts`, `still-light.spec.ts`, `still-daylight.spec.ts`, `vpd-half.spec.ts`
  and `server/test/specs/day-night.spec.ts`.

## Consequences

- A change to how the firmware decides day and night (`fridge.cpp`, `controller.cpp`, `plug.cpp`) changes
  `day-night.ts` in the same pull request, or the cloud judges against a half the device does not hold.
- Migration 021 put the stored light windows into the one shape, turned the windows the old recipes copied into
  every plan step into light hours (ADR 0001), and gave every target record its current cycle.
- Saving the targets in a mode that leaves some of them alone keeps the stored ones: the day while drying or
  germinating, the humidities in the greenhouse mode, the night with 24 hours of light and the day with none.
