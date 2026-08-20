# Einfach-Modus vs. Expertenmodus

Die Geräteeinstellungen (`Gerät → Einstellungen`) haben für Kühlschrank- und
Controller-Geräte zwei Reiter. Dieses Dokument hält fest, **was in welchem Modus
liegt und warum** — damit die Aufteilung nachvollziehbar bleibt, wenn neue
Einstellungen dazukommen.

Leitsatz: Der Einfach-Modus ist die **vollständige Alltagsbedienung** für
Einsteiger. Alles, was man im Laufe eines Grows regelmäßig braucht, muss dort
erreichbar sein. Der Expertenmodus ergänzt Hardware-Tuning und
Einmal-Einrichtung.

## Gegenüberstellung

| Funktion | Einfach | Experte | Begründung |
| --- | --- | --- | --- |
| Grow-Phase wählen (6 Vorlagen) | ✅ | ⚪ (indirekt über Werte) | Kern des Einsteigereinstiegs |
| **Aus** (Regelung beenden) | ✅ | ✅ (`Arbeitsmodus`) | Ein- *und* Ausschalten gehören zusammen |
| „Eigene Werte" als Zustand | ✅ (Anzeige) | ✅ | Zeigt, dass die Werte keiner Vorlage entsprechen |
| Licht an / Stunden Licht | ✅ | ✅ (`Tagesanbruch`/`Nachtanbruch`) | Täglicher Bedarf |
| Lichtintensität | ✅ | ✅ | Wird pro Phase angepasst |
| Zielwerte Tag/Nacht (Temp., rF) | ✅ | ✅ | Kernbedienung |
| VPD-Vorschau | ✅ (Hinweistext) | ✅ (eigene Felder) | Verständnishilfe, kein Eingabefeld |
| CO₂-Ziel | ✅ (nur mit CO₂-Sensor) | ✅ | Einsteiger mit CO₂-Anlage brauchen es |
| Grow-Plan: Fortschritt, Phase überspringen, Plan stoppen, Dauer ändern | ✅ | ✅ (Rezept-Editor) | Laufende Bedienung |
| Grow-Plan starten (Assistent) | ✅ | ✅ | Einstieg in den automatischen Ablauf |
| **Pflegemodus** („kurz ins Zelt") | ✅ | ⚪ (nur Gerätekachel) | Typischer Alltagsfall: gießen, umtopfen |
| Alarme aus Vorlagen | ✅ (`simple-alarms-card`) | ✅ (voller Alarm-Editor) | Einsteiger wollen „Hitze melden", keine Schwellenmatrix |
| Gerät löschen | ✅ | ✅ | Gemeinsame Aktion |
| Webcam-Konfiguration (RTSP-URL, Tunnel, Fehler-Log) | ❌ | ✅ | Einmalige Einrichtung mit technischer URL |
| Smart Sockets (Rollen, Firmware-Hinweis) | ❌ | ✅ | Hardware-Pairing, nicht Alltagsbedienung |
| Arbeitsmodus roh (`exp`, `full`, `small`, `temp`, `dry`, `breed`, `off`) | ❌ | ✅ | Vorlagen setzen den passenden Modus |
| Heizverhalten (Hysterese, Min-An/Aus-Zeit, Assist-Vorlauf) | ❌ | ✅ | Hardware-Tuning |
| Entfeuchter-Timing (`maxDehumidifySeconds`, Mindest-Aus-Zeit) | ❌ | ✅ | Hardware-Tuning |
| Lüfter innen/außen | ❌ | ✅ | Hardware-Tuning |
| Sonnenauf-/-untergang (Dimmrampen) | ❌ | ✅ | Feinschliff, selten geändert |
| Schwebender Tag (`floating day`) | ❌ (nur Hinweis) | ✅ | Spezialfall Autoflower-Experimente |
| Licht AN im Pflegemodus | ❌ | ✅ | Einmalige Präferenz |
| Firmware-Kanal, Beta-Funktionen | ❌ | ✅ | Wartung, kein Grow-Thema |
| VPD-Blatttemperatur-Offsets, PPFD-Lux-Faktor | ❌ | ✅ | Kalibrierung |
| Rezept-Vorlagen laden/speichern | ❌ | ✅ | Power-User-Workflow |

⚪ = vorhanden, aber unter anderem Namen bzw. an anderer Stelle.

## Zustandslogik

Alle Gerätezustände und ihre Darstellung im Einfach-Modus:

| Zustand | Anzeige | Weg hinein | Weg hinaus |
| --- | --- | --- | --- |
| **Aus** (`workmode: off`) | Kachel „Aus" markiert, Zielwerte-Karte zeigt den Aus-Hinweis, keine Phasenkachel grün | Kachel „Aus" (mit Rückfrage) | Phasenkachel wählen |
| **An, manuell** | Passende Phasenkachel oder „Eigene Werte" markiert, Zielwerte editierbar | Phasenkachel wählen | Kachel „Aus" |
| **An, Grow-Plan läuft** | Plan-Karte mit Phase, Tag X von Y, Fortschritt, kommende Phasen | „Grow-Plan starten" | „Plan stoppen" (weiter manuell) oder „Gerät ausschalten" (Plan endet *und* Regelung aus) |
| **Wartet auf Bestätigung** | Warnhinweis + Bestätigen-Button in der Plan-Karte | automatisch am Phasenende | Bestätigen, Phase beenden, Plan stoppen |
| **Pflegemodus** | Über „Pflegemodus starten" erreichbar; die Gerätekachel zeigt die Restzeit | Dauer wählen | „Beenden" im selben Dialog, oder Ablauf der Zeit |
| **Offline** | Gerätekachel überlagert mit „Gerät offline" + Zeitpunkt des letzten Kontakts; Einstellungen bleiben editierbar und werden beim nächsten Verbinden übernommen | — | Gerät wieder verbinden |

Aus jedem Zustand führt ein Weg zurück, ohne den Expertenmodus zu betreten.

## Offene Fragen aus der Prüfung

**Wo landet man nach dem Speichern?** `saveSettings()` navigiert zurück auf
`/list` (Geräteliste). Die Reiter-Auswahl bleibt erhalten: sie liegt in
`localStorage` unter `EXPERT_MODE_STORAGE_KEY` und wird beim nächsten Öffnen der
Einstellungen wiederhergestellt.

**Werte ohne passende Vorlage?** `detectActiveStagePreset()` vergleicht
Arbeitsmodus, Tag-/Nacht-Temperatur, Tag-/Nacht-Luftfeuchte, Lichtlimit und
Photoperiode gegen jede Vorlage (mit Toleranz). Passt nichts, wird „Eigene
Werte" markiert; ist der Arbeitsmodus `off`, wird „Aus" markiert. CO₂ und
Dimmrampen gehen bewusst nicht in den Vergleich ein, weil die Firmware sie nicht
zuverlässig zurückmeldet.

**Ist der Einfach-Modus Voreinstellung?** Ja. `uiMode` ist `simple`, solange
`localStorage` nicht ausdrücklich `expert` gespeichert hat — also für jedes neue
Gerät und jeden neuen Browser.

## Vorlagenwerte

Die Zielwerte der Kacheln stehen in `webapp/src/app/util/grow-presets.ts`. Sie
sind an die üblichen Empfehlungen für Cannabis-Indoor-Grows angelehnt und bewusst
konservativ gewählt — sie sollen für Einsteiger sicher sein, nicht maximal
ertragreich.

| Phase | Tag/Nacht °C | Tag/Nacht % rF | Licht | Dimmung | VPD-Ziel | Begründung |
| --- | --- | --- | --- | --- | --- | --- |
| Keimung & Sämling | 24 / 21 | 70 / 65 | 18 h | 40 % | 0,4–0,8 kPa | Wurzeln sind klein, hohe Luftfeuchte und wenig Licht verhindern Austrocknen |
| Wachstum | 26 / 22 | 62 / 58 | 18 h | 80 % | 0,8–1,1 kPa | Maximale Photosynthese bei noch feuchtem Klima |
| Frühe Blüte | 25 / 20 | 50 / 50 | 12 h | 100 % | 1,2–1,5 kPa | 12/12 löst die Blüte aus, trockener zur Schimmelvorbeugung |
| Späte Blüte | 24 / 18 | 45 / 45 | 12 h | 100 % | 1,3–1,6 kPa | Kühlere Nächte fördern Farbe/Terpene, niedrige rF schützt dichte Blüten |
| Trocknung | 18 / 18 | 58 / 58 | — | — | 0,9–1,3 kPa | Beworbenes Trocknungsfenster (16–20 °C / 55–60 % rF), Licht aus |

CO₂: mit erkannter CO₂-Hardware 400/900/1000/400/400 ppm je Phase, ohne Hardware
durchgehend 400 ppm (Umgebungsniveau), damit nie ein Ventil öffnet.

Beim Wechsel einer Vorlage werden nur Felder geschrieben, die die Firmware
zurückspiegelt. Hardware-Tuning (Heizverhalten, Lüfter, Entfeuchter-Timing)
bleibt bewusst unangetastet und übersteht Phasenwechsel.

## Bekannte Datenthemen (kein Code)

- Das Demo-Gerät heißt in der Datenbank noch „Plantalytix Fridgegrow 2.0" und ist
  seit dem 02.07.2026 offline. Beides ist Bestand der Demo-Datenbank, kein
  Code-Verhalten: Die Kopfzeile zeigt den gespeicherten Gerätenamen. Für ein
  ansprechendes Demo sollte das Gerät umbenannt werden und regelmäßig Messwerte
  liefern.
