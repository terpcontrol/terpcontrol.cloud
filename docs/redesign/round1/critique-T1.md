# Critique — User Type 1: the lazy, MONITORING-ONLY user

**Who I am.** I bought a €289 box to record numbers and look at them later. I control nothing — no
sockets paired, no PWM lamp, no CO₂ upgrade. I have no camera. I will not name a plant, pick a stage,
follow a schedule, start a run, furnish a tent, or declare a goal. I open the app maybe once a week and
what I want is: *what happened while I wasn't looking?*

**How I judge.** Three questions, in this order.

1. Does it work AT ALL if I never set anything up?
2. Is the default state — zero configuration, zero taps — actually useful?
3. Am I taxed by machinery aimed at somebody else?

I am not a balanced committee. A concept that is brilliant for a club and mediocre for me scores badly.

---

## The scoreboard

| Rank | Concept | Score |
| --- | --- | --- |
| 1 | C02 The Verdict | 84 |
| 2 | C06 Glance Tiles | 79 |
| 3 | C01 Loupe | 77 |
| 4 | C04 Zweigang | 64 |
| 5 | C05 Thumb Journal | 58 |
| 6 | C03 Beet | 52 |
| 7 | C10 Durchgang | 50 |
| 8 | C08 Shared Grow | 47 |
| 9 | C07 Der Plan | 45 |
| 10 | C09 The Tent | 35 |

---

## 1. C02 — "The Verdict" — 84

**Verdict:** The only concept that hands me a sentence instead of a chart to interpret, and the only one
whose author correctly identified me as the customer — but it ships that sentence sitting on top of the
same fifteen-hidden-axis chart I already hate, for the entire launch window.

This is the closest thing here to a product built for a person who opens an app once a week. The
scorecard sheet is what I actually want and nobody else built it: % in / above / below, **split day vs
night**, the longest excursion reported **as a duration** with its peak value and timestamp, and — the
detail that shows somebody thought — **data coverage %** with the whole card greyed below 80 %. That
last one is the difference between a number and a lie. `offline` outranking `ok` in the verdict ranking
is the single most correct design decision in all ten documents: it will never show me a green tick over
dead data.

Onboarding is three taps, only step 2 is mandatory, and step 2 has a sixth "Nur messen" card that writes
a `GrowGoal` and pushes **nothing** to the device — so a controller with no sockets at all still gets
judged. The plants question has "ist mir egal" as a *full-width, visually equal option, not a link*. I
am never asked again. That is the correct answer to "am I taxed".

**Fatal flaws from where I sit.**

- **§13, stated by the author: the chart rewrite is NOT in v1.** ECharts, small multiples, real axes,
  day/night shading, the annotation rail — all December 2026 at the earliest. So the "evidence you drill
  into" that the whole philosophy points at is, in October, still N overlapping translucent areas with
  the axis labels programmatically suppressed on my phone. My primary artefact — a week of temperature I
  can actually read — is the thing that ships last. §15.4 admits this. It is the single biggest reason
  this is 84 and not 92.
- **The verdict needs a goal and my goals are the app's guesses.** §15.1 owns it: the band chain ends at
  `GROW_STAGE_PRESETS`, five rows with **no cited source anywhere in the repo**. I picked "Blüte" because
  it was the third card. A confident green tick against a band I did not choose manufactures confidence,
  and making the thresholds (90 % / 70 % / 60 min / 180 min — all invented, §15.9) user-editable is not a
  fix, it is a place to put the blame.
- **Four tabs, and two of them are for other people.** Journal and Ziele are permanent chrome I will
  never open. Ziele on a device that controls nothing is close to an insult.
- **§15.7 is real: the one screen whose job is a verdict handles "I don't know" worst.** When my router
  dies for six hours the well-designed offline card is still a blank where the product's value should be.

**Best parts worth stealing.**

- The scorecard sheet, whole: in/above/below, day vs night split, longest excursion as a **duration**,
  MAD from setpoint, and `Abdeckung 99,4 % · aus 17 214 Rohmessungen · 5-Sek-Raster` printed on screen.
- `offline` and `unknown` outranking `ok` in a fixed six-state verdict ladder.
- Raw-sample computation as a hard rule, with the trap named (`aggregateWindow(fn:mean)` destroys the
  excursions the metric exists to count and the error is invisible by eye).
- The **advisory channel** rule: a measure I cannot act on appears with its numbers and *does not drive
  the headline*. This is the cleanest solution to capability honesty in the whole set.
- "ist mir egal" as a full-width, equal-weight option.
- The excursion thumbnail — useless to me with no camera, but the cheapest big win in the set for type 2.

---

## 2. C06 — "Glance Tiles" — 79

**Verdict:** The only concept where the number of questions I am asked is genuinely, structurally zero —
the board assembles itself out of evidence and I never touch it — but it spends its whole home screen on
"now" and puts everything I open the app for behind a tap.

The evidence rule (`showWhen(evidence)`) is the best mechanism in the ten documents for my problem. I
never pick tiles; tiles exist because a measure produced a point or the firmware reported a socket. No
plants tile, no feed tile, no goal bars — not greyed, **absent**. `Nur Messung` chips instead of targets
I cannot reach. That is what "not taxed" actually looks like, implemented rather than promised.

The freshness model is the most rigorous of the ten: four states **per measure, never per device**, with
`600 s` taken from the server's own `ONLINE_TIMEOUT` so board and server can never disagree, and one rule
I can learn in a second — **grey means "I do not know", and grey is used for nothing else**. The offline
board dims once as a container so it reads as one event rather than twelve broken widgets. And
`GET /data/board/:device_id` returning `{v, t}` per measure plus `serverTime` is the correct fix for an
endpoint that currently returns a bare float or `NaN` with no timestamp at all.

Unlike C02, the chart rewrite is **in v1**.

**Fatal flaws from where I sit.**

- **A tile is a bad container for time, and I am a time customer.** The author says so himself (§15.1):
  every differentiating thing — time-in-range, goal-vs-actual over a week, the fused timeline — lives
  behind a tap, and what sits on my home screen instead is a **60×22 px unlabelled, axis-less sparkline**,
  which is decoration by the dossier's own standard (§15.2 admits it is the weakest element and it is on
  every tile).
- **I open this app weekly. The board is a "right now" instrument.** Two taps and a scroll to reach the
  week I actually came for, every single time, forever.
- **Auto-provisioning cuts both ways.** §15.3 is right: `hardwareInfo` is a free-form
  `Record<string,string>` filled from MQTT log lines and "has produced a point in 48 h" is a query that
  can flap. A phantom tile appearing on its own is worse than a checkbox list, and I have no mental model
  to debug it with.
- **The drag-and-drop grid is the most likely thing to be cut** (§15.4 — needs `@angular/cdk`, which the
  repo does not have, fighting Ionic's gesture layer on mid-range Android). If it goes, the concept's
  answer to seven user types degrades to "we picked a good default order".
- **§15.5 is the flaw that will actually kill it in the room:** honest freshness makes the product look
  worse and demo badly, and the moment someone relaxes the 60-second `live` threshold to "look fine unless
  clearly dead", I lose the only feature I unambiguously gained.

**Best parts worth stealing.**

- `showWhen(evidence)` — tiles exist because evidence exists. No configuration screen, ever.
- Freshness per *measure*, four states, with **grey reserved exclusively for "unknown"**.
- The batched `/data/board` endpoint with a per-measure timestamp and an authoritative `serverTime` — this
  should be in every concept and is in almost none.
- `generic:<m>` — a measure the catalogue does not recognise still gets a tile, a value and a sparkline
  instead of being invisible. The current app gets this exactly backwards.
- The container-level offline dim instead of twelve individually broken widgets.
- "A tile with no goal bar is making a deliberate statement: nothing here can act on this number."

---

## 3. C01 — "Loupe" — 77

**Verdict:** The best home screen in the set for a person who came to look at a record — the record *is*
the home, in v1, with axes — and then it declines to tell me a single thing about what it is showing me.

Structurally this is closest to what I want. **Zero questions to first data.** I claim, I land on the
timeline, the first sample draws itself, and capability is established *by observation* — lanes appear as
evidence arrives, each announced as a machine event on the rail. The one question ("Was wächst da?") is a
non-blocking card with `Später` and, if I tap `Nur beobachten`, I am **never asked again**. The zero-plant
invariant is stated as a hard rule: *"A user who does not care about plants never sees the word
Pflanze."* Enforced, not aspired to.

And it fixes the things that make the current chart unusable for me on a phone, in v1: real axes that are
**never hidden** (three ticks below 360 px, unit in the lane title), two-finger pan/zoom instead of
Ctrl-and-Shift, a pinned scrub header instead of a tooltip nothing can hover, min/max envelopes so a
bang-bang controller stops being represented by a lying mean line, and the single best staleness answer
in the ten: **the timeline physically stops where the data stopped and the gap is hatched and labelled
`Keine Daten`.** I do not read a badge; I see a hole. Nothing is ever extrapolated across a gap.

**Fatal flaws from where I sit.**

- **`Nur beobachten` turns off the judgement along with the nagging.** §10.4: monitor intent means "no
  target bands, no stage picker, no plants, no grow assistant". But the Day Sheet's headline content is
  `Zeit im Zielband` — which needs a band. So the one screen that would tell me *what happened* is mostly
  empty for exactly the user who chose the honest option. The concept punishes me for answering
  truthfully.
- **The author's own §15.8 is the review:** *"The concept is weakest for the most common user… he gets a
  much better chart and an honest liveness model, which is genuinely valuable, but he does not get the
  thing that makes this concept distinctive."* Two of the fusion's three terms are empty on my device
  forever. Cycle zoom is 90 columns of climate above a permanently blank human row.
- **§15.3, the performance bet, lands hardest on me.** ECharts canvas + DOM film strip + DOM event rail +
  DOM output lanes + a 10-second live refresh all on one screen, with **no firebreak** — today a slow
  chart at least does not slow the diary. On a cheap Android this is the riskiest screen in the product
  and I am the user least willing to wait for it.
- **§15.4: canvas/DOM alignment via a shared `TimeScale`** across `dataZoom`, rotation, lane collapse,
  font loading and Ionic's layout passes. Sub-pixel drift means the picture lies about when something
  happened, which is worse than not drawing it.
- **A FAB labelled `Notieren` permanently on my screen** for a person who will never notate anything, and
  a drawer containing Pflanzen and Düngeplan.
- **v1 is A through I** — nine workstreams including a library migration, a new event collection, a plant
  model, a backfill migration, a feed engine and a nightly rollup job — on a repo with 38 `it()` blocks
  and a CI that never runs them. §15.9: once `/charts` and `/diary` are redirects there is no fallback.

**Best parts worth stealing.**

- **Capability by observation, not interrogation** — lanes appear as evidence arrives, `Steckdose erkannt:
  Heizung` posted as a machine event. Zero questions, and it fails **closed** to monitoring when
  `hardwareInfo.sockets` is absent.
- **The hatched, labelled no-data gap.** No line is ever drawn across a gap larger than 3× the sample
  interval. This is the right way to fix P0 #5 — structurally, not with a badge.
- **`nur Beobachtung`**: a measure with a sensor and no actuator gets its band drawn **in grey** with that
  label, and the deviation warning is suppressed. I am never nagged about something I cannot fix.
- Never hiding axis labels; three ticks and the unit in the title below 360 px.
- The `Entfeuchter / Kühler` label with a `ⓘ` — naming the one-socket-two-meanings ambiguity instead of
  hiding it.
- The Day Sheet's `Datenabdeckung 99 %` and `Längste Abweichung 2 Std 40 Min · Feuchte · ab 02:10`.

---

## 4. C04 — "Zweigang" — 64

**Verdict:** Its `Einfach` gear accidentally builds a decent monitoring product — one panel, one sentence,
swipe between measures, no interval picker — and then charges the whole project a two-shell tax that buys
me nothing whatsoever.

The `Verlauf` screen in Einfach is genuinely well judged for me: three range chips at 64 px, **no interval
control at all** (which also kills the `3y × 5s` self-DoS from my side of the app), one stacked scorecard
bar, one panel with a dashed stepped setpoint and night shading, an outputs lane, and swipe-between-
measures instead of a fifteen-checkbox matrix. Long-press gives a pinned scrubbing header. That is a
correct mobile chart. The `Jetzt` screen for a monitor-only device (§3.4) shrinks honestly: a ring with
**no verdict**, the words `Nur Messen`, two tiles, and the line *"Keine Steuerung — dieses Gerät misst
nur."* No targets, no output strip, no due card. Good.

The four-state liveness model is the most carefully reasoned of the ten on one specific point: at `stale`
the **verdict text is removed while the number stays**, because "a verdict on a four-minute-old number is
a lie" but the number is still the best we know. And at `offline` the outputs strip is replaced wholesale
by `Zustand unbekannt` — *"We never draw a heater as 'off' when we cannot hear the device."*

**Fatal flaws from where I sit.**

- **The entire premise is a tax I pay and never use.** Two shells, ~120 extra i18n keys × 2 languages, a
  36-cell test matrix (§13, §16.3, §16.6) on a codebase with a red suite and a CI that never runs it —
  all so a techie can have a dense alarm editor. I get one button at the bottom of my home screen labelled
  `Profi-Ansicht öffnen` that I will never press, and a permanent risk that my simple app is the one that
  gets deprioritised when the schedule slips.
- **§16.4 is a defect, not a weakness: the Simple gear can lie by omission.** The min/max envelope renders
  *only when an excursion crosses the band* — a heuristic with false negatives. A controller cycling
  ±0.4 °C inside a ±1.5 °C band is invisible to me, and that is exactly the signal that hardware is
  short-cycling itself to death. My concept-of-record is a chart, and this chart is allowed to smooth
  reality when it judges the smoothing harmless.
- **One of my three tabs is `Tagebuch`.** 33 % of my navigation is a journal I will never write in.
- **§16.10 is honest and damning:** "three screens" is already three screens plus five sheets on day one,
  and nothing in the document defends the line.
- The gear is per-user, not per-device (§16.7), and my alerts live in an account *sheet* that was a
  scope addition forced by the realisation that a simple-gear user would otherwise never get a
  notification at all (§16.5).

**Best parts worth stealing.**

- Removing the **verdict** but keeping the **number** at `stale`. Precisely right.
- `Zustand unbekannt` for outputs when the device cannot be heard.
- A history screen with **no interval control** — the server picks the window from the range.
- Swipe-between-measures with page dots, replacing a 15-measure checkbox matrix.
- Absent hardware renders **nothing at all** — no `—`, no `-1`, no greyed placeholder for a CO₂ sensor I
  did not buy.
- The `light`-device row: a 24 h photoperiod bar as the hero and day/night shading from *measured* output,
  so a failed contactor is a **missing band**. Type 7 gains more from this redesign than a controller
  owner does, which is the right way to serve a non-focus group.

---

## 5. C05 — "Thumb Journal" — 58

**Verdict:** It claims I am its best-served type and it is half right — the machine-written daily card is
genuinely the "it does the diary keeping FOR YOU" promise delivered — but it demotes every number I came
for into a 72 px strip above a chat thread and hands the entire thumb zone to five capture buttons I will
never touch.

Credit where due. The auto-written entries are the best answer in the set to "what happened while I
wasn't looking": every morning at 07:00 the thread gains `📈 Gestern · 22 h 10 im Ziel (92 %) · 2 h 20 zu
warm · max 30,8 °C` with a link into the chart; excursions get their own card; offline periods are
entries; and on Sunday a week card appears with aggregates and a share button. For a person who opens the
app weekly, a chronological stack of *"here is what you missed"* is a defensible information
architecture, and the onboarding's `Nur messen` chip correctly strips 💧 and 🧪 out of the Thumb Bar and
turns off every reminder.

**Fatal flaws from where I sit.**

- **§15.1, written by the author, is my whole review:** *"The chat metaphor fights analysis, and four of
  the seven types open the app to analyse… If the owner's actual belief is that people open this app to
  check their tent rather than to record their work, this concept is optimising the wrong verb."* I am
  one of those four. My numbers are a 72 px strip; everything else is prose bubbles.
- **§15.12: the daily card becomes wallpaper.** A card that says "92 % in range" every morning is read for
  a week and then scrolled past forever, and the mitigation ("suppress on days that look like yesterday")
  is easy to describe and easy to get wrong.
- **Navigation moved to the top** (§15.8) so capture could own the thumb zone — an explicit bet, with the
  author conceding he has no data. For me the bet is simply lost: I navigate and never capture.
- **Row explosion** (§15.9): 800–1,500 journal rows per grow where today there are 20, on an API with
  **no server-side log pagination at all today**. I am the user least likely to tolerate a slow list.
- **§15.10: the migration is the riskiest ship in v1** — moving diary rows out of `DeviceLog`, minting
  plants from a browser algorithm that forks on rename, while old share links keep resolving, against
  38 `it()` blocks. A data-integrity project wearing a UI project's clothes, and I get no upside from it.

**Best parts worth stealing.**

- **The machine writes the entries.** Daily verdict card, excursion card with the peak still, offline
  periods, the Sunday week card. This is the owner's stated selling point implemented as a mechanism.
- **Offline does not disable capture**, and the thread says so: *"Gerät offline — deine Einträge werden
  trotzdem gespeichert."* Every competitor conflates device-offline with app-broken.
- Tapping any entry expands an inline ±6 h mini-chart chosen by entry kind — *"Was das Zelt dazu gemacht
  hat"*. Fusion without ever opening a chart.
- The empty state: *"Terp schreibt ab morgen jeden Tag selbst rein."* That is the product promise in one
  sentence, on the screen where it matters.
- The idempotency `clientId` on queued captures so a retry can never double-post.

---

## 6. C03 — "Beet" — 52

**Verdict:** It puts a plant between a man and his thermometer, admits it in §15.1, and then argues the
frame is worth it — but the frame is worth nothing to me and the verdict it buys grades me against a
stage preset I picked at random on day one.

The engineering to avoid taxing me is careful and I will credit it: the implicit plant is created
**server-side at claim time with zero taps**, and while `plants.length === 1 && isImplicit` the word
"Pflanze" never appears anywhere — no badge, no dot, no "complete your setup", `+ Pflanze hinzufügen` is
`fill="clear"`, small, and below the fold. Five explicit rules instead of good intentions. The sticky tent
strip keeps my numbers visible at all times. Type 3 is served genuinely well.

**Fatal flaws from where I sit.**

- **§15.1 is the whole problem and the author names it:** today `/list` with one device renders that
  device's dashboard *directly*. C03 inserts a card between me and my numbers. The tent strip blunts it;
  the frame is still there, and the frame is a noun I rejected.
- **The verdict is `gegenüber Richtwert Sämling` — a band I chose by tapping the first card in a grid.**
  §15.6 owns this: grading a user against a band they never chose is how you generate "why does the app
  say I'm failing" tickets, and for a monitoring-only device the advisory band is *always* the default
  case, not the fallback.
- **The onboarding question is mandatory in practice.** Step 3 slides a stage picker in and step 4 asks
  about naming. Cheap, but two questions more than C01 or C06 ask me.
- **v1 ships the chart on Highcharts** (§4.4). Defensible on schedule grounds, and it means my one
  unambiguous win — a readable chart — arrives on a proprietary library the repo may not be licensed for,
  with a migration hanging over it. §15.10 admits the decision could be wrong in both directions.
- **Four new collections, no migration tooling, no test baseline, six weeks** (§15.3), and a backfill that
  will produce *"some wrong-looking history"* (§15.5) — a support category this concept creates and C01 and
  C02 do not. I get zero benefit from any of it.
- `PLANT_CAPABLE = ['controller', 'fridge', 'fridge2']` means my controller is plant-capable and the whole
  Pflanzen tab exists for me by definition, even though I will never use it.

**Best parts worth stealing.**

- **The five explicit rules for not taxing the plant-indifferent user.** Whether or not the plant frame is
  right, this is the most rigorous statement in the set of *how* an entity stays invisible.
- **Naming the band source on every verdict** — `gegenüber deinen Alarmgrenzen` / `deinen Zielwerten` /
  `Richtwert Blüte` — in a fixed priority order. If you are going to grade me, tell me against what.
- The offline row that keeps capture buttons enabled and desaturates the photo instead of blocking.
- The equipment-attachment idea (`equipmentDeviceIds`): attaching an old plug adds a **named lane** to a
  chart — the first time a user's smart plug has ever had a name in a graph.
- The verdict hidden entirely (not shown as "0 %") when there are no samples yet.

---

## 7. C10 — "Durchgang" — 50

**Verdict:** A retention feature masquerading as a product — its own §15.1 says so — and its day-one
experience for me is a home screen dominated by a run I did not want to start and a comparison row that
reads "Erster Durchgang" for three to five months.

There is real craft here that I benefit from incidentally: the humidity goal drawn as a **ceiling**
(`max. 55`) rather than a symmetric band, because the hardware can only push in one direction, is the
sharpest single piece of capability honesty in the ten documents. The four freshness states are well
specified, offline **hides goal rows** because a target is meaningless when nothing is regulating, and
`GET /run/:run_id/stats.json` including actuator state is an export no vendor in this market offers.

**Fatal flaws from where I sit.**

- **The core value arrives at run 2.** §15.1: *"Every other concept in this set delivers on day one. C10's
  day-one experience is 'a chart with axes and a good watering button', and its headline row says 'Erster
  Durchgang' — an IOU."* I open the app four times in three months. I will churn long before run 2.
- **A permanently empty fourth tab.** `Vergleich` is 25 % of my navigation and it is a placeholder.
- **The root object is a thing I have to declare.** Onboarding asks `Was läuft gerade?` in run vocabulary;
  my home screen's top block is `BLÜTE · TAG 34 / Lauf 3 / Tag 34 von ~63`. I do not have a run. I have a
  sensor on a shelf.
- **Its own Type 1 walkthrough concedes defeat:** `Heute im Zielbereich — nicht bewertbar (keine Ziele
  gesetzt)`. So the one row that is the concept's thesis renders as an error message for me, twice over.
- **§15.8 is actively hostile to my stated purpose.** `Auf Zusammenfassung reduzieren` is **irreversible
  and it is the default**. I bought this box to *"record the values and look at them, after some time"* —
  and the concept's default behaviour is to throw the values away and keep a summary. A 30-day grace
  period is not consent.
- **§15.5:** staggered plants break the run model, and the chart x-axis, stage bands and the whole
  Vergleich screen stay run-scoped.

**Best parts worth stealing.**

- **Humidity as a ceiling, not a band.** "Drawing a symmetric band around a number the device can only
  approach from one side is a lie about the machine."
- **Goal rows hidden entirely when offline** — a target is meaningless when nothing is regulating.
- Excluding an unactionable measure from the in-range verdict, so the percentage is *about the thing I
  actually control* rather than diluted by a target that cannot be hit.
- `Diese Woche vs. letzte Woche` as the no-run generalisation — the only week-over-week framing in the set,
  and (ironically) more useful to me than the run comparison it is a fallback for.
- The two x-rulers (day-of-run / day-of-stage / wall-clock) stacked rather than swapped.
- The drying-run comparison: real value delivered to type 7 using machinery built for someone else.

---

## 8. C08 — "Shared Grow" — 47

**Verdict:** It invents exactly the primitive I needed — *"since your last visit"* — and then spends it on
other people visiting the tent rather than on me visiting the app, and pays for it with an authorisation
rewrite that is the most expensive line item in the whole redesign and worth precisely nothing to me.

The solo degradation is thoughtfully done: three tabs and no fourth when I have no plants, no feed and no
camera; `Leute` never a tab until there are two members; the handover card collapsing to the climate half
and reading `Die letzten 3 Tage · 88 % im Zielbereich`. That last string is genuinely the first time this
product would tell me whether my numbers were *good*, and it costs me zero configuration. The five-screen
onboarding is all-skippable with weighted defaults.

**Fatal flaws from where I sit.**

- **§15.1, the author's own first weakness:** types 1–5 are solo growers, type 6 is the only one that
  inherently needs multi-user, and the membership rewrite (`auth.middleware.ts:172` and `:207`, ~20
  owner-scoped queries, invite flows, role gating on every new screen) is the single most expensive item
  in the redesign. My experience of it is a menu entry I never tap.
- **`[ Ich war im Zelt ]` is a permanent 48 px button on my home screen.** I am never in the tent. It is
  there so that a primitive I do not use can accrue data I do not generate.
- **The excursion-attribution payoff is structurally void for me.** "3 of 4 humidity excursions overlapped
  a tent visit" requires visits. Mine is a box on a shelf.
- **§15.6 is the highest-probability way this damages something that already works:** grow-centric routing
  with an alias layer over a query vocabulary duplicated in five places, no test baseline, and share links
  and chart presets storing frozen `/device/:id/...?query` strings as user data.
- **§15.11:** adaptive 3-vs-4-tab navigation means the product looks different on different accounts, so
  every piece of community advice ("tap the Futter tab") is unfollowable by half its readers.
- Five onboarding screens is the most of any concept here, even if each is one tap.

**Best parts worth stealing.**

- **"Seit deinem letzten Besuch" / "Die letzten {{days}} Tage" as the home screen's top card.** Wrong
  subject, right idea — see *What nobody got right* #3.
- Fail-closed capability with **exactly one recovery question**, cached on the grow so it is never asked
  twice.
- The sixth stage card: `Weiß nicht / nur messen`, which hides every unreachable target and never nags.
- A share link **renders in place** rather than redirecting, so a visitor never learns the grow's name or
  sees a member list. Correct privacy instinct.
- `Zustand unbekannt` for outputs and the freshness string set.
- §16: every behavioural claim is gated on verification against `./simulate-device.sh`. The only concept
  that made local verification a named deliverable.

---

## 9. C07 — "Der Plan" — 45

**Verdict:** The centre of gravity is a feature I decline in the first three taps, after which I am left
carrying a permanently empty tab, and the one thing that would have redeemed it — the chart — is the item
the author's own §15.7 predicts will slip past the October hardware date.

`Nur beobachten` is a clean, permanent, one-tap opt-out that kills every task, nag and plan band for the
device, and it is offered as a visually equal third card. The liveness chip has four states including a
`> 60 min` tier where values become `—` with the last reading kept as a caption. The `Verlauf` scorecard
(`Im Ziel 71 % · Tag 88 % · Nacht 44 % · längste Abweichung 4 Std. 20 Min.`) is the concept's real gift to
me, and its Type 1 walkthrough is honest that this is the first thing the app ever told him that he did
not already know.

**Fatal flaws from where I sit.**

- **§15.4, verbatim:** *"Type 1 — the largest and laziest segment — carries dead weight… the tab bar still
  has a Plan tab that says nothing, and the entire concept's centre of gravity is a feature this user has
  declined. A concept built around the chart or around the journal serves him better."* I agree with the
  author against the author.
- **§15.7 is the killer:** the realistic bad outcome is that October ships the P0 tier, the Jetzt screen
  and the plan compiler, and **the chart lands after the hardware**. For me the chart is not a feature of
  the product, it *is* the product.
- **My home screen is built out of blocks that are empty for me.** The plan band is replaced by a
  "Kein Plan aktiv" card, the next-action card has nothing to say, the journal peek has three rows of
  machine noise. What remains is three climate tiles captioned `nur gemessen`.
- **§15.6:** the auto-written diary produces 8–12 rows a day into a collection with **no pagination at
  all**, making the diary slower every week — a cost I bear for a feature that exists to serve the plan.
- §15.8: the compiler creates a second source of truth against a device that can be changed locally, and
  every drift dialog is a conversation I never wanted to have.

**Best parts worth stealing.**

- **The chart has a future.** Everything right of the `jetzt` line drawn from the plan on a hatched
  background — planned setpoint steps, the flip date, `Ernte geplant 04.11`. No competitor draws a future
  target, and it costs nothing because the plan is already a timeline. (Useless to me; the best single
  original idea in the ten documents.)
- The four-state liveness chip with a `> 60 min` tier that stops showing numbers and keeps the age.
- `Später` snoozing to the **next photoperiod boundary** rather than "tomorrow", because tomorrow is
  meaningless in a 12/12 tent.
- Surfacing that a plan step is waiting because the executor only pushes to a device seen in the last 60 s
  — honest surfacing of a real engine limit instead of a spinner.
- Humidity rows greyed with `Kein Entfeuchter gekoppelt` and a link, rather than hidden or offered.

---

## 10. C09 — "The Tent" — 35

**Verdict:** For a user with no kit and no camera this is a cartoon of an empty box with two numbers
floating in it, and the author knows it: *"For a user who opens the app to read numbers and leave, the
tent is strictly worse than what exists."*

The epistemic argument is correct and well made — an object that is not in the picture has no controls,
and colour only ever attaches to verified things, so a prop is never green. The six-state object
vocabulary is the most complete in the set, and the reuse of the existing `DEVICE_ONLINE_TIMEOUT_MS`
rather than inventing a second threshold is exactly the right instinct. Type 3 is served superbly.

**Fatal flaws from where I sit.**

- **§15.2 is disqualifying:** today's overview shows four `value-display` gauges — value arc, limit arc,
  needle, 1 h average, target line — in a 2×2 grid. The tent spends its pixels on **liner, floor, walls
  and the space between objects**. For me this is a straight downgrade from what already ships, and the
  author says it is "not recoverable by tuning".
- **Its own Type 1 walkthrough:** *"He is over-served by the picture and under-served by its cost. An empty
  tent with two chips is a lot of illustration for two numbers."* My tent is a box with dotted outlines
  everywhere labelled `Hier ist nichts`. A screen whose dominant content is a list of things I do not own.
- **I have no camera, so the backdrop that makes this concept beautiful does not exist for me.** §15.10:
  for a €289 controller with no camera the home screen is an illustration, and the illustration style
  decides whether the concept is loved or mocked.
- **§15.1: the art is a hard dependency with no graceful degradation.** Five templates × two skins × light
  and dark × legible at 320 px. If it is late the concept ships as boxes, and boxes are worse than today.
- **§15.6: it does not exist in landscape.** The home screen has a device orientation in which it is
  replaced by a list — which is an admission that the list was the right answer.
- **§15.5:** the accessible Contents list is a second full UI to build, translate and keep in sync
  forever. Concepts built on lists get that for free.
- §15.8: an inline SVG with live `<foreignObject>` chips, a photographic backdrop and a scrub that
  re-renders the scene, in an Angular 15 app with default change detection, on a mid-range Android.

**Best parts worth stealing.**

- **The six-state object vocabulary**, especially `unverified (prop)`: *"Nur ein Merkzettel — Terp Control
  sieht das nicht"*, drawn flat and **never taking a state colour**. The best available answer to a user
  owning kit the firmware cannot see.
- **Reusing `DEVICE_ONLINE_TIMEOUT_MS` instead of inventing a threshold** — no other concept checked
  whether the number already existed.
- The `discrepancy` state: reported ≠ furnished, in *either* direction, drawn amber-dashed with a `!`.
- Pre-placing everything `hardwareInfo` already reports and badging it `gefunden`, so the common case is
  zero taps at the furnishing step.
- The `Kurz testen` button on a socket sheet — the moment the picture becomes believable is when the relay
  clicks in the next room.
- The **language switcher**. Today language is the browser locale with no switcher and no persisted
  preference, in a German-first product. Only C09 noticed.

---

# What nobody got right

These are needs of mine that **not one** of the ten concepts met.

### 1. A verdict that requires no declared goal

Every judgement mechanism in all ten concepts — time-in-range, verdict card, goal bar, target band, the
`✓ 3/3` chip — is derived from a target: a device setpoint, an alarm threshold, or a `GROW_STAGE_PRESETS`
row I had to pick. **I control nothing and I will declare nothing.** The outcomes are: C10 renders
`nicht bewertbar (keine Ziele gesetzt)`; C01 turns bands off entirely when I choose `Nur beobachten`,
which empties the very Day Sheet that was supposed to tell me what happened; C02 and C03 grade me against
an advisory band I tapped at random and then label the source, which is honest but is still a number
about somebody else's opinion.

Nobody built the obvious thing: **judgement derived from the data itself, needing zero configuration.**
"Your nights swing 6 °C and your days don't." "Humidity climbs every night from 02:00 and falls at
lights-on." "Tuesday was 4 °C warmer than every other day this week." "Your temperature range has widened
25 % compared with the previous fortnight." Descriptive statistics, day-vs-night deltas, stability,
periodicity and change-point detection are all computable from raw samples with **no target, no stage, no
plant and no plan** — and they are exactly what a person who bought a recorder wants read back to them.

Ten concepts treated "monitor-only" as a mode in which features are *removed*. Not one treated it as a
mode with its own product.

### 2. The app is the wrong delivery channel for a once-a-week user

I open this thing weekly. Between visits I am unreachable, and every one of these concepts assumes the
screen is being looked at. Push and email appear as: three toggles in an account **sheet** in C04 —
added, as the author admits (§16.5), only after realising a simple-gear user would otherwise never receive
any alert at all; a push mention in C05's Type 1 walkthrough; and a general "alerts have no consolidation,
acknowledge, snooze or repeat-until-resolved" gap that every concept defers.

**Nobody made the outbound weekly digest the primary deliverable for a monitoring-only user.** One
message a week to Telegram (where the dossier says this community already lives), Discord, email or a
generic webhook — *"last week: 88 % in band, coldest night 16.2 °C on Thursday, one 3-hour gap in the data
on Tuesday"* — is a better product for me than any home screen in this document, and the machinery for it
(`webhookTemplate.ts` with `{{placeholder}}` substitution) already exists and needs only a non-alarm
trigger. Every concept spends this on posting grow updates to forums for type 7.

### 3. Nobody designed the week-scale review, and one concept invented the primitive and gave it away

All ten optimise either **now** (tiles, verdict card, ring, scene, Now strip) or **the whole grow** (cycle
zoom, run, plan). The unit I actually arrive on is neither: it is **the interval since I last looked**,
which is irregular and personal — five days, then nine, then three.

C08 built exactly this primitive and pointed it at the wrong subject: *"Seit deinem letzten Besuch"* is
about somebody else physically entering the tent. Applied to *my last session in the app*, unchanged, it
would be the correct home screen for me — "here is what you missed, and nothing else". C02's window
switcher offers a fixed `24 h / 7 T / Phase` and C01's zoom bar a fixed `6h / Tag / Woche`; both are
calendar units, neither is *my* unit. Nobody stores `lastOpenedAt` per user per device and frames the
first screen around it.

### 4. Retention is designed against my stated purpose, and never disclosed to me

I bought this to *"record the values and look at them, after some time."* Every concept correctly adds
InfluxDB retention plus downsampling — the bucket today has none and keeps raw 5-second samples forever,
which is both a cost curve and, per §6.3, an evidentiary liability. Fine. But the numbers land in the
document and never on my screen: C01 says raw 90 days → 5-min rollups 12 months; C02 says 12 months; C03
says 180 days; C04 says 12 months then 15-minute means. **Not one concept shows me, in the UI, how long
my data will be kept, warns me before the first downsample, or offers a one-tap full export/backup so I
can keep it myself.** C10 goes further and makes an irreversible "reduce to summary" the *default* with a
30-day grace period (§15.8).

The one function I bought the hardware for is silently time-limited by every proposal here, and I find out
when the detail I wanted is already gone.

### 5. "The sensor is the product" is treated as a deficiency everywhere

Read the copy across all ten: `Nur Messen`, `nur gemessen`, `nur Beobachtung`, `Nur Messung`, `Kein Gerät
dafür angeschlossen`, `Nichts zu beurteilen`, "monitor-only", "fails closed to monitor", "advisory". All
accurate. All subtractive. Every one of these screens describes me by what I lack.

Nobody asked what a **complete** screen looks like for a device with no actuators. Dew point and absolute
humidity (pure arithmetic on stored data, and dew point is deferred in every concept that mentions it);
daily min/max/mean with the day-night delta; a mould-risk or condensation read; sensor-placement guidance
("your leaf-temp offset is an assumption of −2.0 °C — here is what that means"); how the room tracks
outside weather. None of that needs a socket, a plant, a stage or a goal, and none of it appears anywhere
in 12,700 lines of concept documentation.

### 6. Two devices, one screen

If I record things, I may well own two of these boxes in two rooms. C06 names the absence as a weakness
(§15.8: "the design has no good answer for a second tent"), C09 says the idea evaporates above about eight
(§15.3), and the other eight concepts give me a device switcher in a header and move on. Nobody designed
one screen showing both rooms' current state and both rooms' week.

### 7. Nobody priced what I lose today

Today, `/list` with exactly one claimed device renders that device's dashboard **directly** — zero
navigation between me and my numbers. C03, C07, C08, C09 and C10 all insert a frame, a tab bar, an
indirection or a picture in that gap. **Only C03 admits it** (§15.1). A concept that adds a screen between
a monitoring user and their readings should have to say so.

---

# Dealbreaker test

> **Claim a controller with no sockets paired and no camera. Answer nothing — skip, dismiss or decline
> every question the app asks. Close it. Reopen it seven days later.**
>
> On the first screen, with **zero taps and zero configuration ever performed**, I must get all three of:
>
> 1. **whether the data in front of me is current**, and where in those seven days it was not recorded —
>    drawn, not badged, so a wifi outage is visible as a hole rather than inferred from a timestamp;
> 2. **seven days of temperature and humidity that I can actually read on a phone** — real, visible axis
>    labels, a min/max envelope rather than a lone mean line, and pan/zoom that works with fingers;
> 3. **a plain-language statement of what actually happened in that week** — the highs, the lows, the
>    nights, the longest excursion as a duration, and how much of the week was recorded at all —
>    **without a target, stage, plant, plan, run or goal ever having been declared.**
>
> And it must show me **no control, target, plant, task, run or plan for hardware I do not own**, at any
> point, on any screen.
>
> Point 3 with zero declared goals is the part every one of the ten concepts fails or fudges. Points 1
> and 2 are table stakes that the shipping product fails today. If a concept cannot pass all three
> unattended, it is not a product for the user the owner listed **first**.
