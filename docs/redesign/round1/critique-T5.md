# Critique — User Type 5: the closed-loop DIY builder

**Who is judging.** I bought a €289 controller and wired it into a converted fridge. I read
`firmware/src_hwtype/controller/controller.cpp` before I read your marketing page. I have watched Grobo,
Seedo and Cloudponics brick hardware people paid for. I do not want a verdict, a plan, a journal, a plant,
a tent or a stage. I want: the documented REST API you advertise on your own homepage, my own measures on
your chart, webhooks or MQTT I can point at Home Assistant, raw data out in a machine-readable form
including actuator state, and a written answer to *"what does my box do when terpcontrol.cloud is gone?"*

Everything below is scored on that and nothing else.

---

## The single sentence that decides most of this

Nine of ten concepts contain some version of the line *"Type 5 is the worst-served type and I am not going
to pretend otherwise."* I appreciate the honesty. It is still nine concepts telling me, in writing, that
the segment that writes the forum posts and reads the firmware gets an IOU.

The tenth (C04) also under-serves me — but it is the only one that puts a **documented read API with
`x-api-key` and OpenAPI, plus a generic outbound webhook decoupled from alarms, inside the October v1
scope list.** That single scoping decision is worth more to me than every chart technique in all ten
documents combined, because a webhook and an API key mean I never have to care what your UI looks like.

---

## Ranked

### 1. C04 — Zweigang (Two Gears) — **74**

> Two complete apps behind one login. Profi is a workbench; Einfach is for someone else.

**Why it wins for me.** It is the only concept where the thing I need is in v1 and named as a line item
(§14 v1, items 14 and 10): *"Read API (`x-api-key`, per-device scope, OpenAPI) + generic outbound webhook
decoupled from alarms."* The walkthrough is specific — "he builds his own Grafana panel in week one and
stops complaining" — and it explicitly names the transitive unlock: n8n, Make, Home Assistant, ntfy,
Matrix. That last point is the correct architectural insight and nobody else states it: a generic webhook
**moves the entire platform-policy problem to my side of the trust boundary.**

Second: `uiGear` is stored server-side, per user, permanently. I set Profi once and never see a ring with
`Passt` written in it again. Compare C02, whose answer to me is a `Start auf` setting it calls, verbatim,
"an apology".

Third: the Zweigang Law means the Pro gear is *"largely a re-roof of what already exists"* — the expert
settings tab, the alarm editor with webhook payload templates, the five device settings components, moved
and left alone. Nothing I use today is taken away and re-imagined by a designer. For a suspicious user
that is a feature.

Fourth: the `Jetzt` screen is composed from **capability, not `device_type`** (§9, Promise 2). My fridge
build is a set of measures and roles, not a tent. Nothing in the concept assumes a grow tent's geometry.

**Fatal flaws.**
- **Still no write API for outputs.** §16.11 admits it: *"the DIY closed-loop builder wants a write API
  for outputs, custom sensor measures and custom config keys, and gets none of the three in v1."* The
  product owns the hardware — the one structural advantage over Pulse Grow, which is read-only — and
  spends it on nothing.
- **`VALID_SENSORS` stays hard-coded.** My soil-moisture probe enters as a `GrowEvent.measure` and charts
  as dots on a nutrient panel. That is not a series, and I know it.
- **The v1 list is fifteen items for six weeks.** The API is item 14 of 15. When this slips — and §16.8
  already concedes the ECharts migration and the Simple gear compete for the same October — item 14 is
  what gets cut. I have no reason to believe the API ships, and every reason from the rest of the
  industry to believe it doesn't.
- **Per-user gear, not per-device (§16.7).** I own a controller and three plugs. One gear for all of them.
- **The two-shell split is maintenance debt I will eventually pay for**, in the form of Pro screens that
  stop getting attention because the Einfach screens are what demos.

**Steal.** The v1 API + generic webhook scoping decision, verbatim. `uiGear` persisted server-side. "The
Pro gear is a re-roof, not a rewrite." The honest `Ohne Funktion in dieser Firmware` label on controls the
firmware ignores. Capability-composed home screen.

---

### 2. C01 — Loupe (die Lupe) — **70**

> One screen, one time axis, zoom is the only verb.

**Why it is close.** `Präzision` (§12, `?precision=1`) is the best techie affordance in the whole set and
it is **in v1**: exact from/to, arbitrary interval with a server-side clamp, aggregation method
**including `raw`**, per-lane axis min/max override, `Als Tabelle anzeigen`, a copyable box containing the
live query string, and **CSV export of the visible window including actuator state**. That last item is
the thing an AC Infinity reviewer asked for by name and no vendor in this market ships. It is one
long-press away and it costs the stoner zero pixels.

Better still: **"Lanes by raw field name from `VALID_SENSORS` / `VALID_OUTPUTS`."** That is the only place
in ten documents where a user is allowed to name a measure and get a lane. It does not widen the
allowlist, but it hands me the whole existing vocabulary without asking a designer's permission first.

And §11 Type 5 promises *"an honest 'kommt' page with the read endpoints and **the documented
cloud-outage behaviour**"*. That clause is the only appearance of the single most important sentence this
product could publish, in any of the ten concepts. It is a clause in a walkthrough rather than a designed
artefact — but it exists.

Structurally the timeline is capability-derived, fails **closed** on unknown hardware, renders no lane the
hardware cannot produce, and has no notion of a tent anywhere. It works for a fridge by construction.

**Fatal flaws.**
- **No API in v1 at all.** The API page is an honest placeholder; `x-api-key` read/write lands in **v2
  (2027)**, alongside Home Assistant. That is fifteen months of me exporting CSVs by hand.
- **Webhooks only through the alarm editor.** §11 has me pointing an alarm webhook at my own ntfy
  instance. That machinery fires *only on alarm state transitions* — the dossier is explicit that there is
  **no generic event bus** — so I cannot get a push when a socket switches, when a config changes, or on a
  schedule. C04 fixes exactly this and C01 does not.
- **Everything is on one screen with one performance budget (§15.3).** ECharts canvas + DOM film strip +
  DOM event rail + DOM output lanes + a 10 s live refresh, and the author says so. My chart is now
  competing with a camera film strip I did not ask for.
- **The `TimeScale` canvas/DOM alignment (§15.4) is the concept's load-bearing hack**, and the author
  concedes sub-pixel drift makes thumbnails lie about when a picture was taken.
- The gauge dies, the drawer is where the mess was hidden (§15.11), and no fallback exists once `/charts`
  and `/diary` become redirects (§15.9).

**Steal.** `Präzision` in its entirety — raw aggregation method, table view, CSV with actuator state,
copyable query string, per-lane axis override. Lanes addressed by raw Influx field name. The clamped
`windows = (to−from)/interval` server-side bound. "A techie affordance may never add a control to the
default surface" — that rule is correct and every concept should adopt it.

---

### 3. C10 — Durchgang (Run Over Run) — **58**

> The root object is a run; every number carries what it was on the same day last time.

**Why it places.** Three things nobody else did.

First, **`GET /run/:run_id/stats.json` and `.csv`, including actuator state, over a documented,
`statVersion`-tagged schema, in v1.** That is a versioned data contract, not a download button. A
versioned schema is the thing I can build against without fear that a refactor silently changes my
numbers — and `statVersion` explicitly exists so *"a formula change recomputes rather than silently
disagreeing with the chart"*. That sentence was written by someone who has been burned.

Second, **the run generalises to a period** (§9): "the comparison engine's unit is a *period*. A run is
just the interesting kind of period." A plug gets week-vs-week on the same code. My drying chamber gets a
`drying` run with a day counter, 18 °C / 58 % drawn as targets, and **run-over-run comparison of dry-down
curves** — which is the only feature in ten documents that was built for a non-tent closed loop and which
I would genuinely use for a cheese cave.

Third, the privacy architecture (§8.3) is the correct posture and it is *structural*: comparison reads
~200-byte per-day summaries, never raw Influx, so **the product can delete raw telemetry and still work**.
Retention becomes a feature rather than a setting. Panic delete is two taps. Outcomes default to
"Nicht speichern". This is the only concept whose data architecture is designed around the assumption
that the cloud is a liability.

**Fatal flaws.**
- **The core value arrives at run 2, three to five months out.** §15.1 says it first and calls it "the
  most serious objection". My fridge does not have runs; it has a setpoint I hold for a year.
- **One run per device with one day-0** (§15.5) is a cannabis-cycle-shaped object. Staggered plants break
  it. A perpetual closed loop breaks it worse.
- **No API beyond the stats export.** No webhooks, no key management, no Home Assistant, no write path.
  Multi-user is cut entirely; so is everything integration-shaped.
- **`RunDayStat` is a derived cache** (§15.7) that can disagree with the chart, needs backfilling, and
  shifts by hours if `Run.timezone` is wrong. I will find that discrepancy and I will not trust either
  number afterwards.
- Min/max envelope is **"primary panel only, 3 queries"**. For a bang-bang builder tuning hysteresis,
  every panel is the primary panel. That saving is taken out of exactly the thing I am looking at.

**Steal.** `stats.json` + `.csv` with actuator state, versioned by `statVersion`. "The comparison unit is
a period." Summaries-not-raw as the retention architecture. The drying-run comparison. Grey reserved
product-wide to mean "a different run" — a semantic colour rule, not a palette entry. The
`geplant vs. gemessen` hairline that makes a failed contactor visible.

---

### 4. C06 — Glance Tiles — **53**

**Why it places.** The evidence rule. *"A tile exists when the evidence for it exists"*, and — the part I
care about — `generic:<m>`: **any measure with points but no rule gets a value, a unit, a sparkline and no
goal bar.** That is the correct default for a device reporting something the catalogue does not know, and
it is the exact opposite of today's literal-array-inside-a-1205-line-component. C06 is also the only
concept that specifies a proper batched `GET /data/board/:device_id` returning **per-measure timestamps**
and a `serverTime` — "never trust the phone's clock" is a line written by someone who has debugged this.

Techie surface is real if thin: the freshness chip's `title` carries the exact sample timestamp *and the
server/browser clock skew*; the chart URL is an explicitly hand-editable view model; resolution override
clamped to ≤5,000 windows; the Technik tile detail exposes socket roles, IPs from `socketIpFromCsv`, duty
cycles and last-command failures. Nothing about the board assumes a tent.

**Fatal flaws.**
- **`/account/api` with `x-api-key` and outbound webhooks is v1.1**, and the reason given is that the
  webhook machinery needs an SSRF guard, a timeout and a queue first. Correct, and it is still v1.1.
- No CSV export named in v1 anywhere. "View as table" is not an export.
- The §11 Type 5 walkthrough has me logging a soil probe as a `measure` journal entry and calls it "a
  workaround, and he knows it". Yes, I do.
- **The drag-and-drop grid is the most likely thing to be cut (§15.4)** and it needs `@angular/cdk` added
  to a repo with none, fighting Ionic's gesture layer. When it goes, the concept's answer to seven user
  types degrades to "we picked a good default order".
- Auto-provisioning is non-deterministic from where I sit (§15.3): `hardwareInfo` is a free-form
  `Record<string,string>` filled from MQTT log lines, and "produced a point in 48 h" is a query that can
  flap. A tile that appears and disappears is a tile I stop believing.

**Steal.** `generic:<m>` — never hide a measure you do not recognise. `GET /data/board` with per-measure
timestamps + `serverTime`. Clock-skew in the freshness tooltip. "Grey is reserved: grey means I do not
know, and it is used for nothing else." The prohibition "no tile has settings — a gear icon on a tile
means this concept has failed."

---

### 5. C08 — Shared Grow — **44**

**Why it places this high at all.** One structural idea earns it: **a Grow spans zero or more devices, and
the chart draws one panel per device per measure, labelled by device name — never an average**, because
"averaging two sensors in different corners of a tent is a fabricated number." I run two boxes. Every
other concept gives me two unrelated device pages; this one gives me one record and refuses to lie about
which probe said what. §14 non-goal 13 — *"No fabricated numbers. No DLI without a light sensor, no
averaged multi-device temperature, no bare ppm without its scale, no 'state: off' for an offline
device"* — is the most trustworthy paragraph in the ten documents.

The freshness table's output row is right for the same reason: an offline device's sockets read
**`Zustand unbekannt`**, not `off`. That distinction is the difference between a diagnostic and a lie.

**Fatal flaws.**
- **Everything I need is v1.1**: per-grow API key, documented read/write API, OpenAPI, outbound event
  webhooks, Home Assistant recipe, **CSV export including actuator state.** §15.9 states it plainly: "In
  October they get a min/max envelope and a journal."
- **The entire v1 budget goes to an authorisation rewrite** — a membership collection, `auth.middleware`
  `:172` and `:207`, ~20 owner-scoped queries, invite flows, role gating — for a segment I am not in.
  §15.1 concedes this is "the most expensive single line item in the whole redesign".
- **The Visit is dead weight for me.** My fridge does not have visits. §15.2 admits the metaphor may not
  survive a solo grower walking past a tent eight times a day; my case is worse — it never fires, so the
  PERSONEN lane is a permanently empty 22 px band and the excursion-attribution feature that supposedly
  pays multi-user back at n=1 pays me nothing.
- §15.6 names the highest-probability way this damages something that works: the grow-scoped alias layer
  silently breaking saved share links and chart presets, against 38 `it()` blocks and a CI that never runs
  them.

**Steal.** One panel per device per measure, never averaged. `Zustand unbekannt` on outputs when the
device is offline. Non-goal 13 as a product-wide rule. Corrections-not-edits (`correctsEventId`) instead
of hash chains.

---

### 6. C05 — Thumb Journal — **39**

**Why it is not lower.** It gives me one thing nobody else does: `POST /journal/:device_id` accepting a
`measure` payload from my own script — my EC probe, my soil moisture, my reservoir temperature — landing
on the chart as points and in the thread as entries. That is a write path in v1, even if it is a write
path for *events* and not for sensors or outputs. §12.3 also correctly identifies that publishing a clean
JSON diary schema makes Terp Control the first in the category and costs one documentation page.

**Fatal flaws.**
- **The chat metaphor fights analysis, and §15.1 says so.** My numbers are a 72 px strip and everything
  else is prose bubbles. I do not open this app to read a story about my fridge.
- **`x-api-key` + OpenAPI is v1.1**, contradicting §12.3's implication that it exists. §13 is the truth.
- §15.7: *"A write API for events is not a read/write API for sensors and outputs."* Correct.
- **One-tap logging degrades data quality by construction (§15.2)**, and the recovery screen (`/tidy`) is
  a desktop table shipped in v1.1. For a user whose whole complaint is data fidelity, "more entries, each
  thinner" is the wrong trade.
- **"Same as last time" ossifies mistakes (§15.3)** — a bad value becomes the silent default forever. In a
  product I would build a script against, that is a data-integrity bug wearing a UX feature's clothes.
- Row explosion: 800–1,500 entries per 12-week grow (§15.9) into a diary with no server-side pagination
  today.

**Steal.** `POST /journal` with a `measure` payload and a `clientId` idempotency key. The published JSON
diary schema as a deliberate first-mover play. `/tidy` — a dense keyboard table is the right shape for
repairing data, and no other concept has one.

---

### 7. C02 — The Verdict — **34**

**Why it is here.** The scorecard sheet is genuinely good engineering: TIR as a **dwell-time integral over
consecutive raw sample pairs**, `range() |> filter() |> sort()` with **no `aggregateWindow`**, MAD from
the stepped setpoint, longest excursion in seconds, coverage as a first-class number, and the honesty line
*"aus 17 214 Rohmessungen · 5-Sek-Raster"* printed on the sheet. §11 has me reading that line and deciding
the number is trustworthy. That is exactly right, and it is the only place any concept shows me its
denominator.

**Fatal flaws.**
- **§15.5, verbatim: "The techie is actively annoyed by this design and 'Start auf' is a thin answer …
  it is not a strategy — it is an apology."** I did not write that; the author did. Believe them.
- **The whole product is a computed judgement of my grow from thresholds the author admits are
  invented** (90 % / 70 % / 60 min / 180 min, §3.2, flagged in a block quote). Making them editable is
  how a designer avoids defending a number — §15.9 says that too.
- No API, no webhooks, no custom measures, nothing integration-shaped before **v2**.
- **§13 is the worst scoping in the set for me:** the chart rewrite, ECharts, plants, journal, feeding,
  multi-user, film strip, VPD matrix are *all* out of v1. October ships a verdict card sitting on top of
  today's fifteen translucent hidden axes. §15.4 concedes it: "the concept's most quotable line is the
  part that ships last."
- The verdict headline is deliberately narrowed to "climate" while the thesis asks "is my grow OK". §15.2
  calls that a bait-and-switch and does not refute it.

**Steal.** The raw-sample TIR contract and the "aus N Rohmessungen · 5-Sek-Raster" provenance line — put
it under every derived number in whatever wins. The band-source label (`Quelle: deine Alarmgrenzen`)
shown on screen, always. `advisory: boolean` on a channel the hardware cannot change, and the rule that an
advisory channel never drives the headline.

---

### 8. C09 — The Tent / Das Zelt — **31**

**Why it is not last.** The **Schema skin** is a real thing and it is in v1: the same scene rendered as an
engineering diagram with `socket dehumidifier 192.168.1.45 ON 3:12`, `day.temperature=25`, firmware id,
camera did, `lastseen`, ages in seconds — and deliberately showing the **dotted configuration keys**
because *"a techie reading Schema can drive the device from a shell."* That is the single most
techie-literate paragraph in ten documents.

C09 is also the only concept that **asks for the one firmware change that would help me**: adding
`other1/other2/other3` to `getSocketRolesList()`, noting the NVS key helpers already exist at
`firmware/src/wifi.cpp:1680-1682` and are simply not in the roles vector. Someone read the firmware. That
converts my DIY fan and humidifier from decorations into things that at least report a switch state.

**Fatal flaws.**
- **This is the concept my brief tells me to punish, and it deserves it.** §11 Type 5, verbatim: *"Half
  his tent is outline… The Tent gives him a picture of things it cannot see. Schema is a consolation, not
  an answer."* My kit renders as **props: flat outlines that by rule can never take a state colour.** The
  home screen of my €289 controller is a drawing of a room I do not have, containing icons for machines
  the app has explicitly told me it cannot see.
- **The documented read/write API is v2.** Furthest out of any concept.
- **§15.4 is the killer and the author names it: "a wrong picture is more harmful than a wrong list."**
  A convincing wrong model is worse than no model, and the prop rule depends on users reading a visual
  convention.
- **The art is a hard dependency with no graceful degradation (§15.1).** Five templates × two skins ×
  light/dark × legible at 320 px, and if it is late "it ships as boxes, and boxes are worse than today's
  gauge grid."
- Landscape phone does not work (§15.6). Screen readers get a second parallel UI to maintain forever
  (§15.5). Performance on mid-range Android is an unmeasured risk (§15.8). §15.10 concedes it may simply
  read as a toy against TrolMaster.

**Steal.** The Schema skin, wholesale — same layout, engineering rendering, dotted config keys verbatim,
one persisted toggle. The `other1/other2/other3` firmware ask, with the file and line numbers. The
`pwmUse: 'lamp' | 'exhaust'` question — nobody else noticed that `out_light` is freely assignable and that
`is_day` inferred from `out_light >= 0.5` becomes nonsense if I hang a fan on the dimmer. That is a real
bug found by having to draw the thing.

---

### 9. C03 — Beet (The Bed) — **28**

**Why it is this low.** The root object is a plant. My root object is a control loop. §15.4 concedes
*"C03's root object is the wrong noun for him, in v1 and after"* — and it is right. `PLANT_CAPABLE =
['controller','fridge','fridge2']` means a fridge is presumed to be a grow space; `plantsHidden` is a
per-device escape hatch bolted on after the fact, and an escape hatch from the home screen is not an
information architecture.

**Fatal flaws.**
- **v1 ships on Highcharts** (§4.4), deferring the migration to v1.1, in a repo with **no LICENSE file**
  that markets its cloud as *quelloffen* and runs a public no-login demo. I will notice this. I will
  notice it publicly. Every other concept treats the licence as decisive; this one defers it and calls it
  the owner's decision. It is, and shipping proprietary Stock into an "open source" cloud for another
  release is still the wrong call — §15.10 admits the decision "could be wrong in both directions."
- API, webhooks and Home Assistant are **v1.1**; §11 Type 5: *"He will not be happy in week one."*
- Four new collections plus memberships plus grow settings in six weeks against a red suite (§15.3), and
  a backfill that will "produce some wrong-looking history" (§15.5) — the support category is literally
  *"the app rewrote my diary"*.
- §15.1 names the tax honestly: "you put a plant between a man and his thermometer."
- The conflict banner (§15.2) advertises a problem the hardware cannot solve, permanently, on my home
  screen.

**Steal.** The equipment page (`/device/:id/equipment`) — per-role socket truth and IPs split out of the
settings monolith, which is where that belongs. The `readings.where` requirement (`input | runoff |
reservoir | soil`) as *mandatory* on every EC/pH entry. `equipmentDeviceIds` — attaching an old plug to a
grow as a named lane on the chart is a genuinely good upgrade story that needs no firmware. And
`/device/:device_id/log` as a real system-event page separate from the diary.

---

### 10. C07 — Der Plan — **23**

**The sentence that ends it.** *"`device.configuration` stops being the truth and becomes a **compiled
artifact** — what the plan renders at time T."*

That is the single most alarming sentence in all ten documents from where I sit. My device's own
configuration is demoted to an output of a cloud object, on a controller that has a physical display and a
rotary knob. When I turn that knob, the app raises a **drift dialog** asking me whether to
`Plan anpassen` or `Plan wiederherstellen` (§14a). Every manual change I make to my own hardware is now a
negotiation with a cloud document. §15.8 concedes it: *"a concept where the device config is the truth
never has that conversation."*

To its credit, the drift detection is better than today's silent overwrite, and the "the compiler is
inspectable" page (`Was der Controller bekommt`, showing the exact 15 firmware-read keys and marking the
ones the firmware ignores) is a good idea I would steal. But the direction of authority is backwards, and
for a user whose stated fear is cloud lock-in, backwards is disqualifying.

**Fatal flaws.**
- **Cloud plan authoritative over device config.** See above.
- **§15.5: the plan's vocabulary is cannabis photoperiod vocabulary.** Stages, gates, flip, bloom week. My
  cheese cave gets a one-stage `Dauerbetrieb` plan that "works mechanically and reads as ceremony". The
  author's word, not mine.
- **`Plan als JSON` — the entire techie answer — is v1.1**, and so is the read/write API, the feed engine,
  attribution, webhooks, and the film-strip sprite.
- **§13 admits the chart may not ship in October at all**: "v1 is Tier 0 + Tier 1 and the chart ships in
  November." The thing the owner explicitly asked for is the thing scheduled to slip.
- Ramps compiled into up to 60 sub-steps (§15.3) means two representations of the same object, one
  generated, in a codebase with no test suite. I will open the Expert recipe editor, see fourteen steps I
  did not create, and stop trusting the plan.
- The override sheet taxes the single most common thing I do — turn a number down (§15.1).

**Steal.** `Was der Controller bekommt` — show me the exact config keys a screen produces and mark the
ones the firmware ignores. `planOwnedKeys` + merge-a-patch instead of `RecipeStep.settings` overwriting
the whole configuration; that is a genuine fix to a real destructive bug regardless of which concept
wins. Gates with `graceDays` that never halt climate — only advancement.

---

## What nobody got right

These are needs of mine that **not one of the ten** met. This is the useful part.

**1. A write API for outputs — designed, not deferred.** All ten defer it; several call it "a real safety
question" and stop there. Nobody designs the safe version: a scoped key, a rate limit, an interlock model,
an explicit conflict rule against the workmode state machine, and above all a **dead-man's timer** — if
the API stops talking, what does the socket do? Terp Control *owns the hardware*. Pulse Grow's API is
read-only precisely because they do not. That asymmetry is named in the dossier as the structural
advantage, and every one of the ten concepts spends it on nothing.

**2. Custom measures, and the obvious minimal design nobody wrote.** `VALID_SENSORS` is a hard-coded
allowlist and the chart catalogue is a literal array inside a component. All ten note this and all ten
refuse to fix it, pushing my EC/soil-moisture/reservoir probe into a manual diary entry. The minimal fix
is not hard and nobody proposed it: **a per-device declared measure registry** — `{key, unit, min, max,
label_de, label_en, colour}` stored cloud-side — that the ingest path validates against. That single
change would let me name `res_temp` and get a real Influx series, a real lane, a real alarm and a real
export — *and it fixes the Flux injection everyone promises to fix anyway*, because the allowlist becomes
data instead of string interpolation. Ten concepts, zero proposals.

**3. MQTT, or any inbound integration path at all.** The device bus is RabbitMQ with the MQTT plugin and
it is server-internal. Not one concept proposes a per-device read-only MQTT topic, a local broker mode, or
a Home Assistant MQTT-discovery payload — the cheapest possible integration and the one every DIY builder
actually asks for. Every concept reaches for **outbound webhooks** instead, which are one-directional and
require me to expose a public endpoint. Webhooks are a good Tier 0; they are not the answer.

**4. The cloud-death page.** *"The firmware is open source with a documented REST API"* is on the homepage
and is the single strongest anti-Grobo argument this company owns. Exactly one clause in one walkthrough
(C01, Type 5) mentions "the documented cloud-outage behaviour", and it is a bullet in a placeholder page.
Nobody designs the artefact: **what my controller keeps doing when terpcontrol.cloud is unreachable, how
long it keeps doing it, what it forgets, how I point it at my own broker, and what the local REST endpoint
is.** Meanwhile every single concept *deepens* cloud dependence — plants, journals, feed plans,
memberships, run stats, scene layouts, all "cloud-side MongoDB keyed by `device_id`", because the firmware
strips unknown config keys. Ten concepts moved my grow's entire record into a database I do not control
and none of them wrote the paragraph explaining what happens to it when the company stops.

**5. A panic *export*, not just a panic delete.** C10 has a one-confirm wipe. Several have one-tap wipe.
**Nobody has "export everything I own — Mongo entities, Influx series, images — as one archive."** Delete
without export is the wrong half of data portability, and GDPR Art. 20 is not the reason to build it; my
suspicion is.

**6. A first-class non-cannabis, non-photoperiod loop object.** Every "goal" in every concept is a
day/night setpoint pair driven by a grow stage with a VPD band. My fridge holds 12 °C / 85 % indefinitely.
A dry chamber is a *schedule of setpoints over days*. A mushroom chamber needs FAE cycles the socket model
cannot express. The closest anyone gets is C07's one-stage plan (which it admits is ceremony) and C10's
drying run. **Nobody ships a "hold this, forever, tell me when it drifts" object with no stage, no plant,
no strain, no flowering week — and the same charts, the same bands, the same time-in-range verdict.** It
would cost less than any plant model in this pile and it would serve types 1, 3, 5 and 7 at once.

**7. `out_dehumidifier` doubling as the cooler: labelled by all ten, fixed by none.** Every concept prints
an honest sentence about it. Honest is not fixed. It means one chart series, one alarm `sensorType` and
one export column covering two physically opposite acts, so my historical data is permanently ambiguous —
I cannot ask "how much did I spend cooling last August". The cheap fix needs **no firmware**: derive two
cloud-side series at ingest by splitting on the active `workmode`, so `out_cooler` and `out_dehumidifier`
are separate columns everywhere downstream. Nobody proposed it. Ten concepts chose to describe the wart
instead of removing it.

**8. The min/max envelope is rationed to "the primary measure".** C10 says primary panel only, three
queries. C04 makes it conditional in the Simple gear and admits (§16.4) a controller cycling ±0.4 °C
inside a ±1.5 °C band becomes invisible — "exactly the signal that a heater is short-cycling itself to
death." For a bang-bang builder, **every panel is the primary panel.** The saving is taken out of the one
encoding I am actually reading.

**9. No raw-sample view anywhere.** All ten promise time-in-range computed server-side on raw samples —
correctly, repeatedly, with the right warning about `aggregateWindow(fn:mean)`. Then they hand me a mean
line with an envelope. Only C01 lists `raw` as a selectable aggregation method. **There is no "give me the
5-second samples for this 10-minute window" in any concept**, and that is precisely the view that shows a
relay chattering.

**10. Nobody costed the API as a *product surface* rather than a feature.** Versioning, deprecation
policy, quota, an OpenAPI file in the repo, a changelog, and a stability promise. C10's `statVersion` is
the only versioning primitive in the entire set and it applies to one collection. If the API ships without
those, I will build against it, you will change it, and I will write the blog post.

---

## Dealbreaker test

**In the October build, on hardware I just unboxed, without contacting support and without reading a
designer's mind: can I get the last 24 hours of my device's *sensor values and actuator on/off state* out
as timestamped machine-readable data, and point a credential or a webhook at my own system — and is there
a written, linkable page telling me exactly what my controller keeps doing when terpcontrol.cloud is
gone?**

Three parts, all three required, all three in v1. If any part is "v1.1", "v2", "kommt" or "the owner will
decide", the concept has not passed — because that is the exact moment I stop evaluating your app and
start writing my own.

Scoring against it as written: **C04 passes two of three** (read API + generic webhook in v1; no
cloud-death page). **C01 passes one and a half** (CSV with actuator state and raw aggregation in v1; the
cloud-outage page exists only as a clause). **C10 passes one** (versioned stats.json/.csv with actuator
state). **The other seven pass none.**
