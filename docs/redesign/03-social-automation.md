# Automatic posting / social syndication for grow updates and timelapses

Research date: 2026-08-24. Target product: Terp Control (terpcontrol.cloud) — IoT grow controller +
Angular/Ionic webapp + Node/Express/MongoDB backend + ESP32/MQTT firmware.

Verification legend used throughout:
- **[P]** verified against the platform's own primary documentation during this research.
- **[S]** secondary sources only (blogs, aggregators, community). Treat numbers as indicative.
- **[U] UNVERIFIED** — could not confirm; stated as unknown, not as fact.

---

## 0. The one-paragraph answer

Every platform where a cannabis grow audience actually *is* (Instagram, TikTok, Reddit, Threads) either
bans the content outright or bans automated third-party posting of it, and the two that are technically
open (X, YouTube) now cost real money per post or require a compliance audit. The platforms that are free,
unreviewed and policy-safe (Discord webhooks, Telegram bots, Bluesky, Mastodon) are exactly the ones
Terp Control can reach today — and Discord/Telegram are already reachable with the alarm webhook code that
exists in the repo right now. Build **user-owned outbound destinations**, not **platform-owned social accounts**.

---

## 1. X / Twitter API v2

### 1.1 Pricing — this is the headline finding

From `https://docs.x.com/x-api/getting-started/pricing` and `https://docs.x.com/x-api/introduction` **[P]**:

> "pay-per-usage pricing" — "No subscriptions—pay only for what you use."

| Operation | Price **[P]** |
| --- | --- |
| Create a Post | **$0.015 per request** |
| **Create a Post containing a URL** | **$0.200 per request** |
| "Summoned post" | $0.010 per request |
| Read a Post | $0.005 per resource |
| Owned Reads (your own data) | $0.001 per resource |
| Cap | **3,000,000 Post reads per monthly billing cycle**; above that → Enterprise |

Credits are purchased up front in the Developer Console (`console.x.com`); requests are blocked at zero
balance **[S]**. X also gives back xAI API credits by cumulative monthly spend: $0–199 → 0%, $200–499 → 10%,
$500–999 → 15%, $1,000+ → 20% **[P]**.

**The $0.20 link surcharge is the decisive number for this product.** A "grow update" post that links back
to a Terp Control share page costs **13× more** than one that doesn't. Sample math:

- 500 users × 4 posts/month, **no link**: 2,000 × $0.015 = **$30/month**
- 500 users × 4 posts/month, **with a link back to terpcontrol.cloud**: 2,000 × $0.20 = **$400/month**
- 5,000 users × 8 posts/month with links: 40,000 × $0.20 = **$8,000/month**

If Terp Control ever ships X posting, it must either strip links by default or make the user bring their
own API credits.

### 1.2 Tier history (context, secondary)

**[S]** — consistent across many independent 2026 sources, but not confirmable on X's own docs, which now
only describe pay-per-use:
- Free tier closed to new signups ~**6 Feb 2026** when pay-per-use became the default.
- Legacy **Basic $200/mo** (50k posts / 15k reads) and **Pro $5,000/mo** (300k posts / 1M reads, full-archive
  search, filtered stream) closed to new signups; on ~**21 May 2026** X announced Basic deprecation with
  automatic, irreversible migration to pay-per-use starting after 1 June 2026.
- Enterprise starts ~$42,000/month.

Practical read: **a small product cannot get free X API access in 2026.** There is no "just post 500 times a
month for free" path any more.

### 1.3 Media upload

**[P]** `https://docs.x.com/x-api/media/introduction`:
- `POST https://api.x.com/2/media/upload` (simple, images only) and a chunked flow — endpoints
  `/2/media/upload/initialize`, `/2/media/upload/{id}/append`, `/2/media/upload/{id}/finalize`,
  `GET /2/media/upload?command=STATUS` **[S for exact paths]**.
- Size limits **[P]**: images **5 MB**, animated GIF **15 MB**, video **512 MB** with
  `media_category=amplify_video`.
- Returns `media_id`, attached at post-creation time.
- Legacy `upload.twitter.com/1.1/media/upload.json` still functions; X has stated intent to deprecate but
  **no sunset date announced** **[S]**.
- **[U] UNVERIFIED:** whether media-upload calls are separately billed under pay-per-use. The pricing page
  lists only post create / post read / user read. Assume they may be billed; budget for it.

### 1.4 Auth

**[P]** `https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code`:
- OAuth 2.0 Authorization Code **with PKCE**, user-context only.
- Authorize: `https://x.com/i/oauth2/authorize`; token exchange: `POST https://api.x.com/2/oauth2/token`.
- Authorization code lifetime **30 seconds**; access token **2 hours**; refresh tokens require the
  `offline.access` scope.
- Posting scope: **`tweet.write`** ("Tweet and Retweet for you").
- **[U]** exact scope name required for v2 media upload (`media.write`) not confirmed.

### 1.5 Developer Policy obligations that shape the UI

**[P]** `https://docs.x.com/developer-terms/policy`:
- Must obtain **"express and informed consent from people before … Taking any actions on their behalf"**,
  including posting.
- **Must show the user exactly what will be posted before publishing**, and disclose any geo-location data
  being attached. → *A preview-and-confirm screen is not a nicety; it is contractually required.*
- Bot accounts must be clearly identified (bio disclosure).
- Automation rules **[S]**: posting "duplicative or substantially similar content … over multiple accounts
  you control" is never allowed. A templated "Day 34 · 24.1 °C · 58 % RH · via Terp Control" broadcast from
  thousands of user accounts is *exactly* the pattern this rule targets. Any Terp Control template must be
  user-authored, not identical boilerplate.

### 1.6 Cannabis on X

X is **the most permissive mainstream platform**. It was the first major platform to expressly allow cannabis
advertising **[S]**. It maintains a Cannabis-THC Product Advertiser Attestation
(`business.x.com/en/help/ads-policies/ads-content-policies/drugs-and-drug-paraphernalia/cannabis-thc-advertiser-attestation`)
with licensing, jurisdiction, and 21+ targeting requirements **[S]**. Organic (non-ad) cannabis discussion
and grow content is broadly tolerated; the prohibition is on **promotion/sale** of drugs and paraphernalia
**[S]** (`help.x.com/en/rules-and-policies/illegal-regulated-behaviors` — returned 403 to automated fetch;
content is **[S]**).

**Verdict:** technically viable, policy-wise the safest of the big platforms, **economically the worst**.
Tier 3 at best, and only with links stripped or BYO-credentials.

---

## 2. Bluesky / AT Protocol — the best mainstream option

### 2.1 Cost

**Free.** No API keys, no developer portal, no application, no review queue, no per-post cost. This is not a
marketing claim — there is simply no billing surface in atproto.

### 2.2 Rate limits **[P]** — `https://bsky.network/docs/rate-limits` (note: `docs.bsky.app` now 301-redirects to `bsky.network/docs/*`)

Content write operations, **per account (DID)**:
- **5,000 points/hour and 35,000 points/day.**
- CREATE = 3 points, UPDATE = 2 points, DELETE = 1 point.
- → **1,666 record creations per hour, 11,666 per day.**

Hosted account (PDS) limits:
| Endpoint | Limit |
| --- | --- |
| All endpoints (per IP) | 3,000 per 5 minutes |
| `com.atproto.server.createSession` (per account) | **30 per 5 min, 300 per day** |
| `com.atproto.identity.updateHandle` (per account) | 10 per 5 min, 50 per day |
| `com.atproto.server.createAccount` (per IP) | 100 per 5 min |
| Blob upload max size (PDS level) | **52,428,800 bytes (50 MB)** |

The `createSession` limit (300/day per account) matters: **cache and reuse the session/refresh token**, do
not re-authenticate per post.

Relay limits (only relevant if Terp Control ever ran its own PDS): 50 events/s, 2,600/hour, 21,000/day;
100 accounts max, 5 created/second **[P]**.

### 2.3 Posting mechanics

- Post = `com.atproto.repo.createRecord` with `collection: app.bsky.feed.post`.
- Images/video = `com.atproto.repo.uploadBlob` → blob ref → `app.bsky.embed.images` / `app.bsky.embed.video`.
- App-level content limits **[S]**: **300 graphemes** of text; up to **4 images**; **1 video, 100 MB, 3 min,
  MP4**. Per-image cap historically 1 MB, reportedly raised to **2 MB on 23 Apr 2026** **[S/U]**. Reported
  daily video ceiling of 25 videos / 10 GB and email verification required for first video upload **[S/U]**.

### 2.4 Auth

- **App passwords** (format `xxxx-xxxx-xxxx-xxxx`) via `com.atproto.server.createSession`. **[P]**
  (`bluesky-social/atproto-ecosystem/app-passwords.md`): app passwords are **actively recommended and not
  deprecated**; they intentionally cannot delete the account or mint further app passwords. Third-party apps
  should validate the `xxxx-xxxx-xxxx-xxxx` shape so users don't paste their real password.
- **OAuth for atproto** exists and is intended to become the primary mechanism, *replacing app passwords over
  time* **[S/P-mixed]**. DPoP is **mandatory** (`dpop_bound_access_tokens: true`); client metadata is
  discovered/registered automatically because clients and PDSes are not pre-registered with each other.
  **[U]** no announced deprecation date for app passwords.

**Implementation advice:** ship app-password auth first (a text field, ~50 lines of code), design the token
store so an OAuth client can be swapped in later.

### 2.5 Cannabis on Bluesky

**[P]** `bsky.social/about/support/community-guidelines`, §4 "Follow the Rules":

> "Do not use Bluesky to unlawfully sell, advertise, provide services for, or facilitate commercial
> transactions for: Controlled substances, illegal drugs, prescription medications, or drug paraphernalia."

The prohibition is scoped to **unlawful commerce**. Non-commercial personal grow content is not prohibited.
Bluesky is also built around per-community moderation and labelers rather than one global algorithm, so
niche communities are structurally viable **[S]**.

**Verdict: build this. Best cost/risk/effort ratio of any real social network.**

---

## 3. Mastodon / Fediverse

### 3.1 Cost and access

Free. No central gatekeeper. Each instance is its own OAuth server; there is a **dynamic client registration**
path so an app can talk to an arbitrary instance without pre-arrangement **[P]** (`docs.joinmastodon.org/client/token/`):

1. `POST /api/v1/apps` with `client_name`, `redirect_uris`, `scopes`, `website` → returns `client_id` +
   `client_secret` ("should be cached for later use").
2. Standard OAuth authorize redirect → `POST /oauth/token`.
3. `Authorization: Bearer <access_token>`.

### 3.2 Posting

- `POST /api/v1/statuses`, scope **`write:statuses`**, with `media_ids[]`. If `media_ids` is provided,
  `status` text becomes optional and `poll` cannot be used **[S/P-mixed]**.
- Media: `POST /api/v2/media` (v1 legacy).

### 3.3 Rate limits **[P]** — `docs.joinmastodon.org/api/rate-limits/`

| Scope | Limit |
| --- | --- |
| All endpoints, per account | **300 requests / 5 minutes** |
| All endpoints, per IP | 300 requests / 5 minutes |
| `POST /api/v1/media` | 30 / 30 minutes |
| Delete or unreblog | 30 / 30 minutes |
| `POST /api/v1/accounts` | 5 / 30 minutes |

No documented daily post cap. Headers: `X-RateLimit-Limit`, `-Remaining`, `-Reset`; the most restrictive
applicable limit is reported.

Media size (stock defaults, instance-configurable) **[S]**: **16 MB image, 99 MB video/audio**.

### 3.4 Policy

The **Mastodon Server Covenant [P]** requires listed servers to: actively moderate against racism, sexism,
homophobia and transphobia; take daily backups; have more than one person with emergency server access; and
give **at least 3 months' notice before shutting down**. **It says nothing about drugs.** Cannabis policy is
therefore purely per-instance; cannabis-themed instances exist (e.g. "Stoners Social") **[S]**.

**Verdict: build, second after Bluesky.** Cheap, no review, but more integration surface (per-instance app
registration, per-instance limits, per-instance rules the user must read). Self-hosting a Terp Control
instance is possible but means becoming a moderation operator — do not.

---

## 4. Instagram Graph API — technically possible, practically a trap

### 4.1 What the API actually allows **[P]** (`developers.facebook.com/docs/instagram-platform/content-publishing`)

- Requires an **Instagram professional account** (Business or Creator). Personal accounts excluded.
- Rate limit: **"Instagram accounts are limited to 100 API-published posts within a 24-hour moving period."**
  Carousels count as a single post.
- Permissions: **Instagram Login** → `instagram_business_basic` + `instagram_business_content_publish`;
  **Facebook Login** → `instagram_basic` + `instagram_content_publish` + `pages_read_engagement`
  (+ `ads_management`, `ads_read` if the user holds a Page role).
- **Images must be JPEG only.**
- **"Media used in publishing attempts … must be hosted on a publicly accessible server."** → Terp Control
  would have to expose grow photos on a public, unauthenticated URL for Meta to fetch. That is a privacy
  problem for a cannabis product all by itself.
- Videos use resumable upload sessions; alt text supported since 24 Mar 2025.
- Page Publishing Authorization may be required before publishing.

**Documentation conflict [S]:** the `content_publishing_limit` **field reference still says 50** while the
content-publishing guide says 100 (and 50 in another section). Query
`GET /{ig-user-id}/content_publishing_limit` at runtime rather than hardcoding either. Separately a
Business-Use-Case limit of ~**200 API calls per user per hour** applies **[S]**.

Note: the **Instagram Basic Display API was shut down 4 Dec 2024**, replaced by "Instagram API with
Instagram Login" **[S]**. Anything you remember from before that date is wrong.

### 4.2 The review gate **[S]**

Advanced Access for `instagram_business_content_publish` requires **App Review + Business Verification + a
screencast**, one submission per permission. Reported 2026 turnaround: **~2–4 weeks, with Meta's review SLA
having roughly doubled from 10 to 20 days**; business verification frequently blocks submission for 10+ days.

### 4.3 Cannabis — this is where it dies

Meta Restricted Goods and Services / Regulated Goods **[S, quoted from Meta policy text via secondary sources
— the Transparency Center page could not be fetched in full]**:

> "We do not allow private individuals, manufacturers or retailers to buy, sell or trade non-medical drugs,
> pharmaceutical drugs and marijuana on Facebook and Instagram."

Do-not-post list includes:
> "Content that attempts to buy, sell, trade, donate or gift or asks for marijuana and products containing
> THC or related psychoactive components."

Allowed exception:
> "Business-related content posted by marijuana dispensaries where there are no attempts to buy, sell or
> trade marijuana …"

Meta's app-facing policy separately prohibits **"content that facilitates the real world sale of regulated
goods such as illegal or prescription drugs"** in Meta apps **[S]**.

Real-world enforcement **[S]**: state-legal cannabis operators widely report shadow bans, throttling and
outright page closures; a December policy expansion explicitly folding cannabis and cannabis-derived
products into "restricted goods and services" was followed by thousands of cannabis accounts going down.
(**[U]** I could not pin the exact year of that December update.) Meta's 2026 enforcement is described as
having shifted to proactive AI risk assessment, disabling accounts for "operational behaviors flagged as
high-risk" rather than only confirmed violations **[S]**.

### 4.4 Honest assessment

Two separate failure modes, either of which is fatal:
1. **App Review**: Terp Control would have to describe its use case to a Meta reviewer. The use case is
   "publish automated cannabis cultivation updates." There is no realistic version of that submission that
   gets Advanced Access. **[U]** I found no public case of a cannabis grow app obtaining
   `instagram_content_publish`; I also found no evidence any exist.
2. **User accounts**: even if approved, every user account posting automated grow photos carries a real,
   documented ban risk — and Terp Control would be the visible cause of the ban.

**Verdict: NEVER BUILD.** Not "later", not "behind a flag". The cost is weeks of review work with a near-zero
approval probability, and the success case actively harms users.

---

## 5. Threads API

- Permissions **[P]** (`developers.facebook.com/docs/threads/create-posts`): `threads_basic` +
  `threads_content_publish`. **"If your app has not been approved for advanced access for the
  `threads_content_publish` permission, you can only post to Threads for your account and your app's tester
  accounts."**
- Supports images, videos, text, carousels, quote posts, reposts. Eligible posts auto-share to the fediverse
  for users who enabled that.
- Rate limit **[S]**: **250 API-published posts per profile per 24-hour moving period**.
- `threads_share_to_instagram` scope added 25 Mar 2026 **[S]**.

Threads sits on the **same Meta policy surface and the same App Review queue** as Instagram. Everything in
§4.3–4.4 applies unchanged.

**Verdict: NEVER BUILD** (same reason as Instagram). The only interesting property is fediverse bridging —
which Mastodon gives you directly, for free, without Meta.

---

## 6. TikTok Content Posting API

Requirements **[P]** (`developers.tiktok.com/doc/content-posting-api-get-started/`):
- Registered app + Content Posting API product added + Direct Post configuration.
- **`video.publish` scope must be approved for the app**, and each user must authorize it.
- **"All content posted by unaudited clients will be restricted to private viewing mode."** Public visibility
  requires passing a TikTok audit of ToS compliance.
- Endpoints: `/v2/post/publish/video/init/` (FILE_UPLOAD or PULL_FROM_URL); photos via PULL_FROM_URL with a
  **verified domain / URL prefix**.

Cannabis **[S]** (`tiktok.com/community-guidelines/en/regulated-commercial-activities`): TikTok does not
allow "showing, possessing, or using drugs", nor trading/marketing/providing access to regulated goods.
Cannabis content is prohibited **even in jurisdictions where it is legal**; this explicitly includes content
depicting cultivation. Enforcement ranges from suppression to full bans.

**Verdict: NEVER BUILD.** The audit that unlocks public posting is an explicit ToS-compliance review, and
Terp Control's content category fails it by definition. Building it would ship a feature that silently posts
private-only videos.

---

## 7. YouTube Data API (timelapse video upload)

### 7.1 Quota — the documented numbers changed; the widely-cited ones are stale

**[P]** `developers.google.com/youtube/v3/determine_quota_cost`:
> New projects receive "a default quota allocation of 100 `search.list` calls, 100 `videos.insert` calls, and
> 10,000 units per day combined for all other endpoints."

and, for `videos.insert` and peers: "Each of these methods has a default daily limit of 100 per day. The
quota cost is 1 per call."

This supersedes the very widely repeated **"videos.insert costs 1,600 units"** figure **[S]** — that was the
old model where uploads drew from the shared 10,000-unit pool. Under the current model an upload costs 1 unit
against a **separate 100/day allowance**. Do not build capacity planning on the 1,600 number.

Other write costs **[P]**: captions/channels/comments/playlists/subscriptions 50 units; caption update 450;
watermarks/thumbnails/banners 50. Even invalid requests cost ≥1 unit.

### 7.2 Audit

**[P]** `developers.google.com/youtube/v3/guides/quota_and_compliance_audits`: quota beyond default requires
the "YouTube API Services – Audit and Quota Extension Form", demonstrating ToS compliance; re-submit for
further extensions within 12 months; failed audits go to an Appeals Form; YouTube runs periodic re-audits.

**[U] UNVERIFIED:** the widely repeated claim that **videos uploaded by an unverified/unaudited project are
locked to `private`**. It is not stated on the current quota-and-compliance-audits page. Historically this
applied to unverified OAuth clients. **Test it before promising public timelapse uploads.**

### 7.3 Cannabis on YouTube

More nuanced than the others. **[P]** `support.google.com/youtube/answer/9725604`:
- **September 2026** update: *"gaming and scripted content featuring the use, sale, and promotion of
  recreational drugs is now eligible to earn ad revenue"*; PSAs and non-glorifying educational content about
  drug trafficking organisations also became monetizable. (Previous baseline: Nov 2022, drug-use depictions
  such as joint smoking in gaming content were not monetizable.)
- For actual cannabis cultivation content **[S]**: explainers, strain/product reviews and documentary
  content stay up, but are typically **age-restricted** (invisible to signed-out and under-18 viewers),
  **usually demonetized**, and **suppressed in recommendations**. What gets a video *removed* is a sales
  pitch — purchase links, discount codes, facilitating a transaction.

**Verdict: Tier 3.** A timelapse upload feature is buildable and won't get users banned, but costs OAuth +
an audit + server-side video encoding, and the resulting videos are age-gated and demonetized. Do it only if
users explicitly ask for it. Meanwhile the *cheap* version of "share my timelapse" is a Terp Control share
link (which already exists) posted to Discord/Telegram.

---

## 8. Reddit API

### 8.1 Access and pricing

- Free non-commercial tier: **100 queries per minute per OAuth client ID** **[S]**.
- Commercial: reported at **~$12,000/month for up to 50 M calls, ~$0.24 per 1,000 requests beyond** **[S]**
  — Reddit does not publish this; treat as **UNVERIFIED**. Commercial use (including brand/social
  monitoring) does not qualify for the free path and routes through a sales process **[S]**.
- **Responsible Builder Policy** (`support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy`
  — the article exists; my fetcher got 403, so contents are **[S]**): introduced **November 2025**; gates all
  new API access behind manual approval; self-service OAuth app registration at `/prefs/apps` is closed for
  new apps. Stated principles include not misrepresenting how or why you access Reddit data (no multiple
  registrations for the same use case) and not circumventing access limits.

### 8.2 Cannabis + automation

- Sitewide policy bans cannabis **transactions** **[S]**.
- The thing that actually gets you removed is **per-subreddit self-promotion rules**, which large cannabis
  communities enforce strictly **[S]**. The folk "90/10 rule" (≤10% self-referential activity) is the
  community norm.
- Automated identical posts from thousands of accounts into r/microgrowery-type subs is the textbook
  definition of what those mod teams ban — and the blowback lands on the Terp Control brand, not on the
  individual user.

**Verdict: NEVER BUILD auto-posting to Reddit.** Manual "copy a formatted post to clipboard" is the maximum
defensible feature. The access queue alone (manual approval, opaque, with real rejection risk) makes it a bad
bet even before the community-norms problem.

---

## 9. Discord — build this first

### 9.1 Webhooks

**[P]** `docs.discord.com/developers/resources/webhook` (note: `discord.com/developers/docs/*` now
301-redirects to `docs.discord.com/developers/*`):

- `POST /webhooks/{webhook.id}/{webhook.token}`
- **No authentication required** — the token in the URL is the credential. No OAuth, no app, no review, no
  bot hosting, no gateway connection.
- Payload (at least one of): `content` (≤ **2000 characters**), `embeds` (up to **10**), `file`, `poll`.
- Optional: `username` and `avatar_url` per-message overrides (so posts can appear as "Tent 1" with the
  plant's photo as the avatar), `tts`, `allowed_mentions`, `components`.
- Files via `multipart/form-data` `files[n]` + `attachments` metadata.
- Query params: `?wait=true` (returns the created message), `?thread_id=` (post into a specific thread).

### 9.2 Rate limits **[S]** (not stated on the webhook resource page)

- **5 requests / 2 seconds per webhook.**
- **Per-channel bucket is shared** across all webhooks pointing at the same channel — two different webhooks
  in one channel do not get independent buckets (discord/discord-api-docs issue #6753).
- Global **50 requests/second** per IP/token.
- Also reported: ~30 requests / 60 seconds per webhook URL.
- Failed requests count against the limit the same as successful ones.

A grow-update feature posts on the order of once a day per device. This is three orders of magnitude below
any of these limits.

### 9.3 Attachments **[S]**

Free-tier upload limit **raised from 10 MB to 20 MB in August 2026**; Nitro Basic 50 MB; Nitro 500 MB. A
1080p tent snapshot fits comfortably; a long 1080p timelapse will not — post a share link for those.

### 9.4 Cannabis on Discord

**[S]** (`discord.com/safety/dangerous-regulated-goods-policy-explainer`, Community Guidelines, Discovery
Guidelines):
- Users "may not organize, promote, or engage in the buying, selling, or trading of dangerous and regulated
  goods"; the non-exhaustive list explicitly includes **marijuana**.
- **Discussion of legal, controlled substances is allowed in age-restricted spaces.**
- Servers that want to appear in **Discovery** may not have controlled-substance discussion at all.
- Enforcement ladder: warning → content removal → temporary suspension → permanent ban.

**Why this is low-risk for Terp Control:** the destination is a server the *user* chose, typically private or
age-gated, and the content is sensor data plus a plant photo, not a sale. Terp Control never holds a Discord
identity, never registers an app, and never appears in Discord's enforcement surface at all — the user pastes
a webhook URL that they can revoke in two clicks.

**Verdict: BUILD FIRST.** Zero cost, zero review, zero OAuth, zero rate-limit pressure, and grow communities
genuinely live on Discord.

---

## 10. Telegram — build this first, alongside Discord

### 10.1 Mechanics **[P]** (`core.telegram.org/bots/api`)

- `https://api.telegram.org/bot<token>/METHOD_NAME`; GET or POST; four parameter modes: URL query string,
  `application/x-www-form-urlencoded`, `application/json`, `multipart/form-data` (for uploads).
- Relevant methods: `sendMessage`, `sendPhoto`, `sendVideo`, `sendMediaGroup` (an album of up to 10 —
  perfect for a multi-angle grow update).
- Local Bot API server: downloads unlimited, **uploads up to 2000 MB**, local file paths via `file://` URI.
- Standard (cloud) server upload limits **[S]**: photo **10 MB via multipart, 5 MB via HTTP URL**; general
  bot file upload cap 50 MB.

### 10.2 Rate limits and fees

- **[P]** Telegram Bot Platform Developer ToS (`telegram.org/tos/bot-developers`): *"By default, bots can
  broadcast **30 messages per second** free of charge. Exceeding this threshold costs **0.1 Telegram Stars
  per message**."* (Also: enabling topics in private chats incurs a non-refundable 15% fee on Star purchases
  in that bot.)
- Community-derived, not officially published **[S]**: ~1 message/second per chat; ~**20 messages/minute per
  group**; 429 responses on breach; actual limits are dynamic and depend on bot age and history.

### 10.3 Policy **[P]** (Bot Platform Developer ToS)

- Bots must not *"provide, link to, aggregate, host, index, distribute, lend out, exchange, trade, rent, sell
  or facilitate the sale of illegal, pirated, regulated or questionable goods and services."*
- Bots must not *"harass or spam users with unsolicited messages."*
- Bots may not collect data *"aimed at creating large datasets, machine learning models and AI products, such
  as scraping public group or channel contents."*
- Must delete user data on request and when retention is no longer necessary.

Telegram's general ToS bans selling/offering illegal goods incl. drugs **[S]**. Enforcement volume is huge
(43.5 M channels/groups blocked in 2025; sustained 80k–140k daily takedowns in early 2026 **[S]**) but aimed
at criminal marketplaces, not at a grower's private channel of tent photos.

**Verdict: BUILD FIRST.** Pushing a photo + readings into the user's own channel is not "facilitating the sale
of regulated goods". Telegram is also the best *notification* channel of any platform here — instant, free,
image-capable, and a bot token is a single string the user pastes.

---

## 11. Matrix

- `PUT/POST /_matrix/client/v3/rooms/{roomId}/send/m.room.message` with `Authorization: Bearer <access_token>`;
  body `{"msgtype": "m.text", "body": "..."}`; server returns `event_id` **[S/P-mixed]**
  (`spec.matrix.org/latest/client-server-api/`).
- Media: upload → `mxc://` URI → `m.image` message.
- Rate limiting: `M_LIMIT_EXCEEDED` error with `retry_after_ms`; homeserver-configurable, no fixed public
  numbers **[S]**.
- Free, self-hostable, no policy gatekeeper at the protocol level.

**Verdict: do not build a first-party Matrix integration.** It is the same shape as Telegram with a fraction
of the grow audience. A **generic outbound webhook** covers it — every Matrix homeserver ecosystem has webhook
bridges (hookshot, webhook bots) that a technical user wires up in minutes.

---

## 12. Signal

- **No official bot API.** Signal deliberately does not offer one, prioritising privacy over third-party
  integrations **[S]**.
- Unofficial paths exist: `signal-cli`, `signal-cli-rest-api`, and gateway proxies **[S]**. All require a
  phone number registered as the sender and run outside Signal's support.
- Signal does not explicitly prohibit third-party clients in its ToS, but does not endorse them **[S]**.

**Verdict: NEVER BUILD as a first-party integration.** Shipping an unofficial-client dependency into a
production SaaS is an operational and reputational liability (number bans, breakage on every protocol
change). Document that a user who already runs `signal-cli-rest-api` can point the generic webhook at it.

---

## 13. Escape hatches: automation platforms and aggregators

| Option | Cost **[S]** | Notes |
| --- | --- | --- |
| **Plain outbound webhook** | **$0** | No policy surface, no rate limits, no vendor. Feeds everything below. |
| **n8n** (self-hosted) | $0 | HTTP Request node reaches any REST API; some community nodes are self-host-only. Users already run it next to Home Assistant. |
| **Make.com** | Core **$9/mo annual, 10,000 operations** | Every webhook trigger costs ≥1 credit plus downstream modules. Best value per operation. |
| **Zapier** | **Webhooks require Professional**: $19.99/mo annual ($29.99 monthly), **750 tasks/mo**; ladder to $3,389/mo for 2 M tasks | Webhooks in *and* out each count as tasks. Expensive per unit. |
| **IFTTT** | Webhooks require **Pro $2.99/mo (20 applets)** or **Pro+ $8.99/mo (unlimited)**; free tier has **no** webhooks | Trigger→action only; no branching, loops, or data transformation. |
| **Postiz** (AGPL-3.0, self-hostable) | $0 self-hosted; cloud from $29/mo | Covers X, Bluesky, Mastodon, Instagram, YouTube, LinkedIn, Reddit, TikTok, Facebook, Pinterest, Threads, Discord, Slack, Dribbble. ~29.6k GitHub stars. |
| **Ayrshare** (managed multi-platform posting API) | **$149/mo (1 profile)**, $299/mo (10), $599/mo (30), then **+$8.99/profile** | **Billed per social profile, not per post.** Economically impossible for consumer SaaS: 1,000 users each wanting their own account ≈ $9k/mo in marginal profile fees alone. Cannabis policy **[U] UNVERIFIED**. |

**Key strategic point:** a single well-designed outbound webhook makes Terp Control compatible with every row
in this table **for free**, and moves the entire platform-policy and platform-cost problem onto the user's
side of the boundary. That is the whole feature.

---

## 14. Cannabis content policy — the decision matrix

| Platform | Cannabis content policy | Ban risk for automated grow posting | Verdict |
| --- | --- | --- | --- |
| **X** | Most permissive mainstream platform; first to allow cannabis ads (licensed, 21+, legal jurisdictions). Organic grow content tolerated; sale/promotion prohibited. | **Low** on content; **medium** on *automation* (duplicate-content rule) | Tier 3, cost-blocked |
| **Bluesky** | Only *unlawful commerce* in controlled substances prohibited. Non-commercial content fine. | **Very low** | **Build** |
| **Mastodon** | No protocol-level policy. Server Covenant is silent on drugs. Purely per-instance; cannabis instances exist. | **Very low** (user picks instance) | **Build** |
| **Discord** | Marijuana listed under Dangerous & Regulated Goods — *buying/selling/trading* prohibited. Discussion of legal controlled substances allowed in age-restricted spaces. Discovery servers may not discuss it at all. | **Very low** (user's own server, Terp Control holds no identity) | **Build first** |
| **Telegram** | Bot ToS: no facilitating sale of illegal/regulated goods; no spam. Own-channel grow photos not a sale. | **Low** | **Build first** |
| **Matrix** | No platform policy (federated, self-hostable). | **None** | Via generic webhook |
| **YouTube** | Cultivation content: age-restricted, usually demonetized, recommendation-limited. Removal for sales pitches/purchase links. Sept 2026 loosened monetization for *scripted/gaming* drug content. | **Low removal, high suppression** | Tier 3 |
| **Instagram** | Marijuana/THC transaction content prohibited outright; app policy bans facilitating real-world sale of regulated goods. Documented mass shadowbans and page closures of state-legal operators. | **High** — and Terp Control would be the visible cause | **NEVER** |
| **Threads** | Same Meta policy surface, same App Review queue. | **High** | **NEVER** |
| **TikTok** | Prohibits showing/possessing/using drugs and depicting cultivation, **even where legal**. Unaudited API clients post private-only. | **High** | **NEVER** |
| **Reddit** | Sitewide bans transactions; subreddit self-promo rules are the real gate and are strictly enforced. Access itself gated behind manual approval since Nov 2025. | **High** (user bans + brand blacklisting) | **NEVER** |
| **Signal** | No bot API at all. | n/a | **NEVER** |

### The structural insight

Notice the pattern: **the platforms with strict cannabis policies are exactly the platforms that require app
review**, and the platforms with permissive policies are exactly the ones with no gatekeeper. That is not a
coincidence — the review process *is* the enforcement mechanism. So there is no configuration where Terp
Control gets Instagram/TikTok/Threads access "carefully". The gate and the ban are the same gate.

### The asymmetry that should drive the decision

If Terp Control posts to Discord/Telegram/Bluesky/Mastodon and something goes wrong, the user revokes a
webhook. If Terp Control posts to Instagram and something goes wrong, **the user loses their Instagram
account** — often with no appeal — and the proximate cause was a Terp Control feature they enabled. There is
no revenue that justifies that trade.

---

## 15. Legal layer: Germany (§ 6 KCanG)

Terp Control appears to be German (repo contains `TriAC-FIX.de.md`; German is a first-class UI language).
Germany legalized home cultivation with the **CanG/KCanG in force since 1 April 2024** **[S]**: adults may
grow **up to 3 living cannabis plants** at their residence, possess 25 g in public / 50 g at home. Cuttings
and seedlings count as plants.

**§ 6 KCanG — Allgemeines Werbe- und Sponsoringverbot** **[S]** (buzer.de and lxgesetze.de both 403'd my
fetcher; text below is from consistent secondary legal sources):

> "Werbung und jede Form des Sponsorings für Cannabis und für Anbauvereinigungen sind verboten."

- Applies comprehensively: posters, **social media ads, paid influencer cooperations**, sponsorship,
  merchandise, events **[S]**.
- Fines up to **€30,000** **[S]**.
- Berlin cannabis clubs reportedly shut down their social channels entirely over this **[S]**.
- Factual product information without advertising intent (own website, member newsletters, editorial
  content) remains permissible **[S]**.
- Grow equipment/accessories: **not directly covered** — §6 names *cannabis* and *Anbauvereinigungen*. But
  advertising for seeds/equipment risks being read as **indirect cannabis advertising**, especially where it
  emphasises consumption or yield **[S]**. **[U]** no court ruling squarely on grow-shop accessory
  advertising under §6 was found.

**Concrete design consequence:** an auto-appended "🌱 Powered by Terp Control · terpcontrol.cloud" footer on
thousands of German users' cannabis grow posts is the single riskiest string in the whole feature. It
converts user content into arguably-sponsored cannabis-adjacent promotion, at scale, with Terp Control named
as the beneficiary. **Do not add branding to user posts by default.** Make it an off-by-default checkbox at
most, and consider suppressing it entirely for DE users. *(Not legal advice — get counsel before shipping
any branded footer.)*

Also note **FTC** exposure in the US **[S]**: implying cannabis treats anxiety, depression, insomnia or pain
is a violation, and a tagged brand owns that claim. Another reason auto-generated caption text should never
editorialize about the plant — sensor readings only.

---

## 16. App store exposure (secondary, but it constrains the roadmap)

- **Apple**, guideline 1.4.3 **[S]**: apps that *encourage consumption of illegal drugs* are not permitted;
  facilitating sale of controlled substances is prohibited except licensed pharmacies and licensed/legal
  cannabis dispensaries (relaxed June 2021, geo-fenced to legal jurisdictions).
- **Google Play**, Illegal Activities policy **[P]** (`support.google.com/googleplay/android-developer/answer/9878877`),
  not allowed: *"Facilitating the sale or purchase of illegal drugs."* · *"Depicting or encouraging the use or
  sale of drugs, alcohol, or tobacco by minors."* · **"Instructions for growing or manufacturing illegal
  drugs."** Play separately prohibits arranging marijuana delivery/pickup and facilitating sale of THC
  products incl. THC-containing CBD oils **[S]**.

Grow journals demonstrably ship on both stores (Grow with Jane, Bud – Grow Journal & Community, Grow Guide)
**[S]**, so the category is viable. But "automatically publishes cannabis cultivation content to social
networks" is not a phrase that improves any store-review narrative. Keep the feature framed as
**"send my environment data to a destination I control"**, not **"post my weed to social media."**

---

## 17. What Terp Control already has (repo grounding)

This materially changes the build estimate — **most of Tier 1 already exists.**

**`/home/user/terpcontrol.cloud/server/src/utils/webhookTemplate.ts`** (30 lines): `{{placeholder}}`
substitution with two modes — `'json'` (values escaped so substitution inside a JSON string literal can never
produce invalid JSON) and `'url'` (`encodeURIComponent`). Strings without `{{` pass through untouched;
unknown placeholders resolve to empty string.

**`/home/user/terpcontrol.cloud/server/src/services/alarm.service.ts`** → `handleWebhookAlarm()`:
- Configurable method (`GET` / `POST` / `PUT`), custom headers, separate triggered/resolved payloads.
- Template vars already available: `deviceId`, `deviceName`, `sensorType`, `value`, `upperThreshold`,
  `lowerThreshold`, `event`, `timestamp`, `alarmName`, `alarmId`, `extremeValue`.
- `reportWebhookErrors` writes a device log entry on failure (`message-alarm-webhook-error`).
- `tunnelWebhook` routes through `tunnelService.createTunnelProxyServer()`.

**`/home/user/terpcontrol.cloud/server/src/models/device.model.ts`**, `alarms[]` subdocument:
`actionType: ['email' | 'webhook' | 'info']`, `actionTarget`, `webhookMethod`, `webhookHeaders`,
`webhookTriggeredPayload`, `webhookResolvedPayload`, `reportWebhookErrors`, `tunnelWebhook`.

**`/home/user/terpcontrol.cloud/server/src/routes/share.route.ts`** + `share.controller.ts`: share links with
a public `GET /share/resolve/:share_id` endpoint and an open counter. **Public sharing already exists.**

**`/home/user/terpcontrol.cloud/server/src/routes/auth.route.ts`**: `POST /auth/demologin` — read-only demo
session over devices flagged as demo, with credentials, stream URLs and alarm targets stripped.

**Timelapse/camera:** `server/src/services/image.service.ts`, `okam-cam.service.ts`, `okam-p2p.service.ts`,
`controllers/image.controller.ts`, `routes/image.route.ts`, and `webapp/src/app/device/charts/charts.page.*`
(camera view + timelapse UI).

### The immediate, zero-code consequence

**Discord and Telegram are already reachable today** with the existing alarm webhook:

- Discord: `actionType: 'webhook'`, `actionTarget` = the channel's webhook URL, method `POST`, payload
  `{"content": "{{deviceName}}: {{sensorType}} = {{value}}"}`.
- Telegram: method `GET`, `actionTarget` =
  `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>&text={{deviceName}}%20{{sensorType}}%20{{value}}`
  — the `'url'` mode of `applyWebhookTemplate` already `encodeURIComponent`s the substituted values.

What is missing is not transport. It is: **(a)** a non-alarm trigger (manual button / schedule / diary event /
phase change / harvest), **(b)** image attachment, and **(c)** a preset library so users don't hand-write JSON.

---

## 18. Recommended tiering

### Tier 0 — ship this week, no backend code

Document the Discord and Telegram recipes for the existing alarm webhook (README or in-app help), and add
two one-click **presets** in the alarm webhook editor that prefill method + payload. Cost: a form field and
some copy. This alone covers most of what users mean by "notify my grow community".

### Tier 1 — build first: "Update destinations"

Generalize the alarm webhook into a **device-level destination** decoupled from alarms.

- **Destination types:** Discord webhook URL · Telegram bot token + chat_id · **Generic webhook** (templated
  JSON/URL, custom headers, GET/POST/PUT — reuse `webhookTemplate.ts` verbatim).
- **Triggers:** manual "Post update" button · schedule (daily/weekly at a chosen time) · diary entry created
  · grow phase change · harvest · existing alarms.
- **Payload:** latest camera snapshot (multipart for Discord, `sendPhoto` for Telegram) + a user-chosen set
  of metrics + optional share link (reuse `share.route.ts`) + user-authored caption template.
- **Reuse:** `applyWebhookTemplate` for both modes; `reportWebhookErrors`-style device-log entries for
  delivery failures — users must be able to see *why* a post didn't land.

Why first: **zero cost, zero OAuth, zero app review, zero platform-policy exposure for Terp Control**, and it
transitively unlocks n8n, Make, Zapier, IFTTT, Home Assistant, ntfy, Matrix bridges and Postiz.

### Tier 2 — build if users ask: Bluesky, then Mastodon

- **Bluesky:** app password field → `createSession` (cache the session, 300 createSession/day cap) →
  `uploadBlob` → `createRecord` on `app.bsky.feed.post`. Free, permissive, image + video. Design the token
  store so atproto OAuth can replace app passwords later.
- **Mastodon:** instance URL field → `POST /api/v1/apps` (dynamic registration) → OAuth authorize →
  `write:statuses`. Free, but per-instance limits and per-instance rules; surface the instance's rules link
  before the first post.

### Tier 3 — only with a proven business case

- **X:** BYO-credentials only (user pastes their own OAuth app / credits), or Terp Control eats
  $0.015–$0.20/post. Strip links by default. Mandatory preview-and-confirm (contractual). Never send
  identical boilerplate across accounts.
- **YouTube timelapse upload:** OAuth + audit + server-side encoding + 100 uploads/day project cap.
  **Verify the private-lock behaviour for unaudited projects before promising public uploads.**

### Never build

**Instagram · Threads · TikTok · Reddit auto-post · Facebook · Signal.**

For each: the access gate is a human policy review that cannabis grow content fails by construction, and the
failure mode lands on the *user's* account, not on Terp Control's. Instead offer **"copy formatted post to
clipboard"** + a share link — the user pastes it manually, owns the decision, and the platform sees a human.

---

## 19. What the feature should actually look like

1. **Name it neutrally.** "Update destinations" / "Grow updates", not "Social sharing". This matters for
   Google Play ("instructions for growing … illegal drugs"), Apple 1.4.3, and § 6 KCanG all at once.
2. **Preview and confirm.** X's Developer Policy *requires* showing exactly what will be posted before
   publishing; make it the universal pattern. For scheduled posts, show the rendered preview at
   configuration time and send a "posted" entry to the device log.
3. **Off by default, opt-in per device, per destination.** Never a global account-level toggle.
4. **No auto-branding, no auto-hashtags.** § 6 KCanG (up to €30,000) and X's duplicate-content rule both
   point the same way. If a "credit Terp Control" checkbox exists, it defaults off.
5. **Sensor data and photos only, by default.** No strain names, no yields, no THC figures, no efficacy
   language in generated text. Those are precisely the strings that trip "sale facilitation" on every
   platform and FTC health-claim risk in the US. Let the user type whatever they want in a free-text caption
   — the *template* should never generate it.
6. **No share link on X by default** ($0.20 vs $0.015).
7. **Throttle hard:** one post per destination per 6 hours. Every platform limit above is ≥1,000× that; the
   throttle exists to stop a misconfigured schedule from spamming a user's community.
8. **Encrypt tokens at rest, scope them per-user, make revocation one click**, and show last-delivery status
   + error text (the `reportWebhookErrors` pattern already in `alarm.service.ts`).
9. **Show the destination's own rules link** before first use (Discord's age-restricted-channel guidance,
   the Mastodon instance's rules page). Users banning themselves is the main failure mode; a sentence of
   context prevents most of it.
10. **Competitive note [S]:** Grow with Jane, GrowDiaries and Bud all keep sharing **inside their own
    community** rather than syndicating to mainstream social. Nobody in this category has solved
    Instagram/TikTok syndication — because it is not solvable. Terp Control's existing `share.route.ts` +
    demo mode is already the same strategy; Tier 1 just gives those links legs.

---

## 20. Open questions / things to verify before committing code

- **[U]** Does X bill separately for `/2/media/upload` calls under pay-per-use? Not on the pricing page.
- **[U]** Exact X OAuth scope required for v2 media upload.
- **[U]** Whether YouTube still locks uploads from unaudited projects to `private`. Widely repeated; not on
  the current compliance-audits page.
- **[U]** Exact date/year of the Meta "restricted goods" December update that triggered the cannabis account
  purge.
- **[U]** Reddit commercial pricing ($12k/mo, $0.24/1k) — not published by Reddit.
- **[U]** Bluesky per-image cap (1 MB vs the reported 2 MB from 23 Apr 2026) and the reported 25-video/10 GB
  daily ceiling.
- **[U]** Ayrshare's stance on cannabis-adjacent customers.
- **[U]** Any German case law applying § 6 KCanG to grow equipment vendors. **Get counsel before shipping any
  branded footer on user posts.**
- **Docs moved:** `docs.bsky.app/*` → `bsky.network/docs/*`; `discord.com/developers/docs/*` →
  `docs.discord.com/developers/*`. Update any bookmarked references.

---

## Sources

X API: [pricing](https://docs.x.com/x-api/getting-started/pricing) ·
[introduction](https://docs.x.com/x-api/introduction) ·
[media upload](https://docs.x.com/x-api/media/introduction) ·
[OAuth 2.0 PKCE](https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code) ·
[Developer Policy](https://docs.x.com/developer-terms/policy) ·
[Cannabis-THC advertiser attestation](https://business.x.com/en/help/ads-policies/ads-content-policies/drugs-and-drug-paraphernalia/cannabis-thc-advertiser-attestation) ·
[X automation rules](https://help.x.com/en/rules-and-policies/x-automation) ·
[X regulated goods policy](https://help.x.com/en/rules-and-policies/illegal-regulated-behaviors)

Bluesky / atproto: [rate limits](https://bsky.network/docs/rate-limits) ·
[community guidelines](https://bsky.social/about/support/community-guidelines) ·
[app passwords](https://github.com/bluesky-social/atproto-ecosystem/blob/main/app-passwords.md) ·
[OAuth for atproto](https://docs.bsky.app/blog/oauth-atproto) ·
[createRecord](https://docs.bsky.app/docs/api/com-atproto-repo-create-record) ·
[Bluesky API limits (secondary)](https://publishq.com/blog/bluesky-api-post-limits)

Mastodon: [rate limits](https://docs.joinmastodon.org/api/rate-limits/) ·
[statuses methods](https://docs.joinmastodon.org/methods/statuses/) ·
[obtaining a token](https://docs.joinmastodon.org/client/token/) ·
[OAuth scopes](https://docs.joinmastodon.org/api/oauth-scopes/) ·
[Server Covenant](https://joinmastodon.org/covenant) ·
[posting/media limits (secondary)](https://fedi.tips/how-do-i-post-images-videos-or-audio-in-mastodon-what-can-i-attach-to-a-post-how-do-i-post-gifs/)

Meta: [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing) ·
[Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview/) ·
[Threads create posts](https://developers.facebook.com/docs/threads/create-posts) ·
[Restricted goods & services](https://transparency.meta.com/policies/community-standards/restricted-goods-services/) ·
[Regulated goods enforcement](https://transparency.meta.com/reports/community-standards-enforcement/regulated-goods/) ·
[cannabis shadowbans (MJBizDaily)](https://mjbizdaily.com/news/cannabis-operators-report-instagram-page-shadow-bans-closures/399634/) ·
[Meta app review timelines (secondary)](https://bundle.social/blog/meta-app-review-20-days)

TikTok: [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started/) ·
[Regulated goods community guidelines](https://www.tiktok.com/community-guidelines/en/regulated-commercial-activities)

YouTube: [quota costs](https://developers.google.com/youtube/v3/determine_quota_cost) ·
[quota & compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) ·
[ad guideline updates](https://support.google.com/youtube/answer/9725604?hl=en)

Reddit: [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) ·
[Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) ·
[pricing (secondary)](https://www.techloy.com/reddit-api-pricing-in-2026-complete-guide-for-developers-and-businesses/)

Discord: [Execute Webhook](https://docs.discord.com/developers/resources/webhook) ·
[rate limits](https://docs.discord.com/developers/topics/rate-limits) ·
[shared webhook buckets](https://github.com/discord/discord-api-docs/issues/6753) ·
[dangerous & regulated goods](https://discord.com/safety/dangerous-regulated-goods-policy-explainer) ·
[community guidelines](https://discord.com/guidelines) ·
[file attachments FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ)

Telegram: [Bot API](https://core.telegram.org/bots/api) ·
[Bot Platform Developer ToS](https://telegram.org/tos/bot-developers) ·
[Terms of Service](https://telegram.org/tos)

Matrix / Signal: [Client-Server API](https://spec.matrix.org/latest/client-server-api/) ·
[third-party Signal clients](https://github.com/exquo/signal-soft)

Automation / aggregators: [Zapier pricing (secondary)](https://www.nocode.mba/articles/zapier-pricing-2026) ·
[Make.com pricing (secondary)](https://dev.to/trackstack/makecom-pricing-2026-what-operations-actually-cost-and-the-math-most-guides-skip-50bn) ·
[IFTTT pricing (secondary)](https://automationatlas.io/answers/ifttt-pricing-explained-2026/) ·
[n8n integrations](https://n8n.io/integrations/mastodon/and/telegram/) ·
[Postiz (secondary)](https://teqvolt.com/open-source/postiz-29-6k-star-open-source-social-scheduler-buffer-alternative) ·
[Ayrshare pricing (secondary)](https://www.blotato.com/blog/ayrshare-pricing)

App stores: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ·
[Google Play Illegal Activities](https://support.google.com/googleplay/android-developer/answer/9878877)

Germany: [§ 6 KCanG](https://www.buzer.de/6_KCanG.htm) ·
[§ 6 KCanG (LexMea)](https://lexmea.de/de/gesetz/kcang/6) ·
[Werbeverbot analysis](https://nimrod-rechtsanwaelte.de/das-werbeverbot-im-kcang-was-ist-erlaubt-was-nicht/) ·
[KCanG criminal liability 2026](https://www.ferner-alsdorf.com/cannabis-criminal-liability-2026-what-remains-punishable-under-the-kcang-in-germany/)

Competitors: [Grow with Jane](https://growithjane.com/) · [GrowDiaries](https://growdiaries.com/) ·
[Bud – Grow Journal & Community](https://apps.apple.com/us/app/bud-grow-journal-community/id1330612534)
