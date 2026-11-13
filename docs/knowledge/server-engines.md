---
summary: What the server does on its own and for a device, and the rules behind it - alarms and notifications, device settings and plans, tasks and commands, the read models screens judge by
updated: 2026-11-13
source: regulation off as a stretch of the day, a device's rules counted on their page (the redesign session's final fix round, 2026-11-13); Verlauf's eighth list - the interval pooled and bounded, four and a half of them, one verdict carried by the answer (the redesign session of 2026-11-13, not Chris); Verlauf's seventh list - a silence by the interval the device was keeping (the redesign session of 2026-11-13, not Chris); a device heard by any of its fields (the redesign session of 2026-11-13, after Verlauf's sixth walk); Chris (fridge tuning and germination, 2026-10-01..04); app-rewrite sessions and their critics 2026-09..10; commit history up to #141 (2026-10-07); codebase cleanup (2026-10-08); checked against the code on 2026-10-08; the diary read of the navigation redesign (2026-11-12); the redesign session of 2026-11-12, a pending switch read as the firmware reads it included; the Timeline's step, extremes and named window (the redesign session of 2026-11-12, measured on a session stack); Verlauf's walk and its fixes (the redesign session of 2026-11-12); alerts listed by when they ended: the redesign session's clearing-up round of 2026-11-13; the report's count of entries (the redesign session after its critic's walk of the clearing-up round, 2026-11-13)
paths:
  - server/src/modules/alarm/**
  - server/src/modules/v1/notification/**
  - server/src/modules/device-protocol/**
  - server/src/modules/v1/plan/**
  - server/src/modules/v1/phase/**
  - server/src/modules/v1/device/**
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
- A device's rules are listed a page at a time with `counts` over all of them - total, on, raised - so a screen
  that counts them does not count a page (`AlarmRuleService.counts`; Steuerung said "100 Regeln" of 110).
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
  of the rule's name and watch (`watched`); deleting or disabling a rule, and removing a camera, closes its open alert
  quietly and keeps the rest - nothing would ever close it otherwise, since the engine skips disabled rules and the
  health loop listed cameras only. Giving a device up deletes its alerts and its camera's: the previous owner's bell
  would keep the open one for good, and the next owner would inherit the history. **An open alert stands where its
  device stands** (the redesign session of 2026-11-13; ADR 0001, "Places, rooms and where a device stood"): the
  engine raises it with the device's `spaceId`, and `DevicesService.place` - the one writer of where a device
  stands - moves the device's open alerts along (`CamerasService.update` for a camera moved by itself), so the
  inbox, Start, a place's page and Verlauf, which read by `spaceId`, need no second rule, and a repeat or an
  all-clear goes to the people of the place it stands in now. One that is over keeps its `spaceId`. Access follows
  (`AlertInboxService.subjectOf`): an open alert is its device's or camera's, one that is over is the place's it
  happened in; `GET /alerts?deviceId=` holds a member to the places they see; the unfiltered inbox adds the
  alerts without a place of the caller's own devices and cameras. `Alert.spaceName` is the place's name as it
  is now, an ended place's too. **What is over is listed by when it ended** (the redesign session of
  2026-11-13): `GET /v1/alerts?open=false` sorts and pages by `resolvedAt`, then `id`, so the inbox's "Vorbei"
  is in the order of its label beyond the first page; `open=true` and a list without `open` stay by `startedAt`
  (`AlertInboxService.list`; the cursor keeps its shape). A person deletes an alert that is
  over (`DELETE /v1/alerts/{id}`, `manage` on its subject); an open one is refused (409 `alert_open`). Migration
  `024-orphaned-alerts` cleared what the old paths had left.
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
  parameters are the figures, the work mode where it decides what a figure is (a drying room's or a germination's,
  and a smart socket's, whose `usedaynight` means own switch points at night or, dosing CO2, dosing by day only;
  empty otherwise) and the device's type, because a place can hold something else on another type: a smart socket's
  `daynight` times are when its switch points by night take over, no lamp's. Lines from before carry only the
  figures, or the figures and the mode.
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
  counts as on target. A preset writes its CO2 target only to a fridge or a device reporting `co2=on` (the firmware zeroes
  one without a sensor); a device without the key, old firmware, keeps the target it has. A fridge always has its
  sensor - its firmware stops regulating without one - so its `co2` report is not stored (`023-fridge-co2-sensor`
  cleared a stale `off` that had hidden a fridge's CO2 target, readings and alarms). Whoever reads a controller's
  targets out of its document - setpoints, target record, timeline, plans, presets, verdicts - does it with
  `targetsOf` (`modules/v1/phase/phase-targets.ts`).

## Read models
- The server computes what screens judge by - bands (served with the targets), verdicts, value ages on its own clock,
  grow days (`growOriginOf`/`growDayAt` in `feeding.ts`, the stage spans in `grow-days.ts`, both in shared-types) -
  and clients do not re-derive them. Comparing two grows by day of grow is client arithmetic on the `originAt` a grow
  series answers.
- **The Timeline is read at the five seconds a device reports in, as far as that fits** (the redesign session of
  2026-11-12, after Chris's verdict that the curves had lost precision): at most 480 windows per range, so forty
  minutes and less are every sample, an hour every second one, a day three minutes; under a minute the step is a
  whole number of five seconds, so no window holds one sample and the next two. An asked `stepSeconds` is
  honoured down to 5 s until a read would pass 5000 windows (`stepFor`, `timeline-window.ts`, which leaves an
  asked step to the store's `stepFor` in `modules/data/flux.ts`). `GET /v1/spaces/{id}/timeline` takes a window
  named outright (`from` + `to`; `range` then only says which grow its bands and days are of), that step, and the
  panels to answer (`metrics`; VPD and PPFD only where asked, since VPD costs the lamp's switchings).
- **Every point of the Timeline carries the lowest and the highest sample of its window** (`min`, `max` on
  `SeriesPoint`; [data.md](data.md#influxdb) for the read): a mean flattens what was short. They are left out where
  a window held one sample or both are the same figure as the mean. Of VPD they are the lowest and highest deficit of the window's samples, for a window of three
  days at the most and left out beyond ([data.md](data.md#influxdb)); they are never bent towards the mean, so a
  panel's low and high are figures that occurred.
- **A panel is one device's readings, never a mean of two** (the redesign session of 2026-11-12, after its
  critic's walk): the place's own climate - `steeringOf`, the device Start's readings and Steuerung's top are of
  - or the one a reader asked for with `deviceId`; where nothing in the place holds targets, the first device
  that measured in the window (`ownOf`, `timeline-window.ts`). A tent's controller and a fridge module in one
  place are two climates, and their mean is a figure neither read. The answer names the device (`deviceId`,
  null to a reader from outside). The lanes are that device's and those of whatever else in the place is no
  climate of its own - a socket, a lamp, a fan (`actingOn`): another climate's compressor does not act on this
  one's air. A window without curves is dated by the last reading of the device its curves are of
  (`lastReadingAt`), not of whichever device of the place spoke last. The answer carries that device's last
  reading whole (`reading`: its values, their instant, each output on or off with its level in per cent) while
  it stands in the place, so "now" is the same figures for the owner, a member and a link's reader and no
  screen asks `/live` beside it. The lamp's nights are read from each device over its own stay
  (`lampNightsOf`), as the curves are. Every panel carries a line and its lowest
  and highest at every range; of VPD beyond three
  days they are those of means over five minutes ([data.md](data.md#influxdb)), which the help says once.
- **An output's figure is counted from its samples** (rule B of the
  redesign session after the fourth walk of Verlauf, 2026-11-13). A lane answers `points`: for every drawn
  window its device wrote a sample of the output in, how many samples the window held (`heard`), in how many
  the output ran (`on`), and for one driven at a level the mean level over all of them in per cent of full
  output, a sample in which it was off counting as 0 (`level`, to a tenth; null for a switch and for the CO₂
  valve). A window without samples has no point, which is "nothing was heard" and never "off". What a card
  says at a point, the share of the time an output ran, a table's column and how a strip is filled are
  counted from these. A lane's `spans` say only when - the lamp's stretches by the clock, the nights - and no
  figure is taken from one: a span is rounded out to the grain it was found at, so a valve that opens for
  five seconds every two minutes was one run all day and read as open 75 % of it, a heater 19 % for 13.5 %.
  The lane's `level` (the level while running, the valve's dose) and `heardSeconds` are gone from the
  contract; nothing reads them. The read behind it: [data.md](data.md#influxdb).
- **Within three days a lamp's stretch is its samples'** (`history()`, the same session): its switchings, and
  an AIR's own day, are read at five seconds, so "07:02 bis 19:02" is the same on every zoom and the night
  begins where the stretch ends; beyond three days both are to five minutes.
- **What was heard begins and ends with its samples** (`heardStretches`, `edgesQuery`; the redesign session of
  2026-11-13 after the fifth walk). A window says that something was heard in it, not when: a lamp lit
  across a silence ended "17:00" at an hour to the point for a last sample at 16:18, and a device's first
  reading began a step early. The timeline's read asks the windows either side of a silence for their first
  and last sample by their own instants ([data.md](data.md#influxdb)), and a stretch - a lane's span, a night -
  begins with the first of its first window and ends with the last of its last, the same at every step. **A
  device is heard when any of its fields reports** (after the sixth walk): the edges are the device's, of
  whichever field - asked of one field, a heater that began to report later than its controller moved the
  lamp's edges. A read without them
  (`/spaces/{id}/series` counts no samples) keeps the window its first point stands for and its last stamp.
- **A reading is of one instant** (`readingOf`, the same session): the answer's `reading` carries an output
  only if it was heard within the two minutes a reading stays fresh before the reading's own instant - a
  valve that stopped being reported is not "aus" now - and a place of outputs alone has one too, of the one
  such device standing in it: no values, its outputs, their instant.
- **The state a window is found in holds from the window's start.** The switchings read stamps its opening
  state with the first grain a sample fell into, up to a grain after the window began; a night that began there
  left a sliver of day in a window of darkness (`stateStretches`). **A lane runs to the window's end only while
  its device reports by the offline rule** (`VALUE_AGE.staleSeconds` against the newest sample, `heardStretches`):
  measured against the rhythm of a month's windows, a lamp stayed "on" for six hours after its device went
  quiet. **A window named into the future ends now** (`windowOf`), so today's day is read at today's step.
- **A silence is measured by the interval the device was keeping there, and decided once** (`quietLimits`,
  `shared-types/src/v1/cadence.ts`; `breaksOf`, `timeline-series.ts`; the redesign session of 2026-11-13 after
  the seventh and the eighth walk - the fourth had made any empty window a silence, at every range): the
  curve, the lanes and the night break where a device said nothing for more than four and a half of its own
  intervals. **The interval** beside a gap is pooled - the time of the twelve gaps before it by the samples
  that closed them (`DeviceHistory.samples`: the most any output counted in a window, from the counts read the
  Timeline makes anyway), the same of the twelve after it, the slower side counting, a gap more than twice
  the usual one of its run left out as a pause of its own. Read off a single gap it was 12.5 minutes where the
  window held two samples and 25 where it held one, and a pause of an hour was a line at one range and a
  silence at the next; over twelve gaps a steady device is measured to a twelfth, which keeps the limit
  between four intervals and five - hence four and a half: three reports missed are slow, four are a silence,
  and neither verdict hangs on the measuring. A window's first and last gap, with no neighbours on one side,
  stand in for that side by the fewer samples of the two windows they lie between. **It has an upper bound**
  (`SLOWEST_INTERVAL_MS`): nothing reports more slowly than a backfilled history's quarter of an hour, so a
  device that gets three samples through every two hours is silent between them - "four of its own
  intervals" alone took any regular trickle for a rhythm and drew it as an unbroken day. **The gap itself is
  measured by its samples** where the read asked the store for them: every gap in which a window stands empty
  and which, a step to either side of what the stamps say, could be longer than its limit, is asked for the
  last sample before it and the first after it ([data.md](data.md#influxdb)), and judged by those - so one
  pause has one verdict at every step finer than it, and not a line where it fell into three windows and a
  silence where it fell into four. A device that fills every window with its samples is silent wherever one
  stands empty and its pause is longer than the step, as before. Never less than the step, nor than the two
  minutes after which a reading is stale (`VALUE_AGE.liveSeconds`); under a minute to the window never less
  than four windows or half a minute. A device that reports slowly is still reporting within its own limit at
  the window's end. A read that counted no samples takes a device that leaves few windows empty for a fast
  one, as every read did before. **One verdict, carried by the answer**: the panels are handed the device's
  whole read (`panelsOf` takes the history - handed the series alone for a pass, the route's curve broke at
  every empty window under lanes that ran whole, while the unit tests passed the counts by hand; the route's
  own tests are in `test/specs/spaces.spec.ts`), a lane's point says where the device had been silent before
  it (`resumed`), and the Timeline's answer lists the drawn device's silences to the second (`silences`). No
  screen works a silence out again. No query more than before for a device without pauses. **A night is shaded only through hours somebody reported in** (`nightsOf`): the schedule's
  nights are cut to what was heard as the lamp's always were, mid-window and after the last word.
- The rail caps machine lines (system, plan) apart from people's lines, so they cannot push the diary out. A
  reader from outside - a share link, a public page - is answered no alarm, no device id, no grow of the place
  and only what people wrote, whichever window, step or panel the request names: the cut is a condition of the
  queries (`writtenFor`, `isOutsider`), not a filter over what a parameter selects.
- A VPD's leaf offset follows the half the device was in; a smart plug, having no lamp, takes its own schedule, else
  the colour of its space's camera stills, else the night ([data.md](data.md#influxdb), ADR 0006).
- The 24-hour climate verdict (`overview.service.ts`) reads 2-minute means (`VERDICT_STEP_SECONDS`): an excursion
  much shorter than that is averaged away. How a switch between day and night is judged: ADR 0006.
- A week's light hours are lit time over heard time, refused below a day heard; a report judges each phase against
  the band snapshotted for it, never today's targets; photo totals count the pictures of matched entries, because
  migrated pictures hang on notes. **A report's `entryCount` is the grower's own entries** (`source: 'human'`,
  `totalsOf` in `report.service.ts`; the redesign session of 2026-11-13, after its critic's walk of the
  clearing-up round): an alarm's line is the diary's to tell and no entry, and the owner reads the figure a
  share link reads.
- **A grow's day is a date on its owner's calendar** (the redesign session of 2026-11-12, not yet confirmed by
  Chris; [app-wording.md](app-wording.md), Grow time): `growDayAt(origin, at, zone)` counts dates, day 1 the date
  the grow began on. Whoever counts reads the owner's zone first (`zoneOfOwner`, `zonesOfOwners` in
  `common/v1/owner-zone.ts`; `GrowsService.zoneOf`) and hands it down - the serialiser, the
  overview, the home, the report, Verlauf's day range, the exports, the scheme week a feed is dosed at. A stretch
  ends on the day of its last instant (`growDayUpTo`), so a window closing at midnight has not begun the next date.
- **A grow's diary** (`GET /v1/grows/{id}/diary`, `modules/v1/diary/grow-diary.service.ts`) is computed per read and
  stored nowhere, and is the one read every diary is drawn from - the grow page, the public page, a share link:
  a few weeks a page, each day a date of that calendar (`grow-calendar.ts`). Per day: the lit still nearest midday
  (`diary-pictures.ts`; the day still running takes the newest lit one and no dark one), the means of temperature
  and humidity, the share inside the targets, and what happened that is nobody's line: the lamp, the stretches
  outside the band, and maintenance somebody switched - the lines a device writes when it goes on and off, of
  every device of the place, told as one stretch (`maintenanceRuns`), and regulation switched off and on again -
  the settings line whose work mode goes to `off` and back, a `controlOff` stretch per device, overlapping runs
  merged and one still running left open (the redesign session of 2026-11-13, after the whole-app walk: switching
  it off left no line while maintenance did). Then the lines: the grow's own - what people
  wrote and the alarms raised where it stood, which name the grow - and for the people who keep the place the
  plan's steps there (found by place and kept by placement). **What else a device logs about itself is not
  diary**: restarts, a sensor deviating, a changed setting stay in the device's record and in Verlauf. The last
  page carries what was written to the grow for a moment before the date it began on (`earlier`), which has no
  day. A week's film is the one whose middle falls into the week, named by its days there, and none shorter than
  two seconds.
- **Which entries are diary is said once** (`modules/v1/diary/diary-entries.ts`; the redesign session of
  2026-11-12): the diary kinds, the plan's steps, and maintenance going on and off, parted into lines and
  stretches by `toldOf`. A day of the grow's diary reads through it, and so does **the diary's tail**
  (`diaryTail`): the newest lines of a place and of the grows standing in it, which the place's overview and the
  home card answer as `entries` with the maintenance stretches among them as `events` - Start's "Zuletzt". One
  query, three entries read for each line answered, because a maintenance is two lines of every device there.
  Lamp and stretches outside the band are a day's and cost a read of the store, so the tail has none.
- **Nothing of a device reaches a reader from outside** (`writtenFor` in `diary-entries.ts`): on a public page and
  through a link onto a grow or a place every read of entries - the diary, its lines from before the start, the
  report's lines and totals, the list of entries and an entry by its id, a shared place's newest lines, the
  diary lines of Verlauf - is answered what people wrote and nothing an alarm, a device or the plan did, as a condition of the
  query so that pages and totals count what is served. Such a reader is answered no events of a day, no alarms on
  Verlauf and no share either. An alarm line carried its alert's and its rule's id, and says when a tent stood
  outside its limits: until 2026-11-12 the diary handed those to anybody with the address.
- **The lamp of a day says only what happened** (`lightOf` in `day-climate.ts`; the redesign session of
  2026-11-12): when it came on and when it last went off - a lamp switched five times while somebody worked in
  the tent is one stretch - and, where it came on again after that, that switching too. A stretch that has not
  ended has no end. `still` is true only of the day still running whose device has reported within the ten
  minutes that call a device online (`isOffline`): after a device fell silent nobody knows whether the lamp burns.
- **An instant from a client's clock is recorded no later than the server's now** (`heldToNow`,
  `common/v1/client-clock.ts`; the redesign session of 2026-11-12). A browser knows the server's time to about a
  second, so a line or a phase written "now" was as often stamped a moment ahead - and missing from every read
  that ends at now, a place's newest lines and the grow as it stands, until that moment had passed: Start showed
  neither the entry just written nor the phase a new grow was started in. Entries, a grow's start and end, a
  phase, a move, a split and a harvest go through it; further ahead than the minute of skew is refused as before.
  The form that starts a grow writes the grow and then its first phase, each held to the now it arrives at, a
  moment apart - so a first phase that follows its grow by no more than that minute begins with the grow
  (`addPhase`): the two are one instant, which is what lets them move with each other.
- **A grow's start moved takes with it what stood on it** (`GrowsService.moveStart`; the redesign session of
  2026-11-12): the first phase - through its own correction, which moves its diary line - and the placement the
  grow was made with. A start put a week earlier left a week with no stage and no place, the days counting from
  the new start under a report whose first chapter began at the old one. A phase or a placement that began later
  than the grow is a fact of its own and stays. The mirror of `startCarriedBy` in the phase writer, which moves
  the start with a first phase that is corrected.
- **A day's share is the 24-hour verdict asked of one date** (`day-climate.ts` calls `verdictOf`) over 5-minute
  means, judged by the target record alone: a day before the record's first row has no share (the verdict's own
  fallback, the first row standing for everything before it, is not used here), a day whose record begins inside it
  is judged from there on, and a share is stated only once an hour and half of the day's span were judged. One
  history read per week and controller, begun ten minutes early so a lamp that comes on at midnight is a switching
  and not the state the read opened in. Measured on a development stack on 2026-11-12, medians of 11 runs: the
  first page (three weeks) 91 ms for a grow of four weeks and 103 ms for one of four months with a reading every
  minute, a later page 50 to 130 ms, the whole four months page after page 0.7 s. Density is not what it costs:
  eight days written at a device's own five seconds read in 47 ms.
- **What a silent device has not been handed** (`pending` of `GET /v1/devices/{id}/live`; the redesign session of
  2026-11-12) is computed per read and stored nowhere, so that settings stay changeable while a device is offline
  and a page can say what it has not taken yet. A save is stored at once and published once, a device that was not
  listening is answered the stored document when it next connects, and it acknowledges nothing - so the one thing
  known is when it was last heard (`heardAt`, the rule a device is dated by everywhere): what it holds is what the
  cloud had stored by then. `pending` is null unless the device counts as offline at the read and a setting stored
  since differs from what stood then. Each such setting is named by its dotted place in the document, with what
  stood then (`held`) and when the value of now was stored (`savedAt`); one changed and changed back is not in it.
  Two sources, both kept anyway (`modules/v1/device/pending-settings.ts`): the target record says the targets, the
  light window, the ramps and the work mode, whoever moved them - a person, a plan step, a preset, the clocks
  changing; any other figure is known only from the diary line a person's save writes, whose first since then says
  what the figure was before (`modules/device-protocol/change-lines.ts` writes those lines and reads them back, so
  the two cannot drift). So a figure outside the record that something else moved meanwhile is not known, nor one
  past the twelve a long entry names, and a figure that is no number comes as its line spells it. **A switch is
  compared as the firmware reads it** (`asRead`): a document holds `true` and `false` until a write stores `1`
  and `0` in their place, and the device takes either for the same thing - so the two are one value on the two
  sides of a diary line and against the document. A switch flipped and flipped back while the device was silent
  is not pending, and neither is a write that only spelled it the other way; `held` is still answered as the line
  spells it (unit test "reads a switch as the firmware does", `server/test/unit/pending-settings.spec.ts`). The two reads
  run only for an offline device, each on its collection's index by device and time (`pendingOf` beside
  `recordOf`). Measured on a development stack on 2026-11-12, medians of 11 runs of the live read: 6 ms for a
  device that is heard, 7 ms for a silent one with a change pending.
