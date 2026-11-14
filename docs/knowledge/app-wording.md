---
summary: How the app speaks - du-form and plain words, one name per thing in English and German, grow days and weeks, numbers, dates and units; read before writing or changing a string in the i18n catalogues
updated: 2026-11-14
source: the third whole-app walk's lists built - one word for regulation on, the camera's silence, a brief window, the removal page and the move, a link's end, a placeholder, the water (the redesign session's fix round of 2026-11-14); the second whole-app walk's lists built - an undo's answer, a state said as the state, a span of days forwards, a part harvested, the watering's bound (the redesign session's fix round of 2026-11-14); Chris's answers of 2026-11-14 - six kinds of a place, "Raum" only the room; Chris's answers of 2026-11-13 - "Kamera" in sentences and "Cam" only in "Terp Cam", a stage's week from its own start, litres as "L", more kinds of a place, no unit choice; the final fix round's second part - one toast form for a save, range refusals, "Weiter · <noun>", "Speichern" everywhere (the redesign session of 2026-11-13, not Chris); after the whole-app walk - "L" for a litre, one caption form, the move line from and to no place, regulation off as a line, the refusals, open alerts in words (the redesign session of 2026-11-13, not Chris); Chris (naming decisions 2025-11 to 2026-10-12; the diary's day cards 2026-11-11); app sessions and redesign review 2026-08-24 to 2026-10-04; codebase cleanup (2026-10-08); checked against webapp/public/assets/i18n on 2026-10-08; online, Klima-Preset against Vorlage and the English of Steuerung (the redesign session of 2026-11-12, after its critic's walk); one English word for the regulation, "von allein" against "auto" and "Eingebaut" (the same session after its critic's second walk); one name per alarm rule (the same session, 2026-11-12); the one wording pass over both catalogues - phase, Meldung and Alarm, Start and Home, typography (the redesign session of 2026-11-13); hinzufügen for adding a device, abgeben, löschen against widerrufen and the English its critic read as translated (the same session after its critic's walk; "Gerät hinzufügen" is the word of the prototype Chris accepted on 2026-11-12); the one form of an undo's answer (the same walk)
paths:
  - webapp/public/assets/i18n/**
  - webapp/src/ui/figures.ts
  - webapp/src/ui/zone.ts
  - webapp/src/ui/naming.ts
---
# How the app speaks

The rules for the words on screen. How the catalogues are loaded and figures and dates are formatted is in
[webapp-time-and-language.md](webapp-time-and-language.md); how the app behaves is in [app-ux.md](app-ux.md). Every
string exists in English and German, with no English left in the German catalogue; paths are under `webapp/src/`.

## Voice
- German speaks to the reader as **du** ("Ihre" and "Sie" only for third persons). Text is written the way a grower
  would say it, not in spec voice: "Ein Tipp trägt sofort ein und lässt sich 5 Sekunden lang zurücknehmen", not "Ein
  Tipp schreibt den Eintrag mit sinnvollen Vorgaben"; "auf diesem Server nicht verfügbar", not "diese Installation hat
  keinen Push-Schlüssel".
- No machine key reaches the screen: slugs, type keys (`fridge`), model codes (`terp_cam`), firmware setting keys.
  The fleet names a device by the name it was given, else by its type in words ("Controller"; `givenName`,
  `ui/naming.ts`). A switched-off e-mail channel names the address it would send to ("aus · An <Adresse>"), never
  "nicht eingerichtet" (the redesign session of 2026-11-14).
- Diary lines read "Du hast gegossen" / "<Name> hat gegossen"; one's own words stand without a name. A watering says
  how much, a feed also the week of the scheme it was dosed by: "Du hast gegossen · 1,5 L", "Du hast gedüngt · 5 L ·
  Schema-Woche 5" (`amountOf`, `ui/entries.ts`); a line about some plants of a grow of several names them ("Du hast
  gegossen · B2 · 1,5 L"), and so does a harvest of some of them while others still grow ("B2 geerntet"; the
  grow's own is "Geerntet", [app-ux.md §2](app-ux.md#2-navigation-and-the-place-page)). A move names from where to where: "Du hast von Zelt Eins nach Zelt 1 umgestellt"
  (`home.entryDone.moveFromTo`; the redesign session of 2026-11-12); from no fixed place it reads "Du hast nach
  Zweitzelt gestellt", into none "Du hast aus Zelt genommen" - no fixed place is never named in the line (the same
  session after the whole-app walk). Regulation switched off is one line for off and on, like maintenance:
  "Regelung aus · 12 Min", while it is off "Regelung ist aus". The line of a change of
  the measuring device does not repeat its stamp's hour: "Ab hier misst Controller B" (`grow.diary.measuredBy`;
  the redesign session of 2026-11-13).
- **A place's name stands by itself**, never behind a preposition glued to it: "Zelt: Lüfter hängt jetzt hier",
  "Was wächst hier?", "<Name>: Was wächst hier?" as a sheet's title - not "in Zelt", which reads wrong for half
  the names people give (the redesign session of 2026-11-13). The forms in use: the name in front with a colon
  ("Zelt: Grow starten", "Zelt: das neueste Bild"), behind a noun that says what it is ("Den Ort Zelt gibt es
  nicht mehr", "über den Raum Keller"), behind a colon or a dot as a fact ("neuer Ort: Zelt", "Klima · Zelt"), or
  the sentence says "hier" and "dieser Ort". A room is called a room where its name is said. The sentences that
  keep their prepositions are the diary's move line below, which names two places, and the destinations of "Ort
  entfernen", where a place that exists is named by its name ("nach B2 Zweit", "… zieht nach B2 Zweit um") and
  "neuer Ort" / "bekommt einen neuen Ort" is said only of a new one (the redesign session of 2026-11-14). English follows the same
  forms, and nothing "stands in" a place there: a device "is in" it, a grow "grew there".
- A machine line says only what is known: the firmware's update line is "Update angefordert" - the device was told;
  whether it took is a line of its own ("Firmware-Update abgeschlossen", "Update kam nicht an").
- Thresholds are written in words ("über 28 °C"), not with arrows or "›", since every link ends in one; metric names
  are written out (Temperatur, Luftfeuchte; not Temp, rF).
- **One word for one button**: a form is saved with "Speichern" everywhere ("Sichern" went from "Ort bearbeiten" and
  Verlauf's saved views); a step of a flow goes on with "Weiter · <noun>" ("Weiter · Klima", "Weiter · Steckdosen
  und Kamera", "Weiter · Benachrichtigungen", "Weiter · Grow"); a plan is kept with "Als Vorlage speichern". A
  page that edits a thing is titled by what it does, "Ort bearbeiten", with the name in its field rather than in
  the title. A thing is named once in a line: a plan step with only its default name is "Als Nächstes · Schritt
  2", not "Schritt 2, Schritt 2".

## One word per thing

| Thing | English | German |
| --- | --- | --- |
| where a grow or device stands | place | Ort ("Raum" only for a real room; never Bereich) |
| the bar's first page | Home | Start (never Startseite) |
| where the plants are, from germination to curing | phase | Phase (never Stadium) |
| the page behind the bell, and a card on it | Alerts; alert | Meldungen; Meldung (never Posteingang, inbox) |
| what is set up under Steuerung › Alarme | alarm | Alarm |
| adding a device with its code | add | hinzufügen (never übernehmen or beanspruchen; English never "claim") |
| letting a device go; removing an entry for good | give up; delete | abgeben; löschen ("Widerrufen" / "Undo" is the toast's way back only) |
| writing into the diary; what is written | log; entry | eintragen; Eintrag (never loggen) |
| readings where the targets are | on target | im Ziel ("in band" / "im Zielband" only for the share of a day) |
| the account | account | Konto, also in sign-in and activation |
| the page of curves | Timeline | Verlauf; what it draws are Kurven, not Graphen, Charts or Diagramme |
| what a device holds | targets | Zielwerte, not Sollwerte |
| a stage's climate in one tap; a saved plan | climate preset; template | Klima-Preset; Vorlage |
| a place, a device or a camera that reports | online | online (never "live"; "verbunden" only in "Verbunden über") |
| the automatic schedule | plan | Plan, never Rezept; old message keys stay and read the new way |
| the lamp's ceiling | light limit | Lichtgrenze |
| maintenance | Maintenance · 15 min | Wartung · 15 Min ("Regelung und Alarme pausiert" while it runs; never Wartungsmodus) |
| the built-in offline rule | Device offline | Gerät offline |
| a fridge's fans | clip fan, internal fan, back-wall fan | Klemmlüfter, Innenlüfter, Rückwandlüfter |
| a fridge's dehumidifier output | compressor | Kompressor (a tent's dehumidifier keeps its name) |
| the valve, apart from the reading | CO₂ valve | CO₂-Ventil |
| what the valve's dosing counter counts | ticks | Takte, never Öffnungen |
| a Tasmota plug a controller or fridge switches | smart socket | smarte Steckdose, short Steckdose; never Smart-Steckdose |
| the stand-alone device type `plug` | Plantalytix Socket | der Plantalytix Socket |
| the brand | Terp Control, Terp Cam | Terp Control, Terp Cam |
| a camera, in a sentence | camera | Kamera ("Cam" only in "Terp Cam") |
| what a place is | tent, fridge, balcony, drying box, greenhouse, other | Zelt, Kühlschrank, Balkon, Trockenbox, Gewächshaus, Sonstiges |

- The brand is two words in every user-visible text (Chris, 2026-06-25). **A camera is "Kamera" / "camera" in a
  sentence, and "Cam" stands only in the product's name "Terp Cam"** (Chris, 2026-11-13): "Kamera prüfen",
  "Kamerabilder an", "Die Terp Cam in der Nähe einstecken"; the firmware's own display words ("connect cam",
  "cam ready") are quoted as the display shows them. The server names a camera paired from then on "Terp Cam"
  (`PAIRED_CAMERA_NAME`, `server/src/modules/device-protocol/hardware-report.service.ts`), so an unnamed one no
  longer reads by a fragment of its id; the claim says "Terp Cam gekoppelt" or "keine Kamera".
- **The six kinds of a place** (Chris, 2026-11-13 and 2026-11-14; `PLACE_KINDS`, `ui/naming.ts`) are named in that
  order; "Anderer Ort" became "Sonstiges". "Raum" / "room" is only the room that groups places, never a kind of
  place: a kind "Raum" was added on 2026-11-13 and taken out again the next day. Factual references to the original product
  (where the app came from, the privacy text) keep its name.
- "Abluft", "Umluft" and "Lüfter" are only roles a smart socket is given (an AIR is the Lüfter); the fan device
  type is "Lüfter" everywhere.
- "Smart socket" and "Steckdose" mean only the Tasmota plugs a controller or a fridge switches, the ones Terp Control
  sells included. The stand-alone device type `plug` is the "Plantalytix Socket" in both languages, masculine in
  German ("der Plantalytix Socket", "er"), and never a "Steckdose", because the two sat side by side under one word
  (Chris, 2026-10-12). A device a grower named keeps the name they gave it.
- An output is named through `outputWord` (`ui/climate-hardware.ts`), never by its raw key, so a fridge's
  dehumidifier is the compressor on every screen.
- The CO₂ dosing counter is in "Takte": the firmware adds up how long the valve was open, in ticks of its clock
  ([device-protocol.md 5.4](../device-protocol.md#54-which-keys-each-hardware-type-reports)), and counts no openings;
  `help.chartOutputs` says so beside the chart, and the CO₂ report card and the rule sheet's note count in them too
  (`co2Report.*`, `alarms.sheet.ticksNote`).
- A share link's actions are "Ändern" (a change may widen a link as well as narrow it), "Zurückziehen", and "Löschen"
  only once it is revoked or expired - the server refuses to delete a working one (409 `share_link_live`).
- Shared texts say "das Gerät", not "der Controller". A device is called by its type alone unless the account has two
  of a kind, then with its id tail (`ui/naming.ts`). A new place gets a name a person would write, numbered past the
  existing ones, the first without a number ("Zelt", "Zelt 2", "Kühlschrank"; the redesign session of 2026-11-12), never
  the raw type key.
- "Keimung · dunkel" and "Sämling · mit Licht" name the stage only where choosing it sets the climate (see
  [app-ux.md §5](app-ux.md#5-controls)).
- **What reports is "online"** (the redesign session of 2026-11-12): on the pill ("online · vor 20 s"), a
  device's card and a camera's row. A device's page says it on the pill and nowhere else. "live" is said of
  none of them, and "verbunden" only of how a camera or a socket is reached ("Verbunden über").
- **A stage's climate is never a "Vorlage"** (the redesign session of 2026-11-12): the button over the targets,
  its sheet, the group the alarm rules a stage wrote stand under ("Aus dem Klima-Preset Blüte") and their tag
  say "Klima-Preset". "Vorlage" is a saved plan - and a ready-made measurement on a grow's Messwerte page -, and
  the ready-made form of a webhook is "Dienst für den Webhook" (`alarms.sheet.template`, `help.webhookTemplate`).
- English: the page is "Control" and so is the regulation (`climateControl.*`) in every string, the pill
  included: "Control on" / "Control off" (`control.state.*`; the redesign session of 2026-11-12 after its critic's
  second walk - "Regulating" was a second word for it). An output held by hand is "held on", never "forced on"
  (`devices.socket.forced`). A device's sheet has a block "Place"; a place's name stands by itself there as
  everywhere. One AIR fan
  is "Fan", and a build is "Firmware from <day>" on the card as on the device's page.
- The cloud's own alarm rule is grouped and tagged "Eingebaut" / "built in": it can be switched off, so it is
  not "immer an" (the redesign session of 2026-11-12).
- A place with nothing to steer and an account with no place read one sentence at Steuerung's address: "Hier gibt
  es noch nichts zu steuern: Zielwerte und Alarme kommen mit dem ersten Gerät." (`place.control.nothing`).
- **The growth stage is a "Phase" / "phase"** (the redesign session of 2026-11-13, in the one wording pass;
  waiting for Chris's confirmation): the tile, the sheet, the film and the range said Phase, while the field in
  that sheet, the plan step and the help said "Stadium" / "stage" for the same thing - two words, and a help text
  to tell them apart. Germination to curing are phases; entering one writes it on the grow with its date. The
  contract and the code keep `stage` (the value) and `phase` (the stretch); a firmware rollout's "Stufe" /
  "stage" is another thing and keeps its word.
- **Meldungen is the page, a Meldung what stands on it; an Alarm is what is set up under Steuerung › Alarme** and
  what it raises ("Kritische Alarme erreichen dich per ..."). "Regel" / "rule" names the same alarm only where a
  sentence has to tell it from the Meldung it raised - "Regel bearbeiten" on a card, "7 Regeln · alle ruhig" as
  a count. The page is never "Posteingang" or "inbox" (the redesign session of 2026-11-13).
- **Page names are names in both languages**: Start, Grow, Eintrag, Verlauf, Steuerung, Meldungen, Ich - Home,
  Grow, Log, Timeline, Control, Alerts, Me, capitalised in a sentence too ("on Home", "in the Timeline"), and a
  way through them is written with "›" ("Ich › Konto"), as a way through somebody else's app is.
- **Adding a device is "Gerät hinzufügen"** - the page, the button under the code ("Hinzufügen"), what a device
  is afterwards ("Hinzugefügt"), what somebody else may do with one given up ("kann von jemand anderem
  hinzugefügt werden"), and an operator's "noch von niemandem hinzugefügt". It is the word of the prototype Chris
  accepted on 2026-11-12; the wording pass had written "übernehmen", which the redesign session corrected on
  2026-11-13 after its critic's walk. English says "add" throughout and "claim" nowhere on screen (the code is
  "the code on the display"); the code and the contract keep `claim`. "Übernehmen" stays for what it means
  elsewhere: applying a preset or a choice, a device taking a setting.
- **Giving a device up** asks "Gerät abgeben?", answers yes with "Abgeben" and says "… ist abgegeben und kann
  von jemand anderem hinzugefügt werden" - one verb, no "entfernen". **Deleting an entry** is "Eintrag löschen"
  with "Löschen": "Widerrufen" is the word of an undo and of nothing that is final (the same session).
- **An undo's answer has one form and says what holds now**: "Zurückgenommen · <what holds again>", English
  "Undone · …" (`undoneLabel`, `webapp/src/log/lines.ts`; the same session, and the opening word since
  2026-11-14) - never the button's own word "Widerrufen", which read as a second button, and never the thing undone
  behind a colon, which is the opposite of what holds ("Widerrufen: Alarm … aus" of an alarm that is on again). A
  setting names its value again ("Zurückgenommen · Sprache: Deutsch"); an entry taken back is "nicht mehr im
  Tagebuch" (`log.gone`), a task unticked "Aufgabe wieder offen" (`log.reopened`), a thing just made "… gibt es
  nicht mehr" (`log.noMore`), a phase begun "wieder die Phase davor" (`log.phaseBefore`), and where the earlier
  words are not at hand "… wie zuvor" (`log.asBefore`). **A save has one form** (the redesign session of
  2026-11-13, after the third critic read it with and without a "·"): "Temperatur am Tag 26,0 °C gespeichert", for a
  device not heard "… gespeichert, noch nicht am Gerät" (`control.saved`, `useSaved`), and what else the save did
  follows after " · ": "· Plan pausiert", "· Plan läuft wieder", "· Regelung an". **A state switched is said as
  the state** (the redesign session of 2026-11-14; `useSaved().say(…, state)`): "Regelung aus", "Regelung an",
  "Trocknung beendet", "Keimung beendet", "Lüfter wird nicht mehr gedrosselt" - not "… gespeichert"; for a device
  not heard it stays "… gespeichert, noch nicht am Gerät". The offline suffix holds on the
  undo's answer too. An undo that fails says "Das ließ sich nicht widerrufen"; an entry's
  delete that fails has its own sentence.
- **One word for one state, wherever it stands** (the third whole-app walk): regulation on is "Regelung an" - the
  pill, a toast, the plan - never "Regelung ein"; a firmware channel is capitalised, "Stabil", "Beta", "Alpha"
  ("Nicht auf Stabil", English "Stable"); admin names a device class by its type in words. A camera's silence is
  "Terp Cam ohne Bild" in the diary and on Start as in Meldungen. A window ended within its first minute is
  "Wartung beendet" or "Regelung aus und wieder an", never "· 0 s". The removal page names a place one way in both
  selects ("nach Zelt"; "Wohin kommen die Pflanzen?"); the grow's move speaks of its time at a place ending and a
  new one beginning, never of a place that ends. A share link's card says how long it lasts once, by its end
  date. A placeholder is an example that trails off ("Zeltkamera, Seitenkamera …"), never a word that reads as a
  value. Düngung names the water with its unit ("Leitungswasser · EC").
- English, from the same walk: what applies at a time "applies" or is "in effect now" - a device "holds" its
  targets, figures do not "hold"; whoever may change a place "manages" it, as the role "can manage" says, and
  nobody "steers"; a grow or a device "is in" a place; a setting made while a device is offline "reaches the
  device" later; the rolling films are the daily, weekly and monthly film, one of one's own a custom film; a
  report counts waterings and feedings; the plan's questions are "plan questions".
- Superseded names: "Pflegemodus" (Chris, 2025-11-07, the old app) and the rewrite's "Reingehen" / "Alarme aus"
  became "Wartung" (2026-10-04); "Bereich" (2026-09-23) became "Ort" (Chris, 2026-10-01), and English "space" became
  "place" (2026-10-04).

## Grow time
- **One day count: the calendar's** (the redesign session of 2026-11-12, told to Chris and not yet confirmed by
  him; it replaces the count of 24 hours from the hour the grow began, which filed a morning's watering under
  yesterday and had the head of the grow page one behind its own diary). A grow's day is a date on its owner's
  calendar everywhere - the head, Start, Verlauf, the report, the day cards, the entry sheet, the exports: day 1 is
  the date the grow began on, and every midnight there adds one. Counted, never stored (`growDayAt` in
  `shared-types/src/v1/feeding.ts`, in dates because a day of the calendar is 23 or 25 hours long twice a year; the
  server knows the owner's zone, and tells a member's app in `summary.zone`). A stretch ends on the day of its last
  instant (`growDayUpTo`): a window that closes at midnight has not begun the next date. A grow's progress reads
  "Tag 29", a finished one "126 Tage · beendet 14. Aug 2026".
- **The diary is told in those dates** (Chris, 2026-11-11, with the day cards): a card is called "Heute",
  "Gestern", the weekday while it names one day ("Montag"), then the date, each with its number - "Heute ·
  Tag 29". A diary that has ended, and one read from outside past its window, has no today: its cards are dates.
  A line of a card carries its hour and no day. Weeks of the diary are seven of those dates: "Tag 22 bis 26 ·
  Blüte, Woche 2".
- **A stage is counted in weeks from its own start** (Chris, 2026-11-13): days 1 to 7 of the stage are "Blüte,
  Woche 1", day 8 begins week 2 - the server counts it (`stageWeek`, from `stageWeekOf` in
  `shared-types/src/v1/grow-days.ts`) and no client counts it again; it replaced counting the grow's weeks the
  stage had touched, which said "Woche 3" on a stage's 13th day. A week of the diary stays seven days of the grow,
  named by its days; the week as a whole (Bilder, its film) carries the stage at its middle, today's for the week
  still running. **A row of folded days carries the stage most of its days lay in**, with that stage's week at
  their middle, read from each day's own stage (the redesign session of 2026-11-14, after "Tag 11 bis 8 · Veg,
  Woche 1" for days that were Sämling; `GrowDiaryDay.phase`, `stageOfDays` in `screens/grow/diary/days.ts`). A
  feeding scheme's own week is always "Schema-Woche".
- What a device or the plan did without a person is marked "von allein" (English "automatic" as a tag; "by
  itself" read translated there and stays only inside a sentence - the redesign session of 2026-11-13) - not what somebody
  switched, such as maintenance ("Wartung · 2 Min"), nor a line a device wrote of somebody's doing: maintenance
  started at the device or in the app, a restart from the app (`DONE_BY_SOMEBODY`, `screens/grow/diary/days.ts`;
  the redesign session of 2026-11-14) -, in a diary line, as the author of an entry a plan or a
  preset wrote and as the tag on a phase they set in the grow's head: "auto" was a second word for it and reads
  as autoflower (the redesign session of 2026-11-12); a share of a day inside its targets reads "96 % der Zeit im
  Ziel". An alarm is named by its rule, and the edge it crossed is said in words - "Luftfeuchte über 60 %",
  "unter 20 °C" (`i18n/alarm-line.ts`): "›" only ever means that something opens. **A rule has one name in the
  reader's language wherever it is named** (the redesign session of 2026-11-12, after its critic read "Too hot"
  on a German Start beside "Zu warm" under Alarme): the four rules a stage applies - Zu warm, Zu kalt, Zu
  feucht, CO₂ zu hoch - and the cloud's "Gerät offline" are named by one function (`ruleTitle`,
  `i18n/alarm-line.ts`) on Steuerung › Alarme, Meldungen, in Start's sentence, "Zuletzt" and a line of the
  diary. The server stores them under English names and composes its lines with them
  ([server-engines.md](server-engines.md)); nothing stored is changed - a stored name is read as the rule it
  names, so a rule somebody called exactly "Too hot" reads as the stage's wherever only its line is in hand. A
  rule a person or the firmware named keeps its name.
- Films: Tagesfilm, Wochenfilm, Film der Phase, Film des Grows, Eigener Film. A picture's caption has one form,
  "Bild von 18:17" (`start.picture.takenAt`), with what makes it not the newest in front: "Licht aus · Bild von
  18:17", "letztes Bild von 18:17".
- Open alerts behind a status that is not an alert's own sentence are said in words, "3 Meldungen offen"; "+2" is
  only for the rest behind an alert's own sentence. A device running a mode its grow's phase does not is said as
  that: "Das Gerät trocknet, der Grow ist in der Phase Blüte". A start with a climate is "Starten · Klima:
  Sämling · mit Licht".

## Numbers, dates and units
- Figures follow the app's language (`ui/figures.ts`): decimal comma in German ("26,0 °C", "1,5 L"), no thousands
  grouping (one language's separator is the other's decimal point), each metric at its own decimals, rounded before
  writing - never "-0", "NaN" or "1.8599999"; "—" where there is no value. i18next interpolates with a point, so a
  figure is formatted before it goes into a string.
- One date shape per language, decided only in `ui/zone.ts`: "19. Sep 2026" in German, "19 Sep 2026" in English, never
  the US "Oct 23, 2026". Times and day boundaries are in the account's zone (Ich › Konto).
- German units: T for days, Std, Min, and Uhr after a time of day ("06–24 Uhr"); English d, h, min. Spans the server
  writes ("5 d 10 h") are rewritten into the reader's units. The symbol stands beside a figure in a tile or a pill;
  **in a line of words the day is written out** - "Tag 23" in front of a line of the report, "vor 1 Tag" under a
  measurement (`spokenAgo`, `ui/age.ts`) - because "T 23" and "vor 1 T" ask to be worked out (the redesign session
  of 2026-11-12). An age under ten seconds is "gerade eben" (`isJustNow`, `ui/age.ts`): the admin screens say
  "Stand: gerade eben" and "Zahlen von gerade eben", never "vor 0 s".
- **A litre is "L" in both languages**, alone and in a dose ("1,5 L", "2 ml/L", "0,4 g/L"; the redesign session of
  2026-11-13, after the whole-app walk read "4 l" as "4 I" in Albert Sans, whose small "l" is a capital "I" and a
  text cursor to the eye). The catalogues write it so; a scheme's own unit stays stored as published (`ml/l`) and is
  drawn through `unitShown` (`ui/figures.ts`). The Messen keypad, the Düngen sheet's doses and the Bericht's
  weights go through the one number format too.
- A span of days runs forwards everywhere: "Tag 1 bis 18" / "Day 1 to 18", as "Tag 19 bis heute" is.
- A refusal names the field and says what it takes: "pH: Das ist keine Zahl.", "Mehr als 0 L.", "Höchstens
  100 L." (`MAX_LITRES`, [app-ux.md §2](app-ux.md#2-navigation-and-the-place-page)), "Ein Gewicht ist
  0 g oder mehr.", "Eine Dosis ist 0 oder mehr. Die Zelle bleibt, wie sie war.", "Pflanzen: eine ganze Zahl ab 1.";
  a disabled Save says "Zum Speichern fehlt noch …". A reminder to water or feed is called by its kind ("Gießen")
  until it is named. **A figure out of its range names the range** (the redesign session of 2026-11-13, after the
  third critic saw 99 written as 35,0 °C): "Temperatur am Tag: Das geht nur zwischen 15 und 35 °C." under a
  target's field (`rangeRefusal`, `screens/control/climate/range.ts`), "Schritt 1 – Tag · Temperatur: zwischen 15
  und 35 °C, oder leer lassen." in the plan editor, "Ein anderes Gerät an diesem Ort heißt schon „…“." for a
  device's name, and a stream address that is none says what one looks like (rtsp://192.168.1.40:554/stream1) -
  "rtsp://" without a host is "Das ist noch keine Stream-Adresse: Es fehlt die Kamera, etwa
  rtsp://192.168.1.40:554/stream1.", and "Trag zuerst die Stream-Adresse ein." is said of an empty field alone.
- **No figure stands on a line without what it counts** (the redesign session of 2026-11-12): a figure is bound to
  its unit (`unbroken`, `ui/fact-text.ts`), and a sentence made of facts with "·" between them is set as those
  facts (`Facts`, `factsOf`), so it breaks between two of them and "3 l" or "1 Bild" stays whole - a toast, the
  line under a field, a chapter of the report, the count of a line's pictures.
- Not localised: CSV cells, ids, ISO instants, the `yyyy-MM-dd` of a date field, firmware versions.
- **No unit choice** (Chris, 2026-11-13): the views write °C, grams and litres, so Ich › Darstellung offers no
  °F, oz or gal; the preference stays stored with the account, and nothing reads or writes it until the views
  convert.
- **"Erledigt" is the tasks' word** - the tick of a task and the group of ticked ones. An alert that is over is
  "Vorbei" (English "Resolved"), never "Erledigt"; the way to the notification settings is "Benachrichtigungen
  einstellen" wherever it is offered; English "Log" is the verb for "Eintragen" (the redesign session of
  2026-11-13, after its critic's walk).

## Typography
One set in both catalogues (the redesign session of 2026-11-13; the `timeline.*` keys were left for the page's
own last pass): a dash in a sentence is a spaced en dash (" – "), never a hyphen or an em dash; "—" alone is a
missing value. An ellipsis is one character with a space before it ("Speichert …", "Saving …"; a placeholder
that trails off keeps it tight). Quotes are „…“ in German and “…” in English, the apostrophe is ’. CO₂ carries
its subscript. No arrows: a range is "bis" / "to" or an en dash between two dates, a change is said in words
("zeigt dann Tag 14 statt Tag 12"). English spells as in Britain (litres, mould, colour).

## German slips to check for
From the redesign review (2026-08-24), the ones a native reader notices first: wrong plurals ("1 Einträge" - use the
`_one`/`_other` forms), a decimal point beside a decimal comma, "gerade jetzt" where German says "gerade eben", "Maß"
(a litre of beer) where "Messwert" is meant.
