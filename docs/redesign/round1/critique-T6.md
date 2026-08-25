# Critique — User Type 6, the Cannabis Grow Club

**Who is writing this.** We are four to six people with keys to one room and two controllers. Watering
and fertilising is the whole job. The question I ask this software every single day is *"what did the
person before me do, and do I need to do it again?"* — and the question I ask it once a season, usually
because a plant went wrong or because somebody official asked, is *"who fed what on the 3rd of
September, and how much?"*. We also operate in a legal grey zone where a cloud full of plant counts and
harvest weights is evidence, and where §17 Abs. 2 KCanG means our members' participation is a legal
fact, not a nice-to-have.

I judge only on that. A concept that is beautiful for a lone stoner watching his tent from bed and
useless to us scores badly here and I will say so flatly.

---

## The four tests I actually applied

1. **Is multi-user real, or is it a schema field and a promise?** A concept that stamps `actor_id` and
   ships the UI in v1.1 has shipped me *nothing*. Eight of ten do exactly this.
2. **Is attribution on every action, and is it on by default for us?**
3. **Can two people avoid double-feeding the same plants?** This is the failure that costs a crop, and
   it is the one nobody designed for.
4. **Is the feed record fast on shift AND reconstructable months later?** Those pull in opposite
   directions and only some concepts noticed.

---

## The ranking

### 1. C08 "Shared Grow" — 88

**Verdict: the only concept in this set written by somebody who has thought about a room with more than
one person in it, and it earns the top slot on that alone.**

The structural decision that wins it: **people join a *Grow*, not a *device*.** A `Grow` owning
`device_ids[]`, memberships, plants, journal and feed regime is exactly our shape — we have two
controllers in one room and today that is two unrelated log streams. Nobody else in this bake-off got
there. C03 attaches plants to a device. C06, C09 and C10 are all device-scoped. C08 is the only concept
where "Raum 1" is a first-class thing.

The second decision that wins it: **the Visit as the unit of attribution and handover.** The home screen's
top card is not a gauge, it is *"Seit deinem letzten Besuch — Kim war gestern 19:04–19:21 im Zelt: gegossen
4 L, Blüte-Dünger Woche 3 −20 %, 1 Foto."* That is literally the sentence I open the app to read. No other
concept has a handover surface at all. C05's thread comes closest and makes me scroll for it.

Third: **membership ships in v1** — `Membership` with four roles, `resolveGrowAccess` replacing
`auth.middleware.ts:172`, invite by link+code, the whole `~20 owner-scoped queries` list enumerated by
file and line in §8.4. That is a costed plan, not a wish. And the `grower` `:self` tier is the correct
tier for a member: logs their own work, sees the room, administers nobody.

Fourth, and this is the thing I did not expect: **the deviation is recorded as a first-class fact.**
`payload.deviation` against the schedule prefill means a report can say *"Kim hat drei Wochen lang auf
80 % gedüngt"*. That is "who did what" answered at the level that actually matters — not that somebody
fed, but that somebody fed *differently*, three weeks running. Nobody else stores this.

Fifth: the privacy posture is the best-argued in the set after C10's. Enumerated refusals (§8.3), no
real names, no email visible between members, no account-lookup endpoint at all (invite codes sidestep
enumeration abuse entirely), corrections-not-edits via `correctsEventId`, tombstoned departing members,
attribution *deletable* — with the correct reasoning that an immutable log protects a regulated club
against its own staff and victimises an unregulated grower. And it says no to §26 with a pointer at the
compliance SaaS we already pay for, which is the right answer.

**Fatal flaws, and they are real:**

- **The Visit is inferred, and the author knows it.** §15.3 is honest: nobody will press "start visit",
  so visits must be inferred, and *"inference is exactly what a club cannot rely on"*. Our §17 record
  cannot be a mix of solid and dotted brackets. Either you have a declared visit or you have a guess,
  and an export that contains both qualities is an export I have to explain.
- **It does not stop a double feed.** The due card advances `feedStepIndex` when somebody taps
  `Erledigt`, which is genuinely most of the answer — but the capture flow itself has no interlock. Marek
  opens `[ Gegossen ✓ ]` at 19:40, one tap, and there is nothing between his thumb and a second full
  feed of the same plants Anna did at 18:10. The handover card is *above* the button; nothing forces him
  through it.
- **The v1 is enormous and membership is the biggest single line item in it.** Grow + Plant + GrowEvent
  + Visit + Membership + auth rewrite + full ECharts chart + feed regimes + retention, in six weeks,
  against a suite of 38 `it()` blocks that cannot pass. §13's own de-risking statement says membership
  may slip and the product "degrades to a solo app whose actor always says Du". That is the single
  sentence in this document that would make me not buy.
- **Adaptive 2/3/4-tab navigation** (§15.11) is a support problem specifically for us: I onboard six
  people at a Tuesday meeting and "tap the Futter tab" is advice half of them cannot follow.
- Club mode **pauses the camera during visits** by default. Correct for GDPR, and it means the frames
  around the one thing I want to review — somebody working on the plants — are the frames that don't
  exist.

**Steal:** the Grow-not-device root object; the handover card as the home screen's top card; `payload.deviation`;
invite-by-code with no email lookup; tombstoned members; the PERSONEN lane on the chart; the enumerated
refusal list.

---

### 2. C01 "Loupe" — 74

**Verdict: the best *record* in the set and the worst *shift interface*, undone for me by putting the
club in v1.1 after admitting we are the concept's peak value.**

The Day Sheet is the single best reconstruction artefact any of these ten produced:

```
09:12  💧  Gegossen · 8 L · BD #1, BD #2 · Chris
09:14  🧪  Gedüngt · Schritt 7/13 · EC 1,8 · pH 6,1 · Chris
```

Time, action, dose, plants, person, on one line, with the climate lanes directly above it on the same
x-axis. That is "who did what and how did the plants react" rendered as one picture, and I want it.

The feed model is also the most correct in the set for our purposes: **`feed.doses` copied as resolved
values, never as a reference** — *"the plan may be edited next month; the record of what was actually
mixed must not change."* That sentence is worth the whole document. Somebody who has been asked to
reconstruct a feed wrote it. Add `readings.where` mandatory (`input`/`runoff`/`reservoir`/`soil`), EC
canonical with `ppmScaleEntered`, `ecBasis: delta_over_source`, and the mixing-order checklist, and the
data model is right.

`actor` as a query param, and Cycle-zoom day columns showing the initials of everyone who touched the
room that day (`CG │ │ MK │ │ │ CG │ MK`), is a genuinely good club view.

**Fatal flaws:**

- **`DeviceMembership` is v1.1.** §15.8 says it out loud: *"the concept's peak value and the owner's
  stated priority are not aligned"* and §13 puts clubs in Q1 2027. So at launch I get a beautiful
  single-user timeline and share one password, which is what we do today.
- **Horizontal time is wrong for reading a shared diary.** §15.1 admits it. Finding "what happened on
  the 3rd" is a sideways scroll through a 14 px-per-day strip. The Day Sheet rescues it *if* you can
  find the day; getting to the day is the friction.
- **No handover.** There is no "since you were last here". A shared record without a handover surface
  makes me do the diffing in my head every time I open the tent.
- **No double-feed prevention of any kind.** Two taps to a durable watering with no check on what
  anybody else did in the last hour.
- One screen, one performance budget (§15.3) — six people on cheap Androids in a cellar is exactly the
  environment where that bet loses.

**Steal:** resolved-not-referenced doses; the Day Sheet layout verbatim; `readings.where`; the initials
row on day columns; `actor=` as a filter.

---

### 3. C03 "Beet" — 68

**Verdict: the best multi-plant capture ergonomics in the set — two taps for three plants with per-plant
overrides — attached to a multi-user story that ships as fields in v1 and UI in v1.1.**

The capture design is the one I would hand to a member on shift. *"Values live at the top, plants live at
the bottom, and identical is the default."* Three plants, same water, two taps, one `plant_events` row
with `plant_ids: [a,b,c]`. One plant needs less: tap its row, inline field, lands in
`overrides[plant_id]`. That is the real shape of feeding a mixed bed, and it is the only concept that
modelled it as *one event with per-plant deltas* rather than N events or one lie.

`correctsEventId` as append-only compensating correction rather than edit-in-place is right for us.
`regulatoryRelevant` as a flag, `actorLabel` as a user-chosen pseudonym never an email, jurisdictionMode
with `private` default and club opt-in, one-tap wipe that really deletes (Mongo + Influx range + images)
— all correct.

Cursor pagination on `GET /plants/:id/events` **from day one**, with the reasoning stated (multiplying
rows without it makes the diary the slowest page in the app) — we generate a lot of rows and nobody else
put pagination in the v1 must-list this explicitly.

**Fatal flaws:**

- **`viewer` and `:self` are v1.1; v1 is `owner` + `grower` with "minimal UI".** §11's own Type 6
  walkthrough: *"Two people, one tent, one account in v1."* So the attribution I need is stored and
  invisible.
- **The lead-plant (`Leitpflanze`) model is honest and hostile to us.** One plant per device carries the
  ★ and owns the setpoints; the others read "Klima folgt Gorilla Glue #4". A club bed with staggered
  plants gets a permanent banner telling us the room is failing plants we cannot serve. §15.2 admits a
  competitor could quote it back at them. I would rather be told than lied to, but it is a screen my
  members will ask me about every week.
- **No handover, no visit, no "what happened since".**
- **No double-feed prevention.**
- §15.7 is the one that would bite us hardest: capture happens *"standing in a tent, phone in one hand,
  watering can in the other, on the worst wifi in the house"*, the answer is `localStorage` retry with
  no service worker, and *"they may log it twice"*. Duplicate entries in a shared record are worse than
  duplicate entries in a personal one — I cannot tell a double-log from a double-feed.

**Steal:** the two-taps-for-N-plants sheet with `overrides`; append-only corrections; day-one cursor
pagination; the plant-events shape (`data` typed per event type, `site` mandatory on measurements).

---

### 4. C05 "Thumb Journal" — 63

**Verdict: the fastest thing to use on shift and the thinnest record to read afterwards — it optimises
the half of my problem I care about second.**

One tap to log a watering with the last volume and last plant set is genuinely the right ergonomics for
somebody holding a can. The Mengenring on long-press is a good idea. The machine-written half — the
daily verdict card, the excursion card carrying **the camera still from the moment of the peak** — is
the most literal delivery of "it does the diary keeping FOR YOU" in the set. `/tidy`, the desktop
batch-fill table for entries with `refineNeeded`, is explicitly designed for *"a club secretary or a
techie reclaiming data quality on a big screen on a Sunday"* — somebody was thinking about me when they
wrote that.

Roles are right (`member` = `:self`), invites are codes not emails, `Meine Einsätze` is a real §17
participation view, and switching to club mode shows an honest two-sentence warning that includes *"und
es ist eine Aufzeichnung darüber, wer was getan hat"* — not buried.

**Fatal flaws:**

- **Multi-user is v1.1 and the author says why: shipping it alongside a new data model and a chart
  rewrite is how you ship a data-leak bug.** He is right, and it still means October gives us nothing.
- **§15.2 is a dealbreaker dressed as a weakness: "one-tap logging degrades data quality, by
  construction… Net effect: more entries, each thinner."** For a solo grower thin entries are a
  personal problem. For us they are *the* problem: `💧 Gegossen` with no volume, no plant and no product
  is not a record, and in three months it answers nothing. The mitigations are refine chips (which the
  member will ignore) and `/tidy` (v1.1, desktop-only, and the person who logs is not the person who
  tidies).
- **§15.3, "same as last time ossifies mistakes"**, is materially worse with six people: one member's
  wrong default becomes everybody's default silently.
- Accidental writes are *guaranteed* (§15.4) — a five-button bar at the bottom of a phone in a dark
  cellar with six people. Duplicate collapse handles double-taps by one person and nothing about two
  people.
- Reporting is a week card and a CSV; §15.6 concedes it. No per-member report, no "every feed of
  Bio-Grow this season" query.

**Steal:** the excursion card with the still from the peak minute; `/tidy` as a first-class screen (and
ship it in v1, not v1.1); `Meine Einsätze`; the honest club-mode consent copy; the `clientId` idempotency
key on capture.

---

### 5. C07 "Der Plan" — 62

**Verdict: the only concept whose primitive actually prevents a double feed, and it defers both the
multi-user layer and the feed engine — the two things that make it valuable to me — to v1.1.**

The insight nobody else had: **a task is a shared object, and a done task disappears for everyone.**
*"The grower opens Jetzt, sees Heute: Gießen — 2,0 L pro Topf, taps Erledigt. The owner opens the
Tagebuch and sees 19:14 Gegossen 2,0 L · EC 1,8 — Marek."* That is a shared to-do list with attribution,
and a shared to-do list is structurally the answer to "did somebody already do this". Marek arrives, the
card says nothing is due, he doesn't feed. Every other concept leaves that to the human.

The diary genuinely writing itself from plan execution (stage advance, gate confirmation, task done with
the plan's numbers pre-filled, setpoint override with actor, Sunday week summary) is the strongest
mechanical delivery of the owner's diary ask, and every one of those rows is attributable.

§14a is the most engineering-honest section in the whole bake-off: it confronts the recipe engine's
seven real limits by file and line and answers each.

**Fatal flaws:**

- **§13 puts `Membership` + attribution *and* the feed-programme engine in v1.1.** In October, tasks
  carry "free numbers plus one ownerless EC ladder". My single most important topic ships without a
  schedule, and my second most important ships without a second login. That is a launch that does
  nothing for me.
- **One plan per device.** §15.2 admits it is *"honest about climate and dishonest about plants"*. Our
  bed is staggered by design — rolling harvests are how a club supplies members. The stage ribbon will
  be wrong for most of our plants most of the time.
- **Journal rows stay in `DeviceLog`.** Defensible for reuse, and it means my diary lives in the same
  collection as MQTT errors and boot messages with a string-prefix discriminator. §15.6 concedes a
  chatty plan produces 8–12 rows/day into a collection with no pagination.
- The override sheet's three-way scope question (§15.1) is a decision I do not want to hand to a member
  at 22:00.

**Steal:** the task as the shared, claimable, completable object — this is the double-feed answer and it
belongs in whatever wins; `Später` snoozing to the next photoperiod boundary rather than to a clock
time; auto-written journal rows with `planned: true` when untouched.

---

### 6. C04 "Zweigang" — 58

**Verdict: the cleanest mapping of club roles onto interfaces anybody proposed, wasted on a v1 that has
no roles in it.**

§8.1 is genuinely the best argument in the document and it is *our* argument: *"A twenty-member
Anbauverein has one admin who lives in Profi and twenty members who live in Einfach, and neither has to
negotiate with the other's interface."* `logger` (the `:self` tier) **defaults to Einfach on invite**.
That is the right shape — I do not want a member who is three beers in to be one tap from the alarm
threshold matrix, and I do not want to run the club's export from a three-screen shell.

v1 does ship the things I need underneath: plants + `GrowEvent` + `PlantStageEvent`, water in 2 taps and
schedule-feed in 1, `growregimes` seeded with the owner's five named media/regimes with
`source_url`/`retrieved_at`/`Zuletzt geprüft`, EC canonical with the `delta_over_source` arithmetic
rendered explicitly, export week, retention defaults, panic wipe.

**Fatal flaws:**

- **§8 opens with "v1.1, not v1"** for memberships. So the role→gear mapping that is the concept's best
  club argument does not exist at launch, and the thing that does exist is two shells to maintain.
- **Gear is per user, not per device** (§16.7). Our secretary runs two rooms and wants Profi for the
  export and Einfach for the Thursday watering; she gets one setting.
- **No handover, no visit, no attribution UI, no double-feed prevention.**
- §16.2's "middle user is served worst" is our whole membership: people who want three things from Profi
  and everything else from Einfach, ping-ponging.
- Two shells means two of everything to QA against a 36-cell matrix on a red test suite (§16.6), and
  manual gates get skipped in October.

**Steal:** role determines default gear on invite; the substrate+feed-line pair as one selectable thing
with `feedStartsAt` so "All-Mix, don't feed yet" is expressible; the `Erledigt` long-press → prefilled
sheet for the deviating grower.

---

### 7. C09 "The Tent" — 48

**Verdict: a beautiful single-room object that admits it evaporates exactly where I need it, and it gets
attribution dangerously wrong by default.**

Credit where due: the epistemic argument is right (an object not in the picture cannot have a control),
the prop rule (unverifiable objects never take a state colour) is the correct answer to a wrong picture,
and the club walkthrough is decent — invite links over Telegram, handles not emails, filter the diary by
Kim.

**Fatal flaws:**

- **§8.2: "With attribution off, `actor_id` is not written at all — not written and hidden, *not
  written*."** And it defaults off in `private` mode. If our grow lead forgets to flip club mode in week
  one, the first month of our history is permanently unattributable and there is no recovery. C06, C08
  and C10 all write `actor_id` from day one and gate the *display*. This is the correct engineering call
  and C09 made the opposite one. On its own it drops the score by fifteen points.
- **§13's own de-scope order: "Membership (17) slips first… clubs are the one user type that can wait a
  point release."** In writing. Ship a read-only share link for them in the meantime.
- **§15.3: "A club with a dozen devices gets a list, which means the concept's central idea evaporates
  exactly where the club user type needs it most."** We have two rooms today and want four.
- The whole thing depends on an illustration commission that has no graceful degradation (§15.1), plus
  four legacy templates of pure cost.
- No handover, no double-feed prevention, no shared conditions.
- Landscape phone does not work (§15.6), and half my members hold a phone sideways.

**Steal:** the prop rule; `Kühler / Entfeuchter — dieselbe Steckdose` named honestly; the Schema skin as
a genuinely free techie surface; `Kurz testen` on a socket (a member can verify a relay is alive without
calling me).

---

### 8. C06 "Glance Tiles" — 45

**Verdict: honest by construction about *now*, structurally useless for reconstructing *then*, and its
own §15.9 concedes we are unserved at launch.**

The good parts are real and they are not club parts: the freshness law with grey reserved product-wide
for "I do not know", `GET /data/board` replacing the N-request poll, the evidence-rule tile catalogue,
and — the one thing I would take — **`JournalEntry.actor_id` and `DeviceLog.actor_id` written from day
one of v1 even though nothing renders them until v1.1**, with the correct reasoning: *"Losing the data
is unrecoverable; not showing it is a UI change."* That is exactly the call C09 got wrong.

**Fatal flaws:**

- **§15.9, verbatim: "Type 6 is unserved at launch… A share link is not multi-user, and I should not
  pretend it is."** Correct, and it is still a segment shipped empty.
- **A tile is a container for "now".** §15.1 concedes the differentiating insight lives behind a tap.
  My question is never "what is the temperature", it is "what happened here since Thursday". The board
  answers the question I do not have.
- The Feed tile nags and hiding it is a long-press (§15.10) — with six members, that reminder fires on
  six phones and gets dismissed by five of them, and the sixth thinks somebody else got it.
- No handover, no visits, no attribution surface, no double-feed prevention.
- Drag-and-drop grid is §15.4's most-likely cut, and cutting it guts the concept's answer to the seven
  types.

**Steal:** write `actor_id` from day one and gate display, always; the grey-means-unknown rule;
`GET /data/board` batching.

---

### 9. C10 "Durchgang" — 40

**Verdict: the sharpest legal thinking in the set, wrapped around a thesis that pays out in five months,
a run model that breaks on the way we actually grow, and a default that deletes my record.**

The privacy architecture is genuinely the best-argued: `RunDayStat` as a ~200-byte/day comparison
substrate means the product *can* delete raw telemetry and still compare — retention becomes a feature
rather than a compromise. Ordinal outcomes (stars, better/same/worse) instead of grams. `RunOutcome` as
a separate entity precisely so it can be dropped without leaving a hole. Panic delete two taps from
anywhere. `contributeAnonymously` gated at ≥25 runs. If somebody knocks on our door, this is the
architecture I would want to have been running.

**Fatal flaws:**

- **§13, explicitly: multi-user is not in v1. §15.10: "type 6 gets nothing in October beyond `actor_id`
  sitting unused in the database."**
- **`Auf Zusammenfassung reduzieren` is the DEFAULT at run close and it is irreversible** — it deletes
  measurement series, **photos and notes**, keeping only day stats. That is a default that destroys
  precisely the thing I need: the reconstructable record of who fed what. §15.8 admits a user who wants
  the photo from day 41 has lost it permanently. For a club this is not a privacy feature, it is
  automated evidence destruction of the wrong evidence — the operational record we need internally, while
  the day-stats that are actually harmless survive.
- **§15.5: the run model breaks on staggered plants, perpetual grows and sea-of-green.** That is how a
  club supplies members. One day-0 per device is wrong for us from week one, and the whole `Vergleich`
  screen is run-scoped.
- The core value arrives at run 2 (§15.1, the author's own "most serious objection"). We would have
  three to five months of a product whose home-screen headline is an IOU.
- Feeding is stored back into `DeviceLog` rows with more optional keys on a `Schema.Types.Mixed` bag.

**Steal:** the whole §8.3 architecture — summary substrate, ordinal outcome, `RunOutcome` as a
separately shreddable entity, retention as a designed feature; `Was war anders` as a diff of two runs'
decisions.

---

### 10. C02 "The Verdict" — 33

**Verdict: for us this is a roadmap that starts in 2027, and the one thing it ships in October is an
answer to a question we do not ask.**

The verdict board for a multi-room club (`Raum 1 · Alles in Ordnung · 97 % · live` / `Raum 3 · Da
braucht dich was · Temperatur 2 Std 40 Min zu warm`) is a genuinely good Vorstand screen, and the
excursion thumbnail — the picture from the minute the room peaked — is the single best small idea in the
bake-off. Refusing to break a single existing share link is the right discipline.

**Fatal flaws:**

- **`DeviceMembership` is v1.4 — June 2027.** `FeedSchedule` is v1.3 — April 2027. `JournalEntry` and
  plants are v1.2 — February 2027. My single most important topic is eight months after the hardware
  ships and my second is ten. §11's Type 6 walkthrough concedes it: *"In October 2026 the club shares
  one login, which is what they do today anyway."*
- **Watering and feeding cannot be recorded at all in v1.** Not thinly — at all.
- The verdict is climate time-in-range. Ours is a *people* problem and a *feeding* problem; a green tick
  over a room where nobody has fed in five days is a confident answer to the wrong question, and §15.2
  half-admits it.
- §15.4: in October the verdict sits on top of today's fifteen-hidden-axis chart.

**Steal:** the excursion thumbnail; the multi-room verdict board as a club landing page; `verdict.band.source.*`
always labelling where a band came from.

---

## What nobody got right

These are needs of mine that **not one of the ten** met. This is the most useful part of this document.

1. **Nobody prevents a double feed. Not one.** Ten concepts optimised capture *speed*; zero optimised
   capture *safety between people*. C07's task model is the only primitive that structurally helps (a
   done task disappears) and it is v1.1; C08's due card advances the step and then puts a one-tap
   `[ Gegossen ✓ ]` right next to it with no interlock. What is missing everywhere: at the moment of
   capture, **"Anna hat A1–A3 vor 1 Std 30 gefüttert. Trotzdem?"** — a soft block on the *same plants*
   inside a configurable window, showing who and when, requiring one deliberate extra tap to proceed.
   That is a day of work and it is the difference between a record and a crop. A double feed is the most
   expensive thing that happens in a shared room and it is the failure mode this entire bake-off ignored.

2. **Nobody models a rota. All ten model the past; none model whose turn it is.** Club watering is a
   duty roster: Anna Mon/Thu, Marek Tue/Fri. Every concept treats §17 Abs. 2 participation as
   backward-looking logging and prints a participation *export*, when the thing that makes participation
   actually happen is a forward-looking assignment with a reminder aimed at one named person and an
   escalation when nobody shows. C08's due card, C07's task card, C06's Feed tile and C05's dot all fire
   the same undifferentiated nag at everyone — which in a six-person club means five people assume the
   sixth got it. A task with an *assignee* is the missing field, and it is one field.

3. **Nobody designed the shared-login reality they all predict.** Eight of ten defer memberships and
   then say some version of "clubs share one login, as they do today". Not one of them designs the
   graceful version of that: a **device-scoped "who is at the tent" picker** — a list of names the owner
   types once, no accounts, no auth rewrite, stored on the Grow/Device, stamped onto `actor_id` at
   capture, upgradeable to real memberships later. That is two days of work, it needs no
   `auth.middleware` surgery, and it would have given me attribution in v1 in *every one of these ten
   concepts*. Nobody proposed it because they all treated attribution as downstream of authorisation. It
   is not. Attribution is a label; authorisation is a gate. We need the label in October and can wait
   for the gate.

4. **Nobody can answer the cumulative question.** All ten store products and doses per event. Not one can
   tell me **how much Bio-Bloom plant A3 has had this cycle, cumulatively, and from whom**, without me
   exporting a CSV and doing it in a spreadsheet. C09 and C10 mention cumulative *litres*; nobody does
   cumulative *product per plant*. When a plant goes yellow, that total and its authors are the first
   thing I want, and it is a per-plant sum over events that every one of these data models could
   compute and none of them surface.

5. **Nobody has a place for a persistent condition.** Every concept has a journal (things that happened)
   and several have tasks (things to do). None have **conditions**: "the dehumidifier tank is full",
   "the CO₂ bottle is nearly empty", "socket 3 is loose, wiggle it", "do not water A3, it is
   overwatered". These are standing facts with an open/closed state and an owner, and they are what a
   shared room actually pins to the tent door. C08's visit note is optional free text that scrolls away
   in a day. This is a small entity — `Condition { text, openedBy, openedAt, closedBy?, closedAt? }` —
   rendered as a short list at the top of the home screen, and its absence means our real handover
   continues to happen in a WhatsApp group where it is unattributed, unsearchable and stored in the US.

6. **Nobody handles member churn or member onboarding into an in-flight grow.** People join and leave a
   club constantly. C08 alone has tombstones. Nobody answers: a new member joins in week 7 — what does
   she read to know what has been done to these plants? A scroll back through eight weeks of a thread is
   not an answer. A per-plant "what has happened to this plant" digest — stages, feeds with products and
   totals, training, issues — as one readable page is a small screen nobody drew.

7. **Nobody separates the club's exposure from the individual member's.** Every concept has exactly one
   privacy switch per device/grow, flipped by the owner, applying to everybody. In a grey-zone
   jurisdiction I want the club's operational record complete *and* an individual member able to say
   "log my work so the club can show participation, but do not put my handle in any cloud export".
   That is a per-membership flag, not a per-grow mode, and treating it as a per-grow mode means the
   most cautious member in the room sets the policy for everyone or gets overruled by the owner.

8. **Nobody can capture in a cellar.** Every single concept concedes there is no service worker and none
   claims offline capability. Our room is a basement with one bar of signal and six people logging on
   phones. C05 has a `localStorage` queue and admits a cold start with no network shows the browser's
   offline page. C03 admits the retry queue can produce a double-log — which in a shared record is
   indistinguishable from a double *feed*, so the one failure mode I care most about is manufactured by
   the app's own recovery path.

---

## The dealbreaker test

**Two members, two phones, one room, no signal in the cellar.**

Anna feeds plants A1–A3 at 18:10 — Biobizz Bloom, 2 ml/L in 4 L, per the schedule — and leaves. Marek
arrives at 19:40, opens the app on the tent floor, and the concept must do all three of:

1. **Before he can commit a feed, tell him A1–A3 were already fed 90 minutes ago, by whom, and with
   what** — not on a card he might have scrolled past, but in the capture flow itself, requiring one
   deliberate extra tap to proceed anyway.
2. **Let him log the plants he does feed** — product, dose, volume, plants, his name — **in under 15
   seconds with one bar of signal**, and never silently write it twice.
3. **Three months later, answer "who fed A3 on 3 September and how much Bloom has it had in total"** in
   the app, without an export and without me scrolling a thread.

A concept that cannot pass all three has not solved a shared grow; it has solved a solo grow and added a
name field. **Eight of the ten fail at step 1 outright, and no concept in this bake-off passes all
three.** C08 passes 2 and most of 3 and is the only one whose architecture could be extended to pass 1
without redesign — which is why it wins, not because it is finished.
