---
summary: How the app speaks - du-form and plain words, one name per thing in English and German, grow days and weeks, numbers, dates and units; read before writing or changing a string in the i18n catalogues
updated: 2026-11-12
source: Chris (naming decisions 2025-11 to 2026-10-12; the diary's day cards 2026-11-11); app sessions and redesign review 2026-08-24 to 2026-10-04; codebase cleanup (2026-10-08); checked against webapp/public/assets/i18n on 2026-10-08; online, Klima-Preset against Vorlage and the English of Steuerung (the redesign session of 2026-11-12, after its critic's walk)
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
- Diary lines read "Du hast gegossen" / "<Name> hat gegossen"; one's own words stand without a name. A watering says
  how much, a feed also the week of the scheme it was dosed by: "Du hast gegossen · 1,5 l", "Du hast gedüngt · 5 l ·
  Schema-Woche 5" (`amountOf`, `ui/entries.ts`).
- A machine line says only what is known: the firmware's update line is "Update angefordert" - the device was told;
  whether it took is a line of its own ("Firmware-Update abgeschlossen", "Update kam nicht an").
- Thresholds are written in words ("über 28 °C"), not with arrows or "›", since every link ends in one; metric names
  are written out (Temperatur, Luftfeuchte; not Temp, rF).

## One word per thing

| Thing | English | German |
| --- | --- | --- |
| where a grow or device stands | place | Ort ("Raum" only for a real room; never Bereich) |
| the account | account | Konto, also in sign-in and activation |
| the charts screen | Charts | Graph / Graphen, not Chart or Diagramm |
| what a device holds | targets | Zielwerte, not Sollwerte |
| a stage's climate in one tap; a saved plan | climate preset; template | Klima-Preset; Vorlage |
| a place, a device or a camera that reports | online | online (never "live"; "verbunden" only in "Verbunden über") |
| the automatic schedule | plan | Plan, never Rezept; old message keys stay and read the new way |
| the lamp's ceiling | light limit | Lichtgrenze |
| maintenance | Maintenance · 15 min | Wartung · 15 Min ("Regelung und Alarme pausieren") |
| the built-in offline rule | Device offline | Gerät offline |
| a fridge's fans | clip fan, internal fan, back-wall fan | Klemmlüfter, Innenlüfter, Rückwandlüfter |
| a fridge's dehumidifier output | compressor | Kompressor (a tent's dehumidifier keeps its name) |
| the valve, apart from the reading | CO₂ valve | CO₂-Ventil |
| what the valve's dosing counter counts | ticks | Takte, never Öffnungen |
| a Tasmota plug a controller or fridge switches | smart socket | smarte Steckdose, short Steckdose; never Smart-Steckdose |
| the stand-alone device type `plug` | Plantalytix Socket | der Plantalytix Socket |
| the brand | Terp Control, Terp Cam | Terp Control, Terp Cam |

- The brand is two words in every user-visible text (Chris, 2026-06-25). Factual references to the original product
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
  `help.chartOutputs` says so beside the chart. The CO₂ report card (`co2Report.*`) does not follow this yet.
- A share link's actions are "Ändern" (a change may widen a link as well as narrow it), "Zurückziehen", and "Löschen"
  only once it is revoked or expired - the server refuses to delete a working one (409 `share_link_live`).
- Shared texts say "das Gerät", not "der Controller". A device is called by its type alone unless the account has two
  of a kind, then with its id tail (`ui/naming.ts`). A new place gets a name a person would write, numbered past the
  existing ones ("Zelt 2", "Kühlschrank 1", "Ort 1"), never the raw type key.
- "Keimung · dunkel" and "Sämling · mit Licht" name the stage only where choosing it sets the climate (see
  [app-ux.md §5](app-ux.md#5-controls)).
- **What reports is "online"** (the redesign session of 2026-11-12): on the pill ("online · vor 20 s"), a
  device's card and a camera's row. A device's page says it on the pill and nowhere else. "live" is said of
  none of them, and "verbunden" only of how a camera or a socket is reached ("Verbunden über").
- **A stage's climate is never a "Vorlage"** (the redesign session of 2026-11-12): the button over the targets,
  its sheet, the group the alarm rules a stage wrote stand under ("Aus dem Klima-Preset Blüte") and their tag
  say "Klima-Preset". "Vorlage" is a saved plan - and a ready-made measurement on a grow's Messwerte page -, and
  the ready-made form of a webhook is "Dienst für den Webhook" (`alarms.sheet.template`, `help.webhookTemplate`).
- English: the page is "Control" and so is the regulation (`climateControl.*`), so Steuerung's pill reads
  "Regulating" / "Not regulating" rather than "Control · Control on". An output held by hand is "held on", never
  "forced on" (`devices.socket.forced`). A device's page says "in {{place}}", and its sheet's block is "Place".
- A place with nothing to steer and an account with no place read one sentence at Steuerung's address: "Hier gibt
  es noch nichts zu steuern: Zielwerte und Alarme kommen mit dem ersten Gerät." (`place.control.nothing`).
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
  A line of a card carries its hour and no day. Weeks of the diary are seven of those dates: "Tag 26 bis 22 ·
  Blüte, Woche 2".
- The stage is counted in weeks ("Blüte, Woche 3") as the server counts them (`stageWeek`, from `stageWeekOf` in
  `shared-types/src/v1/grow-days.ts`); a phase's own days divided by seven give another week. A week of the diary is
  named by its days and carries the stage most of it lay in; a feeding scheme's own week is always "Schema-Woche".
- What a device or the plan did without a person is marked "von allein" (English "by itself") - not what somebody
  switched, such as maintenance ("Wartung · 2 Min"); a share of a day inside its targets reads "96 % der Zeit im
  Ziel". An alarm is named by its rule, and the edge it crossed is said in words - "Luftfeuchte über 60 %",
  "unter 20 °C" (`i18n/alarm-line.ts`): "›" only ever means that something opens.
- Films: Tagesfilm, Wochenfilm, Film der Phase, Film des Grows, Eigener Film.

## Numbers, dates and units
- Figures follow the app's language (`ui/figures.ts`): decimal comma in German ("26,0 °C", "1,5 l"), no thousands
  grouping (one language's separator is the other's decimal point), each metric at its own decimals, rounded before
  writing - never "-0", "NaN" or "1.8599999"; "—" where there is no value. i18next interpolates with a point, so a
  figure is formatted before it goes into a string.
- One date shape per language, decided only in `ui/zone.ts`: "19. Sep 2026" in German, "19 Sep 2026" in English, never
  the US "Oct 23, 2026". Times and day boundaries are in the account's zone (Ich › Darstellung).
- German units: T for days, Std, Min, and Uhr after a time of day ("06–24 Uhr"); English d, h, min. Spans the server
  writes ("5 d 10 h") are rewritten into the reader's units. The symbol stands beside a figure in a tile or a pill;
  **in a line of words the day is written out** - "Tag 23" in front of a line of the report, "vor 1 Tag" under a
  measurement (`spokenAgo`, `ui/age.ts`) - because "T 23" and "vor 1 T" ask to be worked out (the redesign session
  of 2026-11-12).
- **No figure stands on a line without what it counts** (the redesign session of 2026-11-12): a figure is bound to
  its unit (`unbroken`, `ui/fact-text.ts`), and a sentence made of facts with "·" between them is set as those
  facts (`Facts`, `factsOf`), so it breaks between two of them and "3 l" or "1 Bild" stays whole - a toast, the
  line under a field, a chapter of the report, the count of a line's pictures.
- Not localised: CSV cells, ids, ISO instants, the `yyyy-MM-dd` of a date field, firmware versions.
- Unit preferences (°F, oz, gal) are stored with the account but not applied yet; Ich › Darstellung says so.

## German slips to check for
From the redesign review (2026-08-24), the ones a native reader notices first: wrong plurals ("1 Einträge" - use the
`_one`/`_other` forms), a decimal point beside a decimal comma, "gerade jetzt" where German says "gerade eben", "Maß"
(a litre of beer) where "Messwert" is meant.
