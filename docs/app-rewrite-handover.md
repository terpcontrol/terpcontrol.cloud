---
summary: The app rewrite is complete (merged 2026-10-04) and the navigation redesign on top of it is built - where their decisions and knowledge live, what the redesign session decided that Chris has not confirmed, what is open for him, what no walk could see, and what the rewrite left open; read before picking up one of those items
updated: 2026-11-14
source: migration steps 026-031 verified on a production copy on the real upgrade path (the redesign session, 2026-11-14); the second whole-app walk's report on setting up, steering and sharing decided (the redesign session of 2026-11-14); the second whole-app walk's report on Verlauf and what cuts across decided (the redesign session of 2026-11-14); the second whole-app walk's report on the grower's day decided (the redesign session of 2026-11-14); Chris's answers after the final fix round's second part (2026-11-14), and the round that built them; the whole-app walk's third report and Chris's answers built by the final fix round's second part (the redesign session of 2026-11-13); migration steps 026-030 verified on a production copy (the redesign session, 2026-11-13); the whole-app walk's third report decided (the redesign session of 2026-11-13); Chris's answers to the open questions (2026-11-13); the whole-app walk's lists built by the final fix round (the redesign session of 2026-11-13); the whole-app walk's second report decided (the redesign session of 2026-11-13); the whole-app walk's first report decided (the redesign session of 2026-11-13); Verlauf's eighth list built (the redesign session's Verlauf builder, 2026-11-13); the look "Nebel" chosen (Chris, 2026-11-13) and its values (the redesign session of 2026-11-13); what the consolidation pass left, decided (the redesign session of 2026-11-13); the consolidation pass - what was merged and what stays apart (the redesign session's consolidation pass of 2026-11-13); Verlauf's eighth walk decided (the redesign session of 2026-11-13); Verlauf's seventh list built (the redesign session's Verlauf builder, 2026-11-13); Verlauf's seventh walk decided, and a consolidation pass set (the redesign session of 2026-11-13); the list of the clearing-up round's critic built and entered (the redesign session after its critic's walk of the clearing-up round, 2026-11-13); Verlauf's sixth list built (the redesign session's Verlauf builder, 2026-11-13); the redesign section rewritten as what is true now (the redesign session's clearing-up round of 2026-11-13, from the blocks each walk had added and the session's own list of what waits for Chris); where rounds 6 and 7 meet, the inbox's, Start's tasks' and Ich's part (the redesign session of 2026-11-13); Chris on 2026-11-13 (a round for type and colour); round 7 of the navigation redesign - Ich and Meldungen (the redesign session of 2026-11-13); round 6 of the navigation redesign - place and room (the redesign session of 2026-11-12); rewrite sessions 2026-09-16..10-04 with Chris's instructions in them (2026-09-17, 2026-09-22); PR #104 and the pull requests after it; verified against the code on 2026-10-08; Chris and a read of the web app on 2026-11-11 (navigation), its first round on 2026-11-12; round 4 of the navigation redesign, its two walks and fix passes (the redesign session of 2026-11-12); Verlauf as one page (the redesign session of 2026-11-12)
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
  [server-engines.md](knowledge/server-engines.md#read-models)). **Its state:** eight walks' lists are built. The
  seventh walk found the sixth list built and holding against the samples (rest on the reading in 180 of 180
  loads, no sideways scroll at 37 widths, a silence's edges 0 s off, the 120-day read of a place 836-889 ms in the
  median). The eighth walk found the seventh list built but for one part - the curve of a slow device was still
  cut on the route, where lanes, nights and the lamp's words were whole - and two weaknesses of the new rule; its
  list (three minors and trifles) was seen by its builder, on the test stack's route and in a browser, and by no
  critic yet.
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
  fold that reads on. A consolidation pass then took what was plainly one thing built twice and ended at
  70,753 (71,533 when it began): the diary's line everywhere instead of the old row (−307), one control that switches regulation
  back on (−22), the shared maintenance control under Alarme (−30), the pill's words on a device's card (+3),
  one chip row for places and one for a stage's climates (+1, and −9 in the plan editor), the firmware sheet on
  the shared name sheet (−10), "Erweitert" as one fold (−24), the CSS declared twice and the empty states
  (−395), what the merges left without a reader (−6). `webapp/test` grew from 33,865 to 40,375, since every
  rule a walk decided got a test. The final fix round after the whole-app walk took it to 71,844 and its second
  part to 72,820 (`webapp/test` 42,748): most of the second part is refusals - the plan editor's per step and pair
  (+224), the steppers and value sheets that no longer clamp, the alarm sheet's limits -, the window link's curves
  and the guard for unsaved cells; the unit choice and the climate half of a grow's series gave lines back. What stays apart, each with its reason, is in the list of open points below
  ("Left by the clearing-up round"); what exists once is listed in
  [webapp.md](knowledge/webapp.md).
- **The look "Nebel" is chosen and built** (Chris, 2026-11-13: the type was bold
  everywhere and nothing fine, the colours neither soft nor in tune; from three proposals he chose "Nebel", and
  decided the same day that the one primary action keeps the brand green where the proposal had made it navy).
  [ADR 0002's section on the look](adr/0002-app-rewrite-frontend-stack.md#the-look-nebel) says what it is and
  changes together with `webapp/src/theme/tokens.css`. What the redesign session worked out for it, open to
  Chris:
  - Albert Sans in three weights and no bold - light for titles and figures, regular, medium for what is
    stressed; the two heavier weight tokens go. Section labels are small and in sentence case; nothing is in
    capitals. Icons are drawn at a stroke of 1.5.
  - Albert Sans has no tabular figures, so `webapp/scripts/tabular-digits.py` cuts digits of one width out of it
    as three small static faces, the way Inter's were cut.
  - Surfaces are one warm hue, ink and whatever is chosen one navy, and the signals (temperature, humidity, CO₂,
    warning, alarm) share one lightness and differ by hue; each value is worked out in OKLCH and written in
    hex. The humidity colour is a step darker than on the pictures Chris saw, because as text on the inset
    surface it came to 4.25:1; it is 4.56:1 now.
  - The soft greens ("in band", live, a grow's progress) sit on the brand green's hue, so they and the primary
    action's green are one family. A progress bar takes the soft green; only an action is filled with the brand's.
  - The lamp has a colour of its own (`--lamp`, a soft straw) on a timeline lane and a lit day; it had borrowed
    the warning's.
  - Radii 12 / 18 / 24 px; a card's shadow low and wide in the paper's hue; the page's glow is gone.
  - The server's film overlays and share-link cards are set in Albert Sans at 400 and 500 on the dark ground
    (`server/scripts/install-fonts.mjs` unpacks `@fontsource/albert-sans`); no film was rendered with it yet.
  - With the face, "×" for a typed "x" is gone everywhere: Albert Sans has no contextual alternates.

### Decided by the redesign session, not yet confirmed by Chris

Each is built unless it says otherwise, and each can be refused by itself.

**After the whole-app walk on the look's image - built by the final fix round**

Three critics walked the whole app on the image that first carried "Nebel"; the session decided what two of them
(Verlauf and what cuts across every page; the grower's day) found, and the final fix round built it. Each line is
the session's decision, open to Chris; where it is described now is in brackets. `webapp/src` went from 70,747
to 71,844 lines - most of it new function: the grow pages' plants, deletion, answers and bar (+509), the shared
line's pictures and plants, the failed state and the toast's tab order (`ui`, +202), the forms' refusals (`log`,
+184), Start's status (+77); the digit rule itself removed more than it added.
- A phase without its climate writes no device, whatever the stage ("Lassen, wie sie sind" with Trocknung put the
  tent into drying); a phase taken back says what the device goes on holding and leads to where drying or
  germination is ended; Start says a work mode the grow's phase contradicts instead of "Alles im Ziel"; a phase
  the grower set is his, not "von allein" ([app-ux.md §5 and §3](knowledge/app-ux.md)).
- "Regelung aus" stands before maintenance and is not contradicted offline; open alerts behind a status that is
  not an alert's own sentence are said in words, "3 Meldungen offen"; one state is said once on a screen (§3).
- Paper is light whatever the theme; focus is never under a bar and a toast's undo is the next tab stop; an
  unknown `space=` says so; a page that could not be read keeps its title, with one retry wording and one
  not-found page (§3, §9, §12).
- The digits of one width only where figures stand under one another or change in place; nothing falls to the
  browser's bold; the lamp's straw darker in light and its own in dark
  ([ADR 0002, "The look"](adr/0002-app-rewrite-frontend-stack.md#the-look-nebel), app-ux §9).
- A line's pictures are reached from the line, and drawn in it on a share link; a line about some plants names
  them; regulation off is a line of the day; "von allein" once per run; an alarm over says so; a folded card says
  how much of it was an alarm (§2, the day cards).
- A grow's bar is days of a scheme or the stages as segments; a harvested plant is counted as harvested; plants
  are added and removed after the start, and a grow whose diary holds only its phases can be deleted; a scheme
  chosen is saved; every write answers; one secondary button; litres are "L"; every figure in the account's number
  format; a value a form cannot read is refused with a word (§2, §12, [app-wording.md](knowledge/app-wording.md)).
- "Jetzt ein Bild" is held on a device that is not live; one caption form; the film's overlay in the owner's
  number format and the share card in the owner's language (§2, ADR 0002, [terp-cam.md](knowledge/terp-cam.md)).
- Steuerung counts a device's alarm rules from the server ([server-engines.md](knowledge/server-engines.md)).
- What this round left open Chris answered on 2026-11-13 (below), and the second part built: a share link names a
  line's plants whatever the counts switch says; a phase taken back offers no "put back"; every page is centred,
  Meldungen at 1920 px too; the cut "1" is narrower, so "11,1" closes up on Verlauf's cursor line. The critic's
  "Verlauf:" trifles, the page's keyboard order and its title were built by the second part as well (app-ux §7).
- Known and left: the 120-day read is 852-939 ms once the server has settled and up to 1.3 s right after it
  comes up; a slow network is a waterfall of three to four round trips; a silence about a step long depends on
  how it falls into the windows.

**After the whole-app walk - the third critic's list, built by the final fix round's second part**

The third critic walked setting up, steering, sharing and administering on the same image; the session decided
and the second part built (where it is described now in brackets; `webapp/src` 71,844 to 72,820):
- A target, a limit or a plan step's figure out of its range is refused in words that name the range, on the
  field and on the server, never clamped - nothing but what was typed is written to a device; saving a target
  that pauses a running plan says so from the first keystroke, Speichern is live while typing, and the toast
  names the pause (app-ux §5; [server-engines.md](knowledge/server-engines.md#device-settings-and-plans); ADR 0001).
- An alarm rule whose limits contradict each other is refused; two devices in one place cannot share a name; a
  stream camera's address must be `rtsp://` or `rtsps://` with a host before anything is added, and "Test" adds
  nothing (app-ux §5; [terp-cam.md](knowledge/terp-cam.md); [server.md](knowledge/server.md)).
- A link made for a stretch shows that stretch's curves of the places the grow stood in, and the share sheet
  from Verlauf names the window and offers the place first (app-ux §2, §7; ADR 0001).
- One danger style for every irreversible confirmation (ADR 0002, "Shape"; app-ux §9).
- "Fortsetzen" on a plan paused by "Regelung aus" asks before it switches regulation on; with regulation off
  Steuerung keeps the light and the targets in view, and the banner lists what the question lists (app-ux §5).
- No paragraph of explanation in a setting-up flow, and UTC is never named to a grower; a page's title fits at
  320 px; "Ort bearbeiten" is the edit page's title; Start's place list says the state in the device pill's
  words; the phone's top bar shows the shield everywhere (app-ux §2, §5, §9; ADR 0002).
- A guest whose access ends is led to Start; a guest without a place of his own is told so at "Kamera
  hinzufügen"; the claim says a camera as "Terp Cam gekoppelt"; the public page and a link open on the newest
  picture or on none; the plan's hold on the lamp is said in words; admin: the pinned column under a sheet's
  scrim, Flotte's columns all in view; and the trifles - "Speichern" everywhere, one toast form, "Weiter ·
  <noun>", "Abluft · Lüfter fest", "Code · QR" on its code (app-ux §2, §3, §5; app-wording; webapp.md).

**After the second whole-app walk - the grower's day, decided, not yet built**

The second walk of the grower's day found the first walk's list built (no blocker, no major) and about ten new
minors; the session decided:
- A folded week row names the phase most of its days lay in, not the phase of the week's last day.
- A folded day card shows an alarm's end wherever it shows its start.
- A part of a grow is named as a part: one plant of three harvested is that plant's harvest, not the grow's; a
  split plant's phase names the plant. Harvesting a plant answers with a toast.
- A new grow in a place that already holds a running one asks first, and Start and the bar then show both; a
  place whose grow went to "Kein fester Ort" offers "Grow hierher" with it.
- A day film whose every picture was taken in the dark is not offered. A done task's mark carries a tick. A late
  device on the camera page is said once. The head and the rail count open alerts alike.

**After the second whole-app walk - Verlauf and what cuts across, decided, not yet built**

- A window link's Verlauf shows the link's window and nothing else: its label is the window, its axis ends there,
  "jetzt" is never said, and range chips and earlier/later arrows are left out (zoom inside stays).
- Start's PPFD figure opens Verlauf on PPFD. After an alarm switch's undo focus returns to the switch.
- Every page that fails takes the shared failed state, sub pages keep their own title and back arrow, and a page
  shows its title while it loads.
- A line that records a person's action carries no "von allein", maintenance started in the app included.

**After the second whole-app walk - setting up, steering and sharing, decided, not yet built**

- A claimed controller's paired Terp Cam is made at the claim (on this image it appeared only after the device
  restarted).
- A window link - a grow's or a place's - shows its window only (as decided for Verlauf above).
- After a one-tap alarm is set up the next tab stop is the toast's undo; focus never lands on a control that
  writes on Enter.
- A new grow on its first day is not preselected "Blüte"; Steuerung names a climate preset only where one was
  applied, never by matching figures; "Grow ohne Gerät starten" proposes no place with a running grow.
- One shared danger confirm with "Abbrechen" beside it; the invite link in the app's face, never broken inside
  its code; a range refusal shows on blur or saving, not on the first digit; one filled green button per ask.

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
- A diary line is drawn one way; the row of the app before the redesign is gone from the shared place and the
  device diagnosis. On a share link a line with pictures draws them as thumbnails, as an option of the one diary
  line and nowhere else (decided after the consolidation pass: the diary is what a share link shows off, and the
  pass's brief had named the strip as what must not be lost); everywhere else the count on the line opens them.
  A line from an earlier year says its year.
- Start's status says the open alerts it does not name in words ("3 Meldungen offen") also while the place is
  offline, waiting, in maintenance or switched off, and then leads to Meldungen (`screens/start/place.ts`).
- The split sheet's and the plan editor's climate chips read the climates' own names, as the phase correction
  did (`StageClimates`, `screens/grow/ClimatePick.tsx`); "Nur die Phase" as the first chip went.

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
- A device's card says how it is heard in the pill's words ("veraltet · vor 4 Min", "offline · seit 3 Std";
  `livenessWords`, `ui/age.ts`); the hour it fell silent is on the banner and its page, no longer on the card.
- Regulation is switched back on by one block, Steuerung's, which a leading device's page mounts while it is
  off; the page's row only switches off (`ControlOff`, `screens/control/Mode.tsx`).
- Under Alarme a running maintenance is the shared control, never offering a start there: both ends named,
  with "Verlängern" and the undo it did not have (`MaintenanceControl`, `screens/devices/Maintenance.tsx`).

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
- After the seventh and the eighth walk: what a gap is follows the interval the device was keeping there, not
  the step - more than four and a half of its intervals, pooled over the twelve gaps either side and never
  taken longer than a quarter of an hour, the gap measured by its samples
  ([server-engines.md](knowledge/server-engines.md#read-models)). The server decides it once and the answer
  carries it (`resumed` on a lane's point, `silences`): one pause is one verdict in curve, band, lanes, nights,
  the lamp's line, the card and the CSV, at every range finer than it. A device that reports as slowly as it
  is drawn is one line; one that gets a few samples through every two hours is silent in between.
- The card says a silence's ends from the samples, as the lamp's line does, and snaps to no neighbour inside
  one. The last ticked curve cannot be unticked and an address that names no curve draws the first ones;
  "Keine Kurve gewählt" is gone. One sample is said as what it was; a lamp's times are to the second under a
  minute's step; the CSV has a row for the cut point after a silence.
- "x % der Zeit an" is a share of the time the device was heard, not of its samples.
- In a silence the card says "keine Messung" and between which two readings; its rows and the heads' figures
  keep the room they have at rest. A point of one sample says its stretch without "Mittel", and no stretch
  runs past the window.
- The lamp's line says a switch only where one is ("Lücke bis 13:11 · an"), each fact once; "durchgehend an"
  drops the share and names the level only below 100 %.
- A stale value is marked in a panel's head as on the card; the page is centred on a wide desktop; an `at`
  outside the drawn window leaves the address; an empty `show=` draws the first curves.
- Known and left: a silence about one step long can vanish at 30 days, and an output's own last report is read
  to the grid.

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
- An ended place also refuses a camera made in it or moved into it, a diary line or a photo about it and a
  climate preset - what a person asks for; the machines' lines are still written ([server.md](knowledge/server.md)).

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
- Rows under "Vorbei" of different rules that read alike name their rule (`screens/Alerts.tsx`).

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

**Answered by Chris on 2026-11-13** (asked one by one; the final fix round's second part built what is not marked
otherwise - where it is described now in brackets)
- The amendment to ADR 0001 (places, rooms, where a device stood, and what was added while clearing up) is
  confirmed as written. `PATCH /v1/spaces/{id}` keeps refusing the whole request on an ended place.
- What nothing asks is removed: `GET /v1/spaces/{id}/series`, the climate half of `GET /v1/grows/{id}/series`,
  `PUT /v1/spaces/{id}/devices/{deviceId}`, the archive routes (so "put away" is no state of its own any more),
  `dueTasks` and `layout: 'day_of_grow'` (ADR 0001, "The API"). **Not built**: `AdminLogPage` waits for the
  decision about its route.
- Migration steps 029 and 030 are tested on a local copy of production data before the pull request (done, item
  4 below; step 031 of this part ran in unit tests only).
- The kinds of a place were seven: Zelt, Kühlschrank, Balkon, Trockenbox, Gewächshaus, Raum, Sonstiges - the
  model's four stay and three are added; no place is migrated. "Raum" went again on 2026-11-14 (below).
- The owner may read an ended place's curves, read only (app-ux §2, Meldungen's "Verlauf öffnen" too).
- The unit choice (°F, oz, gal) is removed until views convert (app-ux §2, app-wording). No minimum length for a
  password.
- The server names a paired camera "Terp Cam". "Kamera" / "camera" in sentences, "Cam" only in "Terp Cam"
  (app-wording, terp-cam.md). "Phase" is the one word for the growth stage; "automatic" is the English tag for
  "von allein".
- Litres are "L" in both languages. A stage's week counts from the stage's own start (days 1-7 are week 1), not
  the grow's calendar weeks (app-wording, "Grow time"; ADR 0001). A share link's card carries a small logo (ADR
  0002, "The logo"). On a share link a line names its plants whatever the counts switch says (app-ux §10).
- The claim no longer asks the stage first for an account that keeps a diary (app-ux §1).
- A phase taken back gets no "put back the values" button; the question says what the tent holds and leads to
  Steuerung (app-ux §5).
- Phases stored as `preset` before the fix that made a hand-set phase the person's are migrated to the person
  (migration step 031, ADR 0001).
- The one-width "1" is cut narrower; every page is centred in the room beside the rail at wide widths, reading
  pages too; the lamp's straw at 2.4:1 in light mode stays (ADR 0002).
- The first climate chip reads "Lassen, wie sie sind" in the phase, split and plan sheets alike (app-ux §5).
- An editor with unsaved hand edits (the feeding scheme's cells) asks before it is left (app-ux §5).
- **Not in this pull request**: "Erledigt" on an open alert, and what an alert delivered stored when it is raised
  - a small round of their own after the final fix round; a light output's hold reported by the firmware, as a
  smart socket's override is, on every new command - a firmware change of its own.
- Asked again after the second part (2026-11-14): the kind "Raum" went again - a place has six kinds (Zelt,
  Kühlschrank, Balkon, Trockenbox, Gewächshaus, Sonstiges) and "Raum" is only the room that groups places; the
  contract refuses `grow_room`, which no release stored (ADR 0001, app-wording). Any change on Steuerung switches
  regulation back on while it is off, the light limit included, as built, and the switch-off question now says
  so, the banner while it is off in a few words (app-ux §5). A stream camera's address is tested by a route of its
  own that makes no camera, `POST /v1/cameras/test-captures`, which "Test" in the form uses (ADR 0001, terp-cam.md).
  The link "Ort entfernen …" is red like every irreversible way, as the second part built it.

**The contract**
4. **Migration steps 026 to 031 on a copy of production data** (the redesign session, 2026-11-13 and 14, as Chris
   asked): from the backup before the rewrite's migration all 31 steps ran in 2.1 s without a reject, every
   `legacy_*` collection reconciled, a second boot said "nothing to do", and every place and grow of the twelve
   accounts that own one read without an error (364 reads). The copy itself has no reminders, rooms, open alerts
   or preset phases, so 029-031 had nothing to do on its rows; on the real upgrade path - the copy migrated and
   used by master's own server, which left a place ended with its reminders, devices moved with open alerts, four
   phases set with a climate preset and one by a plan - 029 ended 2 reminders, 030 moved 2 alerts, 031 gave the 4
   preset phases and their diary lines to their grows' owners and left the plan's phase alone. Every stored kind
   of a place is among the six. Not covered: production as it is today (both backups are from 2026-10-08) and
   rooms on real rows; a fresh backup is the check left before production takes the release.
5. **`POST /v1/spaces` with a `roomId`** by somebody who manages the room makes a place that belongs to the
   room's owner. Documented and tested; it stays.
6. **A guest who may manage** may rename the owner's place and change its kind; only the owner moves a device,
   sets the room and ends the place. The last place of an account cannot be removed.
8. **The names of the four stage alarm rules** are written in the server and in the web app, with no shared
   constant. A rule made by one tap before the redesign is stored under its translated name; no migration
   renames it.

**Place and room**
11. **Removing a place is several writes**: a refusal half-way leaves what was done before it done, and the
    page says what is done and what is open; a reload then forgets what is still open. Recommendation: leave.
12. **The owner's ⋯ on Start** is a list of two rows and reads "Mehr" on a desktop: editing a place is two taps
    for the owner, adding a device to it three.
13. **A past alert of a device that has since moved** opens Verlauf of the old place with a device that no
    longer stands there.

**Meldungen and Ich**
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
45. Of the walks' trifles: the band's help text at 320 px still scrolls inside itself, cut between two lines.
    A read that counted no samples - a place's small charts - still takes a device that leaves few windows
    empty for a fast one.

**Left by the clearing-up round and its critic's walk**
46. **What is still built apart after the consolidation pass, each with its reason** - say where one should
    be merged all the same:
    - the two lists of a place's devices: cards with state and actions under Steuerung, plain rows under "Ort
      bearbeiten", as the prototype draws them; both stand on the shared row;
    - pausing a plan before a write and resuming it after, in four files: each site decides for itself when a
      plan must pause and which pause is its own to resume; the two transitions are one hook already;
    - the stage rows of the phase, split and entry sheets and of the claim: they differ in which stages they
      offer, in their names and in what follows the choice;
    - Steuerung's preset sheet, the claim's step and "Was wächst hier?": different questions around one list
      of climates, and two writes with different effects (one device against every device and the grow's phase);
    - the selects of "Ort entfernen" and "Neuer Grow", beside the chip row of places: as the prototype draws them;
    - rows that open what is loaded under them (the diary's week, an alert card's history), the two blocks on
      the platform's own fold with the app's chevron (settings a device has not taken, the old cloud's move),
      and "Was du tun kannst" twice - a shared part came out longer than the two;
    - a plant's chart beside the shared plot (sibling lines without the plot's dots and dashes), and the shared
      place's page, read through a link without a session - only its lines were merged;
    - 67 lines of CSS repeated by chance or on selectors that are not one class, and 34 dashed boxes set by
      hand: frames of a question, an offer or a warning, and single sentences in files without the page states.
48. **Rows under "Vorbei" of different rules with the same sentence read alike** now that a row folds one rule
    only ("Temperatur 7 Min zu hoch", five times). A row names its rule where another rule's row reads the same; refuse it if
    the row should stay bare.

**Left by the final fix round's second part** (each built as described; say where it should go otherwise)
50. **A grow's link for a stretch** reaches the curves and also the overview of each place the grow stood in,
    clamped to its stay there (the access a place's link has); a route of its own would reach the curves alone.
    Only a link whose window ends shows curves - a link onto a running grow stays its diary.
52. **"Lassen, wie sie sind" in a plan step** stands for no closer climate than the stage, since a step's preset
    writes nothing; the phase correction keeps the climates' own names ("Blüte" first), since it records how a
    phase was entered and writes nothing.
53. **A claim into a place where a grow runs** asks a diary-keeping account neither the stage nor what grows; the
    device keeps its own targets until a phase or preset is set.
54. **The guard for unsaved cells** stands on the Düngung tab: a reload from another tab of the grow loses cells
    edited there without a question (the tabs keep them while the page stays).
55. **An ended place's Verlauf** offers no saved view, though a view is the account's, not the place's.
57. **Migration step 031** gives a preset phase without `setBy` to the grow's owner, so a member who set it in a
    shared place reads as the owner; a preset applied under Steuerung is the caller's from now on, so only a plan
    writes "von allein".
58. **The English pills mix case** ("on target", "alarm", "stale" beside "Maintenance", "Control off" - the page's
    and the regulation's names are capitalised by rule).

### What the walks could not see

- **No such data on the session's stack**: a firmware update card and a firmware version, a camera alert, a leaf
  alert, a notification by Push or Telegram, three weeks of camera stills (so week cards and the week's film
  before the first full week), readings that follow a grow's phases, a place with two devices on a device's
  page (the rows there are covered by tests only).
- **The final fix round's second part, seen in tests only** (the stack ran an older server image throughout): the
  server's refusals (400 out of range, 422 `limits_contradict` and `not_a_stream_address`, 409 `name_taken` for a
  device), the new kinds of a place saved, a stage's week from its own start, a camera named "Terp Cam", migration step 031
  (on no copy of production data), a window link's curves against the new server (seen in a browser only with
  the answer laid in), the share card with its logo (rendered by its unit test and looked at as an image), the
  night guard, the browser's own leave dialog (headless Chrome draws none), "vor 1 T" kept whole, B11's refusal
  on screen. No critic has walked the second part.
- **Chris's answers of 2026-11-14, seen in tests only**: the server refusing the kind `grow_room`, and the route
  that tests a stream's address - a good address, `quatsch`, one that does not answer, a reader without manage
  rights and an offline device in its route spec, the form against it in the web app's tests. A server older than
  the route answers the form's "Test" with 404 until it is rebuilt.
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
  an unknown grow "asked once" has no test. Of the eighth list: no critic has walked it; its server part ran
  on the test stack's route (`test/specs/spaces.spec.ts`, the real read against a stand-in store) and through
  the working tree's read against a session stack's store, laid into that stack's answer for the browser -
  not on a server running against real samples. Of the seventh list, after its critic's walk: the 120-day read
  is under 1 s only on a quiet machine (887-1004 ms in the median at load 6 to 8, up to 1300 ms at load 12 to
  28), so what the pass cost could not be told from noise; slow devices were staged, none was real. Of the sixth list, after its critic's walk: rest in a zoom was seen on simulated tents, not on a real device;
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
  is over); "+n" on a card among several places. The pass after it looked at each of these on its own stack
  and saw them, except a real keyboard on a phone and an admin page in English.
- **Of the consolidation pass, not seen on a screen**: a diary line with more than two pictures on a shared
  place, a link narrowed to a window, and a public grow at its own address; the plan's note on the switch-on
  block and "Regelung aus" in Start's targets card (tests only); a reader without the right to manage under
  Alarme during maintenance; the plan editor's chips; the server's raw words in the camera form; "+n" at 390
  and during maintenance; a public page's picture in its frame; the firmware rename sheet (the stack holds no
  build).
- **Known and left**: two toasts by keyboard right after the window was resized left the older toast's select
  covered once in seven runs; a guest let in again is shown the once-only layout notice again; among two unnamed cameras of a place a guest's tag differs from the owner's, because a
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
