# Online grow-diary / grow-journal platforms — integration research for Terp Control

Research date: **2026-08-24**. All live probes were run on that date from this session.

## Evidence legend

Every claim below is tagged. Do not blur these.

| Tag | Meaning |
| --- | --- |
| **[VERIFIED]** | I hit the endpoint / read the page myself in this session. Reproducible command included. |
| **[DOCUMENTED]** | Official vendor documentation says so. |
| **[MARKETING]** | Vendor's own self-reported number. Not audited. |
| **[THIRD-PARTY]** | Analytics vendor or press. Estimate. |
| **[COMMUNITY-RE]** | Reverse-engineered by the community, no vendor blessing, can break any day. |
| **[UNVERIFIED]** | I could not confirm it. Treat as rumour. |

---

## 0. Headline

**There is no grow-diary platform with a public write API. Not one.** The two that matter (GrowDiaries, Grow with Jane) have no API, no OAuth, no import, no export, no webhooks, no Zapier/IFTTT/Make presence. The only documented, self-serve, two-way-capable APIs in the entire space belong to **forum software** (Discourse and XenForo 2.3) and to one **open-source hobby project** (SuperGreenLab) whose user base is negligible.

So "sync to grow diaries" is not an API project. It is an **export + assisted-publish + business-development** project, plus one genuinely buildable technical integration (Discourse/XenForo forums).

---

## 1. GrowDiaries (growdiaries.com) — biggest reach, hardest surface

### Size and audience

- **[MARKETING]** "over 350,000 enthusiasts", "over 90,000 grow diaries" (their own copy / Sensi Seeds writeup).
- **[THIRD-PARTY]** Similarweb, July 2026: **449.7K visits**, global rank **#77,820**, 6.53 pages/visit, avg. visit 3m54s, bounce 40.89%, 46.08% direct traffic.
- **[THIRD-PARTY]** Country split, July 2026: **US 26.29%, Germany 24.08%, UK 5.98%, Austria 5.26%, Lithuania 4.43%.**
  → **DACH is ~29.3% of GrowDiaries traffic.** For a German grow-controller company this is by far the most relevant diary audience on the planet. Category rank **#7 in Health > Addictions (Germany)**.
- **[VERIFIED]** A native Android app `com.growdiaries.droid` exists, "What's new" text reads *"Welcome to GrowDiaries — the first release!"*, **updated 5 Aug 2026**. Install count not yet displayed (i.e. very low / brand new). An older package `com.growdiaries.mobilelite` (v1.3.30) is floating around APK mirrors.
- **[COMMUNITY-RE]** On their own Q&A ("Developer question", grow-question 82201), growers state the old app was pulled and a new one was being built. So a mobile API exists and is under active development — a moving target.

### API

- **[VERIFIED]** No public/developer API, no docs, no OAuth. `https://en.seedfinder.eu`-style `/api` docs do not exist here.
- **[VERIFIED]** `robots.txt` contains `Disallow: /api` — i.e. an internal API lives under `growdiaries.com/api`.
  ```
  curl -A "Mozilla/5.0" https://growdiaries.com/robots.txt
  # User-Agent: *
  # Disallow: /external
  # Disallow: /redirect
  # Disallow: /api
  # ... Disallow: /posts/photo/*  (Googlebot)
  ```
- **[COMMUNITY-RE]** One internal endpoint is known from a public GitHub scraper (`QWERTY-Seba/modelo-wewewe/scrap.py`):
  ```
  GET https://growdiaries.com/api/v1/seeds/{seedId}/gallery?start={offset}&limit=20&sortable=week_update&tags=photo
  ```
  So the internal API is REST, versioned `v1`, resource-oriented (`/seeds/{id}/gallery`), offset+limit paginated, with `sortable` and `tags` filters. **This is reverse-engineered, undocumented and read-only-by-accident. It is not a contract.**
- **[VERIFIED]** Everything, including `/api/v1/...`, is behind a **Cloudflare JS interstitial**. Plain requests get the `Just a moment...` challenge page (Turnstile CSP visible), and `curl` on `/` returns HTTP 403:
  ```
  curl -A "Mozilla/5.0" "https://growdiaries.com/api/v1/seeds/1589/gallery?start=0&limit=5"
  # <title>Just a moment...</title> ... challenges.cloudflare.com
  ```
- **[COMMUNITY-RE]** The one serious public scraper, `ramenbased/gdscraper` (Go), does **not** use the JSON API at all — it drives `chromedp-undetected` (an anti-bot-evading headless Chrome) against the HTML pages and parses `div.info` blocks for "Room Type" and "Grow medium". That is the practical proof that the API path is closed.

### Terms of Service — an important correction

- **[VERIFIED]** Widely-repeated claim (it shows up in search-engine summaries) that GrowDiaries' ToS forbids *"any robot, spider, site search/retrieval application, or other automated device… to access, retrieve, scrape, or index"* is **NOT supported by their actual terms page.** I pulled the full text of `https://growdiaries.com/terms` (26,892 bytes) and it contains no anti-robot, anti-scraping, anti-crawl or anti-API clause. Its sections are: Interpretation, Acknowledgment, Placing Orders for Goods, Subscriptions, Promotions, User Accounts, Content, Copyright Policy, Intellectual Property, Feedback, Termination, Limitation of Liability, Governing Law, Disputes, EU Users, US provisions, Severability. It is TermsFeed-style boilerplate written for a shop, not a platform.
- **[VERIFIED]** `https://growdiaries.com/terms/privacy` returns **HTTP 404** — the URL that the circulating "GrowDiaries ToS" quote points at does not exist.
- **[VERIFIED]** Content licence clause that *does* exist (terms line 180): *"By posting Content to the Service, You grant Us the right and license to use, modify, publicly perform, publicly display, reproduce, and distribute such Content on and through the Service. You retain any and all of Your rights…"* — non-exclusive, so a grower keeps the right to also publish the same diary on Terp Control. Good for us.
- **Net legal read:** the *contractual* barrier is weaker than people assume, but the *technical* barrier (Cloudflare) is real, and circumventing an access-control measure is its own problem (DE § 202a StGB / US CFAA-flavoured risk). **Do not scrape and do not write.**

### Partner programme — it is advertising, not integration

- **[VERIFIED]** `growdiaries.com/partner` is a **media kit**, not a developer programme. Monthly banner-advertising plans:
  | Plan | Price |
  | --- | --- |
  | Platinum | **€3,699 / month** |
  | Gold | **€2,499 / month** |
  | Advanced | **€1,149 / month** |
  | Lite | **€599 / month** |
  Benefits listed: brand page, add products to the catalogue, "Official Rep" status, approve diaries, banner ads with UTM tracking, email pushes. **No API, no data access, no SSO.**
- **[VERIFIED]** FAQ: users cannot add breeders/nutrient brands themselves; brands must email `info@growdiaries.com` and are usually asked to seed 1–2 diaries first. Growers can use "Custom Breeder & Strain" free-text.

### Data model (this is the valuable part)

**[VERIFIED]** by reading a real diary (`/diaries/211997-...`, 11 weeks). GrowDiaries is **week-bucketed**, not event-bucketed.

*Diary-level setup:*
- Diary name; up to **8 strains** (breeder + strain from a fixed DB, or Custom Breeder & Strain)
- Room type: Indoor / Outdoor / Greenhouse
- Irrigation: manual / drip / hydroponic / aeroponic
- Grow medium as a **mix with percentages** (Coco Coir, Perlite, soil, vermiculite, rockwool, expanded clay), each entry brandable or "Custom"
- **Separate VEG and FLO lamps** (brand + model + wattage)
- Techniques with the week numbers they were applied in — e.g. `LST: weeks 2`, `Topping: weeks 2`, `Defoliation: weeks 3, 5, 7-8`
- Germination method (e.g. "Glass Of Water")

*Per-week entry fields* (phase = Germination / Vegetation / Flowering / Harvest):

| Field | Unit | Terp Control equivalent |
| --- | --- | --- |
| Height | cm | manual |
| Light Schedule | hrs | **derivable from `out_light` schedule** |
| Day Air Temp | °C | **sensor** |
| Night Air Temp | °C | **sensor** |
| Air Humidity | % | **sensor** |
| Solution Temp | °C | sensor (if fitted) |
| Substrate Temp | °C | sensor (if fitted) |
| pH | — | sensor / manual |
| EC | — | sensor / manual |
| PPM (TDS) | ppm | sensor / manual |
| Pot Size | litres | manual |
| Watering Volume | litres | manual / pump runtime |
| Lamp Distance | cm | manual |
| Smell | enum ("No Smell", …) | manual |
| Nutrients | list of catalogue products × **ml/l** | manual, from their fixed catalogue |
| Photos/videos | 1..n per week | **webcam / timelapse** |
| Likes / comments | social | — |

Harvest week adds wet/dry yield and the g/W/plant efficiency metric ("single-strain diaries recommended because g/w/p assumes one strain").

**Assessment: 11 of ~16 per-week numeric fields are things a Terp Control controller already measures or can derive.** This is the single strongest argument for building an export that targets GrowDiaries' exact field list.

### Verdict

| Question | Answer |
| --- | --- |
| Public API | **No** [VERIFIED] |
| OAuth | **No** [VERIFIED] |
| Import | **No** [VERIFIED — no mention in FAQ, journal posts or UI] |
| Export (CSV/JSON) | **No** [VERIFIED] |
| Webhooks | **No** |
| 2-way sync feasible | **No.** Not even 1-way push. |
| Realistic path | Assisted manual publish (pre-computed weekly numbers + photo bundle the grower pastes) **+ BD approach to `info@growdiaries.com`** |

---

## 2. Grow with Jane (growithjane.com) — app-first, explicitly anti-automation

### Size

- **[MARKETING]** "650,000+ active growers", "over 1 million growlogs" (homepage).
- **[VERIFIED]** Google Play `com.unlogical.jane`: **500K+ downloads**, **4.87K reviews**, last updated **19 May 2026**.
- **[THIRD-PARTY]** Similarweb, July 2026 (**web only** — the app is the real product): 37.8K visits, global rank #806,642. Countries: US 20.94%, **Germany 18.19%**, Brazil 16.33%, Argentina 6.72%, France 6.55%.
- **[UNVERIFIED]** Pro pricing quoted in secondary sources as **$7.49/month or $34.99/year**; another source says $17.99/month for a "full package". I could not verify against a first-party pricing page — the site does not publish one. Treat as approximate.
- **[VERIFIED]** Their community forum `social.growithjane.com` is **Discourse `2026.8.0-latest.1`**: 30,906 topics, 169,390 posts, 8,307 users, **162 active users / 30 days, 67 participating / 30 days**. The forum is much smaller and quieter than the app.

### Technical stack (useful, and a warning)

- **[VERIFIED]** Web app is **Next.js** (`/_next/static/chunks/...`), backed by **Firebase** — media served from `https://firebasestorage.googleapis.com/v0/b/jane-14027.appspot.com/o/{userUid}/thumb@480_img@{epochMs}.jpg?alt=media&token=...`. Firebase project id is `jane-14027`.
- Implication: the mobile app almost certainly talks Firestore/Firebase Auth directly. A "reverse-engineered write path" would mean impersonating their Firebase client. **[COMMUNITY-RE / do not do]**
- **[VERIFIED]** Public growlog URL shape: `https://growithjane.com/growlog/{slug}-{5charCode}` e.g. `/growlog/blue-zushi-sgerx`, `/growlog/ams-vwygf`. Locale prefixes `/de/`, `/es/`, `/pt/`. Explore index at `/explore`.
- **[VERIFIED]** June 2026 they shipped a web experience: public grower profiles, follow, comments, notifications, favourites, **charts and "Jane AI Summary"** on growlogs. Their own announcement states *"the full tracking tools still live in the app"* — and contains **no mention of API, export or integrations**.

### Terms of Service — explicitly forbids what we would need

**[VERIFIED]** quote from `https://growithjane.com/terms/`, §(c) Technological Restrictions, item (7):

> "Introduce software or automated agents or scripts to the Website or App so as to produce multiple accounts, generate automated searches, requests and queries, or to **strip, scrape, or mine data from the Website or the App**."

and §(d) Representations and Warranties, item (1):

> "Decompile, disassemble, reverse compile, reverse assemble, reverse translate or otherwise **reverse engineer any part of the Website or the App**…"

item (4): "Otherwise circumvent any functionality that controls access to or otherwise protects the Website or the App."

**This is unambiguous. Any scrape/sync integration with Grow with Jane is a ToS breach.** Unlike GrowDiaries, there is no grey area here.

### Data portability

- **[VERIFIED]** Privacy policy references GDPR rights including **the right to data portability** — but there is **no self-serve export UI**; it is a support request (`contact@growithjane.com`). For EU/German users this is a legitimate, lawful one-way *import into* Terp Control path: the user requests their own data and hands it to us. It is slow, manual, and unusable as a product feature at scale.
- **[UNVERIFIED]** No PDF/CSV export feature is documented anywhere I could find; "export online" in their marketing means "publish a public web growlog link".

### Data model

**[VERIFIED]** by reading a public growlog (Blue Zushi, 25 weeks, 144 photos):

- **Stages with day ranges:** `germination` (Day 1–3) → `seedling` (Day 4–10) → `vegetative` (Day 11–49) → `flowering` (Day 50–115) → `drying` (Day 116–124) → `curing` (Day 125+). Grow with Jane is **day-indexed**, GrowDiaries is week-indexed. Any exporter must handle both.
- **Environment object:** Name, Type (Indoor), **Size `70cm x 200cm x 140cm`**, Light Cycle (hours), Lights (`LED 400W`).
- **Medium object:** Type (Soil) + free-text Notes.
- **Charts (their chart menu, verbatim):** *Watering amount, Environment temperature, Humidity, Light distance, Average PPFD, VPD.* Units toggle metric/imperial. In the sample: 44 watering readings, 31–32 readings each for temperature, humidity, VPD, PPFD, light distance, 41 pH readings.
- **Action taxonomy observed:** Watering, Feeding, Transplant, Training, Topping, Defoliation, Trim, pH measurement, Note, Photo.
- **Jane AI Summary:** an LLM-written paragraph over the log.

**Note: Grow with Jane already charts VPD and PPFD.** That is exactly Terp Control's native data. They just have no way to get it in automatically.

### Verdict

| Question | Answer |
| --- | --- |
| Public API | **No** [VERIFIED] |
| OAuth | **No** [VERIFIED] |
| Import | **No** [VERIFIED] |
| Export | GDPR request only [VERIFIED]; no product feature |
| Webhooks | **No** |
| 2-way sync feasible | **No**, and explicitly prohibited by ToS |
| Realistic path | BD only. Their forum (Discourse) is the one automatable surface. |

---

## 3. SeedFinder (seedfinder.eu) — the API is DEAD

This one matters because a lot of stale blog content still tells you to use it.

- **[VERIFIED]** `https://en.seedfinder.eu/` states, verbatim: **"JSON Api — The JSON api has been discontinued per july 1st, 2024"**.
- **[VERIFIED]** The old endpoints now return HTTP 404 with a Laravel "Page not found" page:
  ```
  https://en.seedfinder.eu/api/json/search.json?q=amnesia   -> 404
  https://en.seedfinder.eu/api/json/ids.json                -> 404
  https://en.seedfinder.eu/api/json/strain.json?br=..&str=..-> 404
  https://en.seedfinder.eu/api  and  https://seedfinder.eu/en/api -> 404
  ```
  (The 404 page carries a joke line: *"If you are a cop or federal prosecutor, please check the url for spelling errors!"*)
- **[DOCUMENTED, historical]** The API that existed (from the GPL wrappers `hdb/seedfinder-python` and `bahaki/pystrain`):
  - Base: `https://en.seedfinder.eu/api/json/`
  - `search.json?q={strain}` — strain name search
  - `ids.json` — breeder id list
  - `strain.json?br={breederId}&str={strainId}&lng=en&parents=0|1&hybrids=0|1&medical=0|1&pics=0|1&comments=N&commlng=en&forums=a|b&reviews=0|1&tasting=1&smell=1&taste=1&effect=1`
  - `threadfinder.json` — forum threads about a strain
  - Auth: `&ac={apiKey}`, **plus** mandatory registration of a verified domain/IP even when using a token.
  - Licence: free, CC-licensed, required attribution + backlink to SeedFinder.
- **[VERIFIED]** The site has been rebuilt on Laravel + Vite (`/build/assets/app-*.css`). No replacement API is published.
- **Consequence for Terp Control:** there is **no free strain/genetics database API left**. Otreeba (`api.otreeba.com`) does not resolve at all [VERIFIED]. Leafly cut third-party API access back in 2016 [THIRD-PARTY]. If Terp Control wants strain autocomplete in a diary, it must ship its own seed list.

---

## 4. Forums — the only place a documented, self-serve API actually exists

### 4a. Discourse forums — best technical target

Two grow communities run Discourse:

| Site | Version | Topics | Posts | Users | Active/30d |
| --- | --- | --- | --- | --- | --- |
| `social.growithjane.com` [VERIFIED] | 2026.8.0-latest.1 | 30,906 | 169,390 | 8,307 | 162 |
| `www.autoflower.org` [VERIFIED] | 2026.8.0-latest.1 | 336 | 36,640 | 484 | 188 |

autoflower.org's shape (336 topics / 36,640 posts) is the classic *long-running grow-diary thread* pattern — ~109 posts per topic. Small but extremely engaged.

**⚠ `autoflower.net` is dead** — **[VERIFIED]** it 301-redirects to `https://bcsrt.com/`, the **BC Society of Respiratory Therapists** (a WordPress site). The domain has changed hands. Do not target it.

**Discourse capabilities [DOCUMENTED]:**
- Full REST API, documented at `docs.discourse.org`. Every page has a `.json` twin — **[VERIFIED]** `about.json`, `latest.json`, `search.json?q=...` all return JSON unauthenticated.
- **Admin API keys** with per-scope restriction (`Create and configure an API key`, `Use scoped API Keys`).
- **User API Keys** — a documented protocol for third-party apps to act *as a user*, without moderator involvement:
  - `GET https://{site}/user-api-key/new?application_name=&client_id=&scopes=&public_key=&nonce=&auth_redirect=[&push_url=][&padding=pkcs1|oaep]`
  - Scopes: `read, write, message_bus, push, one_time_password, notifications, session_info, bookmarks_calendar, user_status`
  - Response is an RSA-encrypted JSON payload (key + nonce + push + api version) returned to `auth_redirect`.
  - Consumed via headers **`User-Api-Key`** and optional `User-Api-Client-Id`.
  - **Rate limits: 50 requests/minute, 4,000/day** by default.
  - **Gating site settings** the forum admin controls: `allow_user_api_key_scopes`, `allowed_user_api_auth_redirects`, `user_api_key_allowed_groups` (default: admins, moderators, trust_level_0).
  - **Caveat, be honest about this:** `allowed_user_api_auth_redirects` must contain *our* redirect URL. So even the "self-serve" path needs **one admin email per forum**. It is one email, not a partnership contract — but it is not zero.
- **Webhooks**: built in (post created/edited, topic created, user events, etc.).
- **Global default rate limits** [VERIFIED from `config/discourse_defaults.conf`]: `max_reqs_per_ip_per_minute = 200`, `max_reqs_per_ip_per_10_seconds = 50`, `max_reqs_per_ip_mode = block`, `skip_per_ip_rate_limit_trust_level = 1`.
- **iPaaS**: **Make.com has a first-class Discourse app** [DOCUMENTED] — actions *Create a post, topic or private message; Get/Update/Delete a post or topic; List topics/posts/PMs; Make an API call*; plus webhook triggers (post created, notification, topic solved, tag changed, user actions…). Auth is an API key. **This is the only iPaaS route into any grow community that exists today.**

**This is where a real, buildable, two-way integration lives.** Terp Control could: create a diary topic, append a weekly post with charts and photos, read replies back into the app, and receive webhook events when someone comments.

### 4b. XenForo forums — documented REST API + OAuth2, verified live

| Site | Software | `/api/` probe | OAuth2 |
| --- | --- | --- | --- |
| `rollitup.org` | **[VERIFIED] XenForo 2.3** (`data-xf="2.3"`) | **[VERIFIED]** live, returns `{"errors":[{"code":"no_api_key_in_request"}]}` HTTP 400 | **[VERIFIED]** `/oauth2/authorize` renders XF login; `/api/oauth2/token` responds `required_input_missing: token` |
| `420magazine.com/community` | **[VERIFIED] XenForo 2.3** | **[VERIFIED]** live, same `no_api_key_in_request` | `/oauth2/authorize` → 403 (WAF), endpoint presumably present |
| `thcfarmer.com` | XenForo [UNVERIFIED — Cloudflare blocks fingerprinting] | **[VERIFIED]** Cloudflare `Just a moment...` interstitial on `/api/` | unknown |
| `icmag.com` | XenForo [UNVERIFIED — Cloudflare] | **[VERIFIED]** Cloudflare interstitial on `/api/` | unknown |

RollItUp scale [VERIFIED from forum index]: individual sub-forums with 2,360,795 / 1,827,409 / 1,544,168 / 1,303,275 messages — millions of posts, decades of grow journals.

**XenForo capabilities [DOCUMENTED]** (`xenforo.com/docs/dev/rest-api/`, `docs.xenforo.com/manual/configuration/api-keys`):
- REST API is a **core product feature since XF 2.1**. Keys are created in ACP → *Setup > Service providers > API keys*, with **per-scope grants** (`thread:read`, `thread:write`, …). **Users cannot generate their own keys.**
- "Super user" keys let an integration post *as* an arbitrary user or into a forum users normally can't post in — the documented pattern for "create a thread whenever you post a new article".
- **XF 2.3 (2024) added a full OAuth2 provider**: authorisation-code flow with **PKCE**, **refresh tokens**, per-application redirect URIs, user-visible *Account > Applications* list, and the access token used as the API key via `Authorization: Bearer <token>`.
- **Caveat:** the forum admin must register the OAuth client. Per-forum BD, one-time.

### 4c. Percy's Grow Room — dead end

- **[VERIFIED]** `percysgrowroom.com` runs **WordPress 7.0.4 + the wpForo plugin** (plus GeneratePress Pro, myCred, Wordfence, CleanTalk).
- **[VERIFIED]** `wp-json/` is open (HTTP 200) and exposes 21 namespaces: `oembed/1.0, one-time-login/v1, advanced-ads/v1, cleantalk-antispam/v1, cookieyes/v1, cky/v1, generatepress-pro/v1, mycred-*, redirection/v1, wordfence*/v1, yoast/v1, wp-dark-mode, wpforms/v1, wp/v2, wp-site-health/v1, wp-block-editor/v1, wp-abilities/v1`.
  **There is no `wpforo` namespace.** Forum content is not reachable through the REST API.
- **[DOCUMENTED]** wpForo's own support forum states REST API documentation "is not currently available" — wpForo has no REST API.
- Only route would be `wp/v2/posts` (blog posts, not forum topics) with an application password. Not worth it.

---

## 5. Hardware vendors' in-app journals

### TrolMaster

- **[DOCUMENTED]** The TM+ app has a **Logbook**: plant stages, date/time, environment + feeding parameters, plant info, room setup — plus a community page to follow growers and share logbooks. So TrolMaster is a *competitor* in the journal tier, not a sink.
- **[DOCUMENTED]** TrolMaster **API Gateway** exists (`trolmaster.com/News/ApiGateway`). Access by request form (name, TM+ account email, phone). **Subscription $15/month per device**, first billing 30 days after access is granted. Devices in the family: Hydro-X, Aqua-X, Carbon-X, Green-X, Tent-X.
- **[DOCUMENTED]** It is a **read-only sensor-data feed for third-party software**. Canix, Growlink and Trym all consume it for environmental-sensor reporting. Endpoint shapes, auth scheme and rate limits are **[UNVERIFIED]** — not published; you get them after approval.
- **Verdict for Terp Control:** not a diary sink. At most an inbound data source if a customer runs both, and paying $15/device/month to read a competitor's sensors makes no sense.

### AC Infinity

- **[VERIFIED — by absence]** No grow journal / diary / photo log in the app. The app is controller programming + environmental data + charts + (from 2026) an AI chatbot.
- **[DOCUMENTED]** The app can **export environmental data to a spreadsheet** (CSV). That is the realistic *inbound* path: a customer migrating from AC Infinity can import their env history into Terp Control.
- **[COMMUNITY-RE]** The cloud API is fully reverse-engineered by `dalinicus/homeassistant-acinfinity` (**198 stars**, actively maintained, GPL). Host and endpoints, verified from source:
  ```
  HOST = "http://www.acinfinityserver.com"        # note: plain http
  POST /api/user/appUserLogin        {"appEmail": ..., "appPasswordl": ...}   # sic, typo is theirs
       -> response.data.appId  (used as the auth token for later calls)
  GET  /api/user/devInfoListAll
  GET  /api/dev/getdevModeSettingList
  POST /api/dev/addDevMode
  POST /api/dev/modeAndSetting
  GET  /api/dev/getDevSetting
  POST /api/dev/updateAdvSetting
  ```
  Notable quirk documented in that client: **passwords longer than 25 characters are truncated**, because the official app does the same.
- **[VERIFIED — by absence]** No official AC Infinity developer docs, no OAuth, no webhooks.

### Pulse Grow — the model to copy

Not a diary, but the **best evidence of what a grow-hardware API should look like**, and the only grow-hardware vendor in this space with a properly published spec.

- **[VERIFIED]** OpenAPI **3.0.4** spec at `https://api.pulsegrow.com/swagger/v1/swagger.json`, Redoc UI at `https://api.pulsegrow.com/docs/index.html`.
- **[VERIFIED]** **19 endpoints, all GET** (read-only):
  ```
  /all-devices                         /devices/ids           /devices/details      /devices/range
  /devices/{deviceId}/recent-data      /devices/{deviceId}/data-range
  /hubs/ids                            /hubs/{hubId}          /invitations          /users
  /sensors/ids                         /sensors/{sensorId}/details
  /sensors/{sensorId}/recent-data      /sensors/{sensorId}/data-range   /sensors/{sensorId}/force-read
  /api/light-readings/{deviceId}       /api/devices/{deviceId}/trigger-light-reading
  /api/timeline                        /api/triggered-thresholds
  ```
- **[DOCUMENTED]** Auth: **`x-api-key` header**. Keys are generated by the user at `app.pulsegrow.com/account` and are **scoped per grow** ("only have access to that grow's resources").
- **[DOCUMENTED]** Quota is measured in **datapoints retrieved**, one call with no datapoints = 1 datapoint. Daily caps: **Hobbyist 4,800 / Enthusiast 24,000 / Professional 120,000**.
- **[DOCUMENTED]** Explicit "not all app functionality is exposed yet — email support and we'll add it".

### SuperGreenLab — the only genuinely 2-way-syncable grow diary in existence

Open-source (GPL-3) ESP32 controller + Flutter app, i.e. the closest structural analogue to Terp Control.

- **[VERIFIED]** Backend is live at `https://api2.supergreenlab.com` (websocket `wss://api2.supergreenlab.com`, media on `https://storage.supergreenlab.com`, backed by DigitalOcean Spaces `fra1` with presigned URLs).
- **[VERIFIED]** **Public read endpoints work with no auth at all**:
  ```
  curl "https://api2.supergreenlab.com/public/plants?limit=2"
  curl "https://api2.supergreenlab.com/public/plant/{uuid}"
  # also: /public/feedEntry/{id}, /public/feedEntry/{id}/feedMedias, /public/feedMedia/{id}
  ```
- **[VERIFIED]** Plant object shape: `{id, userID, name, thumbnailPath, lastUpdate, followed, nFollows, settings, boxSettings}` where `settings` is a JSON **string**:
  ```json
  {"medium":"COCO","strain":"Gorilla Runtz","isSingle":true,
   "products":[{"id":"04d5e44c-…","name":"Gorilla Runtz","specs":{"bank":"Seedsman"},
                "supplier":null,"categories":["SEED"]}]}
  ```
- **[COMMUNITY-RE / source-derived]** Write surface, read straight out of the GPL client (`lib/data/api/backend/feeds/feeds_api.dart`): `POST`/`PUT` on `/plant, /box, /feed, /feedEntry, /feedMedia, /device, /comment, /like, /follow, /bookmark, /report, /reports, /timelapse, /userend`. Auth is `Authorization: Bearer {jwt}`; the server rotates the token via an **`x-sgl-token`** response header which the client stores. `postPut` picks POST vs PUT by whether `obj['id']` is set.
- **[UNVERIFIED]** Project liveness. The app README says *"This application is not yet ready for end-user usage."* The backend is up and serving real 2026 data, but I could not confirm active development or user counts.
- **Verdict:** technically the *only* platform where full two-way sync is buildable today. Commercially near-worthless for reach. **Value = schema donor and reference implementation**, and possibly a friendly open-source partner.

---

## 6. Everything else, quickly

| Platform | Status |
| --- | --- |
| **GrowBuddy** (growbuddy.com) | **[VERIFIED] DEAD.** Domain does not resolve (NXDOMAIN, `getent hosts` empty, HTTP 000 on both apex and www). The "API | GrowBuddy" support page that still appears in search results is a ghost. |
| **Otreeba** open cannabis API | **[VERIFIED] DEAD.** `api.otreeba.com` does not connect. `otreeba.com` returns 200 but the API host is gone. |
| **Leafly** | No grow-diary feature. Third-party API access cut in 2016 [THIRD-PARTY]. Strain data only. |
| **Weedmaps** | `developer.weedmaps.com` exists [DOCUMENTED] — token-based auth, **listing menus and POS integration only**, no diary resource. Front page states: *"At this time, we are not onboarding new integrations"* (mail `integrations@weedmaps.com` to be kept on file). Closed. |
| **Bloombro** (`bloombro.com`, `com.codebeak.bloombro`, iOS `6504527011`) | Free grow journal, DE-localised ("Grow Tagebuch"). No API/export documented. [UNVERIFIED] |
| **PLNTRK** (`plntrk.com`) | Plant tracking with **QR codes and NFC tags**, not cannabis-specific. No public API found. [UNVERIFIED] |
| **Hempie** (`hempie.ai`) | 2025 entrant, conversational-AI cultivation assistant. No API found. [UNVERIFIED] |
| **bud — Grow Journal & Community** (`growbud.co`, iOS `1330612534`) | Mobile visual diary + community. No API found. [UNVERIFIED] |
| **EasyGrowing**, **Grow.Point**, **Grow Guide**, **MasterGrowbot**, **Growgoyle** | Small app-tier journals. None publish APIs. [UNVERIFIED] |
| **grower.ch** | Long-standing German-language forum with a `tagebuch` (diary) tag. Forum software fingerprint inconclusive from the outside. [UNVERIFIED] |
| **Trellis** | Dead (acquired by Akerna 2020, sold 2023, domain gone) — per a public competitive analysis. [THIRD-PARTY] |

---

## 7. EU / German-specific: Cannabis Social Club (Anbauvereinigung) tooling

- **[THIRD-PARTY]** As of August 2026 Germany has **455 licensed Anbauvereinigungen** with **896 applications submitted**.
- **[DOCUMENTED]** § 26 KCanG imposes a documentation / track-and-trace duty on cultivation associations — a genuine, legally-mandated record-keeping need that a controller could feed.
- **[VERIFIED via comparison site]** The CSC software market (14 vendors listed):
  | Vendor | Price | Hosting |
  | --- | --- | --- |
  | 420cloud | €1/month | DE |
  | Cannanas | €1/month | DE |
  | cannaflow | free | cloud |
  | CannaCash Solutions | free | on-prem |
  | Die Hanf-App | free | cloud/on-prem, DE |
  | Herb Hub | €12/month | DE |
  | HelloHanf | on request | **US servers** |
  | CannaDesk | on request | DE |
  | cannabees.cloud, 420MEMBERS, 420+ App, Cannabis Club Systems | n/a | mixed |
  **None of them documents an API, webhook or export interface.** Every one is member-management + point-of-sale.
- **[DOCUMENTED, vendor claim]** **Cannanas** is the exception in intent: *"Cannanas ist offen für Schnittstellen"* — they name scales, scanners, tills, accounting systems **and "Pflanzenmonitoring-Systeme" (plant monitoring systems)** as integration targets, and advertise seed-to-sale tracking with QR labels and one-click export of all documentation. **No public API docs though — it is a "call us" integration.** [UNVERIFIED as a technical capability]
- **Strategic read:** this is the highest-upside integration in Terp Control's home market and the only one where *we* would be the sought-after party (a licensed AV must document its cultivation; a controller that emits compliant records is a selling point). It is a BD conversation with Cannanas / 420cloud / Herb Hub, not an engineering ticket.

---

## 8. Is there an interchange standard? Zapier / IFTTT / Make? Webhooks?

**Interchange standard: NO. Nothing exists.**
- **[VERIFIED]** GitHub topic `grow-diary` has **4 repositories** total: `nark/magicbox` (46★, JS, "open indoor growing platform"), `nonsensicalthinking/planttracker` (19★, Android), `DanielEnki420/dwc-grower-edition` (3★), `rizkikh/Water-Reminder-desktop-app` (1★). No schema, no spec, no shared format.
- **[VERIFIED]** `JakeHartnell/Open-Plant-Schema` — the closest thing to a "plant + environment metadata" JSON schema — has **3 stars and 7 commits**, is USDA-derived horticulture data (drought tolerance, bloom time), has nothing to do with grow-diary events, and is inactive. Its README even notes *"schema.org currently doesn't have [a plant schema]"*. **Not a standard.**
- Nothing analogous to GPX (fitness), FIT (Garmin), OFX (finance) or ADAPT/ISOBUS (agronomy) exists for grow diaries. **If Terp Control publishes a clean JSON diary schema, it would be the first.** That is a real, cheap land-grab.

**Zapier: NO.** [VERIFIED] The Zapier directory has no cannabis grow-journal app. Searching returns only unrelated "Grow" products (Grow.com BI, Growform, Growby, GrowViral). Neither GrowDiaries nor Grow with Jane nor GrowBuddy is listed.

**IFTTT: NO.** [VERIFIED — by absence] No IFTTT service for any grow journal or grow-tent controller surfaced in any search.

**Make.com: YES, but only via Discourse.** [DOCUMENTED] The Discourse app on Make provides create/get/update/delete/list for posts, topics and PMs, an "Make an API call" escape hatch, and instant webhook triggers. This is the only turnkey automation route into any grow community.

**Webhooks:** Discourse ✅ (native). XenForo ✅ (via add-ons / your own listener; core has no outbound webhook UI — [UNVERIFIED] for 2.3). GrowDiaries ❌. Grow with Jane ❌. TrolMaster ❌. AC Infinity ❌. Pulse ❌ (pull-only).

**Community reverse-engineered docs that actually exist:**
1. `dalinicus/homeassistant-acinfinity` (198★) — AC Infinity cloud API, most complete RE work in this space.
2. `QWERTY-Seba/modelo-wewewe/scrap.py` — the single public GrowDiaries `/api/v1/` endpoint.
3. `ramenbased/gdscraper` — GrowDiaries HTML scraping via `chromedp-undetected`.
4. `supergreenlab/SuperGreenApp2` — not RE at all, it is the GPL source of a live client. The most useful of the four.
5. `hdb/seedfinder-python`, `bahaki/pystrain`, PyPI `seedfinder` — all now broken (API killed July 2024).
6. **[VERIFIED — negative]** No Postman collection, no RapidAPI listing, no unofficial API docs for GrowDiaries or Grow with Jane exist publicly.

---

## 9. Ranking: worth integrating first

### Tier 1 — build now

**1. "Publish anywhere" export (targets GrowDiaries first, everything else for free)**
Not a platform integration; a *format*. Generate, per grow-week: the exact GrowDiaries field set (day/night air temp, humidity, solution temp, substrate temp, pH, EC, PPM, light schedule hours, watering volume, lamp distance, pot size) computed from controller telemetry, plus a photo/timelapse bundle, plus a Markdown/BBCode block.
*Why first:* GrowDiaries has ~29% DACH traffic, 450K visits/month, and a per-week field list that a Terp Control controller already measures 11 of. It has no API and will not have one, so the only way to win that audience is to make manual publishing take 30 seconds instead of 7 minutes. Zero partner dependency, zero ToS risk, works on day one.

**2. Public Terp Control diary link (`terpcontrol.cloud/diary/<slug>-<code>`)**
Copy Grow with Jane's `/growlog/{slug}-{5char}` pattern. One shareable URL that renders charts, timelapse and week table. *Why:* it is the universal integration — it works in every forum, Discord, Reddit and Telegram on earth, needs nobody's permission, and turns every diary into inbound marketing. This is the highest ROI item in the entire list.

**3. Terp Control's own documented public API, Pulse-shaped**
`x-api-key` header, keys scoped per grow, quota measured in datapoints (Pulse's 4,800 / 24,000 / 120,000 daily tiers are a validated market precedent), OpenAPI spec + Redoc. Plus outbound webhooks so Make.com/n8n users can wire Terp Control → anywhere. *Why:* it costs little, it is the pattern the market already accepts, and it makes Terp Control the platform others integrate *to* — which matters more than integrating *out*, given that every outbound target is closed.

### Tier 2 — build second, real 2-way is possible here

**4. Discourse integration (autoflower.org, social.growithjane.com, any grow Discourse)**
The only documented, user-consented, self-serve, two-way-capable, webhook-equipped API in the space. User API Key flow, 50 req/min & 4,000/day, scopes `read,write`. Create a diary topic, append weekly posts, pull comments back in, react to webhooks. Caveat: each forum's admin must add our redirect to `allowed_user_api_auth_redirects` — one email per forum.

**5. XenForo 2.3 integration (rollitup.org, 420magazine.com)**
[VERIFIED] both run XF 2.3 with the REST API live and OAuth2 endpoints present. Millions of legacy grow journals. Auth: OAuth2 authorisation-code + PKCE + refresh tokens, `Authorization: Bearer`. Caveat: admin must register the OAuth client — a per-forum BD email, one-time. Ranks below Discourse only because Discourse's user-key flow is lighter and it has webhooks.

### Tier 3 — business development, not engineering

**6. German CSC / Anbauvereinigung software (Cannanas, 420cloud, Herb Hub)**
No API exists yet, but Cannanas publicly invites interfaces including plant-monitoring systems, § 26 KCanG creates a mandatory documentation need, and there are 455 licensed AVs. Highest strategic upside in the home market. Pure BD.

**7. GrowDiaries partnership**
`info@growdiaries.com`. Their partner programme is €599–€3,699/month **advertising** — no data access. Worth one exploratory email about a device-integration partnership; expect them to try to sell banners. Do not budget engineering against it.

**8. Grow with Jane partnership**
Second-largest audience, already charts VPD and PPFD (i.e. they want our data), but ToS forbids automation absolutely. BD only, and they are a partial competitor.

### Tier 4 — schema donor / curiosity

**9. SuperGreenLab** — the only true 2-way-syncable diary API, live and open, but negligible reach. Mine it for schema ideas; consider a friendly link-up.

### Do not build

**10. SeedFinder API** — dead since 1 July 2024, 404s confirmed today. Link out only; ship your own strain list.
**11. Percy's Grow Room / wpForo** — no REST API for forum content, confirmed by namespace enumeration and by wpForo's own support.
**12. Autoflower.net** — the domain now belongs to a respiratory-therapy society.
**13. GrowBuddy** — domain dead.
**14. Leafly / Weedmaps** — no diaries; Weedmaps is not onboarding.
**15. Any scraper or unofficial write path into GrowDiaries or Grow with Jane** — see risks.

---

## 10. Implications for Terp Control's product

1. **Rename the feature.** "Sync to grow diaries" is not achievable and will generate support tickets. Ship **"Export week"** / **"Share diary"**. Under-promise this precisely because the ecosystem is closed.
2. **Design the internal diary model as a superset of the two dominant models, and store both indices.** GrowDiaries is **week-bucketed**; Grow with Jane is **day-bucketed with named stages** (germination / seedling / vegetative / flowering / drying / curing). Store an absolute day counter *and* derive week buckets, or one of the two exports will be lossy forever.
3. **Make the per-week aggregate a first-class stored entity, not a chart query.** The exact 13 numeric fields GrowDiaries asks for (day air temp, night air temp, air humidity, solution temp, substrate temp, pH, EC, PPM/TDS, light schedule hours, watering volume L, pot size L, lamp distance cm, height cm) should be computed once per week and persisted. That table *is* the export.
4. **Chart VPD and average PPFD.** Grow with Jane already does both; it is now table stakes in the journal tier, and it is data Terp Control has natively and its competitors' journals must ask the user to type in.
5. **Ship BBCode and Markdown post generators with hot-linked image URLs.** XenForo and Discourse both render remote images. This turns "integrate with RollItUp / THCFarmer / ICMag / Percy's" — four platforms with no usable API between them — into one copy button.
6. **Publish a JSON grow-diary schema and call it what it is.** No interchange standard exists (verified: 4 repos under the GitHub topic, and the nearest candidate has 3 stars). First mover defines it, and it costs a documentation page.
7. **Photos and timelapse are the moat.** GrowDiaries' own diaries are photo-first (144 photos in the sample Grow with Jane log; GrowDiaries requires weekly photo updates). Terp Control's `run --camera` timelapse feeds this natively — nobody else's journal generates its own imagery.
8. **The nutrient model must be `product × ml/L`, matched to a catalogue.** GrowDiaries stores nutrients as catalogue-product + ml/l per week (e.g. Plagron Cocos A 2 ml/l). A free-text nutrient field will not export.
9. **Copy Pulse's API shape verbatim** for Terp Control's own API — `x-api-key`, per-grow keys, datapoint quotas. It is the only validated commercial precedent in this exact market.
10. **Germany first.** GrowDiaries DE+AT ≈ 29% of traffic; Grow with Jane DE 18%; 455 licensed Anbauvereinigungen; § 26 KCanG documentation duty. The German-language export/publish flow should be the one that ships first, not an afterthought translation.

---

## 11. Risks, blockers and things that look possible but are not

| Risk | Detail |
| --- | --- |
| **Grow with Jane ToS forbids automation outright** | Verbatim §(c)(7): *"…strip, scrape, or mine data from the Website or the App"*; §(d)(1) bans reverse engineering; §(d)(4) bans circumventing access controls. Any GwJ sync is a contract breach — and their backend is Firebase, so a write path means impersonating their Firebase client. **Hard no.** |
| **GrowDiaries is Cloudflare-hardened** | Verified: `Just a moment...` interstitial on `/` and `/api/v1/*`, 403 on plain requests. The only working public scraper uses `chromedp-undetected`. Circumventing an access-control measure carries § 202a StGB / CFAA-flavoured exposure regardless of what the ToS says, and gets *the customer's* account banned, not ours. |
| **The circulating "GrowDiaries prohibits robots and spiders" quote is wrong** | Their actual `/terms` page (26,892 bytes, read in full) has no such clause, and the URL the quote is attributed to (`/terms/privacy`) returns 404. Do not cite it in internal docs or to a lawyer — it will not survive checking. The real barrier is technical, not contractual. |
| **"GrowDiaries has an API" is half-true and dangerous** | `/api/v1/` exists (robots.txt + one scraper endpoint) but it is internal, undocumented, unversioned in practice, Cloudflare-gated, and they shipped a brand-new Android app on 5 Aug 2026 — meaning the API is actively churning. Anything built on it breaks. |
| **SeedFinder is a trap in every stale tutorial** | Dead since 1 July 2024, all endpoints 404. Every Python wrapper on PyPI/GitHub is broken. Budget for shipping our own strain list; there is no free replacement (Otreeba dead, Leafly closed). |
| **"Self-serve" forum APIs still need one admin email each** | Discourse User API Keys require the site's `allowed_user_api_auth_redirects` to include our redirect; XenForo requires the admin to create the API key or register the OAuth2 client. Neither is a signed partnership, but neither is zero-touch. Plan for a per-forum outreach list. |
| **THCFarmer and ICMag are opaque** | Both sit behind Cloudflare interstitials; I could not fingerprint the software or confirm the API is enabled. Assume XenForo, verify before promising anything. |
| **Autoflower.net and GrowBuddy are dead** | autoflower.net → BC Society of Respiratory Therapists; growbuddy.com → NXDOMAIN. Both still appear in "best grow apps" listicles. Do not put them on a roadmap slide. |
| **TrolMaster's API costs money and flows the wrong way** | $15/month **per device**, read-only sensor data, and it is a competitor's journal. There is no scenario where paying that to read a rival's sensors is right. |
| **Two-way sync has no precedent anywhere in this market** | Only SuperGreenLab is even technically capable, and nobody has shipped conflict resolution for grow diaries. If we promise 2-way, we are inventing the category *and* eating the merge-conflict UX. Scope it to one-way publish + read-back-comments (Discourse) for v1. |
| **Vendor user numbers are self-reported** | "350,000 enthusiasts / 90,000 diaries" (GrowDiaries) and "650,000 growers / 1M growlogs" (Grow with Jane) are marketing copy. The independently checkable figures are: GrowDiaries 449.7K web visits/month, Grow with Jane 500K+ Play installs and 4.87K reviews with only 162 monthly-active users on its own forum. Do not size a business case off the marketing numbers. |
| **Grow with Jane's web numbers understate it** | 37.8K visits vs GrowDiaries' 449.7K makes GwJ look 12× smaller, but GwJ is app-first (500K+ installs). Rank by audience, not by Similarweb, for that one. |

---

## 12. Reproducible probe commands

```sh
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# GrowDiaries: internal API disallowed, Cloudflare on everything
curl -A "$UA" https://growdiaries.com/robots.txt
curl -A "$UA" "https://growdiaries.com/api/v1/seeds/1589/gallery?start=0&limit=5"   # -> Just a moment...

# SeedFinder: API dead
curl -A "$UA" "https://en.seedfinder.eu/api/json/search.json?q=amnesia"             # -> 404 Laravel page
curl -sL -A "$UA" https://en.seedfinder.eu/ | grep -i "JSON api"                    # -> discontinued per july 1st, 2024

# XenForo REST API live, OAuth2 present (XF 2.3)
curl -A "$UA" https://rollitup.org/api/                     # {"errors":[{"code":"no_api_key_in_request"}]}
curl -A "$UA" https://www.420magazine.com/community/api/    # same
curl -sL -A "$UA" https://rollitup.org/oauth2/authorize | grep data-xf   # data-xf="2.3"
curl -sL -A "$UA" https://rollitup.org/api/oauth2/token     # required_input_missing: token

# Discourse grow forums
curl -A "$UA" https://social.growithjane.com/about.json
curl -A "$UA" -L https://www.autoflower.org/about.json

# Percy's: wpForo has no REST namespace
curl -A "$UA" https://percysgrowroom.com/wp-json/ | python3 -c "import json,sys;print(json.load(sys.stdin)['namespaces'])"

# Pulse Grow: real OpenAPI spec
curl https://api.pulsegrow.com/swagger/v1/swagger.json

# SuperGreenLab: public diary API, no auth
curl "https://api2.supergreenlab.com/public/plants?limit=2"

# Dead domains
getent hosts growbuddy.com          # empty
curl -o /dev/null -w "%{http_code} %{redirect_url}\n" https://autoflower.net/     # 301 -> https://bcsrt.com/
curl -o /dev/null -w "%{http_code}\n" https://api.otreeba.com/v1/strains          # 000
```

## Sources

- [GrowDiaries](https://growdiaries.com/) · [robots.txt](https://growdiaries.com/robots.txt) · [Terms](https://growdiaries.com/terms) · [FAQ](https://growdiaries.com/faq) · [Partner media kit](https://growdiaries.com/partner) · [Developer question thread](https://growdiaries.com/grow-questions/82201-developer-question) · [Play listing](https://play.google.com/store/apps/details?id=com.growdiaries.droid) · [Similarweb](https://www.similarweb.com/website/growdiaries.com/) · [Pevgrow manual](https://pevgrow.com/blog/en/growdiaries-manual/)
- [Grow with Jane](https://growithjane.com/) · [Terms](https://growithjane.com/terms/) · [Privacy](https://growithjane.com/privacy/) · [Sample growlog](https://growithjane.com/growlog/blue-zushi-sgerx) · [Community (Discourse)](https://social.growithjane.com/) · [New web experience](https://social.growithjane.com/t/meet-the-new-grow-with-jane-web-experience/71988) · [Play listing](https://play.google.com/store/apps/details?id=com.unlogical.jane) · [Similarweb](https://www.similarweb.com/website/growithjane.com/)
- [SeedFinder](https://en.seedfinder.eu/) · [hdb/seedfinder-python](https://github.com/hdb/seedfinder-python) · [ICMag "end of an age" thread](https://www.icmag.com/threads/seedfinder-end-of-an-age.18133414/)
- [XenForo REST API docs](https://xenforo.com/docs/dev/rest-api/) · [XenForo API keys](https://docs.xenforo.com/manual/configuration/api-keys) · [XF 2.3 OAuth2](https://xenforo.com/community/threads/single-sign-on-and-more-with-oauth2-in-xenforo-2-3.217519/) · [RollItUp](https://rollitup.org/) · [420 Magazine](https://www.420magazine.com/community/)
- [Discourse API docs](https://docs.discourse.org/) · [User API keys specification](https://meta.discourse.org/t/user-api-keys-specification/48536) · [API rate limits](https://meta.discourse.org/t/api-rate-limits/208405) · [discourse_defaults.conf](https://github.com/discourse/discourse/blob/main/config/discourse_defaults.conf) · [Make.com Discourse app](https://apps.make.com/discourse) · [autoflower.org](https://www.autoflower.org/)
- [Percys Grow Room](https://percysgrowroom.com/) · [wpForo REST API doc thread](https://wpforo.com/community/general-discussions/rest-api-doc/)
- [TrolMaster API Gateway](https://www.trolmaster.com/News/ApiGateway?class=Support) · [Trym: request TrolMaster API access](https://support.trym.io/en/articles/5339840-how-to-request-api-access-for-trolmaster-environmental-sensors)
- [AC Infinity](https://acinfinity.com/) · [dalinicus/homeassistant-acinfinity](https://github.com/dalinicus/homeassistant-acinfinity)
- [Pulse API docs](https://api.pulsegrow.com/docs/index.html) · [Pulse OpenAPI spec](https://api.pulsegrow.com/swagger/v1/swagger.json)
- [SuperGreenLab GitHub](https://github.com/supergreenlab) · [SuperGreenApp2](https://github.com/supergreenlab/SuperGreenApp2)
- [Weedmaps developer docs](https://developer.weedmaps.com/) · [Leafly API shutdown, 2016](https://www.newcannabisventures.com/leafly-api-cannabis-reports/) · [Otreeba (RapidAPI directory)](https://blog.rapidapi.com/directory/otreeba-open-cannabis/)
- [CSC-Software Vergleich (cbd-deal24)](https://cbd-deal24.de/ratgeber/csc/software/) · [Cannanas](https://cannanas.club/)
- [GitHub topic: grow-diary](https://github.com/topics/grow-diary) · [Open-Plant-Schema](https://github.com/JakeHartnell/Open-Plant-Schema) · [ramenbased/gdscraper](https://github.com/ramenbased/gdscraper)
