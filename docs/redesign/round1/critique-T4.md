# Critique — User Type 4, "The Full Tent"

**Who I am.** Heating, lights, air, dehumidifier-or-cooler, humidifier. I don't own all of it, but I own
most of it, and I own things the firmware has never heard of. I have five socket roles plus one PWM output
and a room that fights itself. I am the customer the marketing line *"Ein Controller für dein ganzes Zelt"*
was written for, and I am the customer whose problem the firmware cannot currently express.

**What I judge on, in order:**

1. Can I see **machine state over time** — not now, over time — for six things on one axis?
2. Does it help me when **two machines fight** (the heater and the dehumidifier at 03:00)?
3. Is there a **control surface** that scales past a settings form, or did you only fix looking?
4. Does it **respect that I don't own every category** without nagging me about the ones I don't?
5. Does the chart **actually ship in October**, or is it in a v1.1 paragraph?

That last one is not pedantry. I am the type who lives in the chart. A concept whose v1 ships a beautiful
home screen on top of fifteen translucent hidden axes has shipped me nothing.

---

## The headline finding

**All ten concepts fixed observation. Not one of them fixed steering, and not one of them diagnoses a room
that is fighting itself.**

Every single concept adopts the outputs state-timeline lane (dossier §7.2 #6). Good — that is the single
most important element in the redesign for me. Then every single one of them stops. Five of the ten even
write my walkthrough as *"Day 2 he notices the dehumidifier cycling every eleven minutes"* — and then
leave the noticing to me. The `out_*` series are already in InfluxDB. Computing "these two actuators ran
simultaneously for 4 h 20 on six of the last seven nights" is a join and a sum. Nobody proposed it.

And when it comes to changing anything, the answer is nearly uniform: today's settings page, re-parented.
C01 calls its own drawer *"where I hid the mess"* and is right. C04 admits Pro is *"largely a re-roof of
what already exists"*. C05 puts my settings two levels behind `⋮`. C09 hides them behind a picture. C07 is
the only concept that redesigned control at all — and then de-scoped the chart to November.

---

## Ranking

### 1. C01 "Loupe" — 80

The best instrument anybody built for me, shipped in v1, with the fewest excuses.

The output state lane has **one row per paired role plus a height-mapped band for the dimmable PWM** —
that is the correct rendering and only C01 spells out that `out_light` is 0–100 and not binary. The
day/night lane is promoted to its own 16 px strip at the very top, which is right: in my room the
photoperiod is the master rhythm and everything else is read against it. `Aktionen zeigen` — 1 px
whisper ticks across *all* lanes — is the only mechanism in the ten that makes cross-lane correlation a
single gesture rather than an act of eyeballing. The Day Sheet gives me time-in-range split day/night
plus **longest excursion as a duration**, which is the number that tells me whether my kit is undersized.
`Präzision` behind a long-press gives me raw aggregation, a table, and **CSV including actuator state** —
which no vendor in this market provides and which I have wanted for two years.

It also names my two ugliest realities out loud instead of hiding them: the outputs row is labelled
`Entfeuchter / Kühler` with a `ⓘ` explaining one socket serves both meanings, and `Drawer › Ziele` shows
which targets the current workmode actually regulates.

**Why it isn't higher:** §15.11 is an accurate self-indictment. The drawer still `ngSwitch`es across five
device types, still saves settings + recipe + alarms + cloud settings in one full-page action, still
navigates away to `/list`. My control surface is unchanged. And I am the user who breaks §15.3: six lanes
plus film strip plus event rail plus a 10-second live refresh, all on one screen, on a phone in a tent.
I'm the heaviest possible load on the riskiest possible screen.

### 2. C10 "Durchgang" — 77

The sharpest domain thinking in the set, and it ships the whole chart in v1.

**`max. 55` instead of a centred band is the single best detail in all ten documents.** Humidity can only
ever go down in this hardware. C10 is the only concept that got that physics into the *visual grammar*
rather than into a disclaimer paragraph, and the only one that excludes an unactionable measure from the
verdict entirely — so my 82 % is a real number about the things I actually control, not diluted by a
target I cannot hit. Nine other concepts wrote "humidity can only go down" in a weakness section and then
drew a symmetric band anyway.

The **"geplant vs. gemessen" hairline** on the day/night shading turns a failed contactor into a visible
diagnostic for free. **Goal rows hide when offline** — because a target is meaningless when nothing is
regulating — which nobody else thought through. `Lichtstunden/Tag` integrated from `out_light` instead of
fabricating DLI from a dimmer percentage is intellectually honest in exactly the way I need from a device
I am trusting with a crop.

And `Was war anders` — a computed diff of two runs' *decisions* (setpoint changes, stage timing, feed
program, training count) — is the smartest analysis feature anyone proposed for a user who tunes. Per-run
output runtime totals in the compare scorecard are the closest anyone got to the duty-trend number I want.

**Why it isn't higher:** §15.1 is fatal at the margin. The thing it is named after arrives at run 2,
three to five months after I buy. Everything else in it is excellent and shipped in v1 — but the headline
row on my home screen in October reads *"Erster Durchgang"*, which is an IOU on a €289 device. And §15.5
is real for me: I do run staggered plants, and the run-scoped x-axis doesn't match any of them.

### 3. C07 "Der Plan" — 70

The only concept that redesigned **control**, and it then priced the chart out of October.

§14a is the most useful table in the entire bake-off for me. The recipe engine today applies
`RecipeStep.settings` as the *whole* device configuration — blowing away my hardware tuning every step.
C07's answer (the plan owns a named key set, `configureDevice` merges a patch) is a fix I want regardless
of which concept wins. Gates with `graceDays` replacing `waitForConfirmation`'s indefinite halt, and
**"a gate never halts climate"**, is correct. **Drift detection** — the controller's rotary knob was
turned and the app now says so instead of silently overwriting within the hour — is the first time any
document acknowledged that my device has a physical UI. The override sheet's three scopes (just now /
this stage / whole plan) is the right model. And "Was der Controller bekommt" showing the exact 15
firmware-read keys and marking the ignored ones is the honesty a sceptical operator needs.

Drawing the **future** on the chart — planned setpoint steps, the flip date, planned tasks as hollow
markers — is genuinely differentiating and nobody else has it.

**Why it's third:** §13 puts the chart overhaul at Tier 2, item 17, and §15.7 says plainly that the
realistic outcome is *"October ships Tier 0 + Jetzt + the plan compiler, and the chart lands after the
hardware."* For me that is shipping the wrong half. Add §15.1 — turning the night temperature down
becomes three taps and a decision, and I fiddle daily — and §15.3, where a ramped 42-day stage compiles
into 14 recipe steps that don't resemble the plan I built. Two representations of the same thing, one
generated, no test suite.

### 4. C09 "Das Zelt" — 67

The most honest concept about **my actual kit gap**, and the most expensive way to be honest.

I own a humidifier and an exhaust fan. There is no humidifier role, no exhaust role, and
`out_dehumidifier` doubles as the cooler. C09 is the only concept that gives those machines a *place*:
props, drawn flat, **never taking a state colour**, with `Nur ein Merkzettel — Terp Control sieht das
nicht.` I can log against them and the note lands on the Spur. It is unsatisfying and it is the truth,
and the alternative — drawing a humidifier that looks controllable — is exactly the fail-open lie.

It is also the only concept that makes a **firmware ask that would actually help me**: add `other1/2/3`
to `getSocketRolesList()`, where the NVS key helpers already exist. That converts my humidifier from a
sticky note into something that at least reports its switch state. Nobody else asked.

Two catches nobody else made: the PWM output is *freely assignable to a lamp or an exhaust fan*, so
day/night shading derived from `out_light` is nonsense if I hang my exhaust on the dimmer — C09 asks once
during furnishing and permanently changes the shading. And the chart's Geräte lane is ordered **top to
bottom exactly like the tent wall**, so it needs no legend.

**Why it's fourth:** §15.2, written by its own author, is the disqualifier for me. *"A picture is less
information-dense than a list… For a user who opens the app to read numbers and leave, the tent is
strictly worse than what exists."* I open the app to read six actuator states and four measures. I want
density. The tall SVG doesn't work in landscape (§15.6), the art is a hard dependency with no graceful
degradation (§15.1), and the time slider is admitted to be analytically weak (§15.7). Schema skin is a
great techie escape hatch and it is a lifeboat, not a home.

### 5. C08 "Shared Grow" — 61

One genuinely valuable idea for a solo operator, wrapped in an auth rewrite I don't need.

**Excursion attribution** is the payoff and C08 is right that it pays back at n=1: *"3 of 4 humidity
excursions this week overlapped a tent visit"* means the dehumidifier is fine and I am the problem. That
is the single most useful thing anyone offered to stop me chasing phantom faults. The PERSONEN lane's
dotted-vs-solid honesty about inferred visits is the correct discipline.

The chart is complete in v1 with the GERÄTE lane, per-role fail-closed capability, and honest labelling
of the dehumidifier/cooler wart. `Grow` spanning several devices means my old Terp fan and my controller
could share one journal.

**Why it's fifth:** §15.1 is its own best critique — the October budget goes to a membership collection,
`auth.middleware.ts:172`/`:207`, ~20 owner-scoped queries and invite flows, and my experience of that is
a menu entry I never tap. The Grow indirection puts a join and a routing layer between me and my tent.
And the adaptive 2/3/4-tab navigation means the product looks different on different accounts, which is
awkward the first time somebody in the Telegram group tells me to "tap the Futter tab".

### 6. C03 "Beet" — 58

Full chart in v1, a real equipment page, and a plant object I mostly don't want at the root.

Splitting `/device/:id/equipment` out of the settings monolith — sockets, roles, aux devices, per-role
truth, IPs — is the closest anyone came to giving me a kit-management screen, and I want it. The chart is
complete in v1: small multiples, stepped setpoint, deviation fill, day/night from measured light, outputs
state lane, min/max envelope, moving VPD band. `Phase` and `Grow` range presets are the ranges I
actually use. It says out loud, in the equipment page, that humidity can only ever go down and that
`Entfeuchter / Kühlung` is the same socket.

**Why it's sixth:** §15.1 is honest — it puts a plant card between me and my thermometer, and the tent
strip is 52 px of what used to be the whole screen. The lead-plant machinery and the conflict banner
solve a problem I mostly don't have (my tent is usually one batch). And §4.4's decision to ship v1 on
Highcharts is a bet I pay for: if the licence answer comes back wrong, my chart gets rewritten twice and
the second rewrite lands during my grow.

### 7. C06 "Glance Tiles" — 55

The cleanest capability model in the set, attached to the wrong unit of thought.

The **goal bar** — setpoint at centre, alarm thresholds at the ends, soft band in the middle third, dot
for current, grey whenever not live — is one picture that works on temperature, humidity, VPD, CO₂, RPM,
EC and pH. That is real design economy. **A tile with no goal bar is a deliberate statement that nothing
here can act on this number** — the fail-open capability bug becomes visible by construction. And
`Nur Absenken möglich` with the lower half of the humidity bar drawn hollow is a good, specific fix.

**Why it's seventh:** §15.1, again written by the author. *"A tile is a bad container for time, and
growing is a process… I have bought glanceability by demoting the thing that actually makes this product
unlike its competitors."* My whole question is "over time". The Technik tile is four icons in a 1×1 box —
that is not a control surface for six machines. The 60×22 px axis-less sparkline is decoration by the
dossier's own standard (§15.2 admits it). And §15.4 is the killer: the 2D drag grid on Angular 15 /
Ionic 6 with `@angular/cdk` newly added is the most likely thing to be cut, and cutting it guts the
concept's answer to the seven types.

### 8. C02 "The Verdict" — 49

The best single answer to "I don't own every category", shipped on top of the chart it was supposed to
redeem.

The **advisory channel** rule is elegant and correct: a channel the device cannot change appears in the
tiles and the scorecard labelled *"Nur zur Info — dieses Gerät kann das nicht ändern"* and **does not
drive the headline**. That is exactly the treatment my un-humidifiable humidity deserves. The scorecard
sheet (in/above/below, day vs night, MAD from setpoint, longest excursion as a duration, raw sample count
printed) is the best scorecard in the set. And the **excursion thumbnail** — the camera still from the
minute the room peaked, next to the sentence saying it peaked — is the cheapest brilliant idea anyone had.

**Why it's eighth:** §13 lists what is *not* in v1: the chart rewrite, ECharts, plants, JournalEntry,
feeding, multi-user, the film strip. §13 then says it plainly: *"in October the verdict sits on top of
today's chart… the evidence is still fifteen translucent areas on hidden axes."* I am the flagship
customer and in October I get a green tick over the same unusable chart. §15.3 also names my daily
reality and shrugs at it: in a dry German winter my humidity tile is amber every day for a month, and a
tile that is amber every day is a tile people stop reading — which is the exact failure this concept
claims to solve. One device-level headline is nearly information-free for a room with six actuators.

### 9. C04 "Zweigang" — 46

I would live in Profi, and Profi is admitted to be a re-roof.

§13, verbatim: *"the Pro gear is largely a re-roof of what already exists — the expert settings tab, the
charts page, the diary, the alarm editor, the five device settings components — moved under new routes
with a new shell."* That sentence is the whole review. The flagship customer gets today's screens at new
URLs. The route map is genuinely better structured than most (`/control`, `/hardware` with sockets and
roles as their own page, `/alarms` lifted out of the monolithic save), and the chart overhaul *is* in v1
with the `Wasser & Dünger` panel. Those are the two things keeping it off the floor.

**Why it's ninth:** §16.2, its own words: *"Types 3 and much of type 4 sit exactly on the boundary… They
will ping-pong. This is the concept's worst structural flaw."* Correct. §16.7: gear is per-user, not
per-device, and I have a controller plus plugs. §16.6: 36 test cells on a repo with 38 `it()` blocks,
24 of which are `it('should create')`, six weeks before my hardware ships. §16.4: the Simple gear hides a
±0.4 °C oscillation inside a ±1.5 °C band — which is precisely the signal that my heater is short-cycling
itself to death. Doubling the surface area of an untested codebase to serve a bimodality I sit in the
middle of is a bad trade for me specifically.

### 10. C05 "Thumb Journal" — 40

It optimises the verb I use least, and says so.

§15.1, verbatim: *"The chat metaphor fights analysis, and four of the seven types open the app to
analyse… If the owner's actual belief is that people open this app to check their tent rather than to
record their work, this concept is optimising the wrong verb."* I am one of those four. My live state is
a 72 px strip and everything else is prose bubbles.

There is real material here — the chart underneath is complete and good (outputs state lane, the Wasser
lollipop lane with height ∝ litres, the journal rail, the film strip), and **tapping any entry expands an
inline ±6 h mini-chart** is a genuine correlation tool I'd use. The `PendingCaptureQueue` with a
`clientId` idempotency key is the right engineering.

**Why it's last for me:** its own type 4 walkthrough concedes *"his settings live behind `⋮`, two levels
from home. Real cost."* Navigation moved to the top of the screen (§15.8) on an admitted hunch. And §15.9
projects 800–1,500 journal rows per grow into a collection that has no server-side pagination today — so
my chart's annotation rail gets slower every week of a grow I am trying to analyse.

---

## What nobody got right

This is the section worth reading twice.

### 1. Nobody detects that my machines are fighting

Ten concepts, ten outputs state-timeline lanes, zero antagonism detectors. The heater and the
dehumidifier running simultaneously is the defining pathology of a full tent, and in `temp`/`breed`
workmodes my dehumidifier *is* my cooler, so every cooling call is also a drying call — which is why my
RH sits at 38 % in January and why I keep replacing a dehumidifier that isn't broken.

The data is already in InfluxDB. `out_heater` and `out_dehumidifier` are both in `VALID_OUTPUTS`. The
computation is an interval intersection and a sum. The output is one sentence:

> *Heizung und Entfeuchter liefen letzte Nacht 4 Std. 20 gleichzeitig. In diesem Workmode ist der
> Entfeuchter dein Kühler.*

Five concepts wrote a type-4 walkthrough containing the phrase "he notices" and then made me do the
noticing. C10's `Was war anders` and C01's `Aktionen zeigen` are the two mechanisms closest to it, and
both are still "look harder", not "here is the finding".

### 2. Nobody drew the per-actuator control card

Every concept fixed looking and re-parented steering. What I want, and what nobody drew, is a list of six
cards — one per bound socket — each showing: role, current state, **duty cycle today and this week**,
its own hysteresis / min-off-time, its schedule, its last command failure, and a test button. Six of
those in a scrolling list *is* the control surface for a full tent, it is honest about exactly what I own,
it degrades to one card for a type-3 user and to zero for a monitor-only user, and it needs no metaphor.

C09's kit sheets are the closest and they are gated behind an illustration. C04's `/pro/:id/hardware`
names the page and never designs it. C03's `/device/:id/equipment` names it and never designs it.

### 3. Nobody designed the interlock keys the firmware already reads

The concepts spend real energy — correctly — deleting the four **dead** keys (`daynight.floating`,
`lights.maintenanceOn`, `co2.sunsetOff`, `daynight.linearChange`). Not one of them designs a UI for the
**live** ones that govern whether my machines fight each other:

- `daynight.minimalDehumidifierOffTime` (240 s) — the anti-short-cycle guard
- `daynight.maxDehumidifySeconds`
- `daynight.targetHumidityDiff` (5)
- `daynight.useLongHumidityAvg`

These are read by the controller firmware. They are the four knobs that decide whether my dehumidifier
runs 40 minutes straight or 11 times an hour. C10's walkthrough literally says *"he raises
`minimalDehumidifierOffTime`"* and then never shows the screen where he does it. This is free — the keys
exist, the config path exists, no firmware work — and ten out of ten missed it.

### 4. Nobody addressed the mutual-exclusivity of workmodes, which is my actual daily wall

There is no "cool AND dehumidify". `temp` gives me cooling and drops humidity control; `small` gives me
humidity control and the same socket becomes a dehumidifier. Every concept names this in a weakness
paragraph and then does nothing.

But this is solvable **cloud-side, today, with no firmware change**, because the recipe engine already
pushes whole configurations on a tick. A scheduler that switches workmode by time-of-day (cool during the
lights-on peak, dehumidify at lights-off when RH climbs), or by whichever deviation is currently worse,
is the one genuinely new *capability* a cloud redesign could hand the flagship customer. Ten concepts
described the wall in detail. Zero proposed climbing it.

### 5. Nobody shows me whether an actuator is still effective

I need the derivative, not the state: *"when the heater ran 20 minutes, temperature rose 0.8 °C — last
month the same 20 minutes gave 1.4 °C."* Response-per-runtime is how I find a clogged filter, a leaking
tent, a dying compressor, a socket that clicks but doesn't switch. Every concept has both series and
draws them adjacently; none computes the relationship. C09's `Antwortet nicht` is the closest and it is
connectivity, not effectiveness.

### 6. Nobody has anything to say about `secondary_light`

It is one of only five roles the firmware supports and I use it. Not one of the ten documents explains
what it does differently, draws two light schedules against each other, or handles the case where my
second lamp is on a different photoperiod from my first. C01 lists it as a lane row. That's the entire
treatment across ten documents.

### 7. Duty trend is free in every concept and surfaced in none

Every concept computes output regions to draw the state lane. Turning that into "your dehumidifier ran
9.2 h/day this week, up from 5.1" is a sum. It is the earliest fault signal I have and the cheapest
metric in the document. C10 gets it into a run-compare table and C09 into the Schema skin's duty cycles;
neither turns it into a trend or an alert.

### 8. "8+ controlled things" is treated as hypothetical by everyone, correctly, and then dropped

The honest answer is that the firmware caps me at five roles plus one PWM, and my humidifier and exhaust
fan fit nowhere. Only C09 asked for the firmware change that would house them. Nobody proposed the
cheaper cloud-side version: the app already speaks to Tasmota sockets over local HTTP — let me register
one as a *logged-only* device, chart its switch state, and stop pretending it isn't in my room.

---

## The dealbreaker test

> **Open the app on a phone at 03:00 with heater, dehumidifier/cooler, CO₂, light and secondary light all
> paired. Without typing and without leaving one screen, I must see the last 24 hours as: each actuator's
> on/off regions as durations on the same time axis as temperature, humidity and VPD, each with its
> setpoint drawn — and I must be able to tell in under 30 seconds that the heater and the dehumidifier
> were both running from 02:00 to 04:00. Then I must reach that dehumidifier's minimum-off-time setting
> in at most three taps from that screen.**

The first half of that test is passed by C01, C10, C09, C08 and C03 today. The second half — three taps
from the finding to the knob — is passed by **none of the ten**. That gap is where the winner has to be
built.
