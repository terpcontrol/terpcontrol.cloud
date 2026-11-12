---
summary: How the web app has to behave and look - Chris's UX rules, one design without modes, honest states, value ages, help texts, Steuerung and work modes, screen readers, what was left out on purpose; read before changing a screen
updated: 2026-11-12
source: Chris (instructions, decisions and PR reviews 2025-11 to 2026-10-07); app sessions 2026-08 to 2026-10-07; the old app's simple/expert-mode document (folded in here); codebase cleanup (2026-10-08); checked against webapp/src on 2026-10-08; diary dating and no long press, Chris 2026-10-21/22; screen-reader check, Chris 2026-10-15; navigation redesign, bar and choice of place, Chris 2026-11-11; Start, the grow page with its diary and pictures, all grows and the entry sheet rebuilt after the prototype Chris accepted on 2026-11-12; the rules of the place choice and the sheet after the first walk of the new frame (2026-11-12); what the walk of the new Start decided (2026-11-12): rooms, maintenance in one tap, waiting devices, stale figures, readings as links, facts side by side
paths:
  - webapp/src/**
  - shared-types/src/v1/climate-presets.ts
  - shared-types/src/v1/configuration-fields.ts
  - shared-types/src/v1/steering.ts
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
  about (device panel, targets, charts, camera, alarm rule), drawn only where one of its items applies
  ([how an item is made](webapp.md#styling-erweitert-small-helpers)).
- **A setting is offered only where it can take effect** (Chris, 2026-10-07): "CO₂ auch nachts" needs a CO2 sensor,
  and on a tent controller a socket paired as `co2` too - a fridge has its own valve (`Tuning.advanced.tsx`).
- **Grows without devices and devices without grows are both first class** (Chris, 2026-09-16).
- **The diary is offered from the first day, and the device-only Start stays lean** (Chris, 2026-11-11; it replaces
  the rule of 2026-10-01 to design every screen first for one device, no grow and no diary). Setting a device up ends
  by asking "Was wächst hier?" (`screens/claim/GrowStep.tsx`): an answer starts the grow, so Grow and the Eintrag
  button are in the bar at once. Whoever skips finds the same question as a card on Start, "Was wächst in …?" with
  "Grow starten" and "Nein danke" (`screens/start/Offers.tsx`): "Nein danke" is kept with the account while it keeps
  no diary at all (`preferences.diary`, also under Ich › Darstellung: Automatisch / An / Aus), and with the one place
  (`presetPrompt: never`) for somebody who keeps a diary elsewhere. Until an answer the Start of a device is its
  readings, what happened last, the targets and maintenance, and nothing of the diary. An account nothing is known
  about yet is still drawn as one device without a diary (`app/shell/shape.ts`). Several places are a layer that
  appears with the second one. When a layer arrives the shell says once per account what moved
  (`app/shell/LayoutNotice.tsx`) - never a silent flip.
  - *Setup names all its steps.* The last question is a page of its own, and the list of steps names it all the
    same: the count says six, so six are listed. The page stays until its own form has been answered - the grow it
    makes is read by the claim too, and must not take the question away under a form still sending
    (`screens/claim/Claim.tsx`).
  - *What setup switches on is not announced.* A grow started as the claim's last step brings the diary into the
    bar; the grower chose that a moment ago, on a page that said what it does. The step says so before it writes
    (`expectLayout`, `api/layers.ts`) and the shell records the new layout as seen without its notice. Leaving the
    step unanswered takes the word back.
  - *"Nein danke" is answered.* The card is gone with the tap, so a toast says what holds now and where it is
    changed - "Das Tagebuch bleibt aus. Einschalten kannst du es unter Ich › Darstellung." - with "Widerrufen",
    which puts back what the account or the place said before (`tell`, `log/log-context.ts`).
- **The short form asks four things and leaves the climate alone** (`screens/grow/new/WhatGrows.tsx`): what it is,
  since when, how many plants, the phase. It writes the grow and its phase and no targets - the climate is what the
  step before it set, or what the tent was running - so its stages carry their plain names. A feeding scheme and
  the strains by name are chosen on the grow's page; the full sheet (`NewGrowSheet`, from "Alle Grows") asks them at
  once and does set the stage's climate, saying so beside its button. **It opens on the stage the place is on,
  never on germination by default** - in setup, when the step is picked up again later, and behind "Grow starten"
  on Start. Nothing stores the stage of a place without a grow (a climate preset leaves the device's settings and
  nothing else), so it is read off those (`stageOn`, `screens/start/stage.ts`): the work mode for germination and
  drying, then the stage whose climate the day's and the night's figures are, and for figures moved by hand the
  length of the day - up to 14 hours is flower. Where nothing says, the form opens on growth: a tent that already
  regulates rarely holds seeds.
- **Every device setting is reachable where values are changed**: Start's row "Zielwerte" leads to Steuerung, which
  draws the same device Erweitert as the panel under Geräte - one shared component, `DeviceAdvanced`, so a new
  setting lands in both. The targets page leaves out only what it offers itself (Betriebsart, linked as "Betriebsart
  unter Geräte"; a fridge's fans) (Chris, 2026-10-06, PR #139).
- **A fridge's fan speeds stand under its targets** (Chris, 2026-10-11): Klemmlüfter (`fans.external`) and
  Innenlüfter (`fans.internal`) are changed as often as the climate, so the targets page draws them in a block of
  their own under the day and night figures, with its own Save (`screens/control/devices/FridgeFansPanel.tsx`);
  under Geräte they stay in Erweitert.
- **No old capability disappears silently**: replace it with an equivalent or decide it away with Chris (Chris,
  2026-10-02, first said of the charts). What was decided away is in §11.

## 2. Navigation and the place page
- Bar and rail: **Start · Grow · Eintrag · Verlauf · Steuerung**, always in that order, each there for what the
  account has and the session may do (Chris, 2026-11-11): Grow with the diary; the green Eintrag button with the diary
  and the right to write a line; Verlauf with a device; Steuerung with a device the session may manage, so a member
  who may only log and the demo have none. One device without a diary is Start · Verlauf · Steuerung, a diary without
  hardware Start · Grow · Eintrag, and an account with nothing yet has no bar on the phone - Start alone is no
  choice (`app/shell/tabs.ts`, drawn from `app/shell/shape.ts`). Meldungen and Ich are not
  items: the phone's header carries the bell (a dot while something is open) and the way to Ich, the rail both at its
  foot with the open count. An item stays marked on its pages - Start on a place's page, Grow on every grow, Verlauf
  on Graphen, Steuerung on the devices, the claim and adding a camera - and a camera's page, Meldungen, the task
  list its door opens (`/tasks`, whose way back leads to Meldungen) and Ich mark none. The fleet screens of whoever
  runs the install are doors under Ich.
- **One choice of place holds for Grow, Verlauf and Steuerung** (`app/places.ts`, `app/shell/PlaceChoice.tsx`). From
  the second place on a chip names the chosen place and opens the sheet "Ort": the places under their rooms in
  Start's order, each with its status sentence and what grows there, the chosen one ticked. With one place there is
  no chip, and no page has a switcher of its own. **The chip never names a place the page is not about** (decided
  after the first walk of the new frame, 2026-11-12), which these rules keep:
  - *Where it stands.* On a phone in the header, on every address of the three items (`/grow/...`, `/timeline`,
    `/control/...`, and Graphen while it is a page); the logo gives way to its mark beside it. On a desktop in the
    rail on every page, as the head of the group Grow · Verlauf · Steuerung, framed apart from Start - so it reads as
    what those three are about and not as the title of the page beside it.
  - *What sets the choice.* A link that names a place (`?space=`, as an alert and a place's tile write it), and
    opening a page that belongs to one of the account's places: its Start, who is let into it, a grow running there
    (the grow's page, a plant, its measurements, its Graphen), its camera, its devices (`/devices?space=`). A finished
    grow, a grow in no place, all grows, Meldungen, Ich and the fleet screens belong to none and change nothing.
  - *What choosing does.* On a page of Grow, Verlauf or Steuerung the item stays and shows the chosen place at its own
    address (`/control/alarms` of one place leads to `/control` of the other); the choice is kept once that address
    is on screen, so the question about unsaved targets can still hold it back. On any other page that belongs to a
    place it leads to the chosen place's Start. On a page that belongs to none it only changes the choice.
  - *The first choice* of a browser that has none is the place Start lists first - the one that needs a person - and
    it is kept at once, so the pages do not move to another place when that one starts asking louder.
  - *A place the account has not got* in `?space=` is taken out of the address and the chosen place is shown;
    support reading a customer's place keeps the address, sees no chip, and is told "lässt sich nicht öffnen" with the
    way back where nothing is there.
- **A place is one page**, its Start at `/spaces/:id`: with one place Start is that page, with several it is one card
  per place, ordered by what needs a person. **A room has no Start of its own**: it groups places and holds
  nothing, so its address leads to Start, where it is the heading over its places, and the way back from its
  members page leads there too - drawn as a place it was an empty one that offered its own removal. Only a room
  with hardware standing in the room itself is one of Start's cards and keeps its page (`StartOfPlace`,
  `screens/start/Start.tsx`). **Grow** (`/grow/:tab?`) is the grow running in the chosen place, drawn
  as that grow's page with its tabs under the same address; where nothing grows there it offers to start a grow.
  It is a root of the bar: nothing leads back from it, and the pill "Alle Grows" stands beside the grow's name. A
  grow opened by its id (`/grows/:growId/...`) is that grow's page whatever is chosen, with the same head - the
  pill, no arrow - and Grow lit in the bar. Choosing another place there leads to Grow of that place. What stands
  under a grow - its measurements, one of its plants - leads back to the address it was opened from
  (`leadingBackTo`, `app/places.ts`). An address that names no grow the account can open says so under the
  heading "Grow", with the pill; support reading a customer's place (`/grow?space=`) is shown the grow standing
  there, as Verlauf and Steuerung show that place.
- **The first choice** of a browser that has chosen no place is one rule for Grow, Verlauf and Steuerung
  (`firstChoice`, `app/places.ts`): in Start's order the first place a grow runs in, else the first with a device,
  else the first - so Grow does not open on an empty balcony while a tent is in flower.
- **A tab replaces the history entry**: a page with tabs is one step of Back, whichever tab it was left on. What a
  page keeps for the entry it stands on - the weeks of a diary that were opened, the lines unfolded, how far it was
  scrolled - is found again by whoever comes back to it from what a line opened (`ui/kept.ts`); the pages loaded
  stay in the read's cache. A reload, or opening the page anew, starts fresh.
- **A sheet** (`ui/Sheet.tsx`) covers the bar, and the page behind it neither scrolls nor takes the focus. It closes
  on Escape, its cross (a finger wide), a tap beside it, and on a phone by pulling its handle down; the focus then
  goes back to what opened it. "L" opens the entry sheet on a desktop, with or without Shift, and never over a sheet
  that is already open.
- **Start leads with the plants** (`screens/start/PlaceStart.tsx`; the prototype Chris accepted on 2026-11-12, and
  what its first walk decided the same day). In this order: the place's name with "live · vor 20 s" and its menu;
  the newest picture taken in the light, with the grow's name and day and the picture's hour on it and temperature,
  humidity, VPD and the lamp in a bar along its foot; directly under it one line for CO₂ and the leaf sensors where
  they exist; one sentence that says how the place is; phase and week over a bar, with what is left where a feeding
  scheme states how long the grow runs; then the cards "Heute", "Zuletzt" - not drawn while nothing has happened -
  the row "Zielwerte", "Wartung · 15 Min" and "+ Ort hinzufügen". Without a camera the grow is a card of its own
  over four reading tiles; without a grow there are the tiles alone and the card that offers the diary; a diary
  kept without hardware is shown by its newest photo, the grow's name and day on it, with a card that offers a
  device. **Start changes no setting**: the targets are a summary that leads to Steuerung.
  - *One name per place.* The head is the place's name, also where the place holds nothing but a grow, and the
    menu renames what the head shows. A grow that stands in no place has no place to name and is titled by itself
    (`GrowStart.tsx`).
  - *Every reading leads to its curve.* A tap on the picture opens the camera; a tap on a figure in it, on a tile
    or on one of the further readings opens that reading - its panel of Verlauf, and Graphen on the one curve for
    VPD, which Verlauf does not draw (`curvePath`, `screens/start/readings.ts`). The line of further readings
    leaves the two light figures out while the lamp is dark.
  - *Two columns once two fit.* From 1100 px the picture, the phase and two small curves of the last day stand
    left and the cards right - of a list of places the cards left and "Heute" right. Between the rail's 900 px and
    that the page stays one column: the right column is fixed, and the left one collapsed until its readings ran
    into each other. On a desktop the sentence stands in the head between the pill and the menu, and on a row of
    its own as soon as the name leaves it no room: the head wraps before anything in it overlaps.
- **"Heute" is what is due today or overdue, each with the one tap that settles it** (`screens/start/Today.tsx`): a
  watering or a feeding opens the entry sheet on that kind ("Eintragen") and the line written there closes the task;
  a chore has nothing to enter and is ticked ("Erledigt"), and the toast names what was ticked ("Erledigt ·
  Filter reinigen", `tickedLabel`) so the "Widerrufen" beside it says what it takes back. A step of the grow plan
  waiting for its word is a row titled with the step's name, said to be the grow plan's, with "Bestätigen" beside
  it; whoever may steer the place confirms it there, after being asked, and the plan and the devices are read
  again once it has landed, so the targets' row says the new step at once. Such a step is about the grow standing
  where the plan's device stands, or about the place where nothing grows, and is found by either
  (`screens/start/due.ts`). The plan line counts what a step has left in days, hours, and in its last hour in
  minutes. A session that may write nothing is not shown the card.
- **A state is said where the picture is**: a place gone quiet says since when in a box over the picture ("Das Gerät
  meldet sich seit 13:49 nicht."), keeps the last picture, dimmed, and the last readings with their hour, offers
  what to try behind "Was du tun kannst", and its targets row says that changing them works all the same.
  **Figures that have stopped coming look it**: from stale on, the figures in the picture step back and a line
  under them says as of when they are ("Stand 13:49 · vor 8 Min"). **A device that has sent no value yet is not
  offline**: the pill says "wartet auf erste Werte", no box calls it silent, no sentence repeats it and no
  maintenance is offered that it could not hear; only a device heard long ago, whose values have left the live
  read, is offline since it was last heard (`silenceOf`, `screens/start/attention.ts`). Start that cannot be read
  at all tells its two causes apart - no answer at all is "Keine Verbindung zum Server", an answer that is a fault
  "Der Server meldet einen Fehler", which is not the reader's connection - says that the devices regulate on and
  when this browser last had an answer (`terp.loaded.<user>`), and its "Nochmal versuchen" says "Versuche es …"
  for as long as it is asking. An account with nothing is asked "Womit fängst du an?" - a device, a grow without
  one, the demo, an invitation. A member let into somebody's place is told whose it is and what they may do ("von
  @… · du darfst eintragen") and reads the targets with who can change them; the demo says under a banner that
  nothing can be changed, with the way to an account.
- **A place is one climate on Start** (Chris, 2026-11-11): its readings, its sentence and its targets are those of
  the device the server names first as the place's climate; whatever else stands there is listed under Steuerung,
  not drawn as further blocks or named in a line under the title. What becomes of places that hold two climates is
  the data model's question and still open; until then Verlauf and Graphen go on offering "Alle Geräte" or one
  climate (`?device=`, `screens/timeline/ClimatePicker.tsx`).
- **A place holds any number of devices** (Chris, 2026-10-08): a claim and the migration put each device in a place
  of its own, so the place's menu offers "Gerät hierher holen" (`screens/space/DeviceHereSheet.tsx`), and typing the
  name of an existing place in the claim's "Wo steht es?" puts the device there instead of making a second place of
  that name. **A place left empty is never removed by itself**: one with no device, camera or grow is offered to its
  owner for removal ("Ort entfernen", `screens/space/EmptyPlace.tsx`), and the owner decides: an empty tent between
  two grows is a place somebody still means to use. The one exception is the place a claim invents and the device
  leaves within that same step (`screens/claim/PlaceStep.tsx`): it was the claim's guess, never the grower's, holds
  no history, and left standing it would greet somebody adding a second device to a tent with an empty card on Start
  and an errand - the very "one device per place" the rule is meant to end. The archive is a tombstone and can be
  undone (Chris left the call to the agent, 2026-10-08).
- **A place's card says what its Start says, shorter** (`screens/start/Places.tsx`): the name, a pill - "im Ziel",
  "prüfen" or "offline" - the status sentence where the place asks for somebody, the readings in one line with the
  lamp's level last ("24,3 °C · 66 % · Licht 80 %", "Licht aus" for a dark lamp), what grows there, and the camera's
  newest picture beside them. The lamp is the climate device's own light output, or, where that has none (a fan
  leading the place), the level of a `light` device in the same place (Chris, 2026-10-13). Under the cards stand
  "Heute" across the places, each row saying where, and "+ Ort hinzufügen". **What is due is seen without
  scrolling**: a card says itself that something is due there ("1 Aufgabe fällig" - the diary's reminders and a
  plan step waiting, the same as "Heute" lists), because on a phone "Heute" stands under the cards. A place in no
  room that follows a room's cards stands under "Ohne Raum", or it would read as one more of that room's.
- **A place shares devices, a room only gathers places** (Chris, 2026-10-12, after a grower merged a tent controller
  and a fridge module into one place and found the camera under the wrong device and maintenance pausing both). Two
  devices in one place belong together: the camera, maintenance and the alarms are the place's. Devices that merely
  stand in the same room are two places in one room: Start draws a room's places under its name, where the most
  urgent of them stood (`screens/start/rooms.ts`), the place's menu offers "In einen Raum stellen" to its owner from
  the second place on - which is also where a room is made ("+ Neuer Raum") - and a device's "Umbenennen oder
  umziehen" sheet can make a new place for it ("+ Neuer Ort"), in the room it leaves. Geräte lists the devices under
  their place and its room once there are several places (`screens/devices/grouping.ts`). Where Verlauf is narrowed
  to one climate of a shared place, the camera paired to the other device is left out; a camera paired to none
  stays.
- **The menu beside a place's name holds what is done to the place** (`screens/start/PlaceMenu.tsx`; on a desktop a
  button that says "Ort bearbeiten" - the place's name is in its accessible name alone, since repeated in the
  button a long one pushed the status sentence out of the head): its name, its room, who is let in, a device
  brought here, its end. All of it needs the right to manage the place, so nobody else is drawn the menu - a ⋯
  that holds only what the reader may not do is no menu. A member who may look or log reaches who else is here,
  and the way to leave, from the line that says whose place it is. A climate preset
  is under Steuerung, sharing and moving a grow on the grow's page, and a grow is started from Start's card or from
  "Alle Grows". "+ Ort hinzufügen" offers what makes a place: a device, a grow without one, a camera of its own.
- **Any place can be removed by its owner** (Chris, 2026-10-13: "irgendwie muss es möglich sein, einen Raum, den ich
  nicht mehr haben will, zu löschen"). The place's ⋯ offers "Ort entfernen" (`screens/space/RemovePlaceSheet.tsx`):
  what still stands there - devices with their cameras, a loose camera, a running grow - moves to one place chosen in
  the sheet, then the place ends. Members still have to be taken out first, and the refusal now names each thing in
  the way (`ui/refusal.ts`) instead of a bare conflict. An ended grow no longer counts as standing in a place.
- **Steuerung opens on Zielwerte** (a running plan is the exception) with Alarme, "Automatisch nach Grow-Plan
  steuern" and "Geräte" - the account's device list, which has no item of its own in the bar - as rows under them.
  Leaving with unsaved figures, a change of the chosen place included, asks "Speichern und weiter / Verwerfen /
  Weiter bearbeiten"; on a phone the save bar takes the tab bar's place.
- **The grow page** (`screens/grow/GrowPage.tsx`; the prototype of 2026-11-12). Its head: the name, "Alle Grows"
  and the menu ⋯ - on a desktop "Phase" and "Teilen" as buttons of their own and the rest under "Mehr" - then
  "Tag 29 · Blüte, Woche 3" with the place opposite, over the bar of how far the grow has come (the same progress
  Start draws, `screens/grow/progress.ts`). A grow that has ended says how long it ran, the date it ended and where
  it stood. The menu holds what happens to a grow rather than in it (`GrowMenu.tsx`): phase, sharing, what it
  measures, moving, splitting, harvesting, its name, and four tips for the stage - each offered only to who may do
  it, and nothing is said above the tabs about what a guest may not: it is simply not offered. Tabs:
  **Tagebuch · Bilder · Pflanzen · Düngung · Bericht**; the diary is the page's own address. A long name takes
  two lines of the head and is cut there, and a sheet opened from the page is titled by what it does, not by the
  grow's name again. The page is **one column beside the rail until two fit** (the redesign session of 2026-11-12;
  a critic found the day card squeezed to a letter's width between 900 and 1200 px): the facts stand on their own line under the
  name at every width, and the newest pictures stand beside the days only from 1200 px
  (`screens/grow/diary/Diary.module.css`) - Start falls the same way at the 1100 px its own columns need. Ending a
  grow - the last plants harvested, or "Grow beenden" - lands on its report with a toast that says so.
- **The diary writes itself** (Chris, 2026-11-11; `screens/grow/diary/`): a card per day, so it reads alive for
  somebody who never types. The rules a card keeps:
  - *A day is a date* on the owner's calendar - "Heute" is since midnight - and its number is the day of the grow
    that begins on it ([app-wording.md](app-wording.md#grow-time)). The server cuts and numbers the days
    (`GET /v1/grows/{id}/diary`); the app names them: Heute, Gestern, the weekday while it names one day, then the
    date.
  - *The picture* is the camera's of that day, taken in the light nearest midday; today's is the newest lit one
    and leads to the camera, a past day's opens large. Without a camera the first photo written that day stands
    there. A day without any has no picture and no frame for one, and today has none until its lamp has come on.
  - *The climate* is the day's means in one line, and the share of the day inside the targets only where the
    server states one: it judges each window by what the device aimed at then, and says nothing of a day before
    that record began or one heard for less than half of itself. "Im Ziel" is explained once, on the newest card.
  - *The lines* are what people did and what the devices did by themselves (the redesign session of 2026-11-12,
    after a critic walked the first cards; not yet confirmed by Chris). **A grower's own line is never folded behind a device's**: up to six of their own
    show, then the fold; what the devices did fills what is left of four lines, what is out of the ordinary - a
    reading outside its targets, an alarm, a step of the plan - before the lamp (`shownLines`, `diary/days.ts`).
    **"von allein" marks only what a device or the plan did without a person**: maintenance somebody switched is
    a person's line, on and off as one ("Wartung · 2 Min"), without the mark. **A device's support log is not the
    diary**: restarts, a sensor deviating, a socket lost stay with Meldungen, the device and Verlauf. From the
    devices a day carries the lamp as one line ("Licht 00:05–12:05"; "Licht an" while it has not gone off), a
    reading outside its targets as one line however often and on whichever side ("Temperatur 3× zu hoch ·
    zusammen 1 Std"; it leads to Verlauf at that moment), an alarm by its rule's name with how often and since
    when ("Too humid · 97× seit 03:26") and under it the reading and the edge in words ("Luftfeuchte über
    60 %"), and the plan's steps. Which of these a day holds is decided where the server reads the day
    ([server-engines.md](server-engines.md#read-models)), not filtered in the page. "›" only ever means "opens
    something" and is bound to the last word of the line it ends. Every row is a finger high, and the mark takes
    room only on a line that has one (`ui/Lines.tsx`, the row Start's last lines are drawn with too). A line
    somebody may correct opens its sheet - a photo's line like any other; its words and its moment are corrected
    and the line taken back, the pictures stay. Amber is for what needs a person - an alarm raised.
  - *What was written for a moment before the grow began* has no day: the last page of the diary shows it as a
    group "Vor dem Start", after the first day.
  - *The newest three days stand open*; the days before fold into a row per week - "Tag 26 bis 22 · Blüte, Woche 2"
    with its pictures, entries and film counted - which opens its days in place. Today's card always stands; a
    past day with nothing to show is left out. "Frühere Wochen" reads eight weeks further back. From 1200 px the
    newest pictures and the week's film stand beside the days.
  - *One diary for every reader*: the public page and a share link draw the same cards (`Days`,
    `screens/grow/diary/Diary.tsx`) from the same read. A reader from outside is handed no way into the account -
    no line opens, today's picture leads to no camera, nobody is named - and is answered neither what the devices
    did nor the share of a day; how the day was and what was done to the plants is the diary. A diary that has
    ended, or one a link stopped short of, has no "Heute": its days are dates.
- **Bilder** (`screens/grow/pictures/`): Alle · Deine Fotos · Kamera - "Kamera" only where a camera watches the
  grow or once pictured it, and the choice is part of the address (`?show=`); the newest week film on top, played
  where it stands, and no film row over a list without pictures; then week by week the camera's picture of each
  day, named by its day, and the photos, marked as one's own; "+ Foto aufnehmen" opens the photo entry. A picture
  opens large - on a desktop in a dialog centred over the page, the picture filling it - with what can be made of
  it: the camera's picture of a day becomes a line of the diary and stays a camera picture, and any picture the
  grow's cover. Weeks without a picture say that of those weeks, not of the grow, while earlier weeks are still to
  be asked for. A week's film belongs to the week most of its days lie in and names only those; one shorter than
  two seconds is not offered.
- **Alle Grows** at `/grows` (`screens/grow/Grows.tsx`): the running grows as cards with their picture, day, phase
  and place (also placeless ones and those in shared places, "von @owner"), the finished ones as rows that lead to
  their report, a new grow from the button beside the title, and under "Dazu" the doors to what belongs to
  growing: Düngepläne, Freigabelinks, Abonniert, whose pages stand under `/grows/` and keep Grow lit. It lists
  every grow the session can open - a guest's shared one with whose it is, and on the tour the grow standing in
  the demo's place. It leads back to Grow, or to Ich where Ich's door opened it. Starting a grow switches the
  diary on for an account that had switched it off.
- **The entry sheet** (`log/LogSheet.tsx`): what the line is about as pills that wrap, seven tiles - Gießen,
  Düngen, Foto, Notiz, Messen, Training, Phase - and at its foot "Wann war das?" with "Ändern". A tile opens its
  view, filled in with what was done last time; the moment said on the sheet stands in that view's corner, where
  it can still be changed. Maintenance is not a kind of line: it is started on Start and with the device. What
  the critic's walk of 2026-11-12 decided:
  - *What the line is about* is the grow and then its plants. A place is a pill only where there are several to
    tell apart - one per place, the grow growing there named in it ("Zelt · Blue Dream") - or where nothing grows
    in it. One tent whose grow has no plants recorded is nothing to choose: no pills (`log/targets.ts`).
  - *A kind's view leads back to the tiles* (‹), beside the cross that closes it. "Speichern" stands on the
    sheet's bottom edge and stays in view with the keyboard up. A note that says nothing is not written.
  - *The litres can be typed* as well as stepped, and under them stands what the field opened on: "Zuletzt vor
    2 Tagen · 4,5 l". The keypad for a reading carries the decimal mark of the reader's language.
  - *No moment before the grow began*: for a line about a grow the moment's pop-up says when the grow began and
    does not take an earlier one; whoever may manage the grow is offered to move its start there ("Start auf den
    … vorverlegen", which writes the grow's `startedAt`).
  - *A phase set from its tile* is answered by a toast that names what changed - "Blüte begonnen · Spring run ·
    Zielwerte gesetzt" - with Undo only where the place's targets were not written with it.
  - *Written without a connection*, a line keeps the moment it was written at, its toast says that there is no
    connection, and it is sent by itself when the connection returns while the app is open (`log/LogProvider.tsx`).
    A refusal still says its own sentence and offers "Nochmal versuchen"; on a phone the sentence stands over its
    buttons.

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
- **A repeat is counted, not stacked**: summaries - Start's last lines and a day of the diary - fold a run of
  identical machine lines into one row, "3× seit 21:10" (`foldRepeats`, `ui/entries.ts`); Verlauf keeps every line,
  and what a person wrote never folds.
- **Amber is for what needs a person**: in a summary - Start's last lines, a day of the diary - only an alarm that
  was raised is drawn as a warning (a connection lost, a reading past its rule). That an alarm is over, a restart, a
  step of the plan and maintenance going on and off are things that happened and stand as plain lines, whatever
  severity the device sent them with (`warningOf`, `ui/entries.ts`, the one rule both read).
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
  server's clock ([webapp-time-and-language.md](webapp-time-and-language.md#the-servers-clock)). A camera is aged by
  the stills it has missed instead ([terp-cam.md](terp-cam.md#health-diary-app)).
- **A silence is dated wherever it is a sentence** - "Offline seit 10:19" on a place's card and an alert, "Das Gerät
  meldet sich seit 10:19 nicht." in the box on Start (`offlineLabel`, from `heardAt`) - so the words do not change
  while somebody reads them. The pill beside a place's name counts it instead, "offline · seit 42 Min", as it counts
  a live place's newest reading. A reading no longer live says "letzter Wert 10:19" instead of a verdict.
- **One freshness clock per screen**: the pill at the head of what it dates ("live · vor 20 s" on a place,
  `ui/LivenessPill.tsx`; a device and a camera keep theirs). The shell draws none. A place whose devices have
  sent nothing yet is none of live, stale and offline: its pill says "wartet auf erste Werte".
- **Countdowns round up and carry the unit** (59 min 30 s left is "1 Std"); elapsed ages floor (`ui/age.ts`).
- **A reading is judged as written** (`asWritten`, `ui/units.ts`): against 21 ± 1 °C "1,0 zu hoch" is in target and
  "1,1" is not, so the verdict never disagrees with the figure beside it. The band is one tolerance per metric, not
  the controller's hysteresis, and CO₂ has none at night: `TARGET_BAND`, `STEERED` and `DAY_ONLY` in
  `shared-types/src/v1/steering.ts`, which card, verdict, tiles and chart bands all read.
- The status sentence says a deviation younger than 10 min as "gerade … zu hoch" (a door opened for a look), an older
  one with "seit 14:20". Start states the live value alone and judges it; the last hour's mean, the target and the
  running outputs that each of the old tiles carried went with them (2026-11-12) - the curve, the band and what the
  outputs did are Verlauf's.

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
  - "Wartung · 15 Min" is the exception that asks nothing (decided 2026-11-12): one tap starts a quarter of an
    hour - no sheet and nothing to read first, because the hand that taps it is on the zip. While the window
    stands the same spot says until when and carries "Beenden" and "Verlängern" (another quarter of an hour), and
    the status sentence that says so leads there (`MaintenanceControl`, `screens/devices/Maintenance.tsx`). It
    parks every device of the place, since a window on one device would ring as the door opens, and says so
    where a device was not there to hear it. It is started in two places and no third (Chris, 2026-11-11): on
    Start, and with the device under Steuerung - the control is built to stand on that card as it is. Until that
    card exists, the device's panel under Geräte keeps the sheet that asks for a length and names what this
    device stops (heater, dehumidifier or compressor, CO₂ valve). Neither an alert's card nor the entry sheet
    starts one.
  - "Regelung aus" stops everything and pauses a running plan, whose next step would switch it on again; on is one tap.
  - Saving a figure a running plan writes (a target, the light limit) pauses the plan first - it would put the step's
    figure back within the hour - with its reason ("Zielwerte von Hand gesetzt", "Lichtgrenze von Hand"), says so in
    amber before the save and offers to resume - and to stop: Steuerung opens on Zielwerte for a paused plan, and a
    way out of it that is only one row further down was not found.
  - A Betriebsart other than Standard asks first: Keimung and Trocknung darken the device, Gewächshaus stops holding
    the humidity, and a tap in bloom would cost a night of light. Back to Standard is one tap.
  - Opening the demo replaces the grower's session, so it asks first. Starting a grow from the full sheet says
    beside the button that it sets the stage's climate; the short form of §1 sets none and has nothing to say.
  - A link in a mail does nothing by being opened: the activation page activates on a tap, because mail programs open
    links to preview them (`screens/Activate.tsx`).
- **No long press, anywhere** (Chris, 2026-10-21/22): a function behind a hold, a right-click or a shift-click
  irritates and stays hidden. A tap on a tile of the entry sheet opens its view, filled in with the last can; Save
  writes it (5 s Undo in the toast). A socket's times are behind its chevron, not a hold on its switch. Pressing and holding a
  stepper's +/- still repeats the step: a tap does the same thing, so nothing is hidden there.
- **Every diary line shows when it happened, and can be dated** (Chris, 2026-10-21): `log/Moment.tsx` asks it at
  the entry sheet's foot ("Wann war das? · heute · 14:32", "Ändern") and sits in the top corner of each kind's view
  ("heute · 14:32", a pencil beside it); a tap opens a pop-up with date and time, nothing after now. Water, feed,
  note, measurement, training, photo and phase take it; a photo is dated from the first picture's EXIF
  (`log/taken-at.ts`) unless a moment was said by hand. A backdated phase is dated back in the diary, but its
  climate is written now.
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
- **A Timeline lane says how hard an output worked, not only when it ran** (Chris, 2026-10-12): each slice is the
  share of its time the output ran times the level it ran at, so a compressor cycling all week reads as how often
  it ran instead of one solid bar. A lane is drawn like the curves above it - a line over a pale area between two
  grid rules - and its average over the window stands under its name in the gutter, not in a column of its own,
  so its line starts and ends where every panel's does (Chris chose this from four drafts). The pinned header keeps one place per lane with its share at the cursor, `—`
  where the device was not heard, and every figure in it at a fixed width: words appearing as an output switched
  on rewrapped the header and made the whole stack jump under a moving mouse.
- **Dimming does not shorten the day**: light hours and the Timeline count a window as lit above `out_light` 0.5 %, so
  12 h at 40 % is 12 light hours; the light panel says so where the level is set.
- **Not every mode has a day and a night** (Chris, 2026-10-03): drying, germination and 24 or 0 h of light are drawn
  and named as one band ("Trocknungsziel", "Keimungsziel", "Ziel … rund um die Uhr") without night shading; a fridge
  gliding between halves says "Ziel gerade 23,3 °C · gleitet zur Nacht". Screens follow the server's held/settling
  answer instead of assuming day and night.
- **A picture meant to show the plants is a lit still**, picked by the server: the newest lit one ("Licht aus · Bild
  von 14:20" while the lamp is off), for a day of the diary the one nearest midday, for a grow's card its cover first.

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
- **Facts side by side break between two facts, never inside one** (`ui/Facts.tsx`, decided 2026-11-12 after
  320 and 360 px showed lines ending on "·" and "Licht" parted from "aus"): "24,3 °C · 66 % · Licht 80 %" is a row
  of facts with the dot in front of each, and the dot of whatever fact starts a line is not drawn - so no line ends
  on the separator and none begins with it, a figure keeps its unit and a label its value. A fact may be a row of
  its own (the day's targets, the night's), which stays together while it fits a line. In running text a figure is
  bound to the unit after it (`unbroken`, `ui/fact-text.ts`). Start's lines, a diary line's words wherever one is
  drawn (`EntryWords`, `ui/EntryRow.tsx`), the diary's week rows and the lines of "Alle Grows" are set this way.
- A picture as bright as the page - a lit tent - keeps a hairline edge against it (`screens/start/Start.module.css`).

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
the maintenance light, the Kompressor-Pause (at least 240 s), light ramps, fan levels (also under a fridge's targets),
sensor factors and the update
channel with Manuell (Chris, 2026-10-06); the alarm sheet keeps the webhook templates.

## 12. Screen readers
The app has to be usable by somebody who cannot see it, above all the place's current state and Steuerung (Chris,
2026-10-15, asking for a screen-reader check of both). What the check of that day settled:
- **A page is named and arrived at**: the shell titles the window after the page's `<h1>` ("Blue Dream tent – Terp
  Control"; `data-title` where the heading also holds a picker) and moves focus to that heading after a navigation,
  unless the pressed control is still on the page (`app/shell/page-title.ts`).
- **A reading is said as one sentence that names it**: "Luftfeuchte 65 %, 5 % zu hoch". In the camera's picture the
  drawn figure and its label are `aria-hidden` beside a visually hidden sentence, which carries the verdict the
  picture has no room to draw; a tile is read as it stands - name, figure, verdict. The verdict is in words, never
  in the colour alone (`verdictSaid`, `screens/start/place.ts`).
- **Short forms are drawn, long forms are read** (`ui/Spoken.tsx`): screen readers spell "Ø" as "Durchmesser", drop
  the dash of "08:00–20:00" and read "3 d" letter by letter. `Spoken` pairs the two, `Dot` reads " · " as a comma's
  pause, `spokenAgo` writes an age out ("vor 3 Tagen"), `spoken.*` in the catalogues holds the sentences.
- **Live regions stay mounted and say a change once**: a region inserted together with its text is often missed, and
  one holding a ticking age ("vor 20 s") is re-read every ten seconds, so ages stay out of them. A stepper's − and +
  keep the focus and say the figure they set; the save bar's "ungespeichert / wird gesendet / gesendet um" goes
  through one region per panel, and focus lands on the sent line once the bar is gone (`ui/focus-landing.ts`).
- **A control at the end of its range is `aria-disabled`, not `disabled`**: disabling the focused button drops focus
  to the body.
- A field's name carries its unit where the unit is drawn elsewhere (`spokenUnit` of the targets table's steppers,
  the alarm limits); a switch's note is its `aria-describedby`; repeated "Ändern" links name their section.
- **Focus never falls to the body.** A control that is swapped, removed or disabled under the focus - Pause turned
  into Start, a step removed - hands it to the nearest control left where it stood (`ui/focus-rescue.ts`, on in the
  shell); a question (`Asking`) and a sheet's answer (`Answered`) take it themselves, so they are what is read.
- **What happened is said once, through the app's one live region** (`ui/live-region.ts`, `<Announce>`), never by a
  region drawn together with its text or given `role="status"` only once the answer is in.
- **A sheet makes the page behind it inert** (`ui/modal-focus.ts`): `aria-modal` alone does not keep VoiceOver on iOS or
  TalkBack inside it. The live region is left out of that.
- A slider moved by keys or a screen reader's swipe is sent once it rests (1.5 s), not on every step: the first step
  would already pause a running plan (`LightOutputRow`). Closing the plan editor with edits asks first, since screen
  reader users press Escape out of habit. A field a save is refused for is `aria-invalid` and described by why, and
  so is the Save it disables. A shell skip link leads past the navigation to `<main>`.
- A diary row says its kind as hidden words before the line (`ui/EntryRow.tsx`), so a line whose text is its kind
  word is read twice ("Gegossen, Gegossen"). Accepted for now (2026-10-15); the fix is to leave the kind out where the
  line's text already says it.
