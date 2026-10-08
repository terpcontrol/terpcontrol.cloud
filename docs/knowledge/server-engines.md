---
summary: What the server does on its own and for a device, and the rules behind it - alarms and notifications, device settings and plans, tasks and commands, the read models screens judge by
updated: 2026-10-08
source: Chris (fridge tuning and germination, 2026-10-01..04); app-rewrite sessions and their critics 2026-09..10; commit history up to #141 (2026-10-07); codebase cleanup (2026-10-08); checked against the code on 2026-10-08
paths:
  - server/src/modules/alarm/**
  - server/src/modules/v1/notification/**
  - server/src/modules/device-protocol/**
  - server/src/modules/v1/plan/**
  - server/src/modules/v1/phase/**
  - server/src/modules/v1/space/**
  - server/src/modules/v1/timeline/**
  - server/src/modules/v1/diary/**
  - server/src/modules/v1/overview/**
  - shared-types/src/v1/configuration-fields.ts
  - shared-types/src/v1/climate-presets.ts
  - shared-types/src/v1/alert-routing.ts
  - shared-types/src/v1/plan-clock.ts
---
# Server engines

The work the server does without a person asking, and the answers built on it. How the server is put together -
process, configuration, the contract, sessions, access, media serving - is in [server.md](server.md); cameras, the
poller and timelapses in [terp-cam.md](terp-cam.md); the stored data in [data.md](data.md); what a device sends in
[the device protocol](../device-protocol.md). Decisions behind the engines: times of day on the wall clock
([ADR 0005](../adr/0005-device-times-on-the-wall-clock.md)), day and night by the device's clock
([ADR 0006](../adr/0006-day-and-night-by-the-device-clock.md)), germination
([ADR 0007](../adr/0007-germination-in-the-dark.md)).

## Alarms and notifications
- `modules/alarm/`: the engine judges each sample against the device's rules under a per-device lock and keeps the
  episode in `alarmRules.state`, so a rule with a long `forSeconds` (a fridge allowed to cool for an hour) survives a
  restart.
- The health loop (`alarm-health.service.ts`, every 60 s) raises what no reading reports: the `offline` rule every
  device carries (critical, repeating every 30 min) and a camera's stale warning (on unless the camera turns it off).
  Silence counts from `heardAt`, the later of `state.lastSeenAt` and the newest stored sample
  (`shared-types/src/v1/value-age.ts`; the app dates a device row by the same rule), because migrated `lastSeenAt`
  stamps lag. The newest samples are read one device at a time within a budget ([data.md](data.md), InfluxDB); a
  device that could not be asked keeps its state and is never called offline for that.
- Maintenance holds a device's raises, repeats and all-clears for the window (`state.maintenanceUntil`) plus
  `MAINTENANCE_SETTLE_SECONDS` (10 min, `shared-types/src/v1/maintenance.ts`). A visit entry starts 15 minutes of it
  on every device in the space; a window is stored before it is published. Silencing a rule only stops the sending -
  it still opens alerts and writes lines.
- Germination rewrites no rule: at every sample the engine asks `restsInGermination` and `watchNow`
  (`shared-types/src/v1/climate-presets.ts`), so the stage's own "too humid" rests, or watches at germination's 90 %,
  only while the device is in `breed`. The hourly plan re-send cannot undo that and nothing is put back afterwards;
  `GerminationAlarmsService` applies a saved choice at once rather than at the next reading. What rests and why:
  ADR 0007.
- An alert is the record of an episode: it keeps its severity (changing a rule re-grades open alerts only) and a copy
  of the rule's name and watch (`watched`); deleting a rule closes its open alert and keeps the rest.
- A rule either carries its own e-mail or webhook (`delivery.custom`: `{{placeholder}}` templates in
  `utils/webhookTemplate.ts`, trigger and resolve targets split by `|`, optionally called through the device's tunnel
  to reach a home network; a failure becomes a `message-alarm-webhook-error` line) or is routed by the person's
  settings: `alertCategory` sends critical to `alerts`, warning to `warnings`, info nowhere.
- The routing rules the alarm screens state too are `shared-types/src/v1/alert-routing.ts`, so a change there reaches
  both: `alertCategory`; `silenceOf` (a mute holds back everything, quiet hours never a critical alarm), with
  `inQuietWindow` on the account's clock; the 30-minute repeat a critical rule is written with; the mail floor (at
  most one mail per rule every 5 minutes, for a rule's own mail delivery only).
- The login address gets nothing unless the person asks: `POST /v1/me/email-alarms` routes to it in one tap. Channels
  (mail, webhook, Web Push, one Telegram bot per install) are off until configured; a Telegram reply under a message
  about an alert or a task becomes a diary entry.
- Alarm lines are stored composed, in English, in `message.params`: a wording change never reaches old lines.

## Device settings and plans
- The settings document is the device's own: the server keeps a copy and decides only the work mode, the per-type
  rules and per-field limits (`work-modes.ts`, `class-rules.ts`, `configuration-fields.ts`, `document-figures.ts` in
  `modules/device-protocol/`). A save answers what was stored, not what the device runs. It keeps the figures the
  current work mode does not use (`idle-figures.ts`); drying and germination remember what to return to
  (`drying-return.ts`, `germination-memory.ts`). Which modes end germination and get the night from before it back is
  `SCHEDULED_MODES` in `day-night.ts`, the modes with a day and a night: a mode added there changes how germination
  ends too. A person's save writes one diary line naming what moved, a save that moves nothing writes none. A light
  window is named whole when either of its times moved - `daynight.day`/`night`, or a LIGHT's own `day`/`night` at
  the top of its document - since one time alone says nothing of 24 hours or none (`withScheduleWhole`). The line's
  parameters are the figures, the mode of a drying room or a germination (empty otherwise) and the device's type,
  because a place can hold something else on another type: a smart socket's `daynight` times are when its switch
  points by night take over, no lamp's. Lines from before carry only the figures, or the figures and the mode.
- A person changes figures one at a time with `PATCH /v1/devices/{id}/configuration` and `set`; the table per type,
  with the ranges the server holds them to, is `shared-types/src/v1/configuration-fields.ts` (a choice the firmware
  keeps as a number, such as an AIR's fan mode, is written as its code; the keys are in
  [device protocol §7.1](../device-protocol.md#71-keys-per-hardware-type)). The targets have a write of their own.
- A fridge's document is held to figures nobody sets any more on every write, its own upload included
  (`class-rules.ts`): the dehumidifier tuned from the humidity of the half it holds - below 55 % short runs from the
  target itself, from 55 % a 5-point band - the day gliding into the night, no CO2 at sunset, at least 240 s of
  compressor rest. Plan steps and templates carry none of them (`019-work-modes` cleared the stored ones), the diary
  line never names them (`HIDDEN_FIGURES`), and a controller keeps its own tuning.
- The cloud never invents a first settings document: with `configuration: null` a preset passes the device by and a
  plan with settings is refused (422 `device_sent_no_settings`); a plan for a document that states no targets, such
  as a LIGHT's, is refused with 422 `device_states_no_climate` - the document decides, not the type (`PlanService`).
  Since #141 (2026-10-07) a device sends its running settings with every `fetch`, and the server keeps them only
  while it holds none; otherwise its own copy wins.
- Presets are the table in `shared-types/src/v1/climate-presets.ts`; curing has no row and writes nothing. Plan steps
  and presets merge inside each section, so a figure a step leaves out keeps the controller's value. The plan engine
  re-sends the running step at most hourly, so a step carries only the figures it shows, its light hours keep the
  device's on-time unless the step names one (`plan-steps.ts`), and a client setting figures by hand over a running
  plan pauses it first.
- A step's clock - its length (none: it runs until moved on by hand), what it has served across pauses, whether it
  is over, which step follows - is read by `shared-types/src/v1/plan-clock.ts`, by the engine and the plan and task
  screens alike, or a screen offers a Confirm the server refuses. Served time is unclamped: "more time" pushes
  `stepStartedAt` into the future.
- Tasks are derived, never stored, so an id carries all a completion needs (`diary/task-ids.ts`): a one-off
  reminder's id, a repeating one's id and occurrence, or `plan:<device>:<step>:<stepStartedAt>` - without that last
  instant a plan that loops or is restarted finds its old confirmation and never asks again. Which tasks are due and
  which entries completed them is `diary/due-tasks.ts`, for every reader (home, overview, task list, announcer, the
  entry that ticks one off).
- Commands (`POST /v1/devices/{id}/commands`) are a closed union, published at once and never stored or retried; the
  202 says when the command went out and whether anybody was listening, never that the device obeyed. The firmware's
  `test`/`stoptest` bench mode is left out on purpose - why, at the union in `shared-types/src/v1/devices.ts`.
- Times of day stay on the owner's wall clock: the device keeps a `scheduleClock`, and `ScheduleClockService` moves
  the UTC times within a minute of the owner's offset changing (DST, another zone) - once the account chose a zone.
- `targetChanges` records what a device aimed at, written only when targets or the day/night cycle change; bands over
  the past are drawn from it. For an hour after a change (`SETTLE_SECONDS`) a reading between the old and the new band
  counts as on target. A preset writes its CO2 target only to a device reporting `co2=on` (the firmware zeroes one
  without a sensor); a device without the key, old firmware, keeps the target it has. Whoever reads a controller's
  targets out of its document - setpoints, target record, timeline, plans, presets, verdicts - does it with
  `targetsOf` (`modules/v1/phase/phase-targets.ts`).

## Read models
- The server computes what screens judge by - bands (served with the targets), verdicts, value ages on its own clock,
  grow days (`growOriginOf`/`growDayAt` in `feeding.ts`, the stage spans in `grow-days.ts`, both in shared-types) -
  and clients do not re-derive them. Comparing two grows by day of grow is client arithmetic on the `originAt` a grow
  series answers.
- Timeline and chart series read 480 windows per range, never finer than 60 s, so every range costs the same; an asked
  `stepSeconds` is honoured down to 5 s until a read would pass 5000 windows (`timeline-window.ts`, which leaves an
  asked step to the store's `stepFor` in `modules/data/flux.ts`). The rail caps machine lines (system, plan) apart
  from people's lines, so they cannot push the diary out.
- A VPD's leaf offset follows the half the device was in; a smart plug, having no lamp, takes its own schedule, else
  the colour of its space's camera stills, else the night ([data.md](data.md#influxdb), ADR 0006).
- The 24-hour climate verdict (`overview.service.ts`) reads 2-minute means (`VERDICT_STEP_SECONDS`): an excursion
  much shorter than that is averaged away. How a switch between day and night is judged: ADR 0006.
- A week's light hours are lit time over heard time, refused below a day heard; a report judges each phase against
  the band snapshotted for it, never today's targets; photo totals count the pictures of matched entries, because
  migrated pictures hang on notes.
