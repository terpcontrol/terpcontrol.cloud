# Critique — User Type 3: PARTIAL CONTROL

**Who I am.** I own a subset. A heater. Maybe a CO₂ socket. Not a tent full of kit. Today your app fails
open (`grow-presets.ts:166-168` — *any* of dehumidifier/heater/co2 returns `'full'`), so it shows me a
humidity target row, a humidity-deviation warning in the grow assistant, and a "Dehumidifier running
non-stop" alarm preset for a machine I do not own. That is not a cosmetic bug. It is the reason I do not
believe the app when it tells me anything else. If it is confidently wrong about what is plugged into my
own tent, why would I trust its temperature number?

**What I judge on.** Does the concept understand I own a subset? Does it hide what I cannot act on
*without* hiding what I could buy? Does it stop grading me against goals I have no hardware to reach? Is
the capability model honest — or does it fail open again in a new costume?

**The bar has moved.** All ten concepts fix the fail-open bug. Every one of them says "per-role, fails
closed". That is now table stakes and it earns nobody points. What separates them is whether the fix is
**load-bearing to the design** (a control for a machine that is not in the room *cannot be drawn*) or a
**bolt-on** (a flag that suppresses a row, one forgotten call site away from lying to me again), and
whether the concept's actual spine is worth anything to a man with one socket.

---

## The ranking

### 1. C09 "Das Zelt" — 86

**Verdict: the only concept where my problem is the architecture rather than a bug fix, and it is
carrying the largest execution risk in the set to get there.**

C09 is the only document that diagnoses my complaint correctly: *"Terp Control's deepest bug is not
visual, it is epistemic."* Everything else treats fail-open as a defect to patch. C09 treats it as a
consequence of representing the tent as a bag of flags, and replaces the representation. A humidity target
row cannot appear on my screen because the dehumidifier object it belongs to is not in the scene. That is
not a rule someone has to remember to apply on a new screen — it is the absence of a thing to hang a rule
on.

Four details nobody else got:

- **The empty slot is the buy path.** A dotted outline labelled `Hier ist nichts` with a `+`, whose sheet
  contains *no controls at all* — only "Was ist das?" explaining what would go there. That is the exact
  shape of my second requirement: I can see the hole in my kit without being nagged through it.
- **`Kurz testen`.** I tap the heater, the socket clicks in the next room. Every other concept asks me to
  believe a CSV. This one closes the loop. That is the moment I start trusting the picture, and C09's own
  Type 3 walkthrough says so in as many words.
- **`Antwortet nicht`.** My heater plug dies. `hardwareInfo.sockets` drops `heater`. C09 draws it hollow
  with a test button. Today that failure is invisible; in eight of the other nine concepts it is *also*
  invisible until the CSV changes, and none of them draw it when it does.
- **The heater sheet contains the day and night temperature rows and nothing else** — "because those are
  what the heater obeys." That is the subtraction applied to the page where I actually work, which is the
  thing everybody else forgot (see *What nobody got right*, #6).

It also catches the `pwmUse` problem — `out_light` is freely assignable to a lamp *or* an exhaust fan, and
`is_day` is inferred from `out_light >= 0.5` — which means for some subset owners the day/night state in
every other concept is nonsense. Nobody else noticed, because nobody else had to draw the object.

**Fatal flaws.** The art is a hard dependency with no graceful degradation (§15.1), and it does not ship
in a reduced form — it ships as boxes, and boxes are worse than today's gauges. I read numbers; §15.2
concedes the tent is *strictly worse than what exists* for that, and I am exactly that user. §15.5 buys a
whole second UI (Contents list) forever. §13 calls this "a large v1 for a small team over ~13 months" for
an October ship date, which is either a typo or an admission. And §15.10 is right to worry it reads as a
toy — I am comparing this to a TrolMaster.

**Steal:** the empty slot as the buy path; `Kurz testen`; the six-state object vocabulary
(live/stale/offline/absent/prop/discrepancy); the ghost/silent/unknown-firmware reconciliation, which is
the only fail-closed model in the set that handles *both* directions of disagreement; `pwmUse`.

---

### 2. C10 "Durchgang" — 82

**Verdict: the best capability *rendering rules* in the entire set, bolted to a thesis that is worth
nothing to me for five months and which its own §15.1 admits is an IOU.**

C10 is the only concept that gets the physics right rather than just the inventory:

> *"Because humidity can only ever go down, the humidity goal is drawn as a **ceiling**, `max. 55`, not as
> a centred target with a band on both sides. Drawing a symmetric band around a number the device can only
> approach from one side is a lie about the machine."*

That is the deepest sentence about my problem in all ten documents. Every other concept's capability model
is a boolean about sockets; C10's is about *direction*. And it goes further: humidity is **excluded from
the in-range verdict entirely**, so my 82 % is a real number about the thing I control rather than a
number diluted by a target I cannot hit. Nobody else does that — C02 explicitly keeps the untouchable
channel in the tile row with its own amber percentage forever.

Two more things aimed straight at me:

- Onboarding step ② lists `✗ CO₂-Sensor (Upgrade)`. The buy path, stated once, in the one place it belongs,
  and never again.
- Day 4 I add a CO₂ socket and **the wizard is not re-run**: `hardwareInfo.sockets` changes and a toast
  says `Neue Steckdose erkannt: CO₂. Ziel setzen? ›`. That is the smoothest capability-growth path in the
  set. My subset is not a permanent declaration; it is a thing that changes when I buy something, and this
  is the only concept that treats it as live rather than as an onboarding answer.

Its v1 is also credible and puts the capability work in the foundation tier.

**Fatal flaws.** The spine is dead weight to me. Run-over-run pays off at run 2, "three to five months
after purchase" (§15.1, which is admirably blunt about it being "a retention feature masquerading as a
product"). I control CO₂ or heating; I may not run discrete runs at all. Everything I love here — the
ceiling rendering, the verdict exclusion, the detection toast — is orthogonal to the concept and could be
lifted into any of the other nine tomorrow. §15.6 concedes day-of-run is the wrong axis for partial and
legacy users, and calls its own generalisation "a patch over that, not a design". §15.5 admits staggered
plants break the model, which is the owner's explicit ask.

**Steal:** the ceiling-not-band rule; excluding uncontrollable measures from the verdict denominator;
`(Upgrade)` in the found-hardware list; the live "new socket detected → set a goal?" toast.

---

### 3. C06 "Glance Tiles" — 79

**Verdict: the most learnable expression of my problem — one picture, absent means powerless — undermined
by an auto-provisioning model that is the fail-open bug wearing a new costume.**

> *"A tile with no goal bar is making a deliberate statement: nothing here can act on this number."*

That is my requirement compressed into one visual convention, and it generalises across temperature,
humidity, VPD, CO₂, RPM, EC and pH. I learn one picture. The Type 3 walkthrough is correct without
hedging: CO₂ tile with a goal bar, temperature and humidity tiles that keep their *values* and lose their
*bars*. Keeping the tile and dropping the bar is the right subtraction — I still want to see humidity, I
just do not want to be graded on it. The `Nur Absenken möglich` hollow half-bar shows the grammar can go
directional. And `generic:<m>` means a measure the catalogue does not know is never invisible, which is
the inverse of today's hardcoded-array-in-a-component failure.

**Fatal flaws.** §15.3 is the killer and the document knows it: *"One wrong key produces a phantom tile,
and a phantom tile is worse than a checkbox list would have been."* Evidence is `hardwareInfo` (a
free-form `Record<string,string>` filled from MQTT log lines) plus "has produced a point in 48 h" (a query
that can flap). I came to this redesign because the app was confidently wrong about my kit; a concept
whose answer is a *different* inference over the *same* flaky source has not earned my trust back, it has
re-rolled the dice. A toast and a hidden drawer are not a fix. Second: §15.4 says the drag-and-drop grid
is the most likely thing to be cut, and cutting it guts the "seven types without modes" claim. Third: a
tile answers "now" and I tune a heater over days; every differentiating thing lives behind a tap (§15.1,
conceded).

**Steal:** the goal bar and its absence-as-a-statement; the `generic:<m>` catch-all tile; grey reserved
product-wide for "I don't know"; "no tile has settings — a gear icon means this concept has failed".

---

### 4. C02 "The Verdict" — 72

**Verdict: the most rigorous capability *type* in the set and the most credible six-week plan — and it
still ships me an amber humidity tile every day for a month, which is my original complaint at a lower
volume.**

The `DeviceCapability` interface is the best-engineered answer here: per-role booleans, `canHumidify`
typed as the literal `false` because the hardware truth is that no humidifier role exists, `canCool` and
`canDehumidify` both derived from the same socket with the UI naming it by what the workmode makes it do,
and `unknown: true` failing closed with a banner rather than to `'full'`. The `advisory` flag on a channel
— *"Nur zur Info — dieses Gerät kann das nicht ändern"* — keeps it out of the headline. And Day 5 I buy a
heater socket and temperature "silently becomes a judged channel the next time `hardwareInfo` arrives — no
settings change, no wizard re-run". Correct.

The v1 is the most believable in the set: 41 person-days, itemised, with the capability rewrite at item 4
and the honest note that it is "already optimistic".

**Fatal flaws.** §15.3, in the author's own words: *"a tile that is amber every day for a month is a tile
people stop reading — and the alarm-fatigue failure mode is the exact thing this concept claims to
solve."* My humidity tile still carries a target, a TIR bar and a percentage computed against a goal I
have no hardware to reach. C10 deletes the goal and drops the measure from the denominator; C02 keeps
both and labels them. Labelling is not the same as not doing it. Second: §15.4 — in October the verdict
sits on top of *today's* chart, fifteen translucent areas on hidden axes. So the evidence I am invited to
drill into is the thing I already distrust. Third: §15.1 — my verdict is computed against
`GROW_STAGE_PRESETS`, five rows with no cited source, and a green tick against a wrong band manufactures
confidence.

**Steal:** the `DeviceCapability` interface including `canHumidify: false` as a type; `unknown` failing
closed with a visible banner; the excursion thumbnail (the picture from the minute the room peaked);
deleting the four dead controls outright rather than hiding them behind Expert.

---

### 5. C01 "Loupe" — 70

**Verdict: technically the correct capability model and precisely the right words for my case — attached
to a single-screen bet that takes away the dashboard I actually read and gives me no way to see what I am
missing.**

Lane-level truth derived from `hardwareInfo.sockets` **and** observed Influx fields, failing **closed** to
monitoring when the key is absent. The humidity lane draws normally with its band **in grey, labelled
`nur Beobachtung`**, and the grow-assistant humidity warning is explicitly suppressed. No dehumidifier row
in the outputs lane. No dehumidifier alarm preset. §11's Type 3 walkthrough is one of the two best in the
set, and the detail that my setpoint change lands on the timeline as a machine event with my name on it,
at the instant the line steps, is genuinely good — it is the audit trail for the one thing I do.

**Fatal flaws.** Absent capability means *"a lane the hardware cannot produce is not rendered at all. No
CO₂ upgrade → no CO₂ lane, no CO₂ target, no CO₂ alarm preset."* Correct on the nag axis and a total
failure on the second half of my requirement: there is nowhere in this product I can learn that a CO₂
sensor exists and would give me a lane. C01 does the hiding perfectly and the informing not at all.
Second: it kills the `value-display` gauge (§15.5, owned) and replaces my dashboard with a horizontal time
axis. I open the app to read two numbers and adjust one; §15.1 concedes horizontal time is a hard sell and
calls it "the single biggest bet in the document". Third: §15.11 — the drawer is where the mess was hidden,
so the settings page I use to tune my heater is unchanged, still `ngSwitch`ing five device types and still
saving everything at once and navigating away. Fourth: §15.9 — no fallback once `/charts` and `/diary` are
redirects.

**Steal:** `nur Beobachtung` as a *rendering* of the band rather than its removal; failing closed to
monitoring on absent `hardwareInfo.sockets`; naming the `Entfeuchter / Kühler` double meaning in the lane
label with a `ⓘ` rather than hiding it.

---

### 6. C08 "Shared Grow" — 67

**Verdict: it answers my second question — *why did that happen* — better than anything else here, and it
spends October's entire budget on machinery I will never open.**

The capability handling is right: fail closed with exactly one recovery question, only the temperature
target row appears, no dehumidifier tile, no humidity nag, and the onboarding screen lists
`✗ CO₂ (nachrüstbar)` — the buy path, done properly, once. Then it does something none of the others do:
my humidity spikes to 78 %, and instead of nagging me about a lever I do not have, the scorecard reports
the excursion and the PERSONEN lane shows it started at 19:05 — when I was in the tent. That converts an
uncontrollable measure from a source of guilt into a source of *explanation*, which is exactly what I want
from a measure I only watch. §11 is right that this "answers their two real questions — what can I
actually change, and why did that happen."

**Fatal flaws.** I am one person. The Visit is the spine, and §15.2 concedes it may not survive contact
with a solo indoor grower: somebody with a tent in their bedroom walks past it eight times a day, and if
inferred visits fragment the lane is noise and *the attribution becomes misleading, which is worse than
absent*. §15.3 concedes nobody will press "start visit". §15.1 concedes the concept spends its budget on
the smallest segment. The Grow indirection adds a join to nearly every query (§15.7) and §15.6 flags
grow-centric routing as the highest-probability way to silently break my existing share links. I pay all
of that for one sentence about a door.

**Steal:** `(nachrüstbar)` in the found-hardware list; excursion-overlaps-visit as the reason to log
anything at all; the rule that a member colour may never be confusable with a measure colour.

---

### 7. C03 "Beet" — 58

**Verdict: clean capability work wrapped around an object I did not ask for, and it says so itself.**

Per-role capability as a `Set`, failing closed with a plain banner offering `[Manuell festlegen]`, and the
wizard's `connections` step demoted to a one-tap confirmation — *"Ich sehe: Lampe, Heizung. Stimmt das?"*
That confirmation is the right interaction: it shows me what the device claims, in words, and lets me
correct it. My humidity pane keeps a series and gets a *reference* band labelled `gegenüber Richtwert
Blüte` with a one-line note that nothing is switched for it, which is an honest middle position.

**Fatal flaws.** §15.4 diagnoses itself accurately: types 3 and 7 are "served well but **mostly by fixes
that any concept would ship**". Everything C03 gives me, eight other concepts also give me — and C03 adds
a Plant card between me and my thermometer, which §15.1 owns ("you put a plant between a man and his
thermometer" is not wrong). I control CO₂ in a room. The plant is a labelling dimension I do not need, and
the reward for carrying it (per-plant stage bands, a day counter, a conflict banner about two plants
wanting different climates) is aimed at somebody else entirely. §15.3: four new collections, no migration
tooling, no test baseline, six weeks. §15.5: the backfill will produce wrong-looking history and create a
support category the alternatives do not.

**Steal:** the wizard `connections` step as a one-tap *confirmation* of detected hardware; naming the band
source on every verdict (`gegenüber deinen Alarmgrenzen` / `deinen Zielwerten` / `Richtwert Blüte`).

---

### 8. C07 "Der Plan" — 55

**Verdict: the only concept that does the "what could I buy" half properly, and it charges me a modal
decision every time I want to turn the heat down.**

The one thing C07 has that nobody else does: my stage editor's humidity rows are **greyed with
`Kein Entfeuchter gekoppelt` and a link to add one**. That is the complete answer to my second
requirement — the control is inert, the reason is stated, and the path forward is one tap away, at the
exact place I would look for it. Nine other concepts either nag me or go silent; this one informs me.
Capability failing closed is in Tier 0, and the Expert view's "Was der Controller bekommt" — showing which
of the 15 config keys the firmware actually reads and marking the ones it ignores — is a genuine honesty
feature.

**Fatal flaws.** §15.1, conceded: *"the single most common objection will be 'I just want to turn the
temperature down'. C07 makes that three taps and a decision instead of one tap."* That is my daily action.
I have a heater. I nudge it. Every time, forever, I now answer a scope question (just now / this stage /
the whole plan). A twelve-week photoperiod plan with stages, gates, ramps and a feed programme is
enormous ceremony for a man with one socket, and the plan is the concept's entire centre of gravity.
§15.8: the compiler creates a second source of truth against a device that has a rotary knob on it, so
every drift dialog is a conversation about the app and the box disagreeing. §15.7: the realistic October
outcome is Tier 0 + Jetzt + compiler, and **the chart ships in November**. §15.4 concedes the largest
segment carries a dead tab.

**Steal:** the greyed control with `Kein Entfeuchter gekoppelt` **and a link to pair one** — this is the
single best answer in all ten documents to "don't hide what I could buy"; and "Was der Controller bekommt"
listing the config keys the firmware ignores.

---

### 9. C05 "Thumb Journal" — 52

**Verdict: honest about my hardware and, by its own admission, a non-answer about my hardware's
settings.**

The capability model is right — fails closed to monitor with an `Ich regle doch etwas` escape, the
humidity band renders greyed with `nicht regelbar` **drawn on the chart itself** rather than removed, no
dehumidifier tile, no nag. Drawing the uncontrollable half of the band in grey is a better idea than
deleting it: I can see the shape of what I am not defending.

**Fatal flaws.** Its own Type 3 verdict: *"well served on the honesty axis, **under-served on depth**. He
wants a settings screen with more precision than a journal offers; he gets today's settings screen, which
is unchanged. **That is a non-answer.**"* I agree, and it is disqualifying. I control one or two things.
The whole point of being me is that I go *deep* on a small surface — heater hysteresis, minimum off time,
day/night step — and C05 puts settings two levels down behind `⋮` and spends its design budget on making
it one tap to record that I watered. §15.1 concedes four of the seven types open the app to analyse rather
than to record, and I am one of the four; the concept "is optimising the wrong verb" for me. §15.2:
one-tap logging degrades data quality by construction, and the recovery screen (`/tidy`) is desktop-only
and v1.1. §15.4: accidental writes are guaranteed.

**Steal:** `nicht regelbar` as a greyed *half* of the band on the chart; the duplicate-collapse
(`×2` with `Doch nur einmal`) which is the right way to be kind about a fat thumb without debouncing data
away.

---

### 10. C04 "Zweigang" — 46

**Verdict: it names me as its own worst-served user, correctly, and then does nothing about it.**

The capability work is blunt and good — *"the app never mentions a capability he does not have"*, humidity
rendered as a plain tile with no target and no colour, `deviceRoles()` reading the CSV directly and
failing closed to the empty set, and screen 2 as a hardware-detected confirmation whose unticked fallback
is the old-firmware path. On the pure honesty axis it is top-three.

**Fatal flaws.** §16.2, verbatim: *"Types 3 and much of type 4 sit exactly on the boundary: they want
three things from Profi and everything else from Einfach. They will ping-pong. **This is the concept's
worst structural flaw.**"* That is me, named, in the author's own honest-weaknesses section. My life is
Einfach plus heater hysteresis. §11's own walkthrough has me crossing to Profi mid-week and back —
"round trip: four taps" — and it will be four taps every week for a year. Worse: the pages I need
(`/control`, `/alarms`, `/hardware`) have **no Einfach counterpart at all**, so the segment control is
*disabled with a reason* on exactly the screens where I work. A mode system whose disabled state is where
I live is a mode system built for somebody else. §16.4: the Simple gear can hide a real oscillation behind
a mean line, mitigated by a heuristic with false negatives — and a heater short-cycling itself to death is
precisely the failure a heater-only owner needs to see. §16.7: gear is per-user, not per-device. And the
v1 list is fifteen items including a full ECharts migration, plants, `GrowEvent`, feeding regimes, a read
API and a public diary URL — for six weeks. That is not a plan.

**Steal:** "You cannot make a screen simple by hiding things on it. Only by not putting them there.";
`Ohne Funktion in dieser Firmware` as a label on controls the firmware ignores; the confirmation screen
whose unticked state *is* the old-firmware fail-closed path.

---

## What nobody got right

Six needs of mine that **not one** of the ten concepts met.

**1. Capability is treated as presence, not direction — and the one concept that noticed did not apply it
to my measure.** C10 states the principle perfectly for humidity: draw a *ceiling*, not a symmetric band,
because the hardware can only push one way. C06 draws a hollow half-bar for the same case. But I own a
**heater and no cooler**. My temperature is one-directional too. Every single concept, C10 and C06
included, draws me a symmetric temperature band with a centred setpoint and a deviation fill on both
sides — which is exactly the same lie about my machine that the symmetric humidity band is about the
tent. The defining case of user type 3 is a *one-sided* actuator on a *two-sided* measure, and ten
documents drew me two-sided bands. The rule should be: the band's shape is derived from which directions
of the measure my kit can actually move.

**2. There is no state for "I own the actuator and it has run out of authority".** My heater works. In
July it cannot stop the tent hitting 34 °C. Every concept's capability model is a boolean about sockets,
so it tells me temperature is controllable and then scores me red, amber or 61 % for three months of
summer — which is *the same experience as being nagged about a dehumidifier I do not own*, arrived at by a
different route. The honest statement is: "your heater has been at 0 % for six hours and the room is above
band — this is beyond what your kit can reach." Every concept ships the two halves of that sentence
already: an outputs state-timeline lane and a deviation fill. **Not one of them joins them.** Actuator
saturated (or idle in the wrong direction) *and* still out of band is a first-class capability state —
*owned but powerless* — and it does not exist anywhere in these ten documents.

**3. Nobody lets me declare what I care about, independently of what I own.** Every concept derives
silence from hardware absence and nothing else. But I might own the CO₂ upgrade and genuinely not care
about CO₂ this run; or want humidity as an *alert only* while keeping it out of every verdict, band,
score and denominator. C08 half-arrives (add a humidity alarm and it becomes the chart's band, labelled as
mine). What I actually need is a per-measure three-way switch — **regulate / watch / ignore** — where the
hardware inventory is the *default* for that setting rather than the setting itself. Hardware is a good
guess about my intent. It is not my intent, and ten concepts conflated them.

**4. Nobody costed the buy path from my own data.** Three concepts hint at it — C07's greyed row with a
link to pair one (the best of the three), C08's `(nachrüstbar)`, C10's `(Upgrade)` — and all three do it
*once, in onboarding, in the abstract*. Not one shows me, at the moment of a real deviation, what the
missing kit would have done: *"You were above band 2 h 40 min yesterday and 3 h 10 min the day before. A
dehumidifier on a socket would have covered both."* I own a subset because I bought a subset. The only
upsell that is not nagging is the one computed from my own excursion history, shown where the excursion
is, and shown once. Every concept chose between nagging me and going silent. Nobody chose informing me.

**5. Everyone replaced "fails open on missing data" with "trusts a self-reported CSV completely".** That
is a better default. It is not a verified one. `hardwareInfo.sockets` is a free-form string a device sends
over MQTT and the server never validates. The state I actually fear is not *missing* — it is
**stale-true**: the `heater` role is still in the CSV, the plug died three weeks ago, and every concept
confidently draws me a temperature setpoint, a band, a deviation fill and a score against a goal nothing
has been defending since the 4th. Only C09 draws that failure (`Antwortet nicht`, hollow, with a test
button) and only C09 gives me a way to check (`Kurz testen`) — and even C09 only reacts *after*
`hardwareInfo` drops the role, which requires the device to have noticed. Nine concepts built their entire
honesty story on an unverified self-report and called it fail-closed. The missing piece is
liveness-per-socket: the same live/stale/offline vocabulary all ten of them invented for *sensor values*,
applied to *actuator roles*, which is where it matters more.

**6. Nobody subtracted my settings page.** Every concept applies capability-driven subtraction to the
dashboard, the chart bands, the alarm presets and the verdict — and then sends me to a settings screen
that still `ngSwitch`es across five device types, still offers me the whole climate form, and still saves
setpoints + recipe + alarms + cloud settings in one full-page action that navigates away to `/list`. C01
names this exactly (§15.11: *"the drawer is where I hid the mess"*). C05 concedes it is a non-answer for
me. C09 is the sole partial exception — the heater sheet holds the day/night temperature rows and nothing
else — and even C09 keeps the full expert form intact one level away. If my capability set is `{heater}`,
my settings screen should be the heater's settings and nothing else. That is the same rule everybody
already agreed to; nobody carried it to the page where a partial-control user actually spends their time.

---

## Dealbreaker test

Run this against a simulated controller before anyone calls a concept finished. `./simulate-device.sh`
can do every step of it, so there is no excuse for an unverified answer.

```
./simulate-device.sh setup
./simulate-device.sh -d <id> hwinfo sockets=heater      # heater ONLY. No dehumidifier. No CO2.
./simulate-device.sh -d <id> run --set humidity=78 --set temperature=34 --set out_heater=0
# ... four hours of history ...
./simulate-device.sh -d <id> hwinfo sockets=            # then blank it (old-firmware case)
```

**A winning concept must pass all four:**

**(a) Nothing about humidity that implies control appears anywhere in the app.** No humidity target row,
no target band, no deviation fill against a humidity setpoint, no dehumidifier tile, no dehumidifier
output row, no "Dehumidifier running non-stop" alarm preset, no grow-assistant humidity-deviation warning.
Not greyed out. Not disabled. Not behind an accordion. **Absent.** Humidity as a *reading* is welcome and
expected; humidity as a *goal* must not exist.

**(b) Humidity is excluded from every score, verdict, percentage and denominator.** If the app says
"82 % in range", that 82 % must be about temperature — the thing I control. A number diluted by a target
I have no hardware to reach is a lie with a decimal point on it.

**(c) The temperature band is drawn one-sided, and the app says the heater has run out of authority.**
With `out_heater = 0` and the room at 34 °C, the correct sentence is "your heater is off and the room is
above what it can reach", not a red score, not an amber tile, and certainly not a symmetric band whose
upper half nothing in my tent has ever been able to defend.

**(d) Blanking `hardwareInfo.sockets` makes the app show me *fewer* targets, not more.** It must fall
back to monitoring and say so in one line. If blanking the CSV produces a richer, more confident UI than
having a heater did, the concept has failed open again — and that is the exact bug that made me stop
believing the app in the first place.

Any concept that fails (a) is not shippable to me. Any concept that fails (d) has not actually fixed the
bug; it has moved it.
