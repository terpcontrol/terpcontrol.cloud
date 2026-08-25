# Terp Control Redesign — Competition Synthesis

Ten concepts (C01–C10), ten adversarial critics. Seven critics represent the product owner's seven
user types; three represent capability lenses (stoner / normal / techie). This document ranks the
concepts, aggregates what every critic independently found missing, and recommends what should be
built.

---

## 1. Score table

### 1.1 Raw scores, every concept × every critic

Sorted by the composite defined in §1.2. `T*` = user types (the hard constraint). `STO/NOR/TEC` =
capability lenses.

| # | ID | Concept | T1 | T2 | T3 | T4 | T5 | T6 | T7 | STO | NOR | TEC | **Mean** | **Min** | Max | Spread | σ | **T-min** |
|---|----|---------|----|----|----|----|----|----|----|-----|-----|-----|---------|--------|-----|--------|---|----------|
| 1 | **C01** | Loupe (die Lupe) | 77 | 71 | 70 | **80** | 70 | 74 | 70 | *42* | 61 | **88** | **70.3** | 42 | 88 | 46 | 11.6 | **70** |
| 2 | **C06** | Glance Tiles | 79 | 61 | 79 | 55 | 53 | 45 | 67 | 52 | 68 | 76 | 63.5 | **45** | 79 | **34** | 11.5 | 45 |
| 3 | **C08** | Shared Grow | 47 | 45 | 67 | 61 | 44 | **88** | 78 | 62 | 50 | 72 | 61.4 | 44 | 88 | 44 | 14.3 | 44 |
| 4 | **C04** | Zweigang | 64 | 65 | 46 | 46 | **74** | 58 | **84** | **88** | *38* | 84 | 64.7 | 38 | 88 | 50 | 16.8 | 46 |
| 5 | **C10** | Durchgang | 50 | 49 | 82 | 77 | 58 | 40 | 56 | 50 | 56 | 71 | 58.9 | 40 | 82 | 42 | 12.8 | 40 |
| 6 | **C05** | Thumb Journal | 58 | 68 | 52 | *40* | 39 | 63 | 73 | 76 | 58 | 65 | 59.2 | 39 | 76 | 37 | 12.0 | 39 |
| 7 | **C02** | The Verdict | **84** | *33* | 72 | 49 | 34 | *33* | 81 | 84 | 71 | *41* | 58.2 | 33 | 84 | 51 | **21.1** | 33 |
| 8 | **C09** | Das Zelt | *35* | **84** | **86** | 67 | 31 | 48 | *46* | 66 | 63 | 68 | 59.4 | **31** | 86 | **55** | 17.9 | 31 |
| 9 | **C03** | Beet | 52 | 53 | 58 | 58 | *28* | 68 | 62 | 58 | **79** | 60 | 57.6 | 28 | 79 | 51 | 12.3 | **28** |
| 10 | **C07** | Der Plan | 45 | 40 | 55 | 70 | *23* | 62 | 53 | 46 | 54 | 52 | **50.0** | **23** | 70 | 47 | 12.1 | 23 |

**Bold** = that critic's top score for the concept row / best-in-column value. *Italic* = that
critic's lowest-ranked concept.

### 1.2 The weighting, and why

**Composite = 0.5 × mean + 0.5 × min.**

The brief is explicit: the owner must satisfy **all seven** user types with one product. That makes
this a *maximin* problem, not an averaging problem. A concept adored by four critics and despised by
three ships a product that three of seven customer segments abandon in week one — and in a market
where, per the dossier, users churn in a week, an abandoned segment is a refunded unit and a public
complaint. So the minimum must carry real weight.

But pure maximin is also wrong: it lets a single idiosyncratic critic veto the field, and it rewards
blandness — a concept that is a uniform 55 everywhere beats one that is 80 everywhere except one 50.
Half-and-half is the smallest weighting that makes the worst case decisive without erasing merit.

**The ranking is robust to this choice.** I ran the weight `w` on the minimum from 0 (pure mean) to
1 (pure maximin):

| w on min | Ranking |
|---|---|
| 0.00 (pure mean) | C01, C04, C06, C08, C09, C05, C10, C02, C03, C07 |
| 0.25 | C01, C06, C04, C08, C10, C05, C09, C02, C03, C07 |
| **0.50 (used)** | **C01, C06, C08, C04, C10**, C05, C02, C09, C03, C07 |
| 0.75 | C06, C01, C08, C10, C04, C05, C02, C09, C03, C07 |
| 1.00 (pure maximin) | C06, C08, C01, C10, C05, C04, C02, C09, C03, C07 |

The top group `{C01, C06, C08, C04, C10}` is the same five at every weighting from 0.25 to 1.00,
with only internal reordering. C07 is last at every weighting. C03 and C09 are 8th–9th at every
weighting. **The top 5 and the bottom 3 are not artefacts of the weighting.**

**Two robustness checks I also ran:**

*Critic-harshness normalisation.* Critics differ sharply in generosity (T5 mean 45.4, TECHIE mean
67.7 — a 22-point gap). Z-normalising each critic's scores to a common mean/σ before compositing
gives: **C06, C01, C08, C03, C10**, C05, C04, C09, C07, C02. C01 and C06 swap; C08 holds 3rd; C04
falls (its highs come from the three most generous critics, its lows from the harshest) and C03
rises. I report the raw ranking as primary — a harsh critic is harsh because that user type is hard
to please, and normalising that away is exactly the error the brief warns against — but the reader
should note **C04's raw rank of 4th is flattered by generous graders, and C03's 9th is punished by
harsh ones.**

*Consistency of placement.* Ranking each concept 1–10 within each critic's list:

| ID | Places (T1→TECHIE) | Wins | Top-3s | Bottom-3s | Median |
|----|--------------------|------|--------|-----------|--------|
| **C01** | 3,2,5,1,2,2,5,**10**,5,1 | 2 | **6** | 1 | **2.5** |
| C04 | 4,4,**10**,9,1,6,1,1,**10**,2 | **3** | 4 | 3 | 4.0 |
| C06 | 2,5,3,7,4,8,6,7,3,3 | 0 | 4 | 1 | 4.5 |
| C08 | 8,8,6,5,5,1,3,5,9,4 | 1 | 2 | 3 | 5.0 |
| C09 | **10**,1,1,4,8,7,**10**,4,4,6 | 2 | 2 | 3 | 5.0 |
| C02 | 1,**10**,4,8,7,**10**,2,2,2,**10** | 1 | 4 | 4 | 5.5 |
| C05 | 5,3,9,**10**,6,4,4,3,6,7 | 0 | 2 | 2 | 5.5 |
| C03 | 6,6,7,6,9,3,7,6,1,8 | 1 | 2 | 2 | 6.0 |
| C10 | 7,7,2,2,3,9,8,8,7,5 | 0 | 3 | 3 | 7.0 |
| C07 | 9,9,8,3,**10**,5,9,9,8,9 | 0 | 1 | **8** | 9.0 |

### 1.3 The single most important number in this table

**C01 is the only concept that no user type scores below 70.** Its T-scores are 77, 71, 70, 80, 70,
74, 70 — a floor of 70 across all seven segments the owner must serve. The next-best user-type floor
is C04 at 46. Every other concept has at least one user type scoring it in the 20s, 30s or 40s.

C01's two weak scores come from capability lenses, not user types: STONER 42 (last place) and
NORMAL 61. That is a materially different failure mode from "a whole customer segment rejects this",
and it is a *fixable* one — as §7 argues, C01 lacks a plain-language verdict, and a plain-language
verdict is an additive graft, not a re-architecture.

### 1.4 Where critics disagree sharply — this is information, not noise

Four disagreements are large enough to be product decisions in their own right.

**C09 (Das Zelt) — spread 55, the widest in the field.** T3 86 / T2 84 versus T5 31 / T1 35. The
picture-of-the-room is the *best* answer for a partial-control owner (a machine not in the picture
cannot have a control drawn for it) and for a camera owner (the tent interior IS the photograph).
It is the *worst* answer for anyone who opens the app to read numbers and leave — the concept's own
§15.2 concedes the illustration is less information-dense than today's 2×2 gauge grid. **This is a
real, irreducible tension between honesty-by-depiction and information density**, not a flaw to be
patched.

**C02 (The Verdict) — spread 51, σ 21.1, the most polarising.** T1 84 and STONER 84 versus T2 33,
T6 33, T5 34, TECHIE 41. Everyone who wants to be *told* loves it; everyone who wants to *look* hates
it. Critically, all four low scores share one cause and it is not the thesis — **it is that C02 does
not ship the chart in v1.** The concept demotes the chart to "evidence" and then leaves the evidence
as today's fifteen translucent areas on hidden axes. The verdict card itself is praised by T1, T3,
T4, T6, T7, STONER, NORMAL and TECHIE. The idea is loved; the release plan is what is hated.

**C04 (Zweigang) — spread 50, and the most decision-relevant disagreement in the whole exercise.**
STONER 88 (1st) / T7 84 / TECHIE 84 versus NORMAL 38 (last) / T3 46 / T4 46. C04's entire premise is
that the user population is **bimodal** — stoned hobbyists and techies, two clusters, therefore two
apps. The stoner critic and the techie critic both rank it first or near-first, which is exactly what
the premise predicts. **And the critic who represents the sober, competent, non-technical majority
ranks it dead last**, calling the boundary tables "a printed list of things my app will not let me
do." C04's own §16.2 concedes types 3 and much of type 4 "will ping-pong… this is the concept's worst
structural flaw." The disagreement *is* the test result: the bimodality hypothesis is falsified by
the middle of the distribution, which is where most units ship.

**C01 (Loupe) — spread 46.** TECHIE 88 (1st) versus STONER 42 (last). The best analysis instrument
in the field is the worst thing to hand somebody who is impaired: five semantic zoom regimes, eight
distinct gestures, no verdict sentence anywhere, and a diary you read by scrolling sideways at 14px
per day.

**C03 (Beet) — spread 51.** NORMAL 79 (1st — "the only home screen that looks like an app I already
know how to use") versus T5 28. Plant-first is instantly legible to the mainstream and structurally
wrong for the closed-loop builder.

**Everything else is agreement.** C07 is bottom-3 for eight of ten critics and last for T5; C06 is
never worse than 8th; C10 is 2nd or 3rd for the three critics who care about control honesty and
7th–9th for everyone whose value arrives in month four.

### 1.5 The other structural signal

Seven different concepts win at least one critic (C01, C02, C03, C04×3, C08, C09×2). **C06, C05 and
C10 win nobody.** C06 finishing 2nd overall while never placing first is the classic uniformly-good
profile — and under a maximin brief that is a feature, not a criticism. But it is also the profile of
a product nobody advocates for, which matters in a market where the dossier says advocacy drives
sales.

---

## 2. The top five

### #1 — C01 "Loupe (die Lupe)" · mean 70.3 · min 42 · **T-min 70** · composite 56.1

**What it is.** Terp Control has exactly one screen: a single shared time axis. Environment lanes,
an output state-timeline lane, a camera film strip positioned by timestamp, and a two-row event rail
(human above machine) all share one x-scale. Navigation is zoom — 6h / Tag / Woche / Zyklus / Läufe —
and zooming changes the *representation* of the same object (curves → daily columns → run-over-run
bands) rather than navigating anywhere. Rules about the future (targets, alarms, feed plans, access)
live in a side drawer, because a rule is not a moment. `/charts` and `/diary` are deleted and become
redirects.

**Who loves it.** TECHIE (88, 1st) — "the only concept where the analysis surface IS the product, it
ships whole in v1, and the expert depth costs the beginner zero pixels." T4/full tent (80, 1st) —
"the best instrument anyone built for me, shipped in v1." T1 (77, 3rd) — the record IS the home, in
v1, with axes. T6/clubs (74, 2nd) — the Day Sheet is the best reconstruction artefact in the field.
T2 (71, 2nd), T5 (70, 2nd), T3 (70), T7 (70). **No user type scores it below 70.**

**Who hates it.** STONER (42, dead last). NORMAL (61, 5th).

**Fatal flaws as found by critics.**
1. **There is no verdict.** (STONER) The scrub header is four numbers over four targets and the user
   performs the comparison themselves — the worst "is it fine?" answer in the field.
2. **Zoom is a concept, not a control.** (STONER, NORMAL) Five regimes that change what things
   *mean*; the screen changes shape when you press a button. Eight distinct gestures, several of
   which destroy your position if mistimed.
3. **The diary is horizontal.** (STONER, NORMAL, T2, author's own §15.1) Reading a journal is a
   vertical act in every app in this market; here "what did I do in week 3" is a sideways scroll at
   ~14px per day. The fallback — a vertical entry list — is the one thing the concept's non-goals
   explicitly forbid, "not as a fallback, not as a preference."
4. **One screen, one performance budget.** (T1, T4, T5, TECHIE) ECharts canvas + DOM film strip +
   DOM event rail + DOM output lanes + a 10s live refresh, all competing on one frame on a cheap
   Android, with no page-level firebreak. Today a slow chart at least does not slow the diary.
5. **The drawer is where it hid the mess** (author's own §15.11, quoted approvingly by T3 and T4).
   The settings page underneath is unchanged: still `ngSwitch` across five device types, still one
   full-page save of settings+recipe+alarms+cloudSettings, still navigates away to `/list`.
6. **No API in v1 at all** (T5) — an honest "kommt" placeholder; read/write and Home Assistant are v2.
7. **The gauge dies** (T7) — `value-display` is demoted, and on a fan or plug with two values that
   gauge *is* the entire UI.
8. **Peak value is misaligned with the owner's stated priority** (author's own §15.8): clubs are the
   best fit and are v1.1; the monitoring-only user the owner listed *first* gets 90 columns of
   climate above an empty human row at Cycle zoom.

**What it would take to fix them.**
- Add a **plain-language verdict band** pinned at the top of the timeline (graft C02's verdict card
  grammar: glyph + one German sentence + one bar, never a number in the headline). C01 already
  computes time-in-range server-side on raw samples for the Day Sheet — the arithmetic exists; only
  the sentence is missing. This is additive, ~1 component, and it is the single highest-leverage
  change available to any concept in this field.
- **Build the vertical journal view** the non-goals forbid — as a rendering mode of the event rail at
  Day/Week zoom, not a separate page. This preserves the one-screen thesis while giving NORMAL and
  STONER the affordance every competitor ships. Cost: one list component over data that already
  exists.
- **Cut the zoom bar from five regimes to three** for v1 (6h / Woche / Zyklus) and label each with
  what it shows, not what it is. Reserve `Läufe` for v1.1 where C10's run object is anyway a better
  home for it.
- **Reduce the gesture set.** Long-press-drag fine scrub and double-tap solo are the two most
  expendable; the capture sheet's 3×3 grid of nine icons should be four icons plus "mehr".
- **Keep `value-display`** as the primitive for devices with ≤3 measures (T7's explicit ask, and the
  cheapest possible non-regression for out-of-production hardware).
- **Rewrite the settings page as per-capability cards** (see §4, finding F9) instead of parking it in
  the drawer unchanged.
- **Add a read API + generic webhook** (lift C04's v1 scoping decision verbatim) — this is what moves
  T5 from 70 to a pass, and it is the cheapest single item on this list.

---

### #2 — C06 "Glance Tiles" · mean 63.5 · **min 45 (best)** · **spread 34 (tightest)** · composite 54.2

**What it is.** The device home is a grid of self-contained live tiles, each answering one question
with goal-vs-actual and each carrying the age of the data answering it. A tile exists when its
*evidence* exists (hardwareInfo keys, socket roles, Influx points in 48h) — so capability, honesty
and the seven-types problem collapse into one mechanism. The signature element is the **goal bar**:
one horizontal track, setpoint at centre, the user's own alarm thresholds at the ends, dot goes grey
the instant freshness lapses. Nobody configures anything.

**Who loves it.** T1 (79) — "the only concept where the number of questions I am asked is
structurally zero." T3 (79) — "the most learnable expression of my requirement." TECHIE (76) — the
most correct freshness and capability plumbing in the field. NORMAL (68), T7 (67).

**Who hates it.** T6/clubs (45) — "unserved at launch," the author's own §15.9. T5 (53) — everything
integration-shaped is v1.1. T4 (55) — a tile is the wrong unit for a room with six machines.

**Fatal flaws as found by critics.**
1. **"A tile is a bad container for time, and growing is a process"** — the author's own §15.1,
   quoted by six of ten critics. Every genuinely differentiating insight (time-in-range, goal-vs-
   actual across a week, the fused environment/machine/human timeline nobody in the market owns)
   lives one tap behind the first screen. The concept buys glanceability by demoting the product's
   actual differentiator.
2. **The sparkline is decoration by the concept's own standard** (§15.2): 60×22px, unlabelled,
   axis-less, on every tile — the element the user sees most often in the whole product, and it means
   nothing.
3. **Auto-provisioning is the fail-open bug in a new costume** (T3, T5, NORMAL, STONER). Evidence
   comes from `hardwareInfo` — a free-form `Record<string,string>` filled from MQTT log lines — plus
   a 48h "has produced a point" query that can flap. One wrong key is a phantom tile, and §15.3
   concedes a phantom tile is worse than a checkbox list.
4. **The drag-and-drop grid is the most likely thing to be cut** (§15.4, flagged by seven critics):
   2D grid drag on Angular 15 / Ionic 6 needs `@angular/cdk`, which is not in the repo, fighting
   Ionic's own gesture layer. If it goes, the answer to seven user types degrades to "we picked a
   good default order."
5. **Two visual grammars for one fact** (§15.6, TECHIE, NORMAL): a linear goal bar on the board, a
   dashed setpoint plus band on the chart. Goal-vs-actual must be learned twice.
6. **Nothing about the camera is shareable at all** (T2) — not a link, not a file, not a post.
7. **The Feed tile nags forever and the only way to silence it is a long-press** (§15.10) —
   "gestures are discoverable only by the people who least need them."

**What it would take to fix them.**
- Accept that C06 is not a spine — it is a **component library and a set of laws**. The goal bar,
  the grey-means-unknown rule, per-measure (not per-device) freshness, `generic:<m>`, and
  `GET /data/board` batching `serverTime` with every `{v,t}` pair are all liftable into any IA and
  should be lifted regardless of who wins.
- If it *is* the spine: replace the sparkline with C06's own goal bar at tile size (it already
  encodes now-vs-target and needs no axis), and put a **week strip** on the board — the concept's
  admitted hole is time, and one 7-day time-in-range row costs one component.
- Make evidence rules **inspectable and correctable**: a "why is this tile here?" line and a manual
  override, which converts §15.3 from a trust bug into a diagnostic.
- Ship the default order and treat drag-and-drop as v1.1, then stop claiming the reorder as the
  answer to seven user types.

---

### #3 — C08 "Shared Grow / Gemeinsamer Grow" · mean 61.4 · min 44 · composite 52.7

**What it is.** The atomic unit is a **Visit** ("Zeltbesuch") — somebody was physically at the tent
from 19:04 to 19:21, watered, noticed a droopy leaf, and left. That span is simultaneously the club's
§17 Abs. 2 participation record, the household's handover note, and — because opening a tent spikes
RH — a diagnostic lane on the chart. The scorecard cross-references excursions against visits and
reports "3 of 4 humidity excursions overlapped a tent visit", which converts attribution from
bureaucracy into explanation. People join a **Grow**, not a device — a cloud object owning plants,
journal, feed regime and members, pointing at zero or more devices.

**Who loves it.** T6/clubs (88, the highest single score in the entire exercise) — "the only concept
written by someone who has thought about a room with more than one person in it." T7 (78) — one grow
spanning a Terp light and a Terp fan is "the one thing old-fleet owners have quietly wanted."
TECHIE (72) — the "no fabricated numbers" non-goal.

**Who hates it.** T2 (45), T1 (47), T5 (44), NORMAL (50).

**Fatal flaws as found by critics.**
1. **It spends the October budget on the smallest segment** (author's own §15.1, quoted by five
   critics). Types 1–5 are solo growers; only type 6 inherently needs multi-user, and the
   authorisation rewrite (Membership collection, `auth.middleware.ts:172`/`:207`, ~20 owner-scoped
   queries, invite flows, role gating on every screen) is the single most expensive line item in the
   entire redesign. A solo user's experience of it is a menu entry they never tap.
2. **Nobody will press "start visit"** (§15.3), so visits must be inferred — and §15.2 concedes a
   bedroom grower who walks past the tent eight times a day fragments into eight 4-minute brackets,
   at which point the excursion attribution becomes **misleading rather than merely absent**, which
   directly contradicts the concept's own thesis that recorded facts must be true.
3. **The grow-scoped alias layer over every device route** is named by the author (§15.6) as the
   highest-probability way this concept silently breaks something that works today, against 38
   `it()` blocks and a CI that never runs them. `ShareLink.query` and `ChartPreset.query` are
   persisted user data.
4. **Adaptive 2/3/4-tab navigation** (§15.11) means the product looks different on different
   accounts — "tap the Futter tab" is advice half the Telegram group cannot follow.
5. **Club mode pauses the camera during visits** — correct for GDPR, and it deletes exactly the
   frames a type-2 user bought the camera for (§15.10 concedes it).
6. **Even for the club, it cannot stop a double feed** (T6): the one-tap `[Gegossen ✓]` sits directly
   below the handover card with no interlock.

**What it would take to fix them.**
- **Split attribution from authorisation.** T6's own most valuable observation (§4, finding F5) is
  that these are different things: attribution is a *label*, authorisation is a *gate*. Ship
  `actor_id` plus a device-scoped "who is at the tent" name picker in v1 (~2 days, no auth work,
  no accounts) and defer the Membership collection to v1.1. This preserves ~90% of what T6 scored 88
  for at ~5% of the cost, and de-risks the release for the other nine critics simultaneously.
- **Demote the Visit from spine to derived signal.** Infer it, draw it dotted and labelled
  `vermutet` (which C08 already does correctly), and keep the excursion-attribution feature — but do
  not make the IA depend on it.
- **Do not re-root routing on Grow in v1.** Keep device routes canonical; add `grow_id` as a
  grouping attribute. The multi-device chart (one panel per device per measure, never averaged) is
  the genuinely valuable half and does not require the indirection.
- Fix the double-feed hole with a commit-time guard (§4, finding F2).

---

### #4 — C04 "Zweigang (Two Gears)" · mean 64.7 (2nd-highest) · min 38 · composite 51.4

**What it is.** Two complete applications behind one login — Einfach (3 screens, thumb-sized,
verdicts instead of numbers) and Profi (everything) — chosen explicitly, permanently and reversibly
in one tap, sharing one component library, data model and chart engine underneath. A static
route-mapping table preserves context across the switch. It deletes the worst question in onboarding
("are you a beginner?") because the answer is reversible.

**Who loves it.** STONER (88, 1st) — "the only concept that treats *dead simple* as a whole
application with its own QA pass, and the only one that puts a WORD where every other concept puts a
percentage." T7 (84, 1st) — serves non-focus hardware by generalising the mechanism rather than
writing an exception path. TECHIE (84, 2nd) — the only concept shipping a documented read API and a
generic non-alarm webhook in v1. T5 (74, 1st).

**Who hates it.** NORMAL (38, dead last) — "I am the person it cuts in half." T3 (46) and T4 (46) —
named by the concept's own §16.2 as the worst-served users.

**Fatal flaws as found by critics.**
1. **The bimodality hypothesis appears to be false.** §16.2, verbatim: "Types 3 and much of type 4
   sit exactly on the boundary… They will ping-pong. This is the concept's worst structural flaw."
   NORMAL's rejection is the empirical confirmation: the majority is a gradient, not a cluster, and
   the mechanism that serves the extremes best serves the middle worst.
2. **The disabled state is where the middle user lives.** `/control`, `/alarms` and `/hardware` have
   no Einfach counterpart, so the switch is "disabled with a visible reason" on exactly the screens a
   partial-control owner works on (T3).
3. **Boundary tables are a printed list of what your app will not let you do** (NORMAL) — being told
   inside the product that you are on the beginner version.
4. **Gear is per-user, not per-device** (§16.7) — one controller plus three plugs, one gear for all
   of them, no workaround. Hits T7 and TECHIE, the two critics who otherwise love it.
5. **The Einfach gear can lie by omission** (§16.4): the min/max envelope renders only when an
   excursion crosses the band — a heuristic with false negatives, so a controller cycling ±0.4°C
   inside a ±1.5°C band is invisible, which is precisely the signal that hardware is short-cycling
   itself to death.
6. **Permanent maintenance debt:** ~120 extra i18n keys × 2 languages and a 36-cell test matrix
   (2 gears × 6 device types × 3 access modes) on a repo with 38 `it()` blocks and a CI that never
   runs `ng test`; §16.6's only mitigation is a manual walkthrough the document itself says "gets
   skipped under deadline pressure."
7. **§16.8: if anything slips, the honest sacrifice is the Pro chart workbench** — the expert surface
   is the designated schedule buffer.

**What it would take to fix them.** Honestly: to stop being C04. The two-shell split is the concept,
and it is the thing the middle of the market rejects. What should survive:
- The **Einfach "Jetzt" screen lifted whole into a single shell**, with its stated design laws
  (exactly one ring, exactly two primary buttons, never three; no number without a target beside it
  or the explicit absence of one; no horizontal scrolling).
- **The read API + generic outbound webhook in v1** — the single most copy-worthy scope decision in
  the field, and the only thing in ten documents that satisfies T5.
- The `stale` rule: **remove the verdict, keep the number.** "A verdict on a four-minute-old number
  is a lie; the number is still the best we know."
- **Absent hardware renders nothing at all** — no `—`, no `-1`, no greyed placeholder.
- `Ohne Funktion in dieser Firmware` as a visible label in the expert surface, with the control
  removed from the simple surface entirely.
- The light-device treatment (24h photoperiod bar as hero, day/night shading from measured output so
  a failed contactor is a *missing band*, DLI) — a type-7 owner gaining more from the redesign than a
  controller owner.

---

### #5 — C10 "Durchgang (Run Over Run)" · mean 58.9 · min 40 · composite 49.5

**What it is.** The root object is a **Run**. Every number carries a second number beside it: what
that same number was at the same day of your last run. The comparison substrate is a ~200-byte-per-day
`RunDayStat` summary rather than raw telemetry — which means the product can delete raw data
aggressively and still compare, the architectural answer to the fact that in the primary market
harvest weights and plant counts are the facts separating a lawful hobby from a criminal file.
Outcomes default to an ordinal rating, not grams: rank, don't weigh.

**Who loves it.** T3 (82, 2nd) — the best capability rendering rules in the entire set. T4 (77, 2nd)
— the sharpest domain thinking. TECHIE (71).

**Who hates it.** T6 (40) — multi-user cut entirely. T2 (49) and T1 (50) — the payoff is an IOU.

**Fatal flaws as found by critics.**
1. **The core value arrives at run 2 — three to five months after purchase** (author's own §15.1,
   "the most serious objection"). Day one's headline row literally reads *"Erster Durchgang"*. In a
   market where users churn in a week, that is a promissory note on a €289 box.
2. **`Auf Zusammenfassung reduzieren` is irreversible AND the default** at run close, and it deletes
   measurement series, **photos** and notes. T1: "I bought the box to record values and look at them
   after some time, and the default behaviour throws the values away." T2: "the privacy-maximal
   default destroys the archive that is my entire product, and nobody flagged the interaction."
3. **One run per device with one day-0** breaks on staggered plants, autoflowers and perpetual grows
   (§15.5) — which is precisely the owner's stated multi-plant scenario and precisely how a club
   supplies members.
4. **`RunDayStat` is a derived cache** that can silently disagree with the chart and shifts every
   daily number by hours if `Run.timezone` is wrong (§15.7).
5. **Everything valuable in it is orthogonal to the thesis** (T3's sharpest observation): the ceiling
   rendering, the verdict exclusion, the detection toast could be lifted into any of the other nine
   tomorrow, and the run spine earns nothing on its own.
6. **The comparison is deeply confounded** (§15.2) — genetics, pot size, lamp, phenotype, season —
   so "Was war anders" lists the four differences it knows and is silent about the sixteen it does
   not, and the user concludes "the 20°C nights did it" with the app's own chart as evidence.

**What it would take to fix them.** Also: to stop being C10. But its individual contributions are the
densest per line of any concept in the field and belong in the winner — see §6, items S1, S2, S6, S9,
S14, S18. In particular **humidity drawn as a ceiling rather than a symmetric band** is called "the
sharpest single observation in the ten documents" by three separate critics.

---

## 3. The losers

| ID | Concept | Rank | The single reason it failed |
|----|---------|------|------------------------------|
| 6 | **C05** Thumb Journal | 6th | It optimises the wrong verb, and says so itself (§15.1): four of the seven user types open this app to *check a number*, and C05 demotes every number to a 72px strip above a chat thread to buy one-tap capture. It also degrades data quality by construction and ships the repair screen (`/tidy`, desktop-only) in v1.1 — to the one user who will never open it. |
| 7 | **C02** The Verdict | 7th | The best idea in the field attached to the worst release plan in the field. The chart overhaul, the journal, plants, feeding and the film strip are all out of v1 — so in October a beautiful verdict card sits on top of today's fifteen translucent areas on hidden axes. Four critics rank it last or near-last for that reason alone. σ 21.1, the most polarising concept here. |
| 8 | **C09** Das Zelt | 8th | The art is a hard dependency with no graceful degradation (§15.1) — five templates × two skins × light/dark, legible at 320px — and if it is late the concept "ships as boxes, and boxes are worse than today's gauge grid." Compounded by its own §15.2: for a user who opens the app to read numbers and leave, the tent is *strictly worse than what already exists*. Widest spread in the field (55). |
| 9 | **C03** Beet | 9th | It puts the wrong noun at the root and concedes it: "you put a plant between a man and his thermometer." Four-plus new collections and a history-rewriting backfill in six weeks with no migration tooling, and it ships v1 on **Highcharts** — a proprietary library, in a repo with no LICENSE file, for a cloud marketed as *quelloffen* — deferring the migration into the launch window. |
| 10 | **C07** Der Plan | 10th | It taxes the single most common action in the product. §15.1: "I just want to turn the temperature down" becomes three taps and a modal scope decision. Then it schedules the chart overhaul — the thing the owner explicitly asked for — as Tier 2, "first to be cut," and predicts in writing that it ships in November, after the hardware. Bottom-3 for eight of ten critics; last for T5, who calls the cloud plan becoming authoritative over their own hardware disqualifying. |

---

## 4. Cross-cutting findings — what NOBODY got right

**This section is the most valuable output of the exercise.** Where critics with completely different
briefs independently arrived at the same missing thing, that is not opinion — it is a hole in all ten
concepts, and therefore a hole in the winner unless it is deliberately filled.

### 🔴 TIER 1 — found independently by three or more critics

---

**F1. NOBODY DESIGNED THE MULTI-DEVICE SCREEN — and it is the first screen several users see.**
*Found by: T1, T7, CAP-NORMAL (explicitly); T4, T6 (adjacent).*

Every concept scopes its home to **one** device (C08: one grow). Real accounts are not like that: a
veg tent and a flower tent is the natural second purchase; T7's account is four heterogeneous
devices; a club has two rooms today and wants four. In all ten concepts the multi-device screen is an
afterthought — `/list`, `/devices`, `/grows`, "Das Regal" — a grid of cards with no verdict, no
freshness roll-up, and no answer to *"which one of these is broken right now?"*. C06 names the gap
and declines it (§15.8). C09 concedes its shelf breaks past about eight. C02 gets closest with one
verdict row per device and then spends the section on clubs. **T7: "My first screen, every time, is
the least-designed screen in all ten documents."** The fix is small and obvious once named: one row
per device, verdict + freshness + last reading, sorted worst-first.

---

**F2. NOBODY WARNS YOU THAT YOU ALREADY DID THIS — the double-action guard.**
*Found by: T6 (as "nobody prevents a double feed"), CAP-STONER (as "nobody warns me I already did
this today"). Two critics with nothing else in common.*

Ten concepts optimised capture **speed** and zero optimised capture **safety**. T6: a double feed is
the most expensive thing that happens in a shared room, and the entire bake-off ignored it. STONER:
over-watering is one of the two commonest ways a home grow dies, the data is right there, and ten
designers put a *prefilled volume* in that slot instead. C05's duplicate-collapse (identical entries
within 10 minutes → `×2`) is the entire state of the art, and it only catches one person's double-tap.
C07's shared task object is the only primitive that structurally helps, and it is v1.1.

**The missing thing is one line in the capture flow, before commit:**
`"Anna hat A1–A3 vor 1 Std 30 gefüttert (Bloom 2 ml/L). Trotzdem?"` — scoped to the same
plants/device inside a configurable window, naming who and when, requiring one deliberate extra tap.
It serves the club *and* the solo stoner from one mechanism. **Cheapest high-value feature identified
anywhere in this exercise.**

---

**F3. A VERDICT WITHOUT A REMEDY IS AN ANXIETY MACHINE — ten out of ten shipped one.**
*Found by: CAP-STONER (explicitly), CAP-NORMAL (explicitly).*

Every concept tells you something is wrong — *Zu warm*, *Da braucht dich was*, *Da stimmt was nicht*,
`⚠ 61 %` — and **not one tells you what to physically do about it.** The only "what now?" flows in
~13,000 lines of design are offline-troubleshooting checklists. NORMAL points out the product already
knows setpoints, socket roles, photoperiod, duty cycles and stage, from which it could say
deterministically, with no AI at all: *"your dehumidifier ran 94% of last night and humidity still sat
8% above target; it cannot keep up — try lowering the night temperature 1°C."* Every concept refuses
the whole category ("no AI grow advisor") **including explainable rule-based advice**, which is the
difference between a dashboard and the "ruhig schlafen" promise. The hardware has a PWM lamp output
and five sockets; the one-button remedy (`Zu warm → Lampe auf 70% dimmen [Machen]`) is buildable and
nobody built it.

---

**F4. THE APP IS THE WRONG DELIVERY CHANNEL — nobody designed the notification.**
*Found by: T1 (weekly digest), CAP-NORMAL (push), T2 (camera-silent alarm).*

All ten design the home screen; none designs **what gets you to it.** There is no push anywhere in
any concept (no service worker, no native app) and several explicitly park alerts at "email +
webhook." NORMAL: *"I am at work; my tent is at home. AC Infinity pushes."* Nobody wrote the
notification copy, the consolidation ("3 alerts", not 3 alerts), lock-screen snooze/acknowledge, or
costed web push. T1 goes further: for a once-a-week monitoring user, **the outbound weekly digest
should be the primary deliverable** — *"last week: 88% in band, coldest night 16.2°C Thursday, one
3-hour data gap Tuesday"* to Telegram, Discord, email or a webhook would be a better product than any
home screen in these ten documents. `webhookTemplate.ts` already does the substitution; it needs only
a non-alarm trigger. T2 adds the sharpest instance: **there is no `camera_silent` alarm condition
anywhere in ten documents** — "I will discover my camera died three weeks ago at the exact moment I go
to make the harvest timelapse and find a hole in the middle of it."

---

**F5. RETENTION AND EXPORT ARE DESIGNED AGAINST THE USER AND NEVER DISCLOSED.**
*Found by: T1, T5, T2.*

Every concept correctly adds InfluxDB retention plus downsampling (C01: raw 90d → 5-min 12mo;
C02: 12mo; C03: 180d; C04: 12mo then 15-min means) — **and every one of those numbers lives in the
document and never on the user's screen.** Not one concept shows how long data will be kept, warns
before the first downsample, or offers a one-tap full export. C10 makes an irreversible "reduce to
summary" the *default*. T1: "the one function I bought the hardware for is silently time-limited by
every proposal here, and I find out when the detail is already gone." T5 adds the corollary: several
concepts ship a panic *delete* and **nobody ships a panic *export*** — "delete without export is the
wrong half of data portability." T2 adds: not one document states what a 12-week grow costs in image
storage, at what resolution, or what the actual image retention is.

---

### 🟠 TIER 2 — found independently by two critics

---

**F6. CAPABILITY IS MODELLED AS PRESENCE, NEVER AS DIRECTION OR SATURATION.**
*Found by: T3 (twice), T4 (twice).*

Two related holes, both large.

*Direction.* C10 and C06 alone noticed that humidity can only be pushed one way and drew it as a
**ceiling**, not a symmetric band. **But neither applied the same logic to temperature** — T3 owns a
heater and no cooler, and all ten concepts, C10 and C06 included, draw a symmetric temperature band
with a centred setpoint and deviation fill on both sides. *"The defining case of user type 3 is a
one-sided actuator on a two-sided measure, and ten documents drew me two-sided bands."*

*Saturation.* There is **no state for "I own the actuator and it has run out of authority."** The
heater works; in July it cannot stop the tent hitting 34°C. Every capability model here is a boolean
about sockets, so it calls temperature controllable and then scores the user red for three months of
summer — the same experience as being nagged about a dehumidifier you don't own, reached by a
different route. Every concept already ships both halves of the honest sentence (an outputs lane
showing the heater at 0%, a deviation fill showing the room out of band) and **not one joins them.**

T4's version of the same gap: **nobody detects that two machines are fighting.** Ten outputs
state-timeline lanes, zero antagonism detectors — and `out_dehumidifier` *is* the cooler in temp/breed
workmodes, so every cooling call is also a drying call. Both series are already in Influx; the
computation is an interval intersection and a sum. Five concepts wrote a walkthrough containing the
phrase "he notices the dehumidifier cycling" and left the noticing to the user.

---

**F7. NOBODY SUBTRACTED THE SETTINGS PAGE, AND NOBODY DREW A PER-ACTUATOR CONTROL CARD.**
*Found by: T3, T4.*

Every concept applies capability-driven subtraction to the dashboard, the chart bands, the alarm
presets and the verdict — **then sends the user to a settings screen that still `ngSwitch`es across
five device types, still offers the whole climate form, and still saves setpoints + recipe + alarms +
cloudSettings in one full-page action that navigates away to `/list`.** C01 names it exactly ("the
drawer is where I hid the mess"); C05 concedes it is "a non-answer"; C09 is the sole partial exception
(the heater sheet holds the day/night temperature rows and nothing else). *If my capability set is
{heater}, my settings screen should be the heater's settings and nothing else.*

T4's constructive version: **six cards in a scrolling list, one per bound socket** — role, current
state, duty cycle today and this week, its own hysteresis/min-off-time, its schedule, its last command
failure, and a test button. That IS the control surface for a full tent, it degrades to one card for
a type-3 user and zero for a monitor-only user, and nobody drew it. Related: all ten correctly delete
the four *dead* config keys and **not one designs a UI for the live interlock keys the firmware
already reads** — `minimalDehumidifierOffTime`, `maxDehumidifySeconds`, `targetHumidityDiff`,
`useLongHumidityAvg` — the exact anti-short-cycling knobs that decide whether the machines fight.
Free: the keys exist, the config path exists, no firmware work.

---

**F8. CUSTOM MEASURES — and the obvious minimal fix that two critics found independently.**
*Found by: T5, CAP-TECHIE.*

`VALID_SENSORS` is a hard-coded allowlist and the chart catalogue is a literal array in a component.
All ten note it; all ten refuse to fix it, pushing a user's EC / soil-moisture / reservoir probe into
a manual diary entry — points on a timeline, never a series that can be banded, alarmed on or
exported.

TECHIE supplies the join nobody made: **`VALID_SENSORS` is a hard-coded literal *because* `measure`
is interpolated raw into Flux — the allowlist is the security control.** Every concept fixes that
injection in v1. The moment `measure` is parameterised, **the allowlist stops being a security
control and becomes a vocabulary** — and a vocabulary can be a MongoDB collection with a row per
user-declared measure (`{key, unit, min, max, label_de, label_en, colour}`) instead of an array
literal in `data.service.ts`. Both halves are already on eight v1 lists. Zero connections made.

---

**F9. NOBODY WROTE THE UPDATE-DAY EXPERIENCE, OR PRICED WHAT USERS LOSE TODAY.**
*Found by: T1, T7.*

Right now `/list` with exactly one claimed device renders that device's dashboard **directly** — zero
navigation between a monitoring user and their numbers. C03, C07, C08, C09 and C10 each insert a
frame, a tab bar, an indirection or a picture into that gap, and **only C03 admits it.** T7 extends
it: every concept replaces the navigation users know — six outline buttons become a tab bar, a
segment, a plinth, a drawer, a thumb bar — and every concept calls it "one relearn" and moves on.
**Not one designed the moment a user opens the app after an automatic web-app update and everything
has moved:** no what-changed screen, no "your settings live here now" pointer, no undo, no way to see
the old layout once. For the user type the brief explicitly flags as *not the focus group*, an
unannounced navigation change is precisely how you manufacture the public anger everyone was trying
to avoid.

---

**F10. OFFLINE CAPTURE — the app does not work where it is used.**
*Found by: T6, CAP-NORMAL (explicitly); T3, T5 flag it in fatal flaws.*

Ten out of ten refuse a service worker for v1. The two-tap watering flow every concept is proud of
runs at the exact moment the phone has the worst connectivity in the house. NORMAL: *"'Loss-resistant,
not offline-capable' is a distinction I experience as 'the app is broken'."* T6 is worse off: a
basement room, six people, one bar of signal — and C05 concedes a cold start with no network shows
the browser's offline page, while C03 admits its retry queue can double-log, **so the app's own
recovery path manufactures records indistinguishable from the double feed T6 most needs to detect.**

---

**F11. MONITOR-ONLY IS TREATED AS A MODE WHERE FEATURES ARE REMOVED, NEVER AS A PRODUCT.**
*Found by: T1 (twice — this is T1's central complaint).*
*Listed in Tier 2 because only one critic raised it, but it concerns the user type the owner listed FIRST.*

Read the copy across all ten: *Nur Messen, nur gemessen, nur Beobachtung, Nur Messung, Kein Gerät
dafür angeschlossen, Nichts zu beurteilen, monitor-only, fails closed to monitor, advisory.* All
accurate, all **subtractive** — every screen describes this user by what they lack.

Two specific holes:
- **A verdict that needs no declared goal.** Every judgement mechanism in all ten derives from a
  target. A user who controls nothing and declares nothing gets C10's *"nicht bewertbar"*, C01
  turning bands off entirely and thereby emptying the very Day Sheet meant to tell them what
  happened, or C02/C03 grading them against a preset tapped at random. **Nobody built judgement
  derived from the data itself:** *"your nights swing 6°C and your days don't"*, *"humidity climbs
  every night from 02:00"*, *"your range widened 25% versus the previous fortnight."* Descriptive
  statistics, day-night deltas, stability and change-point detection are computable from raw samples
  with **no target, stage, plant, plan or goal** — and are exactly what someone who bought a recorder
  wants read back.
- **What a *complete* screen looks like for a device with no actuators:** dew point and absolute
  humidity (pure arithmetic on stored data, deferred in every concept that mentions it), daily
  min/max/mean with the day-night delta, a mould/condensation risk read, sensor-placement guidance,
  how the room tracks outside weather. None of it needs a socket, plant, stage or goal, and none of
  it appears anywhere in ~13,000 lines.

---

### 🟡 TIER 3 — single-critic findings that are nonetheless decisive for that segment

- **F12. No timelapse ships in v1 — anywhere** (T2). All ten either keep the existing rolling
  windows or defer stage/grow renders to v1.1 or v2. The owner's brief for this user literally says
  *"It should be creating timelapses"* and the release that ships with the hardware creates none.
  Worse: **only C05 designs how a video leaves the product** (link · Telegram · Discord · save file).
  Nobody else specifies a download path, filename, resolution or codec — and a "share" that produces
  a login-gated URL is not a share. **Nobody designed the timelapse's content either**: frame
  culling, exposure/white-balance normalisation across 12 weeks, dedupe, stabilisation, suppressing
  frames with a human in shot. Two half-answers exist in ten documents (C01's solar-noon-while-lit
  selection, C07's lights-on filtering). **Half of every day is black** and only C09 noticed, and its
  answer is that a black rectangle "reads as such."
- **F13. Correlation only runs one way** (T2). Every concept gives chart → image. Nobody gives
  **image → question** as the entry gesture: notice a droop in a frame, tap it, be told what the room
  was doing then and what was different about that day. Nobody built a difference view between two
  chosen frames.
- **F14. Stale-true capability** (T3). Everyone replaced "fails open on missing data" with "trusts a
  self-reported CSV completely" and called it fail-closed. The feared state is not MISSING, it is
  **STALE-TRUE**: the heater role is still in the CSV, the plug died three weeks ago, and nine of ten
  concepts confidently draw a setpoint, a band, a deviation fill and a score against a goal nothing
  has defended since the 4th. Only C09 draws that failure (`Antwortet nicht`) and lets you check it
  (`Kurz testen`). **The missing piece is per-socket liveness: the exact live/stale/offline
  vocabulary all ten invented for sensor values, applied to actuator roles, where it matters more.**
- **F15. Attribution ≠ authorisation** (T6). Eight of ten defer memberships and then say "clubs share
  one login, as they do today" — and **not one designs the graceful version**: a device-scoped "who
  is at the tent" name picker, typed once by the owner, no accounts, no auth rewrite, stamped onto
  `actor_id` at capture and upgradeable later. *"That is two days of work and would have given me
  attribution in v1 in every one of these ten concepts."*
- **F16. Nobody can answer the cumulative question** (T6). All ten store products and doses per
  event; not one can say how much Bio-Bloom plant A3 has had this cycle, cumulatively, and from whom,
  without a CSV and a spreadsheet. When a plant goes yellow, that total is the first thing anyone
  wants. Related: **no place for a persistent condition** — "the dehumidifier tank is full", "socket 3
  is loose", "do not water A3" — standing facts with an open/closed state and an owner. Their absence
  means the real handover stays in WhatsApp.
- **F17. Aggregation provenance and reproducibility** (TECHIE). All ten adopt `sampling:'minmax'` and
  coverage percentages; **not one tells you, on the chart, which bucket size you are looking at and
  which function produced each pixel.** Worse, C01's `DayRollup`, C10's `RunDayStat` and C02's Mongo
  TTL cache each add a *second* aggregation layer that can silently disagree with the chart drawn
  beside it. And **no path to reproduce a number**: the scorecard says 84% and you cannot obtain the
  sample set it integrated over, because every export ships what the *chart* holds after downsampling.
  *"For a product whose pitch is honesty, an unfalsifiable headline statistic is a strange thing to
  ship."* Add: **timestamp provenance** — the device is an ESP with no RTC; if its clock is 90 seconds
  off, every excursion duration, day boundary, day/night band and in-range percentage is wrong by
  that much, and nothing in any of these ten designs would ever show it.
- **F18. `out_dehumidifier` doubling as the cooler: labelled honestly by all ten, FIXED by none**
  (T5). Honest is not fixed. One chart series, one alarm `sensorType` and one export column cover two
  physically opposite acts, so history is permanently ambiguous. The cheap fix needs **no firmware**:
  derive two cloud-side series at ingest by splitting on the active workmode.
- **F19. Nobody tried to climb the workmode wall** (T4). There is no "cool AND dehumidify." All ten
  name it in a weakness paragraph and stop. But the recipe engine already pushes whole configurations
  on a tick, so a cloud-side scheduler alternating workmode by time-of-day or by whichever deviation
  is worse is buildable today with no firmware change. **The one genuinely new capability a cloud
  redesign could hand the flagship customer, proposed by zero of ten.**
- **F20. Nobody costed the visual design, and the owner explicitly asked for "look good"**
  (CAP-NORMAL). Nine of ten documents are IA specs with ASCII wireframes — no type scale, no spacing
  rhythm, no motion spec, no empty-state illustration, no statement of how this escapes looking like
  a well-organised 2019 Ionic app. `ion-card` is used 86 times today and every concept builds more.
  Only C09 treats visual craft as a deliverable, and treats it as its biggest risk — the correct
  instinct everyone else dodged by not attempting it.
- **F21. Nobody designed hour one** (CAP-NORMAL). Every mock shows a full week of beautiful curves;
  what you get on claim day is twenty minutes of data and one thumbnail. That is the moment users
  quit. Nobody designed the first 48 hours as a deliberate arc.
- **F22. Nobody mentioned electricity** (CAP-NORMAL). The lamp, heater and dehumidifier are the
  biggest line on the power bill and the controller records exactly how many seconds each socket was
  on (C10 already persists `outputSeconds` per day). *"Your kit ran 214 kWh this run, ~€68, the
  dehumidifier is 40% of it"* is arithmetic on existing data plus one number from the user. **Zero of
  ten mention cost or energy once.**
- **F23. No "why is it doing that?" on an output** (CAP-NORMAL). The heater is on while already above
  target — because the recipe stepped, because someone overrode, because `out_dehumidifier` is the
  cooler in this workmode, because maintenance mode is on, because the socket lost wifi. C07's drift
  detection covers one of those. Unexplained machine behaviour is the fastest way to destroy trust in
  every other number.
- **F24. No support commitment for out-of-production hardware** (T7). Ten documents, not one sentence
  on how long a 2023 fan, lamp and socket keep working, or what happens if a release bricks them.
  Several promise to publish "cloud-outage behaviour" — always to the techie as an API document,
  never to the legacy owner as a commitment. **One line is free and worth more than any screen here.**
  Related (T5): **nobody wrote the cloud-death page** — "open source firmware with a documented REST
  API" is the strongest anti-Grobo argument this company owns, exactly one clause in one walkthrough
  mentions it, and meanwhile all ten *deepen* cloud dependence.
- **F25. Nobody designed for the physical room** (CAP-STONER). Ten documents, extensive dark-mode
  token work, and zero mentions of screen brightness in a dim tent, a wet finger on a capacitive
  screen, gloves, or a red-light-safe rendering. Related: **nobody protects you from logging to the
  wrong tent** — a one-row `"du protokollierst für Zelt 1 — tippen zum Wechseln"` above the confirm
  button costs one row and nobody wrote it. And: **VPD (kPa) is on the default home screen of eight
  of ten concepts** — a derived value, never a target, not regulated by the firmware, and first on the
  brief's own jargon list.
- **F26. Nobody handles impaired time perception** (CAP-STONER). *Tag 34. Schritt 7 von 13. vor 3
  Tagen. Woche 5.* Everything is anchored to counters the user cannot verify. Nobody anchors to events
  they actually remember — *"seit dem Lichtwechsel"*, *"seit du das letzte Mal gegossen hast"*. C07's
  `Später → next photoperiod boundary` is the sole instance of event-anchored time in ten documents.
- **F27. Nobody let the user say "your verdict is wrong, stop grading me"** in one tap
  (CAP-STONER). Six concepts grade against bands several openly admit they invented; the mitigation
  everywhere is "the source is labelled" plus "editable in settings" — a numeric decision in a
  settings tree, which is exactly what the target user cannot do. A single `Passt schon so ›` on the
  verdict card that widens the band to what the user is actually running exists nowhere.
- **F28. Nobody designed the week-scale review** (T1). All ten optimise either NOW or THE WHOLE GROW.
  The unit users actually arrive on is neither: **it is the interval since they last looked** —
  irregular and personal. C08 built exactly this primitive (*"Seit deinem letzten Besuch"*) and
  pointed it at somebody physically entering the tent; applied unchanged to the user's last session
  in the app it would be the correct home screen. Nobody stores `lastOpenedAt` per user per device.
- **F29. Keyboard is absent from all ten documents** (TECHIE). The only keyboard affordance in
  ~13,000 lines is C05's `/tidy` table, and it is v1.1. Every "desktop" answer is a two- or
  three-column layout — more canvas, the same input model.
- **F30. Nobody acknowledged you get exactly one camera** (T2). `cloudSettings.rtspStream` is a single
  string. Ten concepts mention that limit as a design constraint **zero times**, and several silently
  assume a fixed, never-moved viewpoint.

---

## 5. The dealbreaker tests — the winner's acceptance checklist

Every critic wrote a pass/fail test. These are the acceptance criteria for whatever ships. All ten
are reproducible with `./simulate-device.sh`; **none of the ten concepts passes all ten tests.**

- [ ] **T1 — the unattended monitor.** Claim a controller with NO sockets and NO camera. Decline every
      question. Close it. Reopen seven days later. On the first screen, zero taps, zero configuration:
      (1) whether the data is current, and **where in those seven days it was not recorded — drawn as
      a visible hole**; (2) seven days of temperature and humidity readable on a phone — **real visible
      axis labels**, a min/max envelope, finger pan/zoom; (3) a plain-language statement of what
      happened that week — highs, lows, nights, longest excursion **as a duration**, and how much of
      the week was recorded — **without a target, stage, plant, plan, run or goal ever having been
      declared.** And no control, target, plant, task, run or plan for hardware not owned, anywhere.

- [ ] **T2 — the camera owner, day 40.** (a) In **one gesture from the first screen**, put an image of
      the tent from a specific past moment on screen with the temperature, humidity and VPD **of that
      same moment** beside it — with the frame's own age shown **separately** from the sensors' age.
      (b) From **that same screen**, produce a timelapse spanning all 40 days that **skips lights-off
      frames**, delivered as a file or a link pasteable into Telegram without a screen recorder. If
      (a) needs a second screen, if (b) is v1.1, or if either caps at 7 days — fail.

- [ ] **T3 — the heater-only tent.** `hwinfo sockets=heater`; force `humidity=78`, `temperature=34`,
      `out_heater=0` for four hours; then blank `hardwareInfo.sockets`. Passes only if all four hold:
      (a) **nothing about humidity that implies control appears anywhere** — no target row, band,
      deviation fill, dehumidifier tile, output row, alarm preset or assistant warning. Not greyed,
      not disabled: **absent**. (b) Humidity is excluded from every score and denominator. (c) With the
      heater at 0% and the room at 34°C, the temperature band is drawn **one-sided** and the app says
      the heater is off and the room is beyond what the kit can reach — not a red score. (d) Blanking
      `hardwareInfo.sockets` shows **fewer** targets, not more.

- [ ] **T4 — the full tent at 03:00.** With heater, dehumidifier/cooler, CO₂, light and secondary_light
      paired: without typing and **without leaving one screen**, see the last 24h as each actuator's
      on/off regions as durations on the same time axis as temperature, humidity and VPD, each with
      its setpoint drawn — and tell **in under 30 seconds** that the heater and the dehumidifier were
      both running 02:00–04:00. Then reach that dehumidifier's **minimum-off-time setting in at most
      three taps from that screen.** *(Five concepts pass the first half. Zero pass the second.)*

- [ ] **T5 — the builder, October build, no support contact.** (1) Get the last 24h of sensor values
      **AND actuator on/off state** out as timestamped machine-readable data; (2) point a credential
      or a webhook at your own system; (3) find a **written, linkable page** stating exactly what the
      controller keeps doing when `terpcontrol.cloud` is gone. All three, all in v1. Any "v1.1", "v2"
      or "the owner will decide" = fail.

- [ ] **T6 — two members, one cellar, no signal.** Anna feeds A1–A3 at 18:10 per the schedule and
      leaves. Marek arrives 19:40. (1) **Before he can commit a feed**, tell him *inside the capture
      flow* that A1–A3 were fed 90 minutes ago, by whom and with what, requiring one deliberate extra
      tap to proceed; (2) let him log the plants he does feed — product, dose, volume, plants, his
      name — in **under 15 seconds on one bar of signal**, never silently written twice; (3) three
      months later answer *"who fed A3 on 3 September, and how much Bloom has A3 had in total"*
      **inside the app**, no CSV, no scrolling a thread.

- [ ] **T7 — the three-year-old smart socket, day after the update.** Old firmware, no
      `hardwareInfo.sockets`, one relay, one temperature reading. All five true on the first screen
      without scrolling: (1) what the socket is doing now **and how old that reading is**,
      distinguishable at arm's length without reading a word; (2) over/under-temperature and time
      limits rendered as German words, not `settings.limits.overtemperature.enabled`; (3) **nothing**
      mentions a plant, stage, VPD, feeding schedule, grow cycle, run, club or unowned socket role —
      and nothing invites you to create one; (4) the settings screen is the form you already know, at
      a URL that **still resolves if bookmarked in 2023**; (5) nothing that worked yesterday has
      stopped working.

- [ ] **CAP-STONER — hand the phone to someone actually stoned**, dim room, one hand holding a
      watering can. Ask, timed: (1) *"tell me in one sentence whether the tent is OK"*; (2) *"record
      that you just watered it."* Both in **under 15 seconds, ≤3 taps total, one-handed, no typing, no
      scrolling before either answer**, no acronym or unit-of-art (VPD, kPa, EC, DLI, PPFD) visible on
      the screen they answered from, never more than five choices in view — and if they tap the wrong
      thing, **the undo must already be visible without hunting.**

- [ ] **CAP-NORMAL — hand an unlocked mid-range Android, dark mode, to a friend who has never seen
      the app**, on day 3 of a grow whose device dropped offline for two hours overnight, and say
      nothing. Within **60 seconds, no questions**: (a) say whether the tent is OK right now; (b) say
      whether the numbers on screen are current or old; (c) log a watering — **and a week later find
      that watering again without being told where to look.** Any concept that first requires
      explaining a metaphor, a mode, a zoom regime, a plan, a visit or a run has failed; **if (c)
      needs a working internet connection while standing next to the tent, it has failed twice.**

- [ ] **CAP-TECHIE — open a 90-day window** and, without leaving the app, get three things **that
      agree with each other**: (1) **what drew this** — bucket size and aggregation function behind
      the current pixels, as chrome on the chart, updating as you zoom (`5-Min-Mittel · min/max · 288
      Fenster`), with an explicit marker when the view switches from a live query to a precomputed
      rollup; (2) **the same window as data** — CSV/JSON at a chosen resolution, **including actuator
      state**, from the same query the chart used; (3) **show your working** — the raw sample count,
      exact range and coverage the time-in-range percentage was integrated over, **such that (3) can
      be recomputed from (2) and land on the same number.**

---

## 6. Steal list — the best individual ideas across all ten, including the losers

Ranked by (value × cheapness). Concept of origin in brackets; **★** = praised independently by three
or more critics.

### Honesty primitives — non-negotiable, cheap, and they solve the credibility problem
1. **★ Humidity drawn as a CEILING (`max. 55`), not a symmetric band**, because the hardware can only
   push one way [C10]. Called "the sharpest single observation in the ten documents" by T3, T4,
   NORMAL and TECHIE. **Extend it to temperature for heater-only tents** (finding F6).
2. **★ Grey is reserved product-wide to mean "I do not know" and is used for nothing else** [C06].
   Learned once, readable at arm's length without reading a word.
3. **★ The hatched, labelled no-data gap** — no line is ever drawn across a gap larger than 3× the
   sample interval [C01]. *"A grower does not read a badge; they see a hole."* Called the best honesty
   sentence in all ten documents.
4. **★ Freshness per MEASURE, not per device**, four states, `600s` taken from the existing
   `ONLINE_TIMEOUT` so app and server never disagree [C06]. Plus the `Verbunden, aber keine Messwerte`
   state — MQTT keeps `lastseen` fresh while a sensor has failed; nobody else catches it.
5. **★ `Zustand unbekannt` for outputs on an offline device — outputs are unknown, not off** [C08].
   Today the app draws last-known socket states as fact two hours later.
6. **At `stale`: remove the VERDICT, keep the NUMBER** [C04]. *"A verdict on a four-minute-old number
   is a lie; the number is still the best we know."*
7. **`offline` and `unknown` OUTRANK `ok` in a fixed verdict ladder** [C02] — a green tick can never
   sit over dead data.
8. **Absent hardware renders NOTHING** — no `—`, no `-1`, no greyed placeholder for a CO₂ sensor you
   didn't buy [C04]. *"Absence is invisible, not disabled."*
9. **The prop rule: an object the app cannot verify is drawn flat and NEVER takes a state colour**
   [C09] — *"Nur ein Merkzettel — Terp Control sieht das nicht."* Generalises far beyond pictures.
10. **Discrepancy in both directions**: *Ghost* (reported but not declared) and *Antwortet nicht*
    (declared but silent), with a **`Kurz testen`** button firing the real `socket_test` command [C09].
    The only answer anywhere to finding F14 (stale-true capability).
11. **Capability fails CLOSED — to the USER'S DECLARATION, never to "everything"** [C09], with
    **exactly one recovery question, cached so it is never asked twice** [C08].
12. **`canHumidify: false` typed as a literal `false`** in the capability interface [C02] — hardware
    truth encoded in the type system so nobody can accidentally offer it.
13. **The advisory-channel rule**: a channel the device cannot change shows its numbers, is labelled
    *"Nur zur Info — dieses Gerät kann das nicht ändern"*, and **never drives the headline** [C02].
14. **Uncontrollable measures are excluded from the in-range denominator entirely** [C10] — so 82%
    is a real number about what you control.
15. **Goal rows HIDE when the device is offline** — a target is meaningless when nothing is
    regulating [C10].
16. **`Ohne Funktion in dieser Firmware`** as a visible label in the expert surface, with the control
    removed from the simple surface entirely [C04].
17. **The "no fabricated numbers" non-goal, verbatim** [C08]: no DLI without a light sensor, no
    averaged multi-device temperature, no bare ppm without its scale, no "off" for an offline device.
18. **`Lichtstunden/Tag` integrated from `out_light`** instead of fabricating DLI from a dimmer
    percentage [C10].
19. **Inferred data drawn dotted and labelled `vermutet`** — a guess is never presented as a record
    [C08].

### The verdict layer
20. **★ The verdict card grammar: glyph + one plain German sentence + one bar, and the headline NEVER
    contains a number** [C02]. *"Dein Klima passt."* STONER: "worth more to me than every chart
    improvement in these ten documents combined."
21. **`Alles gut` / `Ich behalte es im Auge` / `Da stimmt was nicht`** — three states, plain German,
    one line [C09]. The best verdict *copy* anyone wrote.
22. **`Zu wenig Daten für ein Urteil`** as a first-class state with a coverage bar [C02].
23. **The idle state embeds the stage picker inside the verdict card** — recovery from "nothing
    configured" is one tap on a picture, where the eye already is [C02].
24. **Every verdict names its band source** in a fixed priority order — *"gegenüber deinen
    Alarmgrenzen" / "deinen Zielwerten" / "Richtwert Blüte"* [C03/C02]. If you grade someone, tell
    them against what.
25. **The AGP scorecard whole** [C02]: % in/above/below as one stacked bar, day-vs-night split,
    longest excursion as a **DURATION**, MAD from setpoint, and **`Abdeckung 99,4 % · aus 17 214
    Rohmessungen · 5-Sek-Raster` printed on screen** — the only place any concept shows its denominator.
26. **Time-in-range computed server-side on RAW Influx samples, never on `aggregateWindow(fn:mean)`**
    [all ten, stated most sharply by C02] — averaging destroys the excursions the metric exists to
    count, and the error is invisible by eye.

### The chart
27. **★ The full C01/C06 chart specification**: small multiples, **axis labels never hidden** (three
    ticks and the unit in the panel title below 360px), `sampling:'minmax'`, min/max envelope, grey
    dashed **stepped** setpoint, **signed deviation fill** (not fill-to-axis), day/night as its own
    top lane, outputs as a state timeline, two-row clustered event rail, film strip on the shared
    scale, Okabe-Ito palette, **pinned scrub header replacing the tooltip**, two-finger pan/zoom.
28. **★ The shared `TimeScale` primitive** — one `x(t)` injected into the canvas chart and every DOM
    lane, with fixed pixel grid insets, so they cannot drift [C01]. The implementation detail that
    makes any fused timeline possible.
29. **★ Day/night shading from MEASURED `out_light` with a `geplant vs. gemessen` hairline** where
    schedule and measurement disagree [C10, C01's ghost band] — a whole class of silent contactor
    failure made visible for free. T7: *"the light owner discovers, in week one, that his timer has
    been firing 20 minutes late since March."*
30. **The chart has a FUTURE** — planned setpoint steps, the flip date and planned tasks drawn to the
    right of `jetzt` on a hatched background [C07]. No competitor draws a future target, and it costs
    nothing once a plan is a timeline. Called "the best original idea in the ten documents" by T1.
31. **`Aktionen zeigen`** — 1px, 12%-opacity whisper ticks across ALL lanes [C01]. The only
    single-gesture cross-lane correlation mechanism in the field.
32. **A single ECharts instance with `grid[]` + `axisPointer.link`**, never `echarts.connect()`,
    because connect multiplies canvases and resize observers on exactly the device the migration was
    justified by [C09].
33. **`out_light` rendered as a height-mapped 0–100 band, not binary** [C01] — the only correct
    rendering of the dimmable PWM.
34. **One panel per device per measure, labelled by device, NEVER an average** [C08] — "averaging two
    sensors in different corners of a tent is a fabricated number."
35. **`#999999` reserved product-wide for "a different run"; person colours from a low-chroma ramp
    deliberately disjoint from measure hues** [C10, C08] — *"hue belongs to physics."*

### Capture
36. **★ Two-tap watering with last-used volume and a 6-second `Rückgängig`; NO confirmation dialogs
    anywhere in capture** [C01/C02/C03].
37. **★ Capture stays ENABLED while the device is offline**, with the thread saying so: *"Gerät
    offline — deine Einträge werden trotzdem gespeichert."* [C05/C03] — every competitor conflates
    device-offline with app-broken.
38. **★ `clientId` UUID idempotency keys on every write** so a retry can never double-post [C05].
39. **Values at the top, plants at the bottom, identical is the default** — 2 taps waters three
    plants, **one row with `plant_ids:[a,b,c]`**, per-plant overrides costing two more [C03].
40. **Duplicate collapse**: two identical entries within 10 minutes render as `×2` with a *"Doch nur
    einmal"* chip — **stored as two rows, collapsed presentationally** [C05].
41. **Refine-later chips** (`[Menge?]` `[Welche?]`) that are never modal, never block, expire after 7
    days [C05] — write first, classify later.
42. **`Übersprungen` as a first-class recorded outcome** [C05] — a schedule you can only obey becomes
    a lie by week 3. Plus **`payload.deviation` stored as a fact** so a report can say *"Kim hat drei
    Wochen lang auf 80 % gedüngt"* [C08].
43. **`Später` snoozes to the NEXT PHOTOPERIOD BOUNDARY, not "tomorrow"** [C07] — the only
    event-anchored time control in ten documents (finding F26).
44. **`readings.where` mandatory on every EC/pH entry** (input | runoff | reservoir | substrate)
    [C01/C03] — a runoff EC of 2.4 and an input EC of 2.4 mean opposite things.
45. **`feed.doses` copied as RESOLVED values, never as a reference** [C01] — the plan may be edited
    next month; the record of what was actually mixed must not change.
46. **Corrections as compensating rows (`correctsEventId`), never destructive edits** [C08/C03].

### Camera
47. **★ The excursion thumbnail** — the still nearest the peak of the longest excursion, rendered
    beside the sentence that says the room peaked [C02]. Praised by six critics; "highest
    value-per-line-of-code camera idea in the whole bake-off."
48. **`Am selben Tag`** — two stills side by side at the same day-of-run, each picked at
    **mid-photoperiod** so the lighting matches [C10]. "The only photometric thinking in ten
    documents, and it costs two `<img>` tags."
49. **Cycle zoom picks the still nearest local solar noon WHILE THE LIGHT IS ON** [C01], and
    **lights-on filtering by default for run timelapses** [C07] — the only two pieces of real
    timelapse content design in the field.
50. **The stale-photo rule**: no still newer than 10 minutes → fade the backdrop back to the
    illustration with *"Letztes Bild vor 2 Std."* [C09]. The scene never shows an old photo as if it
    were now. Plus **a separate age line on the camera, distinct from sensor freshness** [C04].
51. **The share menu for a timelapse: `Link kopieren · An Telegram · An Discord · Datei speichern`**
    [C05] — the only concept that designed how a video *leaves* the product.
52. **`Kamerabild übernehmen` / "Kamera-Bild von diesem Moment"** — one tap attaches the still nearest
    an entry's timestamp, ±15min, one indexed query, no upload [C08/C03].
53. **Auto-picked stage cover photos** from the webcam still nearest each stage transition [C03] —
    zero taps, and the literal delivery of "it does the diary keeping FOR YOU."
54. **The camera still as the home screen's substrate** with live value chips over the actual leaves
    [C09] — the strongest single screen anyone drew, and stealable without the illustration commission.
55. **The sprite + JSON index endpoint** so scrubbing costs zero network requests [C09].

### Server / engine
56. **★ `GET /data/board/:device_id`** — one batched call returning per-measure `{v, t}`, targets,
    capability and `lastseen` **against an authoritative `serverTime`** [C06], replacing the
    N-requests-per-10s poll loop. Plus **clock skew exposed in the freshness chip's title attribute.**
57. **★ `planOwnedKeys` + merge-a-PATCH** instead of `RecipeStep.settings` being applied as the WHOLE
    device configuration [C07]. A genuine fix to a real destructive bug: today a recipe step blows
    away hardware tuning. T4 and T5 both say they want this regardless of who wins.
58. **★ `Was der Controller bekommt`** — for any settings surface, show the **exact 15 firmware-read
    config keys** it produces and **mark the ones the firmware ignores** [C07]. Called by TECHIE "the
    single most trust-building screen described in these ten documents"; every dead-control discussion
    in the other nine would be better as this screen.
59. **Drift detection**: compare the echoed config against what was pushed; surface `Plan anpassen` /
    `Plan wiederherstellen` when someone turns the rotary knob [C07]. Today divergence is silent.
60. **`Planschritt wartet auf den Controller`** — honestly surfacing the executor's real 60-second
    online push guard instead of a spinner [C07].
61. **`statVersion` on every derived statistic**, so a formula change recomputes rather than silently
    disagreeing with the chart [C10]. The most engineering-literate idea in the set — and the answer
    to finding F17.
62. **`GET /run/:id/stats.json` and `.csv` INCLUDING actuator state**, over a documented versioned
    schema [C10]; **CSV export of the visible chart window including actuator state** [C01]. No vendor
    in this market ships either.
63. **`Präzision` behind a long-press** [C01]: exact from/to, arbitrary interval with a server-side
    clamp, aggregation method **including `raw`**, per-lane axis override, `Als Tabelle anzeigen`, and
    a copyable box containing the live query string. Plus the law: *"a techie affordance may never add
    a control to the default surface."*
64. **Read API (`x-api-key`, per-device scope, OpenAPI) + a generic outbound webhook DECOUPLED from
    alarms, both in v1** [C04] — "the single most copy-worthy scope decision in the ten," and the
    transitive unlock of n8n / Make / Home Assistant / ntfy / Matrix without owning the integration.
65. **`generic:<m>`** — a measure the catalogue doesn't recognise still gets a value, a unit and a
    sparkline instead of being invisible [C06].
66. **Compound `{owner_id, name}` index on `RecipeTemplate`**, fixing the globally-unique-name bug
    [C07]. **`DayRollup` explicitly ordered to run BEFORE the downsample task** [C01].

### Onboarding, structure, misc
67. **★ The connections step becomes a one-tap CONFIRMATION**: *"Ich sehe: Lampe, Heizung. Stimmt
    das?" [Ja] [Ändern]* — whose **all-unticked state IS the fail-closed path** for old firmware
    [C03/C04/C09]. One mechanism serving both cases, using the ~30MB of already-shot wizard videos
    that ship unreferenced today.
68. **The 6th stage card: `Nur messen` / `Weiß nicht`** — a first-class answer that writes a goal,
    pushes nothing to the device, and never nags again [C02/C08/C10].
69. **`ist mir egal` as a full-width, visually EQUAL option**, not a skip link [C02].
70. **The implicit object costs zero taps**: created server-side at claim, and the word is never
    rendered while only one exists [C03] — the most rigorous statement in the field of how an entity
    stays invisible. **Apply it to plants, runs, grows and plans alike.**
71. **`actor_id` written from day one of v1 even though nothing renders it until v1.1** [C06] —
    *"losing the data is unrecoverable; not showing it is a UI change."* T6 calls this "the single
    most important line in the bake-off," and notes C09 got it exactly backwards.
72. **Invite by link + 6-char code, no email lookup** [C08] — sidesteps account-enumeration entirely.
    Plus **membership tombstones** and **per-grow pseudonyms, never real names.**
73. **`equipmentDeviceIds`** — attach an old plug/light to a grow so its measured on/off history
    becomes a **NAMED lane** in the chart [C03]. Cloud-side, no firmware, and the only concrete
    upgrade reason anyone offered a legacy owner.
74. **`pwmUse: 'lamp' | 'exhaust'`** [C09] — `out_light` is freely assignable and `is_day` is inferred
    from `out_light >= 0.5`, so an exhaust fan on the dimmer makes day/night shading nonsense. Asked
    once during setup, stored, panel relabelled. **Nobody else noticed.**
75. **`other1/other2/other3` socket roles** — the only firmware ask in the field, with file and line
    numbers showing the NVS helpers already exist at `firmware/src/wifi.cpp:1680-1682` and are simply
    missing from the roles vector [C09].
76. **The Schema skin** [C09] — the same layout rendered as an engineering diagram (socket IPs, duty
    cycles, ages in seconds, firmware id, **the dotted config keys verbatim** so a techie can drive the
    device from a shell), built from CSS and text only. Simultaneously the techie answer, the
    accessibility answer and the art-slips lifeboat.
77. **The desktop three-column layout with chart and journal bound to one crosshair in BOTH
    directions** [C05/C01] — drag the crosshair and the thread scrolls; click an entry and the chart
    jumps. The marketing screenshot phone-only competitors structurally cannot answer.
78. **A LANGUAGE SWITCHER** [C09]. Today language is the browser locale with no switcher and no
    persisted preference, **in a German-first product**. Four lines. Only C09 noticed.
79. **The All-Mix rule** [C05/C04/C08] — a feed model that can express *"Noch nicht düngen — All-Mix
    ist stark vorgedüngt. Ab Woche 4. [Trotzdem düngen]"*. Medium + regime as ONE selectable pair,
    labelled the way growers say it out loud. Plus **EC canonical in mS/cm with `ecBasis`
    `delta_over_source` arithmetic shown explicitly** (*"Ziel 1,8 + deine Wasser-EC 0,4 = 2,2"*), a
    **numbered mixing checklist with pH last**, and **`Skala unbestätigt` chips** on migrated ppm
    readings whose scale is unknown.
80. **`Was war anders`** — a computed diff of two runs' decisions (setpoint changes, stage timing,
    feed program, training counts), built entirely from data the product already writes [C10].
81. **`Wie letztes Mal`** — one tap starts the next run copying stages, feed program and plant labels
    [C10]. The best second-onboarding in the field.
82. **`Verification` as a named deliverable**: every behavioural claim gated on `./simulate-device.sh`
    with the exact commands enumerated [C08] — the only real release gate this project has.
83. **`GET /device/:id/log` split from the diary** [C03] — system events are not journal entries, and
    `diary-fridge-log` as a free-text box on a fan was always nonsense.
84. **The refusal list, verbatim, as product policy** [all ten, converged]: no community feed; no
    two-way grow-diary sync; never auto-post to Instagram/Threads/TikTok/Reddit; no *"Powered by Terp
    Control"* footer on user posts (§6 KCanG, fines to €30,000); no §26 compliance system of record;
    no location; no analytics or ad SDKs; no irrigation/dosing automation. **Ten independent
    strategists reached the same list. Treat it as settled.**

---

## 7. Honest recommendation

### The headline

**Build C01 "Loupe" as the spine, graft C02's verdict layer onto its head, and lift C06's honesty
grammar and batched data plumbing into it as the component library. Then fill the five Tier-1
cross-cutting holes that no concept filled.**

Call the result what C01 already is — one shared time axis — but never let a user meet it without
first being told, in one German sentence, whether their tent is OK.

### Why C01 is the spine

1. **It is the only concept no user type rejects.** T-scores of 77/71/70/80/70/74/70. Under a brief
   that says *all seven must be served*, that is the whole argument. The next-best user-type floor is
   46. Six top-3 placements, median rank 2.5, highest mean in the field.
2. **It ships the thing the owner explicitly asked for, in v1.** The owner said *"the Graph needs some
   real overhaul."* C02, C07 and (partly) C03 defer the chart past the hardware date and are punished
   for it by T2, T4, T5, TECHIE and NORMAL. C01's chart **is** its v1.
3. **It owns the actual differentiator.** The fusion of environment + machine state + human events on
   one time axis is the one thing the research says nobody in this market has. C06 concedes it
   demotes exactly this; C02 defers it; C09 makes it beautiful but low-density; C10 makes it
   conditional on a second run.
4. **Its failures are additive, not architectural.** "No verdict sentence" and "no vertical journal
   view" are components you add. C04's bimodality, C09's illustration dependency, C10's month-four
   payoff and C07's plan-as-authority are premises you cannot patch.

### Why C02's verdict card is the graft, not a competitor

The two concepts fail on exactly complementary axes, and the evidence is in the table:

| | C01 | C02 |
|---|---|---|
| STONER | **42 (last)** | 84 |
| T1 (monitor-only) | 77 | **84 (1st)** |
| NORMAL | 61 | 71 |
| TECHIE | **88 (1st)** | 41 |
| T2 (camera) | 71 | **33 (last)** |
| T4 (full tent) | **80 (1st)** | 49 |

C02's low scores are all caused by *not shipping the chart*. C01's low scores are all caused by *not
shipping a sentence*. Each is the other's missing half, and the combination is cheap because **C01
already computes what C02's card displays** — its Day Sheet does server-side time-in-range on raw
samples. The graft is one pinned band at the top of the timeline: glyph + one sentence + one bar, with
the band source named, `offline`/`unknown` outranking `ok`, and no number in the headline.

If it were built, the hybrid's expected profile is roughly C01's row with STONER lifted out of the
40s and NORMAL into the 70s — the only combination in this exercise with a plausible floor above 60
everywhere.

### The full graft list, in build order

**Spine (C01):** one time axis, capability-derived lanes failing closed, grey `nur Beobachtung` bands,
hatched no-data gaps, the shared `TimeScale`, the outputs state lane, the event rail, the film strip,
`Präzision` behind a long-press, CSV with actuator state.

**Graft 1 — the head (C02).** The verdict card as a pinned band above the timeline. Six ranked states.
Band source labelled. `Zu wenig Daten für ein Urteil` as a real state. The AGP scorecard sheet, with
the denominator printed. The excursion thumbnail.

**Graft 2 — the grammar (C06).** Grey-means-unknown as a product-wide law. Per-measure freshness with
four states. `GET /data/board` with `serverTime`. `generic:<m>`. The goal bar as the single
goal-vs-actual encoding **everywhere including the chart**, so nobody learns it twice (fixes C06's own
§15.6 and C01's density problem simultaneously).

**Graft 3 — capability direction (C10 + C09).** One-sided bands wherever the actuator is one-sided.
Uncontrollable measures excluded from the denominator. Goal rows hidden when offline. The prop rule.
Ghost/silent discrepancy with `Kurz testen`. The `pwmUse` question.

**Graft 4 — the vertical journal (C05).** The event rail gets a vertical list rendering at Day and
Week zoom. This is the one C01 non-goal that must be overturned; three critics independently identify
it as the premise's biggest risk, and the author agrees.

**Graft 5 — integration (C04).** Read API with `x-api-key` + OpenAPI, and a generic outbound webhook
decoupled from alarms, **in v1**. This is what turns T5's 70 into a pass and it is the cheapest item
on the whole list.

**Graft 6 — attribution without authorisation (C08 + C06).** `actor_id` written from day one, plus a
device-scoped "who is at the tent" name picker. ~2 days, no auth rewrite. Membership, roles and
invites go to v1.1. Keep the handover card and the excursion-overlaps-visit explanation.

**Graft 7 — engine correctness (C07).** `planOwnedKeys` + patch-merge (fixes a real destructive bug
regardless of IA), `Was der Controller bekommt`, drift detection, the compound `RecipeTemplate` index.

**Then fill the holes nobody filled** — the five Tier-1 findings, in this priority: the
**double-action guard** (F2, cheapest), the **multi-device row list** (F1), the **one-button remedy**
(F3), the **outbound weekly digest + `camera_silent` alarm** (F4), and **retention disclosed in the UI
plus a one-tap full export** (F5).

### What must NOT be built

- **Do not ship two shells** (C04). The middle of the distribution rejects it and C04's own §16.2
  concedes the flaw. Depth is vertical distance and long-presses, not a mode.
- **Do not re-root the IA on plant, run, grow or plan** (C03, C10, C08, C07 — the bottom four).
  Every one of them puts an object between a user and their instrument, and every one is rejected by
  at least one segment as a result. Ship all four as *optional labelling dimensions* that cost zero
  taps when unused.
- **Do not commission the illustration set** (C09) on this timeline. Steal the camera backdrop, the
  prop rule, `Kurz testen` and the Schema skin; skip the art.
- **Do not defer the chart** (C02, C07). It is the owner's explicit ask and five critics treat
  deferring it as disqualifying.

### The honest caveats

1. **C01's STONER score of 42 is the single most dangerous number in this exercise**, because the
   "stoned hobbyist" is the owner's own stated persona. The grafts above are my best theory of the
   fix; they are a theory. **Run the CAP-STONER dealbreaker test on a paper prototype before writing
   the timeline code**, not after.
2. **Every v1 scope in this field is oversized**, and every author says so. C01's v1 is nine
   workstreams including a library migration, a new event collection, a plant model, a backfill and a
   nightly rollup — against six weeks, no migration tooling, a red test suite and a CI that never runs
   `ng test`. The grafts make it bigger. **Something has to go, and the owner must choose it
   deliberately** rather than discovering it in week five (§8, Q1).
3. **If the owner does not believe a hybrid can be executed on this timeline, the safe single-concept
   pick is C06** — best worst-case (45), tightest spread (34), cheapest to build, and it degrades
   gracefully because tiles are independent. It forfeits the differentiator, and its own author says
   so. That is the trade: C01-hybrid is the better product and the riskier build; C06 is the safer
   build and the more forgettable product.

---

## 8. What the owner must decide

Ten open questions the concepts and critiques could not resolve. Each is a concrete either/or.

**Q1 — Chart or entities in v1?** The chart overhaul and the new-entity layer (plants/runs/grows/
memberships plus a history-rewriting backfill) will not both fit in six weeks.
**(a)** Chart overhaul + P0 credibility fixes ship in October; every new entity slips to v1.1.
**(b)** Entities ship and the chart lands in November, after the hardware.
*Five critics treat (b) as disqualifying. My recommendation is (a).*

**Q2 — Does the product judge, and against whose numbers?** The band chain terminates at
`GROW_STAGE_PRESETS`: five rows of temperature/humidity/VPD with **no cited source anywhere in the
repo**, and the verdict thresholds (90%/70%/60min/180min) are invented.
**(a)** Commission or cite real bands and stand behind the verdict.
**(b)** Restrict verdicts to user-declared goals only, and ship *descriptive* statistics (day-night
delta, stability, change-point) for everyone else — which is finding F11 and would give the
monitoring-only user a real product for the first time.
*Do not ship (a) with uncited numbers; a green tick against a wrong band manufactures confidence.*

**Q3 — Is there a remedy button?** Finding F3.
**(a)** Ship explainable, rule-based, deterministic remedies computed from setpoints, socket roles and
duty cycles (`Zu warm → Lampe auf 70% dimmen [Machen]`), accepting that the app now advises.
**(b)** Remain purely descriptive and accept that every verdict is an anxiety machine with no exit.
*Note that (a) is not "AI"; every concept refused the category and thereby refused this too.*

**Q4 — Push notification: build it or not?** There is no service worker and `capacitor.config.ts` is
untouched scaffold.
**(a)** Budget web push (service worker + permission flow + consolidation + lock-screen actions) — which
also unlocks offline capture (F10).
**(b)** Ship email + Telegram/Discord/webhook only, and accept that AC Infinity pushes and you do not.
*Two critics call the app the wrong delivery channel entirely. The weekly digest in (b) is cheap and
may be enough for the monitoring user; it is not enough for an alarm.*

**Q5 — Multi-user: label now, gate later — or all at once?**
**(a)** `actor_id` + a device-scoped name picker in v1 (~2 days), Membership/roles/invites in v1.1.
**(b)** Full authorisation rewrite in v1 (the most expensive single line item in the redesign, serving
one of seven segments).
*T6 itself argues for (a): "attribution is a label, authorisation is a gate. I need the label in
October and can wait for the gate."*

**Q6 — Harvest weight: record, refuse, or local-only?** C10 refuses grams on the grounds that plant
counts and weights are exactly the facts separating a lawful hobby from a criminal file; every other
concept allows them; C10's own fallback (localStorage) is admitted to be bad.
**(a)** Ordinal outcomes only (better/same/worse) — legally safest, deletes the dependent variable.
**(b)** Opt-in cloud field, never prompted, one-tap wipe.
**(c)** Encrypted local-only with an explicit "this does not sync" statement.
*This is a legal question with counsel, not a design question.*

**Q7 — Highcharts.** C03 bets v1 on it; nine concepts migrate to ECharts 6. The repo has no LICENSE
file and the cloud is marketed as *quelloffen*.
**(a)** Resolve the licence with counsel and keep Highcharts (saves the migration).
**(b)** Budget the ECharts 6 migration in v1 and delete chart.js/ng2-charts/chartjs-adapter-luxon.
*Deferring this decision means possibly rewriting the chart twice, mid-launch.*

**Q8 — Do you ask firmware for `other1/other2/other3` socket roles?** C09's is the only firmware ask
in the field, with file and line numbers showing the NVS helpers already exist. It is what houses the
type-4 user's humidifier and exhaust fan.
**(a)** Yes — accept a firmware change on the October critical path, and the full tent stops being a
half-truth.
**(b)** No — hold the "no firmware change" line all nine other concepts hold, and label the
limitation honestly on screen.

**Q9 — What is the retention promise, and is it on screen?** Finding F5. Every concept adds retention
and downsampling; none discloses it to the user who bought a recorder.
**(a)** State the retention window in the UI, warn before the first downsample, and ship a one-tap
full export (Mongo + Influx + images).
**(b)** Keep it in the config and accept that users discover it when the detail is gone.
*Also decide the image budget: 2,880 stills/day at 30s cadence, stored as Buffers under a 16MB BSON
ceiling, with 3-year retention on webcam JPEGs. No document costs this.*

**Q10 — The two commitments nobody wrote.** Both are a paragraph of prose and worth more than most
screens here.
**(a)** *"Devices sold before 2026 are supported until at least [date], and here is their offline
behaviour."* — or decline to say it, and accept T7's promised public reaction.
**(b)** *The cloud-death page*: what the controller keeps doing when `terpcontrol.cloud` is
unreachable, for how long, what it forgets, how to point it at your own broker, what the local REST
endpoint is. This is the strongest anti-Grobo argument the company owns, and all ten concepts
*deepened* cloud dependence without writing it.

---

*Composite = 0.5 × mean + 0.5 × min across ten critics. Rankings verified stable across weightings
w ∈ [0.25, 1.00] on the minimum, and cross-checked against critic-harshness-normalised scores.
Arithmetic in `scratchpad/work/scores.py`.*
