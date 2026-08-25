# C51 — „Der Unterschied" · FINAL BUILD SPECIFICATION

**Status:** decided. This document supersedes `C51.md`, `C51-deviceless-A.md`, `C51-deviceless-B.md` and
`C51-deviceless-C.md`. Where those four disagree, §2 names the winner and the reason. Nothing here is a
delta against anything: a team that has never read C51 can build from this file alone.

**Target:** October 2026 · two developers · Angular 15 / Ionic 6 / Node / MongoDB / InfluxDB.
**Hard constraint:** **NO FIRMWARE CHANGES.** Every design here is cloud-side or client-side. The three
places where the obvious solution would have needed firmware are named in §21 with the workaround taken.
**Owner approvals still outstanding** are listed in §22. Nothing in v1 assumes one has been granted.

**Repo facts this specification is built on** (verified file:line, do not re-derive):
`models/images.model.ts:11-13` `device_id` required · `:28` `format` enum already contains `'user/jpeg'` ·
`:37` unique compound index `{device_id, format, timestamp, duration}` · `:40` `void imageModel.createIndexes()`
— **creates, never drops or alters** · `image.service.ts:113-123` `createDeviceImage` writes `user/jpeg`,
no resize · `:127` `addOfflineOverlay` (SVG composite, the proven burn-in technique) · `:165-185`
`convertToJpeg` = ImageMagick `-auto-orient` only · `:326-395` the rolling-timelapse writer looks up exactly
one mp4 per `{device_id,timestamp,duration}` · `:417` `thinImageRange` filters `format:'jpeg'` — **user
photos are never thinned** · `:583` `libx265` · `app.ts:85` `fileUpload()` with **no size limit** ·
`dtos/users.dto.ts:15-20` `SignupDto` = username + password, no claim code · `services/auth.service.ts:41-79`
signup, `REQUIRE_ACTIVATION` env flag sends mail · `middlewares/auth.middleware.ts:172` the single ownership
test, `:70-80` `findValidShare` · `models/share.model.ts:10-12` `device_id` required, non-unique ·
`models/devicelog.model.ts:5-8` `device_id` required · `models/users.model.ts` **no tier/plan/subscription
field** · `data.service.ts:12,19` `VALID_SENSORS`/`VALID_OUTPUTS` allowlists (a hand-logged pH can never
enter Influx) · `:80-89` the raw Flux interpolation · `:110,129` series arrive as **plain JSON over HTTP** ·
`device.service.ts:739` `deleted` is a visibility flag — `DELETE /device/logs/:device_id` deletes nothing ·
`:1123-1138` `claimDevice`/`unClaimDevice` purge nothing and do not check `owner_id` ·
`charts.page.ts` 1205 lines, **already renders `type:'column'` at :809** · `util/socket-info.ts:7`
`SOCKET_ROLES = dehumidifier, heater, light, secondary_light, co2` — **no cooler, no fan, no humidifier** ·
`util/grow-presets.ts:37-118` `GROW_STAGE_PRESETS` with `vpdRange`, client-side · `util/ui-mode.ts` the
banned mode · `shared-types/index.d.ts:109-120` `DiaryEntryData`, six hand-measurement fields ·
`diary-entry-modal.component.html:126-127` a hidden `<input type="file" capture="environment">` already
ships · `list.page.html:26-73` the empty-account claim-code hero · `server/package.json` `sharp@0.34.5`
**and** `imagemagick@0.1.3` · `webapp/package.json` `@capacitor/core 4.6.2` **scaffold only — no `android/`,
no `ios/`** · no GridFS, no `x-api-key`, no service worker anywhere in `server/src`.

---

## 1. Thesis

> **Every thing is a *Ding* with one screen shape; that shape's body is always a Vorher/Jetzt pair with the
> change named in one German sentence; and one slider — shared across every Ding you walk to — decides what
> *Vorher* means.**

Set „Vorher = Freitag 14:02" once, then walk. The tent says what changed since Freitag. Plant A3 says what
changed since Freitag. The heater socket says what changed since Freitag. The Tag-Ziel says it was 24,0 °C
on Freitag and is 25,0 °C now. Anna says what she did since Freitag. **The cursor does not reset when you
walk.** You are not opening screens; you are holding one question against different things.

Four fusion properties, all load-bearing:

- **F1 · The cursor is a property of the session, not of the screen.** `Vorher` is global state that
  survives every walk. Remove it and the endpoint reverts to a per-screen dropdown, which is the per-screen
  configuration this concept exists to abolish.
- **F2 · The diff is what stops uniformity from flattening importance.** When every body is a diff, a Ding
  that did not change says `unverändert seit Freitag` in one grey line and a Ding that did gets a sentence.
  Ranking falls out of the comparison instead of being bolted on.
- **F3 · `Nächster Unterschied ›` generalises.** One button: *jump the cursor to the next moment at which
  this Ding changed by more than its own noise floor.* On the Zelt, the next Befund-worthy minute; on a
  `dose`, the next switch; on a `ziel`, the next time somebody moved the target; on a `mensch`, the next
  thing Anna did. One control, sixteen meanings, no configuration.
- **F4 · The `ziel` Ding forces setpoint history into existence.** A target is a Ding → it has a body → its
  body is a diff → „Tag-Ziel 24,0 → 25,0 °C, von Ben, gestern 19:04" must be answerable → `ZielStand` rows
  must exist. That kills the standing bug where every chart draws today's target over last month's data.

Two disciplines, never relaxed:

- **The picture describes, never diagnoses.** „Der obere linke Bereich ist heller geworden." Never
  „Stickstoffmangel." Hardened for hand photos: they are **shown and never measured** (§11.4).
- **The numbers prescribe — but only where we own the mechanism.** „Die Heizung lief 2 Std 40 ohne Pause
  und es blieb 1,4 °C zu kalt" is a deterministic statement about kit we switch, with one concrete next
  step and the id of the rule that produced it. **A rule that cannot name a mechanism produces no line at
  all.** Silence beats a guess — and, device-less, silence beats an advertisement for the same reason.

### 1.1 And the second half of the thesis, which is not an appendix

> **A Zelt has between zero and many sensors, and every screen in this product is written against that
> number being zero.**

`Zelt.geraete = []` is **not the degraded case — it is the reference case.** Of sixteen `DingArt` values,
**seven are stored and every one of those seven is human-entered.** The stored half of the model runs
untouched with no hardware in the account. There is no lite mode, no tier, no second data model, no second
route, no feature flag, no „Tagebuch-Modus".

**The falsification test, restated to cover it:**

> **If you can name a control, a route, a flag, a stored preference or a sign-up choice whose sole effect is
> to show or hide the sensor half of the product, it is a mode.**

`Zelt.geraete.length === 0` is **data**. It changes only by claiming hardware and is not reversible through
any setting. That is M4 („reveal by capability and by data") unchanged — **device-lessness needed no new
mechanism to avoid being a mode, because M4 already forbade every form it could have taken.**

---

## 2. Decisions register — every conflict between the sources, resolved

Read this table before anything else. Each row is final.

| # | The disagreement | **Taken** | Why, in one sentence |
| --- | --- | --- | --- |
| D1 | How a photo without a device is keyed: C's `device_id: 'zelt:<zelt_id>'` sentinel vs A/B's optional `device_id` + new `zelt_id` + index replacement | **A/B: real `zelt_id`, `device_id` optional** | A sentinel moves the branch from one write site to every read site and produces silent empty results instead of a loud error; all four reviewers rejected it and C itself books it as debt that "somebody will forget within a year". |
| D2 | The `Image` unique index | **Replace it: non-unique `{zelt_id,timestamp}` + partial-unique `{device_id,format,timestamp,duration}` restricted to `format:'mp4'`** | A traced the uniqueness to its one real consumer (`image.service.ts:326-395`, one mp4 per key) and kept it exactly there; everywhere else it was only ever the same-millisecond collision bug. |
| D3 | How the index change is deployed | **An explicit one-shot `npm run migrate:indexes`, single instance, never at boot** | `images.model.ts:40` is `void imageModel.createIndexes()`, which creates and never drops or alters (A caught this; B would have shipped it broken) — and a `dropIndex` in a boot try/catch races two pm2 instances and swallows its own failure. |
| D4 | Same-millisecond upload collisions | **Both: the index change (D2) removes the class, and `catch E11000 → retry` is kept as a guard that logs and never rewrites `t`** | C's retry-with-`timestamp+1` moves the record's time to satisfy an index; in a diary the time *is* the record, so the retry perturbs `Image.timestamp` only, never `Ding.t`. |
| D5 | Sentence generator: A's two ladders vs C's rewritten ranks vs B's one ladder | **B: one ladder, eight ranks, order unchanged in code; only which ranks can match and rank 7's template table change** | Two ladders means two rank orders, two i18n key sets and a third undefined behaviour on the mixed Zelt where both match — A says so in its own scope table. |
| D6 | Rank 8 wording (`Seit gestern hast du nichts eingetragen.`) | **Rejected in all three forms. Rank 8 is rewritten to recall, never to diligence** (§9.2) | An app that reports on your discipline every time you open it is deleted in week three, and all three documents admitted the problem without solving it. |
| D7 | The chart: A's fork (two implementations on one route) vs C's "ECharts or nothing" vs B's one chart over one merged endpoint | **B: one chart, one `GET /api/reihen`, `quelle` drives exactly one mark-spec rule** | A priced a second chart at one developer-day, and C's reason for killing the Highcharts fallback is factually wrong (`charts.page.ts:809` already draws `type:'column'`; `data.service.ts:110,129` fetch plain JSON) — so the fallback survives and stays our slack. |
| D8 | Hand measurements | **B: `notiz.d.messwerte`, one optional object on an existing stored art, plus the legacy `DiaryEntryData` normaliser** — extended with `substrat` | A and C print `pH (Hand)` and `Höhe A1 6 → 11 cm` in their own mockups with nowhere to store either; B is the only one that checked what the app already ships. `substrat` is added because the club's guard needs one hand signal and B's list pointedly omitted moisture. |
| D9 | `tag_null` precedence | **Set once at creation from `Los geht's`; changed only by an explicit user edit. Never inferred from a `phase`, never rewritten by a claim, never moved by a backfill.** | A and C let a late or backfilled `phase` outrank a typed date, which silently re-numbers every day counter, every burned-in film caption and every detent in the account. |
| D10 | Does the create sheet ask for medium/Schema and start date? | **Yes — A's sheet: Name, Medium, `Los geht's ( heute ) ( früher … )`** | B's „Medium und Plan wählst du später — oder nie" defers the one question that turns on prefill, the chart's only band, F-1 and the `duengen_ab_woche` refusal; B's own §4.9 says the Schema carries the product. |
| D11 | Sign-up screen | **B's shape: one green `Zelt anlegen` primary + the existing claim-code input verbatim below; `?code=` deep-links straight past it** | A's two equal doors is the closest thing to a mode in the product (A says so); C's silent auto-mint removes the two fields that matter most (name, start date). |
| D12 | `REQUIRE_ACTIVATION` | **C's answer: off for self-serve; if on, an unactivated account may log in and WRITE, the mail deep-links to `/z/<zelt_id>`, and the nag is one dismissible Zeile. Flagged §22 — owner approval not given.** | It is a real auth change with a real spam surface, and it sits between a stranger and their first screen; A ignored it, B flagged it, only C designed it. |
| D13 | Timelapse from hand photos: A's `Reihe` 5 fps vs C's `Diaschau` 3 fps vs B's `Rückblick` 1,5 s/photo | **B's pacing and name (`Rückblick`, 1,5 s/photo, 250 ms crossfade, ffmpeg concat demuxer), C's letterboxing, one pipeline with two recipes** | Only B is paced so the burned-in date is readable, which is the whole point of burning it in; and three names for one ffmpeg pipeline was three of the engineer's uncosted implementations. |
| D14 | `auto_bild` window device-less: A's ±12 h vs B/C's ±2 h | **The `beleg()` ladder settles display (±5 min frame → ±12 h photo). The double-feed guard does NOT use `auto_bild`** — it shows only a photo attached to that `gabe` (§13.4). | An hours-wide guess is not evidence; the guard either has the waterer's own photo or says it has none. |
| D15 | `— Gerät` rows in `Der Unterschied` | **Forbidden by name** | A row for a measure we cannot take is a control hardware would enable, rendered as disabled — the exact M4 violation; C conceded in its own §12.4 that it probably converts worse than a banner anyway. |
| D16 | Storage quota | **C's mechanism, A/B's honesty: 1 000 photos per Zelt, printed on `Werte`, `[ Foto ]` relabels rather than disappears, and a device does not raise the cap** | C is the only document that treated the free tier's storage bill as a product decision instead of a weakness list entry; 500 collides with C's own photo nudge over four runs a year, 1 000 does not. |
| D17 | σ for hand series | **B: last 14 readings, per-measure floors (pH 0,1 · EC 0,1 · Höhe 1 cm · Wasser 0,5 l · TDS 20 ppm); below three readings the row is present but UNRANKED, sorted last, `○`** | C's σ over all prior samples never stabilises and A prints „nach Abweichung sortiert" without defining the metric at all. |
| D18 | `Zelt.geraete` type | **`{ geraet_id, seit, bis? }[]`, not `string[]`** | The upgrader's forward-only rule ("nothing the device does may touch a Ding dated before the claim") is unenforceable without a claim timestamp on the membership, and `string[]` cannot hold one. |
| D19 | The upgrade moment: B's "no ceremony" vs C's dedicated screen | **C's screen, built as an ordinary Vorher/Jetzt body**, plus B's hatched→solid band and B's caption mechanics | The fear at that moment is „habe ich jetzt zwei Tagebücher", and the only thing that answers it is a count the user can check — but the screen earns its place only because it needs no new body shape. |
| D20 | Ship order | **A's: the device-less product first (complete and sellable), hardware enrichment on top without touching a stored row** | It is the only ordering in which a slip costs the free tier nothing, and the only one that ships a whole product rather than two halves of two. |
| D21 | Offline capture (service worker) | **Promoted from "second casualty" to v1 core — the write queue only. Web Push deferred.** | All three nominated it as the first thing to cut, for a product whose primary write path is a phone in a cellar; the engineer, the club and the diary grower all flagged it independently. |
| D22 | Run-over-run comparison, deferred to v2 by all four | **In v1, as `lauf`** | Runs live inside one Zelt, so the per-Zelt cursor reaches them with **one new detent and no new machinery** — it also gives harvest a home and answers three separate stillUnmet items at once. |
| D23 | Retroactive entry times, absent from all four | **In v1: every sheet's timestamp is tappable; `t` is what happened, `erfasst_at` is when it was typed** | Grow with Jane puts a date picker on every entry, the guard's window arithmetic is wrong without it, and `storniert_von` corrects a wrong value, not a wrong time. |
| D24 | Six club members writing without sharing one password, deferred by all four | **In v1: `Schlüssel` — a per-`mensch` revocable scoped write token that carries `akteur` server-side.** Real memberships stay out. | It is a fraction of the cost of a `Mitgliedschaft` collection and it fixes mis-attribution on the shared tent phone at the same time. |

---

## 3. Information architecture

### 3.1 The tent above the device

The `Zelt` is the subject of the product. A device is something a Zelt may have, the way it may have plants.

```ts
interface Zelt {
  zelt_id: string;              // uuid v4
  besitzer_id: string;          // User._id
  name: string;                 // "Zelt Keller"
  geraete: GeraetBindung[];     // [] IS THE REFERENCE CASE. See D18.
  zeitzone: string;             // IANA; every day boundary is computed in it
  tag_null: number;             // ms. Written once at creation. See §3.6 for the law.
  kamera_leitgeraet?: string;   // which device's camera leads, when several have one
  erstellt_at: number;
  d?: {
    medium?: 'erde' | 'light-mix' | 'all-mix' | 'coco' | 'floragard-light' | 'biotabs' | 'unbekannt';
    schema_id?: string;         // the feeding plan, chosen on the create sheet
    schema_schritt?: number;    // current step index; advances on feed events, never on the clock
    leitungswasser_ec?: number; // mS/cm. Asked once, the first time an EC is typed. Never a settings screen.
    licht_plan?: { an: number; aus: number };  // seconds-of-day. A CLAIM. Drawn hatched, never solid.
    kanne_l?: number;           // remembered watering-can size
    foto_zaehler?: number;      // denormalised, for the quota line on Werte
  };
}

interface GeraetBindung { geraet_id: string; seit: number; bis?: number; }
// `seit` = claim timestamp. `bis` = unclaim timestamp; the row is KEPT so a removed device's
// past still projects correctly. Absent `bis` = currently bound.
```

**Migration on boot, one-shot, idempotent:** every claimed device without a Zelt gets one containing exactly
itself, named from the device name, `seit` = the device's `claimed_at` if recorded else the earliest Influx
sample else now, `tag_null` = the same value. Silent. Adding another device later is one Zeile,
`+ Gerät hinzufügen`.

**Two devices reporting the same measure are never averaged.** The Zelt shows `Temperatur (Controller)` and
`Temperatur (Steckdose Balkon)` as separate rows, and the rule is printed on `Werte {…}`.

**And the same rule covers hand versus device**, which none of the three adaptations resolved:

> **One measure, two sources, two rows. `Temperatur (Controller)` and `Temperatur (von Hand)` are separate
> rows, ranked separately, never merged, never averaged, never silently superseded.** The suffix is the
> provenance rule of §3.1 with one more source name.

### 3.2 Durchgang — the run, and the end of a grow

A grower does three or four runs a year in the same box. All four source documents left `tag_null` running
to Tag 340 and had nowhere to put a harvest. One stored art fixes it (D22):

```ts
lauf   d: { nummer: number;              // 1, 2, 3 … per Zelt
            ernte_g?: number;            // NEVER prompted; the field exists, empty, optional
            ertrag_notiz?: string }
       t: number;                        // = this run's tag_null
       t_ende?: number | null;           // null = the open run. Exactly one per Zelt is open.
```

- The create sheet mints `lauf` #1 with `t = tag_null`. The day counter is always
  `floor((jetzt − offener_lauf.t) / 1 Tag) + 1`, computed in `Zelt.zeitzone`.
- `Durchgang beenden` (one Zeile on the Zelt Tafel, present only when ≥ 1 `phase` of stage `ernte` or
  `trocknen` exists — reveal by data) stamps `t_ende` and opens `lauf` #n+1 with `t = now`. Nothing is
  moved, deleted or archived: every Ding keeps its `t`, and which run it belongs to is a read-time
  comparison against the `lauf` windows.
- **The payoff is one new cursor detent.** `Lauf 1 · Tag 34` resolves
  `von = vorheriger_lauf.t + (jetzt − offener_lauf.t)` — the same day number in the previous run. Because
  runs live inside one Zelt, the per-Zelt cursor reaches them with **no new state, no new route and no new
  renderer**: the Vorher half is last run's photo at day 34, the diff table compares last run's cumulative
  water to this run's, and the sentence reads `Im letzten Lauf warst du an Tag 34 zwei Tage weiter.`
- A finished `lauf` has a Tafel: its own body (`Tag 1` vs `Ernte`), its own diff, its own `Verlauf`, its
  own `Rückblick`. That Tafel is „wie lief dieser Durchgang", which was unanswerable in all four documents.

### 3.3 Routes

| Route | What |
| --- | --- |
| `/list` | Your Zelte. Exactly one → straight through, as today. |
| `/z/:zelt_id/:ding_id?` | **The browser.** One component. `ding_id` absent ⇒ the Zelt is the Subjekt. |
| `/z/:zelt_id/chart` | The chart — the only non-Ding screen, and a projection of the same cursor. |

**Three routes. There is no fourth, and specifically there is no `/z/:zelt_id/geraet` sales page** (D15).

Kept, because share links and chart presets are persisted user data: `/device/:id/diary` → 301 `/z/<zelt>` ·
`/device/:id/charts?<q>` → 301 `/z/<zelt>/chart?<q>` (query format unchanged, `applyViewParams` back-compat
branch intact) · `/device/:id/settings` → 301 for controller and fridge only, **kept as-is for
fan / light / plug / dryer**. `ShareLink.page` stays `'charts' | 'diary'` — no enum change, no migration.
`/login /account /shares /demo /classes /diagnostics /testmode` untouched.

### 3.4 The one object

```ts
interface Ding {
  ding_id: string;        // uuid v4 — CLIENT-MINTED. The server upserts on it.
  zelt_id: string;
  geraet_id?: string;     // set ONLY on projected Dinge. Never written on a stored one.
  art: DingArt;
  name: string;           // "A3 · Wedding Cake", "Heizung (Dose 1)"
  t: number;              // WHAT HAPPENED, when. Editable at creation (D23).
  t_ende?: number | null; // explicit null = still open
  erfasst_at?: number;    // when it was TYPED. Server-stamped. Differs from `t` on a back-dated entry.
  rel?: Record<string, string[]>;   // named German edges: { an, in, betrifft, von }
  d?: Record<string, unknown>;
  bilder?: string[];      // image_ids the human attached to THIS Ding
  auto_bild?: string;     // nearest evidence, server-filled, display only (§5)
  akteur?: string;        // ding_id of a `mensch`
  storniert_von?: string; // ding_id of the correction that replaces this one
}

type DingArt = 'zelt' | 'geraet' | 'pflanze' | 'dose' | 'kamera' | 'bild' | 'film'
             | 'gabe' | 'notiz' | 'zustand' | 'phase' | 'ziel' | 'mensch' | 'ereignis'
             | 'schema' | 'lauf';
```

**Sixteen arts. Seven are stored, nine are projected read-time.**

| Stored (human-entered, no device involved) | Projected read-time (source) |
| --- | --- |
| `pflanze` · `gabe` · `notiz` · `zustand` · `phase` · `mensch` · `lauf` | `zelt` ← `Zelt` + Influx · `geraet` ← `Device` · `dose` ← `hardwareInfo.sockets` via `parseSocketRoles()` · `kamera` ← `webcam_did` + newest `Image` · `bild` ← `Image` (both formats) · `film` ← `Image`/`filme` · `ereignis` ← `DeviceLog` · `ziel` ← `ZielStand` · `schema` ← `Schema` + `Zelt.d.schema_schritt` |

**With `geraete: []`, six of the nine projections return `[]`** — `geraet`, `dose`, `kamera`, `ereignis`,
`ziel` (until a hand target is set) and the device half of `bild`. `zelt`, `schema`, `bild` (user photos)
and `film` (a `Rückblick`) still project. **Nothing is stubbed, greyed or disabled: an art with no rows is
not rendered.**

One read API, consumed byte-for-byte by the webapp so they cannot drift:
`GET /api/dinge?zelt_id=&art=&von=&bis=&cursor=`, cursor-paginated by `t`, **mandatory from day one** —
the unbounded `getDeviceLogs` cannot survive the projection load.

### 3.5 The cursor

```ts
interface Vergleich {
  von: number;
  anker: 'zuletzt' | 'gestern' | 'woche' | 'phase' | 'gabe' | 'foto' | 'beginn'
       | 'ziel' | 'plan' | 'lauf' | 'frei';
}
```

`VergleichService`, a `BehaviorSubject`, mirrored to `sessionStorage['tc-vergleich-<zelt_id>']` so a reload
keeps your place. **Not `localStorage`.** A new session always starts at `zuletzt`. A cursor that survived
sessions would be a stored preference, and a stored preference that changes what the whole app shows you is
a mode.

**`zuletzt` resolution, corrected for shared phones:** if the session carries a `mensch` write token (§13.5)
`zuletzt` is *that person's* last visit, server-side. Otherwise it is
`localStorage['tc-zuletzt-<zelt_id>']`, written on blur, i.e. „since anyone was last here on this phone",
and the label says so: `seit deinem letzten Besuch` vs `seit dem letzten Besuch auf diesem Gerät`.

### 3.6 The law of `tag_null` (D9)

> **`tag_null` is written exactly twice: once by the create sheet, and once more if the user edits it. No
> Ding, no backfill, no claim and no device may move it.**

Concretely, and this is a test case: `convertEventsToGrowCycles()` (`grow-report.component.ts:691-747`)
becomes a one-time idempotent boot backfill emitting `pflanze` + `phase` Dinge out of
`DeviceLog.lifecycleName`, marked `d.aus_log: true`. On claim day a second-hand controller can therefore
carry a **previous owner's** lifecycle logs. Two rules stop that being a catastrophe:

1. Backfilled Dinge are clipped to the binding: **no `pflanze`, `phase` or `ereignis` is emitted with
   `t < GeraetBindung.seit`.** (§14.3, the forward-only law.)
2. Even an unclipped one could not move the day counter, because the day counter reads `lauf.t`, and
   `lauf` #1's `t` came from a human typing a date.

---

## 4. The complete data model

Everything stored, every field, every type, and how each behaves with zero devices.

### 4.1 Stored arts — the `d` shapes

```ts
pflanze  d: { sorte?: string; medium?: string; topf_l?: number;
              quelle?: 'samen' | 'steckling' | 'gekauft';
              keimung_t?: number; ernte_t?: number; ernte_g?: number; entfernt_t?: number;
              ausschnitt?: [x: number, y: number, w: number, h: number] }   // dragged once, never prompted
         name: "A3 · Wedding Cake"      // renaming NEVER changes ding_id
         rel: { in: [zelt_id] }
         DEVICE-LESS: identical. The plant-ignorer is untaxed: zero pflanze Dinge means the word
         "Pflanze" appears in exactly one place in the product — the `+` on `Im Zelt`.

phase    d: { stufe: DiaryLifecycleStage }         // gains a seventh stage: 'ernte'
         t / t_ende, rel: { an: [pflanze…] }       // rel.an absent = the whole tent
         DEVICE-LESS: identical, and it is the only source of the chart's background bands (§10.4).

gabe     d: { wasser_l: number; kannen?: number; kanne_l?: number;
              verteilung: 'gesamt' | 'je_pflanze';        // DEFAULT 'gesamt'. See §13.3.
              ec?: number; ph?: number;
              ec_basis: 'absolut' | 'plus_leitungswasser';
              ablauf_ph?: number; ablauf_ec?: number;
              produkte: [{ name: string; ml_pro_l: number; aus_schema: boolean }];
              schema_id?: string; schritt?: number;
              dublette_von?: string }               // ding_id of the entry this duplicates. See §13.6.
         rel: { an: [pflanze…] }, akteur, auto_bild, bilder
         DEVICE-LESS: identical. Every field is human-entered. This is the most-used screen in the
         product and it is bit-for-bit the same with zero devices.

notiz    d: { text: string; messwerte?: Messwerte }
         rel, bilder, auto_bild, akteur
         DEVICE-LESS: identical, and `messwerte` is where a pH pen and a tape measure live (§4.2).

zustand  d: { text: string; geschlossen_von?: string }   // the Zettel on the tent door
         t / t_ende (null = offen), akteur
         DEVICE-LESS: identical. Often the only thing above the picture pair, which is correct:
         an open fact outranks the camera.

mensch   d: { farbe: string; schluessel_aktiv?: boolean; user_id?: string }
         name only. Zelt-scoped. No account, no e-mail. See §13.5.
         DEVICE-LESS: identical.

lauf     d: { nummer: number; ernte_g?: number; ertrag_notiz?: string }
         t / t_ende (null = the open run)
         DEVICE-LESS: identical.
```

### 4.2 `Messwerte` — the hand instrument set (D8)

One optional object on `notiz`. **No new entry type, no new modal, no new art.** On the `Notiz` sheet it is
one row between the text field and `📷 Foto`, in exactly the style the `Gabe` sheet gives pH/EC — *always
here, never required*.

```ts
interface Messwerte {                 // every field optional, every field hand-entered
  ph?: number;                        // legacy source: DiaryEntryData.phMeasurement
  ec?: number;                        // legacy: ecMeasurement            (mS/cm, canonical)
  tds?: number;                       // legacy: tdsMeasurement           (ppm)
  ppfd?: number;                      // legacy: lightMeasurement
  abstand_cm?: number;                // legacy: distanceMeasurement      (lamp to canopy)
  aussen_temperatur?: number;         // legacy: outsideTemperatureMeasurement
  temperatur?: number;                // NO legacy source — starts empty, and we say so
  luftfeuchte?: number;               // NO legacy source
  hoehe_cm?: number;                  // NO legacy source
  substrat?: 'trocken' | 'feucht' | 'nass';   // NEW. The one hand signal the double-feed guard can use.
  topfgewicht_kg?: number;            // NEW. The other one. Both optional forever.
}
```

A **read-time normaliser** maps the six legacy `DiaryEntryData` fields
(`shared-types/index.d.ts:109-120`, already surfaced as the `diary-measurement` category in
`diary-entry-modal.component.html:22`) onto this shape, so an existing device owner's old hand readings
appear in the new UI without a migration. `temperatur`, `luftfeuchte`, `hoehe_cm`, `substrat` and
`topfgewicht_kg` have **no legacy source and start empty** — the app says that rather than pretending the
old diary held them.

**Hand readings never enter Influx.** `VALID_SENSORS` (`data.service.ts:12`) is a twelve-name allowlist that
silently drops everything else, and no firmware-vocabulary change is permitted. They live in Mongo and are
served as series by `GET /api/reihen` (§10.1) — which is correct anyway: eleven pH readings are not a time
series.

### 4.3 The two collections the fusion forces into existence

```ts
interface ZielStand {                          // setpoint history — F4
  zelt_id: string;
  geraet_id?: string;                          // OPTIONAL: a hand target has no device
  schluessel: string;                          // 'day.temperature' | 'daynight.day' | 'lights.limit'
                                               //  | 'hand.ph' | 'hand.ec' | 'hand.licht_plan' | …
  wert: number | string;
  gilt_ab: number; gilt_bis?: number;          // half-open; gilt_bis absent = in force
  gesetzt_von?: string;                        // ding_id of a `mensch`
  quelle: 'app' | 'geraet' | 'erstbefund' | 'hand';   // 'hand' added
}

interface Bildmass {                           // FrameMetrics, ~200 B/frame
  image_id: string; zelt_id: string; t: number;
  quelle: 'kamera' | 'hand';                   // added
  ok: boolean;
  verworfen?: 'licht_aus' | 'kurzzeitig' | 'unscharf' | 'doppelt' | 'kamera_bewegt';
  phash?: string; helligkeit?: number; schaerfe: number; gruenanteil?: number;
  kacheln?: number[];                          // 48 = 8×6 grid, mean abs diff vs last kept frame
  dx?: number; dy?: number;
  licht?: 'an' | 'aus' | 'unklar';             // from out_light at t ± 60 s — the cross-modal join
}
```

- `ZielStand` is written by a diff watcher on every `configuration` the server already receives.
  `erstbefund` marks the first observation of a device whose history predates the feature, so the chart
  prints `Ziel unbekannt vor 14.09.` instead of back-projecting today's number — the current lie.
- **`quelle: 'hand'` is what makes the setpoint line continuous across an upgrade** (§14.5): a hand target
  and a device setpoint are one series with two provenances, dotted before the claim and solid after.
- **For `quelle: 'hand'` `Bildmass` rows, ONLY `schaerfe` is written.** No `phash`, no `kacheln`, no
  `dx/dy`, no `helligkeit`, no `licht`, no `gruenanteil`. Computing an 8×6 tile change map over hand-held
  pictures at varying distance, angle and white balance is noise wearing the costume of measurement, and
  §11.4's own boundary forbids exactly that dressing-up. `schaerfe` is framing-independent and is used for
  one thing: picking the day's photo for the `Rückblick`.

### 4.4 `Image` — the one unavoidable schema change

```ts
// models/images.model.ts
device_id: { type: String, required: false },              // WAS required: true
zelt_id:   { type: String, required: false, index: true }, // NEW
format:    // enum unchanged — 'jpeg' | 'user/jpeg' | 'mp4' already ships
vorschau:  { type: Buffer, required: false },              // NEW: 320 px derivative

// indexes — applied by `npm run migrate:indexes`, NOT by createIndexes() (D3)
imagesSchema.index({ zelt_id: 1, timestamp: -1 });                         // NEW, non-unique
imagesSchema.index({ device_id: 1, format: 1, timestamp: -1, duration: 1 },
                   { unique: true, partialFilterExpression: { format: 'mp4' } });  // NARROWED (D2)
```

`vorschau` exists because a `Verlauf` of 60 photos was 60 full-size BSON reads. Every list, film strip,
thumbnail and picture-pair half loads `vorschau`; only a tapped full-screen photo loads `data`.

**Read-time resolution of a legacy row:** an `Image` with `device_id` and no `zelt_id` resolves through
`Zelt.geraete ∋ device_id`. No backfill is required, and the backfill is offered as an optional idempotent
maintenance script that sets `zelt_id` on existing rows (§20 item M).

### 4.5 `ShareLink`

```ts
interface ShareLink {
  device_id?: string;    // RELAXED to optional
  zelt_id?: string;      // NEW. Exactly one of the two is set.
  page: 'charts' | 'diary';   // ENUM UNCHANGED. A Zelt share resolves to 'diary'.
  editable: boolean;     // webapp-only today; see §13.5 for what actually makes it true
  webcam: boolean; charts: boolean;
  token: string; gueltig_bis?: number;
}
```

A device-less share is `{ zelt_id, page: 'diary' }`. A share created before an upgrade **keeps resolving
after it**, and gains the sensor half only if `charts: true` was set — a link sent to a club in week 3 does
not start leaking sensor data in week 12 because the owner bought hardware (§14.7).

### 4.6 What is NOT added

No `plan`, `tier` or `subscription` field on `User` (`users.model.ts` has none today and must not gain one).
No `Mitgliedschaft` collection in v1. No `mode`, `variant` or `has_device` flag anywhere, on any model, in
any storage. **If device-lessness were a tier it would be a mode, and the concept would be dead.**

---

## 5. `beleg()` — the evidence ladder, and why there is no device-less renderer

This is the single mechanism that makes the sensor half and the diary half one product. It replaces every
per-state picture-fallback table in the four source documents with **one ordered function, evaluated per
half, per moment** — never per account, never per session, never per route.

```ts
type BelegArt = 'bild' | 'foto' | 'band' | 'karte' | 'nichts';

interface Beleg { art: BelegArt; image_id?: string; t?: number; text?: string[]; }

function beleg(zelt: Zelt, t: number): Beleg {
  // 1  a KEPT camera frame within ±5 min of t                      -> 'bild'   (caption: Kamerabild)
  // 2  a user photo (Image.format 'user/jpeg') within ±12 h of t   -> 'foto'   (caption: Foto)
  // 3  sensor samples in [t − 12 h, t]                             -> 'band'   (caption: Werte)
  // 4  Dinge / carried-forward state at t                          -> 'karte'  (caption: Einträge)
  // 5  nothing                                                     -> 'nichts' (the empty-state mark)
}
```

- Same 168×126 box, same 4:3, same `VORHER` / `JETZT` mini-caps, same position, same slider, in every arm.
- **The caption's third slot is the evidence kind and it is ALWAYS printed** — `Tag 31 · Foto` beside
  `Tag 34 · Kamerabild`. That one word is what makes there be no mode: the screen always says what it is
  looking at, at every density, including the mixed pair the day after a controller arrives. It is §3.1's
  provenance rule (`Temperatur (Controller)`) moved up to the picture.
- **A mixed pair needs zero code.** One hand photo on the left from before the claim, one camera frame on
  the right. That is correct and is not a special case.
- Ties go to the device frame. Each half resolves independently — one half may be `'foto'` while the other
  is `'karte'`.

**`'karte'` is `die Standkarte`** — what was *true* at that moment, from last-known-value carry-forward over
stored Dinge, at most five lines, `--tc-t-wert` for numbers and `--tc-t-neben` for labels, no icons:

```
Tag 31 · Blüte
Biobizz All-Mix · Schritt 6
Wasser gesamt 12,5 l
pH 6,4 · Höhe 48 cm
1 Zettel offen
```

**`'band'` is das Werteband** — 24 h min/max per measure, stacked. It is what a tent with sensors and no
camera shows, and it is unreachable device-less because there is nothing to band.

**`'nichts'` is the empty-state mark**, one SVG reused wherever something is missing: two rounded rectangles
side by side, the left dashed, joined by a dotted arrow — 96 px, `currentColor`, 1,5 px stroke. It is the
thesis drawn once. Captions: `Noch kein Vorher` · `Keine Kamera gekoppelt` · `Nichts verbunden` ·
`Noch nichts eingetragen` · `Kein Foto an diesem Tag` · `Keine Messwerte — nur was du einträgst`.

> **The machine-voiced caption `Noch nichts passiert` is never used on a device-less Zelt.** Things did
> happen; you just did not write them down, and the app does not get to claim otherwise.

---

## 6. Route map and screen inventory at three evidence densities

Three routes (§3.3). Every "screen" below is the **same component** rendering a different Subjekt. The three
densities are columns, not variants: **there is one implementation and the density is data.**

| Screen (Subjekt) | **No device** | **Device, no camera** | **Device + camera** |
| --- | --- | --- | --- |
| **Zelt Tafel** `/z/:id` | Header `Tag 34 · 14 Einträge · zuletzt vor 2 Std`. Body = `beleg` `'foto'` or `'karte'`. Diff table: hand measures, Summen, Schema-Schritt, Phase. `Im Zelt`: plants, Ziele, `+ Gerät hinzufügen`. | Header `● Online · Werte von vor 40 Sek · Tag 34`. Body = `'band'`. Diff table gains Temperatur, Luftfeuchte, VPD, CO₂, Ziel rows, Laufzeiten. `Im Zelt` gains `dose` and `Ziele` rows. | Header identical. Body = `'bild'`. Diff table gains `Blattfläche`. `Im Zelt` gains `◼ Kamera läuft`. `Verlauf` gains `film` rows. |
| **Pflanze Tafel** `/z/:id/:ding` | Day/phase diff, cumulative water and products, per-actor counts, hand `hoehe_cm`. Photos cropped to `ausschnitt` if set. | The same, plus nothing — a controller measures the tent, not the plant. | The same, plus both halves cropped to `d.ausschnitt` from kept frames. |
| **Gabe / Notiz / Phase Tafel** | Diffs against its predecessor: previous Gabe to the same plants, previous note, previous stage. | identical | identical, plus `auto_bild` resolves a frame instead of a photo. |
| **Ziele Tafel** | The Schema **is** the body: `Schritt 4 → 5 · Bio-Bloom 2,0 → 2,5 ml/l`, plus hand `ZielStand` rows. | Setpoint rows with history from `ZielStand`, inline `value-edit-row`, plus the Schema. | identical. |
| **Mensch Tafel** | „was ist passiert, seit du zuletzt hier warst" — as entries. | identical, plus what the tent did in her absence. | identical, plus her last frame. |
| **Lauf Tafel** | `Tag 1` vs `Ernte`, the run's totals, its `Rückblick`. | plus climate summary for the run. | plus the run's `Film`. |
| **Geraet / Dose / Kamera Tafel** | **does not exist** — the art projects `[]`. Not greyed. Not listed. | `geraet`, `dose` per `parseSocketRoles()`. | plus `kamera`. |
| **Schema Tafel** | The schedule's own diary: step diff, `wie im Plan` vs `abweichend`, `quelle_url` + `zuletzt geprüft`. | identical | identical |
| **Chart** `/z/:id/chart` | Panels: Wasser (bar lane), pH, EC, Höhe, TDS, PPFD, Aussentemperatur. Bands from the Schema. Background from `phase`. `licht_plan` hatched if set. Verdict strip = counts. | plus Temperatur, Luftfeuchte, VPD, CO₂ panels; Sollwert `markLine` from `ZielStand`; Tag/Nacht **solid** from measured `out_light`; `Ausgänge` state-timeline lane; verdict strip = % of time with coverage. | plus the 44 px film strip above the panels and the frame in the scrub header. |
| **Sheets** `Gabe · Notiz · Foto · Zettel` | **byte-identical at all three densities.** All four are cloud writes; none ever needed a device. | identical | identical, except the double-feed guard's `[ Bild ansehen ]` (§13.4). |

**The three rows that are absent, not disabled, with no device:** `geraet`, `dose`, `kamera`. **There is no
`Temperatur —` row, no „0 Sensoren", no completeness meter, no padlock, no greyed control.** A padlock would
be a mode by the falsification test — a control whose sole effect is to show that a feature class is hidden.

### 6.1 The Zelt Tafel — device + camera, 390 px, Tag 34

de-DE as shipped; `en.json` gets mirror keys in the same commit.

```
┌──────────────────────────────────────────────────────┐
│ ←  Zelt Keller                                  ☰    │
│    ● Online · Werte von vor 40 Sek · Tag 34          │
├──────────────────────────────────────────────────────┤
│ ▌ CO₂-Flasche fast leer · Anna, vor 3 Tagen       ✓ │  „Offen" — absent when empty
│ ▌ A3 nicht gießen — zu nass · Ben, vor 1 Tag      ✓ │
├──────────────────────────────────────────────────────┤
│  ┌────────────────┐   ┌────────────────┐             │  168×126, 4:3
│  │     VORHER     │   │     JETZT      │             │
│  └────────────────┘   └────────────────┘             │
│   Fr 22.08. 14:02      Mo 25.08. 14:04               │
│   Tag 31 · Kamerabild  Tag 34 · Kamerabild  [ Δ ]    │
│                                                      │
│  Die Pflanzen sind gewachsen und nachts war es       │
│  wärmer.                                             │
│  Blattfläche 34 → 37 % · Nacht 21,2 → 23,4 °C        │
│  → Nacht-Ziel steht auf 21,0 °C und Abluft ist keine │
│    Dose. Was du tun kannst: Licht dimmen (jetzt      │
│    100 %).                              Regel N-3 ›  │
├──────────────────────────────────────────────────────┤
│  Vorher ├────●──────────────────────────────┤ Jetzt  │
│         ▁▃▂▅▁▁▇▃▂▂▄▅▃▁▁▂▆▃▂▂▁▃▄▂▁▃▅▂▁▁▃▂▄▅▃▂        │
│   Beginn  Phase  1 Wo  gestern  gestern Abend  jetzt │
│  Fr 22.08. 14:02 · Tag 31          Nächster ›        │
├──────────────────────────────────────────────────────┤
│  Der Unterschied                    ⓘ nach Abweichung│
│                     Fr 14:02  →  jetzt      Δ        │
│   Temperatur         24,1 °C     24,8 °C   +0,7  ◼   │
│      Ziel Tag        25,0 °C     25,0 °C     —       │
│   Nacht (Mittel)     21,2 °C     23,4 °C   +2,2  ▲   │
│      Ziel Nacht      21,0 °C     21,0 °C     —       │
│   Luftfeuchte          61 %        58 %     −3   ◼   │
│   VPD                1,12       1,29 kPa  +0,17  ◼   │
│   CO₂                 412        398 ppm    −14  ◼   │
│   Blattfläche          34 %        37 %     +3   ▲   │
│   Wasser gesamt       12,5 l     16,5 l   +4,0   ◼   │
│   Heizung/Tag     3 Std 55    4 Std 20   +25 Min ◼   │
│   Licht                100 %       100 %     —   ○   │
│                                         ⋯ 3 weitere  │
├──────────────────────────────────────────────────────┤
│  Im Zelt                                          +  │
│  ◼ A1 · Gorilla Glue        Blüte Tag 12   vor 2 Std │
│  ◼ A3 · Wedding Cake        Blüte Tag 12   vor 5 Tg  │
│  ◼ Heizung (Dose 1)         aus            vor 40 Sek│
│  ◼ Entfeuchter (Dose 2)     an · 12 Min    vor 40 Sek│
│  ◼ Licht (PWM)  100 % · ◼ Kamera läuft · ◼ Ziele 6   │
├──────────────────────────────────────────────────────┤
│  Verlauf                                             │
│  ◼ Gabe · 2,0 l · Bio-Bloom 2 ml/l                   │
│    an A1 A2 · von Anna                    vor 2 Std  │
│  ◼ Ziel Tag-Temperatur 24,0 → 25,0 °C · von Ben      │
│                                      gestern 19:04   │
│  ▲ Feuchte 40 Min über 65 %              Sa 03:12    │
│  ◼ Film · Blüte Woche 4 · 25 Sek         Sa 04:00    │
│  ───────────── Vorher · Fr 22.08. 14:02 ─────────────│
│  ◼ Gabe · 2,0 l · von Anna   Fr 12:05  ⋯ 340 weitere │  ← dimmed below the line
├──────────────────────────────────────────────────────┤
│  [ Gabe ] [ Notiz ] [ Foto ] [ Zettel ]              │
│  Werte  {…}     · JSON · CSV · Zugangsschlüssel  [⎘] │
└──────────────────────────────────────────────────────┘
```

### 6.2 The same Tafel — no device, Tag 34

**Same sections, same order, same positions, same controls, same four buttons.** What differs is which rows
have data.

```
┌──────────────────────────────────────────────────────┐
│ ←  Zelt Keller                                  ☰    │
│    Tag 34 · 14 Einträge · zuletzt vor 2 Std          │  no ● dot: nothing is online
├──────────────────────────────────────────────────────┤
│ ▌ CO₂-Flasche fast leer · Anna, vor 3 Tagen       ✓ │
├──────────────────────────────────────────────────────┤
│  ┌────────────────┐   ┌────────────────┐             │
│  │  [Foto 22.08.] │   │  [Foto 25.08.] │             │
│  └────────────────┘   └────────────────┘             │
│   Fr 22.08. 14:02      Mo 25.08. 16:20               │
│   Tag 31 · Foto        Tag 34 · Foto      [ Δ ]      │
│                                                      │
│  Aus 48 cm sind 51 cm geworden und du hast zweimal   │
│  gegossen.                                           │
│  Höhe 48 → 51 cm (von Hand) · Wasser 4,0 l · 2 Fotos │
│  → Schritt 5 des Schemas ist seit 2 Tagen fällig.    │
│                                        Regel F-1 ›   │
├──────────────────────────────────────────────────────┤
│  Vorher ├────●──────────────────────────────┤ Jetzt  │
│         ▁▁▃▁▁▁▂▁▁▄▁▁▁▂▁▁▁▃▁▁▂▁▁▁▅▁▁▂▁▁▃▁▁▂▁         │
│  Beginn  Phase  1 Wo  gestern  letzte Gabe    jetzt  │
│  Fr 22.08. 14:02 · Tag 31          Nächster ›        │
├──────────────────────────────────────────────────────┤
│  Der Unterschied                    ⓘ nach Abweichung│
│                     Fr 14:02  →  jetzt      Δ        │
│   Höhe (von Hand)      48 cm      51 cm    +3    ▲   │
│   Wasser gesamt        12,5 l     16,5 l   +4,0  ◼   │
│   pH (von Hand)          6,4        6,2   −0,2   ◼   │
│      Ziel pH        6,0–6,5    6,0–6,5      ✓        │
│   EC (von Hand)          1,2        1,4   +0,2   ◼   │
│      Ziel EC             1,4        1,4      —       │
│   Phase A1              Blüte      Blüte  Tag 12     │
│   Schema-Schritt      4 von 14   4 von 14    —   ○   │
├──────────────────────────────────────────────────────┤
│  Im Zelt                                          +  │
│  ◼ A1 · Gorilla Glue        Blüte Tag 12   vor 2 Std │
│  ◼ A3 · Wedding Cake        Blüte Tag 12   vor 5 Tg  │
│  ◻ Ziele · Biobizz All-Mix · Schritt 4 von 14        │
│  ◻ + Gerät hinzufügen                                │
├──────────────────────────────────────────────────────┤
│  Verlauf                                             │
│  ◼ Gabe · 2,0 l · Bio-Bloom 2 ml/l                   │
│    an A1 A2 · von Anna                    vor 2 Std  │
│  ◼ Foto · von Anna                        vor 2 Std  │
│  ◼ Notiz · „untere Blätter gelb" · Höhe 51 cm        │
│                                        gestern 18:40 │
│  ───────────── Vorher · Fr 22.08. 14:02 ─────────────│
│  ◼ Gabe · 2,0 l · von Anna   Fr 12:05  ⋯ 47 weitere  │
├──────────────────────────────────────────────────────┤
│  [ Gabe ] [ Notiz ] [ Foto ] [ Zettel ]              │
│  Werte  {…}     · JSON · CSV · Zugangsschlüssel  [⎘] │
└──────────────────────────────────────────────────────┘
```

**The four action buttons are byte-identical to §6.1.** That row is the proof the concept was device-less
all along. Note what is *not* on this screen: no `Temperatur —` row, no upsell, no meter, no badge. The only
mention of hardware in the whole product from here on is the one 48 px `◻ + Gerät hinzufügen` Zeile, which
never moves, never grows, never pulses and never changes colour. **Count the upsell surface: one row.**

### 6.3 The mixed Zelt — the screen none of the three drew

Six weeks of hand entries, then eighteen days of 5-second samples, on one 390 px phone. This is the state
most upgraded accounts live in **forever**, so it gets a spec, not a shrug.

- **Panel and row order is fixed and does not depend on which half of the history you are looking at.** The
  diff table's row order is: measured climate (device) → hand measures → Ziel rows (indented under their
  measure) → Summen-Zeilen → counts. Ranking reorders *within* those groups, never across them.
- **The table is capped at 11 rows plus a `⋯ N weitere` Zeile** that expands in place. That bound exists
  because the mixed case is the union of both row sets and nobody had counted it.
- **The cursor may sit before the first sample.** Then the Vorher half is `beleg → 'foto'` or `'karte'`, the
  Jetzt half is `'bild'` or `'band'`, and the caption's third slot says so in both. The diff table's device
  rows read `— (keine Daten vor 14.09.)` **only in this case** — this is not the forbidden `— Gerät` row
  (D15): it names a *date boundary in this account's own history*, not a product you do not own, and it
  disappears once the cursor moves past the claim.
- **The chart draws no sensor line before the first sample** and the axis prints `Keine Messwerte vor
  14.09.` — the same refusal, in the same words, as `Ziel unbekannt vor 14.09.`
- **The Dichteband behind the slider is normalised per source and stacked**, not summed: a lower 8 px band
  of Dinge and an upper 4 px band of kept frames. Otherwise 2 880 frames/day swamp 3 entries/day and the
  hand-logged weeks look like an empty diary.
- **The Tag/Nacht band is hatched before the claim and solid after**, at the exact first `out_light`
  sample, and the legend reads `nach Plan, nicht gemessen` → `ab 14.09. gemessen`. The band does not move;
  only its texture changes. That is the clearest single picture of the upgrade in the product, and it costs
  one pattern fill.

### 6.4 States

| Situation | The Tafel |
| --- | --- |
| **Veraltet** 2–10 min | `◻`, values muted, each with its own age. **Nothing blanked** — a stale number is the best number available. |
| **Offline** > 10 min | `● Offline seit Mi 14:02 (vor 3 Std)`. Jetzt column keeps its last values, greyed, header reads `zuletzt`; frame carries the existing `addOfflineOverlay`. `Gabe/Notiz/Foto/Zettel` stay **enabled** — logging is a cloud write. Only `Ziel ändern` disables: `Gerät offline — Änderung wird bei Rückkehr gesendet.` |
| **No device at all** | No status dot, no online semantics. Header = `Tag 34 · 14 Einträge · zuletzt vor 2 Std`. The status square keeps its meaning applied to entries: gefüllt = frisch, hohl = veraltet, amber = offen, rot = Alarm. |
| **Keine Kamera, Gerät da** | Both halves `beleg → 'band'`, one line + `[ Kamera einrichten ]`. Sentence, slider, table, sections byte-identical. |
| **Kamera still > 3 h** | Jetzt half = last kept frame with `Letztes Bild vor 3 Std 12`; sentence rank 1 becomes the camera; the alarm already went out (§11.6). |
| **Bild verworfen** | `Bild verworfen (Hand im Bild) — gezeigt: 14:04`. A rejected frame is never shown as „jetzt". |
| **Kein Foto an diesem Tag** | That half becomes a `'karte'`, and its caption is a Zeile: `Nächstes Foto: 2 Tage danach ›` — tapping it moves the cursor. |
| **Kein Vorher** | §7 — the Vorher column becomes `PLAN` (a Schema is chosen) or `BEGINN` (none). Same shape. |
| **Werte fehlen, Bild da** | Rows read `— (keine Daten)`. The pair still works; the two sources fail independently and the screen names which. |
| **Share `webcam:false` / Demo** | `'band'` or `'karte'` variant minus the setup button / `[ Eintragen ]` reads `[ Im Demo nicht möglich ]`. |
| **Bilderspeicher voll** | `[ Foto ]` **relabels** to `Bilderspeicher voll ›`, walking to a delete-and-export screen. It never disappears, and **it does not mention the controller** (§11.3). |

### 6.5 How it looks

One family (`-apple-system, "Segoe UI", Roboto, sans-serif`). **Every number is `font-variant-numeric:
tabular-nums`, without exception** — the columns must align to the digit or the diff is unreadable.

`--tc-t-satz` 19/26 600 (the sentence, **exactly one per screen**) · `--tc-t-kopf` 17/24 600 (the Ding's
name) · `--tc-t-wert` 17/22 500 (every number) · `--tc-t-zeile` 15/20 400 (row labels) · `--tc-t-neben`
13/18 400 muted (ages, units, provenance) · `--tc-t-abschnitt` 13/16 600 uppercase .04em (section headers) ·
`--tc-t-mini` 11/14 500 uppercase .06em (`VORHER`/`JETZT`).

Rhythm: 4 px base; the **only** permitted gaps are 4/8/12/16/24/32. Rows ≥ 48 px, targets ≥ 44, section gap
24, radius 14, hairlines 1 px. Colour: existing Ionic tokens plus `--tc-hoch` (warm) / `--tc-runter` (cool)
for the *direction* of a delta — never red/green, because red is reserved for alarms; `--tc-gleich` muted;
amber only for `Offen` and alarms. Status square 12 px.

**Vorher is never coloured „bad"**: left column at 88 % opacity with a 2 px `--tc-line` border. Only Δ
carries colour. The four action buttons are equal width, fixed order, and never move.

---

## 7. Day one, sign-up, and the first 48 hours

### 7.1 The empty account (D11)

`list.page.html:26-73` today greets an empty account with a `.tc-hero`, three numbered steps that all
describe plugging in hardware, and a single claim-code input. Delta — the same hero, the same
`.tc-eyebrow`/`.tc-step-badge` classes, the same green `color="secondary"` button:

```
┌──────────────────────────────────────────────┐
│            [empty-state mark, 96 px]         │
│  Willkommen bei Terp Control                 │
│  Ein Zelt, zwei Zeitpunkte, ein Unterschied. │
│  [           Zelt anlegen                 ]  │  ← the existing green CTA
│  ┌────────────────────────────────┐          │
│  │ Kopplungscode          [ + ]   │          │  ← the existing input, verbatim
│  └────────────────────────────────┘          │
│  Du hast schon einen Controller? Der Code    │
│  steht am Display unter „Connect to portal". │
└──────────────────────────────────────────────┘
```

The three hardware steps (`onboarding.step1Text` … `step3Text`) move behind the claim input as a disclosure
of the **claim path only** — they are instructions for a code, and only someone entering a code needs them.
**`/login?code=XYZ` and `/list?code=XYZ` skip this screen entirely**, so the printed card in the €289 box
lands its owner where it always did.

`Du brauchst kein Gerät.` **is never said, here or anywhere.** Explaining an absence is a way of naming it.

### 7.2 The create sheet — three fields, one required (D10)

```
┌─ Neues Zelt ──────────────────────────────────┐
│  Name          [ Zelt Keller             ]    │  prefilled, editable, never blocking
│  Medium        [ Erde ▾ ]                     │  → picks the Schema
│  Los geht's    ( heute )  ( früher … )        │  → tag_null, and lauf #1
│  [              Zelt anlegen              ]   │
└───────────────────────────────────────────────┘
```

- **`Medium`** is the substrate + regime pair said the way a grower says it: `Erde` · `Light-Mix` ·
  `All-Mix` · `Coco` · `Floragard Light` · `BioTabs` · `weiß ich nicht`. It sets `zelt.d.schema_id`;
  `weiß ich nicht` sets none and costs nothing later. **This is the field that turns on the first Gabe's
  prefill, the chart's only band, rule F-1 and the `duengen_ab_woche` refusal.** Ten seconds, once.
- **`Los geht's ( früher … )`** opens a date wheel and writes `tag_null` and `lauf` #1's `t`. **The single
  most important field in a diary product**, because people sign up in flowering week 4.
- **No wizard.** No strain, no plant count, no light schedule, no photo, no e-mail confirmation of intent.

### 7.3 Eighty seconds to the first real entry

| t | |
| --- | --- |
| 0:00 | `/login` → Registrieren → e-mail, password → `Konto anlegen` |
| 0:35 | `Zelt anlegen` → accept `Zelt Keller`, tap `Erde`, tap `heute` → `Zelt anlegen` |
| 0:50 | Lands on `/z/:zelt_id`. Body = `PLAN` vs `JETZT`. `Verlauf` has one row: `◼ Zelt angelegt`. |
| 1:10 | `[ Gabe ]` → the counter shows `● ○ ○ ○ ○` · `1 Kanne · 2,0 l`; the product line reads **`All-Mix ist vorgedüngt — bis Woche 3 nur gießen.`** → `Eintragen` |
| 1:20 | **Two taps produced a real entry and the app told them something they did not know.** |

That is the free product's whole pitch, delivered in eighty seconds by a feature with no hardware dependency
of any kind. `REQUIRE_ACTIVATION` is the only thing that can break it, and D12 is the answer — pending
owner approval (§22).

### 7.4 Day one — the Vorher column with no Vorher

A diff needs a *Vorher* and day one has none. The answer is not an empty state; it is **a different
comparand in the same frame.** Three comparands, in order of what exists:

**(a) A device was claimed** → the column is `ZIEL`, the setpoints:

```
  ┌──── ZIEL ────┐   ┌──── JETZT ────┐
  │  25,0 °C     │   │ [erstes Bild] │   dein Ziel → heute 14:04 · Tag 1
  │  60 %        │   │   26,2 °C     │
  └──────────────┘   └───────────────┘
  Es ist 1,2 °C wärmer als dein Ziel.
```

**(b) No device but a Schema** → the column is `PLAN`, the Schema's current step:

```
  ┌──── PLAN ─────┐   ┌──── JETZT ────┐
  │ Schritt 1     │   │  [erstes Foto]│   dein Plan → heute 08:40 · Tag 1
  │ nur gießen    │   │  0 Gaben      │
  │ pH 6,0–6,5    │   │  keine Messung│
  └───────────────┘   └───────────────┘
  Noch kein Vorher — der erste Unterschied entsteht nach deinem zweiten Eintrag.
  Der Unterschied           Plan  →  jetzt      Δ
    Gaben                      1        0        −1
    Dünger                keiner   keiner         ✓
```

**(c) Neither** → the column is `BEGINN` (`Tag 1 · 0 Pflanzen · 0 Gaben`) and the right half **is the
shutter**: the empty-state mark with `[ Foto aufnehmen ]`, the emptiest possible screen where the one thing
missing is also the one tappable thing. Sentence: `Dein Tagebuch fängt heute an. Was du einträgst, steht ab
morgen hier als Unterschied.`

The track has two detents and grows more as history arrives — reveal by data, and it means the control
learned on day one is the control used on day 84.

### 7.5 The first 48 hours, both densities

| t | With a device claimed | With no device |
| --- | --- | --- |
| 0 | Zelt auto-created from the device name, body = `ZIEL` vs Ist. | Create sheet → `/z/:id`, body = `PLAN` or `BEGINN`. |
| +2 min | First frame → the Jetzt half becomes a picture. | First `[ Foto ]` → the Jetzt half becomes a picture. |
| +30 min | `Verlauf` gets `◼ Gerät verbunden`, `◼ Ziele gesetzt`. | `Verlauf` has whatever you wrote. Nothing arrives on its own, and the screen does not pretend otherwise. |
| +3 h | `Blattfläche` baseline; the row appears. | — |
| +12 h | First lights-off boundary → `gestern Abend` detent; Tag/Nacht shading exists. | — (the detent is absent unless `licht_plan` was typed) |
| +24 h | `gestern` detent. **The pair becomes two real pictures.** `Film · Woche 1` is queued. | `gestern` detent, if you logged yesterday. |
| +7 d | `1 Woche` detent. | `1 Woche` detent; the first Schema step becomes due and **F-1 fires** — the free product's one proactive line. |
| +48 h | `seit zuletzt` becomes meaningful. | identical. |

**In the first 48 hours the product asks for nothing at all** beyond the three fields on the create sheet.

---

## 8. No modes, and the slider

`ui-mode.ts` and `localStorage['app-settings-expert']` are **deleted**, not renamed, in the same commit as
the setup wizard's dependency on them.

- **M1 · Depth is subject-distance.** No expand control, no „mehr anzeigen", no density preference, no
  remembered expansion state. A Ding is one line when related and a full Tafel when it *is* the Subjekt.
  You do not set depth; you walk — and walking is stateless, so nothing the techie does changes what the
  stoner sees tomorrow on the same account.
- **M2 · The cursor is a continuum, not a switch.** The slider moves one variable. **At every position the
  screen has the same sections, the same rows and the same controls**; only the columns and the sentence
  change content. The snap ladder makes it usable at 2 a.m., 40 px magnetic zones, any position between
  reachable by a deliberate finger, resolved moment printed as you drag.
- **M3 · Pause is the disclosure gesture, default inverted.** Rest is already the unfolded state and motion
  is what collapses it. While the handle or the chart crosshair moves, the diff table collapses to a
  two-line **pinned scrub header** at reserved fixed height, so nothing reflows under your thumb. On
  release it unfolds again, describing where you landed.
- **M4 · Reveal by capability and by data.** Sockets from `hardwareInfo.sockets` per role, never the
  three-bucket `deviceControlCapability()` that returns `'full'` for a heater-only tent; a humidity `ziel`
  is **not created** without a `dehumidifier` role; a missing key (old firmware) fails **closed** with
  `Gerät meldet keine Steckdosen — Firmware zu alt.` Zero `pflanze` Dinge ⇒ „Pflanze" appears in exactly
  one place: the `+` on `Im Zelt`. One `mensch` ⇒ no `Wer?` row anywhere. Zero `geraete` ⇒ no `geraet`,
  `dose` or `kamera` art anywhere. **None of these is reversible through a setting, which is what makes
  them not modes.**

### 8.1 `<tc-zeitgriff>` — 56 px, directly under the sentence block, identical position on every Tafel

**It moves `Vorher`.** What `Vorher` *can be* depends on the Ding, and this is the only rule:

> **A Ding that has a state diffs against a moment. A Ding that is a moment diffs against its predecessor.**

| Subjekt | The handle scrubs | Detents |
| --- | --- | --- |
| `zelt` `geraet` `dose` `pflanze` `kamera` `ziel` `schema` `lauf` | a **moment** in this Zelt's history | Beginn · Phasenwechsel · 1 Woche · gestern · gestern Abend* · letzte Gabe · letztes Foto* · Lauf n · seit zuletzt |
| `gabe` `notiz` `bild` `ereignis` `phase` | the **predecessor chain** — the previous Gabe to the same plants, the previous frame, the previous stage | each predecessor is a detent |
| `mensch` | that person's **previous visit** | their own entries |
| `film` | the film's own playback position | chapters |

\* **Every detent appears by data.** `gestern Abend` needs a measured lights-off boundary from `out_light`,
or a hand-typed `licht_plan`; with neither it is **absent**, and `letztes Foto` occupies its slot when
photos exist. `Lauf n` appears the moment a second `lauf` exists (§3.2). The day a controller is claimed,
`gestern Abend` appears by itself the morning after the first measured boundary — reveal by data, both
directions.

**Snapping.** A sensor has a value at every instant; a hand log does not. So:

> **The detents are the moments this Zelt can tell apart.** With 5-second samples that is every minute; with
> only entries it is every entry — and the cursor resolves to the newest Ding at or before the raw handle
> position, printing the provenance when it moved: `Sa 23.08. 19:10 · Tag 1 (letzter Eintrag davor)`.

**Dichteband** — 12 px behind the track, one bar per day, stacked and normalised per source (§6.3): Dinge
below, kept frames above. You can see where there is something to compare against, and gaps stay visible
instead of being stretched away. A week you did not touch the app is a visible gap, which is the point.

**The three projections of the one cursor**, both directions:
1. **the body** — the Vorher `Beleg`, the Vorher column, the sentence;
2. **the `Verlauf` list** — rows older than `von` dim to 45 % below a hairline labelled
   `Vorher · Fr 22.08. 14:02`, and **tapping any row sets the cursor to that row's time**, which is how you
   ask „was ist seit dieser Gabe passiert?" in one tap;
3. **the chart** — window `[von, jetzt]`, crosshair writes back to `von`.

Also writing to the cursor: a film-strip thumbnail, an annotation-rail mark, and **`Nächster Unterschied ›`**
(F3), which jumps `von` to the next moment at which **this Ding** changed by more than its own σ floor.
Device-less it lands on entries; when there is no next one it replies
`Kein weiterer Unterschied — es wurde nichts aufgezeichnet.` and leaves the cursor where it is.

**What pause unfolds.** Scrub header while dragging, reserved height, two lines:

```
Fr 22.08. 14:02 · Tag 31 · 24,1 °C · 61 % rF · Licht 100 %      (with a device)
Bild behalten · Schärfe 0,71 · belichtet ×1,04 · 2 Dinge ±2 Std

Fr 22.08. 19:40 · Tag 31 · 2,0 l · pH 6,1                        (device-less)
3 Einträge · Anna · Foto 19:42
```

On release the table unfolds and gains rows that only mean something once you have deliberately stopped:

```
Damals galt:    Blüte Tag 12 · Biobizz All-Mix Schritt 6 · Lichtplan 12/12
Lief:           Licht 100 % · Entfeuchter an                     (device only)
Dinge ±2 Std:   Gabe 2,0 l (Anna, 19:40) · Foto (19:42) · Notiz „Blätter hängen"
```

**`Damals galt:` is the last-known-value carry-forward printed as prose**, and it is the best argument that
hand entries are a real state: the app can tell you what was true on a Tuesday in July because you said so
once, in June. `Lief:` is absent with no device — it is not replaced by a lookalike, because
`Geplant: Schritt 4` is a different statement, and it lives in `Damals galt:` where it belongs.

Nothing is persisted; it self-cancels on the next touch.

**Performance.** Drag renders at 60 fps from already-loaded `vorschau` thumbnails and series; server refetch
debounced 250 ms; every derived array behind the existing `KeyedCache` or `ngFor` rebuilds the DOM on every
change-detection cycle. Desktop: same control, diff table two columns wide on the left, chart pinned right,
both on the same cursor; `←`/`→` one detent, `Shift+←` one hour, `Space` toggles the collapse.

### 8.2 Honest audit of the no-modes claim

*The slider* — not a mode: same sections at every position, one variable, printed value, session-scoped.
*Collapse-while-dragging* — the inverse of a mode; reserved height means it cannot hide anything.
*`Δ` chip* — re-renders one image, same level as pinch-zoom. *`Werte {…}`* — same row, same position, every
Tafel, from install, for everybody. *`⋯ 340 weitere`* — cursor pagination of one ordered list.
*The `→` remedy line* — **the closest call**: a user can go weeks without seeing one and then meet an
element they have never met. It hides no feature class, but its *presence* is conditional on neither
hardware nor data volume. Mitigation: styled as an ordinary Zeile inside the sentence block, rule id
printed and resolvable in `Werte`.
*`geraete: []`* — data, not preference; changed only by claiming hardware; not reversible through a setting.

---

## 9. The sentence generator — one ladder (D5)

Deterministic, ranked, computed **once per screen entry** — it does not re-rank while you look at it. The
first two matches compose with „ und " (second clause lowercased), ≤ 90 chars, else one clause. Exactly one
sentence per screen.

**Eight ranks, one order, one implementation.** Which ranks can match is decided by what evidence exists,
never by an account flag. Ranks 1, 2 and 5 simply never match with no device — they are **not evaluated**,
not greyed, not „keine Daten".

| # | Trigger | Device | Device-less |
| --- | --- | --- | --- |
| 1 | camera still > 3 h | `Seit 3 Std 12 kein Bild.` | never matches |
| 2 | Zelt offline ≥ 30 min | `Das Zelt war 2 Std offline.` | never matches |
| 3 | **growth** | `gruenanteil` ±3 pp → `Die Pflanzen sind gewachsen.` / `Im Bild ist weniger Grün als vorher.` | `messwerte.hoehe_cm`, ≥ 2 readings in the span → `Aus 4 cm sind 7 cm geworden.` |
| 4 | a measure beyond its σ | Influx, σ₁₄ same time of day ±1 h → `Nachts war es wärmer.` | a hand `messwerte` measure, **≥ 3 readings in 14 days**, σ over the last 14 → `Der pH ist von 6,3 auf 5,9 gefallen.` Below three: no clause. |
| 5 | tile change ≥ p90 | `Im Bild hat sich vor allem oben links etwas verändert.` | never matches — hand photos are shown, not measured |
| 6 | a `ziel` changed in the span | `ZielStand` | `ZielStand` with `quelle:'hand'` — same mechanism |
| 7 | a human Ding in the span | `Anna hat gegossen.` | **template table widened**: `gabe` → „Anna hat gegossen." · `phase` → „Die Blüte hat am 12.09. angefangen." · `notiz` → „Du hast zwei Notizen geschrieben." · `bild` → „Du hast drei Fotos gemacht." · `pflanze` → „A4 ist dazugekommen." · `zustand` → „Ben hat einen Zettel hinterlassen." |
| 8 | nothing above matched | **see §9.2** | **see §9.2** |

The **`(von Hand)`** suffix on a value line is not new syntax — it is §3.1's provenance rule with one more
source name.

### 9.1 Why one ladder and not two

C51's ranks are a table of triggers and templates. Device-lessness changes *which rows can fire* and *what
rank 3, 4 and 7 read*, which is a data change to that table. Two ladders would mean two rank orders, two
i18n key sets, two sets of edge cases in the „≤ 90 chars, compose with und" logic, **and a third undefined
behaviour on the mixed Zelt where both could match.** The mixed Zelt is not an edge case; it is where every
upgraded account lives forever.

### 9.2 Rank 8 — the empty day (D6)

All four source documents landed on some form of `Seit gestern hast du nichts eingetragen.` **Rejected.**
An app that reports on your diligence every time you open it is deleted in week three, and rank 8 is the
line the daily visitor sees most.

> **Rank 8 never comments on the user. It recalls, in this order, and the diff table underneath still shows
> every delta, so nothing is lost when the sentence is quiet.**

| 8a | a previous `lauf` exists at the same day number | `Im letzten Lauf warst du an Tag 34 zwei Tage weiter.` — and the Vorher half resolves to **last run's photo at day 34**, which is the run-over-run comparison, free (§3.2) |
| 8b | a Schema is chosen | `Als Nächstes: Schritt 5 · Bio-Bloom 2 ml/l.` |
| 8c | any earlier evidence exists | `Zuletzt eingetragen am Freitag: 2,0 l und ein Foto.` — and the Vorher half resolves to **that day**, not to the cursor's empty moment |
| 8d | with a device, nothing changed | `Seit Freitag hat sich wenig geändert.` |
| 8e | genuinely nothing, ever | `Dein Tagebuch fängt heute an.` |

8a and 8c both **move the Vorher half to the last moment that has evidence**, so the screen shows you
something rather than reporting an absence. That is the third option all four documents said they could not
find.

### 9.3 The deterministic remedy table — the `→` line

**Rules, not an advisor.** Each names what was measured, what mechanism we own and one concrete change, and
each walks to a Ding. **A rule that cannot name a mechanism produces no line at all.** At most one `→` line
per Tafel, styled as an ordinary Zeile inside the sentence block, rule id printed and resolvable in `Werte`.

**Hard boundary: remedies are about the tent and the kit, never about the plant. No rule reads a picture as
evidence about a plant.**

| Id | Trigger | The line | Walks to | Device-less |
| --- | --- | --- | --- | --- |
| **N-3** | night mean > `night.temperature` + 1,5 °C on ≥ 3 of the last 5 nights **and** no socket role can cool | `Nacht-Ziel steht auf 21,0 °C und Abluft ist keine Dose. Was du tun kannst: Licht dimmen (jetzt 100 %).` | `Licht (PWM)` | silent |
| **N-4** | night target within 1,5 °C of day target | `Nacht-Ziel 24,5 °C liegt nur 0,5 °C unter dem Tag-Ziel. Üblich sind 3–6 °C Absenkung.` | `Ziel Nacht-Temp.` | silent |
| **H-1** | heater duty ≥ 90 % over ≥ 2 h **and** measured < target − 1,0 °C throughout | `Die Heizung lief 2 Std 40 ohne Pause und es blieb 1,4 °C zu kalt. Die Heizleistung reicht nicht — oder die Dose schaltet nicht.` | `Heizung (Dose 1)` | silent |
| **H-2** | socket on ≥ 6× in 24 h **and** the controlled measure's 10-min slope after switch-on ≤ 0 in ≥ 5 of them | `Die Heizung hat heute 7× geschaltet und die Temperatur ist danach nie gestiegen. Prüf, ob am Stecker etwas hängt.` | `Heizung (Dose 1)` | silent |
| **L-1** | `out_light > 50 %` for 15 min while frame brightness sits in the lights-off band, or the inverse | `Das Licht sollte an sein, das Bild ist dunkel. Prüf die Lampe oder die Dose „Licht".` | `Kamera` | silent |
| **E-1** | `dehumidifier` duty ≥ 80 %/24 h **and** `workmode ∈ {temp, breed}` | `Der Entfeuchter lief 19 Std 20 von 24. In der Betriebsart „temp" kühlt diese Dose — sie entfeuchtet nicht.` | `Entfeuchter (Dose 2)` | silent |
| **V-1** | VPD outside the stage band ≥ 2 h/day while temperature is inside its band | `VPD 1,62 kPa liegt über dem Blüte-Band 1,2–1,5. Bei 25 °C wären dafür 62 % Feuchte nötig statt 48 %. Eine Dose mit der Rolle „Befeuchter" kennt die Firmware nicht.` | `Ziele` | silent |
| **K-1** | no `jpeg` frame > 3 h **and** the device is online | `Seit 3 Std 12 kein Bild, obwohl das Zelt online ist. Das Problem liegt an der Kamera, nicht am Controller.` | `Kamera` | silent |
| **D-1** | Influx gap ≥ 30 min **and** no frames in the same window | `Zwischen 03:12 und 05:22 fehlen Messwerte und Bilder. Das Zelt war offline.` | `Controller` | silent |
| **F-1** | Schema step due, no `gabe` since | `Schritt 5 des Schemas ist seit 2 Tagen fällig.` | opens `Gabe`, prefilled | **fires** |
| **Z-1** | a `ZielStand` changed inside the compared span | `Das Tag-Ziel wurde am 24.08. von 24,0 auf 25,0 °C geändert. Werte davor sind gegen 24,0 gemessen.` | that `ziel` Ding | **fires** for `quelle:'hand'` rows |

V-1's bluntness is deliberate: `SOCKET_ROLES` is exactly `dehumidifier, heater, light, secondary_light,
co2`. **The tent cannot humidify and cannot actively cool.** Naming that is more useful than a nudge nobody
can act on.

**Device-less, nine of eleven rules are silent and no substitute is invented.** When a device-less user
hand-logs 31 °C, a rule *could* fire as „ein Controller hätte das gemerkt". It does not: silence beats an
advertisement for the same reason it beats a guess. **That restraint is the discipline, not a gap in it.**

---

## 10. The chart — `/z/:zelt_id/chart` (D7)

**One chart. One data endpoint. Two densities. No fork.**

**The chart is the third projection of the cursor.** Its x-window is `[Vergleich.von, jetzt]`, always, and
its crosshair *writes back* to `Vergleich.von`. That is the only reason a separate chart screen is allowed
to exist in a Ding-only IA.

### 10.1 `GET /api/reihen` — the one series endpoint

```ts
interface Reihe {
  schluessel: string;                 // 'temperature' | 'humidity' | 'vpd' | 'co2' | 'out_light'
                                      //  | 'ph' | 'ec' | 'tds' | 'hoehe_cm' | 'wasser' | 'ppfd' | …
  einheit: string;
  quelle: 'geraet' | 'hand';
  traeger: 'stetig' | 'ereignis';     // carry-forward state vs discrete events — decides the mark spec
  punkte: [t: number, wert: number][];
  luecken?: [von: number, bis: number][];   // spans the server knows are gaps, not zeroes
}
```

Two adapters behind one endpoint: **Influx** for device series, **Mongo/LKV-over-`dinge`** for hand series
(`notiz.d.messwerte`, `gabe.d.ph/ec/ablauf_*/wasser_l`, `ZielStand`). **The chart cannot tell them apart
except through `quelle` and `traeger`**, which drive exactly two rules (§10.2). One endpoint, one shape,
both densities, and no second implementation of anything.

The existing Highcharts page consumes plain JSON rows over HTTP (`data.service.ts:110,129`) and already
draws `type:'column'` (`charts.page.ts:809`), so **the Highcharts fallback stays alive** and remains our
schedule slack (§20). C's claim that it "cannot render bars from Mongo" is false and cost C its own slack.

### 10.2 Two mark-spec rules, both densities, no special case

> **Rule 1 (`traeger`):** a `'stetig'` series draws as a line or step-line; an `'ereignis'` series draws in
> a **bar lane**, one bar per event, bar length = the value. `Wasser` is an event, not a level, and a line
> between two waterings draws a litre-per-hour that never existed.

> **Rule 2 (the dashed-gap rule):** any gap larger than **3× the median sample interval of that series** is
> drawn as a **dashed connector**, never as a solid line. `connectNulls: false`, sampling off for hand
> series.

Rule 2 is not a device-less special case. It is the rule the chart needed anyway for D-1, and it says the
same true thing about an offline device and about two pH readings four days apart: *we joined these dots, we
did not measure between them.*

### 10.3 The device chart

```
│ ← Zelt Keller · Verlauf      Fr 22.08. 14:02 – jetzt │
│ [96px Bild] Fr 22.08. 14:02 · Tag 31 · 24,1 °C · 61 %│ pinned scrub header,
│ ▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓▓▓░░░░▓▓▓▓▓▓▓  Filmstreifen 44 px   │ NOT a tooltip; shares
│ Temperatur °C      88 % im Band · längste Abw. 41 Min│ the cursor
│ 28 ┤▨▨▨▨▨░░░░░░░░░░▨▨▨▨▨▨   Tag/Nacht aus out_light   │
│ 24 ┤╌╌╌╌╌┐└╌╌╌╌╌╌╌╌  Sollwert AUS ZielStand, Stufe   │
│ 20 ┤ ╱‾╲__╱‾‾╲___╱‾╲__      am 24.08. 19:04          │
│ Luftfeuchte %  ·  VPD kPa  (eigene Panels, shared x) │
│ Ausgänge  Licht ████████  ████████ · Heizung ▓ ▓▓ ▓  │
│ ▪ ▪▪  ▪▪③   ▪  ← Menschen   ▲   ▲    ▲ ← Gerät       │
```

- **Sollwert** is a stepped dashed `markLine` from **`ZielStand`**, not from today's `configuration`. Where
  no row predates the window the line is dotted and the axis prints `Ziel unbekannt vor 14.09.` (F4).
- **Zielband** `markArea`, one source at a time, labelled: alarm thresholds > Sollwert ± Toleranz > the
  stage's `vpdRange` > **the Schema step's `ph_bereich`/`ec_ziel`**.
- **Tag/Nacht** from measured `out_light > 0`, in the Zelt's `zeitzone` — a failed contactor renders as a
  **missing band**, diagnostic rather than decoration.
- **Ausgänge** in a state-timeline lane: region length = duration, null = gap, never 0/1 value lines.
- **Annotation rail** below the axis, two rows (people / machine), 10 px clustering with count badges,
  full-height dashed lines for `phase` starts. **Tapping a mark makes that Ding the Subjekt.** No hover.
- **Verdict strip** computed **server-side on raw Influx samples**, never `aggregateWindow(mean)`, split
  Tag/Nacht, longest excursion as a duration, greyed below 80 % coverage with the coverage printed.
- `sampling:'minmax'` on the primary series — LTTB smooths away exactly the bang-bang oscillation the grower
  is looking for; LTTB for the navigator only.
- **Prerequisite, not a feature:** parameterise the raw Flux interpolation of `measure`/`from`/`to`/
  `interval` (`data.service.ts:80-89`), move `limit(n:50000)` before `yield()`, constrain interval by
  timespan so `3y × 5s` is unreachable.

### 10.4 The same chart with no device

Same route, same library, same cursor coupling, same interaction contract, same renderer. Different panels,
because the panel list is `GET /api/reihen`'s response.

```
│ ← Zelt Keller · Verlauf      Sa 22.06. – jetzt (Tag 61)│
│ [96px Foto] Fr 22.08. 19:40 · Tag 58 · 2,0 l · pH 6,1  │  pinned scrub header
│ ▓ ░░ ▓ ░░░ ▓ ░ ▓▓ ░░░░ ▓ ░ ▓  Fotostreifen 44 px       │
│ ▨▨ Keimung ▨ Wuchs ▨▨▨▨▨▨▨▨ Blüte ▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨    │  Phasenbänder, full height
│ Wasser l  ·  23 Gaben · ⌀ alle 2,6 Tage · Pause max 6 d│
│  4 ┤    ▌   ▌  ▌    ▌▌   ▌   ▌  ▌▌   ▌     ▌           │  Balkenspur (traeger:'ereignis')
│ pH  ·  17 von 23 Gaben mit pH · Band 6,0–6,5 (Schema)  │
│  7 ┤▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨  markArea, gestuft       │
│  6 ┤ ●╌╌●──●╌╌╌╌●─●──●───●──●   ○ = Ablauf-pH          │
│ EC mS/cm · Ziel 1,4 + dein Leitungswasser              │
│ Höhe cm (von Hand)                                     │
│ ░░░ Lichtplan 18/6 — nach Plan, nicht gemessen ░░░     │  hatched, only if typed
│ ▪ ▪▪  ▪▪③   ▪  ← Menschen                              │  machine row absent
└────────────────────────────────────────────────────────┘
```

- **Background shading is `phase`, not a fabricated photoperiod.** Full-height `markArea` from `phase`
  Dinge, stage name at the top, same renderer, same place. **Never fabricate a photoperiod from a phase.**
- **`licht_plan`, if typed, is drawn hatched and labelled `nach Plan, nicht gemessen`, never solid.** Unset
  ⇒ no band at all and the axis prints `Kein Lichtplan eingetragen`. **The day a controller reports its
  first `out_light` sample, the hatch turns solid and the legend reads `ab 14.09. gemessen`. The band does
  not move; only its texture changes.**
- **The target band comes from the Schema step**, `markArea`, stepped at the **feed events** that advanced
  the step (not the calendar), labelled with its source: `Band 6,0–6,5 (Biobizz All-Mix, Schritt 6)`. This
  is F4's mechanism with a different source: a target that has history, drawn as a staircase, never
  back-projected.
- **Runoff** (`d.ablauf_ph`, `d.ablauf_ec`) as **hollow markers on the same axis as the input values** —
  input versus runoff on one axis is the device-less grower's only closed feedback loop, and it is free.
- `ec_basis: 'plus_leitungswasser'` draws at `ec_ziel + zelt.d.leitungswasser_ec` and the axis prints
  `Ziel 1,4 + dein Leitungswasser`; with no tap-water EC recorded the line is **dotted** and prints
  `Leitungswasser unbekannt` — never a bare number.
- **The verdict strip is counts, not percentages, below 30 samples.** `88 % im Band` over nine readings is a
  lie. `pH 17 von 23 Gaben im Band · 2 darunter`; `EC zu wenige Messungen (2)` greyed below four points.
  Above 30 samples with continuous coverage it returns to the percentage form with coverage printed.
- **The annotation rail's machine row is not rendered** with no device — reveal by data.
- **Absent panels are not drawn.** No grey placeholder axis, no `— Gerät`, no „jetzt freischalten", no
  button. One line at the bottom of `Werte {…}` says what the sources were; that is all (§18).

---

## 11. Photos, camera, film

### 11.1 Capture

`<input type="file" accept="image/*" capture="environment" multiple>` behind `[ Foto ]` — the control
`diary-entry-modal.component.html:126-127` already ships. **No Capacitor camera plugin**: `@capacitor/core`
is scaffold-only in this repo (no `android/`, no `ios/`).

```
┌─ Foto ────────────────── heute 08:40 ✎ ──────┐
│  [ Kamera ]        [ Aus der Galerie ]       │
│  ▣ ▣ ▣                          3 gewählt    │
│  An      [ Ganzes Zelt ]  A1   A2   A3       │  only if pflanze Dinge exist
│  ┌──────────────┐  Letztes Foto von A1,      │  ← Ausrichthilfe
│  │ [Foto Tag 28]│  vor 6 Tagen.              │
│  └──────────────┘  [ Behalten ] [ Nochmal ]  │
│  [             Eintragen             ]       │
└──────────────────────────────────────────────┘
```

**Ausrichthilfe** (optional, never prompted): a ghost overlay *inside* the camera would need `getUserMedia`,
a permission prompt and worse pictures than the native camera. So it happens **after** the OS camera
returns: the new photo blended 50 % with the previous photo of the same `pflanze`, `[ Behalten ]` /
`[ Nochmal ]`. It is the difference between a watchable `Rückblick` and a slideshow of random angles, and it
is the one thing in this product a camera roll cannot do.

**The `✎` on the sheet header is the timestamp editor** (D23) — see §12.2. It is on all four sheets.

**Client-side before upload, not optional:** canvas resize to ≤ 2048 px long edge, `toBlob('image/jpeg',
0.82)` → ~400–700 KB. `express-fileupload` is mounted with **no size limit** (`app.ts:85`) and `Image.data`
is a `Buffer` in a 16 MB-capped BSON document while a phone photo is 4–8 MB, so the server re-clamps with
`sharp().resize(2048).jpeg({quality:82})` and the mount gains
`limits: { fileSize: 12 * 1024 * 1024 }, abortOnLimit: true`. The 320 px `vorschau` is written in the same
pass.

Each photo becomes a **`bild` Ding** — the same projected art as a camera frame, one art, two sources,
distinguished by `Image.format` (`'jpeg'` vs `'user/jpeg'`). `t` = EXIF capture time when present, else the
sheet's timestamp. Nothing new in the Ding grammar.

### 11.2 `auto_bild` (D14)

Server-filled, **display only**: the `beleg()` ladder — nearest kept frame ±5 min, else nearest user photo
±12 h, else absent. Every consumer already handles absent. The rule and its windows are printed in
`Werte {…}`.

**`auto_bild` is never used as evidence.** The double-feed guard shows only a photo attached to *that* `gabe`
(`Ding.bilder`), because an hours-wide nearest-neighbour guess is not evidence of anything (§13.4).

### 11.3 Storage and the quota (D16)

`thinImageRange` filters `format: 'jpeg'` (`image.service.ts:417`), so **user photos are never thinned and
never auto-deleted** — a photo you took *is* the diary. That makes a free account a monotonically growing
blob store with no revenue behind it, so it gets a real limit, stated in the product rather than met as a
500:

- **1 000 photos per Zelt.** At ~500 KB that is ≤ 500 MB worst case, and it is about four full runs.
- Printed on `Werte {…}` like every other number: `Bilder 84 von 1 000 · 41 MB`.
- At 90 % one Zeile appears in `Werte`: `Bilderspeicher fast voll — JSON/CSV-Export sichert deine Einträge,
  die Bilder lädst du hier herunter ›`.
- At the cap `[ Foto ]` **relabels** — it does not disappear — to `Bilderspeicher voll ›`, walking to a
  screen that offers downloading and deleting photos and nothing else. **It does not mention the
  controller.** A device does not raise this cap, and pretending hardware fixes a storage cap would be the
  product's first dishonest string.

**The real answer is object storage, and it is not in v1** (§22, owner decision pending). `Image.data` as a
BSON `Buffer` does not survive being a photo product at scale; the quota and the downscale delay the
problem, they do not solve it.

### 11.4 What is refused for hand photos

**No `Bildmass` beyond `schaerfe`.** No `phash`, no `kacheln[48]`, no `gruenanteil`, no `dx/dy`, no
`helligkeit`, no `licht`. Consequences, stated rather than hidden: **no `Blattfläche` device-less**, no
change map, and sentence ranks 3 and 5 re-sourced or silent. **A refusal, not a backlog item.**

**And the honest caveat nobody else printed:** two hand-held photos from two distances in two lights are
**not** a controlled comparison, and on screen they look identical to a fixed-camera pair that is. The
product says so in exactly two places and never again: the caption's third slot always reads `Foto` (so the
pair is self-documenting forever), and `Werte {…}` carries one line —
`Handfotos werden nicht ausgerichtet und nicht vermessen.` The Ausrichthilfe is the design answer; the
caveat is the honest one.

### 11.5 The film pipeline — one implementation, two recipes (D13)

`Film` (camera) and `Rückblick` (hand photos) are **one ffmpeg pipeline** with a recipe object. Both produce
a `film` Ding and both are stored in the same GridFS bucket. They are two names because they are two
different things and one word for both would be a lie — but they are not two implementations.

| | **Film** (camera frames) | **Rückblick** (hand photos) |
| --- | --- | --- |
| Frame selection | **golden windows** — lights-on +1 h/+4 h/+7 h/+10 h, ±20 min, from `daynight` or the measured `out_light` rise, **so the windows move when the grower flips 18/6 → 12/12**; best un-culled frame per window; budget **600 keepers** | all photos up to 200; above that one per day by highest `schaerfe`; hard cap 200 |
| Cull | `licht_aus` · `kurzzeitig` · `unscharf` · `doppelt` (dHash Hamming < 3) · `kamera_bewegt` · ±5 min of a human Ding | **`doppelt` only** — two shots seconds apart, keep the sharper. A photo a human chose to take is wanted by definition. |
| Pacing | `-framerate 24` → 600 frames = **25 s** | **concat demuxer, 1,5 s per photo, 250 ms crossfade** — the burned-in date must be readable, which is the whole point of burning it in |
| Normalisation | grey-world gain, luminance pulled to the rolling median of the previous 7 keepers, **clamped ±8 %** | same, **clamped ±20 %** (keepers days apart, kitchen light vs LED); report says `Farben angeglichen` |
| Geometry | accumulated integer `(dx,dy)` SAD stabilisation via `sharp.extract()` on a 96 % window; high residual ⇒ a new **Kapitel** with a 6-frame black gap and `Kamera verrutscht · 12.09.` | **no stabilisation** — translation-only SAD is worthless when the phone moved 40 cm. Instead `sharp().resize({ fit: 'contain' })` **letterboxing** to one 1280×960 canvas on a neutral ground, because portrait and landscape *will* be mixed. |
| Gaps | encoded as time, not as a hole | an empty bucket holds the previous frame for 2 s under `— 6 Tage ohne Foto —` |
| Burn-in | SVG composite per frame (the `addOfflineOverlay` technique, `image.service.ts:127`, ~8 ms/frame): bottom-left `Blüte · Tag 34 · 25.08. 14:02 · 24,8 °C · 58 % · VPD 1,29`, bottom-right any Ding within **±10 min**, plus a 3 px progress bar | same composite, bottom-left `Blüte · Tag 34 · 25.08.`, bottom-right any Ding within **±12 h** (a hand photo is not minute-accurate) |
| Cull report, as UI | `2 148 aufgenommen − 1 106 Licht aus − 289 außerhalb der Fenster − 41 Hand im Bild − 22 unscharf − 9 Kamera verrutscht = 600 Bilder → 25 Sek bei 24 B/s · 2 Kapitel` | `31 Fotos · 0 verworfen · 1 pro Tag ab Tag 40 = 24 Bilder → 36 Sek · 1 Kapitel · Farben angeglichen` |
| Encode | **identical**: `ffmpeg -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -crf 23 -vf scale=1280:-2 -movflags +faststart` | identical |

**The x264 switch replaces `libx265` at `image.service.ts:583`, in the existing rolling timelapses too.**
HEVC in mp4 does not play in Chrome or Firefox; today's shipped timelapse is invisible to most customers who
have one, and that is a two-line fix worth doing whichever half of the product you build first. **It changes
the output of a shipped feature — §22, owner approval.**

**Storage.** `Image.data` is a BSON `Buffer` capped at 16 MB and there is no GridFS in `server/src`. v1 adds
one: `new GridFSBucket(mongoose.connection.db, { bucketName: 'filme' })`. Mongoose already exposes the
native `Db` handle, so this is **no new dependency and ~30 lines**: ffmpeg's stdout pipes into
`bucket.openUploadStream()`, and the download route resolves an HTTP `Range` header to
`bucket.openDownloadStream(id, { start, end })`.

**Three real routes off the phone**, and the UI says which one you get:
`navigator.share({files:[File]})` where supported; `<a download>` on Android and desktop; on iOS without
Web Share the video opens in a tab under the line `Lange drücken → „In Fotos sichern"`. A share that
produces a login wall is not a share.

Retention: `filme` until deleted, raw camera frames 90 days, `Bildmass` with the frames, **user photos
forever**.

### 11.6 The cull, `Bildmass` ingest, and the two camera alarms

`sharp` 0.34.5 and ffmpeg are already dependencies and already invoked via `execFile`. **No new binary, no
ML runtime.** Per camera frame at ingest, ≤ 60 ms: downscale to 128×96 grey and 64×48 raw; `licht` from
`out_light` at `t ± 60 s` (**the cross-modal join — nobody else owns the lamp**); `helligkeit` = mean;
`schaerfe` = 3×3 Laplacian variance; `phash` = 8×8 dHash; `dx/dy` = integer SAD ±8 px; `kacheln[48]` = mean
abs diff per tile of an 8×6 grid; `kurzzeitig` = one-frame-lookahead transient test plus rejection of any
frame within ±5 min of a human-authored Ding; `gruenanteil` = fraction with `G > R+τ` and `G > B+τ`.

Limits stated in the UI as well as here: `schaerfe` cannot tell fog from a defocused lens and is reported as
`unscharf`, never as a cause; `dx/dy` is **translation only**, so a rotated camera is *detected* and becomes
a chapter break, not a correction; `kacheln` says **where**, never **what**; the transient test is blind
above ~60 s; `gruenanteil` is labelled `Blattfläche (Bildanteil)` — never cm, never „Wachstum" as a claim.
**Refused as computer-vision fantasy at every version:** naming a drooping leaf, diagnosing a deficiency from
colour, height in cm, counting plants, segmenting canopy, detecting pests.

**Two alarms**, created by default the moment a camera is paired, cloud-side, no firmware. They reuse
`Alarm` storage and `handleAlarmAction` but need an ~80-line evaluator ticker, because `alarm.service` only
evaluates on inbound MQTT and neither is a sensor threshold. (1) No `jpeg` frame for > 3 h. (2) `out_light >
50 %` for 15 min while frame brightness sits in the lights-off band, or the inverse. **The second is the
thesis in one alarm: neither the picture nor the data can detect a failed contactor alone; together they
detect it in fifteen minutes.** Both are absent device-less and **no substitute is offered.**

---

## 12. Watering, fertilising, and the Schema — the spine of the free product

**Not one line of this section reads a device. It is bit-for-bit identical at all three densities.**

### 12.1 The `Gabe` sheet

```
┌─ Gabe ───────────────────── heute 19:40 ✎ ────┐
│  An      [ Ganzes Zelt ]  A1   A2   A3        │  ← only if pflanze Dinge exist
│  ╭───────────────────────────────────────╮    │
│  │  ● ● ● ○ ○ ○ ○ ○      3 Kannen · 6,0 l│    │  ← TAP = one can, 72 px tall
│  ╰───────────────────────────────────────╯    │     long-press = −1
│  Kanne  2,0 l ▾            ☐ bis Ablauf       │  ← kanne_l remembered per Zelt
│  6,0 l gesamt  ·  ( je Pflanze )              │  ← verteilung. Default: gesamt.
│  Bio-Bloom  2,0 ml/l   Bio-Heaven  1,0 ml/l   │  ← prefilled from the Schema step
│  aus „Biobizz All-Mix · Blüte Woche 2"        │
│  pH — · EC — · Ablauf pH — · Ablauf EC —      │  ← always here, never required
│  Notiz ………………  📷 Foto                        │
│  Wer?   ( Anna ) ( Ben ) ( ich )              │  ← only if ≥ 2 mensch Dinge
│  ⚠ Anna hat A1–A3 vor 1 Std 30 gegossen       │
│    (2,0 l).                  [ Bild ansehen ] │
│  [        Trotzdem eintragen         ]        │
└───────────────────────────────────────────────┘
```

| Path | Sequence | **Taps** |
| --- | --- | --- |
| Routine water, volume unchanged | `Gabe` → `Eintragen` | **2** |
| Same, guard fires | `Gabe` → `Trotzdem eintragen` | **2** |
| Feed on the Schema's step (doses prefilled) | `Gabe` → `Eintragen` | **2** |
| Club member, actor remembered on this phone | `Gabe` → `Eintragen` | **2** |
| Club member, first time on this phone | `Gabe` → `Anna` → `Eintragen` | **3** |
| Three cans instead of two | `Gabe` → counter ×3 → `Eintragen` | **5** |
| Two plants only | `Gabe` → `Ganzes Zelt` → `A1` → `A3` → `Eintragen` | **5** |
| Back-dated to yesterday evening | `Gabe` → `✎` → wheel → `Eintragen` | **5** |
| Full club record with pH/EC in and out | + four number pads | **~15** |

Litres are derived from taps and shown, never typed. The 2-tap and 15-tap paths are the same sheet in the
same order; they differ only in how far down you choose to go.

### 12.2 The timestamp editor `✎` (D23)

Every sheet header reads `heute 19:40 ✎`. Tapping `✎` opens a date+time wheel, defaulted to now, bounded by
`lauf.t` at the low end and now at the high end. It writes `Ding.t`; the server stamps `erfasst_at`
independently. A back-dated entry renders in `Verlauf` at its `t` with a `13 px` muted suffix
`nachgetragen`, and the double-feed guard's window arithmetic uses `t`, which is the only reason it is
correct at all for a grower who logs on the way home.

This is table stakes — every competitor has it — and it was missing from all four source documents while
they discussed timestamps constantly.

### 12.3 The Schema

Selected on the create sheet (§7.2), stored on `Zelt.d.schema_id`, projected as the `schema` art with its
own Tafel. A Mongo content collection, **never in the bundle**:

```ts
Schema { schema_id, label: "Biobizz All-Mix", medium_text: "All-Mix — stark vorgedüngt",
         duengen_ab_woche: 3,
         schritte: [{ index, anker: 'woche'|'phase_woche'|'gabe_n', phase?,
                      produkte: [{ name, ml_pro_l?, bereich? }],
                      ec_ziel?, ec_basis: 'absolut'|'plus_leitungswasser', ph_bereich? }],
         quelle_url, geprueft_am, art: 'hersteller_pdf'|'hersteller_rechner'|'herrenlos' }
```

- **The step advances by feed events, not wall clock** — `Schritt 7 von 14` with a soft calendar mapping
  (`etwa Woche 5`). Growers feed Tuesday and Friday and slip. That decision was taken for horticultural
  reasons and it happens to make the whole feature work with zero telemetry, by construction.
- Before `duengen_ab_woche` the sheet prefills **no products** and prints `All-Mix ist vorgedüngt — bis
  Woche 3 nur gießen.` **The only place the product refuses to fill something in**, and the „it thinks for
  me" payoff — needing no sensor.
- Every prefilled value stores `aus_schema: true`; the moment it is edited, `false`. Months later the report
  says `wie im Plan` vs `abweichend` — the club's actual question.
- EC canonical in mS/cm; `plus_leitungswasser` renders as `EC-Ziel 1,4 + dein Leitungswasser`, never a bare
  ppm. **`zelt.d.leitungswasser_ec` is asked exactly once**, the first time a user types an EC value into a
  `Gabe` — reveal by data, never a settings screen:
  `Dein Leitungswasser [ 0,4 ] mS/cm · Damit rechnen wir dein EC-Ziel aus. Kannst du leer lassen.`
  Autoflower gets a `×0,25–0,5` multiplier and no 12/12 flip; no manufacturer chart has an auto column.
- Seed set: Biobizz Light-Mix, Biobizz All-Mix, Floragard Light, Green House Powder Feeding, BioTabs.
  Plain-text names, no logos, `quelle_url` + `geprueft_am` shown as `zuletzt geprüft 14.07.2026` — legal
  posture and a genuine trust feature in one string.
- Device-less the Schema is **promoted**: it is the only target band on the chart, the only surviving
  proactive line (F-1), and the only forward-looking statement in the product. **The free product's promise
  is not „wir messen dein Zelt" — it is „wir wissen, was du gleich eintragen wolltest."**

### 12.4 The `schema` Tafel

```
┌──────────────────────────────────────────────────────┐
│ ←  Biobizz All-Mix    All-Mix — stark vorgedüngt ·   │
│                       zuletzt geprüft 14.07.2026     │
│  ┌── VORHER ──┐   ┌── JETZT ───┐                     │
│  │ Schritt 3  │   │ Schritt 5  │   Fr 22.08. → jetzt │
│  └────────────┘   └────────────┘                     │
│  Du bist zwei Schritte weiter und düngst jetzt.      │
│  Bio-Bloom — → 2,0 ml/l · Bio-Heaven — → 1,0 ml/l    │
│  → Schritt 5 ist seit 2 Tagen fällig.   Regel F-1 ›  │
│  Der Unterschied        Fr 22.08.  →  jetzt      Δ   │
│    Schritt              3 von 14    5 von 14    +2   │
│    Bio-Bloom                    —     2,0 ml/l   —   │
│    EC-Ziel                    0,8   1,4 + Leitungsw. │
│  Verlauf                                             │
│  ◼ Gabe · Schritt 5 · wie im Plan        vor 2 Std   │
│  ◼ Gabe · Schritt 4 · abweichend (3,0 statt 2,0)     │
│  Werte {…}  ·  Quelle: biobizz.com · 14.07.2026      │
└──────────────────────────────────────────────────────┘
```

---

## 13. Clubs — attribution without an auth rewrite

### 13.1 `mensch`

A Zelt-scoped name the owner types once. **No account, no e-mail, no `auth.middleware` surgery.** Every
capture writes `akteur`. The `Wer?` row appears only at ≥ 2 `mensch` Dinge; free text with the hint
`Vorname oder Spitzname reicht`. **We never ask for identity.**

**The fusion's club feature: a `mensch` Tafel is „was ist passiert, seit du zuletzt hier warst".** Anna
opens the app, the cursor defaults to her own last visit, and — because the cursor survives every walk — the
tent, plant A3 and the heater all answer *her* question. Walk from Anna to A3 and A3's diff is still
measured from Anna's last visit.

C51 claimed this „does not exist without all three sources". **Corrected: strongest with all three, useful
with one.** Device-less it answers in entries instead of frames, which for a club that hand-waters shared
plants is the answer they wanted anyway.

### 13.2 `zustand` — the Zettel on the tent door

Opened by anyone from `[ Zettel ]`, closed by anyone with `✓` (stamps `d.geschlossen_von` + `t_ende`). It
sits **above** the picture pair, because an open fact outranks the camera. Device-less it is often the only
thing above the pair, which is correct. `Offene Zettel` is a first-class row in `Der Unterschied` — the
count of open door-notes as a delta is the best handover mechanic in the design.

### 13.3 Who got how much (club stillUnmet #3)

All four documents quoted `Wasser 18,5 l über 11 Gaben · Bio-Bloom 31 ml` on the `pflanze` Tafel and none
said whether `2,0 l an A1 A2 A3` is per plant or split. **Decided:**

> **`gabe.d.wasser_l` is the total poured. `d.verteilung` says how it lands: `'gesamt'` (default) divides it
> equally across the plants in `rel.an`; `'je_pflanze'` multiplies it by their count.** The sheet prints
> whichever is active — `6,0 l gesamt` or `6,0 l je Pflanze · 18,0 l gesamt` — and the `pflanze` Tafel's
> cumulative line prints the same word.

`rel.an` **absent means the whole tent**, and absent is the default forever. For the guard and for
cumulative arithmetic, absent intersects every `pflanze` in the Zelt. That is stated here because "Anna
watered the tent, Ben then waters A1" is precisely the double-feed the guard exists for.

### 13.4 The double-feed guard (D14)

At sheet open, query `gabe` Dinge whose `rel.an` intersects the selection inside a per-medium window
(soil 6 h water / 18 h feed; coco 3 h / 12 h, because several daily feeds are correct there). The primary
button **relabels** to `Trotzdem eintragen`, so muscle memory cannot fire it.

Four corrections to the source documents:

1. **The evidence is the waterer's own photo, never `auto_bild`.** `[ Bild ansehen ]` opens a photo in
   `Ding.bilder` of that `gabe`. With none, the sheet reads `Kein Foto dazu.` — the loss is named, not
   papered over with a ±2 h nearest-neighbour that could be a photo of a different plant on a different day.
2. **The nudge that creates the evidence.** After saving a `gabe` with no photo, the confirmation Zeile
   reads `Eingetragen.  📷 Foto dazu?` for six seconds, then self-cancels. Once per entry, ignorable, and
   about the diary rather than the hardware.
3. **The guard runs client-side over the offline queue as well as server-side** (§17). A watering typed in
   a cellar with no signal is invisible to a server query twenty minutes later; the local half closes that
   hole for the same phone, and the sheet says which half fired: `⚠ … (noch nicht gesendet)`.
4. **Hand corroboration.** When the previous `gabe` or a `notiz` within the window carries
   `messwerte.substrat`, the warning prints it: `⚠ Anna hat A1–A3 vor 1 Std 30 gegossen (2,0 l) · Substrat
   danach: nass.` That is the only device-less corroboration available and it is why `substrat` was added
   to `Messwerte` (D8).

### 13.5 `Schlüssel` — six people writing without one password (D24)

The club's number-one unmet need, deferred by all four documents to "real memberships". Real memberships
need a `Mitgliedschaft` collection, a rewrite of `auth.middleware.ts:172` and `:207`, ~10 loosened
owner-scoped queries and an account-lookup-by-email endpoint that does not exist. **A scoped write token is
a fraction of that and solves the actual problem.**

```ts
interface Schluessel {
  schluessel_id: string;
  zelt_id: string;
  mensch_ding_id: string;      // WHO this key writes as. Server-side. Not client-assertable.
  token: string;               // 128-bit, shown once, revocable
  darf: ['gabe','notiz','bild','zustand'];   // FIXED SET. Never settings, never targets, never delete.
  erstellt_at: number; widerrufen_at?: number; zuletzt_at?: number;
}
```

- The owner opens the `mensch` Tafel for Anna and taps `Schlüssel erzeugen ›`. A URL is produced once
  (`/z/<zelt_id>?k=<token>`), shareable by any means the owner likes, revocable from the same Zeile.
- A request bearing `k` may **create** the four listed arts in that Zelt and **read** the diary half. It may
  not change settings, targets, plants, the Schema or `tag_null`; it may not delete; it may not claim or
  unclaim a device; it may not see the `Zugangsschlüssel` or the export.
- **`akteur` is set server-side from `mensch_ding_id` and is not readable from the request body.** That
  fixes mis-attribution on the shared tent phone by construction: the key *is* the person.
- `Vergleich.anker = 'zuletzt'` resolves to that `mensch`'s last write, server-side, so the handover
  question is finally „seit **meiner** letzten Schicht" and not „seit irgendwer zuletzt an diesem Handy war".
- **`ShareLink.editable` stops being a lie.** Today it is a webapp-only flag (`diary.page.ts:62`,
  `charts.page.ts:518`) that unlocks the UI while the server returns 403. It is **deleted**; read-only
  sharing is `ShareLink`, writing is `Schluessel`, and the two never overlap.

**One line never crossed:** with no device and no logins, `akteur` is self-asserted at the point the owner
hands out a key. A device-less club log is a **cooperation tool, not evidence.** Never called an audit
trail, never a `Nachweis`, and it stays exactly as far from § 26 KCanG as this design already put it.

### 13.6 Two people logging the same pour (club stillUnmet #10)

Client-minted `ding_id` + server upsert prevents double-*logging* from one phone. Two phones mint two ids
for one pour and the cumulative total double-counts forever. **Decided:** when the guard fires and the user
proceeds, the confirmation offers a third path beside `Trotzdem eintragen`:
`[ Das war dieselbe Gabe ]`, which writes the new Ding with `d.dublette_von = <the earlier ding_id>`. A
duplicate renders in `Verlauf` as one merged row with both actors (`von Anna und Ben`) and is **excluded
from every cumulative total and from the chart's Wasser lane**. Nothing is deleted; the record stays
reconstructable, which is the same discipline as `storniert_von`.

### 13.7 Corrections, privacy, export

- **Corrections, not edits.** Editing a `gabe` writes a new one with `storniert_von`; the old Zeile renders
  struck through. Reconstructable history without cryptographic immutability, which would victimise the
  unregulated grower.
- **Privacy, maximal by default.** Harvest weight and plant count are never prompted (the fields exist,
  empty, optional). No location, no analytics SDK, no community feed. Never a `KCanG-konform` badge; no
  per-member dispensing data.
- **`Alles löschen`** deletes `dinge`, `ZielStand`, `Bildmass`, `DeviceLog`, `Image` **by `zelt_id` and by
  every `geraet_id` in `Zelt.geraete` including expired bindings**, the `filme` bucket entries, every
  `ShareLink` and `Schluessel`, and the Influx series — which also fixes the live bug where
  `DELETE /device/logs/:device_id` removes nothing because `deleted` is a visibility flag
  (`device.service.ts:739`).
- **Bulk export and an API credential, both absent today:** `Werte` carries `JSON`, `CSV` and
  `Zugangsschlüssel` — a per-Zelt read-only key accepted as `x-api-key` on `GET /api/dinge` and
  `GET /api/reihen`. Revocable, one per Zelt, printed once.
- **Every exported row carries `quelle: 'hand' | 'geraet'`**, and a device-less export carries the header
  line `Alle Werte handerfasst.` One field. It is the difference between a diary and a record, and it is
  the honest reason a club eventually buys a controller — put in the **data**, not in a UI footnote.

---

## 14. The upgrade migration — precise enough to test

A user has `Zelt Keller`: 61 days, 148 Dinge, 84 photos, 23 Gaben, a Schema at step 8, two `mensch`, one
`lauf`. A controller arrives.

### 14.1 Where the claim happens

- From inside a Zelt: `Im Zelt → + → Gerät`, the code goes into that `Zelt.geraete`.
- From `/list`: the sheet asks **`Zu welchem Zelt?`** as a Zeile list, defaulting through when exactly one
  Zelt exists — the same "exactly one → straight through" rule `/list` already applies. **The empty-account
  claim box creates a fresh Zelt only when the account has none.**
- **Wrong Zelt is undoable and there is a move.** `Gerät verschieben ›` on the `geraet` Tafel removes the
  binding from Zelt A and appends it to Zelt B **with `seit` preserved**, so no history is re-attributed and
  no day counter moves. Nothing is re-keyed in either direction, because nothing was ever keyed to a device.

### 14.2 The exact write

```
1. claimDevice(device_id, user_id):
     REFUSE if device.owner_id is non-empty and !== user_id      // NEW, §22 approval
     device.owner_id = user_id
2. zelt.geraete.push({ geraet_id: device_id, seit: Date.now() })
3. ZielStand: one `erstbefund` row per configuration key, gilt_ab = seit
4. dinge: ONE new `ereignis` row — `Gerät verbunden` — with d.zaehler = the pre-claim snapshot (§14.6)
```

**That is the entire data change.** Zero stored Dinge read, zero written, zero ids changed.

### 14.3 The forward-only law (upgrader stillUnmet #2, #8)

> **Nothing the device does may create, alter or re-label a Ding, an Image, a `ZielStand` row or a series
> point dated before its `GeraetBindung.seit`.**

Enforced at four named places, not asserted:

| Producer | Predicate |
| --- | --- |
| `DeviceLog → ereignis` projection | `WHERE log.timestamp >= bindung.seit AND (bindung.bis IS NULL OR log.timestamp <= bindung.bis)` |
| `convertEventsToGrowCycles` boot backfill (`grow-report.component.ts:691-747`) | same predicate; a lifecycle log older than `seit` emits **nothing**, so a second-hand controller cannot attach a stranger's plants to your tent |
| Influx `Reihe` adapter | `range(start: max(von, bindung.seit))`; the chart draws no line before it and prints `Keine Messwerte vor 14.09.` |
| `Image` frames + `Bildmass` | `WHERE timestamp >= bindung.seit`; a shop-tested camera's old frames never enter your film strip |

`claimDevice` and `unClaimDevice` still **delete nothing** (`device.service.ts:1123-1138`) and are not
changed to. The predicate is applied at read time, which is reversible, testable and cannot destroy data.

### 14.4 What does not move — the testable list

| | Guarantee | Test |
| --- | --- | --- |
| 1 | `tag_null` and `lauf` #1's `t` are unchanged | Day 61 before = day 61 after. Assert the exact integer. |
| 2 | Every `ding_id` is unchanged | Set-compare `ding_id` before/after: identical. |
| 3 | Every `Ding.t`, `d`, `rel`, `akteur`, `storniert_von` is unchanged | Deep-compare the collection: byte-identical. |
| 4 | Every `Image` row keeps `zelt_id`; none gains a `device_id` | Assert `count({zelt_id, format:'user/jpeg'})` unchanged. |
| 5 | Every `ShareLink` and `Schluessel` still resolves | GET each token: same 200, same body shape. |
| 6 | `Zelt.d.schema_id`, `schema_schritt` and every `aus_schema` flag are unchanged | Assert. |
| 7 | The diff table **gains rows and loses none** | Row-key set before ⊂ row-key set after. |
| 8 | No `Ding` exists with `t < seit` and `geraet_id` set | Query returns zero rows. |
| 9 | The count printed on the upgrade screen equals the pre-claim snapshot | §14.6. |
| 10 | Unclaim restores exactly state (1)–(8) | §14.8. |

### 14.5 What starts existing, and how the boundary is drawn

All by reveal-by-capability, none by a setting: `geraet`, `dose` (via `parseSocketRoles()`), `ereignis`,
`ziel`, and with a camera `kamera`, `bild`, `film`. Nine of eleven remedy rules come alive. Both camera
alarms are created on pairing.

- **Density steps up from `seit` forward and never backward.** `Keine Messwerte vor 14.09.` and
  `Ziel unbekannt vor 14.09.` — one lie, refused twice, in one string pattern.
- **Targets merge instead of colliding.** Hand `ZielStand` rows (`quelle:'hand'`) keep their
  `gilt_ab`/`gilt_bis`, the device's `erstbefund` rows start at `seit`, so the setpoint line is
  **continuous across the boundary** — dotted before, solid after, legend `von Hand` → `vom Gerät`. Where
  the two disagree the difference is shown as a `ziel` change, never silently reconciled:
  `Tag-Ziel 24,0 (von Hand) → 25,0 °C (vom Gerät), heute 14:02`.
- **Measurements never merge.** A hand `temperatur` series and the controller's series are **two labelled
  rows** — `Temperatur (von Hand)` and `Temperatur (Controller)` — ranked separately, never averaged. That
  is §3.1's two-devices rule extended to hand-versus-device, which is the one thing all three adaptations
  left undefined on the day it changes source.
- **The picture track becomes two tracks in one lane**, resolved everywhere by `beleg()` (§5). A pair may
  legitimately be one hand photo and one camera frame; the captions say which, so it needs no special case.
- **The Tag/Nacht band turns from hatched to solid** at the first `out_light` sample (§10.4).
- **Nothing is auto-created:** no plants, no phases, no schema step, no medium, no `licht_plan` overwrite.
  The device does not overwrite the diary's opinions.

### 14.6 The pre-claim snapshot (upgrader stillUnmet #3)

Immediately before step 2 of §14.2, the server computes and stores on the `Gerät verbunden` `ereignis`:

```ts
d.zaehler = { tage: 61, dinge: 148, fotos: 84, gaben: 23, wasser_l: 18.5,
              tag_null: 1750809600000, hash: sha256(sorted ding_ids) }
```

It is re-asserted after the write and any mismatch aborts the claim with `Gerät nicht verbunden — dein
Tagebuch wurde nicht verändert.` The same numbers are what the upgrade screen prints, so the user is
checking a real invariant, not a rendered guess. The sheet also offers, above the claim button,
`Vorher sichern: JSON · CSV` — the one piece of advice a nervous upgrader will actually follow.

### 14.7 The screen (D19)

The most commercially important screen in the product renders in the same body component as every other
screen — two columns, the left at 88 %, one German sentence under it. **Had it needed a different shape, the
concept would have been wrong. It did not.**

```
┌──────────────────────────────────────────────────────┐
│ ←  Zelt Keller          Controller verbunden · Tag 61 │
├──────────────────────────────────────────────────────┤
│  ┌──── DEIN TAGEBUCH ─────┐  ┌──── AB JETZT ──────┐  │
│  │ 61 Tage                │  │ ● Online           │  │
│  │ 148 Einträge · 84 Fotos│  │ 24,8 °C · 58 % rF  │  │
│  │ 23 Gaben · 18,5 l      │  │ VPD 1,29 kPa       │  │
│  │ Tag 1 war der 25.06.   │  │ alle 5 Sekunden    │  │
│  └────────────────────────┘  └────────────────────┘  │
│  Alles bleibt, wo es ist — ab heute schreibt das     │
│  Zelt mit.                                           │
│  Tag 1 bleibt der 25.06. · 148 Einträge unverändert  │
├──────────────────────────────────────────────────────┤
│  Neu ab heute                                        │
│   ◼ Temperatur, Luftfeuchte, VPD — alle 5 Sekunden   │
│   ◼ Ziele mit Verlauf · vor heute: Ziel unbekannt    │
│   ◼ Alarme per E-Mail                                │
│   ◻ Steckdosen — keine gekoppelt        [ Koppeln ]  │
│   ◻ Kamera — keine gekoppelt            [ Koppeln ]  │
├──────────────────────────────────────────────────────┤
│  Dein Lichtplan 18/6                                 │
│  [ An das Gerät senden ]        [ Später ]           │
│  [            Weiter zum Zelt                   ]    │
└──────────────────────────────────────────────────────┘
```

**Two strings do the whole job.** `Alles bleibt, wo es ist — ab heute schreibt das Zelt mit.` is the
promise; `Tag 1 bleibt der 25.06. · 148 Einträge unverändert` is the proof, in the user's own numbers, from
the snapshot. The fear at this moment is „habe ich jetzt zwei Tagebücher", and the answer is a count they
can check against what they remember.

`Zelt.d.licht_plan`, if set, is **offered** as the device's `daynight` — one tap, editable, never automatic.
It is the only prefill in the flow, and the only hand-declared setting carried across the boundary.

After this screen the app never mentions the upgrade again except as one ordinary `Verlauf` row
(`◼ Gerät verbunden · Terp Control Controller`) and, for 48 hours, one `→` Zeile under the sentence:
`Ab jetzt misst das Zelt selbst. Was du vorher eingetragen hast, bleibt genau so stehen.` It expires.

### 14.8 The reverse direction, which is the sanity check

`unClaimDevice` sets `owner_id: ''` and the binding gains `bis = now`. The Zelt survives, the sensor rows
stop at their last sample, the chart says `Keine Messwerte ab 02.11.`, and **every hand entry, photo, Schema
step, share link and day number is untouched.** An RMA must never orphan a diary.

**A model where downgrade is free is a model where upgrade is free.** A tent that used to have a device and
one that never did are the same screen with different data, and that is worth asserting in both directions.

### 14.9 A second device is a replacement, not only an addition

An RMA appends a second binding while the first gains `bis`. The gallery, the film strip, `Rückblick`,
`Alles löschen` and every image read **union all bindings in `Zelt.geraete` plus `zelt_id`** — one query
shape, written once in `bilderQuelle(zelt)`, used everywhere. Because `bis` is recorded, each device's
frames stay inside its own window and a swapped controller never claims the other's history.

### 14.10 Share links across the boundary

A `ShareLink { zelt_id, page:'diary', charts:false, webcam:false }` created in week 3 keeps resolving in
week 12 and **still shows the diary only**. The sensor half appears in a share only if the owner sets
`charts: true` afterwards. Buying hardware never widens an existing link.

---

## 15. The API surface

Auth column: **U** = session user (`auth.middleware`) · **Z** = `isUserZelt` (§16) · **D** = `isUserDevice`
(existing) · **S** = a valid `ShareLink` token · **K** = a valid `Schluessel` write token · **A** = `x-api-key`
(per-Zelt read key). Anything not listed is unchanged from today.

### 15.1 Zelte and Dinge

| Method | Path | Auth | Payload / Response |
| --- | --- | --- | --- |
| `GET` | `/api/zelte` | U | `→ Zelt[]`. **Never auto-mints.** An empty array renders §7.1. |
| `POST` | `/api/zelte` | U | `{ name, medium?, tag_null?, zeitzone? } → { zelt_id }`. Also mints `lauf` #1 at `t = tag_null`. |
| `GET` | `/api/zelte/:zelt_id` | Z \| S \| A | `→ Zelt` |
| `PATCH` | `/api/zelte/:zelt_id` | Z | `{ name?, tag_null?, zeitzone?, d? }`. `tag_null` here is the **only** other writer (§3.6). |
| `DELETE` | `/api/zelte/:zelt_id` | Z | `Alles löschen` (§13.7). Requires `{ bestaetigung: name }`. |
| `POST` | `/api/zelte/:zelt_id/geraet` | Z | `{ claim_code } → { geraet_id, zaehler }`. §14.2, including the refusal and the snapshot. |
| `DELETE` | `/api/zelte/:zelt_id/geraet/:geraet_id` | Z | sets `bis`; does not unclaim the device unless `{ freigeben: true }` |
| `POST` | `/api/zelte/:zelt_id/geraet/:geraet_id/verschieben` | Z | `{ ziel_zelt_id }`. §14.1, `seit` preserved. |
| `GET` | `/api/dinge` | Z \| S \| A | `?zelt_id=&art=&von=&bis=&cursor=&limit=` → `{ dinge: Ding[], cursor?: string }`. **Cursor pagination is mandatory from day one.** |
| `POST` | `/api/dinge` | Z \| K | `Ding` (client-minted `ding_id`) → `{ ding }`. **Upsert on `ding_id`**, so a retry can never double-log. `K` may create only `gabe`/`notiz`/`bild`/`zustand` and `akteur` is forced server-side. |
| `PATCH` | `/api/dinge/:ding_id` | Z \| K | Only `t_ende`, `d.geschlossen_von`, `storniert_von`, `d.dublette_von`. **Values are corrected by writing a new Ding, never by editing one.** |
| `GET` | `/api/reihen` | Z \| S \| A | `?zelt_id=&schluessel=&von=&bis=` → `Reihe[]` (§10.1). Merged Influx + Mongo. |

### 15.2 Images

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/zelte/:zelt_id/bild` | Z \| K | multipart `image`, optional `t`, `rel`. Writes `Image { zelt_id, format:'user/jpeg', data, vorschau }` + a `bild` Ding. 12 MB limit, `abortOnLimit`. |
| `GET` | `/api/bild/:image_id` | Z \| S \| A \| K | **NEW and it replaces the device-keyed read path.** `?groesse=vorschau\|voll&token=<imageToken>`. Authorises by resolving the `Image`'s `zelt_id` (or its `device_id` → the Zelt that binds it), **not by a device id in the URL**. |
| `DELETE` | `/api/bild/:image_id` | Z | The webapp calls it (today it never does, so `DELETE /image/:image_id` is a live leak). Also removes the `bild` Ding. |
| `GET` | `/image/:device_id` | D \| S | **Kept, unchanged, for existing device owners and existing share links.** Internally delegates to the same resolver. |
| `POST` | `/api/zelte/:zelt_id/film` | Z | `{ von, bis, rezept: 'film' \| 'rueckblick', nur_tagbilder?, angleichen?, ruhig_stellen?, zahlen? } → { film_id, status:'queued' }`. Idempotent on the recipe hash. |
| `GET` | `/api/film/:film_id/status` | Z \| S | `→ { status, bilder_gesamt, bilder_behalten, verworfen:{…}, kapitel, eta_s }` |
| `GET` | `/api/film/:film_id` | Z \| S \| A | `Content-Type: video/mp4`, `Content-Disposition: attachment; filename="zelt-keller_tag12-tag84_2026-10-14.mp4"`, **`Accept-Ranges: bytes`** — required, or iOS Safari will not play it inline. |

### 15.3 Sharing and club keys

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/zelte/:zelt_id/share` | Z | `{ page:'charts'\|'diary', charts, webcam, gueltig_bis? } → ShareLink`. `editable` is **removed from the model** (§13.5). |
| `DELETE` | `/api/share/:share_id` | Z | |
| `POST` | `/api/zelte/:zelt_id/schluessel` | Z | `{ mensch_ding_id } → { url, token }`. Token shown once. |
| `DELETE` | `/api/schluessel/:schluessel_id` | Z | revoke |
| `GET` | `/api/zelte/:zelt_id/export` | Z \| A | `?format=json\|csv` → every Ding, every `Reihe` point, every `ZielStand` row, each with `quelle: 'hand' \| 'geraet'`; CSV carries the header `Alle Werte handerfasst.` when no binding exists. |
| `POST` | `/api/zelte/:zelt_id/zugangsschluessel` | Z | mints/rotates the per-Zelt `x-api-key`. Printed once. |

### 15.4 Sync

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/dinge/stapel` | Z \| K | `{ dinge: Ding[] }` — the offline queue's drain endpoint. Upsert on `ding_id`, per-item result array, partial success is normal and reported per item. |

**Unchanged and explicitly not touched:** `/login`, `/signup`, `/account`, `/shares`, `/demo`, `/classes`,
`/diagnostics`, `/testmode`, every `/device/*` control endpoint, every MQTT topic, every firmware-facing
contract.

---

## 16. Ownership, authorisation, and the image read path

`auth.middleware.ts:172` (`deviceModel.find({owner_id, device_id})`) is the whole authorisation model
today. Device-lessness adds a second identity — `zelt_id` — that every guarded path must resolve.

```ts
async function isUserZelt(req, zelt_id): Promise<boolean> {
  return !!(await zeltModel.exists({ zelt_id, besitzer_id: req.user_id }));
}
async function darfLesen(req, zelt_id): Promise<boolean> {   // U | S | A | K
  return isUserZelt(req, zelt_id) || validShareForZelt(req, zelt_id)
      || validApiKeyForZelt(req, zelt_id) || validSchluessel(req, zelt_id);
}
```

**Neither is real Express middleware, and a controller that forgets to call it is unguarded** — which has
already happened once in this repo (`DELETE /device/logs/:device_id`). Two mitigations, both mandatory
review items: every new handler calls it on its **first line**, and a route-table test asserts that every
route under `/api/` appears in an explicit allow-list of `{path → guard}` pairs.

### 16.1 The image read path — the hole all four documents left

Every image is fetched today as `GET /image/:device_id?...&token=<image token>` behind
`isUserDeviceOrShareMiddelware(..., 'image')` (`image.controller.ts:48`), plus `deleteImage` (`:83`) and
`testDeviceWebcam` (`:110`) on `isUserDeviceMiddelware`, plus `findValidShare` (`auth.middleware.ts:70-80`),
plus every `<img>` URL in the webapp. A device-less photo has no device id to put in that URL.

**Decided:** the canonical read is **`GET /api/bild/:image_id`**, keyed by the image, authorised by
resolving that image's Zelt. Concretely:

| Call site | Change |
| --- | --- |
| `image.controller.ts:48` `getDeviceImage` | kept verbatim for back-compat; body delegates to `bildLesen(image_id \| device_id+t)` |
| `image.controller.ts:83` `deleteImage` | guard becomes `darfSchreiben(zelt of image)`; the webapp now calls it |
| `image.controller.ts:110` `testDeviceWebcam` | unchanged — it needs a device by definition |
| `findValidShare` | gains a `zelt_id` branch alongside `device_id`; `isDemoDevice` and `resolveDeviceAccessInfo` keep taking device ids and are **never** passed a Zelt id |
| webapp `<img>` URLs | one helper `bildUrl(image_id, groesse)`; the 27 files that build device-shaped image URLs go through it |

**This is budgeted** (§20 item F). It is the single most under-costed item in all three adaptations.

### 16.2 The webapp's device-shaped routing

`app-routing.module.ts` (`/device/:device_id/*`) → `devices.service.ts` → every component assumes a device
id is the subject. Device-lessness adds `zelt_id` as the primary identity that all of it must resolve to
either. **Two days are budgeted for that plumbing alone** (§20 item F), because none of the three
adaptations budgeted any.

---

## 17. Offline (D21)

**Promoted from "the second thing we cut" to v1 core, for the write queue only.**

The reasoning is not sentimental. For a hardware owner the offline queue was cosmetic — the controller
uploads by itself. For a device-less grower **the queue IS the capture feature**: their data exists solely
because they typed it standing in front of a plant, often in a cellar with one bar. All four source
documents nominated it as a casualty; three reviewers flagged that independently.

- **`@angular/service-worker`**, one dependency, one build change. No Web Push in v1 (§20 later list).
- Writes are **local-first**: the client mints `ding_id`, writes to IndexedDB, renders the Zeile immediately
  with `⟳ nicht gesendet`, and drains to `POST /api/dinge/stapel` on connectivity and on focus. Upsert on
  `ding_id` means a retry can never double-log.
- **Photos queue too**, resized client-side first, capped at 20 queued photos to bound IndexedDB.
- **The double-feed guard reads the queue** (§13.4 point 3) and labels which half fired.
- **A conflict is impossible by construction** — every queued item is a create with a client-minted id, and
  the only mutations allowed are the four monotone fields in `PATCH /api/dinge/:ding_id` (§15.1).
- One line in `Werte {…}`: `3 Einträge warten auf Verbindung.` No banner, no badge, no modal.
- The PWA install hint lives in exactly one place — the same `Werte` block — and only on iOS Safari, where
  it is the difference between the queue surviving a tab close and not.

---

## 18. What is honestly worse without a device — and how the app says it once

### 18.1 Worse, in order of how much it hurts

1. **Nothing wakes you at 3 a.m.** No sensor, no MQTT, nothing for `alarm.service` to evaluate. The single
   most valuable thing the hardware does cannot be replaced by any amount of good software. A device-less
   Zelt has **reminders**, not alarms, and the distinction is never softened.
2. **The diary no longer keeps itself.** „It does the diary keeping for you" — machine-written `ereignis`,
   `bild`, `film`, `phase` and `ziel` rows in the same list the human writes into, *so a user who logs
   nothing still opens a full diary* — **is false without a device.** Device-less, `Verlauf` gets exactly
   five machine-written row types ever: `Zelt angelegt`, `Schema gewählt`, `Schritt N fällig`,
   `Durchgang beendet`, `Gerät verbunden`. This is the central cost and no design removes it.
3. **Nine of eleven remedy rules are silent** (§9.3). The discipline is not relaxed to fill the silence.
4. **The light/picture mismatch alarm does not exist**, and it was the thesis in one alarm. **No substitute
   is offered.**
5. **The picture is never measured.** No `Blattfläche`, no change map, no meaningful cull. `hoehe_cm` is a
   worse growth proxy than `gruenanteil`, which was already the softest number in the design.
6. **There is no Vorher on any day you did not log.** The pair is as dense as your discipline — and two
   hand-held photos are not a controlled comparison even when both halves exist (§11.4).
7. **Tag/Nacht is a plan, not a measurement; the verdict strip counts readings, not minutes; the film is a
   slideshow.**
8. **A device-less log is self-asserted.** A cooperation tool, not evidence (§13.5).

### 18.2 The one rule for saying it

> **The app never renders a row, a card, a lock, a grey placeholder, a padlock, a percentage or a meter for
> something it cannot measure. The absence is silent, and the silence is the whole mechanism.**

That is M4 unchanged. **Device-lessness needed no new anti-upsell rule, because M4 already forbade every
form one could take.**

Hardware is named in exactly **four** places in the entire product, all structural, none repeatable, none
with a price in it:

- **(a)** The claim-code input on the empty account (§7.1). Seen once, and it is *for* the buyer.
- **(b)** `Im Zelt → +` offers exactly two things forever: `Pflanze` and `Gerät`. Identical on day 1 and day
  400. **A create action, not an advertisement.**
- **(c)** The `◻ + Gerät hinzufügen` Zeile in `Im Zelt` — 48 px, fixed position in the list order, present
  whether you have zero or three devices. It never moves, never grows, never pulses, never changes colour.
- **(d)** One line in the `Werte {…}` provenance footer: `Quellen: 14 Einträge · 6 Fotos · 0 Messreihen` and
  `Alarme: 0 möglich — keine Messreihe`. **A fact in a data-provenance block. It has no button.** That is
  the entire answer to „does this product have alarms?", in a row every account has from install.

**Explicitly forbidden, with the same standing as the no-modes test:** no upsell row in `Verlauf`, no
`— Gerät` row in the diff table, no „dein Zelt ist zu 40 % eingerichtet", no empty sensor cards, no badge,
no padlock, no interstitial, no trial, no countdown, no „Upgrade" menu item, no price anywhere in the app,
no e-mail campaign triggered from app state, no feature named after hardware you do not own, no
`/z/:id/geraet` sales page, and **no tier or plan field on `User`, ever.**

**The reason is commercial, not moral:** the diary is the top of the funnel for a €289 device, and a funnel
that nags at the top delivers nobody to the bottom. The honest conversion mechanism is the one already
built: **the user walks into the limit while doing something they wanted to do.** `Nächster Unterschied ›`
says nothing was recorded. The chart has no temperature panel. The `pflanze` Tafel cannot answer *was war
nachts los*. Nobody had to be told.

**And the honest concession:** a quiet gap almost certainly converts worse than a banner would. We choose
the diary over the funnel where they conflict, on the theory that a diary used daily for 61 days sells more
controllers over a year than one deleted in a week. **That is a theory, it is not measurable under this
privacy posture, and it should be adopted consciously rather than discovered at a board review.**

---

## 19. The four reviewers' unmet items — every one answered

Verdicts: **v1** = specified above and in the October scope · **later** = specified, scheduled after v1 ·
**refused** = deliberately not built, with the reason.

### 19.1 The diary-only grower (phone, €15 pH pen, tape measure)

| # | Unmet item | Verdict | Where / why |
| --- | --- | --- | --- |
| 1 | **Run-over-run comparison** — „Durchgang A Tag 30 beside Durchgang B Tag 30" | **v1** | §3.2 · D22. `lauf` is a stored art inside one Zelt, so the per-Zelt cursor reaches it with one new detent and no new renderer. It is also sentence rank 8a (§9.2), which means the empty day *is* the run comparison. |
| 2 | **The end of a grow, and what happens to the tent afterwards** | **v1** | §3.2. `Durchgang beenden` stamps `t_ende` and opens the next run; the finished `lauf` has a Tafel that answers „wie lief dieser Durchgang", with its own `Rückblick`. `pflanze.d.ernte_g` and the `ernte` stage exist and are never prompted. |
| 3 | **Retroactive entry / editable timestamps** | **v1** | §12.2 · D23. `✎` on every sheet header; `t` is what happened, `erfasst_at` is when it was typed; the guard's arithmetic uses `t`. |
| 4 | **Offline capture** | **v1** | §17 · D21. Re-ranked from "second casualty" to core, write queue only. |
| 5 | **Capture friction / no native app** | **refused for v1, mitigated** | Capacitor is scaffold-only (no `android/`, no `ios/`) and a native app is a separate project, not a line item. Mitigation: the service worker makes the PWA installable and the queue survives a tab close, and the install hint appears in exactly one place (§17). **This remains the single biggest reason a competitor keeps this user, and no part of this document pretends otherwise.** |
| 6 | **Nothing that makes an empty day pleasant** | **v1** | §9.2 · D6. Rank 8 is rewritten to recall — last run at this day number, the Schema's next step, or the last day that has evidence — and 8a/8c **move the Vorher half to that day**, so the screen shows you something instead of reporting an absence. Never a diligence report. |
| 7 | **A shareable / printable record of a finished grow** | **v1 partially, rest later** | v1: `ShareLink { zelt_id, page:'diary' }` (§4.5) is a read-only URL you can send a friend, and it keeps working after an upgrade. **Later:** a public diary URL with no login, a print stylesheet and the BBCode generator. |
| 8 | **What I spend / shopping list** | **later** | It falls out of `Schema` + `gabe.d.produkte` but needs pack sizes and prices we do not hold, and inventing them would be the product's first invented number. Scheduled, not refused. |
| 9 | **An honest treatment of what two hand-held photos are** | **v1** | §11.4. The caption's third slot always reads `Foto` so the pair is self-documenting forever; `Werte` carries one line; the Ausrichthilfe (§11.1) is the design answer. Said twice, never again. |

### 19.2 The upgrader (eleven weeks of diary, controller just arrived)

| # | Unmet item | Verdict | Where / why |
| --- | --- | --- | --- |
| 1 | **Nobody guards `tag_null` against a retroactive or backfilled `phase`** | **v1** | §3.6 · D9. `tag_null` is written by the create sheet and by an explicit user edit, and by nothing else — plus the backfill is clipped to `GeraetBindung.seit`, so a second-hand controller cannot emit a phase older than your Zelt. |
| 2 | **Nobody enforces the forward-only rule they assert** | **v1** | §14.3. Four named producers, four named predicates, and `Zelt.geraete` is `{geraet_id, seit, bis?}[]` (D18) precisely so the predicate has something to read. |
| 3 | **No pre-claim snapshot and no integrity check** | **v1** | §14.6. Counts + a `ding_id` hash computed before the write, re-asserted after, mismatch aborts the claim, and the upgrade screen prints the same numbers. Export offered on the claim sheet. |
| 4 | **Claiming into the wrong Zelt; no merge, no undo** | **v1** | §14.1. `Zu welchem Zelt?` on the claim sheet, and `Gerät verschieben ›` moves a binding between Zelte with `seit` preserved. Undo is free because nothing was re-keyed. |
| 5 | **One measure, two sources across the boundary** | **v1** | §14.5 · §3.1. Two labelled rows, ranked separately, never averaged — the two-devices rule extended to hand-versus-device, and printed on `Werte`. |
| 6 | **A second device is a replacement, and nobody covers the swap** | **v1** | §14.9. `bis` bounds each binding; `bilderQuelle(zelt)` is one query shape used by the gallery, the film strip, `Rückblick` and `Alles löschen`. |
| 7 | **What my eleven weeks look like to somebody else after the upgrade** | **v1** | §14.10. A diary share keeps showing the diary; buying hardware never widens an existing link. |
| 8 | **What the machine may write into my past** | **v1** | §14.3, stated as one law and enforced at four places: *nothing the device does may create, alter or re-label a Ding dated before its `seit`.* |

### 19.3 The grow club (six members, shared plants, no controller)

| # | Unmet item | Verdict | Where / why |
| --- | --- | --- | --- |
| 1 | **Six people writing without sharing one password** | **v1** | §13.5 · D24. `Schluessel` — a per-`mensch` revocable scoped write token, `akteur` forced server-side, four permitted arts, no settings and no delete. Real memberships stay out; the upgrade path is designed in (`mensch.d.user_id`). |
| 2 | **Silent mis-attribution on the shared tent phone** | **v1** | §13.5. The key *is* the person, so attribution is server-side. On a shared login the `Wer?` chip re-confirms when the previous entry was by a different actor or more than 12 h old. |
| 3 | **Dividing a pour across plants** | **v1** | §13.3. `d.verteilung: 'gesamt' \| 'je_pflanze'`, default `gesamt`, printed on the sheet and in the cumulative line. |
| 4 | **`rel.an` absent versus explicit, inside the guard** | **v1** | §13.3. Absent = the whole tent = intersects every plant, stated as a rule. |
| 5 | **The guard is blind to unsynced entries** | **v1** | §13.4 point 3 · §17. The guard reads the local queue as well as the server and labels which half fired. |
| 6 | **Back-dated and corrected entry times** | **v1** | §12.2 · D23. |
| 7 | **Any device-less corroboration for the guard** | **v1** | §13.4 point 4 · D8. `messwerte.substrat` (trocken/feucht/nass) and `topfgewicht_kg` were added for exactly this, and the warning prints the last one. |
| 8 | **A rota, or whose turn it is** | **refused** | A task list is refused by the concept — it is the mechanism that turns a diary into a chore app and the one thing every reviewer of the original agreed to keep out. `Zettel` (`zustand`) is the answer offered: anyone opens it, anyone closes it, and its open count is a first-class row in `Der Unterschied`. |
| 9 | **A handover entry point** | **v1** | §3.5 · §13.5. With a `Schlüssel`, `zuletzt` means *your* last visit, server-side, and the `mensch` Tafel is that destination. Without one it is per-browser and the label says so, which is at least honest. |
| 10 | **Two members logging the same pour** | **v1** | §13.6. `[ Das war dieselbe Gabe ]` writes `d.dublette_von`; the row merges in `Verlauf` and is excluded from every total and from the chart. |

### 19.4 The engineer (Angular 15 / Ionic 6, October 2026)

| # | Unmet item | Verdict | Where / why |
| --- | --- | --- | --- |
| 1 | **None of this ships before the C51 foundation does** | **stated, not solved** | §20 says it in the schedule: ~32 of the 56 device-less days are the `Zelt`/`dinge`/browser/`zeitgriff`/diff-engine foundation. **There is no free product until the Ding refactor lands, so the free tier cannot be pulled forward as risk mitigation for the paid one.** That is a fact about the plan, not a gap in it. |
| 2 | **Nobody draws the mixed Zelt** | **v1** | §6.3, drawn and specified: fixed group order, an 11-row cap plus `⋯ N weitere`, the date-boundary row, the stacked Dichteband, the hatched→solid band. |
| 3 | **The image READ path** | **v1** | §16.1, with every call site named and the new `GET /api/bild/:image_id` canonical read. Budgeted as its own line item (§20 F). |
| 4 | **The 27 webapp files that mention `device_id`, and `charts.page.ts`** | **v1, budgeted** | §16.2. Two days for the identity plumbing, which none of the three adaptations budgeted at all. |
| 5 | **The offline queue is the first thing everyone defers** | **v1** | §17 · D21. |
| 6 | **No device-less test fixture** | **v1** | §20 item N: `simulate-diary.sh` — mints a Zelt, 61 days of `dinge`, photos, a Schema at step 8, two `mensch` and a `Schluessel`, via the API. 2 days, and it gates the end-to-end pass. |
| 7 | **A deploy story for the index change** | **v1** | D3 · §4.4. An explicit one-shot `npm run migrate:indexes`, single instance, run before the deploy that needs it; **never at boot**, because `createIndexes()` never alters and a boot `dropIndex` races two pm2 instances and swallows its own failure. Rollback is re-creating the old index, which is a no-op for correctness because nothing depends on its uniqueness except the mp4 writer, which keeps it. |
| 8 | **A bound on the diff table's row count** | **v1** | §6.3: 11 rows plus `⋯ N weitere`, with a fixed group order so ranking never reorders across groups. |
| 9 | **Nobody prices the second timelapse as a second implementation** | **v1** | §11.5 · D13: **one pipeline, two recipes**, priced once as a recipe object rather than three times as three names. |
| 10 | **The free tier's storage bill** | **v1 brake, later fix** | §11.3 · D16: a 1 000-photo quota printed in the product, plus client and server downscale, plus `vorschau` to stop read amplification. **Object storage is the real answer and it is an owner decision (§22), not a v1 line item.** |
| 11 | **The shared-account problem gets worse device-less** | **v1** | §13.5 · D24. `Schluessel` for writing, `ShareLink { zelt_id }` for reading, and `ShareLink.editable` — a webapp-only flag that unlocks the UI while the server returns 403 — is **deleted**. |

---

## 20. v1 scope for October 2026

**Two developers.** The ordering is D20: **the device-less product ships first, complete and sellable, and
hardware enrichment lands on top without touching a stored row.**

### 20.1 Phase 1 — the foundation (nothing ships without it)

| # | Item | Days |
| --- | --- | --- |
| 1 | **`Zelt` + `GeraetBindung` + silent migration + naming pass** — kills „FRIDGE GROW", adds `devices.controller` i18n, per-role capability failing closed, data age on every value, `isUserZelt` + the route-table guard test | 5 |
| 2 | **`dinge`** — 7 stored arts, 9 read-time adapters, `GET/POST/PATCH /api/dinge` with cursor pagination, `x-api-key`, JSON/CSV export with `quelle` | 7 |
| 3 | **The one browser component** — Zeile, Tafel, four sections, `Werte {…}`, `KeyedCache` everywhere, **art-specific Körper as separate declared components from the first commit** | 8 |
| 4 | **`<tc-zeitgriff>` + `VergleichService`** — track, detents, stacked Dichteband, collapse-on-drag, pinned scrub header, `Nächster Unterschied`, three projections wired both ways | 5 |
| 5 | **The diff engine** — `beleg()`, per-art Vorher resolution, ranked table with the 11-row cap, the one sentence ladder including rank 8a–8e, σ rules | 7 |
| | **Subtotal — this is the concept and none of it may slip** | **32** |

### 20.2 Phase 2 — the device-less product, complete

| # | Item | Days |
| --- | --- | --- |
| A | `POST /api/zelte`, the create sheet (name / medium / `Los geht's`), `/list` empty-state rework, claim-into-existing-Zelt, `Zu welchem Zelt?` | 3 |
| B | **Photos** — `POST /api/zelte/:id/bild`, client + server resize, `vorschau`, the index change + `npm run migrate:indexes`, the E11000 guard, the 1 000-photo quota and its screen, Ausrichthilfe | 4 |
| C | **`notiz.d.messwerte`** + the sheet row + the legacy `DiaryEntryData` normaliser + `substrat`/`topfgewicht_kg` | 2 |
| D | **`GET /api/reihen`** — the merged Influx + LKV-over-`dinge` adapter, `traeger`, the dashed-gap rule, the `quelle` mark spec | **5** (not the 3 all three documents guessed; it serves four consumers across two carrier kinds with cursor pagination) |
| E | **Gabe / Notiz / Foto / Zettel sheets** — tap counter, `verteilung`, `mensch` picker, the double-feed guard incl. the local-queue half and `substrat`, the `📷 Foto dazu?` nudge, `dublette_von`, the `✎` timestamp editor, `auto_bild` | 7 |
| F | **The identity plumbing** — `GET /api/bild/:image_id`, the four image controller call sites, `findValidShare`'s `zelt_id` branch, `bildUrl()` and the 27 device-shaped webapp URLs, routing resolves `zelt_id` | 4 |
| G | **`Schema`** — 5 seeded entries with `quelle_url`/`geprueft_am`, the `schema` art + Tafel, prefill, the `duengen_ab_woche` refusal, F-1, `leitungswasser_ec` | 5 |
| H | **`lauf`** — the art, `Durchgang beenden`, the `Lauf n` detent, the `lauf` Tafel, rank 8a | 3 |
| I | **`mensch` + `Schluessel`** — the `mensch` Tafel, the `Wer?` row, token mint/revoke, server-side `akteur`, `ShareLink.zelt_id`, deleting `editable` | 4 |
| J | **The chart** — one ECharts implementation over `GET /api/reihen`: hand panels, Wasser bar lane, Schema bands, Phasenbänder, hatched `licht_plan`, count-based verdict strip, annotation rail, film strip | 9 |
| K | **`Rückblick`** — the recipe object, concat demuxer, letterbox, relaxed normalisation, ±12 h burn-in, cull report, **GridFS `filme` bucket**, range-aware download, `navigator.share`, **the x264 switch** | 5 |
| L | **Service worker + the offline write queue** — IndexedDB, `POST /api/dinge/stapel`, `⟳ nicht gesendet`, the guard's local half, photo queue | 5 |
| M | **`Alles löschen` that actually deletes** + the optional `Image.zelt_id` backfill script + Flux prerequisites (interpolation parameterised, `limit` before `yield`, interval constrained by timespan) | 3 |
| N | **`simulate-diary.sh`** + de/en in the same commits + the end-to-end pass | 4 |
| | **Subtotal** | **63** |

**Phase 1 + Phase 2 = 95 developer-days.** Two developers × 8 weeks = 80. **It does not fit, and pretending
otherwise would be the dishonest part of this document.** The cut list, in order, is fixed in advance:

| Cut | Days back | What is lost | Why it is safe |
| --- | --- | --- | --- |
| **C1 · Item J ships as the existing Highcharts page** wired to `GET /api/reihen`, with `ZielStand` setpoints, the phase bands and the shared cursor added. ECharts lands in November. | **−6** | Bar lanes render as `type:'column'` (already supported at `charts.page.ts:809`); the hatched `licht_plan` band and the state-timeline lane wait. | The chart is the *third* projection, not the concept — and unlike the source documents, this fallback is verified to exist. |
| **C2 · `Schluessel` (item I) drops to `mensch` + `Wer?` + `ShareLink.zelt_id` only.** | **−2** | Six people are back on one login until v1.1. | It is the only item here that is genuinely additive to C51 rather than load-bearing for it. |
| **C3 · `lauf` (item H) drops to the stored art and `Durchgang beenden` only**; the `Lauf n` detent, the `lauf` Tafel and rank 8a follow in v1.1. | **−2** | The run comparison waits ~4 weeks. | The *data* is being recorded from day one, so nothing has to be reconstructed later. |
| **C4 · Ausrichthilfe and the `Rückblick` cull report** are dropped from item B/K. | **−1,5** | Hand photos are unaligned and the report is one line. | Cosmetic, and both are additive. |
| **C5 · `simulate-diary.sh` shrinks to a seed script with no assertions.** | **−1,5** | The end-to-end pass is partly manual. | Painful, and the least bad of the remaining options. |

**With C1–C5: 82 days ≈ 8,2 weeks for two.** That is the honest number, and the plan is to take C1 and C2 at
the start rather than discover them in week seven. **Items 1–5 must not slip under any circumstance — they
are the concept, and every other item is a consumer of them.**

### 20.3 Phase 3 — hardware enrichment, on top, touching no stored row

| # | Item | Days |
| --- | --- | --- |
| 6 | **`ZielStand`** — config diff watcher, `erstbefund`, projection as `ziel` Dinge, `quelle:'hand'` merging | 3 |
| 7 | **`Bildmass` ingest** — §11.6 including the lookahead buffer | 4 |
| 8 | **`Film`** — golden windows, 600-frame budget, cull report, normalise, stabilise, chapters, burn-in (the same pipeline as `Rückblick`, a second recipe) | 5 |
| 9 | **Camera alarms** + the evaluator ticker | 2 |
| 10 | **The remedy rules N-3 … D-1** (nine of them) | 4 |
| 11 | **The upgrade path** — claim refusal, the snapshot + hash, the upgrade screen, `Gerät verschieben`, the four forward-only predicates | 4 |
| | **Subtotal** | **22** |

Phase 3 lands after the free product is live and **cannot break it**, because it adds projections and never
touches a stored row. That is the whole point of the ordering.

### 20.4 Explicitly later, not in v1

Real memberships (a `Mitgliedschaft` collection, `auth.middleware.ts:172`/`:207`, ~10 loosened owner-scoped
queries, account-lookup-by-email) · **Web Push (VAPID)** and the iOS installed-PWA caveat · object storage
for `Image.data` · a public no-login diary URL, a print stylesheet and the BBCode generator · the shopping
list and the mixing-order checklist · a sprite endpoint for the film strip · rotation-correcting
stabilisation · Telegram/Discord destinations · a `ding.created` webhook · the `Bildänderung` chart lane ·
a native app.

---

## 21. Firmware

**No firmware changes. None of the following was designed around a hoped-for firmware update.**

Three places where the obvious answer would have needed one, and what was done instead:

| Wanted | Why firmware would be needed | Designed around it |
| --- | --- | --- |
| Hand-logged pH / EC / height as first-class series | `VALID_SENSORS` (`data.service.ts:12`) is a twelve-name allowlist that silently drops anything else, and widening it is a firmware-vocabulary change | Hand series live in Mongo and are served by `GET /api/reihen` (§10.1). The chart cannot tell the two adapters apart. Eleven pH readings were never a time series anyway. |
| Storing `medium`, `schema_id`, `licht_plan`, `leitungswasser_ec` on the device | `device.configuration` strips unknown keys | All four live on `Zelt.d` (§3.1), cloud-side, before and after a claim. A device-less Zelt never writes to `Device.configuration` at all, so the constraint cannot even be reached. |
| A socket role for a humidifier or an exhaust fan | `SOCKET_ROLES` is fixed at `dehumidifier, heater, light, secondary_light, co2` | Rule V-1 (§9.3) **names the limitation on screen** — „Eine Dose mit der Rolle ‚Befeuchter' kennt die Firmware nicht." Progress in honesty, zero in capability, and the honest version is more useful than a nudge nobody can act on. |

---

## 22. Owner approvals not yet given

**None of these is assumed anywhere in the v1 plan. If an approval does not arrive, the named fallback ships.**

| # | Decision | Fallback if refused |
| --- | --- | --- |
| 1 | **`REQUIRE_ACTIVATION` off for self-serve**, or: unactivated accounts may log in and write, the mail deep-links to `/z/<zelt_id>`, the nag is one dismissible Zeile (D12). *This is a real auth change with a real spam surface.* | Sign-up keeps the inbox round trip. §7.3's eighty seconds becomes „eighty seconds plus however long your mail takes", and the funnel eats it. |
| 2 | **`libx264` replaces `libx265`** at `image.service.ts:583`, in the existing rolling timelapses too. *It changes the output of a shipped feature.* | `Rückblick` and `Film` encode x264 while the legacy rolling timelapse keeps x265 — i.e. the existing feature stays invisible in Chrome and Firefox. |
| 3 | **ECharts 6 replaces `chart.js`/`ng2-charts`/`chartjs-adapter-luxon`** (already flagged in the original as an owner decision). | Cut C1 (§20.2) is the fallback and it is verified to work. |
| 4 | **Object storage (S3-compatible) for `Image.data`.** Must be decided before the free tier opens, not after. | The 1 000-photo quota (§11.3) is the brake, and the Mongo bill grows. |
| 5 | **`claimDevice` refuses a device with a non-empty `owner_id`** (`device.service.ts:1123-1134` does not check today). | A claim code read off a second-hand box silently steals it from its current owner, which is the status quo. |
| 6 | **`Schluessel` — per-`mensch` scoped write tokens** (§13.5). A new credential type on an auth surface that has none. | Cut C2. Six people share one login, and `akteur` stays self-asserted per phone. |
| 7 | **The free tier has no ceiling on Zelte or accounts and no billing exists anywhere in the codebase.** This is a product decision this design cannot make and cannot avoid. | One Zelt per free account, which is a worse product and a simpler bill. |

---

## 23. Honest weaknesses

1. **The cursor is invisible state, and invisible state is how modes sneak back in.** It is printed under
   the handle on every screen and it resets each session — but a user who dragged it to `Beginn` three
   screens ago and forgot is reading a diff they did not ask for. Two mitigations (the printed moment, the
   dimmed `Verlauf` below the hairline) and neither is proof.
2. **A diary is a discipline product and most people have none.** Rank 8's rewrite (§9.2) makes the empty
   day *pleasant*; it does not make the user log. Grow with Jane and GrowDiaries solved retention with
   streaks, badges and a social feed — each of which is a mode, a nag or a community feature this product
   refuses. We answer with F-1, the run comparison and nothing else. That may not be enough.
3. **Two free incumbents, and we have no app.** ~500 K Play installs and ~450 K visits/month, both
   day-indexed, both social, both mobile-first. Capacitor here is scaffold-only. A web-only diary with no
   feed, competing on honesty and a feed schedule, is a bet — and §19.1 item 5 is the reason a user leaves.
4. **`hoehe_cm` is a poor growth proxy and saying so does not make it stronger.** One hand measurement from
   an arbitrary reference point that nobody records, and it is the headline growth number device-less. It
   will frequently be absent, and rank 3 will frequently fall through to rank 4.
5. **The remedy rules will be wrong for somebody.** N-3 assumes an unvented tent; H-1 cannot distinguish an
   undersized heater from an open door. Eleven deterministic rules over five socket roles is a small,
   brittle expert system, and the first time one fires wrongly the user stops reading all of them.
6. **Uniformity still flattens some things.** An alarm and a socket switching are still the same 48 pixels
   in `Verlauf`, carried by one status square and `Offen`. A dedicated ranked Befund list would be better at
   urgency than the diff table is.
7. **One route means one component means a monolith, and the read-time adapters have a total blast radius.**
   The Tafel becomes the new `charts.page.ts` unless the art-specific Körper are separate declared
   components from the first commit; and one `GET /api/dinge` over 12 weeks touches `dinge`, `ZielStand`,
   `DeviceLog`, `Image` metadata and Influx with no second screen to fall back on. Both are plans, not
   guarantees.
8. **The majority of launch hardware buyers have no camera**, and the concept's most legible half — two
   pictures — reaches them only if they take photos themselves. The `'band'` and `'karte'` arms are complete
   and honest, but betting the pitch on the attach rate is still betting.
9. **Photos in MongoDB.** `data: Buffer` inside a BSON document is tolerable for one webcam frame every 30 s
   with a 90-day retention. A device-less diary keeps every photo forever, with no revenue attached. The
   quota, the downscale and `vorschau` delay the problem; they do not solve it (§22 item 4).
10. **CPU is a real cost, not a rounding error.** Two `sharp` decodes plus analysis per camera frame ≈ 50 ms
    × 2 880 frames/day. At 150 devices that is ~6 CPU-hours/day *on top of* the existing ffmpeg poll, and a
    film render is another 60–120 s of a core. Today the server is one pm2 process with `pLimit(10)`. This
    needs a real job queue and probably a second box.
11. **Nothing measures the funnel, by design.** No analytics SDK. The only signal is a server-side count —
    Zelte with no binding and ≥ 20 Dinge over ≥ 14 days — which measures engagement and never intent. **We
    will not know why somebody did not buy.** That is the price of the privacy posture and it should be paid
    consciously.
12. **The free tier's job is to sell a €289 box, and this design gives it one 48 px row to do it with.**
    Right for the diary, possibly wrong for the business. If the attach rate comes in low, the pressure to
    add a second surface will be enormous — **and the second surface is the mode.** §18.2 exists to make
    that pressure visible when it arrives rather than persuasive.
13. **95 days of scope against 80 days of capacity**, resolved by a pre-agreed cut list rather than by
    optimism (§20.2). The cut list is the plan; if C1 and C2 are not taken in week one, they will be taken
    in week seven at a worse price.
14. **`quelle: 'hand'` is honest and it is also an admission.** A club that needs attested records will read
    that column and conclude, correctly, that the free product cannot give them what their compliance
    platform wants. That is the intended upgrade path — and it is also the reason a competitor with a
    cheaper sensor could take the club segment before the €289 controller reaches them.
