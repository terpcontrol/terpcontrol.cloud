# Critique — User Type 2: monitoring only, **with a camera**

**Who I am.** I bought the €319–349 bundle. I do not control anything — no heater, no dehumidifier,
no CO₂, nothing. I paired a camera because **the picture is the point**. The numbers exist to explain
the picture. I want to scrub a chart and watch my plant change. I want a timelapse I can actually
send to the Telegram group. The owner's words for me are: *"the same values, but correlated with his
camera. It should be creating timelapses and other things."*

**How I judge.** Four questions, in order:

1. Is the camera **first-class**, or a tile / lane / checkbox?
2. Can I put an image and the conditions at that instant on screen in **one gesture**?
3. Are timelapses **discoverable, good-looking and shareable** — and are they in **v1**, not v1.1?
4. Does the concept spend its October budget on things I will never touch (plans, clubs, feeding
   schedules, plant entities, authorisation rewrites)?

I am not a committee. A concept that is a masterpiece for a grow club and gives me a 44 px strip of
thumbnails scores badly here, and I will say so.

---

## The ranking

| # | Concept | Score | One-line verdict |
| --- | --- | --- | --- |
| 1 | **C09 The Tent** | **84** | The only concept where my camera *is* the product and not a feature of it. |
| 2 | C01 Loupe | 71 | The best correlation engineering in the set, with my picture parked at the bottom of it. |
| 3 | C05 Thumb Journal | 68 | Accidentally excellent for me, and the only one that designed how a timelapse leaves the app. |
| 4 | C04 Zweigang | 65 | Names my need out loud, then hands me a 44 px strip and a v1.1 IOU. |
| 5 | C06 Glance Tiles | 61 | An honest camera tile with the best staleness rules — and "tile" is the whole problem. |
| 6 | C03 Beet | 53 | Puts a plant object between me and my picture, then stitches my "timelapse" out of weekly clips. |
| 7 | C10 Durchgang | 49 | The single best camera idea in the bake-off, delivered five months after I buy the camera. |
| 8 | C08 Shared Grow | 45 | My camera tab can be displaced by a fertiliser schedule, and club mode switches the camera off. |
| 9 | C07 Der Plan | 40 | Good camera ideas hung on the one deliverable the author says will be cut. |
| 10 | C02 The Verdict | 33 | A concept whose thesis is "you shouldn't need to look", sold to someone who bought a camera to look. |

---

## 1 — C09 "The Tent" · **84**

**Verdict:** the only concept in which the camera is load-bearing rather than accommodated, and the
only one where correlating an image with its numbers costs **zero** gestures because they are already
the same object.

This is the one. `TentScene.backdrop = 'camera'` means the tent interior on my home screen **is the
30-second-old photograph of my actual tent**, and `24,1 °C` and `61 %` are drawn on top of the leaf
they describe. §7.1 states the point exactly: *"There is no tile to open and no correlation to
construct. The chip that says 54 % sits on top of the leaf it is describing."* Every other concept
makes me construct the correlation; this one deletes the construction step.

Then the time slider. Dragging it sets `?t=` and **everything** re-renders at that instant — backdrop
from the sprite tile nearest `t`, sensor chips to the values at `t`, kit state at `t`, the chip label
flipping from `vor 4 Sek.` to `Do, 14.03. 21:40`. §7.2 names it correctly: *"the slider **is** the
timelapse; he never learns there is a timelapse feature."* That is the correct instinct. A timelapse
is not a file I go and find, it is a thing my thumb does.

Things it gets right that nobody else got right at all:

- **The stale-photo rule.** No still newer than 10 minutes → the backdrop *fades back to the
  illustration* with a chip reading `Letztes Bild vor 2 Std.` The scene never shows an old photo as
  if it were now. Every camera UI I have ever used lies about this.
- **The sprite endpoint (`GET /image/strip`) is in v1**, not deferred, because the slider needs it —
  so scrubbing costs zero network requests. C03, C07 and C08 all defer the sprite and are all
  visibly slower for me as a result.
- **Share safety is checked in the scene component, not a parent**, so `ShareLink.webcam: false` can
  never leak a frame through a rendering path nobody thought about.
- **`Verlauf` opens at the same `t` with the crosshair already placed.** One cursor, two views, one
  URL param. That is the correlation contract written down as an invariant.
- §13's de-scope order says in writing: *"**The camera backdrop (12) must not slip** — it is the
  concept's single most demonstrable idea."* Nobody else protects my feature in their cut list.

### Fatal flaws

- **The shareable artefact is v1.1.** §7.4 is blunt: v1 keeps `1d|1w|1m` and *"adds nothing to the
  enum"*; `duration: 'stage' | 'grow'` lands in v1.1. So in October I can scrub beautifully and I
  still cannot hand anyone a video of my grow. Half of what the owner asked for me — *"it should be
  creating timelapses"* — is not in the box.
- **The slider is capped at 7 days on mobile / 30 on desktop** (§7.2). My grow is 12 weeks. The
  headline interaction cannot span the headline object. `Weiter zurück im Verlauf` is a link to a
  different screen, which is exactly the navigation this concept exists to remove.
- **Landscape phone does not work** (§15.6): below 480 px of height it falls back to the Contents
  list. Rotating the phone is what people do when they want to *look at a picture*. The concept's
  best moment is unavailable in the posture I will adopt to enjoy it.
- **Half my footage is black and the concept shrugs.** §7.1: *"A black backdrop is correct at night
  and reads as such."* Correct, and it means for 12 hours a day my home screen is a black rectangle
  with a scrim on it. No last-lit-frame fallback, no night policy.
- **The art is a hard dependency with no graceful degradation** (§15.1) — five templates, two skins,
  light and dark. I am insulated (I have a photo backdrop) but the concept shipping as "boxes" is a
  real risk to the surface my chips sit on.
- **Scrub performance** (§15.8): inline SVG + live `<foreignObject>` + photographic backdrop +
  full-scene re-render on a mid-range Android. If scrubbing stutters, my best feature is my worst.

### Best parts to steal

- The camera still **as the substrate of the home screen**, not as an element on it.
- `?t=` as a single shared cursor across scene, chart and film strip.
- The stale-photo rule: **fade to illustration, never show an old frame as current**, and put the age
  on the camera separately from the age on the sensors.
- The sprite + JSON index endpoint shipped in v1 because the *scrubber* needs it, not because the
  chart wants it.
- "Must not slip" as an explicit line item in the de-scope order.

---

## 2 — C01 "Loupe" · **71**

**Verdict:** the strongest correlation *engineering* in the bake-off — one shared `TimeScale`, one
cursor, honest gaps — attached to an information architecture that puts my picture at the bottom of a
scrolling stack of charts.

The `TimeScale` primitive (§4.1) is the right answer to the hard problem: one instance injected into
the ECharts instance, the day/night lane, the outputs lane, the film strip and the event rail, with
`grid.left`/`grid.right` as **fixed pixels** so canvas and DOM stay aligned. That is the detail
everyone else hand-waves. §4.7's film strip is genuinely an axis — thumbnails positioned by
timestamp so *uneven capture reads honestly as gaps*, mp4s rendered as **brackets** rather than
points, and diary photos above the centre line with the plant's colour while webcam stills sit below.

And one idea nobody else had: **Cycle zoom picks the still nearest local solar noon *while the light
is on***, so a 90-day scroll is a growth sequence rather than a strobe of light and dark frames
(§7). That single rule is the difference between a watchable clip and a seizure, and it is the only
piece of *timelapse content design* in ten documents.

### Fatal flaws

- **v1.0 ships at most twelve thumbnails per window** through the existing per-image endpoint (§4.7).
  Twelve. That is a contact sheet, not a film strip. The sprite is v1.1. So the concept's own
  headline camera interaction ships in a degraded form for the launch I am buying into.
- **Per-stage timelapses are v1.1**; v1 shows the existing three durations as brackets. Again no
  shareable artefact.
- **My picture is the sixth thing down the page.** Mobile layout (§3.1): scrub header → day/night
  lane → temperature lane → humidity lane → VPD lane → outputs lane → **then** the 76 px camera
  strip. I have to scroll past four charts to reach the reason I bought the hardware. For a user
  whose entire purchase was "I want to see it", that ordering is backwards.
- **Horizontal time on a phone** (§15.1, the author's own biggest bet). Looking at pictures is a
  vertical, flicky act; this makes it a sideways scrub through a 14 px-per-day strip.
- The author's assessment of me is *"this is the type the concept serves best per unit of effort ...
  because the film-strip-as-an-axis is pure fusion and costs him zero taps."* Note the framing: I am
  served **cheaply**, not deliberately. The camera section is twenty lines in a 1,378-line document.
- §15.8 concedes the concept is weakest for the monitoring user and strongest for clubs, which are
  v1.1. The peak value and my needs are not aligned and the author says so.

### Best parts to steal

- The shared `TimeScale` with fixed pixel insets — the correct implementation of one cursor.
- **Solar-noon-while-lit frame selection** for any per-day view. Steal this into whichever concept wins.
- Uneven capture intervals rendering as **gaps**, and mp4 spans rendering as **brackets**.
- Diary photos and webcam stills sharing one lane with a visual distinction (border colour, above/below the line).
- `Image` finally getting a back-reference so deleting an event deletes its images.

---

## 3 — C05 "Thumb Journal" · **68**

**Verdict:** a concept built for someone who logs constantly, which by accident serves the person who
logs nothing better than four concepts that tried — and the only one that designed how a video
actually leaves the product.

I capture nothing. The premise should make this useless to me. It isn't, because the machine writes
the journal and the photos flow in on their own:

- **The day divider carries a 32 px strip of five stills sampled across that day** (§7.2). Scrolling
  the thread *is* a coarse timelapse. Free, zero taps, and no other concept produces daily imagery
  without me navigating to it.
- **The excursion card carries the still captured nearest the peak** — *"2 h 20 zu warm · max 30,8 °C
  um 15:40"* with the picture from 15:40 inline. §7.2 calls it the concept's favourite detail and it
  is right: that is a diary entry no human would write and no competitor produces.
- **The week card gathers the week's best six photos** and offers `Wochen-Timelapse` and
  `Grow-Timelapse (seit Tag 1)`.
- §11 identifies my exact unmet need — *"correlate a **specific** frame with a **specific** value
  without opening the chart"* — and answers it in v1: the film-strip scrubber shows the four Now-strip
  values under the frame as you drag. That is my one-gesture test, met, on the home surface.
- **§7.3 is the only place in ten documents where sharing a timelapse is designed**: `⋯ → Teilen` →
  `Link kopieren · An Telegram · An Discord · Datei speichern`, with the correct refusals (never
  Instagram/TikTok/Reddit, no branded footer). Telegram is where this community actually lives.

### Fatal flaws

- **Phase and Grow timelapses are v1.1** (§13). The concept designs the share menu for an artefact
  that does not exist at launch. In October I get the existing rolling windows.
- **The chat metaphor fights looking.** §15.1 concedes it: types 1, 3, 4 and 5 open the app to know a
  number, and here the numbers are a 72 px strip and everything else is prose bubbles. I open the app
  to *look*, and a vertical thread of text bubbles is a strange place to keep a photo album.
- **Navigation moved to the top** (§15.8) so the thumb zone can hold five capture buttons I will never
  press. My entire product is `📷` and I do not need it — the tent camera shoots itself. The Thumb
  Bar is 56 px of permanent chrome dedicated to a job I do not have.
- No camera surface on the home screen above the fold. The Now strip is four numbers; the pictures
  start when I scroll into today's divider.
- §15.9: one-tap logging plus machine cards produces 800–1,500 rows per grow. I produce none of them
  and pay the pagination cost anyway.

### Best parts to steal

- **The share menu for a timelapse**: link · Telegram · Discord · save file. This is the correct answer
  and nobody else wrote it down.
- **N stills per day on the day divider** — a free daily timelapse that requires no navigation.
- **The excursion still**: the picture from the minute it went wrong, inline with the sentence.
- The film-strip scrubber showing the live values under the frame you are dragging.

---

## 4 — C04 "Zweigang" · **65**

**Verdict:** the only document that says out loud what I bought the camera for, and then budgets me a
44 px strip and a v1.1 promise.

§7 is unusually clear-eyed: `duration: 'stage'` producing *"Deine Blüte in 90 Sekunden / Your bloom
in 90 seconds"*, and the sentence **"This is the single feature type 2 buys the camera for and today
it does not exist."** Correct. Diagnosis: perfect.

The prescription has two genuinely good v1 pieces:

- **The `Heute | vor 7 Tagen` card on the Simple home screen**, two frames side by side with one
  `Teilen` button. Two images, one axis, one share button — §7 calls it *"the whole monitor-plus-camera
  product for a user who does not control anything"* and for a first release that is nearly true.
  It is shippable, it is on the home screen, and it is in the Simple gear which is where I live.
- **The latest still on `Jetzt` carries its own age line**, because *"a stale camera is exactly as
  misleading as a stale sensor."* Only C06 and C09 also get this right.
- Long-press a film-strip frame → `Zu Eintrag hinzufügen`, adopting a webcam frame into an entry.

### Fatal flaws

- **`duration: 'stage'` is v1.1** (§14). The feature the document itself identifies as my whole reason
  for buying is not in the release that ships with the hardware.
- **The sprite storyboard is Pro-gear only** (§7). I live in Einfach. So my film strip is N image
  requests at 44 px and the good delivery mechanism is behind a shell I have no reason to enter.
- **44 px.** That is the height allocated to the reason I spent an extra €30–60. In the Simple gear
  the camera is: one 16:9 card, one two-frame comparison card, and a 44 px strip on a third screen.
- **The two-shell architecture buys me nothing** and costs the release something. I will never open
  Profi; the 120 extra i18n keys × 2 languages and the 36-cell test matrix (§13) are paid partly out
  of the budget that could have rendered my video.
- §16.4 admits the Simple gear can lie by omission (mean line, conditional envelope). If it will
  smooth away a heater short-cycling it will smooth away things I am trying to *see*.

### Best parts to steal

- **`Heute | vor 7 Tagen` with one share button** — the cheapest genuinely-shareable camera artefact
  anyone proposed, and it ships.
- A separate age line **on the camera**, distinct from sensor freshness.
- The naming: *"Deine Blüte in 90 Sekunden."* That is how the feature should be presented — a
  duration and a subject, not a `duration` enum value.
- Long-press a frame to adopt it into an entry.

---

## 5 — C06 "Glance Tiles" · **61**

**Verdict:** the most rigorous camera-honesty rules in the set, wrapped around a container the concept
itself admits is wrong for time.

What it gets right:

- **The camera tile is subject to the same freshness law as every other tile** (§7): a still from four
  hours ago renders at 55 % opacity with `vor 4 Std` in the chip and `Zuletzt aufgenommen`. §7 names
  the failure it prevents: *"This is the single most common way a camera UI lies."* Best statement of
  the problem in ten documents.
- **The tile appears on its own** when `hardwareInfo.webcam_did` arrives — `Neue Kachel: Kamera` —
  with no configuration.
- **I can long-press and drag it to the top of the board.** §11's type 2 walkthrough: *"he drags it to
  the top, because for him it **is** the product."* That is a real answer to "the camera is my
  product": let the person for whom it is the product put it first.
- It is a **2x2 tile with its own detail route** (`/t/camera`: latest still, film strip, timelapses)
  and the film-strip **sprite endpoint is in v1 scope** (item 13).

### Fatal flaws

- **"A tile is a bad container for time, and growing is a process."** That is §15.1, the author's own
  first weakness, and it is precisely my objection. My product is a *process*: the plant changing.
  The board answers "now" and puts every temporal thing behind a tap.
- **The drag-to-top affordance is the most likely thing to be cut** (§15.4: 2D grid drag on Angular 15
  / Ionic 6, needs `@angular/cdk` which the repo does not have, *"janky before it is good"*). If it
  goes, the concept's entire answer to me — "reorder your board" — degrades to "we picked a good
  default order", and the default order puts Kamera below Klima, Licht and the Feed tile.
- **Stage-bounded timelapse renders are v1.1** with the reason given as *"new render-job parameter
  with unknown cost."* No shareable artefact.
- **Nothing about the camera is shareable at all.** Not a link, not a file, not a post. Zero.
- The 60×22 px unlabelled sparkline on every tile (§15.2, *"decoration by §7.2's own standard"*) is
  the visual budget that could have been my picture.

### Best parts to steal

- **Freshness law applied to the camera**, with the still greyed and aged exactly like a sensor value.
- **Auto-provisioning with a toast** — the camera appears because the hardware said so, not because I configured it.
- Letting the user promote the camera to the top position, permanently and per-device.
- `GET /data/board/:device_id` returning `image: { image_id, t }` alongside measures, so the still and
  the numbers arrive in **one request with one clock**.

---

## 6 — C03 "Beet" · **53**

**Verdict:** two lovely camera ideas buried under a plant object I never asked for, and a "phase
timelapse" that is a playlist of weekly clips wearing a timelapse's clothes.

The good: **stage covers are free** — on every stage transition the server picks the webcam still
nearest the transition timestamp and writes it to `plants.coverImageId` with zero taps (§7). §11 calls
that *"the moment the product's 'it does the diary keeping FOR YOU' claim becomes literally true"* and
it is right. And the **"Kamera-Bild von diesem Moment"** row — open any event, get the nearest webcam
still within ±15 min, one indexed query — is genuine fusion.

### Fatal flaws

- **The "Phasen-Timelapse" in v1 is a playlist of the existing weekly mp4s played in order** (§7).
  The label even says so: `Phasen-Timelapse (aus Wochenvideos zusammengesetzt)`. That is honest and it
  is not a timelapse; it is four videos in a queue with visible seams. Real per-stage rendering is v1.1.
- **The sprite is explicitly rejected for v1** — 48 lazy thumbnails per window, and §4.2 says *"I
  expect to regret not doing it sooner on 3G."* So do I.
- **A plant object is inserted between me and everything.** §15.1 concedes it: *"you put a plant
  between a man and his thermometer."* I have no plants I want to name; I have a tent I want to watch.
  The implicit-plant machinery costs me zero taps and still frames the whole app around a noun I
  declined.
- The camera's home is an **88×88 px photo slot** on a plant card. That is the size of my product.
- No sharing of anything visual. `Woche exportieren` is Markdown and CSV.

### Best parts to steal

- **Auto-picked stage covers** from the webcam at the transition timestamp. Zero taps, real delight.
- **"Kamera-Bild von diesem Moment"** on any entry — nearest still within ±15 min, one query.
- Naming the composite honestly rather than calling a playlist a timelapse.

---

## 7 — C10 "Durchgang" · **49**

**Verdict:** contains the single best individual camera idea in the entire bake-off, bolted to a
thesis that gives me nothing for five months.

**`Am selben Tag`** (§4.6, §7): two stills side by side, this run's day 34 and last run's day 34,
and — the detail that makes it work — the frame for each run is picked at **mid-photoperiod per run,
not the same wall-clock hour**, *"so the two images are lit the same way and are actually
comparable."* That is the only place in ten documents where anyone thought about the *photometry* of
comparing two frames. §4.6 calls it *"the most emotionally compelling thing in the concept"* and it
costs two `<img>` tags. Steal it into the winner immediately.

It also ships the sprite in v1, cuts timelapses per stage of a run (`Blüte, Tag 1–34`), and adds an
`ImageMeta` sidecar rather than touching the 16 MB-BSON image collection — which is the right
engineering call.

### Fatal flaws

- **The payoff is day 34 of run 2.** §11 says it plainly: *"He is the type this concept eventually
  serves best and week-one serves worst."* And §15.1 goes further: *"the thesis is a retention feature
  masquerading as a product."* I bought a camera to watch **this** plant. Being told to come back in
  five months is not an answer; it is the absence of one.
- **Week one gives me the existing 1d/1w timelapse and a film strip.** That is the baseline every
  concept clears.
- **The home screen has no picture on it at all.** Blocks A–G: run strip, freshness, four value tiles,
  verdict, capture row, next action, recent events. Not one pixel of my tent.
- `Auf Zusammenfassung reduzieren` is the **default** at run close and *"Messreihen, **Fotos** und
  Notizen werden gelöscht"* (§8.3). The privacy-maximal default **deletes my photographs**, and
  §15.8 admits it is irreversible. For the one user whose entire value is the image archive, the
  default setting destroys the product. Nobody flagged the interaction.
- §15.5: staggered plants break the run model — which is the owner's own multi-plant scenario.

### Best parts to steal

- **`Am selben Tag`** with **mid-photoperiod frame selection per run**. Best camera idea here.
- The `ImageMeta` sidecar (`run_id`, `day`, `stage`, `plant_ids`, `kind`) instead of mutating `Image`.
- A run being a natural sprite window, which makes storyboard generation cheap.
- And the anti-lesson: **never let a retention default delete images.**

---

## 8 — C08 "Shared Grow" · **45**

**Verdict:** my camera is the *fourth tab, conditionally*, it can be displaced by a fertiliser
schedule, and in the concept's own best-served mode it gets switched off.

§2.2, verbatim: the 4th tab is `Futter` if a feed regime is active → else `Pflanzen` if ≥2 plants →
else `Kamera`. **Kamera is third in line.** If I ever tap a feeding schedule out of curiosity, my
camera loses its navigation. That single rule tells me everything about where I sit in this concept's
priorities.

Then §7: club mode **defaults to pausing capture while somebody is in the tent**. Correct privacy
call, and §15.10 concedes the consequence: *"club mode actively pauses the camera, which is the
correct privacy call and the wrong answer for somebody whose whole reason for buying was correlating
pictures with numbers."* The concept's flagship mode disables my product.

Credit where due: **"Kamerabild übernehmen"** — one tap on any entry attaches the still nearest that
timestamp, no upload, no `express-fileupload`, no BSON risk — is a genuinely elegant idea and §7 calls
it *"the literal implementation of 'it does the diary keeping for you'"*. And the timelapse scopes
(Phase / Grow / **Besuch**) at least give clips a relationship to something.

### Fatal flaws

- Camera is the conditional 4th tab, behind feeding and plants.
- **v1 film strip is thumbnail-per-request** and §4.6 refuses to pretend otherwise: *"it is N requests
  and it will be visibly slow on 30 days ... I am not going to claim the sprite endpoint ships in
  October."* Respectable honesty, bad outcome for me.
- The entire October budget goes to an **authorisation rewrite** — `Membership`, `resolveGrowAccess`,
  ~20 owner-scoped queries, invite flows — which §15.1 concedes is *"the most expensive single line
  item in the whole redesign"* for the smallest segment. I am a solo user with a camera. I pay for all
  of it and use none of it.
- §15.10 states outright: *"Type 2 is served better by a camera-first concept ... the camera is a
  lane, not the spine."* I agree with the author against the author's concept.
- "Visit timelapse" — a clip of a named person working — is described by §15.5 as *"arguably the
  worst-idea-per-line-of-code in the document."* Also agreed.

### Best parts to steal

- **"Kamerabild übernehmen"** — attach the nearest existing still to an entry with one tap and no upload.
- Naming the GDPR problem of a camera that photographs people, and pausing capture as an explicit,
  visible, explained behaviour (the visit bracket explains the gap in the strip — that is good design).
- Refusing to claim the sprite ships when it does not.

---

## 9 — C07 "Der Plan" · **40**

**Verdict:** three of the smartest camera details in the bake-off, hung on the one v1 deliverable the
author says will be cut, inside a product organised around a plan I explicitly declined.

The camera thinking is good. §7 denormalises `run_id`, `plan_id`, `stage`, `dayOfRun` and
**`isLightsOn`** onto `Image` at capture — all optional, all derivable, no firmware change. It adds
`'stage'` and `'run'` timelapse durations. And it is the **only concept that specifies lights-on
filtering by default for run timelapses**, with the correct reason: *"a timelapse that strobes
through 12 h of darkness is unwatchable."* That is the second real piece of timelapse *content*
design in ten documents, and it is right.

Then it throws it away.

### Fatal flaws

- **The chart is Tier 2 and explicitly first to be cut.** §13: *"If Tier 0 slips — and Tier 0 is a P0
  list written by someone reading the code, so it will — **v1 is Tier 0 + Tier 1 and the chart ships
  in November**."* The film strip lives on the chart. My entire camera experience is in the bucket the
  author predicts will not ship with the hardware.
- **Even if it ships, v1's film strip is N requests and is "off by default above 7 days"** (§4.3 #9).
  Off. By default. For the user whose product it is.
- **Stage and run timelapses are v1.1.**
- **`Nur beobachten` — my correct onboarding answer — turns the product off.** §15.4: *"the tab bar
  still has a Plan tab that says nothing, and the entire concept's centre of gravity is a feature this
  user has declined."* I decline the thesis at setup and am left holding a shell.
- My type-2 walkthrough (§11) is six lines and half of it explains that my timelapses will be *"filed
  by date rather than by stage"* because I have no run.

### Best parts to steal

- **`isLightsOn` denormalised onto `Image` at capture**, and **lights-on filtering by default** for
  any multi-day render. This is how you make a watchable clip.
- The **hero image auto-picked as the lights-on frame nearest the week's midpoint** — deterministic,
  well-lit, zero taps.
- Not fabricating DLI from a dimmer percentage. The same discipline should apply to timelapses:
  do not stitch frames you know are unusable.

---

## 10 — C02 "The Verdict" · **33**

**Verdict:** a concept whose entire thesis is that I should not have to look, sold to the one user who
bought hardware specifically in order to look — and it says so itself.

§11, the type 2 walkthrough, in the author's own words: *"stage-bounded timelapses and the sprite film
strip are **v1.1/v2**, so in October 2026 he gets the excursion thumbnail and today's timelapses, and
nothing more. **He is the type this concept most under-serves relative to what the owner asked for.**"*
I have nothing to add to that; it is an accurate self-assessment and it is the score.

The one genuinely good idea: **the excursion thumbnail** (§3.5) — the still nearest the peak of the
longest excursion, sitting beside the sentence that says the room peaked. §3.5 calls it *"the one
place a camera-owning user (type 2) gets something no competitor has, for almost no work."* True, and
it is the only camera feature in v1.

### Fatal flaws

- **The philosophy is hostile to me.** "Demote every chart to evidence you drill into only when the
  verdict says you should." I drill in every day, for pleasure, unprompted. An app that computes a
  green tick and tells me there is nothing to see has misunderstood the transaction.
- **Zero pixels of my tent on the home screen.** Verdict card, three tiles, an outputs card, a "next"
  card. No image anywhere.
- **§13 explicitly excludes the film strip from v1** along with the chart rewrite, plants, journal and
  everything else. And §13's own uncomfortable consequence: *"in October the verdict sits on top of
  **today's chart**"* — fifteen translucent areas on hidden axes with hover-only events. So even the
  degraded correlation path is the current broken one.
- Sprite film strip and stage timelapses are **v2**. Not v1.1. v2.
- §15.7 is fatal in a way the author does not connect to me: an offline device destroys the concept's
  premise. My camera going quiet is exactly that event, and there is no verdict for "your pictures
  stopped."

### Best parts to steal

- **The excursion thumbnail.** Genuinely the highest value-per-line-of-code camera idea in the set:
  the picture from the minute it went wrong, next to the sentence saying it went wrong. Put it in
  whatever wins.
- Reporting excursions as a **duration** with a timestamp — which is what makes fetching the right
  frame possible at all.

---

## What nobody got right

These are needs of mine that **not one of the ten** met. This is the most useful thing in this
document.

### 1. Nobody ships a timelapse I can hold, in v1

Ten concepts. Every single one either keeps the existing `1d|1w|1m` rolling windows or defers
stage/grow renders to v1.1 or v2. C09 (v1.1), C01 (v1.1), C05 (v1.1), C04 (v1.1), C06 (v1.1), C03
(v1.1, and v1 is a playlist), C07 (v1.1), C08 (v1.1 for visits), C10 (per-run, but the concept's
payoff is run 2), C02 (v2). The owner's brief for me contains the words *"It should be creating
timelapses"* and **the release that ships with the hardware creates none.**

Worse: only C05 designs how a video *leaves* the product at all (link · Telegram · Discord · save
file). Nobody else specifies a download path, a filename, a resolution, a codec, or how an mp4 gets
from a Mongo Buffer onto my phone's camera roll — which is the only place a shareable video actually
lives. A "share" that produces a URL to a page requiring a login is not a share.

### 2. Nobody designed the *content* of the timelapse

A tent timelapse is mostly garbage frames: lights off, my hand in shot, the door open, condensation
on the lens, the camera nudged 5° on day 12, magenta LED light versus daylight from the open door.
Making it watchable is a **content problem**, and it got two half-answers in ten documents:
C01's solar-noon-while-lit selection for cycle zoom, and C07's lights-on filtering for run
timelapses. Nobody specified frame culling, exposure and white-balance normalisation across a 12-week
grow, deduplication of near-identical frames, stabilisation, or suppressing frames where a human is
in the tent. The product I bought is a **video**, and its quality is unspecified in all ten concepts.

### 3. Nobody gave the camera an alarm

Every good concept applies freshness honesty to the still — C09 fades to illustration, C06 greys the
tile, C04 gives the still its own age line. All of that tells me the camera is quiet **when I happen
to open the app**. None of them tells me *without me looking*. `Alarm.sensorType` covers sensors;
there is no `camera_silent` anywhere in ten documents. I will discover my camera died three weeks ago
at the moment I go to make the harvest timelapse and find a hole in the middle of it. That is the
single worst outcome available to me and no concept prevents it.

### 4. Correlation only runs one way

Every concept gives me **chart → image**: scrub the time axis, the picture follows. Nobody gives me
**image → question** as the entry gesture. What I actually do is notice something in a *frame* — a
droop, a colour shift, a wilt that was not there yesterday — and want to start from that picture:
tap it and be told what the room was doing then, and what was different about that day versus the
days either side. C09 comes closest because the picture and the numbers are the same object, but even
there I navigate by *time*, not by *image*. Nobody built "take me to the frame where this changed",
and nobody built a difference view between two frames I choose.

### 5. Nobody acknowledged that I get exactly one camera

`cloudSettings.rtspStream` is a single string; one webcam per device. Ten concepts, zero mentions of
that limit as a design constraint. C09 literally draws a picture of my tent with a camera in it and
never says "you get one." A canopy shot and a close-up, or two tents, or a second angle — no concept
tells me whether that is possible, impossible, or planned, and several (C09's backdrop, C10's
side-by-side) implicitly assume a fixed, never-moved, single viewpoint that I will inevitably nudge.

### 6. Nobody costed the images they promised me

Stills at 30 s cadence = **2,880 images per day**, stored as Buffers inside MongoDB under a 16 MB
BSON ceiling, with 3-year retention on webcam JPEGs and `express-fileupload` mounted with no size
limit. Every concept adds image volume; C09 puts a photograph on my home screen refreshing every
30 seconds; several ship sprite endpoints generating derived tiles. Not one document states what a
12-week grow costs in storage, at what still resolution, whether sprite tiles are cached or built
per-request, or what my retention actually is. Several concepts propose *deleting* photos as a
privacy default (C10 makes it the default) without noticing that for me the images **are** the
product. My whole purchase is an image pipeline and ten documents sized none of it.

### 7. Half of every day is black and one concept noticed

Twelve hours a day my tent is dark. C09 says a black backdrop "is correct at night and reads as such"
— which means my home screen is a black rectangle for half of every day. C01 and C07 dodge it by
picking lit frames for aggregate views. Nobody proposes an IR or low-light capture path, a
"last lit frame" fallback for a live surface, a night-frame policy for the scrubber, or even a
`Nachtansicht` toggle. Half my footage is unusable and it went almost entirely unexamined.

---

## The dealbreaker test

> **Cold open the app on day 40 of my grow, on my phone.**
>
> **(a)** In **one gesture from the first screen**, put an image of my tent from a *specific past
> moment* on screen with the temperature, humidity and VPD **of that same moment** beside it — with
> the frame's own age shown separately from the sensors' age, so I can tell a dead camera from a dead
> controller.
>
> **(b)** From **that same screen**, produce a timelapse spanning all 40 days that skips the
> lights-off frames, and hand it to me as a file or a link I can paste into a Telegram group without
> a screen recorder.
>
> If (a) needs a second screen, if (b) is v1.1, or if either only works up to 7 days — **the concept
> fails.**

Today, **C09 passes (a) outright and fails (b) on the v1.1 timelapse and the 7-day scrub cap.**
Everything else fails both. The winning design is C09's home screen — my camera as the substrate,
`?t=` as the one cursor — with C05's share menu, C07's lights-on filtering, C01's solar-noon frame
selection, C10's mid-photoperiod frame matching and C02's excursion thumbnail folded in, the scrub
range unshackled from 7 days, and a `camera_silent` alarm added. That is a v1 I would pay €349 for.
None of the ten, as written, is one.
