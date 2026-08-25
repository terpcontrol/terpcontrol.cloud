# Critique — THE STONER LENS

**Who I am.** At the moment I use this app I am impaired. Short working memory. Low frustration
tolerance. Poor fine motor control. I am standing in a dim tent at 02:10, one hand holding a watering
can, phone in the other, wet fingers. I opened the app for one of exactly two reasons: **"is it fine?"**
or **"I did a thing, write it down."** Anything else on the screen is a tax.

**How I score.** Taps to the two jobs. Decisions visible per screen. Jargon on the default surface.
Whether a mistake is recoverable *by me*, not by a support ticket. Whether any screen shows more than
about five choices. Whether I have to carry anything in my head from a previous screen.

I am not a committee. A concept that is brilliant for a club secretary and confusing for me scores badly
here, and I say so plainly.

---

## The two measurements, for all ten

**Job A — "is it fine?"** measured as: how many *words of interpretation* stand between opening the app
and knowing the answer. Zero is a glyph plus a sentence. Bad is a grid of numbers I must compare to other
numbers myself.

| # | Job A: what the home screen actually says | Job B: taps to log a watering | Choices visible on home |
|---|---|---|---|
| C01 | nothing — 4 numbers over 4 targets, I do the comparing | 2 (via a 9-icon capture sheet) | ~8 regions + 5 zoom buttons + FAB |
| C02 | **one glyph + one plain sentence** ("Dein Klima passt.") | 2 | 1 to read, ~7 tappable |
| C03 | "✓ 94 % im Zielbereich gegenüber deinen Zielwerten" — a % plus a clause | 2 | card ×N + strip + capture bar + 3 tabs |
| C04 | **one word inside a ring** ("Passt") + 2 verdict tiles | 2 (**1** when a feed is due) | ring + 2 tiles + 2 buttons + due card |
| C05 | "alles im Ziel" in a 72 px strip above a chat thread | **1** | strip + thread + 5 thumb slots |
| C06 | "✓ 3/3" — a fraction, not language | 2 (feed 3) | **~9 tiles × 5 elements** |
| C07 | plan band + "im Ziel 91 %" + a task card | 3 (**1** when a task is due) | band + task card (3 buttons) + 3 tiles + outputs + peek |
| C08 | a handover paragraph + "92 % im Zielbereich" + "1 Ausreißer…" | **1** | handover card + 2 buttons + due + 4 tiles + cam + outputs |
| C09 | **one sentence** ("Alles gut" / "Da stimmt was nicht") | 2 | ~18 tap targets in the scene |
| C10 | "Heute im Zielbereich 82 %" + "Lauf 2 an Tag 34: 74 %" | 2 (**1** on the task card) | 7 stacked blocks |

Three concepts answer Job A in language I can read while impaired: **C02, C04, C09**. Three concepts
get Job B to one tap: **C05, C08**, and C04/C07/C10 conditionally. Only **C04** is near the top of both
columns.

---

## Ranked

### 1. C04 "Zweigang" — 88

**Verdict:** the only concept that treats "dead simple" as a whole application with its own QA pass
instead of as a layer it promises to keep thin, and it is the only one that puts a *word* where every
other concept puts a percentage.

Why it wins for me, concretely:

- **The verdict is a word, not a number.** `Passt` / `Zu warm` / `Zu kalt` / `Zu trocken`. I do not have
  to know that 92 % is good and 71 % is bad. Every percentage-based verdict in this bake-off (C02, C03,
  C06, C07, C08, C10) assumes I can rank a fraction against an invisible threshold at 2am. I cannot.
- **Exactly one ring, exactly two action buttons, never three.** Written as a non-negotiable rule in the
  document, not as an aspiration. The `Jetzt` screen is the only home screen in the ten with a stated
  hard cap on primary actions.
- **One tap completes a due feed.** `[ Erledigt ]` on the `Fällig heute` card writes a nine-field record.
  Long-press opens the same sheet prefilled for the case where I deviated. Deviation is the normal case,
  not the error case — that sentence appears in the document and it is the correct posture.
- **Stale removes the verdict.** At 90 s the number stays and the word disappears, "because a verdict on
  a four-minute-old number is a lie". At 10 min the ring becomes an em dash and I get `[ Was tun? ]`.
  This is the single most stoner-protective behaviour in the whole set: it refuses to let me act on a
  stale judgement.
- **Absent hardware is invisible, not disabled.** No greyed CO₂ tile for a sensor I did not buy. And
  because humidity has no target when there is no dehumidifier socket, it renders as a plain uncoloured
  reading — which kills the alarm-fatigue trap C02 admits to (an amber tile every day for a month is a
  tile I stop reading, and then I stop reading amber everywhere).
- **Onboarding never asks "are you a beginner?"** Three screens, three taps, default Einfach, and the
  question that every user answers wrongly and defensively is never asked because the answer is
  reversible.

**What it costs me.** There is a door on my home screen — `Profi-Ansicht öffnen`. The document argues at
length that an accordion is a door and a door on the screen is a screen with a door on it, and then puts
a door on the screen. It is below the fold, it is one button, and the escape hatch back is an
`ion-segment` at the top of a *side menu* — which is exactly the kind of thing I will not find once I am
lost. That is the concept's real hazard for me and it is one design decision away from being fixed
(put the `Einfach` return control in the Pro *header*, permanently, not in a menu).

Second cost: `1,08 kPa · ✓ VPD passt` is on my home screen on day one. The verdict word saves it, but
the acronym and the unit are still there.

Third: §16.5 already concedes the "three screens" claim is "three screens plus five sheets" on day one,
and sheets accrete. Nothing in the document defends the line except a paragraph admitting nothing
defends the line.

---

### 2. C02 "The Verdict" — 84

**Verdict:** the best answer to "is it fine?" in the entire bake-off — one glyph, one sentence, one bar,
no number in the headline, by explicit rule — attached to a body that then hands me three percentages and
a kPa reading anyway.

What is genuinely excellent for me:

- **`verdict.ok.headline` = "Dein Klima passt."** and the rule that the headline never contains a number.
  That rule is worth more to me than every chart improvement in these ten documents combined.
- **Six ranked verdict states with `offline` and `unknown` *outranking* `ok`.** The app will not draw a
  green tick over dead data, and "Zu wenig Daten für ein Urteil" is a sentence I can act on. Most
  concepts bolt honesty onto a badge; this one makes it the top of the ranking table.
- **`idle` puts the stage picker inside the verdict card.** The recovery path from "nothing is configured"
  is one tap on a picture, in the place I am already looking.
- **Two-tap watering with last-used volume and an undo toast**, and `[ Ändern ]` for the 10 % case. No
  form, no confirm, no modal on the fast path.
- **Every verdict state has a distinct glyph (`✓ ~ ! ?`)**, so colour is never the only channel.

**Fatal flaws for me:**

- **The tiles undo the headline.** `97 % / ⚠ 71 % / 94 %` — three percentages, each with a 4 px bar,
  under a sentence that just told me everything I needed. I will read the tiles, see 71 %, and be
  anxious about a number the headline already told me not to worry about. The concept's own rule
  ("numbers are for the tiles, the stoner gets a sentence") assumes I stop reading. I will not stop
  reading; a bad number in my visual field is exactly what my working memory latches onto.
- **§15.3, admitted:** humidity can only go down; in a dry winter tent that tile is amber for weeks. An
  always-amber tile trains me to ignore amber, which is the precise failure this concept claims to solve.
  C04 solves it structurally by removing the target; C02 mitigates it with a heuristic it calls papering
  over a hardware gap.
- **The scorecard sheet is depth 2 and contains `Streuung (MAD) 0,4 K`.** Nobody stoned survives "MAD".
  It is behind a tap, so it costs me little — but it tells me who this document was really written for.
- **§15.7, admitted:** an offline device destroys the premise exactly when I most want an answer. A
  single-answer home screen handles "I don't know" worst, and it says so.
- The thresholds (90 % / 70 % / 60 min / 180 min) are invented and made editable, which is honest and
  also means the sentence that governs my whole experience rests on a guess. A wrong green tick at 2am is
  worse than no tick.

---

### 3. C05 "Thumb Journal" — 76

**Verdict:** unbeatable at the job of recording what I just did, and it spends that win on a home screen
that is a chat thread and navigation parked in the one place my thumb cannot reach.

The best capture design in the bake-off, and it is not close:

- **One tap logs a watering.** `💧` → posted with last volume, last plant set, now. Not "one tap to open
  a sheet" — one tap to a durable record. The write happens *before* the classification. There is no
  form, no validation gate, no save button on the fast path. Every other concept's "2 taps" is really
  "1 tap to open a prefilled thing + 1 tap to confirm it"; this is the only one that removes the confirm.
- **The thumb zone belongs to capture, not navigation.** Stated as rule #1. It is the only concept in ten
  that reasons about where my thumb physically is.
- **Fixed slot order, explicitly never auto-rearranged**, because a moving target destroys the muscle
  memory that lets me hit 💧 without looking. That is a genuinely expert observation about impaired use.
- **Duplicate protection** — same kind, same payload, within 10 minutes collapses to `×2` with a
  `Doch nur einmal` chip. The only concept that anticipates that I will double-tap.
- **"Terp schreibt ab morgen jeden Tag selbst rein"** as the entire empty state and the entire tutorial.

**Fatal flaws for me:**

- **§15.8, admitted:** four navigation tabs live in a header segment on a 6.7" phone. Every time I want
  `Jetzt` or `Kurve` I have to shift my grip or use two hands — with a watering can in one of them.
- **§15.4, admitted:** "accidental writes are guaranteed." Five buttons at the bottom edge of a phone in
  a dark tent. Undo is 6 seconds. Nothing handles a pocket tap I notice three days later — and I *will*
  notice it three days later, because that is what I am like.
- **§15.3, admitted, and worse than the document admits:** log 5 L once when you meant 0,5 L and 5 L is
  the silent default forever, self-reinforcing through the Mengenring. The mitigation is a "subtle
  marker" on a >3× deviation. A subtle marker is invisible to me by definition.
- **The Mengenring is a radial long-press menu.** A hidden gesture, opening a novel widget, requiring
  release-over-target motor control I do not have right now. Tap-to-select is the fallback, so it costs
  me a tap, not a failure — but the concept's headline interaction is one I will never discover.
- **The thread is the home.** Finding "what did I do in week 3" is a scroll through prose bubbles. And
  the daily machine card becomes wallpaper by week two (§15.12) — which means the thing writing my diary
  for me is also the thing training me to scroll past it.

---

### 4. C09 "Das Zelt" — 66

**Verdict:** the best *language* in the bake-off attached to the most crowded screen in the bake-off, and
it asks me to learn a visual convention whose failure mode is believing the app controls a machine it
cannot see.

What I want to steal:

- **`Alles gut` / `Ich behalte es im Auge` / `Da stimmt was nicht`.** Three states, plain German, one
  line, no number, no percentage, no acronym. This is the best verdict copy anyone wrote.
- **"Tap the thing to reach the thing."** No menu path, no settings tree, no vocabulary. The lamp is at
  the top of the screen because the lamp is at the top of the tent. Support can say "tap the lamp" to
  anybody. That removes an entire category of navigation failure for me.
- **The open door for maintenance mode.** An open door means the room is not sealed, do not trust the
  numbers. A tile grid cannot say that. It is the one place the metaphor does real work.
- **The prop rule:** unverifiable objects are drawn flat and never take a state colour.
- **Furnishing pre-places everything the hardware already reported, badged `gefunden`** — 3 taps in the
  common case, and the one question hardware cannot answer (lamp or exhaust on the PWM) is asked once and
  answered honestly.

**Fatal flaws for me:**

- **~18 tap targets on the home screen**: lamp, camera backdrop, 2–3 sensor chips, up to 5 pots plus a
  `+`, 4 kit objects on the wall rail, verdict line, time slider, 3 plinth actions, 3 nav links. The
  ≤5-choices rule is not bent, it is broken.
- **Text over an arbitrary photograph, in a dim tent, on a phone at low brightness.** The document
  specifies a scrim. A scrim over a photo of a dark tent under a purple lamp is a contrast gamble every
  single time it renders, and it renders continuously.
- **§15.4, admitted and correctly graded as the worst risk:** a wrong picture is more persuasive than a
  wrong list. A user who furnishes a humidifier that Terp Control cannot see gets a *convincing* wrong
  model, and the only thing between them and a dead crop is whether they read a colour convention. I do
  not read colour conventions. I read pictures literally.
- **§15.6, admitted:** landscape phone does not work; the home screen has an orientation in which it does
  not exist.
- `VPD 1.42 kPa` is a chip in the middle of my tent picture.
- The time slider is the demo and, by the author's own §15.7, analytically weak — it is a gesture I will
  fiddle with and get nothing from.

---

### 5. C08 "Shared Grow" — 62

**Verdict:** one-tap logging and persistent buttons instead of a FAB, wrapped around a home screen whose
top third is a paragraph about a person, which for a solo impaired user is a paragraph about nobody.

Worth stealing:

- **One tap: `[ Gegossen ✓ ]` writes a full event** with the regime's current step verbatim, and the
  6-second `Gespeichert · Ändern` toast is the entire error model.
- **"No FAB"**, argued explicitly: *a FAB hides the most important interaction behind an icon a stoned
  user will not decode.* Two persistent 48 px labelled buttons instead. That is the correct call and only
  this concept makes it.
- **The freshness table's output row**: offline outputs read `Zustand unbekannt`, not "off". Every other
  concept fixes the numbers; this one remembers that a drawn heater state is also a claim.
- **The excursion explanation** — "that spike was a door, not a fault" — is the only place in ten
  documents where the app tells me a bad number is *not my problem*. That is enormously valuable to a
  low-frustration-tolerance user and nobody else built it.

**Fatal flaws for me:**

- **The handover card is prose.** `Kim war gestern 19:04–19:21 im Zelt · Gegossen · 4 L · alle Pflanzen ·
  Blüte-Dünger Woche 3 · −20 % · "Mittlere Pflanze hängt etwas."` That is a paragraph, at the top, above
  the numbers, before the verdict. Solo, it degrades to `Du warst gestern … im Zelt` — an essay about
  myself that I already know.
- **`[ Ich war im Zelt ]` is a second primary verb with no meaning to me.** Two big buttons and one of
  them logs *nothing I did*. I will tap it by mistake and I will not understand what happened.
- **§15.2, admitted:** somebody with a tent in their bedroom walks past it eight times a day; inferred
  visits fragment into noise, and the attribution then becomes actively misleading. The 30-minute
  auto-close is a guess.
- **§15.11, admitted:** the fourth tab differs per account, so the app looks different on different
  phones and community advice ("tap the Futter tab") is unfollowable by half its readers.
- The verdict is `92 % im Zielbereich (3 Tage)` — a percentage over a window I did not choose.

---

### 6. C03 "Beet" — 58

**Verdict:** puts a plant between me and my thermometer, then puts a decision I cannot make on the home
screen, and its own §15.1 knows it.

Worth stealing:

- **The implicit plant costs zero taps** and onboarding is genuinely one tap on a picture grid.
- **Capture buttons stay enabled while the device is offline** — deliberately, with the reasoning spelled
  out: watering happens in the tent, where the signal is worst. Correct and rare.
- **2 taps for three plants** with values at the top and plants at the bottom and "identical is the
  default". That is the right shape for multi-plant capture.
- Naming the band source on every verdict, so I am never graded against a target I never chose.

**Fatal flaws for me:**

- **The conflict banner is on the home screen**: *"Deine Pflanzen wollen unterschiedliches Klima. Das Zelt
  folgt Gorilla Glue #4. [Wechseln] [Warum?]"* — a two-option irreversible-feeling decision about plant
  physiology, permanently parked where I look for reassurance. At 2am that banner is pure anxiety with no
  action I am capable of taking.
- **`Leitpflanze` is a concept I must hold in my head** across the plant cards, the settings and the
  chart. That is a memory requirement, which is my hard fail.
- **Duplicated capture affordances** — a capture bar at the top *and* four buttons per card. Two ways to
  do the same thing is one decision I did not need.
- The verdict is a percentage with a comparative clause attached: `✓ 94 % im Zielbereich (24 h) gegenüber
  deinen Zielwerten`. That is three ideas in one line.
- Tent strip shows `1.24 kPa`.

---

### 7. C06 "Glance Tiles" — 52

**Verdict:** nine tiles, forty-five elements, no sentence anywhere — it optimises for glanceability and
then puts more on one screen than any other concept in the bake-off.

Worth stealing (and it is real):

- **Grey is reserved.** Grey means "I do not know" and is used for nothing else on the board. One rule,
  learned once, readable at arm's length without reading a word. That is the single best honesty
  mechanism in the ten documents.
- **The goal bar grammar** — centre = setpoint, ends = my own alarm limits, dot = now. One picture that
  works on temperature, humidity, VPD, CO₂, EC and pH. I learn one thing and it never changes.
- **"A tile with no goal bar is a deliberate statement: nothing here can act on this number."** Capability
  becomes visible instead of silent.
- **"No tile has settings."** A tile's configuration is what it displays. The moment a tile grows a gear
  icon the concept has failed — a rule I wish four other concepts had written down.

**Fatal flaws for me:**

- **Nine tiles is nine choices.** The ≤5 rule is broken by roughly a factor of two, and each tile carries
  five sub-elements. There is no single place my eye can land and be finished.
- **`✓ 3/3` is not language.** It is a fraction with an invisible denominator meaning. Every other
  top-ranked concept gives me a sentence; this gives me arithmetic.
- **§15.10, admitted:** the Feed tile nags forever and the only way to stop it is a long-press followed by
  an `✕` badge — "the design's answer to unwanted nagging is a gesture, and gestures are discoverable only
  by the people who least need them." That is precisely right and precisely disqualifying.
- **§15.3, admitted:** auto-provisioning means tiles appear on their own from flaky evidence. A phantom
  tile is worse than a checkbox list. A screen that changes shape without me touching it is a screen I
  stop trusting.
- **§15.1 and §15.2, admitted:** the sparkline is decoration by the author's own standard and it is on
  every tile; a tile is a bad container for time and time is the product.

---

### 8. C10 "Durchgang" — 50

**Verdict:** builds the whole product around a comparison I will not live long enough as a user to see,
and puts a number from four months ago on the screen I open to find out if my tent is on fire.

Worth stealing:

- **Humidity drawn as a ceiling (`max. 55`), not a centred band.** The hardware can only push humidity
  down; drawing a symmetric band around a number the machine can only approach from one side is a lie
  about the machine. This is the sharpest single observation in the ten documents and only C10 makes it.
- **`Kein Gerät dafür angeschlossen`** as a tile subtitle, and the measure then excluded from the verdict.
- **`Weiß ich nicht` as a first-class onboarding answer** that pushes no targets to the device. The app
  does not pretend to know.
- **"Wie letztes Mal" — one tap to start the next run** copying stages, feed program and plant labels.

**Fatal flaws for me:**

- **`Lauf 2 an Tag 34: 74 %` is on my home screen.** I do not care. I have never cared. At 2am it is a
  second percentage competing with the first percentage for the small amount of attention I have.
- **§15.1, admitted and correctly self-graded as the most serious objection:** the core value arrives at
  run 2, three to five months in. My day-one home screen contains an *IOU* — "Erster Durchgang. Ab Lauf 2
  steht hier, wie es beim letzten Mal lief." A promissory note is not a feature.
- **Seven stacked blocks** on `Jetzt`, of which two are verdicts and two are lists.
- **§15.5, admitted:** one run, one day-0, so a tent with staggered plants — the owner's own scenario —
  gets a comparison axis matching none of its plants.
- Verdict is a percentage, again.

---

### 9. C07 "Der Plan" — 46

**Verdict:** it takes the one thing I might plausibly want to do — turn the temperature down — and turns
it into a three-option scope decision, then reserves the right to open a dialog telling me the app and
the box disagree.

Worth stealing:

- **`Nur beobachten` as a permanent, legitimate, first-class answer** that turns the entire plan
  machinery off for that device. Three taps and the app stops having opinions. That is respectful.
- **`Später` snoozes to the next lights-on/lights-off boundary**, because "tomorrow" is meaningless in a
  12/12 tent. Small, correct, and nobody else thought of it.
- **One task on the home screen, at most, ever** — "the stoner lens forbids a task inbox on the home
  screen", written down as a rule.
- **`Planschritt wartet auf den Controller`** — honestly surfacing that the recipe executor only pushes to
  a device seen in the last 60 s.

**Fatal flaws for me:**

- **The override sheet is a radio group with three options about *scope*:** just now / this stage / the
  whole plan from here. That is a modelling question dressed as a UI, and it fires on the most ordinary
  action in the product. §15.1 admits it: "a grower who fiddles daily will find this concept nagging."
- **The drift dialog.** `Der Controller läuft anders als der Plan.` with `[Plan anpassen]` and
  `[Plan wiederherstellen]`. I am being asked, in a dark room, to reconcile two sources of truth about my
  own tent. I will pick wrong. §15.8 admits the concept creates this conversation and that a
  config-is-truth design never has it.
- **Gates that wait for me** (`Warte auf dich: 12/12 umstellen?`) with grace periods that expire and act
  on their own. The app is now doing something *later* based on something I did or did not tap. That is a
  state I have to carry in my head.
- **Vocabulary load:** Plan, Phase, Tor/gate, Grace, Vorlage, Planschritt, Übersteuerung. Seven nouns
  before I have watered anything.
- Four tabs, one of which (`Plan`) says nothing to a monitoring user — admitted in §15.4.

---

### 10. C01 "Loupe" — 42

**Verdict:** an information-design triumph aimed squarely at somebody who is not me, on the one input
device where its entire navigation idea does not work.

Worth stealing — and there is a lot, which is why this is a tragedy rather than a failure:

- **"The timeline draws the gap."** No sample means no pixel; the hole between the last sample and now is
  hatched and labelled `Keine Daten`. *"A grower does not read a badge; they see a hole."* That is the
  best sentence in all ten documents about honesty.
- **Absent capability means the lane is not rendered at all**, and absent `hardwareInfo.sockets` fails
  *closed* to monitoring.
- **`nur Beobachtung`** — a grey band on a measure I can see but cannot change, with the nagging
  suppressed. The kindest treatment of the monitor-only case anywhere.
- **Two taps to a durable watering, then a refinement strip that does not block**, with a 6-second
  `Rückgängig` and no confirmation dialog anywhere in capture. The stated goal — "no confirmation dialogs,
  every destructive action is an immediate action plus an undo" — is exactly right.
- **The moving VPD band that changes along the x-axis by stage**, and the leaf-offset printed on the lane.

**Fatal flaws for me:**

- **There is no verdict.** The scrub header is `24,5 °C / 58 % / 1,21 kPa / 612 ppm` over
  `Ziel 25,0 / 60 / 0,8–1,2 / 800`. Eight numbers and four comparisons that I have to perform. That is
  the single worst Job-A answer in the bake-off. §12 claims "colour and shape carry the verdict"; colour
  and shape on a wedge fill is not a sentence.
- **Zoom is the only navigation verb**, and it is a concept. Five zoom regimes that change what things
  *mean*, not just how much of them I see. I must hold "which magnification am I in" in my head across
  every interaction. That is a memory requirement as the load-bearing idea.
- **Eight distinct gestures**: vertical scroll, horizontal pan, two-finger pinch, tap-to-crosshair,
  long-press-and-drag fine scrub, tap zoom bar, long-press zoom bar, double-tap to solo, edge swipe. With
  poor fine motor control every one of those is a coin flip, and several are destructive of my position.
- **The capture sheet is a 3×3 grid of nine icons.** Nine choices, at the moment I am least able to
  choose.
- **§15.1, admitted:** horizontal time is a sideways scroll at 14 px per day to find what I did in week 3,
  and the fallback the author refuses to build (a vertical list) is the thing every diary app in the
  market ships because reading a journal is a vertical act.
- **§15.8, admitted:** the concept is weakest for the laziest user — the type the owner listed first.
- `VPD kPa`, `EC`, `Präzision`, `Zielband` on or one gesture from the default surface.

---

## What NOT ONE of the ten got right

This is the part worth reading twice. These are not gaps in one concept; every one of these is missing
from all ten documents.

**1. A verdict without a remedy is an anxiety machine, and ten out of ten shipped one.**
Every concept tells me something is wrong — `Zu warm`, `Da braucht dich was`, `Da stimmt was nicht`,
`⚠ 61 %`. **Not one tells me what to physically do about it.** The only "what now?" flows anywhere in
2,000 pages of design are offline-troubleshooting checklists (C02, C04, C09). There is no
*"Zu warm → Lampe auf 70 % dimmen [ Machen ]"*, no "open the tent for ten minutes", no one-button remedy
attached to the one problem the app just told me I have. For an impaired user with low frustration
tolerance this is the difference between a product and a source of dread. The hardware has a PWM lamp
output and five sockets — the remedy button is *buildable*, and nobody built it.

**2. Nobody designed for one hand, and the one concept that noticed put navigation in the worst place.**
C05 alone reasons about the thumb zone, and then parks four navigation tabs in a header segment. Every
other concept puts the verdict at the top of the screen, the actions in the middle or in a FAB, and the
navigation wherever it landed. Nobody drew a reachability map. Nobody committed to "everything you need
is in the bottom 40 % of the screen." I am holding a watering can.

**3. Nobody protects me from logging to the wrong tent.**
With two devices, every single concept puts the device switcher in a header dropdown and then lets me log
a watering with one or two taps. **Nothing in any of the ten detects, warns about, or recovers from
"you just watered Zelt 2 while standing in front of Zelt 1."** The 6-second undo is useless because I
will not notice for three days, and by then the entry is indistinguishable from a real one. A
"you're logging to **Zelt 1** — tap to change" line above the confirm button costs one row and nobody
wrote it.

**4. Nobody made "I don't know how much" a first-class, complete answer.**
Every capture flow eventually wants litres. C05 defaults it and then admits (§15.3) the default ossifies
a mistake forever, silently. The honest design — *"Gegossen" with no amount is a complete, valid record;
amounts get filled in later, on the couch, or never* — is refused by all ten because all ten are quietly
optimising for data quality. C05's `/tidy` table is the closest, and it is a desktop screen in v1.1 that
the stoner it exists for will never open. **When capture speed and data quality conflict, ten out of ten
documents chose data quality and wrote a paragraph explaining why that was really capture speed.**

**5. VPD is on the default home screen of eight of ten concepts.**
`1,21 kPa`. `1.42 kPa`. `VPD 1,12`. The brief's jargon list names VPD *first*, and eight concepts put it
on the first screen a beginner ever sees, usually with a unit no consumer has encountered outside this
product. Only C05 and C08 keep it out of the primary verdict — and both still print it in the strip.
Nobody proposed the obvious: **VPD is invisible until the user asks for it once.** It is a derived value.
It is never a target. The firmware does not regulate to it. It is on my home screen because designers
find it interesting.

**6. Nobody handles impaired time perception.**
`Tag 34`. `Schritt 7 von 13`. `vor 3 Tagen`. `Woche 5`. Time perception is the first thing to go when I
am impaired, and every concept anchors everything to counters I cannot verify. Nobody anchors to events I
actually remember — *"seit dem Lichtwechsel"*, *"seit du das letzte Mal gegossen hast"*, *"seit du sie
getoppt hast"*. C07's `Später` snoozing to the next lights change is the only instance in ten documents
of anchoring to a physical event instead of a clock, and it is one control.

**7. Nobody warns me that I already did this today.**
C05 collapses exact duplicates inside a 10-minute window. That is it. The app knows I watered six hours
ago. When I tap `Gießen` again this evening, **not one of the ten shows me "du hast heute um 09:12 schon
gegossen"** before writing the second record. Over-watering is one of the two most common ways a home
grow dies, the app has the data to prevent it, and ten designers put a prefilled volume there instead.

**8. Nobody gave me a one-tap way to say "your verdict is wrong, stop grading me."**
C02, C03, C06, C07, C08, C10 all grade me against bands several of them openly admit they invented. The
mitigation everywhere is "the source is labelled" and "the thresholds are editable in settings". Editing
a threshold is a numeric decision in a settings tree — the exact thing I cannot do. A single
`Passt schon so ›` / `That's fine, stop telling me` on the verdict card, which widens the band to what I
am actually running, does not exist anywhere.

**9. Nobody designed for the physical room: dark, wet, dirty.**
Ten documents, extensive dark-mode token work, and **zero mentions of screen brightness in a dim tent, of
a wet finger on a capacitive screen, of gloves, or of a night/red-light-safe rendering.** C09 comes
closest by making objects big, then renders text over a photograph. The design system has `--tc-halo`,
`--tc-gradient-panel` and a full step-50…950 scale, and nobody asked whether any of it is legible at 20 %
brightness at 02:00 next to a 600 W lamp.

---

## The dealbreaker test

> **Hand the phone to someone who is actually stoned, in a dim room, with one hand holding a watering
> can. Ask them two things, in this order, and time it:**
>
> 1. *"Tell me in one sentence whether the tent is OK."*
> 2. *"Record that you just watered it."*
>
> **A winning concept completes both in under 15 seconds and no more than 3 taps total, one-handed,
> with: no typing, no scrolling before either answer, no acronym or unit-of-art visible on the screen
> they answered from, never more than five choices in view at once — and if they tap the wrong thing,
> the control that undoes it must already be visible without hunting for it.**

Every concept in this bake-off can be scored against that in one afternoon with `./simulate-device.sh`
and a friend. Do that before choosing, because eight of these ten documents assume the answer instead of
measuring it.
