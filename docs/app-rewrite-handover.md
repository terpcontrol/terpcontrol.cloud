---
summary: The app rewrite is complete (merged 2026-10-04) and the navigation redesign on top of it is built - where their decisions and knowledge live, what the redesign session decided that Chris has not confirmed, what is open for him, what no walk could see, and what the rewrite left open; read before picking up one of those items
updated: 2026-11-13
source: Verlauf's seventh walk decided, and a consolidation pass set (the redesign session of 2026-11-13); the list of the clearing-up round's critic built and entered (the redesign session after its critic's walk of the clearing-up round, 2026-11-13); Verlauf's sixth list built (the redesign session's Verlauf builder, 2026-11-13); the redesign section rewritten as what is true now (the redesign session's clearing-up round of 2026-11-13, from the blocks each walk had added and the session's own list of what waits for Chris); where rounds 6 and 7 meet, the inbox's, Start's tasks' and Ich's part (the redesign session of 2026-11-13); Chris on 2026-11-13 (a round for type and colour); round 7 of the navigation redesign - Ich and Meldungen (the redesign session of 2026-11-13); round 6 of the navigation redesign - place and room (the redesign session of 2026-11-12); rewrite sessions 2026-09-16..10-04 with Chris's instructions in them (2026-09-17, 2026-09-22); PR #104 and the pull requests after it; verified against the code on 2026-10-08; Chris and a read of the web app on 2026-11-11 (navigation), its first round on 2026-11-12; round 4 of the navigation redesign, its two walks and fix passes (the redesign session of 2026-11-12); Verlauf as one page (the redesign session of 2026-11-12)
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
device-facing routes stayed as they were. It was merged on 2026-10-04 as #104 and is complete. The navigation
redesign of November 2026 was built on top of it and is described below. Internal notes on the product side of
both exist outside this repository.

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

## The navigation redesign

Chris asked for it on 2026-11-11 - the diary was hard to find, places and rooms were inconsistent, the charts less
precise and less intuitive than the old app's -, chose the direction the same day and accepted a click prototype
on 2026-11-12, which is the specification. New routes need no redirects from addresses that never reached
production, and a change to the data model comes as a migration step (Chris, 2026-11-11). It was built in rounds
by one session, each round walked by a critic who had built nothing
([development-workflow.md](knowledge/development-workflow.md#long-runs-and-rounds)); the briefs, the list of every
function with its new place and the decisions on each critic's findings are internal notes. **Everything in the
second list below is that session's decision, not Chris's word, until he confirms it with the pull request.**

### What was built

- **The frame and Start**: the bar Start · Grow · Eintrag · Verlauf · Steuerung drawn from what the account has,
  one choice of place for Grow, Verlauf and Steuerung, the addresses, Start leading with the picture
  ([app-ux.md §1, §2](knowledge/app-ux.md#2-navigation-and-the-place-page); [webapp.md](knowledge/webapp.md)).
- **Grow, Bilder, Eintrag**: the grow page with a diary that writes itself by the day, the pictures, all grows,
  the entry sheet, the public page and the share link on the same day cards; one form starts a grow
  ([app-ux.md §2](knowledge/app-ux.md#2-navigation-and-the-place-page); the diary read in
  [server-engines.md](knowledge/server-engines.md#read-models); the day count in
  [app-wording.md](knowledge/app-wording.md#grow-time)).
- **Steuerung, devices, camera**: Steuerung by place with a page per device and the camera page; the list
  `/devices` and the tab "Geräte" are gone; an offline device locks nothing and the page says what it has not been
  handed ([app-ux.md §2, §3, §5, §8](knowledge/app-ux.md); `pending` in
  [server-engines.md](knowledge/server-engines.md#read-models); [ADR 0007](adr/0007-germination-in-the-dark.md)).
- **Verlauf**: one page of curves with its whole view in the address, points from 5 s with each window's lowest
  and highest, outputs counted from their samples; `/charts` and the page "Graphen" are gone
  ([app-ux.md §7](knowledge/app-ux.md#7-verlauf-day-and-night); [data.md](knowledge/data.md#influxdb);
  [server-engines.md](knowledge/server-engines.md#read-models)). **Its state:** six walks' lists are built. A
  seventh walk found the sixth list built and holding against the samples (rest on the reading in 180 of 180
  loads, no sideways scroll at 37 widths, a silence's edges 0 s off, the 120-day read of a place 836-889 ms in the
  median) and left five minors, decided and not yet built - the last bullet of Verlauf's rules below.
- **Place and room**: a device keeps where it stood, names are unique, a room is a field of the place, "Ort
  bearbeiten" and "Ort entfernen" as pages, the claim outside the bar asking once where a device hangs, five
  migration steps `026` to `030` (the amendment to
  [ADR 0001](adr/0001-app-rewrite-data-model.md#places-rooms-and-where-a-device-stood);
  [server.md](knowledge/server.md); [data-operations.md](knowledge/data-operations.md#migrations-in-operation)).
- **Ich and Meldungen**: Ich as one card of rows with a page per subject and Verwaltung behind it; Meldungen as
  what is open, what is due and what is over; one list of what is due for the reader
  ([app-ux.md §2](knowledge/app-ux.md#2-navigation-and-the-place-page);
  [server-engines.md](knowledge/server-engines.md#alarms-and-notifications)).
- **Clearing up** (2026-11-13): unused exports, one unused catalogue key and the words of screens that are gone
  went from the web app, the server and the contract; what was built twice between the rounds was merged - the
  list is [webapp.md, "What exists once"](knowledge/webapp.md); the leftovers of the walks were built or are named
  below; one wording pass ([app-wording.md](knowledge/app-wording.md)). The server changed in three ways: what is
  over is listed and paged by when it ended, the archive routes ask `own`, and an ended place refuses an
  invitation, a member and a share link ([server.md](knowledge/server.md),
  [server-engines.md](knowledge/server-engines.md#alarms-and-notifications), [data.md](knowledge/data.md#mongodb)).
  How dead code, unused keys and dead classes are found is in
  [development-workflow.md](knowledge/development-workflow.md#code-and-documentation). A critic then walked the
  round; what it found is built and stands in the second list: the two majors lay in the round's own two
  changes - a toast over the control it answers when the keyboard was used or a second toast came, and a
  question asked below the window's foot -, the rest was older (Start naming another alert than Meldungen leads
  with, undo answers in two forms, an ended place still taking a reminder, a grow and a name, writes that
  answered nothing, wording).
- **The weight.** The audit of 2026-11-11 found the app's weight to be live duplication, not dead code: 22 ideas
  each built in three to nine places, against one unused export. `webapp/src` held 74,461 lines (`.ts`, `.tsx`,
  `.css`) when the run began, 71,732 when the clearing-up round began, 71,207 at its end and 71,542 after the
  pass that built its critic's list - that pass added about 335 lines: an undo's answer handed over at some
  thirty-five call sites, toasts for five writes that had answered nothing, the alerts joined onto Start, the
  fold that reads on. `webapp/test` grew from 33,865 to 40,214, since every rule a walk decided got a test. Some of the 22 are still built more
  than once; the round's report lists each with where. The biggest: a device card's status line against the
  liveness pill, the maintenance banner under Alarme against the shared maintenance control, the two controls
  that switch regulation back on, `ui/EntryRow` against the diary's line, the shared place's page as a second
  place page, a plant's chart beside the shared plot, and the fold-away blocks made by hand.
- **A round for type and colour follows** (Chris, 2026-11-13); its choice is the owner's. Nothing of the look
  changes before it, and [ADR 0002's section on the look](adr/0002-app-rewrite-frontend-stack.md#the-look-the-brand)
  is amended in the same commits as `webapp/src/theme/tokens.css`. That a name typed with "x" between figures is
  drawn with "×" outside the place pages is a feature of the typeface and goes to that round.

### Decided by the redesign session, not yet confirmed by Chris

Each is built unless it says otherwise, and each can be refused by itself.

**The run**
- One branch and one pull request for the whole redesign.

**Start and Grow**
- A grow's day is a date on its owner's calendar everywhere; it replaced the count of 24 hours from the hour the
  grow began ([app-wording.md](knowledge/app-wording.md#grow-time)).
- A day card shows the grower's lines and what the devices did, folded by fixed rules; the week cards left the
  contract. "Zuletzt" on Start is the tail of that diary.
- The public page and a share link draw the day cards; a reader from outside gets no device lines, no alarm
  lines (a rule's name is the owner's own words) and no share of the day inside its targets. A member let into
  a place still sees device lines and alarms.
- The doors Düngepläne, Freigabelinks and Abonniert live under `/grows/`; the row "Gerät hinzufügen" under Ich
  went - the way is Start ("+ Ort hinzufügen") and a place's ⋯.
- "Wartung · 15 Min" starts with one tap, from Start and a device's card and from nowhere else - not from an
  alert's card.
- The read-only demo has no Steuerung.
- One form starts a grow ("Was wächst hier?"); what the second form offered is in the open list. Germination's
  two humidity choices travel with every way germination is set ([ADR 0007](adr/0007-germination-in-the-dark.md)).
- Start ranks its cards by the one list of what is due for the reader, which is what a card counts too.
- Start says of a place what Meldungen leads with: its first open alert in Meldungen's order and how many more
  there are ("+2", leading to Meldungen), from one order (`worstFirst`, `screens/alerts/inbox.ts`) for Start's
  sentence, the cards' rank and Meldungen; a second device of the place that has gone silent is named instead
  of hidden behind the first one's "online" (`placeAlerts`, `screens/start/place.ts`).
- A place of one's own that has ended says so at its Start address too, as Verlauf and Steuerung do.
- Bericht counts the grower's own entries, as a share link does: an alarm's line is no entry (`totalsOf`,
  `server/src/modules/v1/diary/report.service.ts`).
- Every write of the grow pages answers with a toast that names what holds now, with the way back where one
  call takes it back: a measurement added, changed or deleted, a scheme saved or deleted, a plant renamed
  (`useAnswered`, `screens/grow/told.ts`); a deleted scheme has no way back. A plant's name that another plant
  of the grow has is refused under the field.
- A dose in the feeding grid and the scheme editor is written in the language's format ("2,5"), and an unsaved
  scheme's bar stands at the window's foot above the tab bar.

**Steuerung and devices**
- A setting is changed one way - a sheet with "Speichern" for a figure, a write on the tap for a switch -,
  answered by a toast with the way back; one save path for every setting of a device.
- What an offline device has not been handed is said from `pending` of the live read, no new stored field; a
  save to it answers that it is stored and not with the device yet.
- A page behind a row leads with the place's own device and folds the others; a place led by a Plantalytix
  Socket, a LIGHT or an AIR fan is built from the controller's parts.
- A stage's alarm rule has one name in the reader's language wherever it is named; the cloud's own rule is
  "Eingebaut"; a socket the device does not report leads to the device's page; a build is named by its day, and
  by its hour where two share a day.
- Not drawn, because the app has no such data: the prototype's "meldet sich alle 5 s · WLAN gut". Three of
  Erweitert's fields did not fit the value sheet as it was and kept forms of their own (the Lux-to-PPFD factor,
  the AIR fan a socket slows, the CO₂ cylinder's report).
- A work mode has one word on the row, in Steuerung's head and on Start; a device's page is headed as its card
  names it.
- A place's only camera carries no tag under Steuerung, as in "Ort bearbeiten"; a tag only among several.
- A toast never stands over the control it answers, whatever activated it - a tap, Space on a focused switch,
  a select changed by keyboard: each toast keeps the control used last when its write began, every standing
  toast's control is moved clear again when the stack grows, and the page keeps the room it was scrolled into
  until it is scrolled back out, so nothing jumps when a toast leaves (`log/toast-room.ts`, `log/Toasts.tsx`).
- A question is in view when it is asked - the whole box, question and yes, inside its sheet or page - and
  takes Escape itself, so the sheet under it and what was typed there stay (`ui/Asking.tsx`).
- An undo's answer has one form and says what holds now: "Widerrufen · <what holds again>" (`undoneLabel`,
  `log/lines.ts`); the toast's type refuses an undo that does not say it. The words for the cases are in
  [app-wording.md](knowledge/app-wording.md).

**Verlauf** (rules in [app-ux.md §7](knowledge/app-ux.md#7-verlauf-day-and-night))
- A figure of VPD is a VPD that occurred: within three days the deficit of single samples, beyond that from
  means over five minutes, each judged day or night by its own time; every step there is a whole number of five
  minutes, and VPD's head says so. Temperature and humidity keep the samples' extremes on every range. A grain in
  which the lamp switched is worked out from its own samples.
- A leaf temperature counts only where the same reading carries one, and for a grain only where leaf readings
  cover at least half of it.
- At rest the card says the last thing that was heard - "jetzt" while the server calls it fresh, "letzter
  Wert · …" once it is stale -, and one card is one point. No `at` in the address means rest.
- Humidity is read to a tenth on Verlauf and whole on Start.
- An output's figures are counted from its samples; a point where nothing was heard says "—"; an output at
  level 0 is "aus". A window without a reading is a gap, with no night and no target band through it.
- A place with two climates is about one device on every page; a share link shows the place's own climate
  only. A night belongs to the device that stood there, over its own stay.
- The table and the CSV are one row per drawn point with each output's mean level.
- An alarm of the past counts for the place it happened in.
- "Zeitraum abspielen" plays the window from its first picture; the night as a film needs a zoom first. Beyond
  three days a lamp's times are to five minutes.
- A chosen step is bounded at 5,000 windows; Ctrl and the wheel zoom while the plain wheel scrolls the page; the
  names of the strips stand above them; the ticks of "Anpassen" are kept by the browser, and CO₂ starts unticked.
- After the sixth walk: a window that reaches now rests on the reading at every zoom, and only a cursor somebody
  set is held inside the window. At rest the card shows every value the reading carries, an older one with its
  own time, and no dash without its name.
- "an seit" names a switch that lies in the window; a lamp lit through all of it is "durchgehend an", and a
  stretch cut by a silence that has ended says the gap ("07:03 bis 10:59 · Lücke bis 16:00"). A lane's label is
  facts in one order at every range, the level once where every stretch ran alike, and an output driven at a
  level adds its mean ("im Mittel 12 %").
- A device is heard when any of its fields reports: the edges of a silence are the device's samples, read only
  beside a silence the series read found ([data.md](knowledge/data.md#influxdb)).
- Verlauf's page is never wider than the room beside the shell's margin; a help text too tall for its side is cut
  between two lines.
- **Decided after the seventh walk, not yet built.** What a gap is follows the device's own cadence, not the
  step: a device that reports slower than the step (thinned history at three days, a slow socket) is one line
  with whole band and lanes, not dots and stripes with a lamp stretch per point. "x % der Zeit an" is a share of
  time, each point weighed by the time the device was heard in it, not a share of samples. The card keeps its
  height under the finger and says a silence once ("keine Messung · 10:59 bis 16:00"); a named dash is for one
  value missing among present ones. A point of one sample is stamped with that sample's time, never the point's
  start, and no mean's stamp runs past the window. A stretch that begins where a silence ends is "Lücke bis
  13:11 · an", not "an seit"; "durchgehend an" drops the share and names the level only below 100 %. Known and
  left: a silence about one step long can vanish at 30 days, and an output's own last report is read to the grid.

**Place and room** (the amendment to [ADR 0001](adr/0001-app-rewrite-data-model.md#places-rooms-and-where-a-device-stood))
- `devices.placements[]` beside `devices.spaceId`; a stay under five minutes leaves no trace; a device's first
  placement is read back past its beginning.
- Names are unique per owner among places and among rooms; a room may be called what a place is called.
- A room is a field of the place and exists only while a place stands in it; taking the last place out ends the
  room and its members' access, after asking. A room is renamed from the room field of "Ort bearbeiten".
- A device stands only in a place of its owner. Which room a place stands in, and taking a device out of every
  place, are the owner's alone.
- A place ends with every way into it - memberships, invitations, share links, its reminders -, and "Ort
  entfernen" names everybody who loses sight in its one confirmation; guests no longer block a removal.
- An ended room and an ended place take nothing: no invitation, member or share link, and for a place also no
  reminder, no grow started in, moved to, split off into or corrected into it, and no change of the place
  itself - 409 `space_archived` from one helper (`refuseEnded`, `refuseEndedId`,
  `server/src/common/v1/rooms.ts`), for a removed place and one put away alike. The archive routes ask `own`.
- A place that already holds two devices with a climate of their own is left as it is.
- A joining device (fan, socket, light) is claimed in one write that carries its place and is done after "Wo
  hängt …?"; a claim names the place it makes in its own write; a place the app names by itself is "Zelt",
  "Zelt 2". The claim no longer asks for a place's name and kind.
- "Ort entfernen" keeps a tent together by default, never guesses where the plants stand, asks once with every
  line it will write and keeps every answer across a refusal.
- An open alert stands where its device stands and moves with it; one that is over keeps its place, by name.
  Giving a device up deletes its alerts.
- A move's diary line keeps the names the two places had then.
- A guest whose access ends while the app is open is told once.
- Verlauf and Steuerung say that a place has ended instead of drawing another; a sheet that leaves its page for
  good leaves no page under it in the history.
- A stream camera's form says under its field that a home-network address will not answer, only at a place
  without a device.

**Meldungen and Ich**
- An alert that is over is "Vorbei", so that "Erledigt" is the tasks' word; the list is in the order of its
  label, five rows with more behind "Früher", and the server lists it by when an alert ended. A row folds one
  rule's alerts of a day, and a day the loaded pages end in is read whole before a row of it states a count or
  offers its delete (`screens/Alerts.tsx`).
- A card says about delivery only what the alarm will do; a notification held back by quiet hours or a mute is
  dropped, so "after your quiet hours" is promised only of a rule that repeats.
- Start's "Heute", a place card's count, the inbox and the bell read one list of what is due for me; a task with
  somebody else's name is on `/tasks` under "Alle" only, and a reader who may only look is offered no row.
- A waiting firmware update is a card under "Offen" and counts in the bell.
- Every setting of the account is saved on the tap and answered by its own toast, whose way back writes only
  that field; "Widerrufen" answers in the toast it stood in.
- A channel that is switched on routes critical alarms, warnings and due tasks; e-mail says what it carries in
  one wording.
- An account "from before the layout" is one that was never shown a shape and owns a device.
- The units' choice stays stored and says in a line that the views show °C, grams and litres for now.
- A deleted reminder has no way back.
- At 320 px three open cards do not fit one screen; the page is laid out for 390.

**Wording** ([app-wording.md](knowledge/app-wording.md))
- What reports is "online"; a stage's climate is a "Klima-Preset" and never a "Vorlage"; what a device or a
  plan did without a person is "von allein"; the English page and the regulation are "Control".
- One wording pass set one word per thing: the growth stage is "Phase" / "phase", the page behind the bell is
  Meldungen and what is set up under Steuerung › Alarme is an Alarm, the bar's first page is Start / "Home",
  writing a line is "eintragen" / "log" and what is written an "Eintrag" / "entry".
- A place's name stands by itself, never glued behind a preposition; a device or a camera nobody named is
  called by its kind, with a scrap of its id only where two alike share a list.
- Adding a device is "hinzufügen", the prototype's word - the wording pass's "übernehmen" was wrong and is
  gone; English says "add", and "claim" is on no screen. Giving a device up is "abgeben" in the question, the
  button and the answer. Deleting an entry is "löschen"; "Widerrufen" is the undo's word alone.
- The English tag for what a device or a plan did without a person is "automatic" ("by itself" stays inside
  sentences); it replaces the tag recorded on 2026-11-12 and waits for Chris like the rest.

### Open for Chris

Each with what stands until he answers, and the session's recommendation where it has one.

**The contract**
1. **Remove what nothing asks?** The web app no longer calls `GET /v1/spaces/{id}/series`, the climate half of
   `GET /v1/grows/{id}/series` (a grow's own measurements are still read there),
   `PUT /v1/spaces/{id}/devices/{deviceId}` (a move is `PATCH /v1/devices/{id}`), or the archive routes
   (`PUT`/`DELETE /v1/spaces/{id}/archive`); nothing writes `ChartView.definition.layout: 'day_of_grow'`; nothing
   reads `dueTasks` on the home card and the overview; `AdminLogPage` is the shape of a route that was never
   built. All stay, because ADR 0001 freezes the contract. The two series routes also bound a device by its
   stay without the hand-over cut Verlauf makes. Recommendation: remove all of them but `AdminLogPage`, which
   waits for the decision about its route.
2. **What does "put away" mean?** The archive routes write the `archivedAt` a removal writes and keep people,
   invitations and links; an ended place and one put away are one state in the data, so migration step 029
   cannot tell them apart either. They ask `own` now, and a place put away refuses what an ended place
   refuses. What it still gives out is unchanged: its old share link stays readable, its guests go on reading
   it, and its old invitation is alive again once the place is brought back. Three writes on an ended place
   still go through, removed or put away: a camera put into it, a diary line or a picture on it, and a preset
   application. Nothing in the app puts a place away. Recommendation: remove the routes with question 1, and
   refuse the three writes then.
3. **The amendment to ADR 0001**, point by point - in particular that `devices.spaceId` stays beside the
   placements (stored twice, sparing a search in an array on every read about now), that a stay under five
   minutes leaves no trace, that a first placement is read back past its beginning (a device taken over
   unclaimed shows its old readings to whoever claims it first, as today), and everything under "Place and
   room" above.
4. **Migration steps 029 and 030** ran in unit tests only, not yet on a copy of production data.
5. **`POST /v1/spaces` with a `roomId`** by somebody who manages the room makes a place that belongs to the
   room's owner. Documented and tested; it stays.
6. **A guest who may manage** may rename the owner's place and change its kind; only the owner moves a device,
   sets the room and ends the place. The last place of an account cannot be removed.
7. **The server copies a device's name onto the camera it pairs**; the app treats such a name as none, but
   cannot tell once the device is renamed. Recommendation: the server names a paired camera "Terp Cam".
8. **The names of the four stage alarm rules** are written in the server and in the web app, with no shared
   constant. A rule made by one tap before the redesign is stored under its translated name; no migration
   renames it.

**Place and room**
9. **The kinds of a place.** The model has tent, fridge, balcony and other; the prototype's select reads Zelt,
   Kühlschrank, Trockenbox, Gewächshaus, Raum. The page offers the model's four. Recommendation: stay at four.
10. **May the owner read an ended place's curves?** Today Verlauf and Steuerung say that the place has ended,
    Grow still corrects such an address silently, and a past alert of an ended place offers no "Verlauf öffnen".
    Recommendation: yes, as a small step of its own.
11. **Removing a place is several writes**: a refusal half-way leaves what was done before it done, and the
    page says what is done and what is open; a reload then forgets what is still open. Recommendation: leave.
12. **The owner's ⋯ on Start** is a list of two rows and reads "Mehr" on a desktop: editing a place is two taps
    for the owner, adding a device to it three.
13. **A past alert of a device that has since moved** opens Verlauf of the old place with a device that no
    longer stands there.

**Meldungen and Ich**
14. **"Erledigt" on an open alert.** The prototype keeps an alert that got better under "Offen" until somebody
    ticks it; the server knows open and over, so it stands under "Vorbei" at once. It needs a stored field and a
    migration step. Recommendation: yes, as a small round of its own.
15. **Should an alert keep what was delivered?** Nothing is recorded per alert, so a card says nothing about the
    past. Recommendation: a small field written when the alert is raised.
16. **The units** (°F, oz, gal) are stored and no view follows. Convert the views, or remove the choice?
    Recommendation: remove the choice until the views follow.
17. **A minimum length for a password.** Today one character, in the forms and on the server alike.
    Recommendation: eight characters where a password is set, sign-in unchanged.
18. **The e-mail switch** routes what can call on the account to mail also where critical alarms already arrive
    another way. Recommendation: leave.
19. **Nothing in the app or the server**, and so no place in the redesign: testing a notification channel,
    feedback or support, editing handle, bio and avatar. The rows Premium and Über carry no summary line, as
    the prototype shows none.

**Start and Grow**
20. **A day's picture beyond the camera's retention.** Only a still that a diary line or a grow's cover names is
    spared; one still per grow day would touch what a plan keeps.
21. **What went with the tab "Wochen"**, against the rule that no old capability disappears silently - each
    comes back or is decided away: how many of a scheme week's feedings are logged ("n / m erledigt"; it needs
    two reads the tab Düngung does not make); the day/night strip and the light hours per week (the report has
    them per phase); a reading with its change from the week before (the Messwerte page has the curves); the
    days of each stage in the head's bar; strains and plant count in the head (the tab Pflanzen and the cards of
    "Alle Grows" have them); the entry tiles' captions with the last value (the watering detail says when and
    how much).
22. **What went with the second grow form**: several strains at creation (the tab Pflanzen names them
    afterwards); a feeding scheme at creation (the tab Düngung chooses one); making a new place in the form;
    the autoflower choice at creation, which moved to the grow's menu, "Name und Art".
23. **The climate sentences** in the phase, harvest and feed sheets became a line of figures or moved behind
    the help; they were written for the germination and drying rules and want one look.

**Steuerung, devices and the camera**
24. Maintenance, a restart and an update stand on the card of the place's own device and on every device's
    page, one component - against "every setting has one place" read strictly; they are done to the hardware.
25. Regulation is switched off only on the device's page, and on wherever a page says that it is off.
26. Scrubbing through one day's stills left the camera page for Verlauf's cursor.
27. "Update vom …" is offered only to a device without automatic updates; a "now" for a device on a channel
    needs a server route. Installing a build picked by hand waits for the device to be heard.
28. Keimung and Trocknung are chosen as a climate preset only, and a spell is ended in the same sheet.
    "Trocknung beenden" returns a fridge to the mode it ran before, "Keimung beenden" always to Standard.
29. Moving a device is asked and can be taken back - except into a place made in the same sheet.
30. An output is held by choosing its length: two taps where one tap held for an hour.
31. A light output's hold is known only to the browser that sent it. For every browser to say it, the server
    remembers the last light override, or the firmware reports it in the table it already sends
    (recommended) - and may it then report on every override, so a hold sent again with another length is seen?
32. A paused plan keeps no instant of its pause, so its row says why and not since when (a stored `pausedAt`
    would give the hour); its reason is stored as words in the language of whoever paused, so only the app's
    own three reasons read in the reader's language (a reason code needs the server).
33. A stand-alone LIGHT stops at 23.5 h of light: it holds two times of day, and two equal ones are no day.
34. The day in the camera's address (`?day=`) is the grow's day number, not a date.
35. "Manuell" is the off state of the switch "Automatisch aktualisieren", not an option of the channel select.
36. A Plantalytix Socket's and an AIR fan's mode, and a stream camera's Erweitert, are saved from a sheet with
    "Speichern" and not on the tap; a pump's or a timer's cycle is set only in the socket's sheet.
37. Whoever may not manage a device is not shown how many sockets it has.
38. The light limit's toast follows its last step by the 1.5 s a stepped figure rests before it is written.
39. "Jetzt ein Bild" is answered by a toast; a picture that could not be taken is said under the button.
40. A grow started with a stage writes that stage's climate to every device of the place that states targets,
    while the form asks germination's choices of the place's lead alone.

**Verlauf**
41. No free panning (the old Ctrl-drag, a two-finger pan), and Back leaves Verlauf rather than taking a zoom
    step back.
42. What went with the page "Graphen": a range typed as two dates ("Zu einem Tag springen" with zoom and step
    reaches any window), renaming a saved view (it is deleted and saved again), the four kinds a line was
    filtered by (two ticks now), and the curves of hand measurements for a grow without a place.
43. Humidity to a tenth on Verlauf and whole on Start: two figures for one reading, on purpose.
44. VPD's true extremes exist up to three days of window; storing VPD per sample would make them cheap
    everywhere and is a new stored field.
45. Not built, of the walks' trifles: a place whose history is part sparse, part dense still draws band and
    night in stripes over the sparse part. The band's help text at 320 px still scrolls inside itself, cut
    between two lines now. Looked at and found as they should be: a curve of few points is a line with its
    points, and the English temperature row at 390 px is one line.

**Left by the clearing-up round and its critic's walk**
46. The firmware screen's rename sheet is not on the shared name sheet, and the ideas still built twice named
    under "The weight" above. The fix pass after the critic's walk grew `webapp/src` by 336 lines to 71,542
    (undo answers, toasts for writes that said nothing, alerts on Start), so the session runs one consolidation
    pass over what is plainly one thing built twice; a plant's chart and the shared place's page stay apart.
    The same pass closes the last three ways into an ended place (a camera, a diary line, a preset).
47. **"automatic" as the English tag** for what a device or a plan did without a person (German "von allein");
    inside a sentence English still says "by itself". Recommendation: confirm.
48. **Rows under "Vorbei" of different rules with the same sentence read alike** now that a row folds one rule
    only ("Temperatur 7 Min zu hoch", five times). The session has the rule's name built as the row's second
    fact in the next pass; refuse it if the row should stay bare.
49. **`PATCH /v1/spaces/{id}` refuses the whole request on an ended place**, not only a name and a kind - its
    room, its retention and its preset prompt too. Recommendation: keep.
50. **No unsaved editor has a leave guard** - the feeding scheme's draft survives a change of tab inside the app
    and is lost on a reload. Recommendation: no guard; the bar at the window's foot says it is not saved.
51. **"Cam" beside "Kamera" / "camera"** is still mixed outside the brand name. Recommendation: "Kamera" and
    "camera" in sentences, "Cam" only in "Terp Cam".
52. **"Phase" / "phase" as the one word for the growth stage** (the wording pass replaced "Stadium" and
    "stage"; a rollout's "Stufe" stays). Recommendation: confirm.

### What the walks could not see

- **No such data on the session's stack**: a firmware update card and a firmware version, a camera alert, a leaf
  alert, a notification by Push or Telegram, three weeks of camera stills (so week cards and the week's film
  before the first full week), readings that follow a grow's phases, a place with two devices on a device's
  page (the rows there are covered by tests only).
- **Seen in tests only, on no running server**: `joinSpaceId`, `room_ended`, migration steps 029 and 030 (the
  critic's stack was not restarted over them); and of the pass after the clearing-up round's walk, the wider
  refusals of an ended place (a reminder, a grow, a move, a split, a correction, a change of the place) and
  Bericht's count of the grower's own entries.
- **Walked by the clearing-up round's critic and holding** (so no longer unseen): an open alert following its
  device through every way of moving it, the one list of what is due per account, the ended place's three
  refusals and the archive routes' `own` under attack, the alerts paged by when they ended over 113 alerts, a
  wrong current password's answer, a guest's notification grid, the lines that say a room ends, leaving a
  place and Back, the room's rename.
- **Not walked item by item**: the fix pass of Ich and Meldungen and the second fix pass of place and room,
  beyond what that critic met on its way; and the pass that built that critic's own list, which its builders
  saw in a browser and no critic has walked.
- **Verlauf**: the CSV download was opened in no browser; the widths between 900 and 1200 px; whose lamp is read
  across a change of device with different schedules; a device change older than a day and a plug's schedule in
  a grain in which it switched (each has a unit test and no staged place); "Kein Bild um diese Zeit" at 320 px;
  an unknown grow "asked once" has no test. Of the sixth list, after its critic's walk: rest in a zoom was seen on simulated tents, not on a real device;
  the oldest device change the stack could stage was 14.7 hours old. The integration fake windows `(start, stop]` where the store windows
  `[start, stop)` ([data.md](knowledge/data.md#influxdb)).
- **Of the clearing-up round and the pass after its walk, not seen on a screen**: a folded alert of an output
  that ran too long; a germinating device's pill; the claim's place question and a claim whose places cannot
  be read; the guest's toast when access ends while the app is open; a question asked on a page rather than in
  a sheet at the window's foot (a task's or an alert's card); an undo's answer other than the alarm switch's
  (device settings, the offline suffix and the notification saves are held by tests); a select changed by a
  real keyboard on a phone; two toasts at 1280x800 by mouse; the refused plant name, the measurement's delete
  question and the entry's delete question after the wording; the new toasts in English and any admin page in
  English; the fold's read-on at a page's edge (tests only - the walked account held less than a page of what
  is over); "+n" on a card among several places.
- **Known and left**: among two unnamed cameras of a place a guest's tag differs from the owner's, because a
  guest is not given the camera's P2P id and the tag falls back to the camera's own id. The 20 px by which one
  account page came out shorter after the clearing-up round were live data - a session row's facts fitting on
  one line.
- English "Log" as the verb for "Eintragen", and two toasts in a sheet's foot, were looked for and not met.

## Left open

Checked against the code on 2026-10-08. Take an item out once it is done.

- **Unit preferences are saved, not applied.** Ich › Darstellung stores °C/°F, g/oz and l/gal
  (`preferences.units`), but every figure is still drawn in °C, g and l, as the help beside "Einheiten" tells the
  reader (`help.units`); only the row's line on Ich reads the choice (`webapp/src/screens/me/doors.ts`).
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
