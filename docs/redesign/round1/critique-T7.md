# Critique — User Type 7: the old-device owner (air, light, socket, fridge grow)

**Who is writing.** I bought Terp hardware before the controller existed. I have a fan, a lamp, a smart
socket, and a converted fridge. I know I am not the focus group; the product owner said so in the brief and
I do not need to be flattered about it. What I need is stated in the same sentence: *"It should still work
for them and if things change for the better, then it is okay."*

I am the loud one. If an update degrades my working hardware I will say so in the Telegram group, in public,
with screenshots — and the screenshot I already have is a dashboard card that reads **"Terp Control FRIDGE
GROW"** on hardware that is not a fridge, because a €289 controller is being rendered by components named
after my old device. That is the evidence I judge from: this company has already shown it will hang the new
product on my furniture and not notice for a release.

**What I score on.**
1. Does the document actually *say what I see*, per device type, with copy and layout — or does it hand me
   one paragraph of goodwill?
2. Does the redesign **break my screens**, and does the concept promise non-regression as a *constraint* or
   as a *sentiment*?
3. Do I get a chart and a diary that make sense for a device with **one sensor and one output** — or for a
   device with no sensors at all?
4. Am I shown a mass of controller-only machinery — plants, stages, VPD, feeding, socket roles — that I
   cannot use and did not ask for?
5. Does it ship in October, or is my benefit in the "first to be cut" tier?

---

## The ranking

### 1. C04 "Zweigang" — 84

**Verdict:** the only concept that treats my hardware as a first-class output of the general mechanism
rather than as an exception path, and it says so in a sentence I did not expect to read.

§9 is three concrete promises and one refusal, and all four are the right ones.

- **Promise 1** is the non-regression promise done properly: `fan-settings`, `light-settings`,
  `plug-settings`, `fridge-settings` keep their components *verbatim*; only the route changes. It even names
  the reason — no re-QA of five device types' settings forms in one release. That is a scope argument, not a
  courtesy, which is why I believe it.
- **Promise 2** composes my home screen from *capability*, not `device_type`, and then prints the table:
  plug → socket-state ring, **two tabs**, no `Verlauf` because a plug has nothing chartable; fan → RPM ring
  with temp/humidity *if reported*; light → dimming ring with **a 24-hour photoperiod bar as the hero
  element** and DLI. "It shrinks; it never fakes." That is the correct behaviour and it is drawn, not
  described.
- The line that earns the top slot: *"A type-7 light owner gains more from this redesign than a controller
  owner does, which is the honest way to serve a non-focus group: not by special-casing them, but by making
  the general mechanism cover them."* Ten authors had the chance to write that sentence and one of them did.
- **Promise 3** is the one nobody else offers: **plants, diary, feeding and photos work on every device
  type**, because they are cloud-side and keyed by `device_id`. *"A `plug` owner can keep a full per-plant
  grow diary with feeding schedules."* Compare C03, which hardcodes me out of the diary entirely.
- The **refusal** is right too: dead controls (`daynight.floating`, `lights.maintenanceOn`, `co2.sunsetOff`,
  `daynight.linearChange`, `fans.*` for controllers) removed from Einfach and labelled
  `Ohne Funktion in dieser Firmware` in Profi. I have been clicking some of those for two years.
- The failed contactor becomes a **missing day/night band** derived from measured light. My lamp has been
  the least-instrumented thing I own and this is the first time anyone has proposed telling me it failed.
- The full ECharts chart migration is **item 9 of v1**, not a deferred tier. I actually get the chart in
  October.

**Fatal flaws for me.**
- **Gear is per-user, not per-device** (§16.7), and the document names *exactly my account* as the victim:
  "the DIY builder with a controller plus three plugs will feel it, and neither has a workaround." My plug
  wants Einfach forever; my fridge build wants Profi. I get one gear for both, permanently.
- Adaptive tab counts (2 tabs for a plug, 3 for a light) means the app looks different on my devices than in
  every screenshot, every help page and every Telegram answer. "Tap the Verlauf tab" is advice half of us
  cannot follow.
- v1 is fifteen items. §16.8 names the honest sacrifice if it slips: **the Pro chart workbench**. That is my
  chart.
- My settings URL moves (`/device/:id/settings` → `/pro/:id/control`). Byte-identical form, new address, no
  redirect story written for a bookmark I typed in 2023.
- 36-cell test matrix on 38 `it()` blocks, gated on a manual scripted walkthrough that §16.6 admits "gets
  skipped under deadline pressure." Guess which four of the 36 cells get skipped.

**Best parts to steal.** Capability-composed home screen instead of `device_type` switching. The photoperiod
bar as a light-only device's hero element. Promise 3 verbatim — cloud-side journal available on every device
type, with no nagging. `Ohne Funktion in dieser Firmware` as a label instead of silently shipping dead
controls. And the framing principle: serve the non-focus group by generalising the mechanism, never by
writing them an exception path.

---

### 2. C02 "The Verdict" — 81

**Verdict:** the most specific per-device writing of the ten — it invents a real product for a fan with no
sensors — and then defers the chart I most need past the launch it is written for.

§9 is the only section in the bake-off that gives me **screen copy per device type**:

- **`light`:** judged channel is *photoperiod adherence*. `"Licht lief wie geplant. 12 Std 00 Min gestern.
  Geplant: 12 Std 00 Min."` And when the contactor sticks: `"Licht lief 9 Std 40 Min. Geplant: 12 Std."` with
  a `watch` verdict. Plus DLI when a VEML7700 reports lux. **"The tile row is built from available channels,
  never a fixed three."**
- **`fan` with no sensors:** verdict is `nothingToJudge` — *"Nichts zu beurteilen — dieses Gerät misst
  nichts"* — and the card body becomes a runtime lane: *"Lüfter lief 18 Std 20 Min (76 %) · 4 200 U/min im
  Schnitt."* Nobody else wrote a screen for a device that measures nothing. Everyone else quietly assumed a
  sensor.
- **`plug`:** my over/under-temperature and time limits **are** my declared goal. *"Nie über 30 °C. 3
  Schaltvorgänge."* Building that tab forces the fix of the three checkbox i18n bugs that render raw keys on
  my plug today.
- **`dryer`:** three tabs, no Status tab, stated plainly. *"I would rather ship an honest hole than
  pretend."* Correct.
- **`fridge`:** structurally identical to a controller, and — the sentence I wanted — its type label becomes
  correct *because the controller stopped borrowing it*.

And the hard rule at the top of §2.1: **no existing route path changes**, because share links and chart
presets are persisted user data. Combined with §9's "**No legacy device loses a screen**", that is the
strongest non-regression contract in the ten documents. It is stated as a self-imposed constraint with a
reason, which is the only form of that promise I trust.

§11's type-7 walkthrough finds me a real fault in week one — a loose plug, discovered from a photoperiod
shortfall I would otherwise have found in three weeks.

**Fatal flaws for me.**
- **The chart is not in v1.** §13 is explicit and §15.4 owns it: in October the verdict sits on top of
  *today's* chart — fifteen translucent areas on hidden y-axes, axis labels suppressed below 320 px,
  hover-only event columns on a phone. The chart overhaul lands v1.1, December. "The Graph needs some real
  overhaul" was an owner ask and this concept ships it after the hardware.
- 41 person-days for v1, self-described as "already optimistic", against a red suite. Items 7 and 11 hold if
  it slips — which means my four device types get whatever attention is left.
- §15.3's always-amber problem applies to me harder than to a controller owner: a plug or a fan generates
  one or two channels, so a single perpetually-amber tile *is* my whole screen.
- A device that measures nothing still gets a Status tab whose job is to say there is nothing to say. That is
  honest and it is still a tab I open once.

**Best parts to steal.** The judged-channel model: `(something the device measures) ∩ (something with a
goal)` — it is the cleanest reason a plug and a controller can share one screen without either being
embarrassed. Photoperiod adherence as a first-class verdict. The fan-with-no-sensors runtime card. "No
existing route path changes" as a hard rule with a stated reason. The excursion thumbnail.

---

### 3. C08 "Shared Grow" — 78

**Verdict:** the only concept that noticed my devices are in the same room, and the only one that offers me
something I have quietly wanted for three years — at the cost of routing every URL I own through a new alias
layer with no tests behind it.

§9 opens with the promise stated **as a constraint**: *"no route an old-device owner uses today moves, no
setting they rely on changes, and every `ngSwitch` settings component stays exactly where it is."* Then it
earns it with per-device precision that proves someone read my hardware's code:

- **`plug`:** two tabs (`Zelt` · `Journal`), no `Verlauf` *unless* it reports `out_relais` history — and when
  it does, one honest lane: when was it on, with day/night shading from its own timer.
- **`light`:** the schedule drawn as the **setpoint**, the lamp's measured output as the solid lane, and a
  failed contactor as a missing band. Called out as *"a real diagnostic a light-only owner has never had."*
- **`fan`:** and here is the detail that convinces me — *"`fans.external` / `fans.internal` are **real** for a
  fan device — they are only hidden-and-ignored for controllers — so they are drawn."* That is a distinction
  nobody would make unless they had actually opened `firmware/` and `controller.cpp`.
- **`fridge`:** untouched, and *keeps being called a fridge*, "which becomes correct again once the controller
  stops borrowing its identity."

**And the thing nobody else offered: one Grow, several devices.** My light and my fan are two unrelated
device pages with two unrelated log streams today. C08 makes them one Grow with one journal, one chart, one
set of members — and it refuses to average two sensors in different corners of a tent, drawing one panel per
device per measure labelled by device name instead. That is the most original thing written about my
situation in the entire bake-off, and it costs no firmware.

Household multi-user is free, explicitly: *"he invites his partner, free, because that is not a paid seat."*

**Fatal flaws for me.**
- §15.6 is a loaded gun pointed at me: every device route becomes an **alias** that resolves a grow and
  forwards the query string. My bookmarks, my saved chart presets and my share links all go through a new
  translation layer, in a repo with 38 `it()` blocks and a CI that never runs them. The document itself calls
  this "the highest-probability way C08 damages something that works today."
- §15.1: the October budget goes to the smallest segment. The membership rewrite is the most expensive line
  item in the redesign and I do not need it. If it eats the schedule, my chart and my device screens are what
  gets thinned.
- §15.11: two-tab and three-tab variants across my four devices — the same support/screenshot problem as C04,
  compounded because I own more device types than most.
- The Visit spine is machinery I will never deliberately use. The solo degradation is designed (`Leute` is not
  even a menu item at n=1), which is more than most managed, but I still carry an `[Ich war im Zelt]` button
  on a smart socket.

**Best parts to steal.** **One Grow spanning several devices** — this is the single best structural idea for
old-fleet owners in the whole set, and it should survive into whichever concept wins. Non-regression written
as a constraint at the top of the section rather than as a reassurance at the bottom. Per-device honesty
about `fans.*` being real on a fan and dead on a controller. Free second household member.

---

### 4. C05 "Thumb Journal" — 73

**Verdict:** my old components survive verbatim inside a better shell and I get a diary that writes itself,
but the home screen demotes my numbers to a 72-pixel strip and calls it a feature.

§9 is properly done. `<fan-overview>` renders **unmodified** inside the new shell; `<fan-settings>` (199
lines of template) is untouched; "zero rewrite, zero regression surface" and it means it. The per-type table
is concrete. The Thumb Bar reduces to `📷 🎙 ⋯` for fan/light/plug — the watering and feeding buttons are
simply not there for hardware that is not a grow controller, and I can pin them in two taps if my plug is in
fact running a lamp over tomatoes. That is the right default with the right escape hatch.

The **fridge/controller split is done properly and permanently**: the fridge keeps its own components and its
own name *forever*, and `devices/fridge/overview` is forked into `devices/controller/overview` with a real
`devices.controller.*` block in both language files. This is the direct answer to my grievance and C05 states
it as a launch prerequisite rather than a nice-to-have.

The Journal works on my hardware because its machine half is fed by `DeviceLog` + telemetry, which every
device type has: I get a daily verdict card computed against *my* limits, excursions, offline periods. §11
day 4: *"⚠ Licht sollte um 06:00 an sein — kein Licht gemessen"*. That is a fault my current app makes
invisible.

**Fatal flaws for me.**
- The home screen is a chat thread. I open this app to read a number and leave. §15.1 admits it: "Types 1, 3,
  4 and 5 mostly want to know a number. In Thumb Journal the numbers are a 72 px strip and everything else is
  prose bubbles." That describes me too, and the `Jetzt` tab being one tap away is a demotion of what used to
  be the whole screen.
- Navigation moves to the **top** (§15.8) so the thumb zone can be capture. For a plug owner who never
  captures anything, I have traded reachable navigation for a row of buttons I do not press.
- §15.12: the daily machine card becomes wallpaper. On a plug that switches on at 06:00 and off at 00:00
  every single day, the daily card is *identical* every morning by construction. The suppression heuristic is
  "easy to describe and easy to get wrong."
- The six-button device card is gone; Settings moves into `⋮`. One relearn, unannounced.

**Best parts to steal.** Old overview components hosted verbatim in a new shell — the cheapest possible
non-regression. The Thumb Bar defaulting to three slots on non-controller hardware, with pinning as the
escape. The permanent fridge/controller fork with the fridge keeping its identity. The machine-written daily
entry evaluated against a plug's *own* limits.

---

### 5. C01 "Loupe" — 70

**Verdict:** the most precise per-device lane maps in the set and a genuinely capability-driven renderer —
attached to a single-screen bet the author admits has no fallback and no degraded mode.

§9's per-type blocks are the best-drawn in the bake-off. My plug: a relais state timeline, my
`settings.limits.overtemperature` / `.undertemperature` thresholds drawn as **hard band edges**, my
`settings.limits.time` on the day/night lane, and — the detail that shows they thought about it — the zoom
bar loses `Zyklus` and `Läufe` entirely because I have no plants. My light: a PWM lane that is
height-mapped rather than binary, and *the configured schedule drawn as a ghost behind the measurement*, so a
failed contactor is a ghost band with nothing under it. My fan: `rpm` plus `fans.external`/`internal`
targets. My fridge: the full climate set, keeping its workmodes and its stage picker.

The capability model is the strongest in the set: lanes exist only where evidence exists, absent
`hardwareInfo.sockets` **fails closed to monitoring**, and a measure with a sensor but no actuator draws its
band **in grey with the label `nur Beobachtung`**. I am never nagged about a lever I do not own. §9 closes
with the invariant I want: *"Their setup is never migrated and never nagged."*

**Fatal flaws for me.**
- **The gauge dies.** §15.5 owns it honestly: `value-display` — value arc, limit arc, needle, 1-hour average,
  target line, honest `—` for missing data — is demoted to a rule editor's preview. For a fan or a plug with
  one or two values, that gauge *is* the entire UI, and it is the nicest component in the codebase. I am
  handed a scrub header that is "strictly more informative and strictly less pleasant." Some users will read
  it as a downgrade, says §15.5, "and they will not be wrong about the feeling." Correct.
- **My screens are replaced, not re-hosted.** `/charts` and `/diary` become redirects; the device overview
  card is gone; lanes are generated by a new generic renderer. Nothing in §9 says my `fan-overview`,
  `light-overview` or `plug-overview` components survive — unlike C05, C04, C07 and C08, which all say so
  explicitly.
- §15.9: "It bets the launch on one screen with no fallback." My devices are the ones with the least testing
  and the fewest users complaining loudly enough to get a fix. A no-fallback bet is a bet with my hardware.
- §15.1: horizontal time is the single biggest bet in the document, at the centre of the concept. If growers
  cannot find their entries, the premise fails — and the fallback is the vertical list the concept refuses to
  build.
- Semantic zoom (§15.2) = five regimes × N lanes × **5 device types** × 3 restricted modes. My four types are
  four of the five, and they are the four nobody will regression-test.

**Best parts to steal.** Lane-level capability truth with **fail-closed on missing `hardwareInfo`**, and the
grey `nur Beobachtung` band for a measure with a sensor but no actuator. The zoom bar losing regimes that do
not apply to my hardware. The schedule drawn as a ghost behind the measurement — the cheapest contactor
diagnostic anyone proposed. Per-device lane tables written out in full.

---

### 6. C06 "Glance Tiles" — 67

**Verdict:** the most robust answer to "will my weird old device render at all", built on a grid that the
author names as the most likely thing to be cut and on a deletion of the four components that draw my
hardware today.

The evidence-rule model genuinely serves me. My plug gets `Steckdose · An · heute 7 Std 20 Min` plus a
temperature tile whose **goal bar ends are my own over-temperature limits**. My light gets a `Photoperiode`
tile — a 24-hour ring showing the *measured* on-window against the *configured* one, i.e. the failed-contactor
check as a first-class tile. My fan gets an RPM tile with a goal bar against its configured speed. And the
`generic:<m>` rule means *a device that reports something the catalogue does not know about is never
invisible* — which matters more to me than to anyone, because my firmware is the old firmware.

The fridge **keeps its label** — "it is a fridge. The controller stops borrowing it." My three raw-key i18n
bugs are fixed in the same commit "because a plug owner sees them." §11 lets me hide the Journal tile in one
long-press and one tap and never think about it again. All good.

**Fatal flaws for me.**
- §9, third sentence: *"The per-type overview components (`fan-overview`, `light-overview`, `plug-overview`,
  `fridge-overview`) **are deleted**."* Every other concept that treats me well says the opposite. "Nothing
  they concretely lose" is asserted two paragraphs after deleting the four components that render my devices,
  in a repo whose CI never runs tests.
- §15.4: the drag-and-drop grid needs `@angular/cdk` (not in the repo), fights Ionic's gesture layer, "will
  be janky before it is good", and is "the most likely thing to be cut" — and cutting it "guts the concept's
  answer to the seven types." Mine included.
- §15.3: auto-provisioning depends on `hardwareInfo`, "a free-form `Record<string,string>` filled from MQTT
  log lines," and on "has produced a point in 48 h", a query that can flap. My old firmware is precisely the
  flaky-evidence case. A phantom tile or a missing tile is worse than a checkbox list.
- §15.6: `value-display` retired to avoid a third visual grammar, and the document names the cost — "throws
  away the visual familiarity of every existing fridge customer." That is me, named.
- §15.2: the 60×22 px axis-less sparkline is on every tile and is "decoration by §7.2's own standard."

**Best parts to steal.** The `generic:<m>` fallback tile — no measure is ever invisible just because the
catalogue does not know it. Evidence rules (`showWhen`) instead of `device_type` switching. The Photoperiode
ring as a tile: measured window vs configured window. My over-temperature limits as the goal bar's ends.
Grey reserved product-wide to mean "I do not know", used for nothing else.

---

### 7. C03 "Beet" — 62

**Verdict:** flawless non-regression and the single best upgrade idea for my old fleet, wrapped around a
hardcoded list of device types that locks me out of the feature the owner called the selling point.

`const PLANT_CAPABLE = ['controller', 'fridge', 'fridge2'];` — that line is the concept's answer to me. A
fan/light/plug-only account lands on `/devices`, the tab bar is **hidden entirely**, and my
`fan-overview` / `light-overview` / `plug-overview` components are *"not touched — zero regression risk on
hardware that is out of production."* I get the chart overhaul in full in v1, live/stale/offline, log
pagination, a working "Logs löschen", my three raw-key i18n bugs fixed, and a real
`/device/:id/log` system-event page instead of a diary that was never for me (`diary-fridge-log` is a
free-text box on a fan — correct observation).

And then the best single idea for me in the entire bake-off: **`plants.equipmentDeviceIds`**. Attach my old
light to a controller's plant and its *measured* on/off history drives the day/night shading. Attach my old
plug and it becomes **a named lane** — `Umluftventilator` — the first time my smart socket has ever had a
name in a chart. Attach my fan and its RPM becomes a panel. Cloud-side array of device ids plus a second
Influx query, no firmware. That is a concrete reason for me to buy the October controller expressed as a
feature instead of a marketing line, and every other concept missed it.

**Fatal flaws for me.**
- The diary — *"one of the selling points is that it does the diary keeping FOR YOU"* — is denied to me by a
  constant. §9: *"What Type 7 explicitly does not get: a plant card, a feeding schedule, a public grow page."*
  §9's premise is that my devices have "nothing that is meaningfully a grow", which is a judgement made about
  my hardware, not about my grow. C04 and C05 and C08 all give me a journal on a sensorless plug and it costs
  them nothing, because it is cloud-side.
- For a type-7-only account, this concept is **today's app minus its bugs**. §11: "Opens the app and lands on
  `/devices`, which is the page they already know." Nothing improves except the chart. That is the
  most literal possible reading of "should still work for them" with nothing of "if things change for the
  better."
- §11 for me is three sentences and one of them is about a checkbox label. Compare C02's four screens of
  copy.
- v1 ships the chart on **Highcharts** (§4.4), deferring the licence question — which means my one real gain
  is built on a library the concept expects to migrate away from in v1.1. My chart gets rewritten twice.

**Best parts to steal.** `equipmentDeviceIds` — attaching legacy devices to a new controller's record as
named lanes. Splitting `/device/:id/log` (system events) from the diary, because a `diary-fridge-log` on a fan
is nonsense. Hiding new navigation entirely for accounts that have no use for it. Untouched legacy overview
components as a stated zero-regression position.

---

### 8. C10 "Durchgang" — 56

**Verdict:** two genuinely excellent gifts for old hardware sitting on top of a thesis that is worth nothing
to me, and the document says so itself before I can.

§15.6, in the concept's own words: *"**Day-of-run is the wrong axis for types 5 and 7**, and the 'a run is
just a period' generalisation is a **patch over that, not a design**. A plug owner comparing this week to
last week is a thin feature wearing the clothes of a thick one."* I agree, I have nothing to add, and I note
that a fourth of the navigation (`Vergleich`) is dedicated to that thin feature on my devices.

What is genuinely good:

- The **geplant-vs-gemessen hairline** on the day/night band. §11: my light owner *"discovers, in week one,
  that his timer has been firing 20 minutes late since March."* That is the single most concrete diagnostic
  sentence written about my hardware anywhere in the ten documents, and it is free — the schedule is already
  in config and the measurement is already in Influx.
- **Trocknungs-Lauf.** A fridge or a controller in `dry` workmode starts a drying run, gets the 18 °C / 58 %
  targets drawn, and gets **run-over-run comparison of dry-down curves**. Growers argue about dry-downs
  constantly and nobody ships a comparison of two. §9 frames it as "real value delivered to the type
  explicitly excluded from focus, using machinery built for someone else." That is exactly the right
  instinct, and it is the only place in the ten where my exclusion is treated as a design constraint that
  produces an idea rather than an apology.
- The naming fix goes further than anyone else's: it removes the **fridge's workmode vocabulary** ("Kleine
  Pflanzen", "Gewächshaus") from controllers, not just the title string.
- "He never sees the word `Lauf` unless he starts one."

**Fatal flaws for me.**
- The spine is worthless on a plug, a fan and a lamp. I do not run cycles on a smart socket. §15.1 already
  concedes the core value arrives at run 2, three to five months out — and for me there is no run 2 at all.
- v1 cuts multi-user, the public link and the update destinations, so the cheap high-ROI items I might have
  used are gone, and what remains for me is a week-over-week comparison of runtime hours.
- Four fixed tabs on a device that justifies two. `Vergleich` is dead weight in my thumb's primary reach.
- §9's table gives my plug "one panel: the output state lane, full width" and my fan "RPM/day, week vs week."
  That is thinner than C02, C04, C06 and C08 offer, and it is the whole of what I get.

**Best parts to steal.** The **geplant-vs-gemessen hairline** — steal this into whichever concept wins, it is
half a day of work and it finds real broken hardware. The **drying run** as a first-class comparable period
for fridge and `dry`-workmode owners. Removing the fridge's workmode vocabulary from controllers, not just
the label. `#999999` reserved product-wide to mean "a different run", never a measure.

---

### 9. C07 "Der Plan" — 53

**Verdict:** my settings survive and my tasks work, but the chart I need is in the tier the author labels
"first to be cut", and I am handed a `Plan` tab on a device that has no plan.

The good: §9 states it plainly — *"I do **not** rewrite `fan-settings`, `light-settings` or
`plug-settings`. They are wrapped in the new chrome and left alone."* Tasks, plants and the feed programme
are cloud-side and therefore work on my hardware even though it has no sensors, which is the C04 Promise-3
instinct arrived at independently. My plug's plan band collapses to a single pill — `Dauerbetrieb · seit
14. Mai` — and the Plan tab's content is a button that opens the settings form I already know. Six i18n bugs
fixed. Liveness everywhere.

**Fatal flaws for me.**
- §13 puts **the entire chart overhaul in Tier 2**, described as "first to be cut", and §15.7 predicts the
  realistic outcome: *"October ships Tier 0 + the Jetzt screen + the plan compiler, and the chart — the thing
  everyone will judge the redesign by, and the thing the owner explicitly asked for — lands after the
  hardware."* The chart is the majority of what a fan/light/plug owner gets from this redesign. This concept
  plans to cut it.
- Four fixed tabs, one of which is `Plan`, on a smart socket. §15.4 concedes the point for type 1 — "the tab
  bar still has a Plan tab that says nothing" — and it is worse for me, because I have *four* devices each
  carrying a permanently near-empty Plan tab. This is the "mass of controller-only features I cannot use"
  failure mode expressed at the navigation level, where I cannot avoid it.
- §14a rewrites `configureDevice` to merge a patch instead of applying a whole configuration. That is
  correct, and it is surgery on the write path that reaches *my* devices, with no test baseline, in service
  of a feature I will never use.
- The per-type table in §9 is a table of what degrades, not a description of what I see. No copy, no layout,
  no screen. Compare C02.
- Drift detection is a strength for a controller with a rotary knob and a plan; on my plug it is one more
  concept I have to hold.

**Best parts to steal.** The compiler-is-inspectable idea — *"Was der Controller bekommt"* showing the exact
15 firmware-read keys a screen renders, and marking the keys the firmware **ignores**. Every dead-control
discussion in the other nine concepts would be better as this screen. Tasks and plants as cloud-side objects
available on sensorless hardware.

---

### 10. C09 "Das Zelt" — 46

**Verdict:** the concept writes my scenes lovingly and then tells me, in its own weaknesses section, that my
scenes are the first thing to be cut — and its home screen is, by its own admission, less informative than
what I already have.

The drawings are charming. My fridge becomes a box with a door on the right and built-in actuators drawn as
fixed internal parts (correct — my fridge's actuators are not furnishable sockets). My plug becomes a socket
with its schedule and its over/under-temperature limits, and the three raw-key i18n bugs are named and fixed
right there. My fan becomes a duct with live RPM. My lamp glows in proportion to `out_light` and grows a DLI
readout when a lux sensor exists. §9.6's non-regression promise is real: the expert settings page keeps its
`ngSwitch` shell and per-type components verbatim.

Then §15 happens.

**Fatal flaws for me.**
- §15.1, verbatim: *"the four legacy templates (§9) are **pure cost with no strategic upside** — they exist so
  type 7 is not abandoned, and **they will be the first art to be cut and the first thing critics point at**."*
  The concept has planned my abandonment and written it down. There is no more direct way to be a footnote.
- §15.3: *"type 7 never sees the idea at all. A plug is not a tent. He is served correctly, by the renderer,
  which means the concept's answer to a whole user type is 'our exception path is good'. That is defensible
  and it is also thin."* And §11: *"Honestly served, not centrally served."* Agreed, and it is disqualifying.
- §15.2: a picture is less information-dense than today's 2×2 `value-display` grid. *"For a user who opens the
  app to read numbers and leave, the tent is **strictly worse than what exists**."* For a fan, that is
  precisely what I do.
- §15.1's fallback: if the illustration commission is late the concept "ships as boxes, and boxes are worse
  than today's gauge grid." My four templates are the ones a delayed illustrator drops first, so my most
  likely outcome is boxes.
- §15.4: a wrong picture is more persuasive than a wrong list, and the reconciliation machinery only covers
  the five roles the firmware reports — my old firmware reports none of them, so my scene is my own
  declaration rendered as fact.
- It asks for a firmware change (`other1/2/3` socket roles). Not for me — for type 4. My firmware gets
  nothing and my devices still fall into the `hardwareInfo === undefined` branch forever.

**Best parts to steal.** The **prop rule** — an object the app cannot verify is drawn flat and *never takes a
state colour* — is the best single honesty primitive in the ten documents, and it generalises far beyond
pictures. The **discrepancy states**: `Ghost` (something is plugged in that isn't declared) and `Silent`
(something declared isn't answering) with a `Kurz testen` button. The **Schema skin** as a complete
alternative rendering built from CSS and text only — that is also a real accessibility answer and a real
lifeboat. And the fail-closed rule stated correctly: *"Fails to the user's declaration, never to
'everything'."*

---

## What nobody got right

Six things I need that **not one of the ten** delivered.

**1. Nobody made a support commitment to hardware that is out of production.**
Ten documents, thousands of lines, and not one sentence saying how long my fan, my lamp and my socket keep
working, what happens to them when the cloud schema moves on, or what the company does if a release bricks
them. Several concepts promise to publish "cloud-outage behaviour" — always to type 5, as an API document,
never to me as a commitment. The dossier itself notes that every experienced grower has watched Grobo, Seedo,
Cloudponics and Leaf brick themselves. I am the person who has watched that. A single line — *"devices sold
before 2026 are supported until at least X, and here is the offline behaviour if the cloud goes"* — would be
worth more to me than any screen in these documents, and it is free.

**2. Nobody designed the screen an old-fleet owner actually opens.**
Every concept's home is scoped to one device (or, in C08, one grow). My account is four heterogeneous
devices: a fan, a lamp, a socket, a fridge. In every single concept, the multi-device screen is an
afterthought — `/list`, `/devices`, `/grows`, `Das Regal` — a grid of cards or thumbnails with no verdict, no
freshness roll-up, no "which one of these is broken right now". C09 openly admits `/tents` "works to perhaps
eight before it should honestly become a list." C02 gets closest with a Verdict Board of one row per device
and then spends the section on clubs. The first screen I see, every time, is the least designed screen in all
ten documents.

**3. Nobody said whether my firmware will ever report what the new UI needs.**
Nine of ten concepts correctly make capability **fail closed** when `hardwareInfo.sockets` is absent. Absent
firmware is *my* firmware. So every one of them puts me permanently in the degraded branch behind a banner
that asks me to declare my hardware by hand — and not one says whether an old plug, fan or light will ever get
a firmware update that makes the banner go away, or whether I am in that branch for the life of the device.
C09 asks for exactly one firmware change and it is for type 4. Fail-closed is the right *behaviour* and it
is not an *answer*.

**4. Nobody made regression-testing my devices a named gate with an owner.**
All ten note the same facts: 38 `it()` blocks, 24 of them a lone `it('should create')`, an
`app.component.spec.ts` that cannot pass, CI that never runs `ng test`. All ten then promise my settings
components are "untouched" — which still means re-hosted, re-routed, re-themed and re-translated with zero
automated coverage. `./simulate-device.sh` can drive `fridge`, `controller`, `plug`, `fan` and `light` end to
end over real MQTT; C08 and C09 mention verifying with it; C04 counts a 36-cell matrix and then says the
manual gate "gets skipped under deadline pressure." Nobody wrote: *"a scripted walkthrough of fan, light,
plug and fridge is a release gate, it belongs to a named person, and the release does not go without it."*
That omission is the mechanism by which I actually get broken, and it is the one thing all ten had the
evidence to prevent.

**5. Nobody gave me a way to carry my history into the new hardware.**
C03's `equipmentDeviceIds` is the only gesture in this direction, and it is a lane label, not a migration. If
I buy the October controller, three years of fan and plug telemetry and logs stay in a separate device silo
forever. Nobody offered "adopt this device's history into your new controller's record", a device-replacement
flow, or any continuity story at all. This is a commercial miss as much as a design one: the single thing
most likely to convert a resentful legacy owner into a €289 customer is being told his record comes with him,
and ten documents wrote about grow clubs instead.

**6. Nobody wrote the update-day experience for a user who was not consulted.**
Every concept replaces the navigation I know — six outline buttons become a tab bar, a segment, a plinth, a
drawer, a thumb bar. Every concept calls this "one relearn" and moves on. Not one designed the moment I open
the app after an automatic web-app update and my device looks different: no what-changed screen, no "your
settings live here now" pointer, no undo, no way to see the old layout once. C05 says I will be "briefly
annoyed that Settings moved into ⋮" and that is the entire treatment. For the one user type the brief
explicitly flags as *not the focus group*, an unannounced navigation change is precisely how you manufacture
the public anger everyone was trying to avoid.

*(A seventh, smaller: three concepts — C01, C06, C09 — discard `value-display`, the 266-line SVG gauge with
value arc, limit arc, needle, 1-hour average and target line that renders an honest `—` for missing data. On
a fan or a plug with one or two values, that gauge is not a component, it is the whole product. Two of the
three at least admit the loss. Nobody proposed the obvious middle path: keep it as the primitive for devices
with few enough values that a grid of gauges beats a tile grid, a scene or a timeline.)*

---

## The dealbreaker test

**Take my three-year-old smart socket — old firmware, no `hardwareInfo.sockets`, one relay, one temperature
reading, no camera, no plants, never a grow — and open the app on a phone the day after the redesign ships.**

It passes only if **all** of the following are true on the first screen, without scrolling:

1. I can see **what the socket is doing right now** and **how old that reading is** — live, stale or offline,
   distinguishable at arm's length without reading a word.
2. My **over-temperature, under-temperature and time limits** are rendered as words in German, not as
   `settings.limits.overtemperature.enabled`.
3. **Nothing** on the screen mentions a plant, a stage, VPD, a feeding schedule, a grow cycle, a run, a
   club, or a socket role I do not own — and nothing invites me to create one.
4. The settings screen I reach from it is **the form I already know**, at a URL that still resolves if I
   typed it into my bookmarks in 2023.
5. Nothing that was working on that device the day before has stopped working.

Any concept that needs an exception path, an illustration commission, a deferred tier or a "v1.1" to satisfy
those five points has failed the test — because that is the exact list of things that get cut when the
October date gets close, and I am the exact user nobody will notice we cut them from.
