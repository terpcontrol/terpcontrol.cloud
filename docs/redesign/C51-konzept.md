# C51 — "Der Unterschied"

**C14 × C36 × C11's slider.** One browser, one cursor, and every thing in it renders as a diff.

Verified in the repo: `webapp/src/app/util/ui-mode.ts` (the banned mode); `util/socket-info.ts:7` —
`SOCKET_ROLES = dehumidifier, heater, light, secondary_light, co2`, i.e. **no cooler, no fan, no
humidifier**; `server/src/models/images.model.ts:22` (`data: Buffer`); `services/image.service.ts:583`
(`libx265`), `:127` (`addOfflineOverlay`), `:16,501,566` (ffmpeg via `execFile`). No GridFS, no
`x-api-key`, no service worker anywhere in `server/src`.

---

## 1. Thesis

**Every thing is a *Ding* with one screen shape; that shape's body is always a Vorher/Jetzt pair with the
change named in one German sentence; and one slider — shared across every Ding you walk to — decides what
*Vorher* means.**

C36 gave the app one grammar: one thing, one screen, depth by walking a named relation. C14 gave it one
question: *was ist anders?* Together the app stops browsing objects and starts browsing **one comparison**.
Set „Vorher = Freitag 14:02" once, then walk: the tent says what changed since Freitag, plant A3 says what
changed since Freitag, the heater socket says what changed since Freitag, the Tag-Ziel says it was 24,0 °C
on Freitag and is 25,0 °C now, and Anna says what she did since Freitag. **The cursor does not reset when
you walk.** You are not opening screens; you are holding one question against different things.

Two disciplines, both load-bearing:

- **The picture describes, never diagnoses** (C14). „Der obere linke Bereich ist heller geworden."
  Never „Stickstoffmangel."
- **The numbers prescribe — but only where we own the mechanism** (§5.4, the fix for the 4,93/10). „Die
  Heizung lief 2 Std 40 ohne Pause und es blieb 1,4 °C zu kalt" is a deterministic statement about kit we
  switch, with one concrete next step and the id of the rule that produced it.

---

## 2. From C14, from C36, from C11's slider — and THE FUSION

**From C14:** the body is a **Vorher/Jetzt pair** with the change in one sentence, prose line and value line
in the same DOM node, each true without the other. The printed ranking `ⓘ nach Abweichung sortiert`, score
`|Δ| / max(σ₁₄, σ_floor)`, σ₁₄ at the same time of day ±1 h. The frame cull and `Bildmass` metrics; a change
map that says *where*, never *what*; the light/picture mismatch alarm neither source can raise alone. Every
human entry auto-attaches its nearest kept frame (`auto_bild`).

**From C36:** one route, one component, one screen shape — **Zeile** (48 px, four slots) when a Ding is
related, **Tafel** when it *is* the Subjekt, no third size. One gesture: tap a Zeile, it becomes the Subjekt.
`Werte {…}` at the bottom of every Tafel with the literal GET that produced it. Reveal by capability and by
data, never by preference. Corrections, not edits (`storniert_von`). Most arts projected read-time.

**From C11's slider:** a scrub bar under the body, right edge `Jetzt`. **One cursor, several projections**,
correlation both ways — drag the handle and the pair, the `Verlauf` list and the chart all move; drag the
chart's crosshair and the handle moves; tap a thumbnail and the handle jumps. **Pause is the disclosure
gesture:** motion gives a two-line **pinned scrub header** (not a tooltip — there is no hover on touch);
release unfolds the moment — gemessen vs Ziel vs Delta, which sockets ran, which Dinge fell within ±2 h, and
the frame's own exposure and sharpness verdict. Nothing persisted, self-cancelling, hides no feature class.

### The four ideas that exist only because all three were combined

**F1 · The cursor is a property of the session, not of the screen.** C14 has one comparison and a per-screen
endpoint picker; C36 has many screens and no comparison. Fuse them and `Vorher` becomes global state that
survives every walk. *That is the concept.* Remove C36 and there is one screen for the cursor to survive
on. Remove C14 and there is nothing for it to feed. Remove the slider and the endpoint reverts to a
dropdown per screen — reintroducing exactly the per-screen configuration C36 exists to abolish.

**F2 · The diff is what stops uniformity from flattening importance.** C36's own weakness #2: „`◼ Heizung
aus` and `▲ Feuchte 40 Min über 65 %` are the same 48 pixels." When every body is a diff, a Ding that did
not change says `unverändert seit Freitag` in one grey line and a Ding that did gets a sentence. Ranking
falls out of the comparison instead of being bolted on.

**F3 · `Nächster Unterschied ›` generalises, and only C36 lets it.** C11's button was `Nächster Moment über
30 °C →` on one series. Because every Ding has the same shape, one button means one thing everywhere: *jump
the cursor to the next moment at which this Ding changed by more than its own noise floor.* On the Zelt,
the next Befund-worthy minute; on a `dose`, the next switch; on a `ziel`, the next time somebody moved the
target; on a `mensch`, the next thing Anna did. One control, thirteen meanings, no configuration.

**F4 · The `ziel` Ding forces setpoint history into existence, and fixes the chart as a side effect.** A
target is a Ding → it has a body → its body is a diff → „Tag-Ziel 24,0 → 25,0 °C, von Ben, gestern 19:04"
must be answerable → `ZielStand` rows must exist. That kills the standing bug where every chart draws
today's target over last month's data. Nobody set out to fix the chart; the fusion made it unavoidable.

---

## 3. Information architecture

### 3.1 The tent above the device

```ts
interface Zelt { zelt_id, besitzer_id, name,           // "Zelt Keller"
                 geraete: string[],                    // device_ids. 1 is the normal case.
                 zeitzone,                             // every day boundary computed in it
                 tag_null: number,                     // day counter: first `phase`, else claim time
                 kamera_leitgeraet?, erstellt_at }
```

Migration is silent: on boot every claimed device without a Zelt gets one containing exactly itself, named
from the device name. Adding a second is one Zeile: `+ Gerät hinzufügen`. **Two devices reporting the same
measure are never averaged** — the Zelt shows `Temperatur (Controller)` and `Temperatur (Steckdose Balkon)`
as separate rows, and the rule is stated on `Werte`.

### 3.2 Routes

| Route | What |
| --- | --- |
| `/list` | Your Zelte. Exactly one → straight through, as today. |
| `/z/:zelt_id/:ding_id?` | **The browser.** One component. `ding_id` absent ⇒ the Zelt is the Subjekt. |
| `/z/:zelt_id/chart` | The chart — the only non-Ding screen, and a projection of the same cursor. |

Kept, because share links and chart presets are persisted user data: `/device/:id/diary` → 301 `/z/<zelt>`;
`/device/:id/charts?<q>` → 301 `/z/<zelt>/chart?<q>` (query format unchanged, `applyViewParams` back-compat
branch intact); `/device/:id/settings` → 301 for controller and fridge only, **kept as-is for
fan/light/plug/dryer**. `ShareLink.page` stays `'charts' | 'diary'` — no enum change, no migration.
`/login /account /shares /demo /classes /diagnostics /testmode` untouched.

### 3.3 The one object

```ts
interface Ding {
  ding_id: string;        // uuid v4 — CLIENT-MINTED. server upserts on it.
  zelt_id: string; geraet_id?: string;
  art: DingArt; name: string;                   // "A3 · Wedding Cake", "Heizung (Dose 1)"
  t: number; t_ende?: number | null;            // explicit null = still open
  rel?: Record<string, string[]>;               // named German edges: { an, in, betrifft, von }
  d?: Record<string, unknown>;
  bilder?: string[]; auto_bild?: string;        // nearest KEPT frame ±5 min, server-filled
  akteur?: string; storniert_von?: string;
}
type DingArt = 'zelt'|'geraet'|'pflanze'|'dose'|'kamera'|'bild'|'film'
             |'gabe'|'notiz'|'zustand'|'phase'|'ziel'|'mensch'|'ereignis';
```

**Six arts are stored** (`pflanze`, `gabe`, `notiz`, `zustand`, `phase`, `mensch`); eight are projected
read-time: `zelt`←`Zelt`+Influx · `geraet`←`Device` · `dose`←`hardwareInfo.sockets` via the existing
`parseSocketRoles()` · `kamera`←`webcam_did`+newest `Image` · `bild`/`film`←`Image` · `ereignis`←`DeviceLog`
· `ziel`←`ZielStand`. One read API, consumed byte-for-byte by the webapp so they cannot drift:
`GET /api/dinge?zelt_id=&art=&von=&bis=&cursor=`, cursor-paginated by `t`, mandatory from day one.

### 3.4 Two collections the fusion forces into existence

```ts
interface ZielStand {                    // setpoint history — F4
  zelt_id, geraet_id;
  schluessel: string;                    // 'day.temperature' | 'daynight.day' | 'lights.limit' | …
  wert: number | string;
  gilt_ab: number; gilt_bis?: number;    // half-open; gilt_bis absent = in force
  gesetzt_von?: string;                  // ding_id of a `mensch`
  quelle: 'app' | 'geraet' | 'erstbefund';
}
interface Bildmass {                     // C14's FrameMetrics, ~200 B/frame
  image_id, zelt_id, t; ok: boolean;
  verworfen?: 'licht_aus'|'kurzzeitig'|'unscharf'|'doppelt'|'kamera_bewegt';
  phash; helligkeit; schaerfe; gruenanteil?;
  kacheln: number[];                     // 48 = 8×6 grid, mean abs diff vs last kept frame
  dx; dy; licht: 'an'|'aus'|'unklar';    // from out_light at t ± 60 s — the cross-modal join
}
```

`ZielStand` is written by a diff watcher on every `configuration` the server already receives. `erstbefund`
marks the first observation of a device whose history predates the feature, so the chart prints `Ziel
unbekannt vor 14.09.` instead of back-projecting today's number — the current lie.

### 3.5 The cursor

```ts
interface Vergleich { von: number; anker: 'zuletzt'|'gestern'|'woche'|'phase'|'gabe'|'beginn'|'ziel'|'frei'; }
```

`VergleichService`, a `BehaviorSubject`, mirrored to `sessionStorage['tc-vergleich-<zelt_id>']` so a reload
keeps your place. **Not `localStorage`.** A new session always starts at `zuletzt` (your previous visit,
from `localStorage['tc-zuletzt-<zelt_id>']` written on blur). A cursor that survived sessions would be a
stored preference, and a stored preference that changes what the whole app shows you is a mode.

---

## 4. The home screen — the Zelt Tafel

Phone, 390 px. de-DE as shipped; `en.json` gets mirror keys in the same commit.

```
┌──────────────────────────────────────────────────────┐
│ ←  Zelt Keller                                  ☰    │
│    ● Online · Werte von vor 40 Sek · Tag 34          │
├──────────────────────────────────────────────────────┤
│ ▌ CO₂-Flasche fast leer · Anna, vor 3 Tagen       ✓ │  „Offen" — absent when empty
│ ▌ A3 nicht gießen — zu nass · Ben, vor 1 Tag      ✓ │
├──────────────────────────────────────────────────────┤
│  ┌────────────────┐   ┌────────────────┐             │  168×126, 4:3
│  │     VORHER     │   │     JETZT      │             │
│  └────────────────┘   └────────────────┘             │
│   Fr 22.08. 14:02      Mo 25.08. 14:04               │
│   Tag 31               Tag 34             [ Δ ]      │
│                                                      │
│  Die Pflanzen sind gewachsen und nachts war es       │
│  wärmer.                                             │
│  Blattfläche 34 → 37 % · Nacht 21,2 → 23,4 °C        │
│  → Nacht-Ziel steht auf 21,0 °C und Abluft ist keine │
│    Dose. Was du tun kannst: Licht dimmen (jetzt      │
│    100 %).                              Regel N-3 ›  │
├──────────────────────────────────────────────────────┤
│  Vorher ├────●──────────────────────────────┤ Jetzt  │
│         ▁▃▂▅▁▁▇▃▂▂▄▅▃▁▁▂▆▃▂▂▁▃▄▂▁▃▅▂▁▁▃▂▄▅▃▂        │
│   Beginn  Phase  1 Wo  gestern  gestern Abend  jetzt │
│  Fr 22.08. 14:02 · Tag 31          Nächster ›        │
├──────────────────────────────────────────────────────┤
│  Der Unterschied                    ⓘ nach Abweichung│
│                     Fr 14:02  →  jetzt      Δ        │
│   Temperatur         24,1 °C     24,8 °C   +0,7  ◼   │
│      Ziel Tag        25,0 °C     25,0 °C     —       │
│   Nacht (Mittel)     21,2 °C     23,4 °C   +2,2  ▲   │
│      Ziel Nacht      21,0 °C     21,0 °C     —       │
│   Luftfeuchte          61 %        58 %     −3   ◼   │
│   VPD                1,12       1,29 kPa  +0,17  ◼   │
│   CO₂                 412        398 ppm    −14  ◼   │
│   Blattfläche          34 %        37 %     +3   ▲   │
│   Heizung/Tag     3 Std 55    4 Std 20   +25 Min ◼   │
│   Licht                100 %       100 %     —   ○   │
│   Entfeuchter/Tag  1 Std 10    1 Std 05   −5 Min ○   │
├──────────────────────────────────────────────────────┤
│  Im Zelt                                          +  │
│  ◼ A1 · Gorilla Glue        Blüte Tag 12   vor 2 Std │
│  ◼ A3 · Wedding Cake        Blüte Tag 12   vor 5 Tg  │
│  ◼ Heizung (Dose 1)         aus            vor 40 Sek│
│  ◼ Entfeuchter (Dose 2)     an · 12 Min    vor 40 Sek│
│  ◼ Licht (PWM)  100 % · ◼ Kamera läuft · ◼ Ziele 6   │
├──────────────────────────────────────────────────────┤
│  Verlauf                                             │
│  ◼ Gabe · 2,0 l · Bio-Bloom 2 ml/l                   │
│    an A1 A2 · von Anna                    vor 2 Std  │
│  ◼ Ziel Tag-Temperatur 24,0 → 25,0 °C · von Ben      │
│                                      gestern 19:04   │
│  ▲ Feuchte 40 Min über 65 %              Sa 03:12    │
│  ◼ Film · Blüte Woche 4 · 25 Sek         Sa 04:00    │
│  ───────────── Vorher · Fr 22.08. 14:02 ─────────────│
│  ◼ Gabe · 2,0 l · von Anna   Fr 12:05  ⋯ 340 weitere │  ← dimmed below the line
├──────────────────────────────────────────────────────┤
│  [ Gabe ] [ Notiz ] [ Foto ] [ Zettel ]              │
│  Werte  {…}     · JSON · CSV · Zugangsschlüssel  [⎘] │
└──────────────────────────────────────────────────────┘
```

- **`Offen` sits above the picture.** A human wrote it for another human. Empty ⇒ the section, header
  included, is not rendered.
- **The sentence** is one or two clauses joined by „ und ", ≤ 90 chars, deterministic (§5.3), computed once
  per screen entry — it does not re-rank while you look at it.
- **The `→` line is the remedy** (§5.4): at most one per Tafel, a Zeile that walks to the Ding it names,
  rule id printed and resolvable in `Werte`.
- **`Ziel` rows are indented under the measure they belong to, and they diff too** — the visible face of F4.
- **Vorher is never coloured „bad"**: left column at 88 % opacity with a 2 px `--tc-line` border. Only Δ
  carries colour. The four action buttons are equal width, fixed order, and never move.

### 4.1 How it looks — because nobody designed that either

One family (`-apple-system, "Segoe UI", Roboto, sans-serif`). **Every number is `font-variant-numeric:
tabular-nums`, without exception** — the columns must align to the digit or the diff is unreadable.

`--tc-t-satz` 19/26 600 (the sentence, **exactly one per screen**) · `--tc-t-kopf` 17/24 600 (the Ding's
name) · `--tc-t-wert` 17/22 500 (every number) · `--tc-t-zeile` 15/20 400 (row labels) · `--tc-t-neben`
13/18 400 muted (ages, units, provenance) · `--tc-t-abschnitt` 13/16 600 uppercase .04em (section headers)
· `--tc-t-mini` 11/14 500 uppercase .06em (`VORHER`/`JETZT`).

Rhythm: 4 px base; the **only** permitted gaps are 4/8/12/16/24/32. Rows ≥ 48 px, targets ≥ 44, section gap
24, radius 14, hairlines 1 px. Colour: existing Ionic tokens plus `--tc-hoch` (warm) / `--tc-runter` (cool)
for the *direction* of a delta — never red/green, because red is reserved for alarms; `--tc-gleich` muted;
amber only for `Offen` and alarms. Status square 12 px: gefüllt = frisch, hohl = veraltet, amber = offen,
rot = Alarm.

**The empty-state mark**, one SVG reused wherever something is missing: two rounded rectangles side by side,
the left dashed, joined by a dotted arrow — 96 px, `currentColor`, 1,5 px stroke. It is the thesis drawn
once, and it carries four captions: `Noch kein Vorher` · `Keine Kamera gekoppelt` · `Nichts verbunden` ·
`Noch nichts passiert`. No illustration library, no hero art.

### 4.2 States

| Situation | The Tafel |
| --- | --- |
| **Veraltet** 2–10 min | `◻`, values muted, each with its own age. **Nothing blanked** — a stale number is the best number available. |
| **Offline** > 10 min | `● Offline seit Mi 14:02 (vor 3 Std)`. Jetzt column keeps its last values, greyed, header reads `zuletzt`; frame carries the existing `addOfflineOverlay`. `Gabe/Notiz/Foto/Zettel` stay **enabled** — logging is a cloud write. Only `Ziel ändern` disables: `Gerät offline — Änderung wird bei Rückkehr gesendet.` |
| **Keine Kamera** | Both halves become **Wertebänder** (24 h min/max per measure, stacked), same endpoint labels, one line + `[ Kamera einrichten ]`. Sentence, slider, table, sections byte-identical. No `film` Dinge exist. |
| **Kamera still > 3 h** | Jetzt half = last kept frame with `Letztes Bild vor 3 Std 12`; sentence rank 1 becomes the camera; the alarm already went out (§9.5). |
| **Bild verworfen** | `Bild verworfen (Hand im Bild) — gezeigt: 14:04`. A rejected frame is never shown as „jetzt". |
| **Kein Vorher** | §12 — the Vorher column becomes **`ZIEL`** and the diff is measured-vs-target. Same shape. |
| **Werte fehlen, Bild da** | Rows read `— (keine Daten)`. The pair still works; the two sources fail independently and the screen names which. |
| **Share `webcam:false` / Demo** | Wertebänder variant minus the setup button / `[ Eintragen ]` reads `[ Im Demo nicht möglich ]`. |

---

## 5. NO-MODES MECHANISM

> **Falsification test: if you can name a control whose sole effect is to show or hide a class of feature,
> it is a mode.**

`ui-mode.ts` and `localStorage['app-settings-expert']` are **deleted**, not renamed, in the same commit as
the setup wizard's dependency on them.

**M1 · Depth is subject-distance** (C36). No expand control, no „mehr anzeigen", no density preference, no
remembered expansion state. A Ding is one line when related and a full Tafel when it *is* the Subjekt. You
do not set depth; you walk — and walking is stateless, so nothing the techie does changes what the stoner
sees tomorrow on the same account.


**M2 · The cursor is a continuum, not a switch.** The slider moves one variable. **At every position the
screen has the same sections, the same rows and the same controls**; only the columns and the sentence
change content. That is a knob, and the hardware ships with one. The snap ladder makes it usable at 2 a.m.
— `Beginn · Phasenwechsel · 1 Woche · gestern · gestern Abend · letzte Gabe · seit zuletzt`, 40 px magnetic
zones, any position between reachable by a deliberate finger, resolved moment printed as you drag.

**M3 · Pause is the disclosure gesture, default inverted.** C11: playing is simple, pause unfolds. Here
**rest is already the unfolded state and motion is what collapses it** — strictly stronger against the mode
accusation, because the dense readout is what you get by doing nothing. At rest the whole Tafel is present
and scrolling is not a disclosure control. While the handle or the chart crosshair moves, the diff table
collapses to a two-line **pinned scrub header** in the same place at reserved fixed height, so nothing
reflows under your thumb: `Fr 22.08. 14:02 · Tag 31 · 24,1 °C · 61 % rF · Licht 100 %` /
`Bild behalten · Schärfe 0,71 · belichtet ×1,04 · 2 Dinge ±2 Std`. On release the table unfolds again
describing where you landed, and gains two rows that only mean something once you have deliberately
stopped: `Lief: Licht 100 % · Entfeuchter an` and `Dinge ±2 Std: Gabe 2,0 l (Anna, 12:05)`. Nothing
persisted; self-cancels on the next touch.

**M4 · Reveal by capability and by data.** Sockets from `hardwareInfo.sockets` per role, never the
three-bucket `deviceControlCapability()` that returns `'full'` for a heater-only tent; a humidity `ziel` is
**not created** without a `dehumidifier` role; a missing key (old firmware) fails **closed** with `Gerät
meldet keine Steckdosen — Firmware zu alt.` Zero `pflanze` Dinge ⇒ „Pflanze" appears in exactly one place in
the product: the `+` on `Im Zelt`. One `mensch` ⇒ no `Wer?` row anywhere. Neither is reversible through a
setting, which is what makes them not modes.

**Honest audit.** *The slider* — not a mode: same sections at every position, one variable, printed value,
session-scoped; closest analogue is a scroll position. *Collapse-while-dragging* — not a mode and the
inverse of one; reserved height means it cannot hide anything. *`Δ` chip* — re-renders one image, same
level as pinch-zoom. *`Werte {…}`* — same row, same position, every Tafel, from install, for everybody; a
page footer with a payload. *`⋯ 340 weitere`* — cursor pagination of one ordered list. *The `→` remedy
line* — **the closest call**: a user can go weeks without seeing one and then meet an element they have
never met. It hides no feature class, but it is the one thing whose *presence* is conditional on neither
hardware nor data volume. Mitigation: styled as an ordinary Zeile inside the sentence block, rule id printed.

### 5.3 The sentence generator

Deterministic, ranked; the first two matches compose with „ und " (second clause lowercased), ≤ 90 chars,
else one clause. 1 Kamera still · 2 Zelt offline ≥ 30 min · 3 Blattfläche ±3 pp (`Die Pflanzen sind
gewachsen.` / `Im Bild ist weniger Grün als vorher.`) · 4 a measure beyond σ (`Nachts war es wärmer.`) ·
5 tile change ≥ 90th percentile (`Im Bild hat sich vor allem oben links etwas verändert.`) · 6 a `ziel`
changed in the span · 7 a human Ding in the span (`Anna hat gegossen.`) · 8 else `Seit Freitag hat sich
wenig geändert.` — and the table still shows every delta, so nothing is lost when the sentence is boring.

### 5.4 What to do about it — the deterministic remedy table

The 4,93/10. **Rules, not an advisor.** Each names what was measured, what mechanism we own and one concrete
change, and each walks to a Ding. A rule that cannot name a mechanism produces **no line at all** — silence
beats a guess. Hard boundary: **remedies are about the tent and the kit, never about the plant. No rule
reads a picture as evidence about a plant.**

| Id | Trigger (from data the app has today) | The line | Walks to |
| --- | --- | --- | --- |
| **N-3** | night mean > `night.temperature` + 1,5 °C on ≥ 3 of the last 5 nights **and** no socket role can cool | `Nacht-Ziel steht auf 21,0 °C und Abluft ist keine Dose. Was du tun kannst: Licht dimmen (jetzt 100 %).` | `Licht (PWM)` |
| **N-4** | night target within 1,5 °C of day target | `Nacht-Ziel 24,5 °C liegt nur 0,5 °C unter dem Tag-Ziel. Üblich sind 3–6 °C Absenkung.` | `Ziel Nacht-Temp.` |
| **H-1** | heater duty ≥ 90 % over ≥ 2 h **and** measured < target − 1,0 °C throughout | `Die Heizung lief 2 Std 40 ohne Pause und es blieb 1,4 °C zu kalt. Die Heizleistung reicht nicht — oder die Dose schaltet nicht.` | `Heizung (Dose 1)` |
| **H-2** | socket on ≥ 6× in 24 h **and** the controlled measure's 10-min slope after switch-on ≤ 0 in ≥ 5 of them | `Die Heizung hat heute 7× geschaltet und die Temperatur ist danach nie gestiegen. Prüf, ob am Stecker etwas hängt.` | `Heizung (Dose 1)` |
| **L-1** | `out_light > 50 %` for 15 min while frame brightness sits in the lights-off band, or the inverse | `Das Licht sollte an sein, das Bild ist dunkel. Prüf die Lampe oder die Dose „Licht".` | `Kamera` |
| **E-1** | `dehumidifier` duty ≥ 80 %/24 h **and** `workmode ∈ {temp, breed}` | `Der Entfeuchter lief 19 Std 20 von 24. In der Betriebsart „temp" kühlt diese Dose — sie entfeuchtet nicht.` | `Entfeuchter (Dose 2)` |
| **V-1** | VPD outside the stage band ≥ 2 h/day while temperature is inside its band | `VPD 1,62 kPa liegt über dem Blüte-Band 1,2–1,5. Bei 25 °C wären dafür 62 % Feuchte nötig statt 48 %. Eine Dose mit der Rolle „Befeuchter" kennt die Firmware nicht.` | `Ziele` |
| **K-1** | no `jpeg` frame > 3 h **and** the device is online | `Seit 3 Std 12 kein Bild, obwohl das Zelt online ist. Das Problem liegt an der Kamera, nicht am Controller.` | `Kamera` |
| **D-1** | Influx gap ≥ 30 min **and** no frames in the same window | `Zwischen 03:12 und 05:22 fehlen Messwerte und Bilder. Das Zelt war offline.` | `Controller` |
| **F-1** | Schema step due, no `gabe` since | `Schritt 5 des Schemas ist seit 2 Tagen fällig.` | opens `Gabe`, prefilled |
| **Z-1** | a `ZielStand` changed inside the compared span | `Das Tag-Ziel wurde am 24.08. von 24,0 auf 25,0 °C geändert. Werte davor sind gegen 24,0 gemessen.` | that `ziel` Ding |

V-1's bluntness is deliberate: `SOCKET_ROLES` is exactly `dehumidifier, heater, light, secondary_light,
co2`. **The tent cannot humidify and cannot actively cool.** Naming that is more useful than a nudge nobody
can act on.

---

## 6. The chart — `/z/:zelt_id/chart`

ECharts 6, tree-shaken, hand-rolled ~50-line directive (owner decision); `chart.js`/`ng2-charts`/
`chartjs-adapter-luxon` deleted in the same commit.

**The chart is the third projection of the cursor.** Its x-window is `[Vergleich.von, jetzt]`, always, and
its crosshair *writes back* to `Vergleich.von`. Enter from any Ding and the window is already your span;
drag the crosshair back and the picture pair has moved. That is the only reason a separate chart screen is
allowed to exist in a Ding-only IA.

```
│ ← Zelt Keller · Verlauf      Fr 22.08. 14:02 – jetzt │
│ [96px Bild] Fr 22.08. 14:02 · Tag 31 · 24,1 °C · 61 %│ pinned scrub header,
│ ▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓▓▓░░░░▓▓▓▓▓▓▓  Filmstreifen 44 px   │ NOT a tooltip; shares
│ Temperatur °C      88 % im Band · längste Abw. 41 Min│ the cursor
│ 28 ┤▨▨▨▨▨░░░░░░░░░░▨▨▨▨▨▨   Tag/Nacht aus out_light   │
│ 24 ┤╌╌╌╌╌┐└╌╌╌╌╌╌╌╌  Sollwert AUS ZielStand, Stufe   │
│ 20 ┤ ╱‾╲__╱‾‾╲___╱‾╲__      am 24.08. 19:04          │
│ Luftfeuchte %  ·  VPD kPa  (eigene Panels, shared x) │
│ Ausgänge  Licht ████████  ████████ · Heizung ▓ ▓▓ ▓  │
│ ▪ ▪▪  ▪▪③   ▪  ← Menschen   ▲   ▲    ▲ ← Gerät       │
```

- **Sollwert** is a stepped dashed `markLine` from **`ZielStand`**, not from today's `configuration`. Where
  no row predates the window the line is dotted and the axis prints `Ziel unbekannt vor 14.09.` (F4).
- **Zielband** `markArea`, one source at a time, labelled: alarm thresholds > Sollwert ± Toleranz > the
  stage's `vpdRange`. **Tag/Nacht** from measured `out_light > 0`, schedule as fallback, in the Zelt's
  `zeitzone` — a failed contactor renders as a **missing band**, diagnostic rather than decoration.
- **Ausgänge** in a state-timeline lane: region length = duration, null = gap, never 0/1 value lines.
- **Annotation rail** below the axis, two rows (people / machine), 10 px clustering with count badges,
  full-height dashed lines for `phase` starts. **Tapping a mark makes that Ding the Subjekt** — the rail is
  Zeilen, positioned. No hover; there is no hover on a phone.
- **Verdict strip** computed **server-side on raw Influx samples**, never `aggregateWindow(mean)`, split
  Tag/Nacht, longest excursion as a duration, greyed below 80 % coverage with the coverage printed.
- `sampling:'minmax'` on the primary series — LTTB smooths away exactly the bang-bang oscillation the
  grower is looking for; LTTB for the navigator only. Two fingers pan/zoom, one finger scrolls, tap sets
  the crosshair, axis labels never hidden.
- **Prerequisite, not a feature:** parameterise the raw Flux interpolation of `measure`/`from`/`to`/
  `interval` (`data.service.ts:80-89`), move `limit(n:50000)` before `yield()`, constrain interval by
  timespan so `3y × 5s` is unreachable.

---

## 7. Diary and multi-plant

**There is no diary feature.** The Zelt's `Verlauf` is the tent's diary; a `pflanze`'s `Verlauf` is that
plant's diary; same rows, same renderer, same cursor. „It does the diary keeping for you" means `ereignis`,
`bild`, `film`, `phase` and `ziel` changes are written by the machine into the same list the human writes
into — so a user who logs nothing still opens a full diary.

```ts
pflanze  d: { sorte?, medium?, topf_l?, quelle?: 'samen'|'steckling'|'gekauft',
              keimung_t, ernte_t?, ernte_g?, entfernt_t?, ausschnitt?: [x,y,w,h] }
         name: "A3 · Wedding Cake"   // renaming NEVER changes ding_id     rel: { in: [zelt_id] }
phase    d: { stufe: DiaryLifecycleStage }       t / t_ende, rel: { an: [pflanze…] }
gabe     d: { wasser_l, kannen?, kanne_l?, ec?, ph?, ec_basis: 'absolut'|'plus_leitungswasser',
              ablauf_ph?, ablauf_ec?, produkte: [{ name, ml_pro_l, aus_schema: boolean }],
              schema_id?, schritt? }             rel: { an: [pflanze…] }, akteur, auto_bild
notiz    d: { text }                             rel, bilder, auto_bild
zustand  d: { text, geschlossen_von? }           t / t_ende(null = offen), akteur
mensch   d: { farbe }                            name only, Zelt-scoped, no account
```

`DiaryLifecycleStage` gains a seventh stage, `ernte` — harvest is not a stage today, so „wie lief dieser
Durchgang" is unanswerable. Optional field, read-time normaliser, no migration tool.
`convertEventsToGrowCycles()` (`grow-report.component.ts:691-747`) stops being a runtime string comparison
and becomes a **one-time idempotent boot backfill** emitting `pflanze` + `phase` Dinge keyed by trimmed
`lifecycleName`, marked `d.aus_log`. Nothing is deleted; old `DeviceLog` rows keep projecting as
`ereignis`/`notiz`. Server-side cursor pagination is a v1 prerequisite — the unbounded `getDeviceLogs`
cannot survive this.

**The plant-ignorer is untaxed.** `rel.an` absent = the whole tent, and absent is the default forever. No
empty state, no „0 Pflanzen" card, no nag. **Multi-plant pays off in the diff:** A3's Tafel compares A3 at
the cursor to A3 now — `Blüte Tag 12 → Tag 19 · 4,0 l Wasser · 12 ml Bio-Bloom · von Anna 2×, Ben 1×` —
with both frames cropped to `pflanze.d.ausschnitt`, a rectangle the user drags once on a frame. **Optional
and never prompted.**

---

## 8. Watering & fertilising

```
┌─ Gabe ───────────────────────── heute 19:40 ──┐
│  An      [ Ganzes Zelt ]  A1   A2   A3        │  ← only if pflanze Dinge exist
│  ╭───────────────────────────────────────╮    │
│  │  ● ● ● ○ ○ ○ ○ ○      3 Kannen · 6,0 l│    │  ← TAP = one can, 72 px tall
│  ╰───────────────────────────────────────╯    │     long-press = −1
│  Kanne  2,0 l ▾            ☐ bis Ablauf       │  ← kanne_l remembered per Zelt
│  Bio-Bloom  2,0 ml/l   Bio-Heaven  1,0 ml/l   │  ← prefilled from the Schema step
│  aus „Biobizz All-Mix · Blüte Woche 2"        │
│  pH — · EC — · Ablauf pH — · Ablauf EC —      │  ← always here, never required
│  Notiz ………………  📷 Foto                        │
│  Wer?   ( Anna ) ( Ben ) ( ich )              │  ← only if ≥ 2 mensch Dinge
│  ⚠ Anna hat A1–A3 vor 1 Std 30 gegossen       │
│    (2,0 l).                  [ Bild ansehen ] │
│  [        Trotzdem eintragen         ]        │
└───────────────────────────────────────────────┘
```

| Path | Sequence | **Taps** |
| --- | --- | --- |
| Routine water, volume unchanged | `Gabe` → `Eintragen` | **2** |
| Same, guard fires | `Gabe` → `Trotzdem eintragen` | **2** |
| Feed on the Schema's step (doses prefilled) | `Gabe` → `Eintragen` | **2** |
| Club member, actor remembered on this phone | `Gabe` → `Eintragen` | **2** |
| Club member, first time on this phone | `Gabe` → `Anna` → `Eintragen` | **3** |
| Three cans instead of two | `Gabe` → counter ×3 → `Eintragen` | **5** |
| Two plants only | `Gabe` → `Ganzes Zelt` → `A1` → `A3` → `Eintragen` | **5** |
| Full club record with pH/EC in and out | + four number pads | **~15** |

Litres are derived from taps and shown, never typed. The 2-tap and 15-tap paths are the same sheet in the
same order; they differ only in how far down you choose to go.

**Medium + regime**, selected once on the `Ziele` Tafel; a Mongo content collection, never in the bundle:

```ts
Schema { schema_id, label: "Biobizz All-Mix", medium_text: "All-Mix — stark vorgedüngt",
         duengen_ab_woche: 3,
         schritte: [{ index, anker: 'woche'|'phase_woche'|'gabe_n', phase?,
                      produkte: [{ name, ml_pro_l?, bereich? }],
                      ec_ziel?, ec_basis: 'absolut'|'plus_leitungswasser', ph_bereich? }],
         quelle_url, geprueft_am, art: 'hersteller_pdf'|'hersteller_rechner'|'herrenlos' }
```

- **The step advances by feed events, not wall clock** — `Schritt 7 von 14` with a soft calendar mapping
  (`etwa Woche 5`). Growers feed Tuesday and Friday and slip.
- Before `duengen_ab_woche` the sheet prefills **no products** and prints `All-Mix ist vorgedüngt — bis
  Woche 3 nur gießen.` The only place the product refuses to fill something in, and the „it thinks for me"
  payoff. Reminder path: rule F-1 puts `Schritt 5 ist seit 2 Tagen fällig` on the home screen — no task
  list, no badge, no notification centre.
- Every prefilled value stores `aus_schema: true`; the moment it is edited, `false`. Months later the report
  says `wie im Plan` vs `abweichend` — the club's actual question.
- EC canonical in mS/cm; `plus_leitungswasser` renders as `EC-Ziel 1,4 + dein Leitungswasser`, never a bare
  ppm. Autoflower gets a `×0,25–0,5` multiplier and no 12/12 flip; no manufacturer chart has an auto column.
- Seed set: Biobizz Light-Mix, Biobizz All-Mix, Floragard Light, Green House Powder Feeding, BioTabs.
  Plain-text names, no logos, `quelle_url` + `geprueft_am` shown as `zuletzt geprüft 14.07.2026` — legal
  posture and a genuine trust feature in one string.

**Double-feed guard.** At sheet open, query `gabe` Dinge whose `rel.an` intersects the selection inside a
per-medium window (soil 6 h water / 18 h feed; coco 3 h / 12 h, because several daily feeds are correct
there). The primary button **relabels** to `Trotzdem eintragen`, so muscle memory cannot fire it.
`[ Bild ansehen ]` opens Anna's `auto_bild` — **you can see whether the soil is dark.** That is the fusion's
contribution to the club problem: the camera turns a warning into evidence.

**Double-*logging*** is a different hazard, solved by construction: the client mints `ding_id` before the
request and the server upserts on it, so a retry can never double-log. The Zeile renders immediately with
`⟳ nicht gesendet`; the queue drains on focus and, with the service worker of §9.6, in the background.

---

## 9. Camera, timelapse, image correlation — and THE SLIDER

### 9.1 The slider — what it scrubs, what moves with it, what pause unfolds

**`<tc-zeitgriff>`**, 56 px, directly under the sentence block, in the identical position on every Tafel.
**It moves `Vorher`.** What `Vorher` *can be* depends on the Ding, and this is the only rule:

> **A Ding that has a state diffs against a moment. A Ding that is a moment diffs against its predecessor.**

| Subjekt | The handle scrubs | Detents |
| --- | --- | --- |
| `zelt` `geraet` `dose` `pflanze` `kamera` `ziel` | a **moment** in this Zelt's history | Beginn · Phasenwechsel · 1 Woche · gestern · gestern Abend · letzte Gabe · seit zuletzt |
| `gabe` `notiz` `bild` `ereignis` `phase` | the **predecessor chain** — the previous Gabe to the same plants, the previous frame, the previous stage | each predecessor is a detent |
| `mensch` | that person's **previous visit** | their own entries |
| `film` | the film's own playback position | chapters |

Behind the track, a 12 px **Dichteband**: one bar per day, height = kept frames + Dinge. You can see where
there is something to compare against, and gaps stay visible instead of being stretched away.

**The projections of the one cursor** — C11's „drag either and both move", generalised by C36: (1) **the
body** — the Vorher frame, the Vorher column, the sentence; (2) **the `Verlauf` list** — rows older than
`von` dim to 45 % below a hairline labelled `Vorher · Fr 22.08. 14:02`, and tapping any row **sets the
cursor to that row's time**, which is the reverse direction and how you ask „was ist seit dieser Gabe
passiert?" in one tap; (3) **the chart** — window `[von, jetzt]`, crosshair writes back to `von`. Also
writing to the cursor: a film-strip thumbnail, an annotation-rail mark, and `Nächster Unterschied ›`, which
jumps `von` to the next moment at which **this Ding** changed by more than its own σ floor (F3).

**Pause unfolds** exactly as in §5 M3: motion collapses the diff table to the pinned two-line scrub header
at reserved height; release restores it, describing where you landed, plus `Lief:` and `Dinge ±2 Std:`.

Performance: drag renders at 60 fps from already-loaded thumbnails and series; server refetch debounced
250 ms; every derived array behind the existing `KeyedCache` or `ngFor` rebuilds the DOM on every
change-detection cycle. Desktop, where the big screen is unexploited today: same control, diff table two
columns wide on the left, chart pinned right, both on the same cursor; `←`/`→` one detent, `Shift+←` one
hour, `Space` toggles the collapse.

### 9.2 The cull and `Bildmass` — what is real

`sharp` 0.34.5 and ffmpeg are already dependencies and already invoked via `execFile`. **No new binary, no
ML runtime.** Per frame at ingest, ≤ 60 ms: downscale to 128×96 grey and 64×48 raw; `licht` from
`out_light` at `t ± 60 s` (**the cross-modal join — nobody else owns the lamp**); `helligkeit` = mean;
`schaerfe` = 3×3 Laplacian variance; `phash` = 8×8 dHash, Hamming < 3 ⇒ `doppelt`; `dx/dy` = integer SAD
±8 px; `kacheln[48]` = mean abs diff per tile of an 8×6 grid; `kurzzeitig` = a one-frame-lookahead
transient test, plus rejection of any frame within ±5 min of a human-authored Ding, because somebody was
demonstrably in the tent; `gruenanteil` = fraction with `G > R+τ` and `G > B+τ` in the crop.

Limits stated in the UI as well as here: `schaerfe` cannot tell fog from a defocused lens and is reported as
`unscharf`, never as a cause; `dx/dy` is **translation only**, so a rotated camera is *detected* and becomes
a chapter break, not a correction; `kacheln` says **where**, never **what**; the transient test is blind
above ~60 s; `gruenanteil` is labelled `Blattfläche (Bildanteil)` — never cm, never „Wachstum" as a claim.
**Refused as computer-vision fantasy at every version:** naming a drooping leaf, diagnosing a deficiency from
colour, height in cm, counting plants, segmenting canopy, detecting pests. Point at the tile, show the pair,
let the human do the semantics.

### 9.3 Der Film

**The frame budget is fixed at 600 keepers**, so file size is predictable regardless of span. Keepers come
from **golden windows** — lights-on +1 h/+4 h/+7 h/+10 h, ±20 min, from `daynight` or the measured
`out_light` rise, **so the windows move when the grower flips 18/6 → 12/12**. Best un-culled frame per
window wins. A 7-day film keeps all daylight frames thinned to 600; an 84-day run keeps ~7/day. 600 frames
at 24 fps = **25 s**, 1280×720, `crf 23` → **5–9 MB**: under Discord's 10 MB free tier and Telegram's 50 MB
document limit, sendable on mobile data.

- **Normalisation:** per keeper `sharp().stats()` → grey-world gain triple, luminance pulled toward the
  rolling median of the previous 7 keepers, **clamped ±8 % per keeper** so real change ramps instead of
  snapping. It cannot recover colour a monochromatic lamp never recorded.
- **Stabilisation:** accumulated integer `(dx,dy)` via `sharp.extract()` on a 96 % window, so shifted frames
  are cropped rather than padded. High residual ⇒ the film **cuts to a new Kapitel** with a 6-frame black
  gap and `Kamera verrutscht · 12.09.`
- **Burn-in** via the technique already proven in `addOfflineOverlay` (`image.service.ts:127`): an SVG
  composited per frame — bottom-left `Blüte · Tag 34 · 25.08. 14:02 · 24,8 °C · 58 % · VPD 1,29`,
  bottom-right any Ding within ±10 min (`💧 Anna · 2,0 l`), plus a 3 px progress bar. ~8 ms/frame.
- **Encode:** `ffmpeg -framerate 24 -i %d.jpeg -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt
  yuv420p -crf 23 -vf scale=1280:-2 -movflags +faststart out.mp4`. **This replaces `libx265` at
  `image.service.ts:583`, in the rolling timelapses too.** HEVC in mp4 does not play in Chrome or Firefox;
  today's timelapse is invisible to most customers who have one, and that is a two-line fix.
- **The cull report ships as UI**, not a debug panel — it is why this film is watchable when a competitor's
  is not: `2 148 aufgenommen − 1 106 Licht aus − 289 außerhalb der Fenster − 41 Hand im Bild − 22 unscharf
  − 9 Kamera verrutscht = 600 Bilder → 25 Sek bei 24 B/s · 2 Kapitel`.

### 9.4 HOW THE FILM IS STORED

`Image.data` is a `Buffer` inside a BSON document (`images.model.ts:22`) and BSON caps at 16 MB; there is no
GridFS in `server/src`. **v1 adds one:** `new GridFSBucket(mongoose.connection.db, { bucketName: 'filme' })`.
Mongoose already exposes the native `Db` handle, so this is **no new dependency and ~30 lines**: ffmpeg's
stdout pipes into `bucket.openUploadStream()`, and the download route resolves an HTTP `Range` header to
`bucket.openDownloadStream(id, { start, end })`. A hand-rolled chunk table is the same work with worse
tooling.

```
POST /zelt/:zelt_id/film   { von, bis, nur_tagbilder, angleichen, ruhig_stellen, zahlen }
                           → { film_id, status:'queued' }   idempotent on the recipe hash
GET  /film/:film_id/status → { status, bilder_gesamt, bilder_behalten, verworfen:{…}, kapitel, eta_s }
GET  /film/:film_id?token=<imageToken>
     Content-Type: video/mp4
     Content-Disposition: attachment; filename="zelt-keller_tag12-tag84_2026-10-14.mp4"
     Accept-Ranges: bytes         ← required, or iOS Safari will not play it inline
```

Stills stay in `Image`, untouched. Retention: `filme` until deleted, raw frames 90 days, `Bildmass` with the
frames. **Three real routes off the phone**, and the UI says which one you get:
`navigator.share({files:[File]})` where supported (the mp4 lands in WhatsApp/Telegram/Fotos directly);
`<a download>` on Android and desktop; on iOS without Web Share the video opens in a tab under the line
`Lange drücken → „In Fotos sichern"`. A share that produces a login wall is not a share.

### 9.5 Camera alarms · 9.6 Reaching a closed app

Two alarms, created by default the moment a camera is paired, cloud-side, no firmware. They reuse `Alarm`
storage and `handleAlarmAction` but need an ~80-line evaluator ticker, because `alarm.service` only
evaluates on inbound MQTT and neither is a sensor threshold. (1) No `jpeg` frame for > 3 h → `Zelt Keller:
Die Kamera hat seit 3 Std kein Bild geliefert.` (2) `out_light > 50 %` for 15 min while frame brightness
sits in the lights-off band, or the inverse → `Zelt Keller: Das Licht sollte an sein, das Bild ist dunkel.`
The second is the thesis in one alarm: **neither the picture nor the data can detect a failed contactor
alone; together they detect it in fifteen minutes.**

The server has `sendMail` and webhooks only. v1 adds **Web Push (VAPID) + a minimal
`@angular/service-worker`** — one dependency, one build change, ~4 days including the subscription
endpoint, and it doubles as the offline capture queue. Stated in the UI rather than hidden: **on iOS, web
push only works for an installed PWA**, so the notification row carries `Auf dem iPhone: Teilen → „Zum
Home-Bildschirm", sonst kommen keine Meldungen an.` E-mail stays the default fallback.

---

## 10. Clubs — attribution without an auth rewrite

- **`mensch` is a Zelt-scoped name the owner types once.** No account, no e-mail, no `auth.middleware`
  surgery. Every capture writes `akteur`. ~2 days. The `Wer?` row appears only at ≥ 2 `mensch` Dinge; free
  text with the hint `Vorname oder Spitzname reicht`. We never ask for identity.
- **The fusion's club feature: a `mensch` Tafel is „was ist passiert, seit du zuletzt hier warst".** Anna
  opens the app, the cursor defaults to her own last visit, and — because the cursor survives every walk —
  the tent, plant A3 and the heater all answer *her* question. Walk from Anna to A3 and A3's diff is still
  measured from Anna's last visit. **This does not exist without all three sources.**
- **Standing conditions.** `zustand` is the note pinned to the tent door, opened by anyone from `Zettel`,
  closed by anyone with `✓` (stamps `d.geschlossen_von` + `t_ende`). It sits above the picture because an
  open fact outranks the camera.
- **The cumulative question**, on the `pflanze` Tafel where it is asked: `Wasser 18,5 l über 11 Gaben ·
  Bio-Bloom 31 ml, zuletzt vor 2 Std · von Anna 7 · Ben 3 · ich 1`.
- **Corrections, not edits.** Editing a `gabe` writes a new one with `storniert_von`; the old Zeile renders
  struck through. Reconstructable history without cryptographic immutability, which would victimise the
  unregulated grower.
- **Not in v1: real memberships.** A second login needs a `Mitgliedschaft` collection, a rewrite of
  `auth.middleware.ts:172` and `:207`, ~10 loosened owner-scoped queries and an account-lookup-by-email
  endpoint that does not exist. The upgrade path is designed in: `akteur` points at a `mensch`; a later
  account sets `mensch.d.user_id` and every historic row keeps resolving.
- **Privacy, maximal by default.** Harvest weight and plant count are never prompted (the field exists,
  empty, `optional`). No location, no analytics SDK, no community feed. `Alles löschen` deletes `dinge`,
  `ZielStand`, `Bildmass`, `DeviceLog`, `Image`, the `filme` bucket and the Influx series — which also fixes
  the live bug where `DELETE /device/logs/:device_id` removes nothing from the diary because `deleted` is a
  visibility flag (`device.service.ts:739`). Never a `KCanG-konform` badge; no per-member dispensing data.
- **Bulk export and an API credential, both absent today:** `Werte` carries `JSON`, `CSV` and
  `Zugangsschlüssel` — a per-Zelt read-only key accepted as `x-api-key` on `GET /api/dinge` and
  `GET /api/reihen`. Revocable, one per Zelt, printed once.

---

## 11. Old devices (type 7) — no hand-waving

A `fan`/`light`/`plug` owner gets a Zelt containing exactly their device and **the same screen, minus what
their hardware does not have.** Nothing is stubbed, disabled or greyed.

```
  Steckdose Balkon   ● Online · Werte von vor 1 Min
  ┌──── VORHER ────┐  ┌──── JETZT ─────┐   ← Wertebänder, no camera
  │ 22,4 °C 49 %▁▃▂│  │ 22,1 °C 51 %▂▄▃│      gestern 14:02 → heute 14:04
  └────────────────┘  └────────────────┘
  Die Dose lief länger als gestern.
  An 3 Std 55 → 4 Std 20 pro Tag · +25 Min
  Vorher ├──●──────────────────────┤ Jetzt   Beginn · 1 Wo · gestern · jetzt
  Der Unterschied        gestern → jetzt      Δ
    Temperatur           22,4 °C   22,1 °C  −0,3
    Luftfeuchte            49 %      51 %     +2
    Einschaltdauer/Tag  3 Std 55  4 Std 20  +25 Min
    Übertemperatur-Grenze  30 °C     32 °C  Ben, gestern
  Im Zelt   ◼ Schalter an · ◼ Ziele 4 Werte · ◼ Einstellungen (alt) →
  [ Notiz ] [ Foto ] [ Zettel ]     ← Gabe absent: no plants on this Zelt
```

- **plug** — temperature, humidity, the switch. Its four limits (`overtemperature`, `undertemperature`,
  `time`, heater day/night) become `ziel` Zeilen with the existing `value-edit-row`. The three i18n keys
  that render as raw strings today (`settings.limits.overtemperature.enabled`, `.undertemperature.enabled`,
  `.time.enabled`) plus `devices.plug.settings.heater-day`/`-night` are fixed in the same commit.
- **light** — dimming as the primary number, schedule as `ziel` Zeilen, Tag/Nacht shading from `out_light`
  so a failed contactor is a visible hole. The diff line an old owner has never been told:
  `Das Licht lief 25 Min länger — 12 Std 25 statt 12 Std 00 (Plan).`
- **fan** — rpm as the primary number, the curve as `ziel` Zeilen. **dryer** — out of scope per `AGENTS.md`;
  keeps its settings page verbatim behind one Zeile `Einstellungen (alt)`. Nothing broken, no effort spent.

**Non-breakage checklist:** `/charts` and `/diary` redirect with the query string intact; the old
`/device/:id/settings` route **survives for fan/light/plug/dryer** and is linked from the Tafel;
`ShareLink.page` unchanged; `ChartPreset.query` still parses; `applyViewParams` keeps its back-compat
branch; `resolveDeviceAccessInfo` (`locked`, `canEdit`, `webcamAllowed`, `chartsAllowed`) re-verified
against the new browser; `/classes`, `/diagnostics`, `/testmode` untouched. No plants, no Gabe, no Schema,
no camera unless one is paired — all by capability and data, none by a mode.

---

## 12. Day one and the first 48 hours

A diff needs a *Vorher* and day one has none. **The answer is not an empty state; it is a different
comparand in the same frame — the Vorher column becomes `ZIEL`.**

```
  ┌──── ZIEL ────┐   ┌──── JETZT ────┐
  │  25,0 °C     │   │ [erstes Bild] │   dein Ziel → heute 14:04 · Tag 1
  │  60 %        │   │   26,2 °C     │
  └──────────────┘   └───────────────┘
  Es ist 1,2 °C wärmer als dein Ziel.
  26,2 °C · Ziel 25,0 · Feuchte 54 %, Ziel 60
  Ziel ├●────────────────────────────┤ Jetzt     Detents: Ziel · Beginn · jetzt
  Noch kein Vorher — der erste Unterschied entsteht nach der ersten Nacht.
  Der Unterschied         Ziel  →  jetzt     Δ
    Temperatur          25,0 °C   26,2 °C  +1,2
    Luftfeuchte           60 %      54 %     −6
    VPD              Band 1,2–1,5    1,41     ✓
```

The track has two detents (`Ziel`, `Beginn`) and grows more as history arrives — reveal by data, and it
means the control learned on day one is the control used on day 84.

| t | With no wizard and no onboarding question |
| --- | --- |
| 0 | Device claimed → Zelt auto-created, named from the device name. Body = Ziel-vs-Ist. `tag_null` = now. |
| +2 min | First frame → the Jetzt half becomes a picture. Vorher stays `ZIEL` until a frame exists at the cursor. |
| +30 min | `Verlauf` gets `◼ Gerät verbunden`, `◼ Ziele gesetzt`, then one grey line: `Noch nichts passiert. Was du tust, steht hier.` |
| +3 h | Enough frames for a `Blattfläche` baseline; the row appears. |
| +12 h | First lights-off boundary → the `gestern Abend` detent appears; Tag/Nacht shading exists. |
| +24 h | `gestern` detent. **The pair becomes two real pictures and the concept is fully itself.** `Film · Woche 1` is queued. |
| +48 h | `seit zuletzt` becomes meaningful — the app can answer the question it was built for. |

Nothing is nagged. No plant, no strain, no medium, no name is requested. In the first 48 hours the product
asks for nothing at all.

---

## 13. v1 scope for October 2026

Two developers, six to eight weeks.

| # | Item | Days |
| --- | --- | --- |
| 0 | **Prerequisites:** Flux interpolation parameterised, `limit` before `yield`, interval constrained by timespan, `Alles löschen` actually deletes | 2 |
| 1 | **`Zelt` + silent migration + naming pass** — kills „FRIDGE GROW", adds `devices.controller` i18n, per-role capability failing closed, data age on every value | 4 |
| 2 | **`dinge`** — 6 stored arts, 8 read-time adapters, `GET/POST/PATCH /api/dinge` with cursor pagination, `x-api-key`, JSON/CSV export | 7 |
| 3 | **The one browser component** — Zeile, Tafel, four sections, `Werte`, `KeyedCache` everywhere, art-specific Körper as separate declared components from the first commit | 8 |
| 4 | **`<tc-zeitgriff>` + `VergleichService`** — track, detents, Dichteband, collapse-on-drag, pinned scrub header, `Nächster Unterschied`, three projections wired both ways | 5 |
| 5 | **The diff engine** — per-art Vorher resolution, ranked table, sentence generator, the eleven remedy rules | 6 |
| 6 | **`ZielStand`** — config diff watcher, `erstbefund`, projection as `ziel` Dinge | 2 |
| 7 | **`Bildmass` ingest** — §9.2 including the lookahead buffer | 4 |
| 8 | **Der Film** — golden windows, 600-frame budget, cull report, normalise, stabilise, burn-in, **x264 switch**, **GridFS bucket**, range-aware download, `navigator.share` | 8 |
| 9 | **Camera alarms** + evaluator ticker | 2 |
| 10 | **Gabe/Notiz/Foto/Zettel** sheets, tap counter, `mensch` picker, double-feed guard, `auto_bild`, client-minted ids, `Bisher` aggregation | 6 |
| 11 | **`Schema`** — 5 seeded entries with `quelle_url`/`geprueft_am`, prefill, the `duengen_ab_woche` refusal | 4 |
| 12 | **Chart** — ECharts 6, `ZielStand` setpoint, bands, Tag/Nacht, output lane, annotation rail, film strip, raw-sample verdict strip; delete chart.js | 8 |
| 13 | **Service worker + Web Push (VAPID)** | 4 |
| 14 | **de + en in the same commits**; end-to-end against `simulate-device.sh setup`, `run --camera`, `history --days 30`, forced offline | 3 |

≈ 73 developer-days ≈ 7,3 weeks for two. **The slack is item 12**: if it slips, the chart ships as the
existing Highcharts page with the `ZielStand` setpoint line, Tag/Nacht and the shared cursor added, and the
ECharts migration lands in November. Item 13 is the second casualty; e-mail already works. **Items 3, 4 and
5 must not slip — they are the concept.**

**Not in v1:** real memberships · run-over-run comparison (`Durchgang A Tag 30` beside `Durchgang B Tag 30`
as a picture pair — the natural v2 and the retention feature) · a sprite endpoint for the film strip ·
rotation-correcting stabilisation · public diary URL and the BBCode generator · Telegram/Discord
destinations · a `ding.created` webhook · the `Bildänderung` chart lane.

---

## 14. Honest weaknesses

1. **The cursor is invisible state, and invisible state is how modes sneak back in.** It is printed under
   the handle on every screen and it resets each session — but a user who dragged it to `Beginn` three
   screens ago and forgot is reading a diff they did not ask for. Two mitigations (the printed moment, the
   dimmed `Verlauf` below the hairline) and neither is proof.
2. **Most days, nothing changed.** A home screen whose honest answer is `Seit gestern hat sich wenig
   geändert` is the opposite of a chart, which always looks busy. The slider is the antidote — drag back a
   week and there is plenty — but that requires the user to *do* something, and the daily visitor won't.
3. **`gruenanteil` is a weak proxy for growth and saying so does not make it stronger.** Confounded by leaf
   angle, dimming, defoliation and camera shift; near-noise under magenta LED. It is the headline visual
   number and the softest one.
4. **The cull's errors are unobservable by definition.** A 90-second tent visit survives the transient test;
   a genuinely fast real change is dropped as a hand. The user sees only a count — the worst kind of error
   in a feature whose pitch is honesty.
5. **The remedy rules will be wrong for somebody.** N-3 assumes an unvented tent; H-1 cannot distinguish an
   undersized heater from an open door. Eleven deterministic rules over five socket roles is a small,
   brittle expert system, and the first time one fires wrongly the user stops reading all of them. Printing
   the rule id, never diagnosing the plant and staying silent without a mechanism reduce the damage; they
   do not remove it.
6. **Uniformity still flattens some things.** The diff makes an unchanged Ding cheap, but an alarm and a
   socket switching are still the same 48 pixels in `Verlauf`, carried by one status square and `Offen`.
   C14's dedicated ranked Befund list is better at urgency than my table is.
7. **One route means one component means a monolith**, and **the read-time adapters have a total blast
   radius.** The Tafel becomes the new `charts.page.ts` unless the art-specific Körper are separate declared
   components from the first commit; and one `GET /api/dinge` over 12 weeks touches `dinge`, `ZielStand`,
   `DeviceLog`, `Image` metadata and Influx with no second screen to fall back on. Both are plans, not
   guarantees.
8. **The majority of launch buyers have no camera.** The Wertebänder variant is complete and honest, but the
   concept's most legible half — two pictures — does not apply to them. Betting the pitch on optional
   hardware is betting on the attach rate.
9. **No firmware change means the tent still cannot be expressed**, and **steering is a walk, not a form.**
   Five socket roles, no humidifier, no exhaust fan, no cooler, `out_dehumidifier` doubling as the cooler:
   this design *names* that on screen for the first time — progress in honesty, zero in capability. And
   changing the night temperature is three taps where today's form is two; the inline `value-edit-row`s on
   `Ziele` are a partial climb-down toward a settings page, and a critic will correctly call it that.
10. **CPU is a real cost, not a rounding error.** Two `sharp` decodes plus analysis per frame ≈ 50 ms ×
    2 880 frames/day. At 150 devices that is ~6 CPU-hours/day *on top of* the existing ffmpeg poll, and a
    film render is another 60–120 s of a core. Today the server is one pm2 process with `pLimit(10)`. This
    needs a real job queue and probably a second box before the first series sells out.
