# Critique — THE TECHIE LENS

**Critic:** the capable user. Density, precision, keyboard, big screens, real units, raw data, an API,
exports, and no lies. I am offended by rounded numbers presented as truth, by charts that hide their axes,
by averaged data presented as if raw, and by dead controls.

**How I judged:** can I reach the real numbers; is precision preserved; is the big screen exploited or is it
a stretched phone; can I script it; does the design tell me when it is guessing; and does the "simple" story
make the expert path worse or unreachable.

**One thing first, because it is the trust gate:** I said I would find the `daynight.floating` problem
myself and lose all trust. **All ten concepts found it and all ten delete it** — along with
`lights.maintenanceOn`, `co2.sunsetOff` and `daynight.linearChange`. So that test discriminates nothing
here, and I will say plainly that this is the single best thing about this whole set of documents. Three
concepts go further and earn credit for it: **C07** shows me the exact 15 firmware-read config keys a stage
compiles to *and* lists the ignored ones as a documented nothing; **C08** removes them rather than marking
them, and states "nothing that does nothing is shown" as a non-goal; **C09** renders the raw dotted keys in
its Schema skin so I can paste them into `simulate-device.sh`.

---

## RANKING

### 1. C01 "Loupe" — 88

**Verdict:** the only concept where the analysis surface *is* the product, it ships whole in v1, and the
expert depth costs the beginner zero pixels — which is exactly the shape I asked for.

Loupe is the one document that understands that for me the chart is not a page, it is the application.
Everything I want is in v1 and none of it is behind a mode:

- **Präzision** (long-press the zoom bar, `?precision=1`): exact from/to, arbitrary interval **with a
  server-side clamp**, aggregation method **including `raw`**, per-lane axis min/max override,
  `Als Tabelle anzeigen`, and a copyable box containing the live query string. That last item is the single
  most techie-literate affordance in all ten documents — it hands me the view model as text.
- **Lanes by raw Influx field name** from `VALID_SENSORS` / `VALID_OUTPUTS`. Nobody else lets me address a
  series by its storage identity.
- **CSV export of the visible window including actuator state** — which the dossier notes no vendor in this
  market provides.
- Axis labels **never** hidden (3 ticks below 360 px, unit into the lane title), `sampling:'minmax'` not
  LTTB, a **min/max envelope** behind the mean because "a lone mean line is a lie about a bang-bang
  controller", deviation fill between actual and setpoint rather than a meaningless fill to the axis.
- Time-in-range computed **server-side on raw samples**, with the `DayRollup` job explicitly ordered to run
  *before* the downsample task — and §15.10 names the ordering hazard rather than hiding it.
- Capability **fails closed** when `hardwareInfo.sockets` is absent; a measured-but-unactionable lane draws
  its band in grey labelled `nur Beobachtung` instead of nagging me about a lever I do not have.
- The dehumidifier/cooler double meaning is *named on the lane label*, not hidden.
- Desktop is three columns with a **wider** middle — more time at higher fidelity, explicitly "the marketing
  screenshot". That is exploiting the big screen, not tolerating it.

**And the rule I care most about, stated as a rule:** *"a techie affordance may never add a control to the
default surface."* That is the correct formulation of progressive disclosure and only C01 writes it down.

**Fatal flaws:**

- **No API in v1.** `Drawer › Konto › API` is an honest "kommt" page with read endpoints and documented
  cloud-outage behaviour. Honest, and still nothing I can script against for a year.
- **The shared `TimeScale` is the concept's single point of failure and it is a lie-generator when it
  drifts.** Canvas (ECharts) and DOM (film strip, event rail, output lanes) stay aligned only because they
  read the same `x(t)`, through `dataZoom` events, rotation, lane collapse, font loading and Ionic's layout
  passes. §15.4 admits sub-pixel drift makes the thumbnails lie about when a picture was taken. A film strip
  that is *almost* an axis is worse than no film strip, and I am the person who will notice.
- **Five zoom regimes × N lanes × 5 device types × 3 restricted modes**, with the Cycle-zoom daily-column
  renderer sharing almost no code with the curve renderer, against 38 `it()` blocks and a CI that never runs
  `ng test`.
- One screen, one performance budget: ECharts canvas + three DOM lane systems + a 10 s live refresh
  competing for the same frame, with no page-level firebreak.

**Best parts to steal:** Präzision as a long-press with `raw` in the method list and the query string
copyable; lanes addressed by raw field name; CSV including actuator state; the "a techie affordance may
never add a control to the default surface" rule; `DayRollup` ordered before downsampling; grey
`nur Beobachtung` bands for measured-but-unactionable channels.

---

### 2. C04 "Zweigang" — 84

**Verdict:** the only concept that ships a documented API and a generic webhook **in v1**, and the only one
whose entire thesis is a promise never to degrade the expert path — which is precisely the failure mode I
was told to punish, refused at the architectural level.

C04's answer to my "does simple mode make the expert path worse" test is not a mitigation, it is a design:
*"You cannot make a screen simple by hiding things on it. Only by not putting them there."* The Pro gear is
a workbench with no accordion, no "show advanced", no compromise copy serving two audiences in one string.
That is correct and nobody else says it.

Concretely in **v1**, not v1.1:

- **Read API** with `x-api-key`, per-device scope, OpenAPI — Pulse Grow's shape.
- **Generic outbound webhook decoupled from alarms**, which transitively unlocks n8n, Make, Home Assistant,
  ntfy and Matrix and, as the document correctly puts it, "moves the entire platform-policy problem to the
  user's side of the trust boundary". Reuses the existing `webhookTemplate.ts` `{{placeholder}}` machinery.
- Full ECharts rewrite with small multiples, stepped setpoint, signed deviation fill, min/max envelope,
  outputs state-timeline, annotation rail, film strip, `Als Tabelle anzeigen`, DLI + dew point, **the
  timezone printed on the chart**, and honest labelling (`Entfeuchter / Kühler`,
  `Ohne Funktion in dieser Firmware`).
- Gear preference stored **server-side** so a new phone does not reset me — a small thing that tells me
  somebody has actually been the techie in question.
- Per-role capability failing closed; the raw-sample scorecard endpoint; interval capped by timespan; Flux
  parameterised.

**Fatal flaws:**

- **No write API, and `VALID_SENSORS` stays hard-coded.** My soil-moisture probe enters as a
  `GrowEvent.measure` — points on a timeline, not a series I can band, alarm on, or export as telemetry.
  §16.11 names this and does not solve it.
- **Gear is per-user, not per-device** (§16.7). One controller and three plugs means one gear for all of
  them, and the document rejects per-device gear on consistency grounds. I have the exact fleet that breaks
  this.
- **The Simple gear's conditional min/max envelope is a heuristic with false negatives** (§16.4): the
  envelope renders only when an excursion crosses the band, so a heater short-cycling ±0.4 °C inside a
  ±1.5 °C band is invisible. That is the signal a bang-bang controller exists to show. It only hurts a
  surface I never open — but it is a documented decision to hide an oscillation.
- **Governance rot is the real risk.** Two shells means every feature triggers a placement argument, and
  §16.3 admits the Zweigang Law is "a rule in a document". The Pro gear is where the rot lands, because it
  is the one nobody demos.
- 36-cell test matrix (2 gears × 6 device types × 3 access modes) on a red suite, gated by a manual
  `simulate-device.sh` walkthrough that will get skipped in September.

**Best parts to steal:** the read API + generic non-alarm webhook **in v1** (this is the single most
copy-worthy scope decision in the ten); "you cannot make a screen simple by hiding things on it";
server-side UI preference; the timezone printed on the chart; `Ohne Funktion in dieser Firmware` as a label.

---

### 3. C06 "Glance Tiles" — 76

**Verdict:** technically the most correct freshness and capability model of the ten, wrapped around a home
screen whose signature element is an axis-less 22-pixel sparkline the author himself calls decoration.

What C06 gets right is not the tiles, it is the plumbing under them, and the plumbing is genuinely the best
in this set:

- **Freshness is per *measure*, never per device.** Every other concept ties liveness to `lastseen`; C06
  notices that `Device.lastseen` is stamped on *any* MQTT traffic while a sensor may have failed, and ships
  a `⚠ Verbunden, aber keine Messwerte` state for exactly that case. That is a real diagnostic nobody else
  surfaces.
- **`GET /data/board`** returns `serverTime` alongside every `{v, t}` pair — *"authoritative clock — never
  trust the phone's"* — and replaces the current N-requests-per-10s poll loop. The freshness chip's title
  attribute carries the exact sample timestamp **and the server/browser clock skew**. This is the only place
  in ten documents where anyone acknowledges that clocks disagree.
- **`generic:<m>` tile:** a device reporting something the catalogue does not know about is never invisible
  — it gets a value, a unit if i18n has one, and *no goal bar*. The current app gets this exactly backwards
  with a literal measure array inside a 1205-line component.
- **Grey is reserved product-wide for "I do not know"** and used for nothing else. That is a semantic rule I
  can rely on without reading.
- Resolution override clamped so any request produces ≤ 5,000 windows; the chart URL is a hand-editable view
  model; the full 15-measure catalogue survives behind `Alle Messwerte`; `Als Tabelle anzeigen` on every
  panel; Technik detail exposes socket roles, IPs, duty cycles and last-command failures.
- "A tile with no goal bar is making a deliberate statement: nothing here can act on this number."

**Fatal flaws:**

- **The sparkline.** 60×22 px, unlabelled, axis-less, on every single tile, on the screen I open first.
  §15.2 concedes it is "decoration by §7.2's own standard" and keeps it because nothing fits. A chart with
  no axis is the thing I am specifically offended by, and this concept puts twelve of them on the home
  screen.
- **API and outbound webhooks are v1.1**, gated behind SSRF/timeout/queue work that does not exist.
- **The drag-and-drop grid is the most likely thing to be cut** (§15.4): 2D grid drag on Angular 15 / Ionic
  6 needs `@angular/cdk`, which the repo does not have, fighting Ionic's own gesture layer. Cut it and the
  concept's answer to seven user types degrades to "we picked a good default order".
- **Auto-provisioning is non-deterministic from where I sit** (§15.3). Evidence comes from `hardwareInfo` —
  a free-form `Record<string,string>` filled from MQTT log lines — and "has produced a point in 48 h", a
  query that flaps. One wrong key is a phantom tile.
- The desktop rail is, in the author's own words, "asserted, not designed".

**Best parts to steal:** per-measure freshness with `serverTime` and clock skew exposed; the "connected but
no readings" state; `generic:<m>` so unknown measures are never invisible; grey reserved product-wide;
resolution override clamped by window count.

---

### 4. C08 "Shared Grow" — 72

**Verdict:** the strongest statement of principle in the ten — *"no fabricated numbers"* as a hard non-goal
— attached to an October budget spent almost entirely on an authorisation rewrite I do not need.

C08 §14.13 is the sentence I would put on the wall: **no DLI without a light sensor, no averaged
multi-device temperature, no bare ppm without its scale, no "state: off" for an offline device.** Each of
those is a specific, checkable refusal to invent a number, and three of them nobody else makes:

- **Outputs read `Zustand unbekannt` when the device is offline.** Today a controller offline for two hours
  still draws its last known socket states as fact. That is the exact class of lie I care about, killed by a
  string.
- **One grow can span several devices, and the chart draws one panel per device per measure, labelled by
  device name — never an average**, "because averaging two sensors in different corners of a tent is a
  fabricated number". Nobody else even encounters this problem, let alone refuses it correctly.
- **Inferred visits are drawn with a dotted bracket and read "vermutet"**, and the document states the
  reason: if the visit log is half-right, the excursion attribution is *misleading*, which is worse than
  absent. That is telling me when it is guessing, at the right granularity.
- The `Alles` toggle reveals raw `device.configuration` values **with their firmware-read status marked**;
  dead controls are removed rather than marked. CSV export **including actuator state**. `Als Tabelle
  anzeigen`. Full chart rewrite in v1. Person colours drawn from a low-chroma ramp deliberately disjoint
  from the measure hues — "hue belongs to physics" — which is a rule, not a preference.

**Fatal flaws:**

- **The most expensive line item in the release is a membership collection, `auth.middleware.ts:172`/`:207`
  and ~20 owner-scoped queries** — and §15.1 admits types 1–5 are solo growers who experience it as a menu
  entry they never tap. I am type 5. My October is spent on somebody else's roles.
- **API, webhooks and the CSV-with-actuator-state are v1.1.** The thing I would script against is the thing
  that slips.
- **The Visit is an inference layered under a diagnostic.** Excursion attribution ("3 of 4 humidity
  excursions overlapped a visit") is genuinely the best solo-user payoff in the ten — and §15.2 admits the
  30-minute auto-close threshold is a guess with no data behind it, and that a bedroom grower walking past
  eight times a day turns the PERSONEN lane into noise.
- **Adaptive 2/3/4-tab navigation means the product looks different on different accounts** (§15.11). For
  documentation, screenshots and the Telegram community that is a permanent tax.
- The grow indirection adds a join to nearly every query, and the alias layer over `ShareLink.query` is
  §15.6's own "highest-probability way C08 damages something that works today".

**Best parts to steal:** the entire "no fabricated numbers" non-goal, verbatim; `Zustand unbekannt` for
outputs on an offline device; one panel per device per measure, never an average; dotted rendering for
inferred data; hue reserved for physics.

---

### 5. C10 "Durchgang" — 71

**Verdict:** the only concept that ships a versioned, documented, exportable statistics schema I could build
a spreadsheet on — bolted to a thesis whose payoff arrives three to five months after I buy the hardware.

The scriptable surface is real and it is in v1: **`GET /run/:run_id/stats.json` and `.csv`, including
actuator state**, over a `RunDayStat` row that carries `statVersion` so a formula change recomputes rather
than silently disagreeing with the chart. That last detail — versioning a derived statistic — is the single
most engineering-literate idea in this document set, and C10 is the only one to have it.

Other things that are precisely right:

- **Humidity is drawn as a ceiling (`max. 55`), not a symmetric band.** There is no humidification path in
  the hardware, so a centred band with tolerance on both sides is, as the document says, "a lie about the
  machine". Nobody else notices.
- **DLI only when a real PPFD sensor exists**; otherwise `Lichtstunden/Tag` integrated from `out_light` —
  "honest, free, and a better run-over-run metric anyway". Computing DLI from `lights.limit` percentage
  would be inventing a number with a unit on it, and C10 says so.
- The **"geplant vs. gemessen" hairline** on the day/night band: where the schedule and the measurement
  disagree, a hairline outline. A whole class of silent contactor failure, visible for free.
- **`#999999` grey reserved product-wide for "a different run"** — a semantic rule, not a palette entry.
- Two runs side by side with `echarts.connect()` linked crosshairs at ≥1100 px. That is a real big-screen
  answer, not a stretched phone.

**Fatal flaws:**

- **The core value arrives at run 2.** §15.1 says it plainly: day one is "a chart with axes and a good
  watering button" and a headline row that reads *"Erster Durchgang"* — an IOU. I do not buy a €289
  controller for a promise that pays in March.
- **`RunDayStat` is a derived cache with every derived-cache problem** (§15.7): it can disagree with the
  chart because it aggregates differently, it needs recomputation on every formula change, and **the day
  boundary depends on `Run.timezone` — get it wrong and every daily number silently shifts by hours**. The
  concept's entire comparison rests on a cache that can quietly be wrong, which is the failure mode I trust
  least.
- **Ordinal outcomes instead of numbers.** Stars and better/same/worse instead of grams. The legal reasoning
  is sound and §15.3 concedes the counter-argument is "true and also convenient" — but a measurement product
  that deletes its own outcome measurement has, from where I sit, deleted the dependent variable.
- **`localStorage`-only harvest weights** (§15.4, admitted as "honest and still bad"): no sync, vanish with
  site data, uncomparable across devices.
- **The run model breaks for staggered/perpetual grows** (§15.5) — which is the owner's own multi-plant
  scenario. The chart's x-axis, the stage bands and all of `Vergleich` stay run-scoped.
- Multi-user cut entirely from v1; the "a run is just a period" generalisation for plugs and lights is, as
  §15.6 says, "a patch over that, not a design".

**Best parts to steal:** `statVersion` on every derived statistic; a documented `stats.json`/`.csv` export
including actuator state; humidity as a ceiling; DLI only with a real sensor and `Lichtstunden/Tag`
otherwise; the geplant-vs-gemessen hairline; a colour reserved product-wide for a semantic, not a measure.

---

### 6. C09 "Das Zelt" — 68

**Verdict:** contains the best single techie artefact in the bake-off and the sharpest technical catch in
all ten documents — then makes both of them optional, cuttable, and secondary to an illustration budget.

**The Schema skin is what I want.** Same scene, same coordinates, rendered as an engineering diagram:

```
PWM out_light 80.0 % t+4s · SHT21 temperature 25.83 °C t+4s
socket dehumidifier 192.168.1.45 ON 3:12 └ acts as: cooler (workmode=temp)
cfg workmode=temp day=21600 night=79200 day.temperature=25
```

And the document explains *why* the dotted keys: because that is what `simulate-device.sh configure` takes
and what the REST API documents, so **a techie reading Schema can drive the device from a shell**. That is
the correct instinct — make the UI a legible projection of the machine's own vocabulary.

**And the catch nobody else made:** `out_light` is the PWM output, freely assignable to a dimmable lamp
*or an exhaust fan*, and `is_day` is inferred from `out_light >= 0.5`. If I hang an exhaust fan on the
dimmer, the day/night shading **and** the overview's day/night state are nonsense — silently. C09 asks the
one question hardware cannot answer, stores `TentScene.pwmUse`, permanently falls back to the schedule, and
relabels the panel `Abluft`. That is the single sharpest observation in the entire concept set, and it only
became visible because somebody had to draw the thing.

Also right: props (kit the firmware cannot see) are drawn flat and **never take a state colour**; unknown
firmware **fails to the user's declaration, never to "everything"**; band provenance labelled `Alarm` /
`Ziel ± Toleranz` / `Empfehlung`; `Daten: 97 % vorhanden`; CSV including actuator state and `Als Tabelle
anzeigen` in v1; a single ECharts instance with `grid[]` rather than `echarts.connect()` because connect
multiplies canvases and resize observers on the exact device the migration was justified by.

**Fatal flaws:**

- **Density.** §15.2 concedes it: today's 2×2 `value-display` grid — value arc, limit arc, needle, 1 h
  average, target line — is a lot of information per pixel, and the tent spends pixels on liner, floor and
  walls. "For a user who opens the app to read numbers and leave, the tent is strictly worse than what
  exists." That is me, every day.
- **Schema is de-scope item #2** (§13). The expert rendering is explicitly the second thing to be cut, which
  means the affordance I would rank this concept on is the one I cannot rely on.
- **The API is v2** — later than any other concept. `VALID_SENSORS` stays closed, my probe is a manual
  `measure` event, and §15.9 says outright "Schema is a consolation prize".
- **The time slider is bounded to 7 days mobile / 30 desktop** because of what the sprite service can serve.
  Honest, and it means the scrub interaction does not reach the range I actually analyse over.
- **The art is a hard dependency with no graceful degradation** (§15.1): five templates × two skins × light
  and dark × legible at 320 px. Late art does not ship reduced, it ships as boxes.
- **Landscape phone does not work** (§15.6) and the accessible twin (the Contents list) is a second UI to
  build, translate and keep in sync forever.

**Best parts to steal:** the Schema skin, promoted from an optional skin to a permanent, non-cuttable view,
with the dotted config keys, socket IPs, duty cycles and ages in seconds; the `pwmUse` question and its
consequences; props never taking a state colour; failing to the user's declaration rather than to "full".

---

### 7. C05 "Thumb Journal" — 65

**Verdict:** the best desktop analysis layout in the ten, buried under a chat thread that demotes every
number I came for to a 72-pixel strip.

The desktop layout is genuinely the one I would use: three columns, chart in the middle, journal thread on
the right, **crosshair and thread bound in both directions** — drag the crosshair and the thread scrolls,
click an entry and the chart jumps. That is a real analysis instrument and no phone-only competitor can
answer it. Add `/tidy`, a dense keyboard-navigable batch-fill table, and long-press any entry →
`Rohdaten` → the raw `JournalEntry` JSON, copyable. The full chart rewrite is in v1 with everything: small
multiples, stepped setpoints, `sampling:'minmax'`, min/max envelopes, `nicht regelbar` greying for the
uncontrollable half of the humidity band, outputs state lane, film strip, axes never hidden, translated
series names.

It is also the only concept that ships a **write** path for events (`POST /journal` with an idempotency
`clientId`), and the only one honest enough to say that a write API for *events* is not a read/write API for
*sensors and outputs* (§15.7).

**Fatal flaws:**

- **The home screen is a chat.** §15.1 concedes that four of seven types open the app to know a number, and
  in Thumb Journal the numbers are a 72 px strip and everything else is prose bubbles. "If the owner's actual
  belief is that people open this app to check their tent rather than to record their work, this concept is
  optimising the wrong verb."
- **Navigation moved to the top so capture can own the thumb zone** (§15.8), based on an explicitly
  unevidenced assumption about relative frequency.
- **One-tap logging degrades data quality by construction** (§15.2): "more entries, each thinner". I am the
  person who wants `site`, `runoffEc`, `phIn` and a volume on every row, and the recovery mechanism
  (`/tidy`) is **v1.1** and is a desktop screen the target user will never open.
- **"Same as last time" ossifies mistakes silently** (§15.3): log 5 L once when you meant 0.5 L and 5 L is
  the default forever, self-reinforcing through the Mengenring's history-derived values. The mitigation is a
  median-deviation heuristic. Not solved.
- Row explosion: 800–1,500 `JournalEntry` rows per 12-week grow where today's diary produces 20, on an API
  with no server-side pagination today.
- The public API is v1.1 despite §12.3 describing it as though it were the techie's answer.

**Best parts to steal:** the bidirectionally-bound crosshair↔thread desktop layout; `Rohdaten` as a
long-press on any object returning copyable JSON; `/tidy` as a keyboard-first dense correction table;
`clientId` idempotency keys on writes; the honesty that an events API is not a telemetry API.

---

### 8. C03 "Beet" — 60

**Verdict:** competent engineering hygiene and a genuinely correct insight about plants changing the
*judgement* and not the *data* — shipped on the proprietary chart library whose licence is an open question,
with the migration deferred into the launch window.

Credit where due. C03 understands something none of the plant-first alternatives do: **the plant chips do
not change the sensor series — same air, same samples — they change the bands, the second x-ruler and which
events show.** "Switch plant, the data stays, the judgement changes." That is the right decomposition. It
also consolidates the chart query-string format, duplicated in five places today, into one
`chart-query-params.ts` alongside the existing diary convention — the only concept that treats that
duplication as malpractice worth fixing. Per-role capability failing closed, `Phase`/`Grow` range presets,
`Rohdaten` disclosure, an equipment page with per-role socket truth and IPs, `Woche exportieren` as CSV/JSON,
`Skala unbestätigt` chips on migrated ppm readings whose scale is unknown.

**Fatal flaws:**

- **It ships v1 on Highcharts** (§4.4) and defers ECharts to v1.1. The reasoning is defensible on schedule
  grounds and the consequence lands on me: the memory ceiling stays (416 ms / 97 MB vs 148 ms / 17 MB on the
  benchmark), and §15.10 concedes that if the licence answer comes back "we cannot use it", the entire v1
  chart becomes a library migration *during* the launch window. That is a coin flip on the surface I live on.
- **Type 5 is explicitly worst-served** and the mitigation is `⋯ → Pflanzen ausblenden`
  (`grow_settings.plantsHidden`) — a switch to hide the concept's root object from the user it does not fit.
  A hide-the-thesis toggle is an apology, not a design.
- **A plant object sits between me and my thermometer.** §15.1 states the objection fairly and cannot
  resolve it: today `/list` renders the single device's dashboard directly.
- API is v1.1; `VALID_SENSORS` stays closed and the document says so.
- Four new collections, no migration tooling, no test baseline, six weeks — §15.3's own "single largest
  execution risk", with a cut order that degrades to "a device dashboard with a day counter".
- The backfill "will produce some wrong-looking history" (§15.5), a support category this concept creates.

**Best parts to steal:** plant selection changing bands and rulers rather than series; consolidating the
five duplicated copies of the chart query format into one module; `Skala unbestätigt` on data whose unit
basis is unknown; the equipment page with per-role socket truth and IPs.

---

### 9. C07 "Der Plan" — 52

**Verdict:** contains the best honesty affordance in the ten — a screen that shows exactly which config keys
the firmware reads and which it ignores — and then schedules the chart I judge everything by as the first
thing to be cut, while charging me three taps and a modal to change a night setpoint.

The good is very good and I want it regardless of who wins:

- **`Was der Controller bekommt` / "What the controller gets":** for any stage, the exact 15 firmware-read
  configuration keys that stage renders, **with the ignored keys listed as a documented nothing**. That is
  the compiler being inspectable. It is the single most trust-building screen described in these ten
  documents.
- **`Plan als JSON`** — read, edit, paste back; import/export; the plan portable between devices as a file.
- **Drift detection:** the device has a local display and a rotary knob, so a user can change the config out
  from under the plan. C07 compares the echoed config to the compiled step and offers `Plan anpassen` /
  `Plan wiederherstellen`. Today divergence is silent. Nobody else names this.
- **The chart has a future** — the plan's setpoint line continues to the right of `jetzt` on a desaturated
  background, with the flip date and planned tasks as hollow markers.
- **DLI only when a VEML7700 exists**, because "computing DLI from a dimmer percentage would be a fabricated
  number, and a fabricated number in a grow app is worse than a missing one".

**Fatal flaws:**

- **The chart overhaul is Tier 2, item 17, "first to be cut"** — and §13 states the realistic outcome
  outright: *"v1 is Tier 0 + Tier 1 and the chart ships in November."* The surface I judge the product by,
  and the thing the owner explicitly asked for, lands after the hardware. That alone caps this concept for
  me.
- **`Plan als JSON` is v1.1** (§13). The techie escape hatch is not in the release.
- **The plan is a straitjacket and §15.1 says so.** "I just want to turn the temperature down" becomes three
  taps and a scope decision (`Nur jetzt` / `Für diese Phase` / `Für den ganzen Plan`). That is the expert
  path made *worse* to protect a model, which is the exact thing I was told to punish.
- **Ramps compile into recipe sub-steps** (§15.3): a 42-day flowering stage with a linear ramp becomes 14
  steps, so the Expert recipe editor shows a generated list that does not resemble the plan I built. Two
  representations of one thing, one of them generated, no meaningful test suite. That is a drift-bug factory
  aimed at the screen experts use.
- **A second source of truth against a device that can be changed locally** (§15.8) — drift dialogs are a
  conversation a config-is-truth design never has.
- Type 5 served worst by the author's own ranking: the plan's vocabulary is cannabis photoperiod ceremony,
  and a one-stage `Dauerbetrieb` plan for a fridge "works mechanically and reads as ceremony". No write API,
  no custom measures, no Home Assistant.
- Journal entries stay in `DeviceLog` — defensible for reuse, and it means the auto-written diary (8–12 rows
  a day) lands in a collection with `Schema.Types.Mixed` data and no pagination today.

**Best parts to steal:** `Was der Controller bekommt` with the ignored keys listed — this belongs in the
winner whatever it is; drift detection against the rotary knob; the plan/config as an editable JSON
document; drawing the future setpoint to the right of now; DLI refused without a real sensor.

---

### 10. C02 "The Verdict" — 41

**Verdict:** a concept whose thesis is that the chart is demoted to evidence, which then does not ship the
chart at all in v1 — so in October the verdict card sits on top of fifteen translucent areas on hidden axes
with hover-only events, and my documented escape route is a preference the author himself calls an apology.

I want to be fair, because parts of this are excellent. The scorecard sheet is the best-specified endpoint
in the ten: dwell-time-weighted in/above/below on **raw** samples, day/night split by `out_light > 0.5` with
a schedule fallback, MAD from the stepped setpoint, longest excursion **in seconds**, coverage, and the line
`aus 17 214 Rohmessungen · 5-Sek-Raster` printed on screen — which the document correctly calls "the
techie's honesty line". The band-source chain is always labelled. `?detail=temperature` deep-links every
scorecard. The excursion thumbnail — the tent photo from the minute the room peaked, next to the sentence
saying it peaked — is the single most elegant use of the camera in the whole set. §15 is the most honest
weakness section of the ten.

And none of it saves the concept for me.

**Fatal flaws:**

- **The chart rewrite is not in v1.** §13 lists it under "Explicitly NOT in v1" and §15.4 states the
  consequence: *"in October the verdict sits on top of today's chart… the evidence is still fifteen
  translucent areas on hidden axes."* A concept that demotes the chart and then does not fix it has demoted
  it twice.
- **The techie answer is `/account → Start auf → Belege`**, and §15.5 concedes: *"Telling them 'we computed a
  verdict for you, but here's a setting to skip it' is not a strategy — it is an apology."* I agree with the
  author.
- **No API before v2**, `VALID_SENSORS` hard-coded, no custom measures. §11's Type 5 walkthrough is three
  sentences ending in "This concept does nothing for him in v1."
- **The verdict thresholds — 90 % / 70 % / 60 min / 180 min — are invented**, and §15.9 admits they were
  made user-editable specifically to avoid defending them. A judgement rendered as a green tick, computed
  from numbers with no source, is precisely the rounded-confidence failure I am most offended by. The
  headline is also deliberately number-free ("the verdict never uses a number in the headline"), which is
  correct for the stoner and means the primary screen tells me nothing I can check.
- **There is no desktop story anywhere in the document.** Ten sections and the words "big screen" do not
  appear. Every other concept at least asserts one.
- §15.11 lands the last blow itself: the device shell, tab bar, FAB, `GrowGoal`, scorecard endpoint and
  capability rewrite all land in the same six weeks on a repo whose CI never runs `ng test` and whose only
  meaningful tests cover a function this concept plans to delete.

**Best parts to steal:** the `GET /data/scorecard` response shape verbatim, including `sampleCount`,
`coverage`, `madFromSetpoint` and excursions with `seconds` and `extreme`; printing the raw sample count and
grid interval next to any derived percentage; the excursion thumbnail; `advisory: boolean` on a channel the
device cannot change, keeping it out of the headline while still showing it.

---

## WHAT NOBODY GOT RIGHT

These are needs of mine that **not one** of the ten met. This is the most useful thing I can give you.

**1. Nobody joined the two facts that unlock custom measures — and they are both already on eight v1 lists.**
Every concept refuses to widen `VALID_SENSORS`, and nine of ten name it as a weakness for type 5. But the
reason it is a hard-coded literal is the same reason `/data/series` is a Flux injection: `measure` is
interpolated raw, so the allowlist is the security control. **Every concept already fixes the injection in
v1** (parameterise, allowlist, clamp). The moment `measure` is parameterised, the allowlist stops being a
security control and becomes a *vocabulary* — and a vocabulary can be a MongoDB collection with a row per
user-declared measure instead of a literal array in `data.service.ts`. That is the difference between "my EC
probe is a manual diary entry forever" and "my EC probe is a series with a band and an alarm". Ten documents,
both halves present in eight of them, zero connections made.

**2. No stable contract on the endpoint I would actually script.** Between them these ten concepts add
`/data/scorecard`, `/data/board`, `/image/strip`, `/plan/:id/timeline`, `/journal/:id`, `/run/:id/stats.json`
— and **not one says what happens to `/data/series`'s response shape**, which is the endpoint any script
starts from. C10 alone has the right idea (`statVersion` on a derived statistic) and applies it only to its
own cache. I need a versioned response contract and a documented deprecation path on the *existing*
endpoints, not six new ones.

**3. Nobody shows me the aggregation on the pixels.** All ten adopt `sampling:'minmax'`, min/max envelopes
and a coverage figure — good. Not one tells me, on the chart, **which bucket size I am currently looking at
and which function produced each pixel.** Worse: C01's `DayRollup`, C10's `RunDayStat` and C02's Mongo TTL
cache each introduce a *second* aggregation layer that can silently disagree with the chart drawn beside it.
Only C10 names that risk, and only for its own cache. A chart that silently transitions from raw to 5-minute
means to a daily rollup as I zoom is averaged data presented as raw, which is the thing I said I would not
forgive. The fix is one line of chrome: `5-Min-Mittel · 288 Fenster · min/max`.

**4. Timestamp provenance is unaddressed.** C06 gets closest — `serverTime`, per-measure `t`, clock skew in
a title attribute — and even it stops at "the phone's clock is untrustworthy". Nobody says whether a
timestamp is the device's clock, the broker's, the server's, or Influx's point time. The device is an ESP
with no RTC that gets its time over the network. If it is 90 seconds off, **every excursion duration, every
day boundary, every day/night band and every "in range 84 %" is wrong by that much**, and nothing in any of
these ten designs would ever show it. A `clockSkewMs` on the board payload and a banner past a threshold is
cheap, and nobody has it.

**5. Nobody exposes the formulas behind the derived numbers.** VPD is Tetens with a **−2.0 K leaf offset**.
Nine concepts print the offset on the chart, which is genuinely good and I credit it. Zero print the formula
or the coefficient set, and zero let me change the offset per grow — and that hard-coded constant determines
the entire number I am asked to steer by. Same story for DLI, dew point, and the dwell-time integration rule
behind time-in-range. "We are guessing, here is the guess" is halfway. "Here is the guess, here is the
equation, change it" is the whole thing.

**6. No path to reproduce a number.** The scorecard says 84 %. I cannot obtain the sample set it was
computed from. C02's `aus 17 214 Rohmessungen` is the closest anyone comes and it is a count, not a
download. Every "view as table" and every CSV exports what the *chart* holds **after** downsampling, not
what the *scorecard* integrated over. So the two numbers on my screen can never be reconciled by me. For a
product whose pitch is honesty, an unfalsifiable headline statistic is a strange thing to ship.

**7. Keyboard is absent from all ten documents.** I asked for keyboard and big-screen use. The only keyboard
affordance anywhere in ~13,000 lines is C05's `/tidy` table, and it is v1.1. No shortcuts to step the
crosshair, change the range, toggle a lane, solo a panel, jump to a date, or copy the value under the
cursor. Every "desktop" answer is a two- or three-column layout — more canvas, same input model. A bigger
mouse target is not big-screen design.

**8. Nobody costed the read path of their own honesty.** Raw-sample time-in-range over 24 h × 5 s × 4
channels is ~69k points per request, and **all ten require it** because averaging destroys the excursions.
Only C02 budgets a cache and calls the real fix unbudgeted. Nobody says what happens when I open `Lauf` /
`Grow` / `Zyklus` — a 90-day window — at raw resolution, which is the first thing I will do. The concept
that gets this wrong ships a scorecard that times out exactly for the users who have the most data.

---

## DEALBREAKER TEST

**Open a 90-day window and, without leaving the app, get me three things that agree with each other:**

1. **What drew this?** — the bucket size and the aggregation function behind the pixels currently on screen,
   visible as chrome on the chart, updating as I zoom (`5-Min-Mittel · min/max envelope · 288 Fenster`), and
   an explicit marker when the view switches to a precomputed rollup rather than a live query.
2. **Give me the same window as data** — CSV or JSON at a resolution *I* choose, **including actuator
   state**, from the same query the chart used.
3. **Show your working on the verdict** — the raw sample count, the exact time range, and the coverage the
   time-in-range percentage was integrated over, such that I can recompute that percentage from item 2 and
   land on the same number.

**If the chart cannot tell me what function drew it, or if the scorecard's number cannot be reconciled with
the product's own export, I do not trust anything else the app says** — including the setpoint bands, the
excursion durations, the day/night attribution and the verdict. Precision is not a feature I want alongside
the simple mode; it is the thing that makes the simple mode worth believing. **Not one of the ten passes
this test today.** C01 passes item 2 outright and comes closest on item 1 (Präzision exposes the method and
the query string, but does not stamp it on the chart); C02 passes half of item 3 (the count, not the data);
nobody closes the loop between them.
