---
summary: What the server does on its own and for a device, and the rules behind it - alarms and notifications, device settings and plans, tasks and commands, the read models screens judge by
updated: 2026-10-08
source: Chris (fridge tuning and germination, 2026-10-01..04); app-rewrite sessions and their critics 2026-09..10; commit history up to #141 (2026-10-07); checked against the code on 2026-10-08
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
  (`common/v1/value-age.ts`), because migrated `lastSeenAt` stamps lag. The newest samples are read one device at a
  time within a budget ([data.md](data.md), InfluxDB); a device that could not be asked keeps its state and is never
  called offline for that.
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
- The login address gets nothing unless the person asks: `POST /v1/me/email-alarms` routes to it in one tap. Channels
  (mail, webhook, Web Push, one Telegram bot per install) are off until configured; a Telegram reply under a message
  about an alert or a task becomes a diary entry.
- Alarm lines are stored composed, in English, in `message.params`: a wording change never reaches old lines.

## Device settings and plans
- The settings document is the device's own: the server keeps a copy and decides only the work mode, the per-type
  rules and per-field limits (`work-modes.ts`, `class-rules.ts`, `configuration-fields.ts`, `document-figures.ts` in
  `modules/device-protocol/`). A save answers what was stored, not what the device runs. It keeps the figures the
  current work mode does not use (`idle-figures.ts`); drying and germination remember what to return to
  (`drying-return.ts`, `germination-memory.ts`). A person's save writes one diary line naming what moved, a save
  that moves nothing writes none.
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
- Tasks are derived, never stored, so an id carries all a completion needs (`diary/task-ids.ts`): a one-off
  reminder's id, a repeating one's id and occurrence, or `plan:<device>:<step>:<stepStartedAt>` - without that last
  instant a plan that loops or is restarted finds its old confirmation and never asks again.
- Commands (`POST /v1/devices/{id}/commands`) are a closed union, published at once and never stored or retried; the
  202 says when the command went out and whether anybody was listening, never that the device obeyed. The firmware's
  `test`/`stoptest` bench mode is left out on purpose - why, at the union in `shared-types/src/v1/devices.ts`.
- Times of day stay on the owner's wall clock: the device keeps a `scheduleClock`, and `ScheduleClockService` moves
  the UTC times within a minute of the owner's offset changing (DST, another zone) - once the account chose a zone.
- `targetChanges` records what a device aimed at, written only when targets or the day/night cycle change; bands over
  the past are drawn from it. For an hour after a change (`SETTLE_SECONDS`) a reading between the old and the new band
  counts as on target. A preset writes its CO2 target only to a device reporting `co2=on` (the firmware zeroes one
  without a sensor); a device without the key, old firmware, keeps the target it has.

## Read models
- The server computes what screens judge by - bands (served with the targets), verdicts, value ages on its own
  clock, grow days (`grow-days.ts` in shared-types) - and clients do not re-derive them. Comparing two grows by day of
  grow is client arithmetic on the `originAt` a grow series answers.
- Timeline and chart series read 480 windows per range, never finer than 60 s, so every range costs the same; an
  asked `stepSeconds` is honoured down to 5 s until a read would pass 5000 windows (`timeline-window.ts`). The rail
  caps machine lines (system, plan) apart from people's lines, so they cannot push the diary out.
- The 24-hour climate verdict (`overview.service.ts`) reads 2-minute means (`VERDICT_STEP_SECONDS`): an excursion
  much shorter than that is averaged away. How a switch between day and night is judged: ADR 0006.
- A week's light hours are lit time over heard time, refused below a day heard; a report judges each phase against
  the band snapshotted for it, never today's targets; photo totals count the pictures of matched entries, because
  migrated pictures hang on notes.
