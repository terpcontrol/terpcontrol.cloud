---
summary: How the web app has to behave and look - Chris's UX rules, one design without modes, honest states, value ages, help texts, Steuerung and work modes, what was left out on purpose; read before changing a screen
updated: 2026-10-08
source: Chris (instructions, decisions and PR reviews 2025-11 to 2026-10-06); app sessions 2026-08 to 2026-10-07; the old app's simple/expert-mode document (folded in here); checked against webapp/src on 2026-10-08
paths:
  - webapp/src/**
  - shared-types/src/v1/climate-presets.ts
  - shared-types/src/v1/configuration-fields.ts
---
# How the app behaves and looks

What a screen owes the grower. Wording and vocabulary are in [app-wording.md](app-wording.md); the technology (stack,
sessions, charts library, PWA) in [webapp.md](webapp.md), the server clock and i18n mechanics in
[webapp-time-and-language.md](webapp-time-and-language.md); colours, type, shape and layout in
[ADR 0002, "The look"](../adr/0002-app-rewrite-frontend-stack.md#the-look-the-brand); the smart-socket screens in
[smart-sockets.md](smart-sockets.md#in-the-app). Paths name where a rule is implemented (without a prefix: under
`webapp/src/`); the doc comment there usually says more.

## 1. One design, layers that appear when used
- **No persona or mode selection anywhere; one design for all growers** (Chris, 2026-09-16). The old app's
  Einfach/Experte tabs are gone: what few growers need sits in a collapsed **Erweitert** section beside the thing it is
  about (device panel, targets, cockpit foot, charts, camera, alarm rule), drawn only where one of its items applies
  ([how an item is made](webapp.md#styling-erweitert-small-helpers)).
- **Grows without devices and devices without grows are both first class** (Chris, 2026-09-16).
- **Design and judge every screen first with an account of one device, no grow and no diary** (Chris, 2026-10-01);
  an account nothing is known about yet is drawn that way (`app/shell/shape.ts`). The diary and several places are
  layers that appear when used: the diary through `preferences.diary` (Ich › Darstellung: Automatisch / An / Aus, and
  one grey line "Grow-Tagebuch einschalten · Nein danke"), several places with the second one. When a layer arrives
  the shell says once per account what moved (`app/shell/LayoutNotice.tsx`) - never a silent flip.
- **Every device setting is reachable where values are changed**: Start → place → "Ändern" beside Zielwerte draws the
  same device Erweitert as the panel under Geräte - one shared component, `DeviceAdvanced`, so a new setting lands in
  both. The targets page leaves out only what it offers itself (Betriebsart, linked as "Betriebsart unter Geräte")
  (Chris, 2026-10-06, PR #139).
- **No old capability disappears silently**: replace it with an equivalent or decide it away with Chris (Chris,
  2026-10-02, first said of the charts). What was decided away is in §11.

## 2. Navigation and the place page
- Bar and rail: **Start · Verlauf · Steuerung · Gerät** ("Geräte" once there is more than one thing, a camera
  counting). Steuerung only once there is a device to steer; the green Eintrag button in the middle only where the
  diary is kept and the session may write; a diary without hardware has Start · Eintrag · Verlauf. Tasks hang off the
  grow block and the bell (`app/shell/tabs.ts`).
- **A place is one page**, its cockpit at `/spaces/:id`: with one place Start is that cockpit, with several it is one
  card per place, ordered by what needs a person. Verlauf and Steuerung are about one place (the one a link names,
  else the last looked at), with a switcher only where there are several. Old addresses redirect.
- **The cockpit answers in the order a grower asks** (`screens/cockpit/PlaceCockpit.tsx`): is everything all right
  (one status sentence, or the offline box with three things to check), would I be told, what does it read and what
  runs, what is it set to, what grows here, what happened. On a 390×844 phone status, reading tiles and the light fit
  without scrolling. The cockpit summarises and Steuerung changes - never a second set of sliders.
- **Steuerung opens on Zielwerte** (a running plan is the exception) with Alarme and "Automatisch nach Grow-Plan
  steuern" as rows under them. Leaving with unsaved figures asks "Speichern und weiter / Verwerfen / Weiter
  bearbeiten"; on a phone the save bar takes the tab bar's place.
- **Meine Grows** at `/grows` (Chris, 2026-10-02): running grows first (also placeless ones and those in shared
  places, marked "von @owner"), then finished ones; reached from the grow block, Start and Ich, only with the diary on.

## 3. Honest states
- **A pending or failed read is never drawn as a fact** ("nothing measured", "nothing set yet"): ask a read's state
  before its data, since an empty list is also what a pending or failed read leaves (`screens/camera/CameraPage.tsx`).
  A skeleton stands only until the first failure (`api/read.ts`), then the screen says it is waiting; a failed refresh
  keeps the last answer and says "Konnte nicht aktualisieren · Stand von vor 3 Min"; a 404 says the thing "lässt sich
  nicht öffnen" - nothing is there, or whoever shared it took the reader out, which the server answers alike - with
  the way home and no retry, while a network failure keeps its retry (`ui/PageState.tsx`).
- **Every refused write says why, under the control that asked** (`Refused`, `ui/refusal.ts`): the server's sentence
  for an English reader, else the catalogue's words by problem code or status - never a bare "saving failed".
  Refusals are told apart: a rate-limited sign-in (429) is not a wrong password.
- **Claim only what happened.** A device acknowledges no setting, so a save says "stored and sent" and points at what
  the device reports. An offline device still takes changes - the cloud hands them over on the next connect, and the
  screen says so; restart and maintenance need it online.
- **A sentence about a device names only what that device does**: only a fridge and a tent controller park outputs in
  maintenance (`ui/maintenance.ts`); a controller without a CO₂ sensor has no valve to stop. A firmware quirk left as
  it is ([firmware-regulation.md](firmware-regulation.md#quirks)) is said where it shows: the light plan warns when a
  tent controller will switch the lamp on without its morning ramp (`targets.plan.hardStart`).
- **A partial picture is said as partial**: curves, lanes, nights and bands stop where a device went silent instead of
  joining across the gap; a lamp nobody has heard from is said in the past ("War an"); a verdict worked out over part
  of its window names the span it rests on rather than rating the whole day off an hour.
- **A gap names its reason**: a device whose settings document has not arrived is waited for by name, not reported as
  "nothing here holds a climate"; a missing target says why ("kein Ziel · Trocknung"; CO₂ "um diese Zeit kein Ziel").
- **Machine output is never the explanation**: a failed camera capture is named as one of the causes in
  `shared-types/src/v1/capture.ts`, translated; the raw ffmpeg text is for the owner only.
- **A repeat is counted, not stacked**: summaries fold a run of identical machine lines into one row, "3× seit 21:10"
  (`foldRepeats`, `ui/entries.ts`); the diary keeps every line, and what a person wrote never folds.
- **A link aims at what it names**: a deep link survives the sign-in round trip, and a `/log` link naming a grow or
  place the home does not draw says so (`log.notHere`) instead of quietly choosing another.
- **Only what is true for this install**: "Server in der EU" and the Premium tag only where `premium.enforced`, the
  Premium door only with a camera of the account's own.
- **Migrated data is ordinary data**: every flow has to work for the shapes listed in
  [webapp.md](webapp.md#device-data-a-screen-must-not-assume) (a grow without a plant list: Harvest offers to end it).

## 4. Every value carries an age
- **Live under 2 min, stale 2-10 min, offline after 10 min; old values are dimmed, never hidden** (Chris,
  2026-09-16). The seconds are `VALUE_AGE` (`shared-types/src/v1/value-age.ts`). A screen re-judges a value while it
  draws it (`valueAge`, `ui/age.ts`) and may only age the server's verdict, never freshen it; ages run on the
  server's clock ([webapp-time-and-language.md](webapp-time-and-language.md#the-servers-clock)).
- **A silence is said one way**, "offline seit 10:19" (`offlineLabel`): dated rather than aged, from `heardAt`, the
  same on pill, banner, card and alert. A reading no longer live says "letzter Wert · 10:19" instead of a verdict.
- **One freshness clock per screen**: on a place its pill ("● live · 20 s"); the shell's "aktualisiert vor …" line only
  on screens without readings, dated by the fetch restated with `fetchedAt()` (`ui/freshness.ts`).
- **Countdowns round up and carry the unit** (59 min 30 s left is "1 Std"); elapsed ages floor (`ui/age.ts`).
- **A reading is judged as written** (`asWritten` in the home screens' `units.ts`): against 21 ± 1 °C "1,0 zu
  hoch" is in target and "1,1" is not, so the verdict never disagrees with the figure beside it.
- The status sentence says a deviation younger than 10 min as "gerade … zu hoch" (a door opened for a look), an older
  one with "seit 14:20". Start tiles show the last hour's mean beside the live value, because duration alarms judge a
  stretch; status and colour still judge the live value (PR #143).

## 5. Controls
- **No control that goes nowhere**: a control is not drawn before what it opens exists.
- **A control the reader may not use is absent, not disabled or refused after the tap.** The ladder is view < log <
  manage < own, from `space.youMay` (`ui/session-access.ts` lists the need per kind of control). Places the reader
  cannot write to are left out of pickers; where hiding leaves a hole the screen says once what the role may do. A
  read-only session - the demo is one in every place - has no Log button and no Done. A diary line is corrected by its
  author with log, anybody else's needs manage, machine lines never; shared and public rows stay words
  (`log/corrections.ts`).
- **Offer only what exists**, derived from the hardware the device reports, never stored or asked: a setting for
  optional hardware only when `hardwareInfo` reports it (PPFD factor only with `ppfd: on`, CO₂ rows only with a
  sensor, the humidifier choice only with a socket paired as humidifier); without a camera no Premium door, Cam-Bild
  tab or weekly film; without the diary no grow films, tasks, Eintrag or feeding schemes; rooms only from a second
  place; Graphen only where something was measured. A command the device's build has not announced (holding the
  light) is not drawn, and a line says why (`screens/devices/LightOutputRow.tsx`). An unknown device type keeps its
  alarm rules readable and switchable and is offered no new one (`Device.type` is an open string).
- **Irreversible actions wait for the server** instead of the Log sheet's offline queue (`api/lifecycle.ts`: phases,
  moves, harvests, splits, preset applications). Consequences are said before the tap (a phase correction as the
  change of the day counter, a harvest as how the total is shared and when the grow ends), and a refusal is turned
  into the action it asks for.
- **What has side effects asks first and says what it does**:
  - "Wartung · 15 Min" names what this device stops (heater, dehumidifier or compressor, CO₂ valve) and parks every
    device of the place, since a window on one device would ring as the door opens. Its toast is not undoable: the
    diary line can be taken back, the pause cannot.
  - "Regelung aus" stops everything and pauses a running plan, whose next step would switch it on again; on is one tap.
  - Saving a figure a running plan writes (a target, the light limit) pauses the plan first - it would put the step's
    figure back within the hour - with its reason ("Zielwerte von Hand gesetzt", "Lichtgrenze von Hand"), says so in
    amber before the save and offers to resume.
  - A Betriebsart other than Standard asks first: Keimung and Trocknung darken the device, Gewächshaus stops holding
    the humidity, and a tap in bloom would cost a night of light. Back to Standard is one tap.
  - Opening the demo replaces the grower's session, so it asks first. Starting a grow says beside the button that it
    switches the diary on and sets the stage's climate.
  - A link in a mail does nothing by being opened: the activation page activates on a tap, because mail programs open
    links to preview them (`screens/Activate.tsx`).
- The Log sheet writes on one tap and can take it back for 5 s; the kinds in `ASKS_FIRST` (`log/LogSheet.tsx`) open
  their details first.
- **The same words never sit on two controls with opposite effects**: "Keimung · dunkel" / "Sämling · mit Licht" only
  where choosing the stage sets the device's climate (Steuerung chips, claim, plan editor, a new grow in a place it
  steers); where a stage is only recorded (phase sheet, correction, Eintrag, split) it keeps its plain name. No device
  goes dark by itself.

## 6. Help texts
- **The app explains itself: every term (VPD, phase, stage, preset, plan, maintenance, share window, …) and every
  complex control gets a help text, in English and German** (Chris, 2026-09-24).
- One primitive, `ui/Help.tsx`: `Help` is the (i) beside a control, `Term` a word with a dotted underline; both open
  `help.<topic>` as a toggletip ([topics and their test](webapp-time-and-language.md#help-topics)).
- A term is explained where it first appears on a screen - not inside a link, not where a sentence already explains
  it, not on admin-only screens. A help text must be true of the code: the first check of them all found eleven
  places where copy and behaviour disagreed, so writing one is an audit.

## 7. Charts, Timeline, day and night
- **A chart is not finished until it states a number**: each scale's ends in a gutter, both ends of the window, and a
  pinned scrub header with one value per drawn line - not a hover tooltip, which a thumb covers.
- **The charts page keeps every capability of the old one**, better rather than a copy (Chris, 2026-10-02): a place or
  a grow over 20 min to 3 years, back/forward and a start date, every reading and output (outputs as levels in %, CO₂
  valve ticks), a message lane, the camera still at the cursor, zoom, auto-update, share links, CSV and saved views;
  the view lives in the address and old bookmarks are mapped. Not carried over (Chris, 2026-10-04): curated and user
  chart presets (saved views stand in), the timelapse in place of the still, the navigator strip, ctrl-drag.
- **The CSV holds every chosen line**, also those a layout leaves off the panel - a layout must not decide what a
  grower keeps.
- **Dimming does not shorten the day**: light hours and the Timeline count a window as lit above `out_light` 0.5 %, so
  12 h at 40 % is 12 light hours; the light panel says so where the level is set.
- **Not every mode has a day and a night** (Chris, 2026-10-03): drying, germination and 24 or 0 h of light are drawn
  and named as one band ("Trocknungsziel", "Keimungsziel", "Ziel … rund um die Uhr") without night shading; a fridge
  gliding between halves says "Ziel gerade 23,3 °C · gleitet zur Nacht". Screens follow the server's held/settling
  answer instead of assuming day and night.
- **A picture meant to show the plants is a lit still**, picked by the server: the newest lit one ("Licht aus · Bild
  von 14:20" while the lamp is off), for a week card's day the one nearest midday, for a grow's card its cover first.

## 8. Steuerung and work modes
- **Day and night side by side, no switching** ("direction B", Chris, 2026-10-03), and only where the mode has them:
  Standard and Energiespar two columns; Gewächshaus temperature only (humidity is not regulated); Keimung one dark
  column (temperature, plus humidity where a humidifier holds it); Trocknung one column without light or CO₂;
  Regelung aus no table, a sentence and the way to switch on; 24 h or 0 h one column. An absent half stays as stored.
- **The light plan heads the card**: "Licht an um" (account wall clock, any minute, kept across DST) and "Dauer"; the
  night is what the day leaves. Presets change the duration, never the on-time. Late flower still enriches CO₂, to
  600 ppm against flowering's 1000 (Chris, 2026-10-08; `shared-types/src/v1/climate-presets.ts`).
- **Chips and presets only prefill a draft**; nothing applies before Speichern. Every screen reads the one preset
  table, `shared-types/src/v1/climate-presets.ts`, whose figures are deliberately conservative.
- **"Regelung ein/aus"** stands in the targets card and the device panel (Chris, 2026-10-02): a device on off - the
  factory default - must be switchable on, and screens must say that it is off. Every state away from the standard
  day and night (off, drying, another mode, a paused or waiting plan, maintenance, offline) is said where it is seen,
  with the one way out beside it (`screens/control/targets/Operation.tsx`, the plan line, the offline box).
- **Work modes come from one list** (`WORK_MODES_BY_TYPE`, `shared-types/src/v1/configuration-fields.ts`; Chris,
  2026-10-06: a value both sides use is defined once): fridge Standard, Gewächshaus, Keimung, Trocknung; tent
  controller Standard, Keimung, Trocknung (greenhouse needs wiring no tent has); plug, fan, light none. Picking
  Trocknung starts drying; any other mode ends it and the targets from before drying apply again.
- **Fridges have no "Kleine/Große Pflanzen"** (Chris, 2026-10-01): small-plant behaviour by default and an
  "Energiespar-Modus" switch (the firmware's `full`: the back-wall fan rests with the compressor) under the targets,
  in the standard mode only; its help says to try it with big plants and switch it off when the fridge runs too long
  or the lamp dims. Its dehumidifier tuning, day/night glide and "no CO₂ at sunset" are no settings (§11).
- **Keimung (dark) and Sämling (with light) are two stages on every device** (Chris, 2026-10-03). Wherever Keimung is
  set the grower chooses "Warnen, wenn es zu feucht wird" (default off) and "Luftfeuchte mit dem Befeuchter halten"
  (default on, offered only with a socket paired as humidifier) - "Der Nutzer soll die Wahl haben" (Chris).
- **Alarms must reach the grower**: while no channel delivers critical alarms, Start shows "Alarme erreichen dich
  nicht" with one tap "Per E-Mail benachrichtigen" (to the login address), "Andere Wege" and "Später" (a week, on every
  browser of the account); device setup offers the same tap (`screens/notifications/NotifyNotice.tsx`).
- **One-tap alarm templates in everyday words** ("Zu warm" from the targets, "CO₂-Flasche leer", ...) each write an
  ordinary rule and are not offered where one on the same reading and edge exists
  (`screens/control/alarms/templates.ts`); "Gerät offline" is the cloud's rule for every device.

## 9. Look, beyond ADR 0002
- Every colour, size, radius and spacing step is a token in `webapp/src/theme/tokens.css`; a component never writes a
  literal colour. A screen counts as done once it is checked in dark and light, at phone and desktop width and in
  English and German.
- Figures line up through `--font-figure`, a digits-only cut of Inter, never through `font-variant-numeric:
  tabular-nums`, which in Inter widens hyphens, stops, colons and spaces as well (ADR 0002, "The look").
- QR codes stay dark on light in dark mode (`--qr-ink`, `--qr-paper`): some scanners cannot read an inverted code.
- Amber (`--warning`) is for what is wrong and for a state somebody chose that stops regulation (Regelung aus, a plan
  paused for a figure set by hand); a running output is the light brand blue (`--output`), never amber.

## 10. Privacy in the app
No location, no comments, no feed, no directory (Chris, 2026-09-16). Harvest weights and plant counts can be logged
and are hidden from shared views by a setting (`hideWeights`, `hideCounts`), which is on by default - for a new
account and for one the migration carries over (Chris, 2026-10-08: privacy is the default). The handle is the only name others see;
no real name is stored (`shared-types/src/v1/accounts.ts`). Following a public grow puts it on one's own Start;
Follow is offered on the grow's public page and its author's profile to an account of its own, never to the demo nor
through a share link, which is a window, not a subscription (`screens/public/FollowButton.tsx`). Every sign-up agrees
to a privacy statement (the install's `PRIVACY_URL`, else the app's own `/privacy`); the server does not record it.

## 11. Left out on purpose
Old-app settings that stay out (Chris, 2026-10-02; still absent on 2026-10-08) - ask Chris before bringing one back:
- Testmodus: switching outputs by hand can damage the compressor (its old address leads to Geräte).
- Beta-Funktionen and the free ("floating") day length, which never worked; the global expert switch.
- The linear day/night transition, "no CO₂ at sunset" and the fridge's dehumidifier tuning as settings: the server
  writes them for a fridge (`server/src/modules/device-protocol/class-rules.ts`); a tent controller keeps its own.
- Alarm cooldown seconds and the extra log message per alarm; the chart presets (§7).

Everything else the old expert mode offered is under an Erweitert section (the `*.advanced.tsx` files), among them
the maintenance light, the Kompressor-Pause (at least 240 s), light ramps, fan levels, sensor factors and the update
channel with Manuell (Chris, 2026-10-06); the alarm sheet keeps the webhook templates.
