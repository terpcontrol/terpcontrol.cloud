---
summary: The app rewrite is complete (merged 2026-10-04) - where its decisions and knowledge live now, and what it left open; read before picking up one of those open items
updated: 2026-11-12
source: rewrite sessions 2026-09-16..10-04 with Chris's instructions in them (2026-09-17, 2026-09-22); PR #104 and the pull requests after it; verified against the code on 2026-10-08; Chris and a read of the web app on 2026-11-11 (navigation), its first round on 2026-11-12; round 4 of the navigation redesign and its fix pass (the redesign session of 2026-11-12)
paths:
  - webapp/src/screens/me/appearance/**
  - webapp/src/api/plans.ts
  - server/src/modules/v1/diary/tasks.service.ts
  - webapp/src/screens/camera/add/**
  - firmware/src/wifi.cpp
  - firmware/src_hwtype/**
---
# The app rewrite

The rewrite replaced the Angular web app with the React app in `webapp/`, the server's app-facing routes with the
`/v1` API whose contract is `shared-types/src/v1/`, and the old database shapes with the model of ADR 0001; the
device-facing routes stayed as they were. It was merged on 2026-10-04 as #104 and is complete. Internal notes on its
product side exist outside this repository.

## Where its knowledge lives

- [ADR 0001](adr/0001-app-rewrite-data-model.md): the data model, the `/v1` API and the migration.
  [ADR 0002](adr/0002-app-rewrite-frontend-stack.md): the web app's libraries and its look.
- [device-protocol.md](device-protocol.md): the frozen contract with the firmware.
- [`server/src/migrations/README.md`](../server/src/migrations/README.md) and the runbook
  [Upgrading an install from before the app rewrite](runbooks/upgrade-a-pre-rewrite-install.md): upgrading an install
  from before the rewrite. The server migrates the database at boot and no command undoes a run, so the way back is a
  backup that has been restored once before the upgrade.
- The rules and traps this document used to collect are in the topic documents: [server](knowledge/server.md),
  [data](knowledge/data.md), [webapp](knowledge/webapp.md), [app-ux](knowledge/app-ux.md),
  [firmware](knowledge/firmware.md), [testing](knowledge/testing.md), [ci-and-release](knowledge/ci-and-release.md),
  [development-workflow](knowledge/development-workflow.md). How it was verified on copies of production data:
  [verification passes](knowledge/testing-real-devices-and-data.md#verification-passes).

## Left open

Checked against the code on 2026-10-08; the navigation item on 2026-11-12. Take an item out once it is done.

- **The navigation is to be reordered** (Chris, 2026-11-11: the diary is hard to find, places and rooms are
  inconsistent, the charts are less precise and less intuitive than the old app's). The direction is chosen (Chris,
  2026-11-11; internal notes exist) and a click prototype outside the app comes before any change to it. The new
  routes need no redirects from today's, and a change to the data model comes as a migration step (Chris,
  2026-11-11). It is built in rounds; the bar, the header's choice of place, the addresses, Start, the grow page
  with its diary by the day, the public page on the same day cards, and Steuerung with a page per device and the
  camera page are in since 2026-11-12 ([app-ux.md §2](knowledge/app-ux.md#2-navigation-and-the-place-page)), the
  other pages follow. A read of the whole web app on 2026-11-11 found, as the things the redesign still has to
  settle:
  - Verlauf and Graphen are two screens over one engine. Verlauf's windows all end now and it cannot zoom; Graphen
    can step back and zoom, is reached by a chip in Verlauf's range row, and opens on 24 h
    whatever Verlauf showed. On touch a drag only moves the cursor (`webapp/src/charts/scrub.ts`), so zooming is the
    button "Hineinzoomen", and every zoom is a new read.
  - A curve's automatic step is `max(60 s, range / 480)` and each point a mean without minimum and maximum
    (`server/src/modules/v1/timeline/timeline-window.ts`). The comment on `MIN_STEP_SECONDS` there says no device
    reports faster, but devices send a `bulk` sample every 5 s ([device-protocol.md](device-protocol.md)) and the
    store honours an asked step from 5 s (`server/src/modules/data/flux.ts`). The old page loaded 5 to 20 s points up
    to a day and zoomed on them in the browser.
  - A claim offers "ein neuer Ort" first when places exist (`screens/claim/CodeStep.tsx`), so a second device in the
    same tent makes a second place and Start turns into the several-places layout.
  - The weight is live duplication, not dead code: 21 ideas (place chooser, rename sheet, maintenance, climate
    preset, light limit, ...) are each built in three to nine places, against one unused export.
  - Round 4 (Steuerung, devices, camera), state of 2026-11-12 (the redesign session; rules in
    [app-ux.md §2, §3, §5, §8](knowledge/app-ux.md)). Built, walked by the session's critic - two blockers and ten
    larger points - and what the walk found built in a fix pass the same day; checks green. The fix pass has not
    been walked by a critic, and its rules are the redesign session's, not Chris's.
    - *Steuerung with "Geräte in …"*: built (`screens/control/Control.tsx`, `PageRows.tsx`, `ByDevice.tsx`,
      `climate/`, `rows.ts`, `Mode.tsx`, `Outputs.tsx`, `DevicesHere.tsx`). Nothing is a draft, and a setting is
      changed one way: a sheet with "Speichern" for a figure, a write on the tap for a switch, each answered by a
      toast with undo (`climate/saved.ts`). The fix pass: a page behind a row leads with the place's own device
      and folds the others, and choosing another place keeps the page; a place led by a Plantalytix Socket, a
      LIGHT or an AIR fan is built from the controller's parts, and the draft bar with its leave question is
      gone; Keimung and Trocknung are chosen as a climate preset only
      ([ADR 0007](adr/0007-germination-in-the-dark.md): the stage decides the work mode); an output held by hand
      is said wherever its state is said, Start included; a paused plan is continued and stopped on the plan page
      alone; an hour of silence for a rule that has raised is back under Alarme; toasts are held to two.
    - *The device's own page*: built (`/devices/:id` with `advanced`, `details`, and
      `/devices/:id/sockets/:socket`; `screens/devices/`). The fix pass: a socket is switched by saying which way
      (`HandHold.tsx`, the control Ausgänge has); the list of a device's sockets under its page went, since they
      stand under Steuerung and under Ausgänge; a device is moved by a button, after the sheet said what goes
      with it, and the move can be taken back; a second device's page leads to its own part of Steuerung's pages
      (the rows Steuerung draws, `PageRows`); the head's arrow steps back; every write is answered by a toast.
      The prototype's "meldet sich alle 5 s · WLAN gut" is not drawn: the app has no such data. "Update vom …" is
      offered only to a device whose automatic updates are off (a newer stable build than the one the cloud knows
      it runs); a device on a channel reads "kommt von selbst" - a "now" for those needs a server route. Picking
      a build by hand was shown on a stack with a registered build
      ([firmware.md](knowledge/firmware.md#ota-and-update-channels)).
    - *Offline does not lock*: built, and since the fix pass true of every panel that writes a setting -
      Plantalytix Socket, LIGHT, AIR fan, Erweitert, the work mode, regulation switched off. Proven with the
      simulator: a save is stored at once and published once on the device's `configuration` topic, which a
      silent device misses; on its next connect its `fetch` is answered with the stored document, and it
      acknowledges nothing. So the page says what the cloud stored since the device was last heard and what it
      had stored by then - `pending` of `GET /v1/devices/{id}/live`
      ([server-engines.md](knowledge/server-engines.md#read-models)), computed from the target record and the
      diary line of a person's save, no new stored field. Its limits: nothing is said in the first ten minutes of
      silence; a figure outside the target record that a plan or a preset moved meanwhile, and one past the twelve
      a long diary line names, are not known.
    - *The camera page*: built (`screens/camera/CameraPage.tsx`, `days.ts`, `Films.tsx`, `CameraSettings.tsx`).
      The slider runs over the days of the grow running in the camera's place and is not drawn without one, or
      for a second camera of one place: the diary names one still per day. The fix pass: the day stands in the
      address, "Im Tagebuch zeigen" opens the diary on it, a film asked for is followed until the button plays
      it, and the settings are one sheet with one Save. Scrubbing through one day's stills went with the
      prototype's design; the day's film and Verlauf's cursor are to show them (round 5).
    - *Several devices in one place*: built as far as the app goes - Steuerung's top is the device the server
      names as the place's climate (`screens/control/lead.ts`), its pages list the others folded, and every other
      device draws its own settings on its page with the way to its curves and its part of those pages. What
      becomes of a place with two climates stays the data model's question.
    - *The list `/devices`*: gone, with its panels, the second Erweitert under the targets, the maintenance
      sheet, `/control/targets` and the light limit's second slider; the address is the not-found page inside the
      shell. Erweitert lost the work mode, a fridge's fans, continuing a plan, the update channel, pairing a
      socket and giving a device up to places of their own, and its fields are lines that open the sheets
      Steuerung has.
    - *The freshness pill*: a device's and a camera's page date themselves in their head; the fleet screens say
      "Stand vor …" beside their title (`AdminHead`). What reports is "online" on every pill, card and row.
    - *Tests only*: the rows on the page of a second device of a place, as the shared part draws them - no place
      of the accounts the fix pass was walked with holds two devices.
    - *Not built, and why*: a held light on another browser - the device reports no hold of its own lamp and the
      server keeps none, so the hold is what this browser sent; since when a plan is paused - its state keeps no
      instant of the pause; a hold sent again the same way with another length - the firmware reports a hold only
      when its way changes; a stream camera's two address notes behind a help topic (`camera.addressNote`,
      `camera.addressChangeNote` still stand in the sheet); a moment's camera picture in Verlauf's cursor,
      reached from the camera page (round 5); `/claim` for a guest in somebody's place (round 6). Three of
      Erweitert's fields did not fit the value sheet as it was: the Lux-to-PPFD factor took a finer step and the
      two known lamps as chips, the AIR fan a socket slows is a choice with a write of its own, and the CO₂
      cylinder is a report with a refill form and stayed as it was. Left for the wording pass:
      `climateControl.back` still says "ein Preset anwendest", `home.liveness.*` repeats `home.reading.*` for one
      fleet screen, English `alerts.action.unsilence` is "Unsilence", and the arrow's name "Zurück" lives under
      `device.back`. Start's and Ich's door rows are not yet `ui/Rows`.
    - *The line count*: `webapp/src` stands at 73,564 lines (`.ts`, `.tsx`, `.css`) against 74,461 when the run
      began - the fix pass itself began at 73,914 and removed a second and a third way to save a setting -, and
      `webapp/test` at 35,639 against 33,865.
    - *Chris's to answer*, collected and not yet asked:
      1. Maintenance, a restart and an update stand on the card of the place's own device and on every device's
         page, one component - against "every setting has one place" read strictly; they are done to the
         hardware and are no settings.
      2. Regulation is switched off only on the device's page, and on wherever a page says that it is off.
      3. Scrubbing through one day's stills left the camera page for Verlauf's cursor (round 5).
      4. "Update vom …" is offered only to a device without automatic updates; a "now" for a device on a channel
         needs a server route.
      5. Keimung and Trocknung are chosen as a climate preset only, no longer under Betriebsart as well. With
         that, "Trocknung beenden" has no control left: a spell ends by another preset, a phase or a plan step,
         and nothing leads back to the targets from before drying.
      6. Moving a device is asked and can be taken back - except into a place made in the same sheet, which has
         no undo: taking it back would leave the new place behind empty.
      7. An output is held by choosing its length - An or Aus, then how long: two taps where one tap held for an
         hour.
      8. A light output's hold is known only to the browser that sent it. For every browser to say it, the live
         read has to carry the hold: either the server remembers the last light override it published, or the
         firmware reports it in the table it already sends (the session's recommendation). With it: may the
         firmware report its table on every override, so that a hold sent again with another length is seen?
      9. A paused plan keeps no instant it was paused at, so its row says why and not since when; a stored
         `pausedAt` on the plan's state would give the hour.
      10. A stand-alone LIGHT stops at 23.5 h of light: it holds two times of day, and two equal ones are no day.
      11. The day in the camera's address (`?day=`) is the grow's day number, not a date.
      12. "Manuell" is the off state of the switch "Automatisch aktualisieren", not an option of the channel
          select.
      13. Installing a build picked by hand waits for the device to be heard, as every update does.
      14. A Plantalytix Socket's and an AIR fan's mode are saved from a sheet with "Speichern" and not on the tap,
          and a stream camera's Erweitert with its sheet's Save.
      15. A pump's or a timer's cycle is set only in the socket's sheet ("Zeitschaltung, Adresse, Rolle").
      16. Whoever may not manage a device is not shown how many sockets it has: the count stands on the row that
          pairs one.
      17. A toast over a short sheet stands above the button row and so over the foot of the sheet's body; above
          the sheet it would cover nothing and stand a hand away from the thumb.
      18. English says "Regulating" / "Not regulating" on Steuerung's pill, while every other English string
          calls the regulation "control".
      19. "Jetzt ein Bild" is answered by a toast; a picture that could not be taken is said under the button.
  - A line of the diary opens Verlauf on its moment however old; today one from more than 30 days back opens the
    grow's whole stretch, the only window that holds it, because Verlauf's windows all end now (round 5: Verlauf's
    address carries its window).
  - Where the run stands (2026-11-12). Built, walked by a critic and fixed: the frame, Start, the grow pages.
    Round 4 is built, walked and its fixes built (above); a critic has yet to walk the fixes. The second walk of
    Start and the grow pages found one blocker - a device's alarms reached outside readers, closed - and eight
    larger points, built: their rules stand in [app-ux.md](knowledge/app-ux.md) and
    [server-engines.md](knowledge/server-engines.md#read-models), each marked as the redesign session's. Then, one round after another, each followed by its critic
    ([development-workflow.md](knowledge/development-workflow.md), Long runs and rounds):
    Verlauf as one page with the server's finer step, place and room with the data model's migration steps, Ich
    and Meldungen, and the clearing up (unused code, one wording pass, these documents, the line counts against
    74,461 in `webapp/src` and 33,865 in `webapp/test` when the run began). The briefs of the rounds, the list of
    every function with its new place and the decisions on each critic's findings are internal notes; the target
    pictures come from the click prototype.
  - Waiting for Chris's word (asked on 2026-11-12, no answer yet). The rules the redesign session set itself after
    its critics' walks - the calendar's day count, which lines a day card shows, the week cards' removal from the
    contract - are marked as such where they stand and are his to confirm with the redesign's pull request. And
    six things went with the grow page's tab "Wochen" that no page shows any more, against the rule that no old
    capability disappears silently ([app-ux.md](knowledge/app-ux.md)); each comes back or is decided away:
    - how many of a scheme week's feedings are logged ("n / m erledigt") - the week's feed lines and the rhythm
      behind "m" were reads of the removed week cards, the tab Düngung makes neither;
    - the day/night strip and the light hours per week (the report has them per phase);
    - a reading with its change from the week before (the Messwerte page has the curves);
    - the days of each stage in the head's bar;
    - strains and plant count in the head (the tab Pflanzen and the cards of "Alle Grows" have them);
    - the entry tiles' captions with the last value (the watering detail says when and how much the last was).
    And four things went with the second grow form, since "Was wächst hier?" is the one form a grow starts with:
    - several strains at creation (the tab Pflanzen names them afterwards);
    - a feeding scheme at creation (the tab Düngung chooses one);
    - making a new place in the form (a grow starts in a place that exists or without a fixed one);
    - the autoflower choice at creation - it moved to the grow's menu, "Name und Art".
    Germination's two humidity choices went with it too and are back in the form, asked where it writes
    germination's climate ([ADR 0007](adr/0007-germination-in-the-dark.md), G2: they travel with every way
    germination is set).
    Also open: whether a day's camera picture outlives the camera's retention - today only a still that a diary
    line or a grow's cover names is spared.

- **Unit preferences are saved, not applied.** Me › Appearance stores °C/°F, g/oz and l/gal (`preferences.units`),
  but every figure is still drawn in °C, g and l, as the page's `unitsNote` tells the reader; only the Me screen's
  summary line reads the choice (`webapp/src/screens/me/doors.ts`).
- **Plan templates cannot be renamed or deleted in the app.** `PATCH` and `DELETE /v1/plan-templates/{id}` exist;
  `webapp/src/api/plans.ts` only lists and creates.
- **Two task sources are not derived.** The contract's `taskSource` names `scheme` and `plan_suggestion`, but tasks
  come only from reminders and from plan steps waiting to be confirmed; `server/src/modules/v1/diary/tasks.service.ts`
  says why.
- **A standalone Terp Cam cannot be added.** The app does not offer it any more (Chris, 2026-10-08, for now) and
  `POST /v1/cameras` refuses `terpcam_standalone` with `not_yet`: a Terp Cam is reached over a relay its device
  opens, and one paired at no device has nothing to open it. The kind stays in the model in case it comes back.
- **The firmware since 2026-09-23 has not been checked on hardware.** #109, #110, #111 (fridge heat pulses,
  controller heater cut, fridge SCD4x fallback), #128 (Terp Cam relay on AIR and plug) and #141 (settings reported
  on connect) say in their descriptions that they were not tried on a device, and no `/firmware-check` is recorded
  for them or for the rewrite's own firmware changes: the smart-socket roles, overrides and protections
  (`firmware/src/wifi.cpp`, `firmware/src_hwtype/plug/plug.cpp`) and the controller's germination cooling with the
  exhaust (`firmware/src_hwtype/controller/controller.cpp`). A passing check comments "Skill check: ..." on its pull
  request. Two server behaviours also want a real device to confirm them: the 24-hour light encoding
  (`ALWAYS_LIT_FROM` in `shared-types/src/v1/day-night.ts`) and the schedule re-sent when the clocks change
  (`server/src/modules/device-protocol/schedule-clock.service.ts`).
