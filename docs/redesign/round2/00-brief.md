# Brief for concepts C11-C50 — READ THIS FIRST, IT OVERRIDES THE EARLIER ROUND

Ten concepts (C01-C10) were produced and torn apart by ten critics. The product owner has now
seen them and issued new instructions. This round exists because of what the first round got wrong.

## THE OWNER'S NEW INSTRUCTIONS — VERBATIM, NON-NEGOTIABLE

> "i want 40 more concepts before selecting the top 5. Try finding a way that works for all users
> (no simple/expert mode). Also do some with more focus on the diary. and the camera with it's
> time lapse and image correlation features is probably one of our biggest selling point."

### 1. NO SIMPLE/EXPERT MODE. This disqualifies a whole design strategy.

C04 "Zweigang" built two apps behind one login and the owner has now ruled that out. So has every
"Advanced" accordion, every "Show more" toggle that hides a whole feature class, every
"beginner/pro" preference, and every onboarding question of the form "what kind of user are you?".

**ONE interface serves the stoned user, the normal user, the techie, and all seven user types.**

That is the hard design problem of this round. Real mechanisms that are NOT modes:
- **Reveal by capability** — you see controls for kit you actually own, because the device reports it.
- **Reveal by data** — a feature appears when there is something to show (no plants logged, no plant UI).
- **Reveal by depth** — one surface, drill down as far as you like. Simple is the TOP of a deep screen,
  not a different screen.
- **Progressive precision** — a verdict, with the number next to it, with the raw series one tap in.
  Nobody is denied the number; nobody is forced to read it.
- **Ranked density** — everything is present, ordered by what matters now. Attention is the filter.
- **Adaptive ordering by behaviour** — what you touch floats up. (Careful: unpredictability hurts the
  impaired user badly. If you use this, defend it.)

A concept that quietly reintroduces a mode under another name will be rejected. Naming a mode
"Fokus" does not make it not a mode.

### 2. THE CAMERA IS A TOP SELLING POINT AND ALL TEN CONCEPTS FAILED IT

The owner says the camera with its timelapse and image-correlation features "is probably one of our
biggest selling point". The camera critic's verdict on round one:

- **All ten concepts defer timelapses to v1.1 or v2.** The release that ships with the hardware in
  October 2026 creates NO timelapse. The owner's own brief says "It should be creating timelapses".
- **Only one concept designed how a video LEAVES the product.** No download path, no filename, no
  resolution, no codec, no route from a Mongo Buffer to a phone's camera roll. "A share that produces
  a URL to a page requiring a login is not a share."
- **Nobody designed the CONTENT of the timelapse.** A tent timelapse is mostly garbage frames: lights
  off, a hand in shot, the door open, condensation on the lens, the camera nudged 5 degrees on day 12,
  magenta LED versus daylight through an open door. Making it watchable is a content problem: frame
  culling, exposure and white-balance normalisation across 12 weeks, deduplication of near-identical
  frames, stabilisation, suppressing frames with a human in the tent. Unspecified in all ten.
- **Nobody gave the camera an alarm.** Freshness honesty tells you the camera is quiet only if you
  happen to look. A camera that stopped three days into flower should tell you.

What exists today (verified): the cloud asks the device for a still every 30 s over MQTT; stills are
stored as `Image {image_id, device_id, timestamp, timestampEnd?, data: Buffer, format:'jpeg'|'mp4'|
'user/jpeg', duration:'1d'|'1w'|'1m'}`; three rolling timelapse durations are built hourly.
`timestampEnd` already marks an mp4 as spanning a range. Pairing is by `hardwareInfo.webcam_did`.

**Image correlation** is the owner's other named feature: the image and the conditions at that moment
belong together. Scrubbing a chart should move the picture; picking a picture should show its numbers.

### 3. MORE DIARY FOCUS

The owner's original ask: the diary is a selling point precisely because **"it does the diary keeping
for you"**. Several concepts in this round must put the diary at the centre rather than treat it as
one tab of four.

### 4. FIVE GAPS EVERY ONE OF THE FIRST TEN MISSED — from the grow-club critic

Address these where your concept touches them. They are not optional colour:

1. **Nobody prevents a double feed.** Ten concepts optimised capture SPEED; none optimised capture
   SAFETY BETWEEN PEOPLE. At the moment of capture: "Anna hat A1-A3 vor 1 Std 30 gefüttert. Trotzdem?"
   — a soft block on the same plants inside a window, one deliberate extra tap to proceed. A double
   feed is the most expensive thing that happens in a shared room.
2. **Attribution is a label; authorisation is a gate.** Eight of ten deferred clubs because multi-user
   needs an auth rewrite. It does not: a device-scoped "who is at the tent" picker — names the owner
   types once, no accounts, no `auth.middleware` surgery, stamped onto `actor_id` at capture,
   upgradeable to real memberships later — delivers attribution in v1 for ~2 days of work.
3. **Nobody answers the cumulative question.** "How much Bio-Bloom has plant A3 had this cycle, and
   from whom?" Every data model could compute it; none surface it.
4. **Nobody has a place for a standing CONDITION.** Not an event, not a task: an open fact with an
   owner. "CO2 bottle nearly empty", "socket 3 loose", "do not water A3, overwatered".
   `Condition {text, openedBy, openedAt, closedBy?, closedAt?}`. This is what gets pinned to a tent door.
5. **Nobody can capture in a cellar.** No service worker exists. One concept's offline retry queue can
   double-log, which in a shared record is indistinguishable from a double feed.

## WHAT THE FIRST TEN ALREADY DID — do not simply repeat these

C01 Loupe (one zoomable timeline, no pages) · C02 Das Urteil (one verdict, charts as evidence) ·
C03 Beet (plants are the root object) · C04 Zweigang (two apps — NOW BANNED) ·
C05 Thumb Journal (one-tap chat-like capture) · C06 Glance Tiles (honest tiles with data age) ·
C07 Der Plan (a plan, not settings; plan vs reality) · C08 Shared Grow (visits, signed and time-boxed) ·
C09 Das Zelt (spatial tent cross-section) · C10 Durchgang (run-over-run comparison, day-of-run axis)

You may BORROW a primitive from these (the visit, the tile's data age, the day-of-run axis) but your
concept must have its own centre of gravity.

## UNCHANGED HARD CONSTRAINTS

- Angular 15 + Ionic 6, NgModule-based. Mobile-first; the big screen is an unexploited advantage.
- `device.configuration` CANNOT carry new keys — firmware strips unknown keys. All new state is
  cloud-side in MongoDB.
- Assume NO firmware change before the October 2026 ship date unless you flag and justify it.
- Hardware: 1x PWM out, up to 32 Tasmota sockets with roles, temp/humidity/VPD, CO2 only as a paid
  upgrade, one camera. **NO irrigation or dosing hardware** — watering and feeding are logged by hand.
- German first (Novazer GmbH, de-DE), English second. Both mandatory.
- Charting: migrating OFF Highcharts to Apache ECharts 6 (owner decision).
- Nutrients: the scheme is selected once and PREFILLS the log entry, always editable. Model it as
  **medium + feed regime** the way growers say it: "Biobizz All-Mix" means heavily pre-fertilised, so
  do not feed for 3-4 weeks. Brand names as plain text only, numbers in a Mongo collection.
- Market scope: hobbyist home growers + grow clubs. NO commercial/retail. No seed-to-sale compliance.
- Two-way grow-diary sync is impossible; the honest features are export, a public diary URL, and a
  Markdown/BBCode post generator. Telegram and Discord are viable; Instagram/TikTok/Reddit are not.
- Harvest weights and plant counts are legally sensitive. Privacy posture is a design decision.

## THE SEVEN USER TYPES — verbatim, authoritative

1. Lazy MONITORING-ONLY. "just wants to record the values and look at them, after some time."
2. SAME, BUT WITH A CAMERA. "the same values, but correlated with his camera. It should be creating
   timelapses and other things."
3. CONTROLS ONLY CERTAIN ASPECTS "like CO2 or heating".
4. CONTROLS HIS ENTIRE GROW in a tent: "Heating, Lights, Air, Dehumidifier or Cooler, Humidifier, etc.
   (a user doesn't have all of this most of the time)".
5. BUILDS HIS OWN CLOSED LOOP SYSTEM like a fridge.
6. CANNABIS GROW CLUBS sharing controllers. "one of most important topics is watering and fertilizers.
   (Who did what? How did the plants react? etc)"
7. OLD DEVICE OWNERS (air, light, socket). Not the focus group, must not be broken.

Capability lenses: STONER (impaired, one hand, dark tent, 2am), NORMAL (competent, non-technical,
compares this to AC Infinity and Instagram), TECHIE (wants density, precision, raw data, an API).
