---
summary: The owner's decisions on germination (Keimung) - two stages, germination in the dark and the seedling stage with light, 24 °C and 75 % for the seeds, and the grower's two humidity choices - with their reasons and what they mean for work modes, alarms and stored plans - read before touching the germination stage, the breed work mode, a humidifier socket's behaviour in the dark or the "too humid" alarm
updated: 2026-10-08
source: Chris (owner's decisions of 2026-10-03 and 10-04), rewrite commits merged with PR #104; checked against shared-types/, server/ and firmware/ on 2026-10-08
paths:
  - shared-types/src/v1/climate-presets.ts
  - shared-types/src/v1/configuration-fields.ts
  - server/src/modules/device-protocol/work-modes.ts
  - server/src/modules/device-protocol/germination-memory.ts
  - server/src/modules/alarm/germination-alarms.service.ts
  - server/src/migrations/steps/022-dark-germination.ts
---
# ADR 0007: Germination happens in the dark

- **Status:** accepted on 2026-10-03 and 10-04 (the owner's decisions G1 to G3; the code names G2 and G3); built
  and merged with #104 on 2026-10-04.
- **Date:** 2026-10-03
- **Touches:** `shared-types/` (climate table, work modes), `server/` (work mode, alarms, plans, migration 022),
  `firmware/` (a controller in germination), `webapp/`
- **Builds on:** [ADR 0001](0001-app-rewrite-data-model.md), where the server decides the work mode.
- **Supersedes:** "Keimung" as the grow stage that wrote the seedling climate with 18 hours of light, beside a dark
  mode of the same name that was a switch of its own under a fridge's Erweitert.

## Context

"Keimung" meant two things. The grow stage wrote the seedling climate - day and night, 18 hours of light - while
the firmware's dark mode, `breed`, was a separate switch on a fridge: no light, no CO2, no humidity control,
heating and cooling to the night temperature. A grower could not tell from the word which of the two they had.

## Decision

**G1 - two stages for every device** (Chris, 2026-10-03). Keimung is germination in the dark; Sämling is the
seedling climate with light. The screens say so wherever a stage is chosen: "Keimung · dunkel" and "Sämling · mit
Licht". Built with it, and part of the decision since:

- Germination holds **24 °C**, written where `breed` reads it, the night temperature (`GERMINATION_TEMPERATURE`).
  Seeds sprout fastest between about 22 and 26 °C - colder they take days longer and rot more often, warmer the
  medium dries out and damping-off sets in - and 24 °C is the seedling climate's day temperature, so leaving the
  dark changes the light and not the warmth.
- The stage decides the work mode: a germination preset, a phase with its climate, the choice at a claim or a plan
  step puts a fridge or a tent controller into `breed`. Every other stage, a plan step that names none included,
  brings it back to its standard mode, with the night from before germination (`beforeGermination`).
- A germination phase recorded **without** its climate darkens nothing: it is the record of seeds sprouting,
  wherever they are, and it leaves a lit place's alarms as they are.
- A tent controller offers germination too, not only a fridge. In the dark it keeps its dehumidifier output off and
  runs the exhaust by the over-temperature rule, because a dehumidifier socket used for cooling warms the tent and
  dries the medium; that needs the controller firmware built with it. A fridge's dehumidifier socket rests in
  `breed`.

**G2 - the grower chooses what germination does about the humidity** (Chris, 2026-10-03): whether the stage's
"Zu feucht" alarm warns, and whether a humidifier socket goes on holding the humidity. Both are kept on the device
(`germinationChoices`), served in `control`, travel with every way germination is set - a targets save, the work
mode by name, a phase or preset with its climate, a plan step - and go back to the defaults when germination
ends, so a choice made for one batch of seeds is not carried into the next. The defaults (`GERMINATION_CHOICES`)
are what every device did before there was a choice, so that no tent changes by itself, and the rules round them
were built with the decision:

- **The stage's "Zu feucht" rests.** Seeds are kept moist on purpose, a germination box reads far above any band
  meant for leaves, and an alarm that goes off every night teaches a grower to stop reading alarms. Only the stage's
  own rule rests; a rule a person wrote, the one-tap template's included, keeps watching. Asked to warn, the stage's
  rule watches at germination's own line, over 90 % for 20 minutes (`GERMINATION_TOO_HUMID`): above it water stands
  on the medium, where mould and damping-off begin. An episode that rests is marked `rested`, not resolved.
- **A humidifier holds.** Dry air is what fails a germination, a humidifier only adds moisture up to its target
  and cannot make the box too wet, and the firmware always did this in `breed`. Resting it needs no firmware change:
  the device is sent a humidity band of 100 and a night humidity of 0 while it rests, which no reading falls under,
  and the server keeps the grower's figures and puts the band back when the humidifier may hold again.

**G3 - germination brings its own humidity, 75 %** (Chris, 2026-10-04; `GERMINATION_HUMIDITY`), written as the
night humidity, the one the dark mode goes by, and held by a humidifier while the grower lets it. Seeds sprout well
between about 70 and 90 %; a humidifier switching on five points under 75 % never lets the box fall below 70 % and
stays well clear of the 90 % alarm, and the seedling climate after it holds 65 to 70 %, so the step into the light
is a small one. Before, the night humidity left from flowering - 50 % - told a humidifier to keep the seeds dry.
The night's humidity from before comes back when germination ends.

## Consequences

- Migration 022 renamed to "seedling" what ran the light under the old meaning, so that no device went dark
  because a word changed: plan and template steps in germination that do not carry `breed` themselves, the phases
  a preset or a plan step wrote (unless that device's plan germinates in the dark), and the diary lines that
  announced them. A phase a person entered without a climate keeps "germination".
- `breed` is one of the work modes the server decides (ADR 0001, "The server decides the work mode"); the modes a
  person picks are `WORK_MODES` in `shared-types`, with germination offered on a fridge and a tent controller.
- The constants and their reasons live in `shared-types/src/v1/climate-presets.ts`; a change to the figures is a
  change to this decision.
