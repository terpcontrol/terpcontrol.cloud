# Critique — the NORMAL-USER lens

**Who I am.** The competent, sober, non-technical majority. I read a little. I will configure something
once if the payoff is obvious. I will not read documentation. I abandon anything that feels like work.
I compare this app to AC Infinity's and to Instagram, not to Grafana. I am the volume market: if I am
bored or confused, this product fails commercially no matter what the techies think.

**What I test for.**
1. Is the mental model obvious after 60 seconds, without anyone explaining it?
2. Is anything surprising, unexplained, or invented vocabulary I have to learn?
3. Does it look *genuinely good* — 2026, dark mode, mid-range Android — or is it a well-organised 2019
   Ionic app?
4. Does it degrade into an expert tool the moment I go one level deep?
5. Does it pay me on **day one**, not in month four?
6. Can I do the two things I actually do — check the tent, log what I did — in under 5 seconds each,
   and find that log again a week later?

I am not a balanced committee. A concept that is wonderful for a club treasurer or a Home Assistant
tinkerer and mediocre for me scores badly here, and I say so plainly.

---

## Ranking

| # | Concept | Score |
| --- | --- | --- |
| 1 | C03 Beet | 79 |
| 2 | C02 The Verdict | 71 |
| 3 | C06 Glance Tiles | 68 |
| 4 | C09 Das Zelt | 63 |
| 5 | C01 Loupe | 61 |
| 6 | C05 Thumb Journal | 58 |
| 7 | C10 Durchgang | 56 |
| 8 | C07 Der Plan | 54 |
| 9 | C08 Shared Grow | 50 |
| 10 | C04 Zweigang | 38 |

---

## 1. C03 "Beet" — 79

**Verdict:** The only concept whose home screen looks like an app I already know how to use, and the only
one that ships the diary, the plants, the watering flow *and* the chart overhaul in the same release I
buy the hardware in.

A card per plant, with a photo, a day counter, a progress bar, one verdict line, "watered 2 days ago",
"feed due", and four fat buttons — that is the 2026 idiom. It is what a plant app looks like, what a
fitness app looks like, what Instagram looks like. I understood it in about eight seconds. The tent strip
above the cards is the correct demotion of the device: same air for everybody, stated once, sticky, and
never repeated per card.

The implicit plant is the smartest single mechanic in the ten documents. The server creates one at claim
time, the word "Pflanze" never appears while there is exactly one, and I get the day counter, the stage
band, the time-in-range verdict and the week export without ever learning that a plant entity exists. It
buys the multi-plant model at a cost of literally zero taps. Every other concept either taxes me with a
plant question or hides the feature behind a switch I have to find.

Naming the band source on every verdict — *"gegenüber deinen Alarmgrenzen" / "gegenüber Richtwert Blüte"* —
is the fix for the one thing that would otherwise generate a support ticket from me: an unexplained
percentage.

### Fatal flaws

- **The lead plant and the conflict banner are the concept confessing a hardware limit to me in a language
  I did not ask to learn.** "Deine Pflanzen wollen unterschiedliches Klima. Das Zelt folgt Gorilla Glue #4.
  [Wechseln] [Warum?]" is a banner that arrives unprompted on my home screen and tells me my €289
  controller is failing one of my plants. `Leitpflanze` / "Climate follows this plant" is invented
  vocabulary with a ★ glyph I have to decode. The document admits this (§15.2). Every competitor simply
  doesn't raise the question, and the honest answer is not obviously better than silence *for me* — I do
  not have a second setpoint pair to buy.
- **It inserts a card between me and my thermometer, and today it doesn't.** `/list` currently renders my
  single device's dashboard directly. Now I get a plant card whose top half is a photo and a day number
  before I get any reading. The tent strip is 52 px of small muted text. §15.1 owns this and calls it an
  empirical question — it is, and it is a question about *me*.
- **Four new collections, a browser algorithm turned into a one-shot production backfill, and a review
  screen that says "we made 1 plant from your diary, is that right?"** — §15.5 admits the backfill will
  produce wrong-looking history for messy accounts. "The app rewrote my diary" is the support category
  I will personally file.
- **The three-item bottom bar hides for type-7-only accounts.** Adaptive navigation means the app looks
  different on different accounts, which makes it unteachable in a Telegram group.
- **`Phasen-Timelapse` in v1 is a playlist of weekly mp4s stitched together**, labelled honestly but
  visibly a stopgap.

### Best parts to steal

- The plant card: photo, name, `Blüte · Tag 34 · gesamt Tag 71`, progress bar, verdict with its band source
  named, last event, next due, four 56 px buttons. This is the winning home-screen unit.
- The implicit plant with the five explicit no-tax rules (§5.6). Copy them verbatim into whatever wins.
- "Values live at the top, plants live at the bottom, identical is the default" — 2 taps to water three
  plants, one row per action, per-plant overrides costing two extra taps.
- The tent strip as a thin, deliberately recessive band.
- `Phase` / `Grow` as chart range presets. Only possible because a plant is an object, and immediately
  useful to me.
- The "same moment" affordance: open any entry, get the webcam still from ±15 min. One indexed query, and
  it is the best small idea in the document.
- Auto-picking the stage cover photo from the webcam at each stage transition — the literal delivery of
  "it does the diary keeping FOR YOU", at zero taps.

---

## 2. C02 "The Verdict" — 71

**Verdict:** The best 60-second mental model in the entire set, attached to the worst delivery plan in the
entire set — in October I would get one excellent screen sitting on top of the 2023 app.

One glyph, one sentence, one bar. *"Dein Klima passt. 23 h 05 min der letzten 24 Stunden im Zielbereich.
Nichts zu tun."* I do not have to interpret anything. Three tiles below with value / goal / time-in-range.
A tab bar at the bottom. That is it, and it is right.

The scorecard sheet is the single best drill-down in the ten documents: in-range / too warm / too cold as
one stacked bar, day vs night split, longest excursion **as a duration, not an alarm count**, and —
this is the moment that would make me love the product — **the camera still from the peak of the
excursion, sitting next to the sentence describing it.** *"1 Std 40 Min zu warm, gestern 21:10–22:50"*
with a photo of the condensation on the plastic. That is evidence in the literal sense and it costs almost
nothing to build.

`offline` outranking `ok` — never a green tick over dead data — is the correct hard rule, and the hatched
tiles with `Stand 14:02` are the right drawing of it.

### Fatal flaws

- **The chart overhaul is not in v1.** §13 is explicit: "Explicitly NOT in v1: the chart rewrite, ECharts,
  plants, `JournalEntry`, feeding schedules, multi-user, the film strip." §15.4 admits the consequence:
  "the evidence is still fifteen translucent areas on hidden axes." The owner's own words were *"The Graph
  needs some real overhaul to look good."* This concept ships the sentence about the chart and not the
  chart. **In October, tapping "Belege" would take me from the nicest screen in the app to the ugliest.**
- **The diary — the owner's stated selling point — lands in February 2027, and feeding in April 2027.**
  I would buy this controller in October and get no watering log, no plants, no feed schedule for six
  months. Everything I would use daily is post-dated.
- **The verdict thresholds are invented (90 % / 70 % / 60 min / 180 min) and made user-editable to hide
  that.** §15.9 says so. "Behalt es im Auge" with no stated reason is precisely the unexplained judgement
  I distrust, and putting the numbers behind `Ziele → Beurteilung` does not help me — I will never open it.
- **§15.3: humidity will be amber every day for a month in a German winter and there is no humidifier.**
  A tile that is amber forever is a tile I stop reading, which destroys the one signal the concept exists
  to deliver.
- **§15.2 is a bait-and-switch and the author says so.** The thesis asks "Is my grow OK?" and the product
  answers "Is my climate on target?" A green tick over yellowing leaves is worse than no tick.
- "Belege" / "Evidence" as a tab label is a lawyer's word for a chart.

### Best parts to steal

- The verdict card grammar: glyph + plain sentence + one bar, no number in the headline, ever.
- The six-state ranked verdict with `offline` and `unknown` outranking `ok`, and `idle` pre-empting with
  the stage picker embedded in the card — the best onboarding recovery path in the set.
- **The excursion thumbnail.** Steal this into whichever concept wins; it is nearly free and it is the
  emotional payoff of owning the camera.
- The AGP scorecard sheet, whole: day/night split, longest excursion as a duration, coverage %, greyed
  below 80 %.
- `advisory` channels: a measure the device cannot change appears with *"Nur zur Info — dieses Gerät kann
  das nicht ändern"* and **does not drive the headline**. That is the correct, non-nagging answer for a
  heater-only tent.
- The `verdict.monitor.*` copy set and the 6th "Nur messen" stage card in onboarding.
- `<tc-freshness>` as one component with one rule used in seven places.

---

## 3. C06 "Glance Tiles" — 68

**Verdict:** The most instantly learnable layout on offer and a complete v1, undermined by the fact that
a wall of "now" widgets is boring by week two and that tiles appear on my screen without my asking.

I understand a grid of tiles in zero seconds; it is my phone's home screen. The **goal bar** is a genuinely
excellent invention: one horizontal track, setpoint in the middle, my alarm limits at the ends, a soft
band, a dot. Learn one picture, and it works on temperature, humidity, VPD, CO₂, RPM, EC and pH. That is
real design economy and no other concept has anything as reusable.

**A tile with no goal bar is a deliberate statement that nothing can act on this number.** That converts
the capability bug into a rendering rule instead of a helper function. Very clean.

Grey reserved exclusively for "I do not know", used for nothing else in the whole app, is the kind of rule
that works at arm's length without reading. Long-press to arrange, ✕ to hide, hidden drawer at the bottom
— three familiar gestures, no settings screen, no modes, and `no tile has settings` as a stated law.

And unlike C02 and C07, the journal, plants, feed regimes, EC panels, the chart rewrite and the scorecard
are **all in v1**.

### Fatal flaws

- **§15.1, in the author's own words: "a tile is a bad container for time, and growing is a process."**
  Everything that makes this product unlike AC Infinity — the fused timeline, goal-vs-actual over a week,
  time-in-range — is behind a tap. My first screen is twelve boxes of the present tense. After a week I
  would open it, see the same twelve boxes, and stop opening it.
- **The 60×22 px unlabelled, axis-less sparkline appears on every tile and is decoration.** §15.2 concedes
  it. It is the visual element I would see most often in the entire product and it means nothing.
- **Auto-provisioning is exactly the "surprising and unexplained" failure I test for.** A CO₂ tile appears
  by itself with a toast. §15.3 admits the evidence sources are the flakiest data in the codebase
  (`hardwareInfo` is free-form strings scraped from MQTT log lines) and that one wrong key produces a
  phantom tile. "Why is there a CO₂ tile? I don't have CO₂" is a support ticket that makes me distrust
  every other tile.
- **The drag-and-drop grid needs `@angular/cdk` added to an Angular 15 / Ionic 6 app and has to fight
  Ionic's own gesture layer.** §15.4 predicts it will be janky on mid-range Android and is the first thing
  cut — and cutting it removes the concept's entire answer to serving seven user types.
- **Two visual grammars for the same fact** (§15.6): a linear goal bar on the board, a dashed stepped
  setpoint plus a band on the chart. I have to learn both, and the good existing `value-display` gauge —
  which already draws a target line — is thrown away to avoid a third.
- **The Feed tile nags and the only way to stop it is a long-press** (§15.10). Gestures are discoverable
  by the people who least need them.
- **No answer for two tents** (§15.8) — device switcher and two boards.

### Best parts to steal

- **The goal bar.** One grammar for every measure, everywhere. This is the most transferable single element
  in all ten documents.
- "A tile with no goal bar means nothing can act on this number."
- Grey reserved exclusively for unknown.
- The four freshness states defined **per measure, not per device**, with `600 s` taken from the existing
  `ONLINE_TIMEOUT` so the app and server never disagree.
- `GET /data/board/:device_id` — one batched request with per-measure timestamps, targets and capability,
  replacing an N-request 10-second poll loop.
- The status strip's `✓ 3/3` chip: everything with a goal is in band, readable from the doorway.
- The `generic:<measure>` fallback tile: a device reporting something unknown is never invisible.
- The maintenance-mode and "connected but no readings" status lines — diagnostics nobody else surfaces.

---

## 4. C09 "Das Zelt" — 63

**Verdict:** The highest visual ceiling and the only screenshot in this bake-off I would show someone —
riding on an illustration commission that has no fallback, a home screen that displays fewer numbers than
today's, and a phone orientation in which it admits it does not exist.

A picture of my tent with my kit in it, the camera still as the interior, my numbers floating over the
leaves. With a camera this is not a cartoon, it is a photograph of my actual tent annotated with live
data. That is the only home screen here that is *emotionally* better than what AC Infinity ships, and
"tap the lamp to get the lamp" needs no explanation at any age or level of sobriety.

The epistemic argument is the strongest in the set: **an object that is not in the picture cannot have a
control.** That kills the fail-open capability bug structurally rather than by a helper function. The
`prop` rule — furnished-but-unverifiable objects are drawn flat and *never take a state colour* — is the
right call and correctly identified as the concept's load-bearing convention.

The time slider that scrubs the whole scene is delightful, and the observation that a grower will discover
the timelapse without ever learning there is a timelapse feature is exactly right.

### Fatal flaws

- **§15.1: the art is a hard dependency with no graceful degradation.** Five templates × two skins × light
  and dark × legible at 320 px. If the illustration is late or mediocre, "it ships as boxes, and boxes are
  worse than today's gauge grid". No other concept carries a non-engineering critical-path dependency.
- **§15.10, and it is my objection too: it might read as a toy.** €289 hardware, German market,
  *"Messen. Regeln. Ruhig schlafen."* A cartoon tent next to TrolMaster is a positioning risk, and the
  camera backdrop — the defence — is a paid upgrade I might not have bought.
- **§15.2: the picture is less information-dense than today's four gauges.** I open the app to read
  numbers. Two chips floating over a photo is *fewer* numbers than the 2×2 `value-display` grid that
  exists right now, each of which already has a value arc, a limit arc, a needle, an average line and a
  target line.
- **§15.6: landscape phone does not work**, and the answer is silently swapping to a list. A home screen
  with an orientation in which it does not exist is not finished.
- **§15.8: performance.** Inline SVG, live `<foreignObject>` chips, a photographic backdrop, and a scrub
  that re-renders the scene, in an Angular 15 app with default change detection, on the mid-range Android
  that is my phone. If scrubbing stutters, the best feature becomes the worst one.
- **Half my tent would be dead grey outlines.** I own a humidifier and an exhaust fan. Neither exists as a
  firmware role, so both are drawn flat and colourless with *"Just a note — Terp Control can't see this."*
  Honest, and a visually depressing home screen.
- **A second complete UI (the Contents list) has to be built, translated and kept in sync forever** for
  accessibility and reduced-motion. Every scene change is two changes.
- **§13 sizes v1 as "a large v1 for a small team over ~13 months"** — the hardware ships in about six
  weeks. That is the only concept in the set that appears to have the launch date wrong.

### Best parts to steal

- **The six-state object vocabulary** (live / stale / offline / absent / unverified-prop / discrepancy) and
  the rule that *only verified things get colour*. The prop rule is the best honesty mechanic here.
- The **discrepancy handling**: a ghost object for a socket the device reports but I haven't placed, a
  hollow object with `Antwortet nicht` + `Kurz testen` for one I placed that has gone silent, and — crucially
  — unknown firmware failing to *my declaration* rather than to "everything".
- `Kühler / Entfeuchter — dieselbe Steckdose` labelled by the current workmode. Nobody else names the
  double meaning on screen.
- **The PWM question nobody else noticed to ask:** the dimming output can drive a lamp *or* an exhaust fan,
  and `is_day` is inferred from it. Asking once at setup and permanently changing day/night shading when
  the answer is "Abluft" is the kind of detail that only appears when you have to draw the thing.
- The offline scene still rendering the last known state underneath, greyed — "what was it doing when it
  went dark" is the actual question — and removing today's dismissible overlay.
- Deferring the annotation rail's device row to off-by-default with one chip to enable it, instead of
  clustering count badges I cannot read at 12 px.
- The `Als Tabelle anzeigen` + CSV-with-actuator-state pair.
- Shipping a language switcher. It is four lines and its absence is embarrassing in a German product.

---

## 5. C01 "Loupe" — 61

**Verdict:** The best chart and the best data fusion in the set, wrapped in a navigation dogma that
deletes the one screen I would use most and replaces reading my own diary with a sideways scroll.

The lane stack is right: day/night at the top, small multiples with real axes, a stepped dashed setpoint,
a signed deviation fill, an outputs state lane, a two-row event rail, a film strip that is an axis. If I
turn on `Aktionen zeigen` and see the humidity spike after every watering, directly above the dehumidifier
row responding — that is genuinely something no app on the market shows me, and it needed no explanation.

The hatched no-data gap is the correct answer to staleness: I do not read a badge, I see a hole.
Lane-level capability (no CO₂ upgrade → no CO₂ lane, no CO₂ target, no CO₂ alarm preset) is clean, and
`nur Beobachtung` as a grey band label for a measure I can't act on is the right non-nagging tone.

### Fatal flaws

- **§14 non-goal #1: "Have a charts page or a diary page. Not as a fallback, not as a preference, not for
  power users."** My diary is now a horizontal strip at ~14 px per day. §15.1 concedes it: "every diary app
  in this market is a vertical feed, because reading a journal is a vertical act." Finding what I did in
  week 3 is a sideways fling. Everything else I read on a phone scrolls down.
- **Semantic zoom means the screen changes shape when I press a button.** `6 Std → Tag → Woche → Zyklus →
  Läufe` turns curves into daily columns into run bands. That is five different-looking screens behind one
  control, and nothing warns me before it happens. It is the most "surprising" interaction in the ten
  documents.
- **The mental model is "the app has one screen and a drawer".** I cannot tell a friend "it's in the diary
  tab", because there is no diary tab. Support, screenshots and the Telegram group all get harder.
- **`Regeln` (Rules) as the name of the drawer holding settings, targets, plants, feed plans, alarms,
  access and sharing.** That is a philosophy word, not a place. And §15.11 admits it: "the drawer is where
  I hid the mess" — the settings page underneath still `ngSwitch`es five device types and still saves
  everything in one full-page action that navigates away.
- **§15.8, in the author's own words: "the concept is weakest for the most common user"** and strongest for
  clubs, which are in v1.1.
- Nine lanes on a 390 px phone at ~104 px each means three visible at a time and a lot of vertical
  scrolling to see a picture that is supposed to be one picture.

### Best parts to steal

- The whole chart specification, essentially unchanged: small multiples, axes never hidden (three ticks
  and the unit in the panel title below 360 px), `sampling:'minmax'`, min/max envelope, stepped setpoint,
  signed deviation fill instead of fill-to-axis, day/night as its own top lane, outputs as a state
  timeline, two-row event rail, film strip on the shared scale.
- **The shared `TimeScale` primitive** — one `x(t)` injected into the canvas chart and every DOM lane so
  they cannot drift. That is the implementation detail that makes any fused-timeline design possible.
- The hatched no-data region and "no lane ever draws a line across a gap larger than 3× the sample
  interval".
- Lane-level capability derived from `hardwareInfo` + observed Influx fields, failing **closed**.
- The 2-tap capture: write first, refine after. `Gegossen ✓ 14:32 · Rückgängig` with MRU volume chips,
  no confirmation dialog anywhere.
- The `Mischreihenfolge` disclosure — an ordered checklist with pH last — collapsed by default.
- The failed-contactor diagnostic: the schedule ghost stays drawn behind a missing measured band.
- The desktop three-column layout. It is the marketing screenshot and phone-only competitors cannot answer
  it.

---

## 6. C05 "Thumb Journal" — 58

**Verdict:** A chat app I already know how to use, optimised for a verb I perform less often than the one
it demotes, and it deliberately trades data quality for speed and then hands me the cleanup as a chore.

One tap to log a watering is genuinely better than anything else here, and the familiarity of a
chronological thread with right-aligned "mine" bubbles is worth a lot — I need no instruction at all.

The machine-written half is the strongest delivery of the owner's *"it does the diary keeping FOR YOU"*
in the set: a morning card with yesterday's verdict, an excursion card carrying the still from the peak,
a Sunday week card I can share into Telegram with one tap. On a good day I would open this app, read one
line, and close it happy.

### Fatal flaws

- **§15.1, the author's own first objection: four of the seven types open this app to look at a number,
  and this design demotes numbers to a 72 px strip.** I check my tent far more often than I log work.
  The thing I do most is the thing that got the least screen.
- **Navigation moved to the top of a 6.7" phone so the thumb zone can hold capture** (§15.8), and the
  author concedes there is no data behind that trade. Every app I use puts navigation at the bottom.
- **One-tap logging degrades the data by construction** (§15.2), and the recovery mechanism is
  `/device/:id/tidy` — a dense desktop table where I sit on a Sunday filling in the volumes I didn't type.
  That is *work*, shipped as a feature, in v1.1. I will never open it, so my journal is permanently thin.
- **"Same as last time" ossifies mistakes** (§15.3): log 5 L once when I meant 0.5 L and 5 L is the silent
  default forever. Self-reinforcing, because the ring is built from my own history.
- **Accidental writes are guaranteed** (§15.4): five 56 px buttons at the bottom of a phone in a dark tent.
  Undo lasts six seconds; a pocket tap noticed three days later has no answer.
- **The daily machine card becomes wallpaper** (§15.12). A card that says "92 % in range" every morning is
  read for a week and scrolled past forever, inside the very thread that is supposed to be the product.
- Voice — announced as first-class in the philosophy — is v1.1 and has an unresolved privacy problem
  (§15.5): Web Speech sends audio to Google and Apple, in an EU-hosted cannabis product.
- 800–1,500 journal rows per grow (§15.9) in a product with no server-side log pagination today.

### Best parts to steal

- **The morning card and the excursion card.** *"📈 Gestern · 21 h 40 im Ziel (90 %) · 2 h 20 zu warm ·
  max 30,8 °C"* with `[▤ Foto 15:40]` and `[Kurve ansehen]`. That is the diary writing itself, and it is
  the reason to open the app.
- The four freshness states with capture staying **enabled while the device is offline** — device offline
  and "can I log that I watered" are unrelated, and every competitor conflates them.
- `PendingCaptureQueue` with a `clientId` idempotency key, and the honest statement of its limit (no
  service worker, so a cold start with no network still fails).
- Duplicate collapse: two identical entries within 10 minutes render as `×2` with a `Doch nur einmal` chip,
  stored as two rows and collapsed presentationally.
- **The All-Mix rule.** A feed schedule that can say *"Noch nicht düngen — All-Mix ist stark vorgedüngt.
  Ab Woche 4. [Trotzdem düngen]"* is modelling the domain; one that only knows ml/L is not. Medium + regime
  as one selectable pair, labelled the way growers say it out loud, is correct.
- `Übersprungen` as a first-class recorded outcome. A schedule you can only obey becomes a lie by week 3.
- The empty state: five soft arrows pointing at the capture bar, fading after the first capture. That is
  the entire tutorial and it is the right size.
- The onboarding question *"Was wächst da drin?"* with five chips that configure three subsystems at once,
  and **not asking the stage** — proposing it from the photoperiod the device is already running.

---

## 7. C10 "Durchgang" — 56

**Verdict:** A pile of excellent individual decisions attached to a thesis that pays me in month four,
and it says so on my home screen on day one.

The details here are the sharpest in the set. Humidity drawn as a **ceiling** (`max. 55`) rather than a
symmetric band, because the hardware can only push it one way, is the single most honest small decision in
all ten documents. `Lichtstunden/Tag` integrated from `out_light` instead of a fabricated DLI is the same
discipline. `Am selben Tag` — two photos, run 3 day 34 next to run 2 day 34, each picked at
mid-photoperiod so the lighting matches — is the most emotionally compelling picture anyone proposed.
And `Was war anders` diffs two runs' *decisions* from data the product already writes.

### Fatal flaws

- **The core value arrives at run 2, three to five months after I buy the hardware, and the home screen
  admits it.** *"Erster Durchgang. Ab Lauf 2 steht hier, wie es beim letzten Mal lief."* That is an IOU in
  the highest-value row of the first screen. §15.1 calls it "a retention feature masquerading as a
  product" and I agree. I will have decided whether I like this app within a week.
- **The comparison is confounded and the app cannot say so loudly enough** (§15.2). Different genetics,
  pot, lamp, medium, phenotype, season. `Was war anders` lists the four differences it knows and is silent
  about the sixteen it doesn't. I will conclude "the 20 °C nights did it", with their chart as my evidence,
  and be wrong.
- **The privacy stance deletes the number that makes comparison worth doing** (§15.3). "Was that run
  better" means yield to me. Here it means climate execution plus a five-star rating I type while stoned
  three days after harvest, with weights in `localStorage` that vanish with site data (§15.4).
- **Staggered plants and autoflowers break the run model** (§15.5) — one day-0 per device — which is
  precisely the owner's stated multi-plant case ("maybe even at different stages"). The chart axis, the
  stage bands and the entire Vergleich screen stay run-scoped.
- Day-of-run as the default x-axis (`T30`, `Blüte 8`) is a small but real reading tax when I want to know
  what happened on Tuesday.
- `RunDayStat` is a derived cache that can disagree with the chart and whose day boundary silently shifts
  by hours if the timezone is wrong (§15.7).
- `Auf Zusammenfassung reduzieren` is irreversible **and the default** (§15.8). I will lose the photo from
  day 41 through a setting I never consciously chose.

### Best parts to steal

- **Humidity as a ceiling, not a band.** Steal immediately, into every concept.
- **`Am selben Tag`** — two stills at the same day-of-run, both at mid-photoperiod. Two `<img>` tags.
- `Lichtstunden/Tag` instead of a fabricated DLI where there is no PPFD sensor.
- The one-line comparison row on the home screen (`Lauf 2 an Tag 34: 74 %`) — and replacing it, not hiding
  it, with an honest promise when there is nothing to compare.
- `Neuen Lauf starten → Wie letztes Mal`: one tap copies the stage plan, expected flower length, feed
  program and plant labels. The best "second onboarding" here.
- The day/night shading **hairline where schedule and measurement disagree** — the type-7 light owner
  discovering their timer has been firing 20 minutes late since March.
- The zero-plant default with `Alle` as the only chip: the word "Pflanze" appears exactly once, on a button
  I can ignore.
- `RunDayStat` as a ~200-byte per-day summary that survives aggressive raw-telemetry deletion.

---

## 8. C07 "Der Plan" — 54

**Verdict:** The best "what do I do today" card in the set, bolted to a mental model that taxes me every
time I want to nudge a number, in a plan whose chart overhaul is explicitly the first thing to be cut.

The `Jetzt` screen is genuinely well-composed: a stage ribbon with a "you are here" marker, **exactly one**
next-action card with a big `Erledigt`, climate tiles with targets, an outputs lane with durations, and a
three-row journal peek. Three answers above the fold with no scrolling. And "the chart has a future" —
the planned setpoint line, the flip date and the hollow planned feed markers drawn to the right of *jetzt* —
is an idea nobody else had and nobody in the market ships.

### Fatal flaws

- **The override sheet is a tax on the most common thing I do.** §15.1 owns it: "I just want to turn the
  temperature down" becomes three taps *and a decision* between `Nur jetzt` / `Für diese Phase` /
  `Für den ganzen Plan ab hier`. That is a modal question about an abstraction I never asked for, at the
  exact moment I am trying to do something simple.
- **Invented vocabulary I have to learn to use my controller.** Plan, Phase, Tor/Gate, grace period,
  drift. On my home screen: `Planschritt wartet auf den Controller`, `Der Controller läuft anders als der
  Plan` with `[Plan anpassen]` / `[Plan wiederherstellen]`. Each of those is a sentence I have to think
  about, and thinking is the thing I came here to avoid.
- **§13 puts the entire chart overhaul in Tier 2, "first to be cut", and then says plainly: "v1 is Tier 0 +
  Tier 1 and the chart ships in November".** The owner's explicit ask was the graph. This concept
  volunteers to not deliver it.
- **§15.3: a 42-day flowering stage with a ramp compiles into 14 recipe steps.** Two representations of the
  same thing, one generated, in a codebase with no test suite. If I open the expert recipe editor I see a
  list that does not resemble the plan I built.
- **§15.4: Type 1 — the largest segment — carries a Plan tab that says nothing.** The concept's centre of
  gravity is a feature that user declined at setup.
- **§15.2: one plan per device is honest about climate and dishonest about plants.** My veg plant and my
  flowering plant get one stage ribbon and one setpoint line, and the ribbon reads as simply wrong for one
  of them.
- §15.6: a chatty plan writes 8–12 log rows a day into a collection that has no pagination today.

### Best parts to steal

- **The plan band**: a proportional stage ribbon with a "you are here" marker and `Nächste Phase in 30
  Tagen`. It answers "where am I" better than a day counter.
- **The next-action card with a maximum of one item.** Ordering: overdue > due today > due soon > gate >
  nothing. `+2 weitere` expands in place. Explicitly refusing a task inbox on the home screen is correct.
- **`Später` snoozes to the next lights-on/lights-off**, not to a clock time. "Tomorrow" is meaningless in
  a 12/12 tent, and this is the only concept that noticed.
- **The chart with a future drawn on it** — planned setpoints, planned feeds as hollow markers, the planned
  harvest as a terminal marker, on a hatched background. Free to compute, and unique.
- **Drift detection**: comparing the echoed config against what the app pushed, and surfacing
  `Adopt into plan` / `Restore plan`. Today that divergence is silent.
- The inspectable compiler: for any stage, `Was der Controller bekommt` showing the exact 15 firmware-read
  keys and marking the ones the firmware ignores.
- The `Nur beobachten` / "Just watching, thanks" answer as a first-class permanent choice at onboarding
  that turns the whole plan machinery off and never asks again.
- The stage-transition, gate, task-done, override and week-summary rows as **automatically written journal
  entries with the numbers pre-filled**.

---

## 9. C08 "Shared Grow" — 50

**Verdict:** Contains the single most valuable sentence any of these concepts could say to me — and builds
its entire architecture on a button I will never press.

*"1 Ausreißer — und da war jemand im Zelt."* That is the answer I actually want when a number goes wrong.
Not "humidity was out of band for 1 h 40", which every other concept gives me, but **why**. Knowing that my
dehumidifier is fine and I am the problem is worth more to me than any chart in this bake-off.

`Seit deinem letzten Besuch` as the top card is a warm, human framing that works at n=1 (*"Du warst gestern
19:04–19:21 im Zelt"*), and the multi-device Grow means my old Terp light and my old fan finally share one
journal.

### Fatal flaws

- **The spine depends on a behaviour I will not perform.** §15.3 says it outright: "Nobody will press
  'start visit', so visits must be inferred." And §15.2 says the inference breaks for exactly me: a tent in
  a bedroom that I walk past eight times a day fragments into eight 4-minute brackets, "and the excursion
  attribution becomes *misleading* — which is worse than absent."
- **The `Grow` indirection costs me a concept and buys me nothing at n=1.** I now have a Grow, which is not
  my device, plus grow-scoped routes and a legacy alias layer over every share link and preset — which
  §15.6 identifies as the highest-probability way this concept silently breaks something that works today.
- **The adaptive 4th tab** (Futter / Pflanzen / Kamera / nothing) means the app is a different shape on
  different accounts. §15.11 concedes it: "tap the Futter tab" is advice half the Telegram group cannot
  follow. That is a learnability defect, not a personalisation feature.
- **Attribution in a household is socially loaded** (§15.4). "The app says you didn't water on Tuesday" is
  a fight the software started, and I did not buy a controller to get one.
- **§15.1: the October budget goes to the smallest segment.** The membership collection, the auth rewrite,
  ~20 owner-scoped queries, invite flows and role gating on every new screen — and my experience of all of
  it is a menu item I never tap.
- Club mode *pauses the camera* while somebody is in the tent — correct for privacy, and the wrong answer
  for the person whose whole reason for buying was pictures.

### Best parts to steal

- **Excursion-overlaps-visit.** *"3 of 4 humidity excursions this week overlapped a tent visit."* Steal
  this into the winning scorecard even if visits are only ever inferred from the sensor signature. It turns
  a verdict into an explanation.
- The handover card degrading to the climate half alone when there has been no visit, rather than
  disappearing.
- **`Kamerabild übernehmen`** — one tap attaches the webcam still nearest the entry's timestamp. No upload,
  no file picker, no 16 MB BSON risk, and the lazy user's journal ends up illustrated without them ever
  opening a camera app. This is the cheapest "it does the diary for you" mechanic in the set.
- `Zustand unbekannt` for outputs on an offline device. Outputs are *unknown*, not off, and today the app
  draws the last known socket states as fact two hours later.
- A grow spanning several devices — the old-light-plus-old-fan tent finally having one journal.
- **Refusing to fabricate:** no DLI without a light sensor, no averaged multi-device temperature, no bare
  ppm without its scale, no "off" for an offline device. That list belongs in whatever wins.
- The person-colour rule: member tints come from a low-chroma ramp that can never be confused with a
  measure hue. Hue belongs to physics.

---

## 10. C04 "Zweigang" — 38

**Verdict:** Two apps, and I am the person it cuts in half. Its own §16.2 names me: "The middle user is
served worst, and the middle is large. This is the concept's worst structural flaw." I agree, and it is
disqualifying.

I am not a stoner and I am not a techie. I want the simple screen most days and three things from the
expert one: the heater hysteresis, the grow report, and editing a timestamp I got wrong. Under Zweigang
each of those means switching shells, learning a second navigation paradigm (bottom tabs vs a side menu),
and remembering which of two apps owns the feature.

### Fatal flaws

- **The boundary tables in §5.6 and §6.5 are a printed list of things my app will not let me do.**
  "Grow report ❌ → button `Im Profi ansehen`". "Edit an event's timestamp ❌". "Per-plant volumes ❌".
  "Measured EC/pH ❌". "Mixing checklist ❌". Being told, inside the product, that I am using the beginner
  version and the real one is elsewhere is the most patronising thing in these ten documents.
- **This is the literal failure I test for**: does it degrade into an expert tool the moment I go one level
  deep? It does not degrade — it teleports me into a different application with different chrome.
- **The concept claims it removes "what kind of user are you?" from onboarding, and instead makes that
  question permanent.** Every time something is missing I have to ask "am I in the wrong gear?" — the exact
  question a mode-based design promises to eliminate.
- **§16.5: the "three screens" claim is already "three screens plus five sheets" on day one**, because
  alerts had to be smuggled into the Simple account sheet.
- **§16.4: Einfach can lie by omission.** The min/max envelope only renders when an excursion crosses the
  band, so a heater short-cycling ±0.4 °C inside a ±1.5 °C band is invisible to me — and that is exactly
  the failure I would want to see.
- **§16.3: ~120 extra i18n keys × 2 languages, permanently**, in a bundle whose de/en pair currently drifts
  by two keys, plus a 36-cell test matrix on a codebase whose CI never runs the tests.
- **The gear is per-user, not per-device** (§16.7), so my simple tent and my fridge build have to share one
  cockpit.

### Best parts to steal

- The Einfach `Jetzt` screen itself is good and could be lifted whole into a single-shell design: one ring
  (always the measure the device can most directly *control*), exactly two secondary tiles, one line of
  what is happening, exactly two primary buttons, a due card, a camera card, and no horizontal scrolling.
  The stated non-negotiables ("never two rings, never three buttons, no number without a target or the
  explicit absence of one") are good design law.
- **One-tap `[ Erledigt ]` on the due-feed card writing a complete nine-field entry**, with long-press
  opening the same sheet prefilled for the grower who deviated. Deviation as the normal case, not the error
  case, and `followedSchedule` flipping to false automatically.
- The **`Heute | vor 7 Tagen`** two-frame card with one Share button. That is the entire monitor-plus-camera
  product for someone who controls nothing.
- The stale state removing the *verdict* while keeping the *number*: "a verdict on a four-minute-old number
  is a lie", but the number is still the best we know.
- **Absent hardware renders nothing at all** — no `—`, no greyed placeholder for a CO₂ sensor I did not buy.
- The light-only treatment: a 24-hour photoperiod bar as the hero element, day/night shading from
  *measured* output so a failed contactor is a missing band, and DLI. A type-7 lamp owner gains more from
  this than a controller owner does.
- Naming the ambiguity: `Entfeuchter / Kühler` on the chart, and `Ohne Funktion in dieser Firmware` on
  controls the firmware ignores — with those controls removed from the simple surface entirely.

---

## What nobody got right

These are needs of mine that **not one** of the ten concepts met. This is the most valuable part of this
document.

### 1. Nobody designed the notification — the surface that actually decides whether I open the app

All ten concepts design the home screen. None designs the thing that gets me to the home screen. I am at
work. My tent is at home. The most important pixels in this product are the ones on my lock screen, and
there is **no push notification anywhere in any concept** — several explicitly park alerts at "email +
webhook" because there is no service worker and no native app. AC Infinity pushes. Spider Farmer users are
on record *begging* for any push at all. A grow controller that cannot reach my phone loses to one that
can, however beautiful its charts are. Nobody wrote the notification copy, nobody designed the
consolidation ("3 alerts" not 3 alerts), nobody designed snooze or acknowledge on the phone, and nobody
costed the web-push work. This is the largest unclaimed gap in the set.

### 2. Nobody made the app work where I use it — on the tent floor, with no signal

Ten out of ten explicitly refuse a service worker for v1. C03 §15.7 and C05 §11 both name the problem and
then defer it. The two-tap watering flow that every concept is proud of runs at the exact moment my phone
has the worst connectivity in the house. A cold start with no network shows the browser's offline page.
"Loss-resistant, not offline-capable" is a distinction I will experience as "the app is broken".

### 3. Nobody tells me what to *do* about it

Every concept, at varying levels of elegance, tells me a number was out of range. C02 does it best:
*"Feuchte war 3 Std 10 Min außerhalb. Am längsten 1 Std 20 Min, gestern Nacht."* And then it stops. Okay —
**and?** I am not a horticulturist. The product knows my setpoints, my socket roles, my photoperiod, my
outputs' duty cycles and my stage. From that it can say deterministically, with no AI: *"Your dehumidifier
ran 94 % of last night and humidity still sat 8 % above target — it cannot keep up. Try lowering the night
temperature by 1 °C, or run the lights at night."* Every concept refuses this category outright ("no AI
recommendations", "the app states what happened and what the target was") for good reasons about
hallucination and liability — but they refuse rule-based, explainable, hard-coded advice too, and that is
the difference between a dashboard and an assistant. The word the owner used was *"Ruhig schlafen"*, which
is a promise about not having to work it out myself.

### 4. Nobody costed the visual design, and the owner explicitly asked for "look good"

Nine of ten documents are information-architecture specifications with ASCII wireframes. There is not one
type scale, not one spacing rhythm, not one motion specification, not one empty-state illustration, not one
statement of what makes this look like a 2026 product instead of a well-organised 2019 Ionic app. `ion-card`
is used 86 times today; every concept builds more of them. Ionic 6 defaults plus Inter plus a blue-tinted
step scale will read as competent and dated no matter how good the structure is, and "the chart needs to
look good" cannot be satisfied by an ECharts migration alone. C09 is the only one that treats visual craft
as a real deliverable — and it treats it as its single biggest risk, which is the correct instinct that
everyone else avoided by not attempting it.

### 5. Nobody designed hour one, when the chart is empty

Every mock in every document shows a full week of beautiful curves and a populated film strip. What I
actually see when I claim my brand-new controller is twenty minutes of data, one thumbnail, and no
history. That is the moment I am most likely to decide this app is not worth it. C01 and C09 sketch an
empty state; nobody designs the *first 48 hours* as a deliberate arc — what fills in, when, what the app
says while it waits, and how it makes twenty minutes of data feel like something rather than a broken
screen. The screenshot that sells and the screen I get on day one are different screens, and only one of
them was designed.

### 6. Nobody let me see two tents at once

I have a veg tent and a flower tent. "Are both of them OK right now?" is a question I ask every single day,
and every concept answers it with a device switcher and two identical screens. C06 names the gap and
declines it (§15.8). C09 offers a shelf of thumbnails and admits it stops working past eight. C02's
`/list` verdict board is the closest anyone gets — one line per device — and it is described in a
paragraph, for clubs, not for me. A two-tent household is not an edge case; it is the natural second
purchase, and it is the one the business should want to design for.

### 7. Nobody mentioned electricity

My lamp, heater and dehumidifier are the biggest single line on my power bill, and the controller records
exactly how many seconds each socket was on. C10 already persists `outputSeconds` per day. "Your kit ran
214 kWh this run, roughly €68 — the dehumidifier is 40 % of it" is arithmetic on data that already exists,
it needs one number from me (my per-kWh price), and in Germany in 2026 it is a headline feature. Zero of
ten concepts mention cost or energy even once.

### 8. Nobody gave me a "why is it doing that?" affordance

The heater is on and the temperature is already above target. Why? Because the recipe stepped, because
someone overrode a setpoint, because `out_dehumidifier` is acting as the cooler in this workmode, because
maintenance mode is on, because the socket lost wifi. C07's drift detection is the only thing that comes
close, and it only covers one of those cases. Unexplained machine behaviour is the fastest way to make me
distrust every other number in the app, and not one concept puts a "why" on an output.

---

## The dealbreaker test

**Hand my unlocked mid-range Android, in dark mode, to a friend who has never seen the app, on day 3 of a
grow whose device dropped offline for two hours overnight. Say nothing. Within 60 seconds and without
asking me a question, they must be able to (a) tell me whether the tent is OK right now, (b) tell me
whether the numbers they are looking at are current or old, and (c) log a watering. Then, a week later,
find that watering again without being told where to look.**

Any concept that requires me to explain a metaphor, a mode, a zoom regime, a plan, a visit or a run before
that friend can do those four things has failed. And if step (c) or step (d) needs a working internet
connection standing next to the tent, it has failed twice.
