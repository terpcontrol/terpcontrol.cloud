---
summary: How the web app has to behave and look - Chris's UX rules, one design without modes, honest states, value ages, help texts, Steuerung and work modes, screen readers, what was left out on purpose; read before changing a screen
updated: 2026-11-14
source: the third whole-app walk's lists built - an entry to its grow, a correction from what was recorded, a place with its lead device, one line per alarm, a toast on its page, Steuerung's sub pages centred, one danger style and switch target, Verlauf's card clear of the zoom (the redesign session's fix round of 2026-11-14, not Chris but where it says so); a target changed by hand clears the preset's name (Chris, 2026-11-14); the second whole-app walk's lists built (the redesign session's fix round of 2026-11-14); Chris's answer of 2026-11-14 (the switch-off question and the banner say that any change on Steuerung switches regulation back on); Chris's answers of 2026-11-13 (an ended place's curves for its owner, the first climate chip, unsaved cells ask, every page centred, plants named on a share link, no unit choice, "Was wächst hier?" alone); the whole-app walk's third report built by the final fix round's second part - refusals instead of clamps, the plan's pause said first, regulation off keeping the targets, one danger style, a window link's curves, no paragraph in a setting-up flow, Verlauf's last trifles (the redesign session of 2026-11-13, not Chris); what the whole-app walk on the look's image found and the final fix round built - a phase without its climate a record, Start never contradicting the device, the digit rule, paper light, focus clear of the bars, one failed state, a line's pictures and plants, a grow's bar, every write answered (the redesign session of 2026-11-13, not Chris); nothing bold, nothing in capitals, the lamp's own colour (Chris's choice of the look "Nebel" on 2026-11-13 and the redesign session's values for it); Verlauf after its eighth walk - one verdict on a silence carried by the answer, the card's silence from the samples, one answer to "no curve" (the redesign session of 2026-11-13, not Chris); one line, one switch-on block, one maintenance control and the pill's words on a card (the redesign session's consolidation pass of 2026-11-13); Verlauf after its seventh walk - what a gap is, the card in a silence, a point of one sample, the lamp's line, a share of time (the redesign session of 2026-11-13, not Chris); a toast clear of its control by any input, a question in view, Start naming what Meldungen leads with, one form of undo answer, the fold by rule, the grow pages' answers (the redesign session after its critic's walk of the clearing-up round, 2026-11-13, not Chris); Verlauf after its sixth walk - rest in a zoom, the card's values, a lane's label, a help text cut between lines (the redesign session of 2026-11-13, not Chris); what the clearing-up round settled - an ended place at Verlauf's and Steuerung's address, a sheet that leaves its page, the one list that ranks Start, a room renamed, a toast and its row (the redesign session's clearing-up round of 2026-11-13, not Chris); where the rounds of place and room and of Ich and Meldungen meet - an alert's place, one list of what is due, the answer to "Widerrufen" (the redesign session of 2026-11-13, not Chris); round 7 of the navigation redesign - Ich and Meldungen (the redesign session of 2026-11-13, after the prototype Chris accepted on 2026-11-12) and what that session decided after its critic's walk (2026-11-13, not Chris); round 6 of the navigation redesign - the pages of a place, where a device hangs (the redesign session of 2026-11-12, after Chris's decision 5 of 2026-11-11); Chris (instructions, decisions and PR reviews 2025-11 to 2026-10-07); app sessions 2026-08 to 2026-10-07; the old app's simple/expert-mode document (folded in here); codebase cleanup (2026-10-08); checked against webapp/src on 2026-10-08; diary dating and no long press, Chris 2026-10-21/22; screen-reader check, Chris 2026-10-15; navigation redesign, bar and choice of place, Chris 2026-11-11; Start, the grow page with its diary and pictures, all grows and the entry sheet rebuilt after the prototype Chris accepted on 2026-11-12; the rules of the place choice and the sheet after the first walk of the new frame (2026-11-12); what the walk of the new Start decided (2026-11-12): rooms, maintenance in one tap, waiting devices, stale figures, readings as links, facts side by side; Steuerung, a device's own page and the camera page rebuilt after the prototype, and what an offline device has not been handed (the redesign session of 2026-11-12); what that session decided after its critic's walk of Steuerung, the device pages and the camera page (2026-11-12): one save path, the hand hold, pages by device, the arrow that steps back, toasts; Verlauf as the one page of curves, rebuilt after the prototype (the redesign session of 2026-11-12); what that session decided after its critic's second walk of Steuerung (2026-11-12): one rule for a row's line, what a fan place offers, a spell ended in the preset sheet, the alarm row's count; toasts beside an open sheet, the grow form's foot and its germination choices, 44 px by reach, a stream's address help, an undo that writes back only what its save moved, the grid of rows without a hole (the same session after its critic's second walk, 2026-11-12); what the walk of Verlauf decided (the redesign session of 2026-11-12, not Chris)
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
[ADR 0002, "The look"](../adr/0002-app-rewrite-frontend-stack.md#the-look-nebel); the smart-socket screens in
[smart-sockets.md](smart-sockets.md#in-the-app). Paths name where a rule is implemented (without a prefix: under
`webapp/src/`); the doc comment there usually says more.

## 1. One design, layers that appear when used
- **No persona or mode selection anywhere; one design for all growers** (Chris, 2026-09-16). The old app's
  Einfach/Experte tabs are gone: what few growers need sits under **Erweitert** beside the thing it is about - a page of the device, a fold of
  the camera's settings, the camera form and the alarm rule (one part, `ui/advanced/AdvancedFold.tsx`, its summary a
  finger high) -, drawn only where one of its items applies
  ([how an item is made](webapp.md#styling-erweitert-small-helpers)).
- **A setting is offered only where it can take effect** (Chris, 2026-10-07): "CO₂ auch nachts" needs a CO2 sensor,
  and on a tent controller a socket paired as `co2` too - a fridge has its own valve (`Tuning.advanced.tsx`).
- **Grows without devices and devices without grows are both first class** (Chris, 2026-09-16).
- **The diary is offered from the first day, and the device-only Start stays lean** (Chris, 2026-11-11; it replaces
  the rule of 2026-10-01 to design every screen first for one device, no grow and no diary). Setting a device up ends
  by asking "Was wächst hier?" (`screens/claim/GrowStep.tsx`): an answer starts the grow, so Grow and the Eintrag
  button are in the bar at once. An account that keeps a diary is asked that alone, with no "Was macht es
  gerade?" before it, since the answer sets the phase and its climate (Chris, 2026-11-13; `planOf`,
  `screens/claim/steps.ts`); an account that said no to the diary is still asked what the device is doing. Whoever skips it - "Jetzt nicht", or the cross on its last step - is not asked
  again at once: the question is put off for a day in this browser (`putGrowOff` / `growPutOff`,
  `screens/start/loaded.ts`; the redesign session of 2026-11-14), and then stands as a card on Start, "Was wächst
  hier?" with "Grow starten", "Grow hierher" wherever a grow could move in - opened on the grow that left this place
  for "Kein fester Ort" (`MoveHereSheet`'s `chosen`) - and "Nein danke" in the row under them (`screens/start/Offers.tsx`): "Nein danke" is kept with the account while it keeps
  no diary at all (`preferences.diary`, also under Ich › Grow-Tagebuch: Automatisch / An / Aus), and with the one place
  (`presetPrompt: never`) for somebody who keeps a diary elsewhere. Until an answer the Start of a device is its
  readings, what happened last, the targets and maintenance, and nothing of the diary. An account nothing is known
  about yet is still drawn as one device without a diary (`app/shell/shape.ts`). Several places are a layer that
  appears with the second one. When a layer arrives the shell says once per account what moved
  (`app/shell/layout-news.ts`, `LayoutNotice.tsx`) - never a silent flip. **An account from before this layout is
  told once where everything is** (the redesign session of 2026-11-13): one that was never shown a shape and
  already owns a device reads which items its bar holds, what Verlauf and Steuerung are, and where Meldungen and
  Ich went. A new account owns no device when the shell first sees it - a device is claimed inside the app, and
  the shell records the account on the claim's page too - and is told nothing; neither is a guest, whose devices
  are the host's.
  - *Setup names all its steps.* The last question is a page of its own, and the list of steps names it all the
    same: the count says six, so six are listed. The page stays until its own form has been answered - the grow it
    makes is read by the claim too, and must not take the question away under a form still sending
    (`screens/claim/Claim.tsx`).
  - *What setup switches on is not announced.* A grow started as the claim's last step brings the diary into the
    bar; the grower chose that a moment ago, on a page that said what it does. The step says so before it writes
    (`expectLayout`, `api/layers.ts`) and the shell records the new layout as seen without its notice. Leaving the
    step unanswered takes the word back.
  - *"Nein danke" is answered.* The card is gone with the tap, so a toast says what holds now and where it is
    changed - "Das Tagebuch bleibt aus. Einschalten kannst du es unter Ich › Grow-Tagebuch." - with "Widerrufen",
    which puts back what the account or the place said before (`tell`, `log/log-context.ts`).
- **The form a grow is started with asks what cannot wait** (`screens/grow/new/WhatGrows.tsx`; §2, "One form starts a
  grow"): what it is, since when, how many plants, the phase. The stage it opens on is recorded and writes no targets
  (the climate is what the step before it set, or what the tent was running), so its stages carry their plain names.
  **It opens on the stage the place is on, never on germination by default** - in setup, when the step is picked up
  again later, and behind every "Grow starten". Nothing stores the stage of a place without a grow (a climate preset
  leaves the device's settings and nothing else), so it is read off those (`stageOn`, `screens/start/stage.ts`): the
  work mode for germination and drying, else the stage whose preset the day's and the night's figures are exactly
  - never the length of the day, which read a factory controller's 12 hours of light as "Blüte" (the redesign
  session of 2026-11-14). Where nothing says, a grow started today opens on Sämling - a tent that already
  regulates rarely holds seeds - and one started earlier on no stage, its button held with "Wähl die Phase, in der
  der Grow gerade ist.": one tap must not record a grow on its first day as flowering.
- **Every setting has one place** (Chris, 2026-11-11, decision 7 of the navigation redesign; it replaces the rule
  of 2026-10-06 that Steuerung and the device list draw the same Erweitert): what a place is held at is
  Steuerung's - the light, the targets, the work mode, the outputs -, what is the hardware's is on the device's
  own page - firmware, name and place, sockets, Erweitert -, and neither offers what the other holds (§2). Start's
  row "Zielwerte" leads to Steuerung.
- **A fridge's fan speeds are changed as often as the climate** (Chris, 2026-10-11): Klemmlüfter (`fans.external`)
  and Innenlüfter (`fans.internal`) stand under Steuerung › Ausgänge as two figures, each with its sheet
  (`screens/control/devices/FridgeFansPanel.tsx`), not in Erweitert. An AIR fan's mode and speed are the fan's own
  control - the top of its place, or its own page (`FanPanel.tsx`); Ausgänge says them of a fan standing beside
  the place's own device and leads to its page, and says nothing of a fan that leads the place, whose card is
  all of it (`Outputs.tsx`; the redesign session of 2026-11-12).
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
  foot with the open count. An item stays marked on its pages - Start on a place's page, Grow on every grow,
  Steuerung on a device's pages, the claim and adding a camera - and a camera's page, Meldungen, the task
  list reached from it (`/tasks`, whose way back leads to Meldungen) and Ich mark none. The rail and the bar mark
  the same item on every address, from one function (`useIsOn`, `app/shell/tabs.ts`).
- **Ich is one card of rows, each opening a page with one subject** (`screens/Me.tsx`; the prototype Chris
  accepted on 2026-11-12, built by the redesign session of 2026-11-13): under the arrow back and "@handle" stand
  Benachrichtigungen, Konto, Darstellung, Grow-Tagebuch, Privatsphäre und Profil, Premium (with a camera of
  one's own), Über and - for an administrator, tagged "nur Admin" - Verwaltung, then "Abmelden". A row says under
  its title what its page holds today, read from the server (`screens/me/doors.ts`). **Every setting of the
  account has one page**: the zone is Konto's (with e-mail, password, sessions, the export and the account's
  end), the diary's three answers are a page of their own, and the public profile, which grows are public, what
  shared views hide and how long readings are kept are one page - the page of public grows and the second copies
  of the export and the deletion on the privacy page are gone. "Alle Grows" is a row only for an account that has
  grows and no Grow in its bar; adding a device is Start's ("+ Ort hinzufügen"). The demo is shown the two rows
  that work without an account and one sentence for the rest, and asks the server for nothing.
  - *A setting is written on the tap and answered* (`useSaveAccount`, `screens/me/save.ts`; the notification
    settings through `useWriteNotifications`): the toast names what holds now ("Zeitzone: Europe/Berlin",
    "Warnungen per E-Mail · an") and takes it back. `PATCH /me` replaces each object it is given, so the way back
    puts the one field back into the object as it stands then, and the toast is its setting's: the same switch
    answers in the same toast, another one's stands beside it (`moved`). A narrower climate window, a password, a
    session ended, a reminder deleted and an alert deleted cannot be taken back and say so by having no
    "Widerrufen". What follows is the redesign session's after its critic's walk (2026-11-13), not Chris's word:
  - *A setting says where it holds and claims nothing it does not do.* The theme is "nur in diesem Browser". A
    language chosen on Darstellung is that browser's choice and is told to the account; a browser in which nobody
    chose one follows the account's ([webapp-time-and-language.md](webapp-time-and-language.md#translations)),
    and the change is answered by a toast with the way back. No unit is offered (Chris, 2026-11-13): the views
    write °C, grams and litres, and the stored preference waits for views that convert.
  - *A refusal is said where it belongs*: a wrong current password under its field ("Das aktuelle Passwort
    stimmt nicht."), and the session stays. Deleting the account says in its question that everybody who sees
    the account's places loses them, forgets the session without asking a server that has already ended it, and
    lands on the sign-in page under "Dein Konto ist gelöscht.".
  - *E-mail is switched on one way* (`mailOn`, `screens/notifications/write.ts`): the card's switch and the
    notice's "Per E-Mail benachrichtigen" send the same request - what can call on the account, critical alarms
    and due tasks - and are answered by the same toast, whose way back removes only what that tap set. **What
    e-mail carries is said in one wording, read off the grid** (`inWords`, `screens/notifications/settings.ts`;
    `mailSaid`, `reach.ts`): the card's line, the notice's title, the tap's receipt and its toast name the rows
    the write routes, whole rows as the server routes them. The green receipt stands only while what it says
    holds.
  - *A quiet-hours time is saved on a pause, on leaving the field and on leaving the page*, never per keystroke;
    the row's title follows the fields, and a window of no length is refused in place with a sentence, beside
    which the title keeps the window that is saved.
  - *The export is found again*: the row shows the file this browser asked for, also after a reload, and offers
    a new one beside it once the file is older than the hour the route answers unchanged.
  - *The screens of whoever runs the install are behind Verwaltung*: the row opens the fleet, the four screens
    are tabs of one head whose arrow leads back to Ich, and the page of one device leads back to the fleet. A
    window narrower than the rail's 900 px is told that under the heading "Verwaltung", with the way back to Ich.
    Between that width and a table's own, the table scrolls sideways inside its card, its pinned last column is
    opaque and shaded on its edge while there is more to scroll to; what a tab's paragraphs explained stands
    behind help buttons beside the headings they belonged to.
- **Meldungen is what is open, what is due and what is over** (`screens/Alerts.tsx`, `screens/alerts/`; the
  prototype, built by the redesign session of 2026-11-13, and reworked after its critic's walk the same day -
  those rules are the session's, not Chris's). The head carries "Alles 1 Std stumm" / "Wieder laut" - every
  channel of this account for an hour, answered by a toast and taken back there - with the page's one help
  button. "Offen": a card per alert still standing, the worst first, and one per update that waits for
  somebody's word ("Firmware … ist da", for a device whose updates are off). "Aufgaben", where the diary is
  kept or a plan step waits: the rows of Start's "Heute" (`DueList`, `screens/start/Today.tsx`) and, with the
  diary, "Alle Aufgaben und Erinnerungen ›" to the task list. "Vorbei": the alerts that are over as rows, more behind "Früher"; a row opens the whole of
  it in a sheet, with its curves and "Löschen". At the foot, "Benachrichtigungen einstellen ›" - its one place:
  no card's menu carries it again (the third whole-app walk).
  - *An alert is a sentence*: "Luftfeuchte zu hoch", a reading by its full name ("Blatttemperatur"), a device
    gone quiet and a camera without pictures by their names; under it since when, where and how far out ("seit
    23:09 · Zelt · 68 % · über 60 %"); then the rule, the severity as a word and what the alarm will do. An open
    alert is dated, never aged, so its words hold still. **A reading of a device that is itself silent says so**
    ("55 % · zuletzt 22:54 · unter 65 %") and stands under everything that is about now.
  - *A card says about delivery only what is true* (`willTell`, `screens/control/alarms/rules.ts` - the one
    function for a rule's card under Steuerung › Alarme and an open alert's card): what the alarm will do with
    the account's grid, its mute and its quiet hours - "geht an dich per E-Mail", "stumm bis 07:04", "erreicht
    dich nicht", for a critical one inside the window "kommt trotz Ruhezeit durch". The server drops a message it
    holds back rather than sending it later, so "nach deiner Ruhezeit, ab 08:20" is promised only of a rule that
    repeats. What did happen is said nowhere: an alert records no delivery, and today's grid read backwards
    would be a guess.
  - *A card's actions are one row*: "Verlauf öffnen" - for everybody who sees the place, opened on the reading,
    the moment and the device (`?device=`) - and a ⋯ (`ui/Menu`) with what is occasional: the device's page for
    one gone quiet, "Diese Regel 1 Std stumm" with the line that it holds for everybody who sees the place and
    "Regel bearbeiten" for whoever manages it, and the notification settings where the alarm reaches nobody. One
    silence of each kind stands on the page: the account's in the head, a rule's behind its card's ⋯. A device
    gone quiet offers what to try behind "Was du tun kannst". Maintenance is not started here (§5).
  - *An alert is shown under the place name it carries* (`Alert.spaceName`; the redesign session of 2026-11-13,
    where the rounds of place and room and of Meldungen meet): an open alert stands where its device stands - it
    moves with the device, so the card, its ⋯, "Regel bearbeiten" and "Verlauf öffnen" name that place and Start
    marks that place alone -, and one that is over keeps the place it happened in, an ended place by the name it
    had. No card, row or sheet shows an id; without a name a card says the kind of thing. What a card offers
    goes by that place: the ⋯ and "Löschen" need `manage` there, looked up among the places in use and, for an
    ended one, among the account's ended places; "Verlauf öffnen" is offered for a place in use and, to its
    owner, for one of the reader's own that has ended (Chris, 2026-11-13; `placed`, `screens/Alerts.tsx`). A ⋯ exists
    from two items on - one item is a button in the row.
  - *"Vorbei" stands in the order of its label*: what ended last, first; a row says where (unless it is the
    reader's only place) and when - the hour today, the day before that -, and the same thing happening
    again and again in one place on one day is one row, folded by the function Start's "Zuletzt" folds with
    ("8× seit 04:59", `foldSame`, `screens/grow/diary/days.ts`). **A row folds one rule's alerts** - the fold's
    key carries the rule, so fifty rules that say the same sentence are fifty rows, each naming its rule where
    another's row reads alike - **and a fold is whole
    before it is counted or deleted**: a day the loaded pages end in is held back and read on until it is whole
    or nothing follows, and only then states a count or offers "n Meldungen löschen" (the redesign session of
    2026-11-13, after its critic deleted 45 of a row that came back as "13×"). The list is in the server's
    order, by when an alert ended; the client sorts nothing again. The sheet says how far it went against which
    bound; under a minute is "kurz"; "seitdem wieder im Ziel" is said only while the same rule on the same device
    is not open again. "Löschen" on a folded row deletes every episode in it, asked by their number ("4 Meldungen
    löschen") and answered by one toast. The server lists and pages what is over by when it ended
    ([server-engines.md](server-engines.md#alarms-and-notifications)), so "Früher" reads on in the order of the
    label. Coming back from "Verlauf öffnen" finds the rows that were unfolded, the open sheet and the scroll
    (`ui/kept.ts`).
  - *The bell counts what the page lists* (`app/shell/bell.ts`): the alerts still standing and the updates
    waiting; with nothing open, what is due for the reader. **What is due for me is one list** (`useDue`,
    `screens/start/due.ts`): the task list's "Heute" under "Meine", less what the reader may not settle - `log`
    where a reminder stands, `manage` for a plan step, the roles the server asks. Start's "Heute", a place card's
    "n Aufgaben fällig", the inbox's "Aufgaben" and the bell read it, and `/tasks` decides a tick by the same
    answer (`useSubjects`). A task with somebody else's name on it is on `/tasks` under "Alle" only; a reader who
    may only look is offered no row; a row about a place names the place, one about a grow the grow and where it
    stands. The diary's reminders come with the diary, a waiting plan step also without it, to whoever steers a
    place. It is read on the alerts' beat and on focus, so a task ticked in one tab leaves the other's bell.
  - *Not built: "Erledigt" on an open card.* The prototype keeps an alert that got better under "Offen" until
    somebody ticks it. The server knows open and over and nothing between, so such an alert stands under
    "Vorbei" at once; keeping it open needs a stored field and is Chris's to decide.
- **The task list answers and names** (`screens/Tasks.tsx`, `screens/tasks/`; the same walk): a reminder made,
  changed or deleted is answered by a toast that names it - made and changed with the way back, deleted without,
  because one made again would count from a new day; who ticked a task is named by handle once the place's
  members have answered; what the list is made of stands behind the help beside its title, and the demo is
  shown neither.
- **One choice of place holds for Grow, Verlauf and Steuerung** (`app/places.ts`, `app/shell/PlaceChoice.tsx`). From
  the second place on a chip names the chosen place and opens the sheet "Ort": the places under their rooms in
  Start's order, each with its status sentence and what grows there, the chosen one ticked. With one place there is
  no chip, and no page has a switcher of its own. **The chip never names a place the page is not about** (decided
  after the first walk of the new frame, 2026-11-12), which these rules keep:
  - *Where it stands.* On a phone in the header, on every address of the three items (`/grow/...`, `/timeline`,
    `/control/...`); the logo gives way to its mark beside it. On a desktop in the
    rail on every page, as the head of the group Grow · Verlauf · Steuerung, framed apart from Start - so it reads as
    what those three are about and not as the title of the page beside it.
  - *What sets the choice.* A link that names a place (`?space=`, as an alert and a place's tile write it), and
    opening a page that belongs to one of the account's places: its Start, who is let into it, a grow running there
    (the grow's page, a plant, its measurements), its camera, one of its devices (`/devices/:deviceId`). A finished
    grow, a grow in no place, all grows, Meldungen, Ich and the fleet screens belong to none and change nothing.
  - *What choosing does.* On a page of Grow, Verlauf or Steuerung the item stays and shows the chosen place: Grow's
    tabs and Verlauf at the item's own address, a page below Steuerung at that page - `/control/alarms` of one
    place leads to `/control/alarms` of the other, without what named a rule or a device of the place left
    (`usePlaceChoice`, `app/places.ts`; the redesign session of 2026-11-12, after its critic's walk). The other
    place has its alarms and its outputs too, and a page with nothing for it says so (below). The choice is kept
    once that address is on screen. On any other page that belongs to a place it leads to the chosen place's
    Start. On a page that belongs to none it only changes the choice.
  - *The first choice* of a browser that has none (below) is kept at once, so the pages do not move to another
    place when that one starts asking louder.
  - *A place the account has not got* in `?space=` says so, as an unknown place, grow, device or camera address
    does (`NoLongerHere`): the address stays, the chosen place stays chosen and no other place is drawn in its
    stead - on Verlauf, Steuerung and its pages and Grow (the whole-app walk of 2026-11-13; another place without a
    word read as that one's curves). Support reading a customer's place keeps the address, sees no chip, and is told
    "lässt sich nicht öffnen" with the way back where nothing is there. **A place of the account's own that has ended is said to have ended** (the
    redesign session of 2026-11-13, clearing up): Verlauf and Steuerung keep the address and draw a heading, one
    sentence and the way to Start (`PlaceEnded`, `screens/place/PlaceTitle.tsx`; `useCurrentPlace(true)` asks the
    account's ended places) - an old alert and a bookmark lead there, and another place drawn without a word read
    as that one's curves. The place's own Start address (`/spaces/:id`) says the same (`screens/start/Start.tsx`), where it
    said that whoever shared the place had taken the reader out, and so do its edit, remove and members pages
    under their own titles (`PlaceGone`, the third whole-app walk: the browser's Back after a removal leads there). Grow still takes such an address out silently.
    **The owner reads an ended place's curves** (Chris, 2026-11-13): Verlauf of one's own ended place draws the
    curves read only - no share, no saved view, no note at the cursor, no correction of a line - under one dashed
    note that the place has ended (`ended` on `Timeline`, `screens/Timeline.tsx`); the server answers the owner and
    nobody it had let in, whose rows ended with the place. **A page about a place the reader no longer sees leads
    to Start** (the redesign session of 2026-11-13, after the third critic's guest stood on the empty account's
    Steuerung): when a place the open page is about goes - Grow, Verlauf, Steuerung and their pages, a device's,
    a camera's or a grow's page of that place - the toast "Du siehst … nicht mehr" is said and the page is
    replaced by `/` (`LostSight`, `useAboutHere`, `app/shell/LostSight.tsx`; `usePagePlace`, `app/places.ts`); a
    page about another place stays.
- **A place is one page**, its Start at `/spaces/:id`: with one place Start is that page, with several it is one card
  per place, ordered by what needs a person. **A room has no page at all** (the redesign session of 2026-11-12,
  decision 5 of the navigation redesign): it is a field of the places in it - the heading over them on Start, a
  choice on "Ort bearbeiten" - and its address answers "lässt sich nicht öffnen", for the edit and the members page
  too (`screens/place/EditPlace.tsx`, `PlaceMembers.tsx`). **Grow** (`/grow/:tab?`) is the grow running in the chosen place, drawn
  as that grow's page with its tabs under the same address; where nothing grows there it offers to start a grow.
  It is a root of the bar: nothing leads back from it, and the pill "Alle Grows" stands beside the grow's name. A
  grow opened by its id (`/grows/:growId/...`) is that grow's page whatever is chosen, with the same head - the
  pill, no arrow - and Grow lit in the bar. Choosing another place there leads to Grow of that place. What stands
  under a grow - its measurements, one of its plants - has the head's arrow, which steps back to the address it
  was opened from (below). An address that names no grow the account can open says so under the
  heading "Grow", with the pill; support reading a customer's place (`/grow?space=`) is shown the grow standing
  there, as Verlauf and Steuerung show that place.
- **The first choice** of a browser that has chosen no place is one rule for Grow, Verlauf and Steuerung
  (`firstChoice`, `app/places.ts`; the redesign session of 2026-11-12): in the order Start lists the places the
  first a grow runs in, else the first with a device, else the first - so Grow does not open on an empty balcony
  while a tent is in flower. **That order exists once** (`startOrder`, `screens/start/rooms.ts`): the place that
  needs a person first, a room standing where its most urgent place does. Start's cards, the header's list and the
  first choice read it, and the choice waits for the rooms rather than choosing by half of the order. **What is
  due moves a card up by the one list of what is due for the reader** (`duePlaces` of `useDue`,
  `screens/start/due.ts`; the redesign session of 2026-11-13, clearing up), which is also what the card counts:
  no card moves up for a task its own count does not show. Start and the header's list hand it in; the first
  choice goes without. The home and a place's overview carry no due tasks (removed from the contract, Chris,
  2026-11-13): what is due is `GET /tasks`.
- **A tab replaces the history entry**: a page with tabs is one step of Back, whichever tab it was left on. What a
  page keeps for the entry it stands on - the weeks of a diary that were opened, the lines unfolded, how far it was
  scrolled - is found again by whoever comes back to it from what a line opened (`ui/kept.ts`); the pages loaded
  stay in the read's cache. A reload, or opening the page anew, starts fresh.
- **The arrow in a page's head steps back** (`ui/BackLink.tsx`; the redesign session of 2026-11-12, after its
  critic found Back leading through every page twice). On a page reached inside the app it is the browser's Back
  - the entry the reader came from, as it was left, without adding one, so the arrow and Back never disagree -
  and it is named "Zurück". On a page opened by its address (a link, a bookmark, a new tab) nothing of the app
  lies before it, and the arrow leads to the page it stands under, named by that page ("Zurück zur Steuerung");
  the page it led up to leads on up in turn, because a step back from there would only lead down again. The
  router numbers its entries from the one the document was loaded on (`history.state.idx`), which is how the
  arrow tells the two apart; a memory router has no such number, so in a test every page is one opened by its
  address unless the test draws it in a browser router (`test/back-arrow.test.tsx`). Every `BackLink` behaves
  this way, also in a head not built on `PageHead`, so no link hands a way back along. The one exception is the
  row of a socket under Ausgänge (`leadingBackTo`, `app/places.ts`): it tells the socket's page where it was
  opened, which is the address that page puts in its own place once the socket is removed - the arrow does not
  do that. **A page opened anew starts at its top** (`PageHead`), and one come back to is put where it was left
  by calling `useKeptScroll(ready)` (`ui/kept.ts`) once what it draws is there: the diary, the camera page, a
  device's own page, Steuerung.
- **A sheet** (`ui/Sheet.tsx`) covers the bar, and the page behind it neither scrolls nor takes the focus. It closes
  on Escape, its cross (a finger wide), a tap beside it, and on a phone by pulling its handle down; the focus then
  goes back to what opened it. **The browser's Back closes the sheet on top and leaves the page** (`ui/sheet-back.ts`;
  the redesign session of 2026-11-12): on a phone Back is how anything opened is put away, and from Start it took the
  reader out of the app. An open sheet stands on a history entry of its own; closed any other way it leaves that entry
  spent rather than stepping back itself - a step back races the navigation a sheet's own button may have started -
  the next sheet takes the spent entry over, and Back from one is passed on to the page - the head's arrow too: its
  step back lands on the page's own entry and is passed on from there. A sheet that is an address of its own
  (`/grows/new`) takes none (`noEntry`): Back leaves the address. **A sheet never takes its entry while a step of
  the history is on its way** - `/log` gives its address back before it opens its sheet. **A sheet that leaves its
  page for good leaves no page under it** (`leaveUnderSheet`, `app/places.ts`; the redesign session of
  2026-11-13): where the sheet's subject was left, removed or given up - a place left, "Ort entfernen" confirmed,
  a device given up, a socket removed - the sheet's own entry is stepped back from first and the way on then
  replaces the page's entry, since a `navigate(…, { replace: true })` from inside an open sheet replaces the
  sheet's entry and leaves the dead page one step of Back away. "L" opens the entry sheet on a desktop, with or
  without Shift, and never over a sheet that is already open.
- **Start leads with the plants** (`screens/start/PlaceStart.tsx`; the prototype Chris accepted on 2026-11-12, and
  what its first walk decided the same day). In this order: the place's name with "online · vor 20 s" and its menu;
  the newest picture taken in the light, with the grow's name and day and the picture's hour on it and temperature,
  humidity, VPD and the lamp in a bar along its foot; directly under it one line for CO₂ and the leaf sensors where
  they exist; one sentence that says how the place is; phase and week over a bar, with what is left where a feeding
  scheme states how long the grow runs; then the cards "Heute", "Zuletzt" - not drawn while nothing has happened -
  the row "Zielwerte", "Wartung · 15 Min" and "+ Ort hinzufügen". Without a camera the grow is a card of its own
  over four reading tiles; without a grow there are the tiles alone and the card that offers the diary; a diary
  kept without hardware is shown by its newest photo, the grow's name and day on it, with a card that offers a
  device. **Start changes no setting**: the targets are a summary that leads to Steuerung.
  - *"Zuletzt" is the tail of the diary* (the redesign session of 2026-11-12): the three newest lines as a day's
    card says them, drawn by the same row (`DiaryLine`, `screens/grow/diary/`) from what the server reads by the
    same rules ([server-engines.md](server-engines.md#read-models)) - maintenance as one line, an alarm by its
    rule, the plan's steps, no support log. A place without a grow shows what happened there by those rules. The
    lamp and a reading outside its targets are a day's and are not in it. A line stands there the moment it is
    written and is gone the moment it is taken back. An alarm is one line per rule, its start and its end
    together ("Zu warm · behoben", "Gerät offline · 2× seit 01:21"), a silence counted from when the device was
    last heard as Meldungen counts it, a camera's as "Terp Cam ohne Bild" (`alarmLines`,
    `screens/grow/diary/days.ts`), in the diary as on Start; a window of maintenance or of regulation off that
    ended within its first minute reads "Wartung beendet", never "Wartung · 0 s" (the third whole-app walk).
  - *A row of tiles has no hole*: an odd reading tile at the end takes the row.
  - *One name per place.* The head is the place's name, also where the place holds nothing but a grow, and
    "Ort bearbeiten" renames what the head shows. A grow that stands in no place has no place to name and is titled by itself
    (`GrowStart.tsx`).
  - *Every reading leads to its curve.* A tap on the picture opens the camera; a tap on a figure in it, on a tile
    or on one of the further readings opens that reading's panel of Verlauf, marked and scrolled to, VPD's
    included and PPFD's on PPFD, not on lux (`focus=ppfd`; `curvePath`, `screens/start/readings.ts`). The line of further readings
    leaves the two light figures out while the lamp is dark.
  - *Two columns once two fit.* From 1100 px the picture, the phase and two small curves of the last day stand
    left and the cards right - of a list of places the cards left and "Heute" right. Between the rail's 900 px and
    that the page stays one column: the right column is fixed, and the left one collapsed until its readings ran
    into each other. On a desktop the sentence stands in the head between the pill and the menu, and on a row of
    its own as soon as the name leaves it no room: the head wraps before anything in it overlaps, and a word of
    the name longer than the screen breaks inside it.
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
  "Der Server meldet einen Fehler", which is not the reader's connection - says that the devices regulate on
  (to an account this browser last saw with one, §3) and when this browser last had an answer (`terp.loaded.<user>`), and its "Nochmal versuchen" says "Versuche es …"
  for as long as it is asking. An account with nothing is asked "Womit fängst du an?" - a device, a grow without
  one, the demo, an invitation. A member let into somebody's place is told whose it is and what they may do ("von
  @… · du darfst eintragen"; a long room or handle is cut inside its own box and never runs under the pill) and reads the targets with who can change them; the demo says under a banner that
  nothing can be changed, with the way to an account.
- **A place is one climate on Start** (Chris, 2026-11-11): its readings, its sentence and its targets are those of
  the device the server names first as the place's climate; whatever else stands there is listed under Steuerung,
  not drawn as further blocks or named in a line under the title. **A place that already holds two climates stays
  as it is** (the redesign session of 2026-11-12, told to Chris): no migration and no screen splits it, Verlauf goes
  on naming the one drawn and leading to the other (`?device=`), and the app asks for one climate per place where a
  device is added (below).
- **The claim says a camera as "Terp Cam gekoppelt" or "keine Kamera"** (the redesign session of 2026-11-13, after
  "Cam: F33B" beside "Terp Cam koppeln"): never by a fragment of its id, and "Terp Cam koppeln" is offered only while
  none is coupled (`camCoupled`, `cameraSaid`, `screens/claim/steps.ts`). Its steps go on with "Weiter · <noun>".
- **A device that measures by itself asks once where it hangs** (Chris, 2026-11-11, decision 5; built by the
  redesign session of 2026-11-12, `screens/claim/AirStep.tsx`). Adding one - a controller, a fridge module, an AIR
  fan, a Plantalytix Socket, a LIGHT - makes a place for it, and where the account owns another place the next page
  asks "Wo hängt …?": in the air of a place that exists ("ein Klima, eine Kamera, eine Wartung" with what stands
  there) or at a new place. A fan, a socket and a lamp are offered the place that exists first, a second controller
  or fridge module the new one, because that is a second climate. The first device of an account is asked nothing;
  a flow opened from a place ("Gerät hierher holen") claims into that place and asks nothing; what hangs on a
  controller's smart socket is never claimed and never asked.
  - *The claim leaves no stray place, and is one write* (the redesign session of 2026-11-12 and, after the second
    walk, of 2026-11-13): the claim itself names the place a fan, a socket or a lamp joins (`joinSpaceId` - the
    place the flow was opened from as `spaceId`, else the first of the account's own that holds a controller or a
    fridge module, else the first; `joinOrder`, `screens/claim/steps.ts`, which is also the order the question
    offers), and the server makes a place only for a device with a climate of its own or in an account without a
    place (ADR 0001). The earlier three writes - claim, move, end the place the claim made - failed silently
    half-way and left "Zelt 2". The question then shows the answer that holds and changes it: another place, or "An
    einem neuen Ort", which makes one and moves the device - a new place whose move is refused is taken away
    again (`hang`, `Claim.tsx`). A second controller or fridge module stays in the place its claim made, and that
    place ends where the answer is a place that exists. A write of the flow that fails is said with the sentence
    for a refusal or a lost connection and tried again by the same tap. A flow left at the question leaves the
    device somewhere sensible and no "Ort 1". A place the claim makes is named in the claim's own write: the app
    sends its words for a tent and a fridge (`spaceNames`), the server picks by the type and numbers. **The
    layout is recorded as seen only on a page that draws the notice** (`useLayoutNews(drawn)`,
    `app/shell/layout-news.ts`; the redesign session of 2026-11-13): on the claim's pages nothing is recorded,
    so a second place that ends on the next answer is never announced, and a flow left there is told on the
    next page with the bar.
  - *A place's name stands by itself* (the redesign session of 2026-11-13): no sentence glues a preposition to
    it. A place option is the name alone, with what stands there in a second line ("Controller, Lüfter: ein Klima,
    eine Kamera, eine Wartung."); the settled step reads "Wo er hängt" with the name beneath, the kind added only
    where the name does not say it; the toast "Zelt: Lüfter hängt jetzt hier"; a place's own Start and the claim's
    last step ask "Was wächst hier?", and a sheet opened elsewhere is titled "<Name>: Was wächst hier?".
  - *A device that joins a climate is done there.* A fan, a socket or a lamp hung beside a controller or a fridge
    module is asked nothing more - no climate, no camera, no alarms, no grow: the flow ends on that place's Start
    with a toast that names what hangs where ("Zelt: Lüfter hängt jetzt hier"). The step that sets a climate writes
    the place's targets, so it is asked only of a controller or fridge module that is its place's first; the camera
    step only of a device that can carry one; how alarms reach somebody only while nothing reaches the account.
  - *A place the app names itself* is "Zelt", then "Zelt 2" - "Kühlschrank" for a fridge module - by the rule the
    server numbers by (`numbered`), also for a first fan, socket or lamp. Name and kind are not asked in the flow;
    they are edited on "Ort bearbeiten".
  - *A guest is offered nothing of the host's.* Only places the account owns are offered, and the server refuses a
    device in a place of another account whoever asks (ADR 0001).
  - *Adding a device leaves the bar* (`handle: BARE` on the route, `app/shell/AppShell.tsx`, as editing and ending a
    place do; on such a page the toasts stand at the window's foot - `:root:has(main[data-bare])`,
    `log/Toasts.module.css` - and the bare frame keeps a two-change toast's room under the last control,
    `.setup`): a cross ("Hinzufügen abbrechen") and "Lüfter hinzufügen · Schritt 3 von 5" over a bar, the `h1` of
    every page of the flow (`FlowHead.tsx`), so the window is titled alike throughout. **The count is said once
    it is fixed**: not before the code is taken and not on "Wo hängt …?" - that answer decides what is asked (a
    second controller beside a first is asked no climate), so the plan is fixed with it and kept in the address
    (`?device=&ask=&at=&made=`); where no place is asked, with the code. A step that is not asked is neither
    counted nor drawn nor ticked (the second walk found a count that changed and a tick on a step nobody saw). **Each step after the code is a history entry**:
    Back goes one step back, never to the code - it is spent - and from the first of them to the Start of the place
    the device hangs in; the question's own "Zurück" is that Back. **Every leave steps back over the flow's own
    entries** (`steps` in the router state, `Claim.tsx`) onto the one the code was read on and gives that to the
    place, so Back after a finished claim finds the page the flow was opened from, not a spent step. **The cross
    after the code says what is**: the device hangs somewhere whatever was left unanswered, in the sentence of
    a device that joins a climate ("Zelt: Controller hängt jetzt hier"); a flow ended by its last step says
    nothing more (the redesign session of 2026-11-13). One verb per kind, in the question, the settled
    step and the toast ("Wo steckt der Plantalytix Socket?" - "Wo er steckt"). What explains a step is behind its
    help button; nothing stands under a title or under the button. An address that names a device the account
    cannot read says so in one sentence over the code field.
- **A place left empty is never removed by itself** (Chris, 2026-10-08): one with no device, camera or grow says so
  to its owner on its Start, with the way to "Ort entfernen" (`screens/space/EmptyPlace.tsx`), and the owner
  decides: an empty tent between two grows is a place somebody still means to use. The one exception is the place a
  claim makes and the device leaves on the next page: it was the claim's guess, never the grower's, and holds no
  history.
- **Start says of a place what Meldungen leads with** (the redesign session of 2026-11-13, after its critic's
  walk of the clearing-up round): the status sentence of a place's Start and of its card names the place's first
  open alert in Meldungen's order - critical before warning, then as Meldungen sorts - and how many more there
  are ("Lüfter offline · seit 13:04 · +2", leading to Meldungen as the bell does; on a card among several the
  count is text, since the card is the link). The order exists once (`worstFirst`, `screens/alerts/inbox.ts`):
  Meldungen's open list, Start's sentence (`statusOf` over `placeAlerts`, `screens/start/place.ts`) and the
  cards' rank (`attentionOf`, `screens/start/attention.ts`) read it, and the bell counts the same list. The
  alerts are joined with the device each is about from the bell's own read (`usePlaceAlerts`,
  `screens/start/reads.ts`), so a second device of the place that has gone silent is named and not hidden
  behind the first one's "online"; the place's own silence stays the pill's and the box's. A status that
  outranks the alert sentence - offline, waiting for first values, regulation off, maintenance and its settling, a
  work mode the grow's phase contradicts - says the open alerts in words, "· 3 Meldungen offen", counted as
  Meldungen, the bell and the rail count them: every alert open in the place, its own silence included, so "1
  Meldung offen" never stands beside "Meldungen 2" (the redesign session of 2026-11-14). It is in the alarm's colour
  when one of them is critical, and then leads to Meldungen; "+2" is only for the rest
  behind an alert's own sentence (`openWords`, `screens/start/place.ts`; the redesign session of 2026-11-13 after
  the whole-app walk: a lone "+5" was a riddle). A silent place's sentence is those words alone. The demo is
  answered no alerts and is told of no device.
- **Start never contradicts what the device runs** (the same walk, after a tent left drying read "Blüte · Alles im
  Ziel"): regulation off is said before maintenance and before the minutes the alarms rest after it; an offline
  box over a device that reported regulation off before it went silent says "Die Regelung war aus" rather than
  that it goes on regulating, and a switch-off stored after it went silent is said as Steuerung says it
  ("Regelung aus gespeichert um …, noch nicht am Gerät: … regelt weiter, bis es wieder online ist"; `offNotTaken`
  with the lead device's `pending`; the redesign session of 2026-11-14); the targets row keeps "Regelung aus"
  while the device is silent. A device that dries or germinates under a
  grow whose phase is another says so in the status, in amber and leading to Steuerung ("Das Gerät trocknet, der
  Grow ist in der Phase Blüte", `contradictedModeOf`), never "Alles im Ziel". One state is said once: during
  maintenance its amber control alone says it - the status says only what stands open behind it ("2 Meldungen
  offen"), and the pill keeps "Wartung" - and the notice that alarms reach nobody waits until they can fire again; due tasks are said to reach nobody only once there is a
  reminder; an offline desktop head has the pill, the open alerts in words and the banner.
  **A place lives and falls silent with its lead device** - the one that holds its climate, whose curves it
  shows -, whatever else of it still reports (`judgedBy`, `screens/start/attention.ts`, for Start, its card and
  the header's choice of place). With regulation off a controller holds no targets, the read has no climate of
  it and its values are every device's merged, so a socket still reporting kept "online · vor 10 s" over a
  controller Steuerung called offline since 08:50 (the third whole-app walk). Silent, its place says so in the
  pill, the box - which names the silent device where the place holds several -, the status and the picture,
  whose figures say as of when they are; a device never heard is waited for. A late device is said once, by the
  pill's "veraltet · vor 2 Min": no "Stand" on the picture and no sentence under it.
- **A place's card says what its Start says, shorter** (`screens/start/Places.tsx`): the name, a pill in the
  device pill's and Steuerung's words (`pillOf`; the redesign session of 2026-11-13, after "prüfen" said nothing) -
  "im Ziel", "nicht im Ziel", "Alarm", "offline", "veraltet", "Wartung" (quiet; none once only the alarms rest,
  which the sentence says), "Regelung aus", or the work mode
  the grow's phase contradicts ("Trocknung", "Keimung"); a place that waits or has nothing to judge has none -,
  the status sentence where the place asks for somebody - what stands open behind it in the alarm's red where one
  of it is critical, as on the place's Start; none for a late device, which the pill says -, the readings in one line with the
  lamp's level last ("24,3 °C · 66 % · Licht 80 %", "Licht aus" for a dark lamp), what grows there, and the camera's
  newest picture beside them. The lamp is the climate device's own light output, or, where that has none (a fan
  leading the place), the level of a `light` device in the same place (Chris, 2026-10-13). Under the cards stand
  "Heute" across the places, each row saying where and since when it is due, and "+ Ort hinzufügen". **What is due is seen without
  scrolling**: a card says itself that something is due there ("1 Aufgabe fällig" - the diary's reminders and a
  plan step waiting, the same as "Heute" lists), because on a phone "Heute" stands under the cards. A place in no
  room that follows a room's cards stands under "Ohne Raum", or it would read as one more of that room's.
- **A place shares devices, a room only gathers places** (Chris, 2026-10-12, after a grower merged a tent controller
  and a fridge module into one place and found the camera under the wrong device and maintenance pausing both). Two
  devices in one place belong together: the camera, maintenance and the alarms are the place's. Devices that merely
  stand in the same room are two places in one room: Start draws a room's places under its name, where the most
  urgent of them stood (`screens/start/rooms.ts`), and a device's "Umbenennen oder umziehen" sheet can make a new
  place for it ("+ Neuer Ort"), in the room it leaves. Where Verlauf is narrowed to one climate of a shared place,
  the camera paired to the other device is left out; a camera paired to none stays.
- **"Ort bearbeiten" is the one page of what is done to a place** (Chris, 2026-11-11, decision 5; built by the
  redesign session of 2026-11-12 after the prototype, `screens/place/EditPlace.tsx` at `/spaces/:id/edit`). The ⋯
  beside a place's name on Start leads straight to it for a guest who manages the place - on a desktop it says
  "Ort bearbeiten", the place's name in its accessible name alone. For the owner it is a list of two rows, "Ort
  bearbeiten" and "Gerät hinzufügen" (`/claim?space=<id>`; `screens/start/PlaceStart.tsx`; the redesign session
  of 2026-11-13: one tent, add a fan, was six taps and is three), and reads "Mehr" on a desktop. The page is
  titled "Ort bearbeiten" and the name stands in its field (the redesign session of 2026-11-13: a long name and
  "bearbeiten" made six lines of title). In this order: the name, the kind - one of the six, Zelt, Kühlschrank,
  Balkon, Trockenbox, Gewächshaus, Sonstiges (Chris, 2026-11-13 and 11-14; `PLACE_KINDS`, `ui/naming.ts`) - and the
  room with the page's one button "Speichern" in its head; "Geräte hier"; "Wer … sieht"; "… entfernen …". It replaced the place's
  menu with its sheets for renaming, the room, a device brought here and the removal, and the page "Mitglieder &
  Teilen".
  - *Name, kind and room are one save*, answered by a toast that names each change - the new name, the kind, the
    room by its stored name and not as it was typed - and takes all of it back; "Widerrufen" is answered with
    what holds again (in the shared toast, §5). Renaming or regrouping writes nothing into a grow. Without a connection the save fails at once, with the sentence for a lost connection and the
    button to send it again: every write is sent whatever the browser believes about the connection (`WRITES`,
    `api/query-client.ts`), because one held back until the browser said "online" left "Speichert …" standing.
  - *A name is unique among one's places.* The page says "Ein anderer Ort heißt schon „…“" under the field while it
    is typed and keeps "Speichern" off; the server refuses the same (`name_taken`), and its sentence is shown where
    the page could not know. Upper and lower case and blanks make no second name (`nameKey`, shared with the server).
  - *A room is a field, and says whom it lets in* (the redesign session of 2026-11-12, after the round's walk): one
    of the owner's rooms, "Neuer Raum …" with its name, or "Kein Raum", asked from the second place on and of the
    owner only. An option carries its people ("Keller · 1 Person sieht mit"), and the save toast names who sees the
    place now and who no longer does. **A room exists only while a place stands in it**: taking the last place out
    of a room that has members asks first, in a sheet that names them - the room ends and their way in with it -
    and that write has no undo. Nobody makes or deletes a room by itself. **A room is renamed from the same
    field** (the redesign session of 2026-11-13, clearing up): an entry of the select names the place's room,
    the name is typed where a new room's is, and it is a write of its own to the room, answered by a toast with
    the way back; a name another room carries is said under the field before anything is sent.
  - *"Geräte hier"* lists the devices and cameras standing there, each leading to its page, and, for the owner of
    the place, "+ Gerät hierher holen": a device of the same account standing elsewhere moves by the device's own
    sheet, opened with this place chosen - it says what goes along, and the toast takes the move back -, a new one
    by its code (`/claim?space=`). A device stands only in a place of its owner (ADR 0001), so a member who manages
    the place is offered neither, and the device's sheet asks only its owner where it stands: for anybody else
    the row and the sheet read "Umbenennen" (`screens/devices/DevicePage.tsx`). "Widerrufen" of a move or a name
    is answered like every undo of the page, with where the device stands again (`DeviceSettingsSheet.tsx`); a
    Terp Cam nobody named that goes along is "Kamera Terp Cam", its tag only where two go along.
    **A device or a Terp Cam nobody named is called by its kind** and carries the last four letters or figures of
    its id only where two of a kind without a name stand in that one list ("Lüfter · FAN1", "Lüfter · 6FAN"; the
    redesign session of 2026-11-13) - `deviceTitle(device, t, among)` with `among` the list the row stands in,
    `camerasCalled` (`ui/camera-name.ts`) for the cameras of a list, under Steuerung as in "Ort bearbeiten" (a
    place's only camera is "Terp Cam" in both); the tag is never broken from the kind
    (`devices.unnamed`), and a camera's is cut by the one function a device's is (`camTag`). A device's own
    page, its card under Steuerung and the sheets opened from either name it among the devices of its place
    (`standingWith`, `ui/naming.ts`), so the page is headed as the card names it, and the move's toast tells two
    apart only where both stand in the place left or the place come to. A camera that carries its device's name
    or type has no name of its own (`cameraTitle`).
  - *"Wer … sieht" is one list of everybody who sees the place* (`screens/space/members/Members.tsx`): the owner
    ("Du · verwaltest"), the place's own guests, and the members of its room tagged "über Keller", each row with
    what they may do and the way out; a write goes to the row it is about, the room's included. What each role may
    do is behind the help button beside the heading - no table on the page. The links that are out stand under the
    list, each saying what it is for; "+ Jemanden einladen" opens the ways in, and "Einladung gilt für" inside it
    changes only what the next invitation is for - this place or its room - and closes nothing. **Every write here
    answers**: a role with a toast and undo, a removal with a toast that also names the link it stopped, an undo
    with what holds again. Taking an invitation link back cannot be taken back - the server keeps a revoked code
    revoked - so "Zurückziehen" asks first, in the link's card, in one sentence (`ui/Asking.tsx`), and the toast
    names what the link was for ("Der Link … gilt nicht mehr · für Zelt · darf steuern"; `InviteBlock.tsx`; the
    redesign session of 2026-11-13). A link's "Code · QR" opens the invitation sheet on its code; a link just made
    opens it on the link. Removing somebody confirms in the danger style and says one sentence, and the link it
    stops (`RemoveSheet.tsx`). The invitation sheet is headed "Einladen" with the place's name as its second line, and has no paragraph: that a guest needs an account and
    what they will and will not see is behind the (i) beside "Gültig" (`help.invite`). The link and the code are
    set in the app's face, and the link breaks only after a slash, never inside its code (`InviteAddress`,
    `space/members/InviteTerms.tsx`; the redesign session of 2026-11-14).
  - A member who may not manage the place is shown the same list as a page of its own (`/spaces/:id/members`, from
    "von @…" on Start); whoever manages the place is sent from that address to the edit page. **A guest who leaves
    lands on Start** with a toast that names what was left; one who still sees the place through its room stays
    and is told so. Back from there does not find the page that was left (`leaveUnderSheet`, above), and an entry
    of the history that still names the place leads to Start instead of a page that cannot be opened (`hasLeft`,
    `app/places.ts`; `StartOfPlace`). **A guest whose access ends while the app is open is told once**
    (the redesign session of 2026-11-13): a place of somebody else's that the places no longer name, or that a
    newer home has stopped listing, is said in one toast ("Du siehst … nicht mehr"), and every read is taken
    again - the bell, the tasks and the bar counted what stood there. Start then reads "Du siehst gerade keinen
    Ort" over the same doors until a place is seen again or the app is opened anew; a cold open is the
    first-run Start (`app/shell/LostSight.tsx`, `useLostSight` in `app/places.ts`). Whoever leaves is told by
    the leave sheet alone (`walkOut`).
  - What needs the owner - the room, the people, the end - is drawn for the owner only; a member who may manage
    edits the name and the kind and sees who is here.
  - A place that has ended is the page of an address that names nothing (§3); a list that could not be read is
    another state and keeps its retry.
- **"Ort entfernen" gives everything standing there its own destination** (Chris, 2026-10-13: "irgendwie muss es
  möglich sein, einen Raum, den ich nicht mehr haben will, zu löschen"; 2026-11-11, decision 5; built by the
  redesign session of 2026-11-12, and again after its critic's walk - the rules below are that session's;
  `screens/place/RemovePlace.tsx` with `remove-plan.ts`, at `/spaces/:id/remove`, outside the bar). A select per
  device, per camera and per running grow, and it replaced the sheet that moved everything to one place.
  - *A tent is kept together.* One device leads - the first controller or fridge module, else the first device -
    and goes to another place of the account that fits: a place of its kind that holds no climate of its own yet,
    else a new place ("Zelt 2", in the room the place stood in). Every other device and every camera defaults to
    "bleibt bei <the leading device>" and goes wherever that one goes; another place, a place of its own and
    "abgeben" stay in the select. Giving the leading device up hands the lead to the next. One new place at most
    unless the grower asks for more. A choice names a place that exists by its name ("nach B2 Zweit", and in the
    question "… zieht nach B2 Zweit um"); "neuer Ort" and "bekommt einen neuen Ort" are said only of a new one
    (the redesign session of 2026-11-14).
  - **Where the plants stand is never guessed**: a grow has no default ("Wo stehen die Pflanzen jetzt?" - at the
    new place of a device, in another place, in no fixed place, "Grow beenden"), the button waits until every grow
    is answered, and asks again when the device a grow was to go with is sent elsewhere.
  - *It asks once, with everything it will do.* The page's button opens a sheet that lists each line as it will
    happen - which device moves where, which stays with it, which is given up and then no longer belongs to the
    account, which grow ends - under "Das lässt sich nicht zurücknehmen."; only its button writes. **It names everybody who loses sight** (the redesign session of
    2026-11-13, after the second walk found a direct guest blocking the removal and a room's member ended
    without a word): the place's guests in one line and, where the room ends with this place, the room with its
    members - a member who is a guest of the place too is named once, and a room without members is still said
    to end; the toast says the same. Guests do not block a removal: the question is the confirmation, and the server ends their
    access with the place (ADR 0001). The room does not end where what stood here gets a new place in it. People
    and a place's reminders ("3 Erinnerungen enden", counted from the reminders that name the place and no grow -
    a grow's go where the grow goes; the server ends them with the place) are fates like devices (`fatesOf`,
    `what: 'ends'`, `remove-plan.ts`). A disabled button is neutral, the danger colour is for one that can be
    tapped.
  - *Nothing is left half-made.* The writes are made one after another, and a new place is made only with the
    move of its device into it and taken away again if that move is refused. A refusal half-way says that the
    place is not removed yet, the server's sentence or that the server cannot be reached, what is done ("Schon
    erledigt") and what is still open ("Noch offen" - a camera that went along with its device is owed its
    answer but no longer here), by name; every answer is kept, the grow's included, and "Noch einmal versuchen"
    goes on with what is left - into the place an attempt already made. Changing an answer asks again. **After
    a refusal the page reads places, devices, cameras, grows, reminders and members again** (`useEndPlace` waits
    for its reads on a refusal), **and what an attempt was about stays the page's business until the place is
    gone** (`kept`, `remove-plan.ts`; `asked`, `done`, `made` in `RemovePlace.tsx`; the redesign session of
    2026-11-13, after a camera's "entkoppeln" was dropped by the re-read and never sent): a thing is dropped
    only when it is done or the account no longer holds it. A camera follows its device when the device moves,
    so by the list it no longer stands here while its answer is still owed; its row and its write stay.
    **Nothing "stays with" a device that has left**: each settled thing is kept with the place it now stands in
    (`EndNote.at`), and "bleibt bei <device>" and a grow's "am neuen Ort von <device>" name that place instead -
    same write, same agreed line, no second question. The same tap goes on only while every
    line left was agreed to.
  - *The toast names where things went* - the place removed, what stands where now, the grow that ended -
    without undo. The line the move writes into the grow's diary names both places - "Du hast
    von Zelt Eins nach Zelt 1 umgestellt" - by the names the server wrote into the line (`values.from`,
    `values.to`; `movePlants`, `server/src/modules/v1/grow/grows.service.ts`; `doneByOf`, `ui/entries.ts`): the
    place left is removed a moment later and in no list a page could look its name up in. They are the names of
    that moment, as a diary line is; a line written before, a split that stays where it is and plants gathered
    from two places say "hast umgestellt" as before, and a reader from outside is told neither name.
  - With a grow the page says that curves and pictures up to today stay with it; without one, that the place's
    curves are afterwards only seen with grows that stood there - an ended place has no page, and Verlauf and
    Steuerung say so at its address (above).
  - Only the owner ends a place, and never the last one - that one is Start: its `/remove` says so in a
    sentence, with the way back. A camera is called by its own name in the row, the question and the toast, "Terp
    Cam" where it has none; the grow's row carries its day once it has a phase.
- **Steuerung is the chosen place's climate, then its devices** (Chris, 2026-11-11, decision 7;
  `screens/control/Control.tsx`, built after the prototype by the redesign session of 2026-11-12, whose rules the
  rest of this entry is, those after its critic's walk included). It always opens on the light and the targets of
  the device the server names as the place's climate (`leadOf`, `screens/control/lead.ts`) - where no device of
  the place has reported yet the server names none, and the controller or fridge module leads, not whatever
  joined last; a running plan does not take the page. Under them a row each for Alarme, Grow-Plan, Ausgänge and Betriebsart, every one a page in
  the address (`/control/alarms|plan|outputs|mode`) with a line that says its state, amber only where a person is
  needed (`PageRows.tsx`, the lines in `rows.ts`). Then the devices standing in the place.
  - *A row whose page would hold nothing, or only what the card over the rows says, is not drawn* (the second
    half: the redesign session of 2026-11-12, after its critic's second walk) - a tent controller has no
    Betriebsart, a socket no plan. A plan is offered only to a device that could follow one as it runs
    (`followsPlan`, `rows.ts`): an AIR fan at a fixed speed holds no target and gets no Grow-Plan row, the same
    fan following a reading does; a plan a device carries all the same keeps its row. A fan that leads the place
    has no Ausgänge row: its speed is its card. A page reached by its address all the same says what is missing
    and leads back (`NothingHere`, `ui/PageState.tsx` - the one dashed note for "nothing here", with a way on
    where there is one; "Alle Grows" without a grow and Düngung without a scheme read as it too): "Hier gibt es keine Betriebsart zu wählen." -
    and only where the hardware has work modes "Keimung und Trocknung kommen mit dem Klima-Preset." -, "Hier
    steht kein Gerät, dem ein Plan Zielwerte stellen kann.", "Was hier steht, hat keine eigenen Ausgänge."
  - *What the rows say.* Ausgänge says each output with what it does - "Licht 80 % · Abluft an · Pumpe aus", a
    fridge's fans by their figures, the mode of a further device's AIR fan bound to its name ("Lüfter: Fest ·
    Tagsüber 70 %"), the outputs of a further device led by its name -, and "alle Auto" only of a list made of
    sockets, since a lamp reports no hold. What is held by hand turns the line amber. Alarme counts the rules
    that are on, against those there are once one is off ("1 von 7 Regeln an"), and says in amber that the
    offline rule is among those off ("„Gerät offline“ aus"): nobody is told when that device falls silent.
    Grow-Plan says a paused plan as "<Schritt> pausiert · <reason>" in amber and leads to the plan page, the one
    place a plan is continued and stopped; the plan's state keeps no instant of the pause (`pause` clears
    `stepStartedAt`), so the row cannot say since when. Without a plan it says "aus", and "Zielwerte stellst du
    von Hand" only while something there holds targets - not of a device whose control is switched off.
  - *One rule for a line that sums up a device* (`rows.ts`; the redesign session of 2026-11-12, after a fan
    silent since 13:54 whose mode was changed at 16:07 read "Stand 13:54 · Lüfter: Nach Temperatur"). What the
    device reported - a lamp's level, a socket's state - is dated once it has gone quiet (`standOf`: "Stand
    13:49 · Licht 80 %"). A setting is what is stored and carries no date; one the silent device has not been
    handed is said as that, in amber (`notTaken`: "Klemmlüfter 45 % gespeichert um 18:22, noch nicht am Gerät",
    "Standard gespeichert um 18:22, noch nicht am Gerät · auch Gewächshaus") - never behind the "Stand" of a
    report, a moment at which the device held another. Ausgänge, Betriebsart, the socket rows and a device's own
    page read the same two functions; what the device still holds is said on the page behind the row (§3).
  - *The devices*, under "Geräte · <Ort>" (`DevicesHere.tsx`): the card of the place's own device - how it is heard,
    in the pill's words and by its thresholds ("online", "veraltet · vor 4 Min", "offline · seit 3 Std";
    `livenessWords`, `ui/age.ts` - the hour it fell silent is the banner's and its page's), its firmware, an update where one is offered, "Wartung · 15 Min" and "Neu starten" side by side, "<Name>: alles
    Weitere ›" - and for every further device a short card: its name, how it is heard, what it is set to and the way to
    its page, where its maintenance, restart and update are. So Steuerung stays short in a place with five
    devices. Then a row per camera and per smart socket - a camera's picture stands in its row beside the rail
    only, since a phone is not sent a picture it does not draw - and one button, "+ Gerät oder Kamera
    hinzufügen", offered only where the place is the reader's to steer. It opens three rows: Gerät, Terp Cam,
    Andere Kamera (RTSP), the last on the add-camera page's address form (`/cameras/add?kind=rtsp`). **This is
    where a device is found**: the bar has no item for them.
  - *The head's pill* says what the regulation is doing while the place's own device is heard ("Regelung ein",
    "Regelung aus", "Wartung bis …", or the work mode away from standard). **A work mode has one word**
    (`modeWord`, `screens/control/rows.ts`, one catalogue group): the row Betriebsart, this pill and Start's
    line name it by the same function, so germination reads the same on all three. A lead nobody hears is not said to regulate in
    green, also while another device keeps the place live: its state stands as of when it was last heard, in
    amber ("Regelung ein · Stand 13:49"). A lead with no regulation of its own - a socket, a lamp - and one still
    waiting for its first values leave the place's age in the pill (`stateOf`, `Control.tsx`). **Offline is said
    once**: while the box over the climate says since when the leading device has been quiet, the head has no
    pill and that device's card no "offline · seit" (`silenceSaid`; the redesign session of 2026-11-14).
  - *The place is named once.* On a desktop it stands beside the title once the account has several, and the
    columns are headed "Klima" and "Geräte"; with one place they read "Klima · <Ort>" and "Geräte · <Ort>".
  - One column until 1200 px, then the climate left and the devices right, and the rows two by two beside the
    rail; the last of an odd count spans both columns, so the grid has no hole. The page keeps how far it was
    scrolled for its history entry (`useKeptScroll`), put back once the socket rows at its foot are there, so
    Back from a socket's page finds the row it was opened from.
  - A place with nothing to steer says so over the one button, and an account with no place reads the same
    sentence with the way to add a device: "Hier gibt es noch nichts zu steuern: Zielwerte und Alarme kommen mit
    dem ersten Gerät." A guest and the demo, who have no Steuerung in the bar, read the figures as text at its
    address and are offered nothing.
- **A page behind one of Steuerung's rows leads with the place's own device** (`ByDevice`,
  `screens/control/ByDevice.tsx`; the redesign session of 2026-11-12, after its critic found the lead's plan
  under four other devices' panels). The devices stand in Steuerung's order - the device the server names as the
  place's climate, then the others as Steuerung's cards list them (`inOrder`, `screens/control/lead.ts`). The
  first stands open; every further device is one row that says what Steuerung's row would say of it alone and
  unfolds in place; what was unfolded is kept for the history entry. A device with nothing for the page is not
  listed: no lamp on the plan page only to say that nothing runs on a plan. `?device=<id>` opens the page with
  that device unfolded and brought under the header once per visit - a second device's own page links there -
  and on Alarme the device holding the rule an alert linked to is unfolded for it. One device alone has no name
  over it: the page is about it.
- **An output held by hand is said wherever its state is said** (the redesign session of 2026-11-12, after its
  critic's walk): the Licht card ("von Hand aus bis 13:05", with "Zurück auf Auto ›" leading to Ausgänge, where
  the hold's one control is - no second one), Ausgänge's row, and on Start the Licht tile - which then promises
  no switch by the schedule -, a line under the status sentence ("Licht von Hand aus bis 13:05 · Ändern ›"), so
  "Alles im Ziel" never stands alone over a lamp somebody holds off, and a place's card among several. One reader
  for all of them, `useHeldLight` (`screens/control/held-light.ts`): the light output's hold as this browser
  asked for it (`useLightHold`), else a light socket the device's table reports held. The device reports no hold
  of its own lamp, so another browser knows nothing of one.
- **A device has one page** (`/devices/:deviceId`, `screens/devices/DevicePage.tsx`; the redesign session of
  2026-11-12, after the prototype and its critic's walks), reached from its card: the pill that dates it and, under
  the name, where it stands and what its regulation is away from - how it is heard is said once, by the pill -,
  the firmware card, maintenance and restart, then rows - Umbenennen oder umziehen, Steckdose koppeln (with the
  count), Erweitert, Technische Details, Regelung ausschalten, Gerät abgeben - each a page under the
  device's (`/advanced`, `/details`) or a sheet. Erweitert is a page drawn open; the work mode, the fans,
  continuing a plan, the update channel, pairing a socket and giving the device up left it for places of their
  own. *Control switched off for a device nobody heard* is said as Steuerung says it, in amber: "Regelung aus
  gespeichert um 16:07, noch nicht am Gerät" under the name - by Steuerung's rule and in its words
  (`offNotTaken`, `notTaken`, `screens/control/rows.ts`; §3). *Regulation is switched back on by one block*
  (`ControlOff`, `screens/control/Mode.tsx`): the amber one of Steuerung, which a leading device's page mounts
  above its rows while regulation is off, saying that the plan runs on or that it holds once the device is back. *A build is named by the day it was made*, the one thing about it a grower can compare, and by
  its hour as well where the device's list holds another build of that day (`buildDay`,
  `screens/devices/firmware-builds.ts`): "Neuere Firmware vom 12. Nov 14:46 ist da" beside "vom 12. Nov 13:12",
  never two builds "vom 12. Nov 2026". The hour stands where the year stood while the year is this one, since
  the words are a button's too ("Update vom 12. Nov 14:46" on Steuerung's card, beside the device's name). The
  card, Steuerung's card, the update either offers and the list a build is picked from say it through one
  function (`madeOn` of `useFirmware`), which is also what tells two builds stamped alike apart there. On
  Steuerung's card the device's name keeps its words: a button it has no room beside wraps under it.
  *"Wartung · 15 Min" and "Neu starten" stand side by side wherever both names fit a line each* (`DeviceActions`,
  on this page and on Steuerung's card): each is as wide as its name at least and they share the rest, so no
  width of the card and no language stacks two buttons that fit or cuts a name. **A device's smart sockets are
  listed twice and no third time**: as rows under their device on Steuerung and under Ausgänge. The device's page
  counts them and pairs another (`PairSocketRow`, `screens/devices/SocketSheets.tsx`), and `/devices/:id/sockets`
  is no page. **What Steuerung offers, the device's page does not offer again**: only a device that is not the
  place's climate draws its own settings there (`OwnSettings`, `screens/control/OwnSettings.tsx`), and under them
  rows that open Steuerung's pages with it unfolded (`controlPath(spaceId, page, { device })`): Kurven dieses
  Geräts (`/timeline?device=`), and Alarme, Grow-Plan, Ausgänge, Betriebsart, each only where that device has
  something on that page. They are the rows Steuerung draws for a place, asked of this device alone (`PageRows`,
  `screens/control/PageRows.tsx`): a row is there by the test its page lists a device by, and says the same line.
  An AIR fan gets no Ausgänge row - its speed is its own control on this page, and Ausgänge would only say it
  again and lead back -, and whoever may not steer is offered the curves alone. Maintenance, a restart and an
  update are the exception, on the card of the place's own device and on every device's page alike: they are done
  to the hardware, and the card is where a hand reaches first. A reader who may not manage reads the facts and is
  offered no row he cannot use. A smart socket has a page of its own
  ([smart-sockets.md](smart-sockets.md#in-the-app)); an address under the device that names none of its sockets
  is a page too (§3).
- **A device is renamed and moved on one sheet with one button** (`screens/devices/DeviceSettingsSheet.tsx`; the
  redesign session of 2026-11-12, after its critic moved a device by brushing a chip). Nothing is written before
  the button: the field holds the name somebody gave (empty, with the name every screen shows as its placeholder,
  for a device nobody named), a place chip only chooses, and the button reads "Speichern" or, once another place
  is chosen, "Umziehen". Before the move the sheet says what goes with the device - the camera it answers for,
  which the server moves, and its smart sockets - as figures: "Zieht mit um: Kamera … · 3 Steckdosen". Saved, the
  sheet closes and the toast names what changed - the new name, the place the device stands in now and what went
  along - with "Widerrufen", which writes back what stood there. A name typed beside a move is written with it. A move into a
  place made in the same breath ("+ Neuer Ort") offers no way back: taking it back would leave the new place
  behind empty. What a move does to the readings is behind the (i) (`help.deviceMove`), what an empty name means
  behind the other (`help.deviceName`).
- **The camera page** (`/cameras/:cameraId`, `screens/camera/CameraPage.tsx`; the redesign session of 2026-11-12,
  after the prototype and its critic's walk): the picture with the grow's name, its day and the picture's moment
  on it; under it one picture per day of the grow running there, as the diary heads that day
  (`screens/camera/days.ts`) - the slider rests only on days this camera pictured and is not drawn where there is
  no second one; the films as four chips and one button that plays the newest of that kind or, for whoever may
  manage, makes it (`Films.tsx`, `film-spans.ts`), with "Jetzt ein Bild" beside it; then rows to the curves of the
  day shown, the diary, a film of one's own, all films and the camera's settings, each only where its target
  exists. Today's picture is Start's; a picture just taken is shown whatever the light. Two columns from 1280 px.
  A day's stills are not scrubbed here: the day's film and Verlauf's cursor show them.
  - *The day the slider stands on is part of the address* (`?day=`, the grow's day number): a reload, a link and
    the way back find it. It is written onto the entry the page stands on, not by a navigation - a navigation,
    also a replacing one, renews the entry's key, by which `ui/kept.ts` and `ui/sheet-back.ts` find what belongs
    to it - at most every 150 ms, and again when Back out of a sheet lands on the page's first entry. Moving the
    slider adds no entry. A day the grow has not reached is today, and is taken out of the address. The film
    chip and the scroll are kept for the entry.
  - *"Im Tagebuch zeigen" opens the grow's diary on that day* (`/grows/:id?day=`): its week stands open, the
    weeks before are read until they hold it (`useReadBackTo`, `screens/grow/diary/read-back.ts`), and its card
    is brought into view once per history entry.
  - *A film asked for is followed by its own row* while it renders; once it plays it is the film of its kind,
    and the button plays it. One the server refuses - a span whose every picture was taken in the dark - is said
    under the buttons ([terp-cam.md](terp-cam.md)).
  - *The settings are one sheet with one Save* (`CameraSettings.tsx`), behind their row. Fields, switches and the
    stream's Erweitert are a draft, a value put back leaves it, and nothing in the sheet writes on the tap;
    closing with something unsaved asks first. What changing a stream's address keeps - the login left empty,
    the pictures, the films, Premium - and that its password is never sent back stand behind the help beside
    "Adresse ändern" (`streamChange`), not under the fields. Premium is said there, and taking
    the camera off the account is asked there. Every write of the page is answered by a toast that names what
    changed - "Jetzt ein Bild" says "Bild wird aufgenommen …" and then of when the picture is -, and a picture
    that could not be taken is said under its button. "Jetzt ein Bild" is held (`aria-disabled`) while the device
    the camera is read through is not live, offline or late; a press the device fell silent under is dropped
    rather than left "Bild wird aufgenommen …" (the whole-app walk). **A device that is late is said once, in the
    pill** (the redesign session of 2026-11-14): "wartet auf <Gerät>" in the device's state colour, no sentence
    about the relay, and the held button points at the pill (`aria-describedby`); an offline device keeps its
    offline box. A picture's caption has one form, "Bild von 18:17", with what makes it not the newest in front
    ("Licht aus · Bild von …", "letztes Bild von …"), and the caption over the picture wraps at 320 px so the
    grow's name stands whole ("Amnesia & Gelato · Tag 31"). While a film plays its button is a quiet "Film
    schließen", not the primary.
- **Rows that open something are one component** (`ui/Rows.tsx`): the title, a line that says what is behind it,
  "›" only where the row leads somewhere, a finger high; one card for a list, a card of its own for a row standing
  alone; a row that does what it names has no "›", one that unfolds what stands under it has a mark that turns
  (the folded devices of a page behind Steuerung), and one that waits is drawn unavailable with the line saying
  why. Steuerung, a device's pages, the camera page and Ich's doors are built from it, and their heads from
  `ui/PageHead.tsx`: the arrow that steps back (above), a finger wide, the name, which takes the lines it needs
  and breaks by words, and the pill that dates the page, beside the name and under it before the two meet. A
  device gone quiet is said by one box on all of them and on Start (`OfflineBox`, `ui/OfflineHelp.tsx`): since
  when in its title, one sentence on what that means on this page, and what to try a tap away.
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
  **Every write of the grow pages answers** (the redesign session of 2026-11-13, after its critic's walk of the
  clearing-up round; `useAnswered`, `screens/grow/told.ts`): a measurement added, changed or deleted, a scheme
  saved, a plant renamed - each a toast that names what holds now, with the way back; a scheme deleted from the
  shelf is said and has none, since making it again would make another. A plant's name that another plant of
  the grow has is refused under the field (`refused` of `ui/NameSheet.tsx`). On Düngung and in the scheme
  editor a dose is written in the language's format ("2,5") and typed with either sign, and **a scheme that is
  not saved says so in view**: the bar "nicht gespeichert · Verwerfen · Speichern" stands at the window's foot
  above the tab bar; no editor has a leave guard, and a reload loses the draft. Bericht's "Einträge" are the
  grower's own, as a share link counts them - an alarm's line is told by the diary and is no entry; every
  chapter's "% im Zielband" carries its help, not the first alone. Düngung's head names the water and its unit
  ("Leitungswasser · EC 0,4").
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
    a person's line, on and off as one ("Wartung · 2 Min"), without the mark, and so is regulation switched off
    and on again ("Regelung aus · 12 Min", "Regelung ist aus" while it is; a `controlOff` event of the day, the
    whole-app walk), and a line a device wrote of somebody's doing
    ([app-wording.md](app-wording.md#grow-time)). Lines the devices wrote in a row carry "von allein" once, at the head of the run
    (`data-marked`, `ui/Lines.module.css`). A phase the grower set - with a climate chip or without, a grow started
    with one - is his (`source: 'human'`); "von allein" on a phase is what a plan or a preset applied to the place
    did. **A device's support log is not the
    diary**: restarts, a sensor deviating, a socket lost stay with Meldungen, the device and Verlauf. From the
    devices a day carries the lamp as one line that says only what happened - the stretch it burned ("Licht
    00:05–12:05"); a stretch that has not ended without an end, "Licht an seit 18:10" on the day still running
    while its device reports and "Licht an um 18:10" otherwise; and a lamp that went off before it came on
    again as both ("Licht aus um 12:00 · wieder an um 18:00") -, a
    reading outside its targets as one line however often and on whichever side ("Temperatur 3× zu hoch ·
    zusammen 1 Std"; it leads to Verlauf at that moment), an alarm by its rule's name with how often and since
    when ("Zu feucht · 97× seit 03:26") and under it the reading and the edge in words ("Luftfeuchte über
    60 %"), and the plan's steps. Which of these a day holds is decided where the server reads the day
    ([server-engines.md](server-engines.md#read-models)), not filtered in the page. "›" only ever means "opens
    something" and is bound to the last word of the line it ends. Every row is a finger high, and the mark takes
    room only on a line that has one (`ui/Lines.tsx`). One line more than a card shows is shown, not folded
    behind "+ 1 weiterer"; an alarm still open at the day's end is never folded (`stands`), and what is folded says
    how much of it was an alarm ("+ 14 weitere · davon 3 Alarme"). An alarm that ended is a device's line like any
    other, and its end, the newer line, is shown before its start, so a start never stands without its "behoben"
    (the redesign session of 2026-11-14). An alarm that fired again and again says it is over once its newest
    line is the clearing. A line about some plants of a grow of several names them ("Du hast gegossen · B2 ·
    1,5 L"; `EntryWords`' `plants`) - in the diary, on Start's "Zuletzt" and on a share link, whatever the owner's
    counts switch says (Chris, 2026-11-13: it hides how many, not which). The report's training lines are these rows too, under the chapter's cover and story
    across the card. A line
    somebody may correct opens its sheet - a photo's line like any other; its words and its moment are corrected
    and the line taken back, the pictures stay and are shown in it, each opening the viewer. **A line's pictures
    are reached from the line** (the whole-app walk): their count ("2 Bilder") is a control of its own beside the
    words and opens the viewer for every reader; on a share link the line draws them as thumbnails instead
    (`PictureStrip`, `ui/PictureViewer.tsx`; at most four and "+n"). Colour is for what needs a person - an alarm
    raised (§3). A line's stamp stands at
    its first line of words, where a one-line row's does, also when the words take two (`--first-line`,
    `ui/Lines.module.css`).
  - *What was written for a moment before the grow began* has no day: the last page of the diary shows it as a
    group "Vor dem Start", after the first day.
  - *The newest three days stand open*; the days before fold into a row per week - "Tag 22 bis 26 · Blüte, Woche 2",
    named by the stage most of its days lay in ([app-wording.md](app-wording.md#grow-time)), with its pictures,
    entries and film counted - which opens its days in place. Today's card always stands; a
    past day with nothing to show is left out. "Frühere Wochen" reads eight weeks further back. From 1200 px the
    newest pictures and the week's film stand beside the days.
  - *One diary for every reader*: the public page and a share link draw the same cards (`Days`,
    `screens/grow/diary/Diary.tsx`) from the same read. A reader from outside is handed no way into the account -
    no line opens, today's picture leads to no camera, nobody is named - and is answered neither what the devices
    did nor the share of a day; how the day was and what was done to the plants is the diary. A shared place's
    "Zuletzt" is Start's lines (`dayLines`, `DiaryLine`), with the pictures in the line; an empty one is said once,
    in the diary's own words. A diary that has ended, or one a link stopped short of, has no "Heute": its days are
    dates. The public page and a link open on the grow's cover, else its newest picture, else no picture box at
    all - never an empty box with a leaf (`screens/public/Diary.tsx`); the public page says the grow's day as it is
    read, the word over the figure ("Tag" over "14"). **A link made for a stretch shows its
    curves** (the redesign session of 2026-11-13, after the third critic found a window link from Verlauf to be
    day cards alone): a link onto a grow whose window ends draws "Verlauf · <Ort>" for each place the grow stood in
    during it, between the diary's head and its totals, held inside the grow's stay there within the window as §7
    says of a window link (`LinkCurves`, `screens/public/SharedRoute.tsx`, which no longer writes the window into
    the address; the server lets the link read each place over the grow's stay there); a link
    onto a running grow is its diary. **A part of a grow is named as a part** (the redesign session of 2026-11-14):
    a harvest of some plants while others still grow is theirs - "B2 geerntet" in the Bericht and on the share
    page, "Teilweise geerntet" where the page has not got their names - and the grow's, "Geerntet", once the last plant
    is cut (`GrowHarvest.plantIds`, `harvestWord`, `diary/days.ts`); a split plant's phase in "Bisherige Phasen"
    names its plants ("Veg · für B3", `PhaseSheet.tsx`). The share sheet opened from Verlauf names the window on screen, holds the
    link to it when it stands still, and offers the place first; rooms are not offered for a link
    (`screens/me/sharing/NewLinkSheet.tsx`), as "Freigabelink erstellen ›" on a place's edit page offers that
    place (`?place=`). "Link erstellen" answers with a toast, but from Verlauf, which shows the link itself. A
    link's card says how long it lasts once, by its end ("läuft ab 21. Nov"), and says nothing of camera pictures
    where no camera could take any (`picturesPossible`, `screens/me/sharing/links.ts`). "Zurückziehen" asks first,
    with the one danger yes, on Ich › Freigabelinks and in a grow's share sheet alike: nothing starts a link again
    (Chris, 2026-11-14). A line from an earlier year says
    its year (`sinceLabel`, `dayStamp`, `ui/age.ts`).
- **Bilder** (`screens/grow/pictures/`): Alle · Deine Fotos · Kamera - "Kamera" only where a camera watches the
  grow or once pictured it, and the choice is part of the address (`?show=`); the newest week film on top, played
  where it stands, and no film row over a list without pictures; then week by week the camera's picture of each
  day, named by its day, and the photos, marked as one's own; "+ Foto aufnehmen" opens the photo entry. A picture
  opens large - on a desktop in a dialog centred over the page, the picture filling it - with what can be made of
  it: the camera's picture of a day becomes a line of the diary and stays a camera picture, and any picture the
  grow's cover. Weeks without a picture say that of those weeks, not of the grow, while earlier weeks are still to
  be asked for. A week's film belongs to the week most of its days lie in and names only those; one shorter than
  two seconds is not offered.
- **A grow's page after the whole-app walk** (the redesign session of 2026-11-13, not Chris):
  - *A grow's bar means one thing* (`GrowBar`, `screens/grow/GrowBar.tsx`, also under Start's picture): with a scheme
    one track of the days gone of the days planned; without one the six stages as segments, the reached ones
    filled - never a fill by stage (67 % on the first day of Blüte).
  - *The head*: on a phone "Alle Grows" and ⋯ are a row of their own above the name, so a name has its line; a
    harvested plant is counted as harvested, not among the stages ("2 Veg, 1 geerntet").
  - *Plants after the start*: "Pflanze hinzufügen" on the Pflanzen tab (strain prefilled, a taken name refused,
    the toast takes it back), "Pflanze löschen" on its page after a question. A plant deleted takes its harvest
    line along - a harvest of several keeps the others, its typed amounts as they were (Chris, 2026-11-14) -, and
    its page's address opens its grow's Pflanzen (the
    third whole-app walk). A harvest of some plants closes its sheet and answers with its toast, so "… und Grow
    beenden" never stands where the person just pressed. A grow whose diary holds nothing
    but its phase lines is offered to its owner to delete under ⋯; its phases are taken back first, so no line of
    a gone grow stays behind (the server's `DELETE /v1/grows/{id}` leaves entries).
  - *A scheme chosen is a scheme saved*: "Auf dieses Schema wechseln" writes at once and answers with a toast and
    its undo; the "nicht gespeichert" bar is for cells typed by hand.
  - *Every write answers*: the start moved ("Start: 10. Aug 2026", with its undo), a phase from the menu, a move
    ("… · neuer Ort: Zweitzelt"), a split, a grow started with a climate ("… gestartet · Zielwerte gesetzt"), and
    a harvest that leaves the grow running ("B2 geerntet", the redesign session of 2026-11-14), whose undo stands
    the plants up again and takes the harvest's line back (`useTakeHarvestBack`, `api/lifecycle.ts`); the harvest
    that ends the grow has none.
  - *Where a grow goes*: "+ Neuer Grow" proposes the place in view (the header's) where nothing grows there,
    else the first place where nothing grows; "Grow hierher" chooses the only candidate; where the chosen place grows nothing, the bar's Grow
    shows a grow standing in no place rather than "Hier wächst noch nichts".
  - *Two grows in one place* (the redesign session of 2026-11-14): Start shows the newer under the picture and the
    other as a card of its own, leading to `/grows/:id`; a place's card among several names both; every grow page,
    the bar's Grow included, says "Hier wächst auch: Amnesia ›" (`AlsoHere`, `screens/space/AlsoHere.tsx`;
    `alsoIn`, `space/movable-grows.ts`); a due task names its grow while its place holds two (`twin`,
    `screens/start/due.ts`). **An entry goes to the grow it was written for** (the third whole-app walk, where
    Eintrag reached only the newer): the entry sheet offers each grow of such a place as a pill of its own ("Zelt
    Eins · Amnesia"), the newer chosen where it opens on the place; opened over a grow's page it writes to that
    grow, from a task's "Eintragen" to the task's grow and ticks that task (`taskId`), from Verlauf's note to the
    grow the view shows (`targetsOf`, `log/targets.ts`). It offers nothing to tap until the list of grows is read,
    and holds the pill it opened on until somebody presses another: a start moved from its foot made the other
    grow the newer, and the line went there.
  - *One secondary button*: "Früher", "Frühere Wochen", "+ Erinnerung", "+ Alarm" and a plant page's actions are
    the app's ghost button, a plant page's in words alone, without icons; a load-more button is not disabled while it asks (the focus rescue ringed it). A done
    task is marked in the soft green with a tick (`Check`, `screens/tasks/TaskCard.tsx`), the brand green stays the action's; "+ Neuer Grow" is a quiet pill beside
    Eintrag.
- **Alle Grows** at `/grows` (`screens/grow/Grows.tsx`): the running grows as cards with their picture, day, phase
  and place (also placeless ones and those in shared places, "von @owner"), the finished ones as rows that lead to
  their report, a new grow from the button beside the title, and under "Dazu" the doors to what belongs to
  growing: Düngepläne, Freigabelinks, Abonniert, whose pages stand under `/grows/` and keep Grow lit. It lists
  every grow the session can open - a guest's shared one with whose it is, and on the tour the grow standing in
  the demo's place. Opened by its address its arrow leads up to Grow. Starting a grow switches the
  diary on for an account that had switched it off.
- **One form starts a grow** (`WhatGrows`, `screens/grow/new/`; the redesign session of 2026-11-12): "Was wächst
  hier?" stands behind every "Grow starten" and "+ Neuer Grow" - setup's last step, Start's card, Grow, Alle
  Grows, the entry sheet, `/grows/new` - and the longer sheet that asked strains, kind, scheme and a new place is
  gone. It asks what cannot wait: a name, since when, how many, where - only where it was opened for no place - and the
  phase. **It never proposes a place a grow runs in** (with none free, "Kein fester Ort"); a place chosen where one
  runs asks first - "In Zelt Eins wächst schon Gelato – trotzdem einen zweiten Grow dort starten?" with "Zweiten
  Grow starten", the one filled button while it asks, and "Abbrechen" (the redesign session of 2026-11-14). It opens
  on the stage the place is on, read off the device its questions are about (§1; `usePlaceStage`,
  `screens/start/stage.ts`), and waits for that answer rather than choosing before it, so it opens the same on
  first arrival and after a reload. **A stage it only opened on is recorded and moves nothing; a
  stage the grower chose puts the place's controller on its climate, and then the button says so** ("Starten und
  Klima auf Sämling · mit Licht stellen") - except seeds beside plants already growing there, which are only
  recorded. Where that climate is germination's, the form asks germination's two choices (`GerminationChoices`;
  ADR 0007) of the device the climate preset is taken on - the place's climate as Steuerung reads it
  (`usePlaceClimate`, `screens/grow/phase-climate.ts`), so a humidifier socket there is asked about here too,
  whichever device stands first in the place - and nothing is asked where the stage is only recorded. As a
  sheet its button is the sheet's foot and stays in view while the questions scroll, and the stage's name
  stands whole on it. Choosing germination brings its two switches into view, again when the humidifier's
  joins them: at 390x600 they stood behind the foot. Nothing is explained in it. The kind of
  plant, the strains and the scheme are the grow page's: "Name und Art" in the grow's menu, Pflanzen, Düngung.
- **Where nothing grows** in the chosen place, Grow offers to start a grow, and to move one there only where one
  runs somewhere else. After a harvest it says that the grow has ended and leads to its report.
- **The entry sheet** (`log/LogSheet.tsx`): what the line is about as pills - the places in one row and the
  chosen place's plants in a row of their own, each wrapping where it is longer than the sheet and never cut, so
  a plant's number stays in view beside a long strain name, and the rows wrapping into lines as the harvest
  sheet's do, never scrolled sideways (`log/Log.module.css`; the redesign session of 2026-11-14, the third
  whole-app walk) -, seven
  tiles - Gießen, Düngen, Foto, Notiz, Messen, Training, Phase, a short last row sharing the width - and at its
  foot "Wann war das?" with "Ändern". A tile opens its
  view, filled in with what was done last time; the moment said on the sheet stands in that view's corner, where
  it can still be changed. Maintenance is not a kind of line: it is started on Start and with the device. What
  the critic's walk of 2026-11-12 decided:
  - *What the line is about* is the grow and then its plants. A place is a pill only where there are several to
    tell apart - one per place, the grow growing there named in it ("Zelt · Blue Dream") - or where nothing grows
    in it. One tent whose grow has no plants recorded is nothing to choose: no pills (`log/targets.ts`).
  - *A kind's view leads back to the tiles* (‹), beside the cross that closes it. "Speichern" stands on the
    sheet's bottom edge and stays in view with the keyboard up. A note that says nothing is not written.
  - *The litres can be typed* as well as stepped, and under them stands what the field opened on: "Zuletzt vor
    2 Tagen · 4,5 L". What is no number is refused with a word and stays in the field, and so is 0 L or less and
    more than 100 L, which no tent takes at once ("Höchstens 100 L."; `MAX_LITRES`, `shared-types/src/v1/feeding.ts`,
    which the route holds a watering and a feed to as well, 400 `validation_failed`). The keypad for a reading carries the decimal mark of the reader's language.
  - *A view's title is its kind* ("Düngen"), so it fits beside the moment; which week of which scheme the doses
    are read from stands with what the line is about. A grow fed by no scheme lists no doses and says nothing
    in their place.
  - *The moment's pop-up stays inside the window*, also with what it says about the grow's start in it.
  - *A correction and a line taken back are answered by a toast*: the sheet is gone, and the line may be days up
    the page.
  - *A correction starts from what was recorded* (the third whole-app walk, where a feed of scheme week 4 opened
    on week 5 with week 5's doses): a feed shows and saves the scheme's week and the doses it recorded - another
    can of water keeps them per litre (`keptDoses`, `log/defaults.ts`) -, never the grid's week its date falls in
    now, which the grid or a start moved since may have changed; each reading of a round across plants is a field
    of its own, named with its plant; words left empty stay none. Every kind opened from a stored line and saved
    unchanged leaves the line as it was (`test/log.test.tsx`).
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
  keeps the last answer and says "Konnte nicht aktualisieren · Stand von vor 3 Min"; a network failure keeps its
  retry (`ui/PageState.tsx`). **A page that could not be read keeps its title and says what Start says** (the
  whole-app walk of 2026-11-13; nine pages had lost their title for a bare red line): `LoadFailed` with the page's
  read and title draws the heading, "Keine Verbindung zum Server" - or "Der Server meldet einen Fehler" where it
  answered with a fault -, that the devices regulate on (only to an account this browser last saw with a device:
  `useSteersAsLastSeen`, `app/shell/shape.ts`, else `shell.away.*.bare`) - that they show their values again only
  on a page that shows values (`LoadFailed values`: Start, Verlauf, Steuerung, a device's pages; Konto or
  Freigabelinks say "etwas") -, what the page still knows (Start: when it last loaded)
  and one retry, "Noch einmal versuchen" / "Versucht es …" - the one wording for a retry everywhere. A part of a page
  passes no title and is one line. **Every page fails into it under its own title, and waits under it** (the
  redesign session of 2026-11-14): Meldungen, Aufgaben, every page under Ich, Benachrichtigungen, Düngepläne and
  the admin screens; the pages behind Steuerung's rows (Alarme, Grow-Plan, Ausgänge, Betriebsart) and a device's
  Erweitert and Technische Details keep their title and arrow back while they load and when they fail
  (`screens/place/ControlTab.tsx`, `DevicePage.tsx`), every read of Steuerung failing into `LoadFailed read=`; a
  page waiting for its whole read keeps its title over the waiting block (`Waiting` with `title`) - Verlauf, and
  Grow (`NoGrow`, `screens/grow/GrowPage.tsx`). Ich says a failed read once, over its rows, and leaves the rows
  that needed it without a line. There is one "not found" page, "Unter dieser Adresse liegt nichts", for
  `/nonsense`, `/charts`, `/devices` and a public address that is no profile (`screens/NotFound.tsx`).
- **An address that names nothing is a page of its own** (`NoLongerHere`, `ui/PageState.tsx`; the redesign session
  of 2026-11-12): a heading that names what the address was about - Gerät, Kamera, Ort, Grow - and titles the
  window, the sentence that it "lässt sich nicht öffnen", the two causes a 404 can have - nothing is there, or
  whoever shared it took the reader out, which the server answers alike - and the way to Start; no retry. One
  component for a device, a socket whose device is gone, a camera, a place and the pages under a grow, so no page
  writes a heading over it; a grow opened by its id says the same under its own head (§2). A socket the device
  does not report is neither of the two causes - the device is there and the reader reads it - so the socket's
  page says it (`screens/devices/SocketPage.tsx`; after the critic's second walk found "smarte Steckdose" for a
  heading and nothing to tap): the heading "Steckdose" from the same catalogue group, that the device no longer
  reports this socket, the arrow back and a row on to the device's page. A place that has ended still answers its
  overview, so a place's own address asks the account's places first, as the pages for editing, ending and its
  people do (`StartOfPlace`, `screens/start/Start.tsx`; the critic of the redesign's sixth round saw a removed
  place's Start with a heading "Ort 1" and "+ Ort hinzufügen"); support reads places that are not its own, and
  there the overview's 404 alone decides. `/devices` names nothing - devices are found
  under Steuerung - and is the app's not-found page inside the shell (`app/routes.tsx`): without a route of its
  own the address is read as somebody's handle and drawn outside the shell.
- **A refresh that fails ages the page, not the device** (the redesign session of 2026-11-12). While a place's
  read cannot be renewed (`failingSince`, `api/read.ts`: it failed, or the browser is offline and the read waits),
  the place is judged as the last answer left it (`judgedAt`, `screens/start/attention.ts`): what was heard then
  ages to "veraltet" and no further, and no box says the device has fallen silent, because nobody asked it. The
  notice beside it says that the page could not be refreshed and since when. Every read on screen is asked again
  the moment the browser says it is online (`api/query-client.ts`), so the notice goes with the failure and not
  at the next beat.
- **Every refused write says why, under the control that asked** (`Refused`, `ui/refusal.ts`): the server's sentence
  for an English reader, else the catalogue's words by problem code or status - never a bare "saving failed".
  Refusals are told apart: a rate-limited sign-in (429) is not a wrong password.
- **Claim only what happened.** A device acknowledges no setting, so a save says "gespeichert" and never that the
  device took it. **An offline device locks nothing** (Chris, 2026-11-11, decision 7; how it is said: the redesign
  session of 2026-11-12): the cloud hands it the stored settings when it next connects, and until then the page
  says what it has not been handed. **This holds for every setting of a device, whatever panel sets it** - the
  targets, the light, a socket's switching, a LIGHT's window, a fan's speeds, a fridge's fans, the work mode,
  Erweitert: one save path answers them all (`useSaved` and `useSettings`, `screens/control/climate/saved.ts`;
  after the session's critic found panels saying "ans Gerät geschickt" to a device nobody heard), and no page
  says a setting was sent to a device. A block says what its device has not been handed in one amber note
  (`PendingNote`, `climate/Pending.tsx`): a single setting as the sentence - "Temperatur am Tag: 24,0 °C
  gespeichert um 14:31. Am Gerät gelten noch 25,0 °C, bis es wieder online ist." -, several as their count ("5
  Werte gespeichert um 13:48, noch nicht am Gerät"), which unfolds each with what the device still holds; the
  values keep their amber mark. A setting behind a row stands in that row's line, named and said as stored and
  never as part of what the device reported (§2, "One rule for a line that sums up a device"), and what nothing
  else on Steuerung says as a count on the device's card. Control switched off while the device was silent is such a
  setting: Steuerung says that it is stored and that the device goes on regulating, the cards stay until it has
  taken it, and the device's own page says "Regelung aus gespeichert um …, noch nicht am Gerät" where it said
  "Regelung aus" (§2). All of it is `pending` of the device's live read
  ([server-engines.md](server-engines.md#read-models)) and nothing else: where the cloud does not know what the
  device holds, the page says only that it takes it over, and in the first ten minutes of silence - before a
  device counts as offline - nothing is said. Only what needs the device listening waits, `aria-disabled` with
  one sentence: maintenance, a restart, an update - installing a build picked by hand included -, "Finden",
  pairing, changing and removing a socket; the hold of an output is not drawn at all, and one sentence says why
  (`screens/devices/DeviceActions.tsx`, `Firmware.tsx`, `SocketPage.tsx`, `SocketSheets.tsx`).
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
  identical machine lines into one row, "3× seit 21:10" (`foldRepeats`, `ui/entries.ts`), and so does Verlauf's
  list of its window; what a person wrote never folds.
- **Amber is for what needs a person**: in a summary - Start's last lines, a day of the diary - only an alarm that
  was raised is drawn as a warning (a connection lost, a reading past its rule), a critical one in the alarm's red
  (`.line[data-severity='critical']`, `ui/Lines.module.css`; the redesign session of 2026-11-14). That an alarm is over, a restart, a
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
- **One freshness clock per screen**: the pill at the head of what it dates ("online · vor 20 s" on a place,
  `ui/LivenessPill.tsx`; a device and a camera keep theirs, and a fleet screen's says how old its read is, "Stand
  vor 20 s", `AdminHead` in `screens/admin/parts.tsx`). The shell draws none. A place whose devices have
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
- **Nothing is explained above a control** (the redesign session of 2026-11-12). A sheet states what it sets as
  figures - "Neu: Licht aus · 21 °C · 50 %" under a phase's climate, "Der Grow endet am 14. Aug 2026." before the
  last harvest - and what is worth knowing beyond that stands behind the help button beside the label: how a
  climate replaces the targets and what a phase does to the alarms (`phasePreset`), the order to mix in
  (`mixing`), how the feeding grid is read and changed (`feedGrid`), why a harvest's weights may stay empty
  (`harvestWeights`), what a plan is and that saving one does not start it (`plan` - Grow-Plan without a plan is
  one sentence, "Noch kein Plan.", with the help beside it and the buttons), what an update channel and a pinned
  version mean (`firmwareChannel`, `advanced.updateChannel`, `advanced.firmwarePin` - the firmware card has no
  sentence under its controls), how long an alarm rule waits, how it repeats and that the next stage moves a
  stage's rule (`alarmFor`, `alarmRepeat`, `presetRules` - the rule sheet has no sentence under its fields), how
  the cloud reaches a stream camera's address (`streamAddress` - under the field stand only states: a login
  already in the address, a carrying device that is quiet or offline, and a place without any device, where an
  address of the home network will not answer the cloud; `screens/camera/add/RtspCamera.tsx`). A
  paragraph over a button was read by nobody and pushed the button off a short screen. **A setting-up flow says one
  sentence where it said paragraphs** (the redesign session of 2026-11-13, after the third critic counted six to
  nine lines): the plan editor's figures ("Was du leer lässt, behält das Gerät.", help `stepSettings`), a plan at
  rest ("In Ruhe schreibt er nichts; gestartet beginnt er bei Schritt 1."; "Später einsteigen" behind `planMoves`,
  why a device is not ready behind `plan`), Lichtzeiten - which never names UTC to a grower (help
  `lightHardStart`) -, the regulation-off banner (`climateControl`), removing a member (`removeMember`; the link it
  stops is the one further sentence) and the stream form's Premium and test notes (`rtsp`).
- **What a finger is offered is 44 px high** where it is tapped: a toast's buttons, the chips of a sheet, a tab, a
  filter, the links of a notice, the ways and the lengths of a hold, the link of an empty page, the two ways on
  the add-camera page, every chip, menu and segment of the pages under Ich (`screens/me/parts.module.css`), an
  alert's actions and the mute in Meldungen's head. Where a row must
  not grow by it, the control reaches into the row's own air - a rule card's switch through its `::after`, the
  header's logo beside the place chip out to the screen's edge, the place under a grow's name. A day card's way
  to its curves is a finger high round its middle, reaching over the title and the share; today's share, tapped
  for its explanation, stands 21 px clear of it with the same reach (`screens/grow/diary/Diary.module.css`). The
  terms of a grow's head line ("Tag 35", "Woche 2") reach 14 px up and down (`.facts button`,
  `screens/grow/GrowPage.module.css`), a stepper's typed figure is as high as its buttons (`.stepInput`,
  `screens/control/targets/DayNight.module.css`), a switch in a settings row is lent its 44 px by the row with
  the inset counted from inside the switch's rule (`screens/devices/DevicePage.module.css`), and the once-only
  notices' "Verstanden" is the outlined button, not the 36 px quiet one (the redesign session of 2026-11-12). The
  word of a status pill that explains itself reaches out of the pill (`.live > button`, `ui/ui.module.css`), and
  a tab is at least a finger wide (`ui/Tabs.module.css`; the gap is 9 px under 360 px so five fit). A page's row
  of tabs fits from 320 px and so has no veil at its edge: the veil's own width made a row that fits scroll
  sideways into nothing (the redesign session of 2026-11-14; ADR 0002, "Shape").
  **That reach ends where an ancestor cuts**: a row of `Facts` clips what leaves its box (the clip that hides a
  line's leading "·"), so the link under a device's or a socket's name was 33 px high behind an `::after` of 45
  (the redesign session of 2026-11-12, its critic's second walk). The row takes the room as padding it gives back
  as margin (`.facts > span`, `screens/devices/DevicePage.module.css`), and two reaches must not share one gap:
  the pill's row in a page's head is a finger high by itself (`ui/PageHead.module.css`). The terms "VPD Tag" and
  "VPD Nacht" under the targets take their room the same way and move the row's cut out by it (`.card .vpd`,
  `screens/control/climate/Climate.module.css`). The head of the notice that alarms reach nobody is a finger high
  by itself, into the notice's own padding, so its (i) and "Später" share no strip with the link under them
  (`NotifyNotice.module.css`); the word in Start's pill and the tick of a task reach the same way inside their
  rows; a switch on a page under Ich is lent its 44 px by its row. Measure a hit area by
  what `elementFromPoint` answers 21 px from the control's middle, not by the boxes.
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
  place; a curve's tick in Verlauf only where the place measures it. A command the device's build has not announced (holding the
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
    the status sentence that says so leads there (`MaintenanceControl`, `screens/devices/Maintenance.tsx`). Under
    Alarme the same control stands while a window runs or settles - never offering a start, naming both ends
    ("Wartung bis 15:59", "bis 16:09 kein Alarm auf diesem Gerät"), with "Verlängern" and the undo. It
    is started on Start and with the device and nowhere else (Chris, 2026-11-11): on Start it parks every
    device of the place, since a window on one device would ring as the door opens, and says so where a device
    was not there to hear it; on a device's card under Steuerung and on its page - the same control
    (`DeviceActions`, `screens/devices/DeviceActions.tsx`) - it parks that device. What a window stops is
    behind the (i) beside a running one. Neither an alert's card nor the entry sheet starts one. Start, end and
    another quarter of an hour are each answered by a toast that says until when the window now holds ("Wartung
    gestartet · bis 14:58") and whose "Widerrufen" puts the window back as it stood - ends one just started,
    restores one just ended to its minute. A device that was not there to hear it gets no toast; the control
    says so.
  - "Regelung aus" stops everything and pauses a running plan, whose next step would switch it on again; on is one
    tap. Switching off is confirmed in the danger style (ADR 0002). Off and on are answered as every setting of a
    device is (`useSaved`), said as the state they put the device in: "Regelung aus · Plan pausiert", or that it
    is saved and not with the device yet ([app-wording.md](app-wording.md#one-word-per-thing)); taking off back switches on again and resumes the plan the switch paused, and the switch-on toast says
    that the plan goes on. The sheet closes with the answer. **While it is off, Steuerung keeps the light and the
    targets** (the redesign session of 2026-11-13, after the third critic found them gone while the question named
    them as the way back on): one line above the cards says they hold once regulation is on again, and saving any
    of them - a figure, the light, a preset, the light limit stepped in place - switches it on, which the sheet
    ("Das schaltet die Regelung wieder ein.") and the toast ("… gespeichert · Regelung an") say; its undo puts the
    figures back and switches off again. **The switch-off question says exactly that** (Chris, 2026-11-14: any
    change on Steuerung switches it back on, the light limit included, as built - the question had promised only
    saving targets or a preset): "Jede Änderung an Licht, Lichtgrenze, Zielwerten oder Klima-Preset unter Steuerung
    schaltet die Regelung wieder ein – oder du schaltest sie hier ein." The banner says it in a few words of its
    own after its list of what stands still ("Jede Änderung an Licht oder Zielwerten schaltet die Regelung wieder
    ein.", `climateControl.offBack`, for whoever may manage), so the line above the cards says only that they hold
    once regulation is on again. The banner's list of what stands still is the switch-off question's,
    fans included (a catalogue test holds the two lists alike). "Fortsetzen" or "Plan starten" on a plan paused by
    regulation off asks first, since the step it sends switches regulation on, and its toast says so ("· Regelung
    ein"; `screens/control/PlanPanel.tsx`, `ContinuePlan.tsx`); the ask has one filled green button (§9).
  - A restart and a build installed by hand are asked first and answered by a toast once the server took them
    ("Neustart angefragt · …", "Update auf … angefordert · … startet dabei neu"); neither can be taken back. A
    restart a device was not there to hear keeps its sheet open and says so.
  - Saving a figure a running plan writes (a target, the light limit) pauses the plan first - it would put the step's
    figure back within the hour - with its reason ("Zielwerte von Hand gesetzt"), and says so in the sheet from the
    first keystroke, with Speichern live as soon as the figure differs (the redesign session of 2026-11-13: the
    sentence came on blur, so a tap on Speichern skipped it); the toast names the pause ("Temperatur am Tag 26,0 °C
    gespeichert · Plan pausiert"). The paused plan is continued and stopped on the plan page alone, where Steuerung's row leads in
    amber (§2). The server stores the reason as words, in the language of whoever paused; the row and the plan
    page say one the app wrote itself in the reader's language (`pauseReasonOf`, `screens/control/plan-labels.ts`,
    [webapp-time-and-language.md](webapp-time-and-language.md#translations)) and any other as it was stored.
  - Skipping, stopping, extending or removing a plan, and going on at a step of one's own choosing ("Plan bei
    Schritt fortsetzen"), ask first with the shared `Asking`.
  - Gewächshaus is chosen on a sheet that says what it stops before "Speichern", since it stops holding the
    humidity; back to Standard is the same sheet. Keimung and Trocknung darken the device and are no modes to
    pick: they come and go with the climate preset, whose sheet says what starts and ends before "Übernehmen"
    (§8).
  - Opening the demo replaces the grower's session, so it asks first. Starting a grow says on its button that it
    sets the stage's climate where it does (§2, "One form starts a grow").
  - A link in a mail does nothing by being opened: the activation page activates on a tap, because mail programs open
    links to preview them (`screens/Activate.tsx`).
- **Nothing on Steuerung is a draft, and every write is answered** (the redesign session of 2026-11-12). A
  figure, the light's times and a preset each have a sheet with one button; the light limit is stepped in place
  and sent once it rests. **A figure outside its range is refused, never clamped** (the redesign session of
  2026-11-13, after the third critic typed 99 and saw 35,0 °C written): under the field in words that name the
  range, Speichern waiting, and nothing but what was typed is ever sent - every value sheet, the light limit,
  Lichtzeiten's length, a plan step (under its pair and under Speichern, named with its step; a figure the step
  already carried is not held to it again) - from the contract's `TARGET_RANGES` (`rangeRefusal`,
  `screens/control/climate/range.ts`; the stepper keeps what was typed, `targets/Stepper.tsx`), and the server's
  400 is said in the same words. **A refusal stands once the field is left or Speichern is pressed**, never on the
  first digit of a figure on its way to a valid one (the redesign session of 2026-11-14): `Stepper` hands the
  figure on while it is typed and once more on leaving, and `ValueSheet`, the plan editor and `DurationField`
  (`onTyping`) say it from then on. A refused light length leaves the plan's summary on the last length it
  accepted. The answer is the toast that names what changed ("Temperatur am Tag 24,0 °C
  gespeichert", and for an offline device "… gespeichert, noch nicht am Gerät") with "Widerrufen" where
  taking it back is real - it also resumes a plan the save paused. **"Widerrufen" writes back only what that
  save moved** (the redesign session of 2026-11-12, after its critic's second walk saw a light limit stepped
  after a target go back with the target): the route replaces the device's document whole, so the way back
  reads the document as it stands at the tap and puts the figures from before into it - a setting saved in
  between stays (`write`, `climate/Climate.tsx`; `readConfiguration`, `api/devices.ts`). A preset into
  germination is taken back that way with the dark ended; one out of it by two such writes, since the dark
  keeps the day it finds and remembers the night it replaces: the figures from before in the light with the
  night germination had kept, then germination with its own. A preset that starts or ends a drying spell has no
  way back, nor has a spell ended by itself (§8) or a germination left while its humidifier rested: the server
  keeps and returns more than one write puts back. **No panel is a form**: a figure opens the value sheet (`climate/ValueSheet.tsx`), one
  of a few its sheet of choices, a switch is written on the tap (`devices/Settings.tsx`), and a place led by a
  Plantalytix Socket, a LIGHT or an AIR fan is built from the same parts as a controller's - the Licht card and
  its sheet, the shared stepper, the toast with "Widerrufen". One sheet holds several figures only where they make
  sense together: a socket's two switch points, a timer window's start and length. Erweitert's fields are lines
  that open the same sheets. The firmware card's switch and its channel answer the same way; the camera's
  settings are a form with one Save (§2).
  - *Alarme answers too*: a rule's switch ("Alarm „Zu warm“ aus", taken back by switching it again), a one-tap
    rule ("Alarm „Zu trocken“ angelegt", taken back by removing the rule it wrote), an hour of silence ("„Zu
    feucht“ 1 Std stumm", taken back by lifting it; "wieder laut" has nothing to take back). A rule card's
    "erreicht dich nicht · einrichten ›" is a 36 px target, drawn as the line it is.
  - *A plan's moves name what happened*: "„Plan“ pausiert" is taken back by continuing; a plan continued,
    started, confirmed, extended, skipped, stopped, removed or continued at a step of one's own choosing sends or
    ends something and is only said (`told`, `screens/control/PlanPanel.tsx`).
- **"Widerrufen" answers, in the toast it stood in, and says what holds now** (`log/LogProvider.tsx`; the
  redesign session of 2026-11-13): once its way back has landed, the toast stays where it stood, without a
  button, and reads "Zurückgenommen · <what holds again>" - one form, composed in one place (`undoneLabel`,
  `log/lines.ts`), never opening with the button's own word (the redesign session of 2026-11-14). The form that repeated the label ("Widerrufen: Alarm … aus") said the opposite of what held
  and is gone (after the critic's walk of the clearing-up round); the toast's type (`Told`, `log/log-context.ts`)
  takes no undo without what holds again, and the words for the cases are in
  [app-wording.md](app-wording.md#one-word-per-thing). This holds for every undo in the app, a diary
  line's and a tick's included; no page writes a second toast of its own. A way back that was refused says so
  with "Nochmal versuchen", which shows that it is trying. The newest toast stands at the edge the stack hangs
  on - over the bar, at the window's foot, against an open sheet's box - so none moves when another's time is up.
- **A toast never stands over the control it answers** (`log/toast-room.ts`, `log/Toasts.tsx`; the redesign
  session of 2026-11-13, twice: the clearing-up round made it one rule, and its critic found it holding for a
  finger only): whatever activated the control - a tap, Space on a focused switch, a select changed by
  keyboard. A toast keeps the control that was used last when its write began (`lastUsed`, heard from `click`
  and `change`), and whenever a toast arrives or the toasts' box grows, the page is scrolled until every
  standing toast's control is clear of the box (`clearOf`) - so a second toast does not push the first over its
  own row. While toasts stand at the window's foot the page is longer by their box, and the room it was
  scrolled into stays until it is scrolled back out, so nothing jumps when a toast leaves. A control in a
  sheet, in the bar or in a toast is left where it is; with a sheet open the page does not move.
- **Toasts do not pile up** (`log/toast-room.ts`, `log/Toasts.tsx`; the redesign session of 2026-11-12, after its
  critic's walk): at most two stand. A control that may be used again at once names itself (`from` of `tell`) and
  its next answer takes the place of its last - five steps of the light limit are one toast. Beyond that the
  oldest settled toast goes, never a line still on its way or one that failed: its toast is the only place that
  is said. **A toast stands on the page it was raised on** (the third whole-app walk): a settled one goes when the
  page changes - unless it was raised a moment before, by what led to the new page -, and a toast taken back takes
  every settled one raised after it along, which may have built on what no longer holds (a plant's harvest after
  the plant's adding was undone; `log/LogProvider.tsx`). **No toast lies on an open sheet** (the same session, after its critic's second walk found two over a
  sheet's title and stepper): while one is open the toasts stand outside its box - under it where the window has
  the room, as beside a desktop's centred sheet, else over it, as above a phone's short one - and where neither
  side has the room, in the sheet's foot above the button row, where they are part of the sheet: its body gives
  them the room and scrolls, and their "Widerrufen" is tapped and tabbed to there (`besideSheet`). The sheet is
  measured as it stands without them and where it comes to rest. They are back at the page's foot when it
  closes. A toast is drawn as its write is answered; a figure stepped in place is written once it rests (§12),
  so its toast follows the last step by that rest.
- **An output held by hand has one control** (`HandHold`, `screens/devices/HandHold.tsx`; the redesign session of
  2026-11-12, after its critic found a socket page's duration chips switching a socket the other way), on a
  socket's page and on the light output's row under Ausgänge: Auto · An · Aus, and under An or Aus, once tapped,
  the lengths of a hold under a head that names the way ("An halten für"). A length is the tap that sends and
  Auto sends at once: nothing sends a way it does not name, and no hold starts without its length. The asked way
  is marked at once ("wird geschaltet …") and named in a toast; a second tap sends nothing while the request is on
  its way; the line over the control stays the device's report until its table agrees, and after a minute
  without it the control says that the device has not confirmed. The way that already holds is not sent again
  with another length, because the firmware reports a hold only when its way changes
  ([smart-sockets.md](smart-sockets.md#in-the-app)). Where no hold can be asked for, the control is not drawn and
  one sentence says why.
- **Silencing a rule for an hour is one tap in two places** (`useSilence`,
  `screens/control/alarms/use-silence.ts`): behind the ⋯ of an open alert's card ("Diese Regel 1 Std stumm") and
  on the rule's own card under Steuerung › Alarme, where it is offered on a rule that has raised or is silenced.
- **No long press, anywhere** (Chris, 2026-10-21/22): a function behind a hold, a right-click or a shift-click
  irritates and stays hidden. A tap on a tile of the entry sheet opens its view, filled in with the last can; Save
  writes it (5 s Undo in the toast). The lengths of a hold stand under the way that was tapped. Pressing and
  holding a stepper's +/- still repeats the step: a tap does the same thing, so nothing is hidden there.
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
- **An alarm rule whose limits contradict each other is refused** (the redesign session of 2026-11-13: "über 70,
  unter 80" rang at every value): from the moment both limits are typed, a sentence under them, both fields
  invalid and Save waiting (`boundsContradict`, `screens/control/alarms/rules.ts`); the server refuses the same
  (422 `limits_contradict`) and is said in the same words. **A device's name is unique in its place**: refused
  under the field in the rename and move sheet from what the page holds and from the server's 409
  (`DeviceSettingsSheet.tsx`).
- **Edits by hand ask before they are left** (Chris, 2026-11-13): a feeding scheme's cells changed and not saved
  ask in the unsaved bar before another page of the app, a reload, a closed tab or a typed address takes them
  ("Verwerfen" in the danger style; `LeaveGuard`, `screens/grow/scheme/LeaveGuard.tsx` - the router's blocker and
  `beforeunload`); the grow's own tabs keep the cells and ask nothing, and the scheme shelf's sheet asks on close.
  The plan editor asks as it did.
- **A phase without its climate writes no device, whatever the stage** (the redesign session of 2026-11-13, after
  the whole-app walk's blocker: Trocknung under "Lassen, wie sie sind" put the tent into drying and its light off):
  "Lassen, wie sie sind" is a record, on the route as in the sheet, and drying, like germination, starts and ends
  only with its climate (`server/test/specs/germination.spec.ts` asks every stage). Taking a phase back writes no
  device either: its question says what the device goes on holding (`heldNow`, `screens/grow/phase-climate.ts`)
  and, where it dries or germinates under the phase left, that it goes on doing so, with the way to "Trocknung
  beenden" under Steuerung. It offers no "put back the values" (Chris, 2026-11-13): "Trocknung beenden" already
  brings back the targets from before drying. Entering, correcting and
  taking back a phase from the grow's menu answer with a toast, with the way back where one call takes it (a phase
  that wrote targets, and a take-back, have none). The correction's two chip rows are labelled "Phase" and
  "Klima-Preset". **The first climate chip reads "Lassen, wie sie sind"** in the phase, split and plan sheets
  (Chris, 2026-11-13; `keep` of `StageClimates`, `screens/grow/ClimatePick.tsx`), under a "Klima-Preset" label;
  a split writes a climate only with a preset, and in a plan step the chip means no closer climate than the
  stage. The phase correction keeps the climates' own names, since it writes none.

## 6. Help texts
- **The app explains itself: every term (VPD, phase, stage, preset, plan, maintenance, share window, …) and every
  complex control gets a help text, in English and German** (Chris, 2026-09-24).
- One primitive, `ui/Help.tsx`: `Help` is the (i) beside a control, `Term` a word with a dotted underline; both open
  `help.<topic>` as a toggletip ([topics and their test](webapp-time-and-language.md#help-topics)). One too
  tall for the side it opens on scrolls inside itself and is cut between two lines of its text, never through one
  (`placeBubble`; the redesign session after Verlauf's sixth walk).
- A term is explained where it first appears on a screen - not inside a link, not where a sentence already explains
  it, not on admin-only screens. A help text must be true of the code: the first check of them all found eleven
  places where copy and behaviour disagreed, so writing one is an audit.

## 7. Verlauf, day and night
Verlauf is the one page of curves (Chris chose it on 2026-11-11, decision 6, and accepted the prototype on
2026-11-12; the page "Graphen" and its address went). Chris's verdict on the two pages before it was that they were
less precise and less intuitive than the old app's charts; what follows answers that. Where a rule is not Chris's
it was decided by the redesign session of 2026-11-12 while building it, or after its critic walked the built
page the same day ("after the walk" below) - none of those is Chris's.
- **`/timeline?device=<id>` is about that device** (`screens/Timeline.tsx`; the redesign session of 2026-11-12,
  after a device that had left drew its old curve under the chosen place's name beside the new device's live
  value): the page writes the place the device stands in into the address, the chosen place follows, and a device
  that does not stand in the place shown is said in a sentence and dropped, without asking the server.
- **One page, its whole view in the address** (`screens/timeline/view.ts`): which stretch of time, where the cursor
  stands, which curves are ticked, one picture or several, the step, what is laid over, one climate of several. A
  reload, a bookmark and a link sent to somebody open on the same picture, and the page changes its view only by
  rewriting its address, in place: Back leaves Verlauf rather than undoing a zoom - a history entry per zoom
  would be worse (kept after the walk). A bare address that draws the ticks remembered in this browser writes
  them into itself, so a copied address draws the same curves anywhere. A device, a grow or a comparison the
  address names and the place does not have is said in a sentence and dropped; a grow that stands in no place
  is sent to its page Messwerte, where its hand-measured curves are (after the walk).
- **Every stretch of time is three kinds of step away**: the chips 24 Std · 7 Tage · 30 Tage, and Phase · Grow
  where a grow stands; the arrows, back and on by the window's own width and never past now; and the zoom, in and
  out through one ladder of widths - 5 and 20 minutes, an hour, 6 hours, a day, 3, 7, 30 and 90 days, one and
  three years - so four taps lead from a day to every single sample and the old charts' three years are four taps
  out. The window is named between the arrows ("Gestern 14:30 bis jetzt"), with the grow's days and how far apart
  its points are, said once and quietly in the unit that fits ("alle 3 Min", "alle 4,5 Std", "alle 2,3 Tage"). A
  whole day of the calendar reads as that day ("Gestern", "Mo, 11. Aug"), and today - a day card's link, the
  sheet's jump - is shown from its midnight up to now and follows it, until its own midnight has come. A window
  that reaches now follows it and says "jetzt"; one stepped back to stands still, and then - only then - a
  button "Jetzt" leads back to the same width ending now (after the walk: the way back must be marked). No chip
  is hidden: the chips wrap, and where the head does not fit one row - several places, a device to choose - it
  takes a second; no row scrolls. No chip is lit for a range the page is not showing. An arrow is named as a
  person says it (after the fourth walk): by the chip's own words ("7 Tage früher"), a stretch no chip names
  by its whole days ("3 Tage früher"), and anything else - a stretch of a grow, 72 hours and a minute -
  "Zeitraum davor" and "Zeitraum danach", never "4321 Min früher". An axis names a day one way on every line
  and both ends, on a phone's every other day too: by the clock up to a day and a half, "Di 10." up to eight
  days, its date past that. Beside the rail (from 1200 px) the head is one row, the page is 200 px wider than
  a page of text, and the cursor's card and the diary take a third of it; where a diary row is too narrow for
  its words and the mark "von allein", the mark takes the next line (after the fifth walk).
- **The cursor keeps its instant through a zoom**, and its place on the screen. Resting at the end of a window
  that follows now, a zoom stays at now; in a window that stands still with no cursor set, it keeps the middle.
  **The cursor is what the address says and nothing else remembers it** (after the third walk): with no `at`
  the card rests - "Verlauf" in the bar leaves no cursor behind -, and a cursor the address sets in the future
  is dropped from it.
  **At rest the card says the last thing that was heard** (the redesign session's rule A after the fourth walk, 2026-11-13; `restOf`,
  `screens/timeline/model.ts`): the device's last reading where the window holds it - its values, its output
  levels, its time -, else the window's last drawn point; one function says where, and the page reads the
  curves there once, for the card and for the head of every panel. The reading is "jetzt, 03:59" while the
  server calls it fresh and "letzter Wert · 03:59" from the moment it is stale - the mark Start goes by
  (`valueAge`, two minutes), on every range, for the owner and through a link. A cursor left at the window's
  end stood past the reach of the last point: a reading five to ten minutes old gave a blank card under
  "jetzt" with outputs that contradicted it, and a window zoomed into the past rested on "— · — · —". With
  the cursor set down beside the reading the card names it the same way, with the reading's own time.
  Rest holds whatever is ticked (after the fifth walk): with no curve drawn, and for a place of outputs alone,
  the card is still the reading - its time, its levels. **A window that reaches now rests on the reading at
  every zoom** (after the sixth walk): the reading's instant is up to a beat past such a window's end, and a
  cursor clamped to the end read a point's mean under "letzter Wert" in about half the loads of a zoom; only a
  cursor somebody set is held inside the window. On the reading the card shows every value the reading
  carries - one older than a reading stays fresh says its own time ("CO₂ 801 ppm · 09:15") - and a dash never
  stands without its name ("CO₂ —"); a panel's head marks the older value the same way ("871 ppm · 13:25").
  **A silence is said once, and the card keeps its height under a finger** (after the seventh walk): where the
  cursor reads no value and no output, the card says "keine Messung" and under it between which two readings
  ("10:36 bis 13:11") - a wall of named dashes grew the card by a line on a phone and moved every plot. The
  ends are the minute the lamp's line names: both are the answer's `silences`, the last sample before and the
  first after, since the eighth walk - read off the drawn windows the card said "03:00 bis 03:09" of 02:59:55
  to 03:10:00. Inside a silence wider than two steps the cursor snaps to no neighbour's mean, and the point of
  a window a silence begins or ends in stands in the middle of what was heard of it, never inside the silence
  (`pointsOf`). A named dash is for one value missing among present ones. Each row of the card,
  and each head's figure, keeps the room of what it says at rest (`data-rest`, set unseen under it), so a
  value, a value with its own time and a silence are one height: measured at 320, 360 and 390 px with the
  first curves and with all of them. **One card is one point** (`readAt`, the same walk):
  the nearest point on any line drawn, every curve's figure at that same instant - a curve that has none
  there is named with its "—" - and the outputs of that point's window; near the edge of a silence the
  figures had snapped to the last point while the outputs said "—". **Rest is not a cursor**: "Zeitraum
  abspielen" starts at the window's first picture unless the address carries `at`. An `at` outside the window
  that is drawn leaves the address, as one in the future does (after the seventh walk). **There is one answer
  to "no curve"** (after the eighth walk): an address that names none the place has - `show=`, the diary
  alone, a word that is no curve - draws the ones a place starts with, and in "Anpassen" the last curve
  ticked cannot be unticked, which the sheet says in one caption ("Eine Kurve bleibt immer gewählt."). The
  note "Keine Kurve gewählt" and the card of a stamp alone went with it.
  A drag with the mouse marks the stretch to zoom into, two fingers pinch to it, and Ctrl with the wheel - a
  trackpad's pinch - zooms around the pointer; the wheel alone is the page's. There is no free panning - the
  old Ctrl-drag, a two-finger pan: steps by the window, drag-select and pinch stand in (kept after the walk; a
  question for Chris). The zoom's two buttons stand in the cursor's card, which stays in sight while the page
  scrolls; the card's lines keep left of them with every curve shown, a fact longer than its line breaking inside
  it, at rest as on view (`Timeline.module.css`, `[data-rest]`; the third whole-app walk found "Blatttemperatur
  24,4 °C" under the "+" at 360). The line under the window's label starts with a capital in English ("Day
  30-31"). Arrow keys move the cursor a point, Home and End to the window's start and back to rest.
- **A thumb scrolls the page over a plot** (`charts/scrub.ts`): a touch moves the cursor only once it travelled
  sideways or was a tap, so a scroll that starts on a curve leaves the cursor where it stood. A second finger
  never sets the cursor: it gives back the one the first was moving, and the gesture is a pinch or nothing
  until both have lifted. A mouse reads on its way over a plot and sets the cursor down with a click; leaving
  gives back the one set down.
- **A chart is not finished until it states a number**: each panel's head says the lowest and the highest of the
  window and the reading at the cursor; the scale's two ends stand in a gutter beside the plot - as wide as the
  longest figure, the same for every plot so they share one time axis - and never on a curve or on the dot of
  "now"; both ends of the window under it, with at least three lines between them down to five minutes. What is true at the cursor is read in a card that stays put - a tooltip under a thumb cannot be read:
  the camera's still of that moment, the instant, a figure per curve drawn and what each output did. On a phone
  the card stays under the header while the panels scroll; beside the rail it stands right of them. The cursor
  reads the point nearest to it and its dot sits on the line. A single sample - a window read at the five seconds
  a device reports in - stands at its own time, to the second; a point of a wider step is a mean and says so,
  with its stretch ("Mittel 03:09–03:12"). A point that holds one sample - a device slower than the step - is no
  mean and says the stretch alone ("Di 00:55–01:20"): the answer does not say when in it the sample was taken,
  and the sixth walk's stamp, the point's start, named an instant nothing was measured at (after the seventh
  walk). No stretch runs past the window's end: the last is what the read's end left of its step. **A point never
  stands inside a silence the card names** (the redesign session of 2026-11-13, after the whole-app walk found
  10:46:30 under "keine Messung 10:45 bis 12:15"): it stands in the middle of the longest heard part of its
  window, or on its one sample where that part is an instant (`placedOf`, `heardParts`, `screens/timeline/model.ts`),
  and the card names the stretch that was heard, not the point ± half a step (`over`, `meanStamp`, `labels.ts`). Once one figure of the card needs its name - two in one unit - every figure carries
  its name (the redesign session of 2026-11-14). This card is the one place a moment's picture inside a day is seen - the camera's page
  scrubs no day - and it can play the window through its pictures.
- **A point is the mean of its window with the lowest and highest sample around it**, drawn as a pale area behind
  the line: a door open for forty seconds moves a three-minute mean by a fraction of what it moved the air, and
  was invisible in a day's picture. "Tief" and "Hoch" are those samples, not the means. Zoomed to 130 points or
  fewer each point is a dot on its line, and a reading with a silence on either side is a dot at any zoom.
- **One figure for one thing** (after the walk). A reading is written here as every screen writes it
  (`figure()`), with one exception the second walk decided: **a humidity is read to a tenth on Verlauf** - the
  cursor's card, "Tief" and "Hoch", the table - as the picture has it and the sensor delivers it ("Hoch 75"
  stood over a highest sample of 74,6), while Start's tile rounds the same reading to whole per cent. The first
  fix pass had made it whole and asked Chris; the session's word stands until he says otherwise. "Jetzt" is the
  device's last reading, which the answer carries for every reader alike (`reading`; a share link's reader sees
  the same figures and output levels), drawn as the curve's last point on
  every range - not the mean of a month's last hour and a half - and only while the server calls it fresh: stale,
  the head and the card read "letzter Wert · 16:17", and the band and the night end there, on 30 Tage as on
  24 Std. The mean of the window that reading fell into gives way to it, whichever half of the window it fell
  in, and on the reading the card says each output as the reading has it, not a window's mean. Start's
  two small curves name the lowest and highest sample of the day, as Verlauf's head does. **A figure of VPD is
  a VPD that occurred**, at every range ([data.md](data.md#influxdb)): its "Tief" and "Hoch" - which take the
  reading that closes the curve in, as humidity's do - are of the deficit
  of single samples up to three days and of means over five minutes beyond, which the help on VPD and on the
  band says in one sentence; every range has a line, an envelope and "Tief · Hoch", and a point is the mean of
  what it was worked out from, so the line does not leave its envelope (after the second walk, which found a
  bow-tie over a grow and a "Mittel … bis …" where the first fix had stopped at three days). Beyond three days
  the head says beside VPD's figures what they are of ("aus 5-Min-Mitteln"), every step is a whole number of
  five minutes and "Abstand der Punkte" offers none finer; temperature and humidity keep the samples' extremes
  on every range, where the door open for 40 s shows (after the third walk).
- **A place with several climates draws one**: its own, the device Steuerung leads with, and the head names it
  in a choice that leads to another; no curve is a mean of two devices, and the strips under it are its own
  outputs and those of what is no climate itself (after the walk).
- **An output is a strip under the curve it acts on**, on that curve's own time axis so a run stands under what it
  did: the heater under temperature, the dehumidifier (a fridge's compressor) under humidity, the CO₂ valve under
  CO₂; the lamp and what acts on no curve drawn - fans, a socket's relay - in a card of their own on a phone and
  under the last panel beside the rail. This replaces the lanes and the outputs drawn as curves.
  **An output's figure is counted from its samples** (the session's rule B after the fourth walk, 2026-11-13): for every drawn
  point the answer says how many samples the window held, in how many the output ran, and its mean level over
  all of them in per cent, off counting as 0 ([server-engines.md](server-engines.md#read-models)).
  Everything said about an output comes from these and nothing from a run rounded out to the step - a valve
  that opens five seconds every two minutes read "75 % der Zeit an" where its samples said 3 %. A point of
  the strip is tinted by the share of its samples the output ran in, which keeps what Chris asked of the
  lanes on 2026-10-12 - a compressor cycling all week reads as how often it ran, not as one solid bar -, and
  one driven at a level - a dimmed lamp, a fan's speed, the heater's demand - is filled to its mean level, so
  a sunrise is a ramp and a heater's demand no row of ticks. "x % der Zeit an" is a share of time - of the time the
  device was heard, each drawn stretch by its width (`overTime`; after the seventh walk): counted by samples, a
  day of live samples every 30 seconds outweighed a week of history every quarter of an hour, and a 12/12 lamp
  read 61 %. It is on the screen beside each output's name ("Heizung · 3 % der Zeit an"), not
  only for a screen reader; the lamp's line - its stretches by the clock, its share, how bright - is that
  label, beside the rail as on a phone (after the fifth walk). The label is facts in that one order at every
  range and never ends a line on its dot (`Facts`); the level is said once where every stretch ran alike, and
  an output driven at a level adds its mean over the time it was heard ("Heizung · 38 % der Zeit an · im Mittel
  12 %"; after the sixth walk). At the cursor one form per output: one driven
  at a level in per cent, on a mean point its mean level, and "aus" at none, as on Start and Steuerung (the
  fifth walk; the fourth had written "Licht 0 %"); a switch "an" or "aus", and over a point it ran in part
  of "33 % an". Where no sample was heard - inside a silence, before a device's first reading, an output the
  reading did not say - the strip is blank and the card says "—", never "aus". The lamp's stretches by the
  clock are its samples' within three days ("07:02 bis 19:02", the same on every zoom) and to five minutes
  beyond; one that ended because the device fell silent is named by its last reading at any second and every
  step ("06:02 bis letzter Wert 09:59"), also one that runs up to a reading gone stale; one cut by a silence that has ended says the gap instead
  ("07:03 bis 10:59 · Lücke bis 16:00"). "an seit 06:00" is said only of a lamp heard now whose switch lies in
  the window: lit through the whole of it the lamp is "durchgehend an" (after the sixth walk). The line says a
  switch only where one is, and each fact once (after the seventh walk): a stretch that begins where a silence
  ends is "Lücke bis 13:11 · an" or "Lücke bis 17:00 · an bis 19:07", the gap said once between two stretches;
  a level stands with its stretch or once at the end, never after a gap's words; a lamp on in all that was
  heard drops "100 % der Zeit an" and names its level only below 100 %. A device that reports more slowly than
  it is drawn, or about as slowly, has a whole strip, a line for a curve and an unbroken band and night: what a
  gap is follows the interval the device was keeping there, and the server decides it once for curve, band,
  lanes, nights, the lamp's line and the table - a strip is cut where its points say so
  ([server-engines.md](server-engines.md#read-models); after the seventh and the eighth walk). A device heard
  less often than a quarter of an hour keeps no rhythm: it is dots and ticks with silence between. One sample
  is said as what it was ("Licht · 70 %"), never as a share of the time; a lamp's times are to the second
  where the step is under a minute, as the card's are; and a scale so narrow that both its ends read alike
  writes the figure once. The picture puts a
  strip's name left of it; it stands over the strip instead, because a strip that starts a name's width to the
  right no longer lines up with the curve above.
- **"Anpassen" holds what the page has no room for** - one sheet: a tick per curve the place has (temperature,
  humidity and VPD are ticked where nobody chose; CO₂, the leaf, lux, PPFD and a grow's own charted measurements
  wait for theirs), the lamp, the outputs, the diary's lines and the devices' own; all curves in one picture,
  each against its own scale and named with its figure; another run laid over as a dashed line - an earlier grow
  of the place on the same grow days, or another place at the same hours; the views kept in the account; a
  day of the calendar to jump to; the step; VPD of the day, the night or both; a link; the table. A tick is in
  the address at once, and the last choice is remembered in the browser for an address that names none. The
  reading a link was about is drawn whatever is ticked. A place that measures nothing is offered only what
  applies to it, and a reader through a link is not asked for saved views it cannot have.
- **The page keeps every capability of the old charts**, better rather than a copy (Chris, 2026-10-02). Not
  carried over (Chris, 2026-10-04): curated and user chart presets (saved views stand in), the timelapse in place
  of the still, the navigator strip, ctrl-drag. Not carried over from the page "Graphen" (the redesign session of
  2026-11-12, each waiting for Chris's word): an own range typed as two dates - the sheet jumps to one day of the
  calendar, and the arrows and the zoom lead on from there -, renaming a saved view, the four kinds a line could
  be filtered by (people's lines and the devices' are two ticks). A grow's hand measurements have their curve
  on its page **Messwerte**, with or without a place (after the walk): one small curve per measurement switched
  on, over the grow, from the read that page already has, drawn by Verlauf's plot (`measurementCurve`,
  `plotOption`); the words there no longer promise "Graphen", and neither does any other screen.
- **The page is met in the order it is seen** (the redesign session of 2026-11-13): in one column "Anpassen"
  beside the title and the cursor card before the plots; from 1200 px, two columns, the ranges and the window
  before "Anpassen", then the plots, then the card - the markup follows the layout (`useTwoColumns`,
  `Timeline.tsx`), no CSS `order`. Its title is every page's size, 30 and 36 px.
- **The table is one row per drawn point**: every curve with the lowest and highest of its window beside its
  mean - a window cut short where a stretch ends between two steps at the middle of what is left of it -, and
  every output as its mean level over that window's samples in per cent ("Licht (%)"; one that only
  switches as the share of them it ran in) - a switching adds no row, and nothing is written where nothing was
  heard. Its last row is the device's last reading where the curves end on it, with what that reading says of
  every output, as the card does (after the third and fourth walk), and it replaces the mean of the window it fell
  in, so the reading stands once (after the whole-app walk) -, at the step on screen: with
  semicolons and decimal commas where the reader's figures have commas, a byte-order mark, one number of
  decimals to a column, no row in which nothing is said, and a deficit's column named as worked out.
- **The diary of the window is told as the diary tells it** (`DiaryLine`): oldest first, as the curves run, a run
  of the same device line folded - standing at its first, "3× bis 01:03", the other end said in the form the
  list's stamps are in ("Do 00:39 … 3× bis Do 01:03"; `moment` of `DiaryLine` and `EntryWords`) -, an alarm by
  its rule. A line's
  stamp sets the cursor on its moment; its words
  open its correction for whoever may correct it. Once the cursor was set down, "Notiz zu 03:10 schreiben"
  writes a note dated to it. **A change of the measuring device is a line** (the redesign session of
  2026-11-12): where another device took over the place's climate inside the window, the list says "Ab hier
  misst Controller B", marked "von allein", and the grow's diary says the same on that day (`changesOf`,
  `server/src/modules/v1/timeline/place-history.ts`; `dayLines`, `screens/grow/diary/days.ts`; `DiaryCard`).
  An unnamed device is called by its type. It stands with the devices' own lines and is not told to a reader
  from outside; a move taken back inside five minutes leaves none (ADR 0001, "Places, rooms and where a device
  stood").
- **Every link into Verlauf names its moment or its day and lands on it, however old**: a diary line, an alert and
  a reading outside its targets open the day around their moment with the cursor on it; a day card's climate line
  and the camera page's "Kurven zu diesem Tag" open that day of the calendar - today up to now, live -, the
  camera's with the cursor on the day's picture, so this morning's picture is two taps from the camera page.
- **Nothing to draw is said as what it is**: a device that has sent nothing "wartet auf erste Werte"; a window
  nothing was measured in is dated by the last reading and leads to it; a place no device measures in says so and
  lists what was written. While another window is on its way the one before it stays, dimmed; a place gone quiet
  rests the cursor on its last reading and says that it is the last, and the band and the night end with it. A
  window a device that fills every window left empty is a gap at every range, and no night is shaded through
  hours nobody reported in (after the fourth walk; [server-engines.md](server-engines.md#read-models)). **No
  target band where nobody reported** (after the fifth walk): a band is drawn where its curve was heard - not
  in a silence, not before a device's first reading, not on to "jetzt" under a reading gone stale.
  **A window whose read fails keeps the last picture** (after the walk): the chips, the arrows and "Anpassen"
  stay, a notice says that this window could not be loaded and whether the server answered or there is no
  connection (`refusalText`), and its retry says that it is trying. The notice stays through a retry and goes
  when a read succeeds; while it stands nothing else moves - the label names the window that is drawn, and
  its figures stay. A first load that fails says one sentence and offers no zoom on a plot that is not there.
  What an address names in vain - a device the account has not got, a grow in no place - is told from what the
  account already holds, without asking the server a question it can only refuse (after the second walk).
- **A reader from outside is shown the tent and not the hardware**: through a place's link - and a grow's link for
  a stretch, over the grow's stay in each place (§2) - the curves, the band, the night and the strips; no alarm, no line of a device, no grow to choose, no camera page, no view, no link,
  no note - the server answers none of it and the page offers none. **A link whose window ends shows that window
  and nothing else** (the redesign session of 2026-11-14, after a window link's head named the window while its
  Verlauf said "Gestern 01:38 bis jetzt" and its chips relabelled one answer): it opens on the whole window,
  names it in dates ("12. Nov 13:00 bis 13. Nov 13:00", `windowLabel(…, dated)`), ends its axis there and never
  says "jetzt"; it has no range chips, no earlier and later arrows and no way back to now, and the zoom and a day
  of "Anpassen" stay, held inside the window, the zoom no wider than it (`bounds` of `SharedTimeline`,
  `linkBounds` in `screens/public/window.ts`, `inside` in `screens/timeline/view.ts`). A grow's link holds each
  place's curves inside the grow's stay there within the window. Its window says its clocks wherever an end is
  not at midnight, and a clock names the day it falls in ("11. Nov 00:01 bis 13. Nov 00:01"; `labels.ts`); a
  link's whole window with nothing ever measured offers no zoom and no "Anpassen" (the third whole-app walk).
- **Dimming does not shorten the day**: light hours and Verlauf count a window as lit above `out_light` 0.5 %, so
  12 h at 40 % is 12 light hours; the light panel says so where the level is set.
- **Not every mode has a day and a night** (Chris, 2026-10-03): drying, germination and 24 or 0 h of light are drawn
  as one band without night shading; a fridge gliding between halves says "Ziel gerade 23,3 °C · gleitet zur
  Nacht" on Start. Screens follow the server's held/settling answer instead of assuming day and night. What the
  band, the grey and the pale area mean is behind the (i) of the first panel.
- **A picture meant to show the plants is a lit still**, picked by the server: the newest lit one ("Licht aus · Bild
  von 14:20" while the lamp is off), for a day of the diary the one nearest midday, for a grow's card its cover first.
- **Start's two small curves say what they are**: each under its name in its colour, with the lowest and highest
  sample it ran between ("Temperatur 19,9–27,5 °C").

## 8. Steuerung and work modes
- **Day and night side by side, no switching** ("direction B", Chris, 2026-10-03), and only where the mode has them:
  Standard and Energiespar two columns; Gewächshaus temperature only (humidity is not regulated); Keimung one dark
  column (temperature, plus humidity where a humidifier holds it); Trocknung one column without light or CO₂;
  Regelung aus no table, a sentence and the way to switch on; 24 h or 0 h one column. An absent half stays as stored.
  A figure carries its reading's decimals, so "25,0 °C" stands beside "21,5 °C" (`figureText`,
  `screens/control/climate/figures.ts`).
- **The light has a card of its own over the targets** (the redesign session of 2026-11-12, after the prototype):
  when it comes on, for how long and when it goes off, "Ändern" opening the day's plan - "Licht an um" (account
  wall clock, any minute, kept across DST) and "Dauer"; the night is what the day leaves - and the light limit as
  a stepper (`climate/LightCard.tsx`, the card of a controller's, a fridge's and a stand-alone LIGHT's lamp). A
  running plan marks the light hours it sets, and a lamp held by hand says so over its times (§2). Presets change
  the duration, never the on-time. Late flower still enriches CO₂, to 600 ppm against flowering's 1000 (Chris,
  2026-10-08; `shared-types/src/v1/climate-presets.ts`).
- **A preset is taken in its sheet.** The button over the targets reads "Klima-Preset: <name>" for the preset the
  device was last put on (`control.preset`, [server-engines.md](server-engines.md#device-settings-and-plans);
  `screens/control/climate/Climate.tsx`) - a drying or germination preset only while that spell runs, any other
  only while none does. **A target or a light setting changed by hand clears that name**, as a plan step without a
  preset does (Chris, 2026-11-14): the figures are then the grower's own, and the button reads "Klima-Preset" alone -
  never the spell the device runs or the stage of the grow here. Alarme's group "Aus dem Klima-Preset …" names the
  stage and preset of the grow standing in the place.
  **A preset is never named by figures that happen to match one** (the redesign session of 2026-11-14:
  `chosenBy` and `equalsPreset` went). The sheet: the chips, of which the one the device was put on is marked
  chosen, what the chosen one moves - each figure from and to, the spell it starts or ends -
  and "Übernehmen", before which nothing applies (`screens/control/climate/PresetSheet.tsx`). **Keimung and
  Trocknung are set and ended here and nowhere else** (ADR 0007: the stage decides the work mode; the redesign
  session of 2026-11-12, after its critic found them offered under Betriebsart as well): a spell ends by taking
  another preset - or by a phase or a plan step that writes one -, or by itself, with the chip the sheet shows
  last while a spell runs: "Trocknung beenden", "Keimung beenden". That is the server's own return
  ([server-engines.md](server-engines.md#device-settings-and-plans)): the device goes back to the mode it ran -
  standard out of germination - and gets back what the spell wrote over, which the sheet names figure by figure
  before "Übernehmen" ("Lichtgrenze 0 % → 100 %", from `control.afterDrying` and `afterGermination`); a running
  plan is paused first, since its step would begin the spell again. The chip went with Betriebsart's modes and
  came back after the critic's second walk: a grower who dries without a next climate had no way out but a
  preset that was not theirs. Germination's two choices are changed in this sheet while it runs. Every screen reads the one preset table, `shared-types/src/v1/climate-presets.ts`,
  whose figures are deliberately conservative.
- **"Regelung ein/aus"**: a device on off - the factory default - must be switchable on, and screens must say that
  it is off (Chris, 2026-10-02). Steuerung's pill says the state, and where the climate would stand a device
  switched off is a sentence with the one tap that switches it on; switching it off is a row of the device's page,
  which switches it on again too (the redesign session of 2026-11-12). Every state away from the standard day and
  night (off, drying, another mode, a paused or waiting plan, maintenance, offline) is said where it is seen, with
  the one way out beside it (`screens/control/climate/Climate.tsx`, `Mode.tsx`, the plan's row, the offline box).
  On is "Regelung an" everywhere - the pill, the toasts, the plan (the third whole-app walk found "Regelung ein"
  beside it). A device page says a switch-off stored but not yet taken once, in its switch-on box. A plan's head
  says "Schritt 1 von 2" once; a step whose name is its number - left empty, or the default its writer's language
  gave it - is said by its number in the reader's language, on Start's line too (`stepTitle`, `ownStepName`,
  `usePlanWords`, `screens/control/plan-labels.ts`); "Starten setzt einen Grow …" stands only where a grow stands.
- **Betriebsart and Ausgänge are pages behind their rows** (the redesign session of 2026-11-12). Betriebsart
  (`screens/control/Mode.tsx`) offers the modes no climate preset sets - Standard and a fridge's Gewächshaus,
  chosen on a sheet that says what the mode picked does before "Speichern" - and a fridge's Energiespar switch.
  Keimung and Trocknung, running, are read there with the way to the preset. A tent controller has nothing to
  choose there, so its place has no row, and the page reached by its address says so with the way back. Ausgänge
  (`Outputs.tsx`): what the devices drive beside the climate - the controller's own lamp with its hold, a
  fridge's fans, the mode and speed of an AIR fan standing beside the place's own device, said there and set on
  the fan's page - and the smart sockets as rows to
  their pages. What the two rows say is in §2. **The pages behind Steuerung's rows are one reading column in the
  middle of the room**, as every page is (Chris, 2026-11-13; `ControlTab`'s frame takes `.reading` for a sub page,
  Steuerung's own two columns the page's width - the third whole-app walk measured Grow-Plan's centre 210 px left
  of the room's at 1920). A titled block of a device's own settings - a socket's, Betriebsart's - is a card.
- **Work modes come from one list** (`WORK_MODES_BY_TYPE`, `shared-types/src/v1/configuration-fields.ts`; Chris,
  2026-10-06: a value both sides use is defined once): fridge Standard, Gewächshaus, Keimung, Trocknung; tent
  controller Standard, Keimung, Trocknung (greenhouse needs wiring no tent has); plug, fan, light none. A person
  picks only the modes no preset sets (`modesOf`, `screens/control/rows.ts`); Keimung and Trocknung start and end
  with the climate preset, and the preset that ends a spell brings its own figures.
- **Fridges have no "Kleine/Große Pflanzen"** (Chris, 2026-10-01): small-plant behaviour by default and an
  "Energiespar-Modus" switch (the firmware's `full`: the back-wall fan rests with the compressor) on the page
  Betriebsart, in the standard mode only; its help says to try it with big plants and switch it off when the fridge runs too long
  or the lamp dims. Its dehumidifier tuning, day/night glide and "no CO₂ at sunset" are no settings (§11).
- **Keimung (dark) and Sämling (with light) are two stages on every device** (Chris, 2026-10-03). Wherever Keimung is
  set the grower chooses "Warnen, wenn es zu feucht wird" (default off) and "Luftfeuchte mit dem Befeuchter halten"
  (default on, offered only with a socket paired as humidifier) - "Der Nutzer soll die Wahl haben" (Chris).
- **Alarms must reach the grower**: while no channel delivers critical alarms, Start shows "Alarme erreichen dich
  nicht" with one tap "Per E-Mail benachrichtigen" (to the login address), "Andere Wege" and "Später" (a week, on every
  browser of the account); device setup offers the same tap (`screens/notifications/NotifyNotice.tsx`).
- **One-tap alarm templates in everyday words** ("Zu warm" from the targets, "CO₂-Flasche leer", ...) each write an
  ordinary rule and are not offered where one on the same reading and edge exists
  (`screens/control/alarms/templates.ts`); "Gerät offline" is the cloud's rule for every device. On Steuerung ›
  Alarme it stands under "Eingebaut" and is tagged so - not "Immer an", over a rule whose switch may be off (the
  redesign session of 2026-11-12, after its critic's second walk).

## 9. Look, beyond ADR 0002
- Every colour, size, radius and spacing step is a token in `webapp/src/theme/tokens.css`; a component never writes a
  literal colour. A screen counts as done once it is checked in dark and light, at phone and desktop width and in
  English and German.
- **Digits of one width only where figures stand under one another or change in place** (the redesign session of
  2026-11-13, after the whole-app walk: the cut "1", centred on a zero's width, read "60, 1 %" in a large light
  figure and "1 3.1 1.2026" in a date): a table's column, an axis and a scale, a list's time column (a line's
  stamp, a plant's day), a stepper's value, a countdown, the doses of the Düngen sheet and of the scheme grid,
  Verlauf's cursor line - `.mono` or `--font-figure` (`ui/ui.module.css`, the module's own rule). A sentence, a
  date, a chip ("A1", a week's head "W1"), a title ("Tag 31"), a tile's or a picture's figure and anything else
  that stands alone take the face's own digits; `.figure` sets only the light weight. Never
  `font-variant-numeric: tabular-nums` (ADR 0002, "Face"). The cut "1" is seven tenths of a zero wide (Chris,
  2026-11-13), so "11,1" in a stepper, a column of doses or Verlauf's cursor line closes up with no hole either
  side while a column stays within a few pixels of flush.
- A hover tint or ring is for a pointer that hovers (`@media (hover: hover)`): a tap leaves the pointer where it was,
  and a row or key that slid under it stayed filled or ringed as if focused. **A focus ring follows the shape it
  rings** (the redesign session of 2026-11-14): the live pill's is round like the pill, and the phone's logo, whose
  link reaches the screen's edge, has its ring drawn round the mark (`.wordmark`, `app/shell/TopBar.module.css`) rather
  than cut at the edge.
- A tap target is a finger high: a grid cell, a picture count, a dotted term (`ui/Help.module.css`) at least 36 px.
  A term is a box of its own - 9 px above and below its words, held out of its line by a margin as deep, 37 px in
  small type - so its line does not grow; a reach drawn around it (`::after`) had left "98 % im Zielband" 19 px
  high in the Bericht (the redesign session of 2026-11-14).
  Eintrag's tiles are one grid of four equal cells (`log/Log.module.css`): a last row that is not full is not
  stretched. A done task's line says who and when before where, so a long place name breaks on a line of its own
  and "du · heute 08:48" keeps its dot (`DoneCard`, `screens/tasks/TaskCard.tsx`).
- **Paper is light whatever the theme**: the dark set is redefined for the screen only (ADR 0002, "Styling"), and
  what a printout does not need - the bars, "Alle Grows", ⋯ - is `data-print="omit"`.
- **A page's title fits a 320 px phone** (the redesign session of 2026-11-13, after "Benachrichtigunge / n"):
  every `h1` hyphenates words of 16 letters or more, and below 360 px the title steps down from 30 to 26 px
  (`--text-title`, `src/styles/global.css`); "Ort bearbeiten" steps down to `--text-xl` there, so it fits one line
  beside Speichern (the redesign session of 2026-11-14).
- **One danger style** (ADR 0002, "Shape"): the yes to a step that cannot be taken back is filled in the alarm's
  red under white words, and the control that opens its question is outlined in it - "Ort entfernen …" on "Ort
  bearbeiten" was amber, which is for what is wrong. "Gerät abgeben?" and a socket's removal confirm with it too
  (the third whole-app walk found "Abgeben" outlined at radius 18).
- **Every switch is a finger's target** (`.switch::after`, `ui/ui.module.css`): 44 px both ways reaching into the
  air around it, once for every switch - "Nachts eigene Schaltpunkte" and "Energiespar-Modus" were 42×24. A
  label's (i) stays with the label's last word, so it never stands apart at 320 px (`Named`, `ui/Help.tsx`).
- **Every question is answered by one part** (`Answer`, `ui/Asking.tsx`; the redesign session of 2026-11-14): the
  yes - danger-filled, primary or `quiet` - with "Abbrechen" beside it, at the control's 44 px and radius.
  `Asking` is built on it, and so are the place's removal, the member ask, the end of a room on "Ort bearbeiten",
  the admin's deletions and its question about its own rights, the account's deletion, the shorter climate
  window under Datenschutz and a grow's repairs (`RepairAnswer`); switching regulation off keeps its sheet's own
  pair, the yes with its icon, then "Abbrechen". **An ask has one filled green button**: where the button that
  asked stays filled beside its question, the yes is `quiet`, outlined - "Fortsetzen" filled, "Fortsetzen und
  Regelung einschalten" outlined; where the question replaces the button, as the second grow's does, its yes is
  the one filled.
- QR codes stay dark on light in dark mode (`--qr-ink`, `--qr-paper`): some scanners cannot read an inverted code.
- Amber (`--warning`) is for what is wrong and for a state somebody chose that stops regulation (Regelung aus, a plan
  paused for a figure set by hand); a running output is the light navy (`--output`) and a lamp's light its own
  straw (`--lamp`), never the warning's colour.
- Nothing is set bold and nothing in capitals: three weights (light for titles and figures, regular, medium for
  what is stressed) and sentence case throughout (Chris, 2026-11-13: the type was "bold everywhere, nothing
  fine"; ADR 0002, "The look").
- **Facts side by side break between two facts, never inside one** (`ui/Facts.tsx`, decided 2026-11-12 after
  320 and 360 px showed lines ending on "·" and "Licht" parted from "aus"): "24,3 °C · 66 % · Licht 80 %" is a row
  of facts with the dot in front of each, and the dot of whatever fact starts a line is not drawn - so no line ends
  on the separator and none begins with it, a figure keeps its unit and a label its value. A fact may be a row of
  its own (the day's targets, the night's), which stays together while it fits a line. In running text a figure is
  bound to the unit after it (`unbroken`, `ui/fact-text.ts`). Start's lines, a diary line's words wherever one is
  drawn (`EntryWords`, `ui/EntryWords.tsx`), the diary's week rows and the lines of "Alle Grows" are set this way.
- **A name a person gave breaks inside its box** (the redesign session of 2026-11-12, after a 36-letter word in a
  place's name widened Start by 43 px and the claim's last step by 172 at 320 px): the element that holds it
  breaks a word longer than its line, with a hyphen where the browser knows one and only in words of 16 letters
  or more (`hyphens: auto; hyphenate-limit-chars: 16` - Safari and Firefox ignore the limit and hyphenate any
  word): a place's h1 on Start and on the pages that edit and end it, the red button there, its card, the claim's place
  options and a sheet's title. A choice chip
  wraps its name (`ui/SheetParts.module.css`).
- **A name is shown as it was typed.** The face has no contextual alternates, so "120x120" stays "120x120"
  everywhere (under Inter it became "120×120" in running text and not in a heading, and two pages switched the
  feature off; that rule went with the face).
- A picture as bright as the page - a lit tent - keeps a hairline edge against it (`screens/start/Start.module.css`).
- **A primary button that cannot be pressed** takes the card's second surface, and its words step back towards
  that surface (`.primary:disabled`, `ui/ui.module.css`; the redesign session of 2026-11-12): the muted ink alone
  is nearly as bright as the ink in the dark theme, where such a button reads as one more quiet button. A
  device's maintenance, restart, update and install buttons that wait for the device (`aria-disabled`) take the
  same ink (`screens/devices/Maintenance.module.css`, `DevicePage.module.css`).

## 10. Privacy in the app
No location, no comments, no feed, no directory (Chris, 2026-09-16). Harvest weights and plant counts can be logged
and are hidden from shared views by a setting (`hideWeights`, `hideCounts`), which is on by default - for a new
account and for one the migration carries over (Chris, 2026-10-08: privacy is the default). The handle is the only name others see;
no real name is stored (`shared-types/src/v1/accounts.ts`). A share link and a public page name a line's plants
(`plants`, `PlantLabel`) whatever the counts switch says: it hides how many, not which (Chris, 2026-11-13);
`plantCount` stays hidden. Following a public grow puts it on one's own Start;
Follow is offered on the grow's public page and its author's profile to an account of its own, never to the demo nor
through a share link, which is a window, not a subscription (`screens/public/FollowButton.tsx`). Every sign-up agrees
to a privacy statement (the install's `PRIVACY_URL`, else the app's own `/privacy`); the server does not record it.

## 11. Left out on purpose
Old-app settings that stay out (Chris, 2026-10-02; still absent on 2026-10-08) - ask Chris before bringing one back:
- Testmodus: switching outputs by hand can damage the compressor (its old address leads to Steuerung).
- Beta-Funktionen and the free ("floating") day length, which never worked; the global expert switch.
- The linear day/night transition, "no CO₂ at sunset" and the fridge's dehumidifier tuning as settings: the server
  writes them for a fridge (`server/src/modules/device-protocol/class-rules.ts`); a tent controller keeps its own.
- Alarm cooldown seconds and the extra log message per alarm; the old charts' presets (§7).

Everything else the old expert mode offered is kept (Chris, 2026-10-06): under a device's Erweitert (the
`*.advanced.tsx` files) the maintenance light, the Kompressor-Pause (at least 240 s), light ramps and sensor
factors; a fridge's fan levels under Steuerung › Ausgänge; the update channel and a pinned version on the device's
firmware card, where one switch says whether the device updates itself, the channel is chosen only while it does
and a version only while it does not (`screens/devices/Firmware.tsx`); the alarm sheet keeps the webhook templates.
**The switch off is the old app's channel "Manuell"**: the select holds the release channels only, and no second
control names `manual`. Switched off, the card offers "Firmware-Version" with every build the server offers this
reader and "Installieren …"; where the stable channel's build is newer than the one the device runs, the card
says so with "Jetzt aktualisieren", and Steuerung's card of the place's own device with "Update vom …". A device
that follows a channel is offered neither: the rollout hands it its builds.

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
  keep the focus and say the figure they set.
- **A control at the end of its range is `aria-disabled`, not `disabled`**: disabling the focused button drops focus
  to the body.
- A field's name carries its unit where the unit is drawn elsewhere (`spokenUnit` of the targets table's steppers,
  the alarm limits); a switch's note is its `aria-describedby`; repeated "Ändern" links name their section.
- **Focus never falls to the body.** A control that is swapped, removed or disabled under the focus - Pause turned
  into Start, a step removed - hands it to the nearest control left where it stood (`ui/focus-rescue.ts`, on in the
  shell): the first control after the place the lost part stood in, else the last before it - the link under a
  card that was declined, not the first control of the page. A focus the page placed itself opens nothing: an
  explanation opens for somebody who tabbed onto it (`focusIsRescued`). A question (`Asking`) and a sheet's answer
  (`Answered`) take the focus themselves, so they are what is read. **A question is in view when it is asked**
  (`ui/Asking.tsx`; the redesign session of 2026-11-13, after its critic found three with their yes below the
  window's foot): the whole box, question and yes, is brought into view inside its sheet or page before it takes
  the focus, and Escape closes the question and not the sheet under it, which keeps what was typed there.
- **A control is not disabled while its own write is on its way** (the redesign session of 2026-11-12, after its
  critic saw the (i) beside the update switch take the focus and open): disabling the focused control drops the
  focus, the rescue hands it to the nearest control - an explanation's button - and the reader is no longer where
  the hand was. The control shows what was asked at once and ignores a second tap until the first is answered
  (the firmware card's switch and select, the maintenance buttons, the ways of a hold).
- **What happened is said once, through the app's one live region** (`ui/live-region.ts`, `<Announce>`), never by a
  region drawn together with its text or given `role="status"` only once the answer is in.
- **A sheet makes the page behind it inert** (`ui/modal-focus.ts`): `aria-modal` alone does not keep VoiceOver on iOS or
  TalkBack inside it. It is `aria-hidden` as well, because a tool that reads the markup does not know `inert`
  (the whole-app walk's critic saw the page behind a sheet in the tree). The live region is left out of that.
- **Focus is never under a bar** (the same walk): below 900 px a focused control scrolls clear of the tab bar and
  the top bar (`scroll-padding` on `html`, `src/styles/global.css`), and the page keeps 4 px under the top bar so a
  first row's focus ring is whole. **A toast's way back is the next tab stop after the control it answers**, and
  after it focus returns to that control (`useTabOrder`, `log/Toasts.tsx`) - a control held disabled while the
  undo was written gets it once it is enabled again (`regains`; the redesign session of 2026-11-14). **Focus never
  lands on a control that writes on Enter**: a one-tap alarm rule leaves it on the rule's card it made, which only
  opens a sheet, so the toast's undo is the next tab stop and not the next template (`made`,
  `screens/control/alarms/Alarms.tsx`).
- The place chooser's button says that it opens a dialog and whether it is open (`aria-haspopup="dialog"`,
  `aria-expanded`; `app/shell/PlaceChoice.tsx`).
- A group of a list is a heading (Alarme's three groups), and a help button stands beside its heading, not inside
  it: a heading's name is its words alone.
- **A value a form cannot read is refused with a word, never dropped** (the same walk): the field is
  `aria-invalid`, and the sentence describes it and the Save it disables - Gießen's litres, a reading by its name,
  the harvest's weights, a grid cell, which keeps what it had and says so; a moment the pop-up refuses keeps Save
  disabled. A disabled Save says beside it what it still waits for (the reminder sheet, whose Save stands in the
  sheet's foot).
- A stepper or a slider moved step by step is sent once it rests (1.5 s), not on every step: the first step would
  already pause a running plan (the light limit, `useResting` in `screens/control/climate/LightCard.tsx`). The
  camera's slider is local and its address follows it. Closing the plan editor with edits asks first, since screen
  reader users press Escape out of habit. A field a save is refused for is `aria-invalid` and described by why, and
  so is the Save it disables. A shell skip link leads past the navigation to `<main>`.
- A diary row says its kind as hidden words before the line (`ui/EntryWords.tsx`), so a line whose text is its kind
  word is read twice ("Gegossen, Gegossen"). Accepted for now (2026-10-15); the fix is to leave the kind out where the
  line's text already says it.
