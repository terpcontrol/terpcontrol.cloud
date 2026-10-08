---
summary: How the app speaks - du-form and plain words, one name per thing in English and German, grow days and weeks, numbers, dates and units; read before writing or changing a string in the i18n catalogues
updated: 2026-10-08
source: Chris (naming decisions 2025-11 to 2026-10-04); app sessions and redesign review 2026-08-24 to 2026-10-04; checked against webapp/public/assets/i18n on 2026-10-08
paths:
  - webapp/public/assets/i18n/**
  - webapp/src/ui/figures.ts
  - webapp/src/ui/zone.ts
  - webapp/src/screens/devices/naming.ts
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
- Diary lines read "Du hast gegossen" / "<Name> hat gegossen"; one's own words stand without a name.
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
| the automatic schedule | plan | Plan, never Rezept; old message keys stay and read the new way |
| the lamp's ceiling | light limit | Lichtgrenze |
| maintenance | Maintenance · 15 min | Wartung · 15 Min ("Regelung und Alarme pausieren") |
| the built-in offline rule | Device offline | Gerät offline |
| a fridge's fans | clip fan, internal fan, back-wall fan | Klemmlüfter, Innenlüfter, Rückwandlüfter |
| a fridge's dehumidifier output | compressor | Kompressor (a tent's dehumidifier keeps its name) |
| the valve, apart from the reading | CO₂ valve | CO₂-Ventil |
| what the valve's dosing counter counts | ticks | Takte, never Öffnungen |
| the brand | Terp Control, Terp Cam | Terp Control, Terp Cam |

- The brand is two words in every user-visible text (Chris, 2026-06-25). Factual references to the original product
  (where the app came from, the privacy text) keep its name.
- "Abluft", "Umluft" and "Lüfter" are only roles a smart socket is given (an AIR is the Lüfter); the fan and plug
  device types are "Lüfter" and "Steckdose" everywhere.
- The CO₂ dosing counter is in "Takte": the firmware adds up how long the valve was open, in ticks of its clock
  ([device-protocol.md 5.4](../device-protocol.md#54-which-keys-each-hardware-type-reports)), and counts no openings;
  `help.chartOutputs` says so beside the chart. The CO₂ report card (`co2Report.*`) does not follow this yet.
- A share link's actions are "Ändern" (a change may widen a link as well as narrow it), "Zurückziehen", and "Löschen"
  only once it is revoked or expired - the server refuses to delete a working one (409 `share_link_live`).
- Shared texts say "das Gerät", not "der Controller". A device is called by its type alone unless the account has two
  of a kind, then with its id tail (`screens/devices/naming.ts`). A new place gets a name a person would write,
  numbered past the existing ones ("Zelt 2", "Kühlschrank 1", "Ort 1"), never the raw type key.
- "Keimung · dunkel" and "Sämling · mit Licht" name the stage only where choosing it sets the climate (see
  [app-ux.md §5](app-ux.md#5-controls)).
- Superseded names: "Pflegemodus" (Chris, 2025-11-07, the old app) and the rewrite's "Reingehen" / "Alarme aus"
  became "Wartung" (2026-10-04); "Bereich" (2026-09-23) became "Ort" (Chris, 2026-10-01), and English "space" became
  "place" (2026-10-04).

## Grow time
- A grow's progress is its day, counted in 24 h from its start: "Tag 29", a finished grow "bis Tag 126". Day tiles
  and diary stamps name grow days ("T 29 · 13:36"), never weekdays, because a grow day straddles two dates.
- The stage is counted in weeks ("Veg · Woche 2 · seit 9 Tagen"); a week card by its days ("Tag 15–21"), badged with
  the stage most of it lay in; a feeding scheme's own week is always "Schema-Woche".
- Films: Tagesfilm, Wochenfilm, Film der Phase, Film des Grows, Eigener Film.

## Numbers, dates and units
- Figures follow the app's language (`ui/figures.ts`): decimal comma in German ("26,0 °C", "1,5 l"), no thousands
  grouping (one language's separator is the other's decimal point), each metric at its own decimals, rounded before
  writing - never "-0", "NaN" or "1.8599999"; "—" where there is no value. i18next interpolates with a point, so a
  figure is formatted before it goes into a string.
- One date shape per language, decided only in `ui/zone.ts`: "19. Sep 2026" in German, "19 Sep 2026" in English, never
  the US "Oct 23, 2026". Times and day boundaries are in the account's zone (Ich › Darstellung).
- German units: T for days, Std, Min, and Uhr after a time of day ("06–24 Uhr"); English d, h, min. Spans the server
  writes ("5 d 10 h") are rewritten into the reader's units.
- Not localised: CSV cells, ids, ISO instants, the `yyyy-MM-dd` of a date field, firmware versions.
- Unit preferences (°F, oz, gal) are stored with the account but not applied yet; Ich › Darstellung says so.

## German slips to check for
From the redesign review (2026-08-24), the ones a native reader notices first: wrong plurals ("1 Einträge" - use the
`_one`/`_other` forms), a decimal point beside a decimal comma, "gerade jetzt" where German says "gerade eben", "Maß"
(a litre of beer) where "Messwert" is meant.
