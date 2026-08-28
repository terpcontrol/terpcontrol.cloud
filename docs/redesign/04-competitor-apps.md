# Competitor grow-controller apps and their UX — what Terp Control has to beat

Research date: **2026-08-24**. All ratings/prices captured on that date unless noted.

---

## 0. Method, and what I could / could not verify

**Verified directly (primary sources, fetched live):**
- Apple App Store metadata via the public `itunes.apple.com/lookup` and `itunes.apple.com/search` JSON APIs — exact star ratings, rating counts, versions, release dates.
- Apple's public customer-review RSS feed (`itunes.apple.com/us/rss/customerreviews/id=<id>/sortBy=mostRecent/json`) — **verbatim** review text for AC Infinity, TrolMaster TM+ Pro, Mars Hydro, Spider Farmer, VIVOSUN, AROYA, Inkbird, Grow with Jane. Every quote below marked `[App Store]` is verbatim from that feed.
- Vendor documentation: AC Infinity's official app-programming pages, Pulse Grow's pricing page + help centre + **live OpenAPI/Swagger spec**, Growlink's pricing page, TrolMaster's TCS-1 spec page.
- Forums that are actually fetchable: `community.pulsegrow.com` (Discourse), `community.home-assistant.io`, `overgrow.com`, `ilgmforum.com`, `rollitup.org`, GitHub READMEs.

**Could NOT verify — do not treat as fact:**
- ⚠️ **Reddit is completely inaccessible to this tooling.** `reddit.com`, `old.reddit.com` and the `.json` endpoints are all blocked at the fetch layer, and the search API refuses `reddit.com` as an allowed domain. So there are **zero Reddit citations in this document**. Where the brief asked for Reddit evidence I substituted App Store reviews (which are equally verbatim and arguably higher-signal, since they are tied to a version number) and the accessible forums above. If you need Reddit specifically, that needs a human or a different tool.
- Google Play ratings — Play Store pages truncate before the rating block for this fetcher; APKPure/AppBrain returned 403/no data. **All rating numbers below are iOS only.** iOS under-represents these products (growers skew Android), so treat rating counts as a floor, not a market-size proxy.
- YouTube walkthroughs — no transcript access. Screen-by-screen UI descriptions below come from vendor documentation, not video.
- TrolMaster Hydro-X HCS-1 street price — not found in an authoritative listing. UNVERIFIED.
- Whether the legacy "Trolmaster" (pre-TM+ Pro) iOS app still exists: it does **not** appear in a US App Store search for "trolmaster" — only TM+ Pro (id 1619222131) is returned. Consistent with a reviewer's accusation that they shipped a new app to reset ratings, but **the causal claim is UNVERIFIED**.

---

## 1. The scoreboard (iOS App Store, 2026-08-24)

| App | Vendor | Rating | # ratings | Version / last release |
|---|---|---:|---:|---|
| **VIVOSUN** (id 1600813756) | VIVOSUN INC | **4.74★** | **8,172** | 4.69.0 · 2026-08-21 |
| Govee Home (1395696823) | Shenzhen Intellirocks | 4.21★ | 10,140 | 7.6.10 · 2026-08-21 |
| **AC Infinity** (1481751004) | AC Infinity Inc. | **4.15★** | **829** | 2.0.8 · 2026-07-30 |
| INKBIRD (1589369968) | Shenzhen Inkbird | 3.69★ | 6,658 | 2.2.4 · 2026-08-18 |
| AROYA (1486621692) | Addium Inc | 3.68★ | 28 | 1.53.19 · 2026-08-10 |
| Spider Farmer (6476436750) | HY Agriculture | 3.13★ | 121 | 2.5.2 · 2026-06-29 |
| **TM+ Pro** (TrolMaster) (1619222131) | TrolMaster Agro | **3.09★** | **96** | 1.5.9 · 2026-06-12 |
| SOLUS by AROYA (1541736036) | Addium Inc | 3.00★ | 4 | 1.2.8 · 2026-08-22 |
| Ecowitt (1576152334) | 玮 彭 | 2.89★ | 66 | 1.1.72 · 2021-08-11 |
| Gorilla Grow Tent (6741532981) | Grow Strong Ind. | 2.88★ | 51 | — |
| **Mars Hydro** (6479227564) | Mars Trading | **2.63★** | **27** | 2.1.2 · 2026-07-31 |
| Growlink (1108096591) | Hydropods, Inc. | 2.14★ | 7 | 3.0.1330 · **2016-04-30** (abandoned; they moved to `app.growlink.io` web) |
| **Mars Legacy** (1612237275) | Mars Trading | **1.30★** | 71 | 1.2.2 · 2026-02-02 |
| Pulse Grow (1497259672) | Pulse Labs | *"not enough ratings"* on iOS | — | — |
| — journal apps for reference — | | | | |
| bud – Grow Journal & Community (1330612534) | NU games | 4.61★ | 1,971 | — |
| Grow with Jane (1467850558) | Los Redondos Inc. | 4.11★ | 341 | 3.0.9 |
| Grow Guide (6637720578) | phannafest llc | 4.86★ | 122 | — |
| Photone – Grow Light Meter (1450079523) | Lightray Innovation | 4.62★ | 4,893 | 4.5.2 |

**Read this table carefully.** The entire *controller* category is a rating desert. The only app that has both scale and satisfaction is VIVOSUN, and its 4.74★/8,172 is a strong outlier that the review text does not fully support (see §5) — it looks review-solicited. The *serious* products (TrolMaster 3.09★, AROYA 3.68★, Growlink abandoned) score worse than a $30 barbecue thermometer app. **Software is the entire industry's weak flank.**

---

## 2. AC Infinity — the one to beat (UIS platform)

### Hardware / price anchors
- Controller 69 Pro (4-port) **$89.99**; Controller 69 Pro+ (8-port) higher; **Controller AI+ $159** (8-port, dual-zone temp/RH/VPD, up to 32 UIS devices via splitters); Outlet AI+ **$99**.
- SPECTRON 3 AI grow camera **$79.99** (was $89.99), 4K stills + daily timelapse, 940nm IR, microSD (not included), IP67. SPECTRON 7 adds thermal imaging + under-canopy cam.
- **No subscription for any app feature.** Confirmed by two independent reviews. This is the price ceiling for any Terp Control paid tier.

### App structure (from AC Infinity's own docs)
- **DEVICES page** = the hub, "all your controllers and hygrometers on one page".
- Per-controller tabs: **CONTROLS** (assign devices to programming modes, mirrors the physical unit) · **ADVANCE** (automations, alarms, notifications) · **AI** (self-learning programming) · **DATA** (climate graphs, distribution charts, CSV export) · **HISTORY LOGS** (past triggers/alerts) · **SETTINGS** (transitions, units, calibration, VPD offset).
- Device tile expanded shows: device type, on/off, current level + trend arrow, current mode, name, code, connection status. Home shows temp / RH / VPD.
- **DATA tab**: two chart types only — a *fluctuation* line chart and a *distribution* bar chart ("most frequent climate conditions in the period"). Five fixed ranges: hour / day / week / month / year. Metrics: **temperature and humidity only**. CSV export. No documented retention limit.
- **HISTORY LOGS**: logs *which device*, *which programming controlled it*, *what it did*, *when*. Entries are user-deletable. — This is the single best idea in the whole competitor set and Terp Control should steal and outgrow it (see §10).
- **Account page**: password, privacy toggles, delete account, and *"share access to your UIS controller if it is WiFi enabled."* That is the **entire** multi-user story — a binary share, no roles, no per-user notifications, no guest scope, and unavailable on Bluetooth-only controllers.
- **No journal / diary / plant log of any kind.** Growers publicly request "plant data tracking (stages of growth, plant type) with a place for notes and pictures." A third party built it instead (see §9, `dwot/isley`).

### What users actually say `[App Store, verbatim]`
Reliability of *representation* is complaint #1:
- 2★ "**Devices disappear constantly** … The app will say a fan is running at 10 speed but the fan will not be running at all. It's like they faked the connectivity and made a faulty app."
- 1★ "Widgets haven't worked in months … Uninstalling, reinstalling, logging in, logging out, I've tried everything… **AC Infinity doesn't even try to fix them.** This company is more worried about selling you their next underdeveloped product than providing a quality experience."
- 1★ (v2.0.4, May 2026) "Update broke the app - Won't open now. App will not open as of 5/19/26"; 1★ (v2.0.4) "**Crashes after latest update** … The latest update installed in May of 2026 results in the app crashing upon start-up."; 1★ (v2.0.7) "Latest update causes the app to crash upon launch now."
- 1★ "Do not buy — The app frequently does not respond when I tap the screen, especially when trying to change fan speed. **It feels like I have to press multiple times just to get the app to register a simple command**, and even then it often lags or ignores the input entirely."
- Reported to Apple in an earlier changelog: bug where "hygrometer devices [did] not display data chart history" (fixed 1.8.2); and "Bluetooth devices missing sensor chart data / incorrect chart readings on AI+ series devices in Bluetooth Mode."

Scheduling rigidity is complaint #2 — and it is *specific and damning*:
- 3★ "**Good but very limited** — My biggest problem is the lack of customization for scheduling the timers. I have a drip, I want it to turn on the pump twice when the lights are on. **App can't do that.** How about you want to water once every two days. **App can't do that. Only works in 24 hour cycles.** … Can't set it to turn other items off first when in ai mode. **I can't set up automated shortcuts on my phone to trigger outlets thru the app. Everything has to be done in app.**"

Data-export quality is complaint #3:
- 4★ "Great design Outlet Controller… but AI integration needs significant work. **I'd rather it improved data export at higher sampling rate and exporting the Port state of the Outlets.**" — i.e. the CSV contains climate but **not device/output state**, so you cannot reconstruct cause and effect offline.

Onboarding friction:
- 3★ "**Doesn't allow manual WiFi entry** — Forces joining the same WiFi network as the phone… and also requires the phone to join the 2.4 GHz network. Why on earth wouldn't you allow manually typing in the WiFi SSID?"
- 1★ "**Login Required** — Buyer beware: this requires an account. Doesn't even support Apple sign in."
- 1★ "Requires controller hardware — I just need one CLOUDLINE fan… I would have had to purchase an expensive controller hardware with 90% features I don't need."

Hardware/app trust, from forums:
- Overgrow thread "Controller 69 issues": WiFi drop then **completely frozen controller screen after ~60 days**; a replacement unit failed identically; ports became individually unconfigurable — "sketchy, working for a few ports for a little while, but not reliably." AC Infinity replaces units via support.
- A 2026 buyer's guide notes "firmware or app updates known to **reset saved schedules**, requiring reconfiguration." (secondary source, treat as PLAUSIBLE not proven)
- Independent AI+ review: RH probe drifted **~4% high after six weeks**; **VPD mode and independent temp/RH control are mutually exclusive** — you cannot hold a temperature while letting VPD steer humidity; and to use a heater in VPD mode you must open the temperature band to ~20 °C wide (e.g. 18–38 °C) or the controller refuses to engage the heater ("bad logic", makes VPD mode unusable for cold-climate growers).
- ILGM thread on escaping the app: growers object to *"having to have the internet avail for full ops"* and to *"logins to the motherships"*; one: *"you are giving away ownership of hardware now as well and also granting an access path into your home network."*

### What AC Infinity does well (be honest)
One-page multi-device home; VPD front and centre; sunrise/sunset light transitions (repeatedly praised: *"No more shocking the plants with quick on/off"*); genuinely useful AI/auto mode once dialled in (*"one variable that I barely check anymore"*); History Logs concept; **no subscription**; excellent CS reputation; and — critically — the app is *bundled with hardware people already own*, so its 4.15★ is partly brand halo (many 5★ reviews are about fans and tents, not the app).

---

## 3. TrolMaster (Hydro-X / Hydro-X Pro / Tent-X / Green-X, app: TM+ Pro)

### Facts
- **TM+ Pro 3.09★ / 96 ratings**, v1.5.9 (2026-06-12). Covers Green-X, Tent-X, Hydro-X, Hydro-X Pro/Plus, Aqua-X family, Carbon-X, Hawkeye.
- App's own marketing copy is a confession of what the old app lacked: *"New UI: Clear and friendly user experience. **Historical Chart: All historical data will be presented in one graph, making it easier to compare the data collected.** New devices display customization: rename and add photos on all devices. **New Logbook function: track your plant stages, time and date. Log plant data such as Environment and feeding parameters; plant information and room setup details.** New Community page: follow your favorite growers, share your logbook. New Support page."* — TrolMaster has already identified *combined-metric charts* + *logbook with stages* + *community* as the differentiators. They just execute them badly.
- Tent-X TCS-1: **~$298–$329** street. Includes MBS-TH 3-in-1 (temp/RH/light) sensor, 2 lighting channels (up to 256×2 fixtures), max 2 each of temp/humidity/CO2/programmable device stations, optional CO2 (MBS-S8), PAR (MBS-PAR), pH/EC (AMP-3), water-content (WCS-1/2), smoke and water detectors. 1000 m device runs. Hydro-X HCS-1 price UNVERIFIED.

### What users say `[App Store, verbatim]`
- 1★ "**Wonky Performance** — The historical data within the controllers does not work well. **The time stamps aren't in chronological order. It'll skip from AM to PM randomly as well.** Lots of bugs"
- 2★ "**Buggy schedule page for years** — The schedule page data entry fields are ridiculously buggy. Seems a simple fix but yet it endures. **Would also be nice to get some sort of indication that the ports on the 24v and 110v devices are on for a quick visual confirmation without having to physically go look at the device itself.**" ← a $3k system with no at-a-glance output state.
- 1★ "**Garbage** — Terrible app. **Doesn't have all the controls of the unit**, it crashes constantly, **doesn't update with real time readings, and has horrible graphs.**"
- 1★ "App needs work — …as for the mobile app (it's trash). Can't control none of the devices, it doesn't give out the exact readings (real time) and it crashes often. **What's the purpose of having the trolmaster app only to look at (sometimes) delayed readings that you have no control over?**"
- 1★ "**Why this thing not refresh?** … Thing doesn't even refresh unless I go back and select the controller again."
- 1★ "**Almost as bad as the last version** — I'm assuming they created a new app instead of upgrading the old one because they wanted their ratings to start over… **The graphs are horrid, I get timeouts constantly, not all settings are on the app**, it crashes, there are bugs all over… **They were great at taking over the shelves in the shops but they are just asking for a competitor to come take their lunch.**"
- 1★ "Why is it so trash. — I have 5 set ups with all the bells and whistles. I haven't logged into the app for a few months and **now it won't even show devices** even though I entered them several times…"
- 1★ "Always having timed out issues — **I can not ever trust the app**"
- 1★ "Issues with verifying email. — Tried a dozen times, every time I enter the code it fails."
- The positive ones are notable for how low the bar is: 5★ "**The app isn't the most beautiful but it's dead simple and works.**" and 5★ "Being able to remotely view all the parameters and visually inspect the grow room from your phone is a game-changer. **The notifications and offline alerts can be a little annoying**, but they can also save your butt. The only thing I wish is that **the AVG parameters would update a little quicker**."
- Also: *"The app forces Trolmaster ads every time users open it"* (secondary source, PLAUSIBLE).

**Verdict:** TrolMaster is the clearest "asking for a competitor to come take their lunch" target. Hardware respected, app actively distrusted. Their own feature list (unified chart, logbook with stages, community) is the roadmap they can't ship.

---

## 4. Pulse Grow (Pulse One / Pro / Zero) — the app UX benchmark

This is the one competitor whose *software* is genuinely good, and the one to benchmark against.

### Hardware & plans (verified from pulsegrow.com)
- Pulse One **$199** (VPD, temp, RH, light LUX%, dew point). Pulse Pro **$499** (adds CO2, PPFD/PAR & DLI, spectrometer, rechargeable battery / handheld mode). Pulse Zero (entry, price not on the page). Hub Starter Kit **$499**, Hub VWC Kit **$799**.
- **Plans: Free / Enthusiast $10 per user/month / Professional $35 per user/month** (+ Enterprise).

| Feature | Free | Enthusiast $10 | Professional $35 |
|---|---|---|---|
| Remote monitoring, mobile+web, basic alerts, VPD & dew-point alerts, alert templates, VPD targets & guidance, email/push, **chart sharing** | ✓ | ✓ | ✓ |
| **Historical data retention** | **3 months** | **1 year** | **Unlimited** |
| CSV exports | Weekly | Unlimited | Unlimited |
| Guest users | 1 | 3 per paid user | Unlimited |
| **API datapoints/day** | **4,800** | **24,000** | **120,000** |
| Multi-user accounts | — | ✓ | ✓ |
| Automated/scheduled exports | — | ✓ | ✓ |
| SMS notifications (US/CA) | — | ✓ | ✓ |
| Advanced permissions | — | — | ✓ |
| **Multiple grow locations** | — | — | ✓ |

### Public REST API (verified against the live Swagger at `api.pulsegrow.com/swagger/v1/swagger.json`)
Base `https://api.pulsegrow.com`, auth header **`x-api-key`**, key self-issued in app: *Account settings → General Settings → API → "Add API Key"*. Deletion is irreversible. Quota is by **datapoints retrieved per day** per the table above; "an API call retrieving no data counts as one data point." Endpoints (all GET):

```
/all-devices                                  all devices + latest data (no hourly sparklines)
/devices/ids                                  device ids for the grow
/devices/details                              full details, all devices
/devices/{deviceId}/recent-data               most recent datapoint
/devices/{deviceId}/data-range                datapoints in a timespan
/devices/range                                all devices in a timespan  (MAX 7-DAY RANGE)
/hubs/ids  ·  /hubs/{hubId}
/sensors/ids  ·  /sensors/{sensorId}/details
/sensors/{sensorId}/recent-data
/sensors/{sensorId}/data-range
/sensors/{sensorId}/force-read                trigger an immediate read
/api/light-readings/{deviceId}                paginated, with spectrum data
/api/devices/{deviceId}/trigger-light-reading remote spectrometer trigger (Pro)
/api/timeline                                 timeline events, paginated + filterable
/api/triggered-thresholds                     currently-triggered alerts
/invitations                                  pending invites
/users                                        users + usage for the API key's grow
```
Note: **no write endpoints at all.** Pulse is monitoring-only; it cannot actuate. That is a real structural gap Terp Control (which owns the hardware) can exploit.

### App feature surface (verified from the "Ultimate Pulse User Guide")
Dashboard with **drag-and-drop ordering, filtering, hidden devices**; device view with rename, alert settings, threshold settings, advanced light readings; charts with **exports, chart sharing (public page), VPD guidance overlay, pinch-to-zoom**; device settings incl. calibration, **photoperiods**, hide-from-dashboard; **Journal**: create / edit / delete timestamped events and **filter your journal**; **Templates** (create + assign alert configs across devices); **Scheduled exports**; **Locations**; account theme (dark mode).

Their published UI overhaul added: gesture navigation (swipe between sections, pull-to-refresh), updated device icons, **Grow Zones** (group sensors into zones, consolidated view, *multiple sensors on a single graph*), **Batch & Phase tracking** (track batches seed→harvest, showing each batch's current day and growth phase), pinch-to-zoom on history, alerts that **save as you change them with an undo**, and device search by name/type.

### What users complain about
- iOS app has **too few ratings to even show a score** — a distribution/awareness problem, not a quality one. (Android ~4.60/76, secondary source.)
- Community wishlist/bug threads (fetched from `community.pulsegrow.com`): *"Custom graph Y axis min/max"*, *"5ghz wifi support"*, *"Permanently mounted visual screen for current hub data"*, *"Trending lines for VWC/PWEC/Bulk EC are broken"*, *"No CO2 readings in graph"*, *"App does not open, freezes on pulse icon"*, *"No way to change wifi?"*, *"Pulse Pro will not reconnect"* (twice), *"New Alert Type for Switching to battery power!"*.
- The **grow-cycle request** (thread `/t/grow-cycle-functionality/288`) is the tell: user asks to *"start a new grow cycle and gather the data by stage of the grow cycle i.e. seeding, veg etc."*, to view data *"as day 5 of veg"*, and to **delete previous grow cycles**. Staff (`peet`): *"good ideas, and on our roadmap."* — Pulse has since partly shipped this as Batch & Phase.
- **Pricing backlash** (thread `/t/enthusiast-plan-cost/559`): user `onizo` bought three devices and only afterwards discovered multi-user access costs *"$20/person on top of the retail price"*, having passed the return window — *the subscription was not disclosed on the product pages*. `slick5o` complained about losing free access to a year of history. Staff response: nothing previously free was paywalled; multi-user was new; existing customers got "lifetime 50% off". Note the workaround people use: **sharing one login** — which works but means no independent notifications.
- Hardware/app split: a Judge.me-sourced review notes the Pulse Pro hardware is great but *"the app feels sluggish and is glitchy on smartphones, particularly when using graphs"* (secondary, PLAUSIBLE).

**Verdict:** Pulse is the design bar for charts, alert templates, journaling, sharing, exports and API. Its weaknesses are (a) it can't control anything, (b) per-user pricing that growers resent and that punishes exactly the 2-person home grow, (c) 3-month retention on free.

---

## 5. VIVOSUN (GrowHub E42A/E42A+ + GrowCam) — the volume leader

- **4.74★ / 8,172 ratings** — 10× more ratings than AC Infinity on iOS. Ship cadence is extreme: 4.69.0 released 2026-08-21, and the review feed shows a new minor version roughly weekly.
- Feature set is the broadest in the consumer tier: real-time temp/RH/VPD, manual controls, **Grow Recipes** (pre-programmed stage-based settings by professional growers) and **"Grow Pilots"**, dual internal/external sensors, alerts, **Diary** (described by VIVOSUN as *"a combination of a To-Do list and data collection program"* — log plant height and other measurements, photos, notes), **community feed**, and **GrowCam C4** (2K QHD, timelapse to microSD, IR night vision, 2-way audio, 2.4 GHz only).
- Complaints `[App Store, verbatim]` cluster into four buckets:
  - **Cloud single point of failure**: 1★ *"502 gateway error — For a year it's been amazing. Everyone needs to know, **when their server goes down, you have zero access**"*; 3★ *"App down no way to access or change settings — The app crashed and when I try to hit contact support here it opens the app which doesn't work."*
  - **App/hub state divergence**: 1★ *"**App and Hub ruined my grow**"* — sync failure between app and hub left lights running **24/7 instead of 12/12**.
  - **Recipe/automation opacity**: 1★ *"Instructions — I need instructions and definitions for how to run a recipe. I'm tired of manual."*; 1★ *"Doesn't start on auto — I have no recipe and when I change the humidity to go to auto it still says off"*; 3★ *"There should be a **100% manual mode separate from recipe/pilot mode**"*; 5★ *"Please fix the recipe tab to edit these recipes settings **why is it so difficult**"*.
  - **Glanceability & accessibility**: 1★ *"**Widget Broken** — since the newest update the widget is not working, and non existent now"*; 3★ *"GUI challenge"* — small text that cannot be zoomed, **no dark mode**; 3★ *"Not all of us grow pot"* — no non-cannabis crop options.
- rollitup thread on the E42: humidifier *"stops and starts as it sees fit, has led to a few high humidity warning"*, set to 65% but reading 77%, device *"appears to spontaneously change its own settings"*; user migrated to an AC Infinity 69 Pro.

**Verdict:** VIVOSUN proves the market rewards *breadth + cadence + a diary + a camera + recipes*, even with mediocre reliability. Their 4.74★ is not a UX verdict; it is a distribution and review-solicitation verdict. But the feature checklist they've assembled is the consumer expectation baseline Terp Control will be measured against.

---

## 6. Mars Hydro (iGrow / "Mars Hydro" / "Mars Legacy") and Spider Farmer (GGS)

### Mars Hydro — **2.63★ (27)** for the new app, **1.30★ (71)** for Mars Legacy
The 1.30★ is one of the lowest ratings I have ever seen for a shipping first-party app. Verbatim:
- 1★ *"I just hope I can save my plants — Plants in veg and plants in flower and lights are doing whatever they want instead of connecting to the app… they worked fine with the old app but **I can't get them to connect with the new one and now I can't reconnect to the old app** and my harvest is at risk"* ← **migration between their own two apps stranded a live grow.**
- 1★ *"Absolute junk… **Every single time one of them updates, I lose some sort of functionality in one or both items.**"*
- 1★ *"Nothing works — App is buggy and lacks basic features, **can't show historical temperature and humidity data**, can't connect to any mars stuff like the iFresh inline fan, **can't program anything but lights**, and disconnects randomly multiple times a day."*
- 2★ *"The app works until it doesn't — for the first 30 days the app and devices worked like a charm. Then basically all the smart features stop working… **if you have plans to use the csv data, or develop an app around it, DONT, the CSV export once broken cannot be restored.**"*
- 3★ *"Some fixes needed for UX — **The devices you add to the app should be shown when you open the app.** Currently you open the app then have to scroll through the tabs to get to the Controller tab to see your controller."*
- 2★ *"Not very user friendly… Still **miles behind AC Infinity and VIVOSUN**."*
- 1★ *"Can't connect inline fan… **you have to have 2 separate apps** to control [lights and fan]"*

### Spider Farmer (GGS controller) — **3.13★ (121)**
The dominant, repeated, *specific* complaint is the most quotable finding in this whole document:
- 1★ *"**Push notifications** — …the most disappointing part is **the app does not push notifications to your iPhone. What's the point of the alarms if I have to have my app open to get them.** I suggest having secondary sensors in your grow tents if you value your plants."*
- 4★ *"**Make possible to get notifications on our phones not just controller**"*
- 4★ *"Good app but missing notifications — …I find myself really wishing there were push notifications for alerts."*
- 3★ *"Great app needs more — Add widgets and have the alerts from controller send push notifications."*

Other Spider Farmer complaints:
- Automation is crippled: 5★(!) *"Not sure why **time based automations can only be in 2hr blocks** and even at 2 hour blocks **you can only make them between 8am and 6pm**. I guess no one wants anything on between 6pm and 8am? **All the data is coming into the controller so it would be nice to have automation capabilities with temperature or humidity thresholds.**"*
- Charts: 1★ *"Terrible App — Very difficult to navigate, **useless trends**, and poorly defined terminology. Sad for such nice equipment"*; 1★ *"**Impressed…. Until unstable**"* asks for exactly two things: *"a feature to **overlay graphs of temp, humidity, and VPD** so I can see all at once and how they work together without having to switch between every tab"* and *"**24 hour historical data tab should be 24 hours and not reset at midnight**"*.
- 4★ user lost the environment-parameters-over-time screen: *"I love this feature but recently it stopped working… this is my favorite feature in the app"*.
- Units/i18n regressions: 2★ *"**No Fahrenheit** — The new update is nice but you failed to give us the option of switching temp readings to Fahrenheit… **Bring Fahrenheit back and I'll give 5 stars**"*.
- Connectivity/onboarding: 2★ *"**2.4gh only** … The app is useless if you're not using 2.4"*; 1★ *"Only works on a certain wifi frequency and **deletes saved setups**"*; 1★ *"Forced registration is a no go"*.
- Reliability with consequences: 1★ *"**Just use an outlet timer** — several times this app has made it to where my light won't come on, or go off, at the appropriate time."*

**Note the pattern in both brands:** near-zero of the 5★ reviews are about the app; they are about *customer service* ("Amazing customer service", "warranty claim with ease"). Strip the CS reviews out and Spider Farmer's app rating collapses.

---

## 7. Commercial tier: AROYA, Growlink, TrolMaster-commercial, Argus, Priva

### AROYA (Addium) — **3.68★ (28)**, SOLUS **3.00★ (4)**
- Positioning: substrate-first. TEROS ONE sensors, ~70M datapoints/day claimed, readings **every 3 minutes 24/7**, primary pore-water EC to 20 dS/m. Room outfit ≈ **$5,000**, financing from $10K. April 2026: shipped an AI "second brain" that surfaces patterns *without sending data to third-party platforms*.
- The single most instructive review in the entire research set `[App Store, verbatim, 1★]`: **"Refuse to update since 2025"** — a grower managing **350–400 TEROS sensors** stays on v1.13.038 because newer versions removed the ability to see device metrics (EC, light, VWC, temperature), scrambled device ordering, and dropped sensor status detail. *"Updates strip features rather than improve functionality."*
- Also 1★ *"New update makes the app unbearable to use on iPhone"*, 1★ *"The new update is absolutely horrible. Please put it back the way it was"*, 1★ *"I've wasted $500 on my SOLUS since I can't even login to this dumb app anymore."*
- Only 5★: *"Know what's going on at all facilities"* — multi-site visibility + human agronomist support is what they actually sell.

### Growlink — agentic/commercial, **web-first** (iOS app abandoned since 2016)
Verified pricing:
| Plan | Price | Users | Sensors | Copilot programs | Storage | Notes |
|---|---|---|---|---|---|---|
| Sprout (individual) | **$25/mo** | 1 | 16 | 4 | 1 year | API access, email+chat |
| Bloom (commercial) | **$250/mo per facility** | 3 | 32 | 16 | Unlimited | **30-second data resolution**, phone support, user permissions |
| Harvest (commercial) | **$1,000/mo per facility** | 20 | 100 | Unlimited | Unlimited | 24/7 phone, **99.90% SLA**, dedicated AM |

Add-ons: extra sensor $10/$8/$6, extra user $10/$15/$20, Copilot program $10 (Bloom), Nova AI credits $100/$80/$60 per 10K, Harvest/Cultivar Analytics $250/mo, phone support upgrade $150/mo (Sprout). Hardware separate (EC-3 = 8 SSRs, EC-6 = 16 SSRs; nutrient delivery systems from **$28,000**). There is also a **free-forever hobby plan**.
UI: **Live Dashboard** (feed event status: batch tanks, recipes, feeding zones, dosing, pH/EC stabilisation, water transfer) plus an **Event Queue Timeline** showing current / upcoming / historical events with flow totalizer, pH, EC, room, zone.
Alerting is the most mature I found: **"Enable Persistent, Repeating Notifications"** per sensor alert — repeats up to **7 times or until resolved**; **controller-offline notifications automatically repeat** because they are high priority by default; configurable per module.

### Argus Controls / Priva
Greenhouse-grade, integrator-sold, custom-configured, no public pricing, no consumer app story. I found **no verifiable user complaints about their UI** — only marketing copy. Anything you have heard about "dated Argus/Priva UIs" is **UNVERIFIED** from this research. They are not a competitive threat to a tent product; they matter only as a vocabulary source (strategies, setpoint groups, alarm classes).

---

## 8. The dead-cloud graveyard: Grobo, Seedo, Cloudponics, Leaf

- **Grobo** (Waterloo, ON) declared bankruptcy in **early 2022**; cloud-dependent boxes became inoperable; owners described the hardware as *"useless expensive"* devices once the app stopped. Last app update 2023-11-17; assets held by BDC; app expected to die when the server lease lapses. Forum threads with titles like *"Grobo app being terminated"*, *"Grobo going out of business"*, *"Is Grobo still working in 2024"*, *"Getting your Grobo back online"*.
- **Seedo** (Israel) filed for debt settlement with ~**$20.6M** of debt; servers went down, devices became unusable — after customers had waited **years** for delivery.
- **Cloudponics** and **Leaf** both went under.

**Why this matters for Terp Control:** every experienced grower in the addressable market has watched a cloud grow product brick itself. Any cloud-only architecture inherits that suspicion. The ILGM quote — *"you are giving away ownership of hardware now as well and also granting an access path into your home network"* — is the sentiment. This is a marketing *and* an architecture requirement: the device must keep growing plants correctly with the cloud dead, and you must say so loudly.

*(LeafLink is a B2B wholesale marketplace for licensed cannabis operators — not a grow controller. It is out of scope; if it appeared on the brief's list it was mis-categorised.)*

---

## 9. The DIY / techie fallback — the clearest statement of the unmet need

### `dwot/isley` — "Self-Hosted Cannabis Grow Journal with sensor tracking for AC Infinity Controllers and Ecowitt Soil Sensors" (~84 ★)
The author's stated motivation is the thesis of this entire document:

> *"every existing option was either **a phone app with a bad UX**, **a cloud service I didn't trust**, or **a spreadsheet held together with duct tape**."*

What he built, because nobody sells it: grow logs with **custom event types** (watering, feeding, activities), live + historical **sensor charts**, plant **photos with captions/overlays/watermarks**, **webcam snapshots via FFmpeg**, **seed/strain inventory**, **harvest records** (yield, dates, full cycle duration), configurable graphs — pulling AC Infinity temp/RH/**port speed** from their cloud API and Ecowitt soil sensors **locally with no cloud account**, plus a generic HTTP ingest for ESP32/Arduino/Home Assistant. Go + Docker, Postgres or SQLite, backup/restore, i18n, guest-access mode.

**Read the integration list again: he had to write his own app to see AC Infinity port state next to a feeding note.**

### Home Assistant
- `dalinicus/homeassistant-acinfinity` (cloud-polling): supports Controller 69 WiFi / 69 Pro / 69 Pro+ / AI+; **Bluetooth-only controllers (67, BT-mode 69) are unsupported because they never sync to the UIS cloud**; configurable polling with a **5-second minimum**; entity groups (Sensors / Controls / Settings) selectable, new controllers default to "Sensors Only".
- `vpdchart/vpdchart-card` — a dedicated VPD chart Lovelace card exists because no vendor app draws a proper VPD chart with leaf-temperature offset.
- `JakeTheRabbit/HAGR` — a production HA cannabis build: air *and* leaf VPD template sensors, CO2 with day/night setpoints + safety shutoff, **four-phase P0/P1/P2/P3 crop steering**, batch-tank auto-fill, Athena multi-part peristaltic dosing with post-dose pH/EC verification (Atlas Scientific), TEROS-12 SDI-12 substrate probes, M5Stack/ESPHome nodes, MLX90640 thermal. Its alerting design is the single best line in the research:
  > *"**One consolidated, severity-graded notification with mute and pause actions rather than spamming you per sensor.**"*
- HA community "Grow room control — share your knowledge" thread: growers combine AC Infinity, Bluelab Guardian, ESPHome 0–10 V dimming, Shelly/Tapo/Meross plugs, load cells for plant weight, ultrasonic reservoir levels. Recurring pain: no native support for grow-light brands, PWM→0-10 V conversion, unflashable proprietary hardware.

**Conclusion:** techies do not leave for "more features". They leave for **trust, one timeline, and alerts that respect them**.

---

## 10. Cross-cutting UX matrix

Legend: ✅ good · 🟡 present but weak · ❌ absent

| Capability | AC Infinity | TrolMaster TM+ Pro | Pulse | VIVOSUN | Mars Hydro | Spider Farmer | Growlink | AROYA | Inkbird/Govee/SwitchBot |
|---|---|---|---|---|---|---|---|---|---|
| **Multi-device at a glance** | ✅ one Devices page | 🟡 must re-select controller to refresh | ✅ drag-drop dashboard, filters, Grow Zones | ✅ | 🟡 devices buried behind tabs | 🟡 | ✅ Live Dashboard | 🟡 device ordering broke | ✅ |
| **Output/port state visible** | ✅ level + trend on tile (but often *wrong*) | ❌ "no indication ports are on" | n/a (no control) | 🟡 | 🟡 | 🟡 | ✅ | n/a | n/a |
| **Charts** | 🟡 fluctuation + distribution; temp/RH only; 5 fixed ranges | ❌ "horrid graphs", non-chronological timestamps | ✅ zoom, multi-sensor on one graph, share, VPD guidance | 🟡 per-metric tabs, resets at midnight | ❌ no history at all in some versions | ❌ "useless trends"; users beg for overlay | ✅ 30 s resolution (Bloom+) | 🟡 metrics removed by updates | 🟡 |
| **Setpoint band drawn on chart** | ❌ | ❌ | 🟡 VPD *guidance* only | ❌ | ❌ | ❌ | 🟡 | 🟡 | ❌ |
| **"Why did this happen"** | ✅ History Logs (device + rule + action + time) — **best in class** | 🟡 | 🟡 timeline API | ❌ | ❌ | ❌ | ✅ Event Queue Timeline | 🟡 | ❌ |
| **Scheduling flexibility** | ❌ 24 h cycles only; no every-2-days; no 2×/day pump | 🟡 buggy entry fields | n/a | 🟡 recipes, opaque | ❌ lights only | ❌ 2 h blocks, 08:00–18:00 only | ✅ | ✅ | 🟡 |
| **Alerts → phone** | ✅ push + alarms | ✅ push, "a little annoying" | ✅ push/email, SMS on paid, **templates** | ✅ | 🟡 | ❌ **no push at all** | ✅ persistent ×7, auto-repeat offline | ✅ | ✅ |
| **Alert quality (dedupe/severity/ack/snooze)** | ❌ | ❌ | 🟡 templates, no escalation documented | ❌ | ❌ | ❌ | ✅ closest to right | 🟡 | ❌ |
| **Multi-user / roles** | ❌ single "share access" toggle, WiFi-only | ❌ | 💰 $10/user, guests 1/3/∞, roles only at $35 | ❌ | ❌ | ❌ | 💰 1/3/20 users by tier | ✅ | ❌ |
| **Diary / journal** | ❌ **none** | 🟡 "Logbook" (new, unproven) | ✅ journal events + filter, Batch & Phase | ✅ Diary = to-do + measurements + photos | ❌ | ❌ | 🟡 | 🟡 | ❌ |
| **Journal events ON the chart** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 event timeline separate | ❌ | ❌ |
| **Camera / timelapse** | ✅ SPECTRON 3/7, $79.99+, microSD, **no sub** | 🟡 available | ❌ | ✅ GrowCam C4 2K, timelapse, microSD | ❌ | ❌ | 🟡 | 🟡 | ❌ |
| **Web app (not just phone)** | ❌ | ❌ | ✅ iOS/Android/PC/Mac | ❌ | ❌ | ❌ | ✅ web-first | ✅ | 🟡 |
| **Public API** | ❌ (HA integration reverse-engineers the cloud) | ❌ | ✅ documented + Swagger + self-serve keys | ❌ | ❌ | ❌ | ✅ all tiers | 🟡 | 🟡 Govee/SwitchBot have public APIs |
| **Works with cloud down** | 🟡 controller keeps running locally | 🟡 | 🟡 device buffers + syncs | ❌ 502 = zero access | ❌ | 🟡 | 🟡 | 🟡 | ✅ (SwitchBot 38 d local) |
| **Data retention** | undocumented | undocumented | **3 mo / 1 yr / ∞** by tier | undocumented | undocumented | undocumented | 1 yr / ∞ | ∞ | SwitchBot: 38 d local, 2 yr cloud |
| **Dark mode** | 🟡 | 🟡 | ✅ theme setting | ❌ complained about | 🟡 | 🟡 | ✅ | 🟡 | ✅ |
| **Home-screen widget** | ❌ broken "for months" | ❌ | 🟡 | ❌ broken since update | ❌ | ❌ requested | ❌ | ❌ | 🟡 Inkbird widget broke too |
| **Subscription** | **none** | none | $0/$10/$35 per user/mo | none | none | none | $25 → $1,000/mo | enterprise | none |

---

## 11. Complaint taxonomy, ranked by how often it appears verbatim

1. **The app lies about reality.** State shown ≠ state of the device. (AC Infinity: "will say a fan is running at 10 speed but the fan will not be running"; "shows devices as off when they are actually on"; VIVOSUN: hub/app divergence ran lights 24/7; TrolMaster: "doesn't update with real time readings", "doesn't even refresh unless I go back and select the controller".)
2. **Updates break or remove things.** (AC Infinity crash-on-launch across 2.0.4/2.0.5/2.0.7; Mars Hydro "every single time one of them updates, I lose some sort of functionality"; AROYA "Refuse to update since 2025"; Spider Farmer 5 separate 1★ reviews about a single update; VIVOSUN 4.59.1 "broke the app. I got IOT errors".)
3. **Alerts are either absent or noise.** (Spider Farmer: no push notifications at all, 4 reviews; TrolMaster: "notifications and offline alerts can be a little annoying"; Growlink is the only vendor with persistent/repeating semantics; HA users hand-build severity grading.)
4. **Scheduling can't express what growers actually do.** (24 h-only cycles; no every-other-day irrigation; no 2 pulses per photoperiod; no device-priority/interlock so the surge protector doesn't trip; 2 h blocks 08:00–18:00 only.)
5. **Charts don't answer questions.** Single-metric tabs, no overlay, no target band, midnight resets, non-chronological timestamps, no zoom, "horrid".
6. **Onboarding is a 2.4 GHz hazing ritual.** Forced SoftAP join, no manual SSID entry, 5 GHz phones, forced account creation, no Sign-in-with-Apple, email verification codes that fail.
7. **No journal, or a journal disconnected from data.** AC Infinity has none. Users keep a **clipboard** next to the controller. Grow with Jane user: *"The only thing I wish I had a journal for notes"* — even the journal app fails at notes.
8. **No multi-user, or multi-user as a paywall.** The two-person home grow is unserved everywhere. Pulse charges per user; everyone else says share your password.
9. **Cloud is a single point of failure and a trust problem.** 502 = no access; bankruptcies bricked three product lines; "logins to the motherships".
10. **Export is too coarse and omits actuator state.** *"I'd rather it improved data export at higher sampling rate and exporting the Port state of the Outlets."*

---

## 12. The single biggest unmet need

> **Nobody fuses the three things a grower needs into one object: what the environment did, what the machine did about it, and what the human did to the plants — on one timeline, with the target drawn on it.**

Every product owns exactly one third and is bad at the other two:

- **Controller apps** (AC Infinity, TrolMaster, Mars, Spider Farmer, VIVOSUN) own *machine state* and are hostile to *plant record-keeping*. AC Infinity has literally zero journal.
- **Monitoring apps** (Pulse, Inkbird, Govee, SwitchBot) own *environment* beautifully and **cannot actuate anything** — Pulse's entire public API is read-only.
- **Journal apps** (bud 4.61★/1,971; Grow with Jane 4.11★/341; Grow Guide 4.86★) own *human actions* and have **no live sensor data at all**.

The proof that this is the gap, not my opinion:
- A grower wrote and open-sourced **Isley** specifically to staple AC Infinity port data to a grow journal, saying every alternative was "a phone app with a bad UX, a cloud service I didn't trust, or a spreadsheet held together with duct tape."
- A grower on THCFarmer runs an AC Infinity controller for environment **and a physical clipboard** for watering and nutrients.
- Pulse's most-cited wishlist thread asks to see data **"as day 5 of veg"** — staff answered "on our roadmap"; Pulse then shipped Batch & Phase tracking, which is the closest anyone has come, and it still doesn't draw feed events on the chart.
- TrolMaster's own app marketing leads with "**all historical data in one graph**" and "**Logbook: track your plant stages**" — they know, and users say the execution is "horrid".
- Spider Farmer's users beg, in a 1★ review, for the ability to "**overlay graphs of temp, humidity, and VPD so I can see all at once and how they work together without having to switch between every tab**".

**The second, adjacent gap — and the one that converts distrust into loyalty — is honest state.** The most common complaint across every brand is that the app confidently displays a value that is not true. No competitor visibly distinguishes *live* from *last known at 14:02* from *device offline 40 min*. AC Infinity's History Logs is the only mechanism in the market that explains *why* an output changed, and it is buried in a tab, undated in the docs regarding retention, and user-deletable.

**Third gap: alerts that respect the human.** Spider Farmer has none. TrolMaster's are "annoying". Growlink is the only one with repeat-until-resolved semantics — and it is a $250/month commercial product. The best alert design in the entire research was written by a hobbyist for himself: *"one consolidated, severity-graded notification with mute and pause actions rather than spamming you per sensor."*

---

## 13. What Terp Control should own — concrete, in priority order

1. **One timeline, three lanes.** The chart *is* the diary. Sensor traces on top; a lane of **output state as filled bands** (light on, dehu ran, fan at 7); a lane of **human events** (feed, defoliate, transplant, flip to 12/12, pH, EC, runoff) as pinned markers. Tap any marker to see the readings at that instant; tap any output band to see **which rule fired and with what inputs**. Nobody in the market has this. Terp Control already stores diary entries, chart history and per-output state over MQTT — the assets exist; the *fusion view* is the product.
2. **Draw the setpoint band on the chart, and report time-in-band.** "You were inside your VPD target 71% of lights-on yesterday; the 3 excursions were all 20 min after the dehu hit its duty limit." No competitor does this. It converts a chart from decoration into a verdict.
3. **Day-of-stage as the primary x-axis option.** "Day 5 of veg", "Day 34 flower". Pulse users asked for it; Pulse half-shipped it; VIVOSUN's recipes imply it. Grow-relative time also makes **run-over-run comparison** possible ("this grow vs last grow at the same day"), which literally nobody offers and which is the killer feature for a repeat home grower.
4. **Never render a stale number as if it were live.** Every value carries an age. Offline is a first-class visual state, not a silent last-known reading. This directly answers complaint #1 across all five brands and is nearly free to implement.
5. **A single, severity-graded, deduplicated alert stream with acknowledge / snooze / mute-until, plus repeat-until-resolved for critical.** Copy Growlink's semantics (repeat up to 7×, auto-repeat for offline) and HAGR's consolidation. Do it at the free tier — Spider Farmer's users are *begging for push notifications at all*.
6. **Household multi-user, free.** Two people, one grow, both get their own login and their own notifications. Pulse charges $10/user for this and got a public backlash thread; everyone else says share the password. Owning "the grow partner works too" is cheap, differentiating, and impossible for AC Infinity to match without rearchitecting.
7. **Scheduling that expresses real horticulture.** Every-N-days irrigation, multiple pulses per photoperiod, offsets relative to lights-on/lights-off (not wall clock), stage-aware setpoint ramps, and device interlocks/priority ("never run heater and dehu together"). Each of these is a named, verbatim complaint about a shipping competitor.
8. **Export that includes actuator state, at the native sample rate.** One 4★ AC Infinity reviewer asked for precisely this. It costs nothing and wins the spreadsheet crowd.
9. **Camera as evidence on the timeline, not a novelty.** Terp Control already does 30 s stills and timelapses. Put the frame *inline on the chart* — scrub the timeline and the picture follows. "What did it look like when the VPD spiked at 03:00?" No competitor connects camera frames to sensor time.
10. **Say the cloud-death answer out loud.** Grobo/Seedo/Cloudponics/Leaf all bricked. Publish, on the product page, what the device does with the cloud unreachable and for how long it buffers. Combine with an open, documented read/write API (Pulse's is read-only; AC Infinity's has to be reverse-engineered) and a Home Assistant integration you ship yourself. That converts the most skeptical, highest-advocacy segment in the market — the people currently writing their own Go apps — into users.
11. **Web app parity.** Pulse, Growlink and AROYA have web; AC Infinity, TrolMaster, Mars, Spider Farmer and VIVOSUN are phone-only. Terp Control's Angular/Ionic stack already gives this for free — make it a marketing point, because "big screen, real charts, keyboard" is where growers actually analyse.
12. **Do not build a community feed.** TrolMaster and VIVOSUN both ship one; not a single review in ~200 read mentions it positively. It is table-stakes theatre that costs moderation forever.

### Price positioning implication
AC Infinity, VIVOSUN, Mars Hydro, Spider Farmer and TrolMaster all charge **zero** for app features. Pulse charges $10/user and took public flak for not disclosing it pre-purchase. **Any Terp Control subscription must therefore (a) be disclosed on the product page before purchase, (b) never gate alerts, control, or the ability to see your own current data, and (c) if it exists at all, gate long retention / unlimited history / API volume / commercial multi-site — exactly the axes Pulse and Growlink use.** The safest posture: free forever for one household and ~1 year of history; paid only above that.

---

## 14. Source list

App metadata & verbatim reviews (Apple public APIs):
- `https://itunes.apple.com/lookup?id=1481751004` (AC Infinity), `id=1619222131` (TM+ Pro), multi-lookup `6479227564,6476436750,1612237275`, searches for `vivosun`, `grow tent controller`, `grow journal cannabis`, `aroya`, `growlink`, `trolmaster`, `inkbird`, `govee home`, `ecowitt`
- `https://itunes.apple.com/us/rss/customerreviews/id=<1481751004|1619222131|6479227564|6476436750|1600813756|1486621692|1589369968|1467850558>/sortBy=mostRecent/json`

Vendor documentation:
- https://acinfinity.com/pages/app-programming/app-overview.html · /data-graphs-and-charts.html · /history-logs.html · /device-home-page.html · /account-page.html
- https://acinfinity.com/spectron-3-ai-powered-grow-camera-4k-advanced-plant-health-and-growth-monitoring/
- https://pulsegrow.com/ · https://pulsegrow.com/pages/pricing · https://pulsegrow.com/blogs/learn/ui-overhaul-feature-highlight
- https://support.pulsegrow.com/en/articles/5965784-pulse-api-access · /articles/6057307-ultimate-pulse-user-guide
- https://api.pulsegrow.com/swagger/v1/swagger.json (live OpenAPI spec) · https://api.pulsegrow.com/docs/index.html
- https://www.growlink.com/pages/pricing · https://www.growlink.com/persistent-sensor-and-offline-alerts (via knowledgebase.growlink.com 308)
- https://www.trolmaster.com/Products/Details/TCS-1
- https://vivosun.com/growing_guide/vivosun-app/

Community / forum / independent:
- https://community.pulsegrow.com/t/grow-cycle-functionality/288 · /t/enthusiast-plan-cost/559 · category listings
- https://community.home-assistant.io/t/grow-room-control-with-home-assistant-share-your-knowledge/721807
- https://github.com/dwot/isley · https://github.com/JakeTheRabbit/HAGR · https://github.com/dalinicus/homeassistant-acinfinity · https://github.com/vpdchart/vpdchart-card
- https://overgrow.com/t/ac-infinity-controller-69-issues-update/124475
- https://ilgmforum.com/t/ac-infinity-master-hack-work-with-any-app-like-home-assistant/107690
- https://www.rollitup.org/t/vivosun-growhub-smart-controller-e42.1095411/
- https://growlabreviews.com/ac-infinity-controller-ai-plus-review/ · https://happyhydro.com/blogs/gardening/ac-infinity-controller-ai-plus-review
- https://mobilesyrup.com/2022/03/31/canadian-made-cannabis-growing-device-company-grobo-declares-bankruptcy/ · https://www.calcalistech.com/ctech/articles/0,7340,L-3775772,00.html
- https://aroya.io/starterkit · https://us.switch-bot.com/products/switchbot-meter-pro-co2-monitor
