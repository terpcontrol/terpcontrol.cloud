# Cannabis grow clubs (German Anbauvereinigungen / CSCs): multi-user needs & compliance

Research date: **2026-08-24**. All statutory text checked against the consolidated KCanG (status:
"Geändert durch Art. 1 G v. 20.6.2024 I Nr. 207" — i.e. **no substantive amendment to the Anbauvereinigung
regime since June 2024**, verified on gesetze-im-internet.de on 2026-08-24).

Method note: ~40 live fetches. WebSearch quota was exhausted partway through, and all general search
engines (DuckDuckGo, Startpage, Brave, Qwant, Ecosia, Bing) are behind anti-bot walls from this host, so
the later half of the research is direct fetches against known/derived URLs plus one machine-readable
OpenAPI spec. Items I could not verify are marked **UNVERIFIED**.

---

## 0. The headline for Terp Control

German clubs are **already served** by ~20 dedicated compliance SaaS products, one of which (Cannanas)
claims >250 licensed clubs — "more than half of all licensed Anbauvereinigungen" — at **€1/member/month**,
and **already ships a documented REST API plus named IoT integrations with GrowControl, TrolMaster and
Siemens PLC**. Terp Control cannot win the compliance-system race and should not try. The open, defensible
slot is the **sensor/environment/actuation truth layer that feeds those systems** — a *device-attested
environmental record* with per-person attribution of physical grow-room actions, exported on demand,
with a hard architectural wall between "what the room did" (safe, keep) and "who consumed what" (toxic,
never touch).

---

## 1. Germany — what the law actually requires (KCanG, Kapitel 4)

### 1.1 The permit and its consequences

**§ 11 KCanG (Erlaubnispflicht)** — "Wer gemeinschaftlich Cannabis anbaut und zum Eigenkonsum an
Mitglieder weitergibt, bedarf einer Erlaubnis der zuständigen Behörde." The permit application must
already contain (§ 11 Abs. 4):

- name/contact/seat, Vereinsregister court and number
- "Vorname, Name, Geburtsdatum, Anschrift und elektronische Kontaktdaten der Vorstandsmitglieder"
- every employee with access to cannabis
- Führungszeugnis + Gewerbezentralregisterauszug (not older than 3 months)
- **estimated member count**
- **address of the befriedetes Besitztum and the size of the cultivation areas**
- **projected annual cannabis quantity**
- security measures, prevention officer, health & youth protection concept

Decision deadline: 3 months from complete application (§ 11 Abs. 5). Permit is non-transferable
(§ 11 Abs. 7). Changes must be reported "unverzüglich" (§ 11 Abs. 6).

**§ 12 (Versagung)** — refusal grounds include: no prevention officer, no health/youth concept, statute
lacking mandatory clauses (incl. a **minimum membership term of three months**, 18+ age, German
residence), and the **200 m rule**: the premises must not lie within 200 m of schools, children's/youth
facilities or playgrounds. Also refused for private dwellings, other clubs' premises, military areas.

### 1.2 Membership (§ 16)

- **max. 500 members** per association
- 18+ only
- must prove **residence or habitual abode in Germany** by official photo ID
- **one club only** — the applicant must declare in writing/electronically that they are not a member
  elsewhere
- address changes must be reported to the club "unverzüglich"

### 1.3 Cultivation (§ 17, § 18)

- § 17 Abs. 1: cannabis may only be grown **by members, collectively**. Marginal employees
  (geringfügig Beschäftigte, § 8 SGB IV) may only be put on cultivation/dispensing tasks **if they are
  members**. Non-members may only do work not directly connected to cultivation or dispensing.
- **§ 17 Abs. 2 is the multi-user requirement that matters:** members must *actively participate*
  ("aktiv mitwirken"), in particular by "eigenhändig mitwirken" in cultivation and directly connected
  activities. → **The law effectively demands a record of who physically did grow work.** This is why
  every serious club platform has a "member duty / participation journal" module (see §5.3).
- § 17 Abs. 3: gute fachliche Praxis; precautions against health-relevant substances.
- § 17 Abs. 4: BMEL may set maximum levels for **pesticides, fertilisers, biocides, mycotoxins, heavy
  metals, microorganisms** and agricultural/hygiene requirements by ordinance. (Whether such an
  ordinance has been issued as of 2026: **UNVERIFIED**.)
- § 18: quality assurance duties, **regular random sample testing**, and **immediate destruction of
  non-dispensable cannabis / propagation material** (§ 18 Abs. 3).

### 1.4 Dispensing (§ 19, § 20)

| Rule | Value |
|---|---|
| Dispensing only inside the befriedetes Besitztum, member→member, **both physically present** | § 19 Abs. 2 |
| ID check at every hand-over: **membership card + official photo ID** | § 19 Abs. 2 |
| Members 21+ | **max 25 g/day, 50 g/calendar month** |
| Heranwachsende (18–20) | **max 25 g/day, 30 g/calendar month**, and **THC ≤ 10 %** |
| Form | pure marihuana or hashish only |
| Onward transfer to third parties | forbidden; **shipping/delivery forbidden** (§ 19 Abs. 4) |
| Propagation material (§ 20 Abs. 3) | **max 7 seeds OR 5 cuttings OR 5 seeds+cuttings total per month** |
| Propagation material recipients (§ 20 Abs. 1) | members; non-members 18+ resident in Germany; other Anbauvereinigungen |
| Cuttings | shipping/delivery forbidden (§ 20 Abs. 5) |

### 1.5 Security and transport (§ 22)

- Fencing, burglary-resistant doors/windows, protection against unauthorised entry and removal.
- **No storage outside the permitted premises.**
- Transport of >25 g between parts of the same club's premises only under conditions incl. quantity
  cap, protective measures, **advance notification to the authority**, transport carried out by members,
  and a **transport certificate** whose 5 mandatory fields are listed in § 22 Abs. 4.

### 1.6 Youth protection & prevention (§ 23)

- No access for under-18s to the premises.
- **No advertising signage** outside; only a factual name plate at the entrance.
- Grow areas and greenhouses must be **screened from outside view**.
- A **Präventionsbeauftragte(r)** with demonstrated training from a state or specialist addiction-
  prevention body.
- Cooperation with local addiction counselling; a written **Gesundheits- und Jugendschutzkonzept**.

### 1.7 § 26 — the documentation and reporting core

**§ 26 Abs. 1** — continuous documentation, for traceability, of:

1. **name, first name, address** of every person/entity from whom propagation material was obtained
2. **quantities of cannabis in grams and unit counts of propagation material in stock**
3. **quantities of cannabis grown, in grams**
4. **quantities of cannabis destroyed (g) and propagation material destroyed (units)**
5. for every member receiving cannabis: **"Name, Vorname und Geburtsjahr"** + quantity + **THC content**
   + date of hand-over
6. for every member receiving propagation material: name, first name, year of birth + unit count + date
7. **quantity in grams and strains of cannabis transported under § 22 Abs. 3**, plus the transporting
   member, date, start and end address

(For propagation material handed to non-members under § 20 Abs. 1 S. 1 Nr. 2, the Nr. 6 detail is not
required.)

**§ 26 Abs. 2** — **retain 5 years**; transmit to the authority electronically **on request**; and
**by 31 January each year** transmit the previous year's documented information **in anonymised
electronic form** for the evaluation under § 43.

**§ 26 Abs. 3** — **by 31 January** also report electronically the quantities of cannabis **grown,
dispensed, destroyed and in stock, broken down by strain and by average THC and CBD content**.

**§ 26 Abs. 4** — on suspicion of a health risk beyond the typical risks of cannabis consumption:
notify the authority **unverzüglich**, inform members, **recall and destroy**.

**§ 26 Abs. 5** — on suspicion of loss ("Abhandenkommen") or unauthorised transfer: notify the authority
immediately. **The representative may refuse to answer where the answer would expose them or a relative
to prosecution** — an explicit *nemo tenetur* carve-out written into the statute. This is a strong
signal that the legislator itself recognised the documentation duty is a self-incrimination hazard.

### 1.8 § 27–§ 29 — supervision, and why the data is dangerous

- § 27: regular **on-site inspections and sampling**; orders may include temporary bans on cultivation
  or dispensing, mandatory testing, recalls, destruction, closure. **Appeals have no suspensive effect.**
- § 28 Abs. 2: the authority may "**Abschriften, Kopien, Ablichtungen und Auszüge von Unterlagen
  anfertigen und digitale Daten sicherstellen**" — i.e. **seize digital data**.
- § 28 Abs. 5: collected personal data **may be passed to other agencies where necessary to prosecute
  criminal offences or administrative offences under this Act**; anything beyond that is prohibited.
- § 28 Abs. 6: authority deletes when no longer needed, **at the latest after 5 years generally and
  2 years for personal data**, unless proceedings are pending.
- § 29: duties to tolerate and cooperate.

### 1.9 Penalties (§ 34) — the shape of the jeopardy

Up to **3 years imprisonment or fine** for, inter alia: possessing more than 30 g outside the residence
or more than 60 g in total; **more than 3 living plants**; cultivating without personal-use purpose;
manufacturing/trading/import/export; **passing cannabis to anyone**; acquiring more than 25 g/day or
50 g/month. Besonders schwere Fälle: **3 months–5 years** (commercial, health endangerment of several
people, adult→minor, non-trivial quantity). Top tier: **minimum 2 years** (commercial supply to under-18s,
gang + significant quantity, armed). Negligent commission: up to 1 year.

Private cultivation baseline for comparison: **§ 9 Abs. 1** — 18+, at their residence/habitual abode,
"insgesamt nicht mehr als drei Cannabispflanzen gleichzeitig"; **§ 9 Abs. 2** — no passing on.
**§ 3** — 25 g in public, **50 g and 3 living plants at home**, more than that only inside a licensed
club's premises or in transport under § 22 Abs. 3.

**Design consequence:** a shared grow log that records *plant counts, harvest weights and who handled
them* is, for a private German grower, a contemporaneous record of the exact facts that separate a legal
hobby from a 3-year offence. For a user in a prohibition jurisdiction it is worse.

### 1.10 Money (§ 24, § 25)

- § 24 is one sentence: contributions are fixed **in the statute (Satzung)**. The often-cited
  "Pauschalen staggered by quantity" model comes from the Gesetzesbegründung/practice, **not from the
  statutory text** — do not treat it as a legal requirement.
- § 25 (Selbstkostendeckung): for propagation material given to other clubs or to non-members, the club
  **must charge cost recovery** for producing it.

### 1.11 Market state, August 2026

- As of **March 2026: 397 approved Anbauvereinigungen out of 836 applications** (~47 %).
  NRW 113/209, Niedersachsen 82/137, Baden-Württemberg 35/113, Berlin 11/41, **Bayern 9/44** (21 of the
  Bavarian applications withdrawn).
- Cost anchors from a 2026 practitioner guide: security ~€5,000 one-off; THC testing equipment from
  €5,000; lab analysis **€40/test** (~€80/yr for two harvests); **software €50–100/month for 100 members**;
  insurance >€1,000/yr.
- Legislative outlook: the KCanG is **unchanged**; a second interim evaluation was due **April 2026**,
  final report **April 2028**. Repeal is not in the coalition agreement. The active tightening is on the
  **MedCanG** (telemedicine first-prescription ban, flower mail-order ban), which had **not** been voted
  before the 2026 summer recess. Stricter rules for Anbauvereinigungen are *discussed* but not enacted.
  (These 2026 political details come from trade/consumer sites, not primary sources — treat as
  **directionally reliable, individually UNVERIFIED**.)

---

## 2. Other markets

### 2.1 Malta — ARUC / CHRA (the closest analogue to Germany)

- Regulated since **December 2021**; supervised by the **Authority for the Responsible Use of Cannabis
  (ARUC)**.
- **19 licensed CHRAs as of April 2025; 22 by February 2026.**
- **Max 500 members**, Maltese residents 18+, non-profit; **tourists cannot join**.
- **7 g/day, 50 g/month**; **THC < 18 % for under-21s**; home possession 50 g; home grow 4 plants per
  household. Resin permitted from May 2025 at **1 g resin = 3 g flower**.
- Traceability: "**strict batch controls and distribution logging** … **tamper-evident records** required
  at every stage from seed to distribution"; **member registers submitted to ARUC quarterly**;
  unannounced compliance checks covering ID verification, inventory records and odour mitigation;
  **odour-mitigation action logs** are themselves a required record since the 2025 tightening.
- Penalties: up to **€10,000** for admitting minors; **€235 per odour incident**.
- No mandated software vendor.

### 2.2 Spain — no statutory regime, and a registry is a *liability*

- Cannabis social clubs exist in a **legal grey zone**. Catalonia's 2017 law (self-sufficient non-profit,
  18+, cap of **150 kg dried cannabis/year**) was struck down / "cancelled a few months after entry into
  force". Barcelona has pursued closures since 2023.
- The Supreme Court has narrowed the "shared consumption" doctrine that clubs relied on (reported
  July 2021 as removing the loophole). Case numbers **UNVERIFIED** — I could not reach a primary source.
- ConFAC (Confederación de Federaciones de Asociaciones Cannábicas) maintains a voluntary
  **"Código de buenas prácticas"**; there is **no legal duty to report yields or member consumption to
  any authority**.
- **Key contrast with Germany: in Spain a detailed member-consumption ledger is not a compliance asset,
  it is prosecution evidence.** Any product serving both markets must make the difference configurable,
  not baked in.

### 2.3 Czech Republic

- From **1 January 2026**: adults **21+** may cultivate **up to 3 plants** and possess **100 g at home /
  25 g in public**. Possession under 15 g or fewer than 5 plants is an infraction (fine up to
  **CZK 15,000**). Commercial sale remains prohibited. Medical cannabis legal since **1 April 2013**,
  up to **180 g/month** on e-prescription.
- **No club/association model** in the current Czech framework (per the sources I could reach). The
  much-discussed "psychomodulatory substances" amendment is referenced only by citation in the source I
  read — its content is **UNVERIFIED**.

### 2.4 Switzerland — pilot trials, the most data-heavy regime

- Legal basis: amended narcotics legislation in force since **May 2021** (Art. 8a BetmG — I could not
  fetch the verbatim article; **UNVERIFIED** in detail).
- Trials: **Weed Care, Basel** — started January 2023, **374 participants**, 10 pharmacies, 4 flower + 2
  hash products up to 20 % THC. **Cannabis Research Zurich / Züri Can** — from May 2023 to December 2028,
  **7,500 planned participants** across six cities, with a black-market control group. Five product
  categories (flower, hash, vapes, oils, edibles), **5–20 % THC**.
- The FOPH mandates **electronic sales tracking** and a mandatory data-collection system; participants
  are surveyed. **Cannavigia was selected by the FOPH for pilot projects** (vendor claim).
- Legislative: February 2025 the National Council health commission adopted a draft legalisation bill
  (3 home plants, purchase from licensed non-profit outlets); consultation on a Cannabis Products Act ran
  **August–1 December 2025**.

### 2.5 Uruguay — the state registry model

- **IRCCA** since 2014. Three mutually exclusive routes, all requiring registration in a **national
  registry**, Uruguayan residents 18+:
  - home grow: **6 plants, max 480 g/year**
  - pharmacy: **40 g/month**, identity confirmed by **fingerprint scanner** at purchase
  - **membership clubs: 15–45 members, up to 99 plants/year**, storage proportional to membership
- Sales to foreigners prohibited. The registry is state-held and purchase-linked — the most explicit
  "consumption database" of any regime studied.

### 2.6 United States — Metrc and BioTrack

**Metrc** (the de-facto standard):

- **~27–28 states/territories + D.C.** (site lists Alabama, Alaska, California, Colorado incl. an
  industrial-hemp program, D.C., Guam, Illinois, Kentucky, Louisiana, Maine, Maryland, Massachusetts,
  Michigan, Minnesota, Mississippi, Missouri, Montana, Nevada, New Jersey, New York, Ohio, Oklahoma,
  Oregon, Rhode Island, South Dakota, US Virgin Islands, Virginia, West Virginia). Marketing claims
  "30 regulatory markets" and a "100 % contract renewal rate".
- **Separate API instance per jurisdiction**: `api-ca.metrc.com`, `api-co.metrc.com`, `api-md.metrc.com`,
  `api-mi.metrc.com`, `api-me.metrc.com`, `api-ms.metrc.com`, `api-or.metrc.com`, …
- **Auth: HTTP Basic with two keys** — `Basic base64(integratorApiKey:userApiKey)`. Both must be sent in
  the Authorization header.
- **v2 resource groups**: `/plants/v2/`, `/plantbatches/v2/`, `/harvests/v2/`, `/packages/v2/`,
  `/transfers/v2/`, `/sales/v2/`, `/labtests/v2/`, `/items/v2/`, `/strains/v2/`, `/tags/v2/`,
  `/locations/v2/`, `/sublocations/v2/`, `/employees/v2/`, `/facilities/v2/`, `/processing/v2/`,
  `/patients/v2/`, `/patient-checkins/v2/`, `/retailid/v2/`, `/transporters/v2/`, `/unitsofmeasure/v2/`,
  `/wastemethods/v2/`, `/additivestemplates/v2/`. One integrator guide counts **453 endpoints across
  25 resources and 6 license types**.
- **Rate limits (widely reported, and consistent across integrator write-ups): 50 GET/s per facility,
  150 GET/s per vendor API key, 10 concurrent GET per facility, 30 concurrent GET per integrator.
  Limits apply to GET only, not PUT/POST/DELETE. Exceeding → HTTP 429, sometimes with `Retry-After`.**
  Metrc's own docs say only "rate limiting is on a per-facility basis … consult your Metrc agreement",
  so treat the exact numbers as **strongly corroborated but not officially confirmed**.
- Compliance ordering is strict: plant → harvest → package → transfer must follow the exact lifecycle
  or the state rejects the report. Physical **RFID tags** per plant/package.

**BioTrack / BioTrackTHC**: could not be fetched (biotrack.com returned 403; no Wikipedia article).
Its historical role as the state traceability contractor for Washington, New Mexico, Hawaii, North Dakota,
Delaware, Arkansas and others is **UNVERIFIED** here — do not cite from memory.

**Relevance to Terp Control: none directly.** Metrc-style seed-to-sale is a *government* system;
integrating with it means becoming a licensed integrator per state. Its only useful lesson is the
**shape** of a lifecycle model (batch → plant → harvest → package → waste → transfer, each with actor
and timestamp) which the German club platforms have copied.

---

## 3. What German clubs actually use today

### 3.1 The market map (verified vendor/aggregator data)

OMR Reviews lists **20 products** in its "Cannabis Social Club" category. Named products with the
evidence I could confirm:

| Product | Model / hosting | Price (EUR, ex VAT) | Notable |
|---|---|---|---|
| **Cannanas** (cannanas.club) | Cloud, German servers | **€1/member/month**, all features; free up to 7 members; 50 % off until licensing; **POS €79/month** billed annually (Cloud-TSE via **fiskaly**, KassenSichV/DSFinV-K), extra site +€49/month | Claims **>250 licensed clubs, >50,000 app downloads, "more than half of all licensed" AVs**. 4.9/5 (31 reviews). Has REST API, role system, audit log, IoT integrations. |
| **420cloud** (420cloud.io) | Cloud, DE servers | **CSC Basic €1/member/month** (members + inventory + track&trace + dispensing); **Track & Trace Pro +€1/member/month** (task planning, quality controls, cleaning/maintenance protocols, **"unlimitierte Sensor-Einbindung"**); free until first dispensing | Explicitly writing about **TrolMaster, GrowControl, Siemens SPS** and states it is "working on the appropriate API" for IoT ecosystems. Digital Cannabis Pass for members. |
| **Die Hanf-App** (diehanfapp.de) | Cloud and on-prem, DE servers | **€0.50/member/month**; ad-supported free tier | 8 modules incl. Growtagebuch, Transportbescheinigungen, "Berichte nach KCanG". No IoT. |
| **casoma** (casoma.de) | Cloud, DE servers, **open source on GitHub** | **€10/month first year then €20/month**, 20 members included, **+€0.50/member (yr 1) then +€1**; 30-day trial; free premium support at 300+ members | Per-club **separate database schemas**. |
| **AnbauV Manager** (anbauv.de) | **Locally installed, deliberately no cloud** | annual licence, price not published | Positioning quote: *"Ihre Mitgliederdaten sind sensibel und gehören nicht in die Cloud."* Growboard, auto-generated Weitergabescheine as PDF. |
| **CANNAVIGIA** (cannavigia.com) | Cloud | **Club €0**, **Dispensing €199/mo**, **ProductPass €199/mo**, **Manufacturing €399/mo**, **Cultivation €599/mo** (flat per module, no seat limits published) | GACP / EU-GMP oriented; **selected by the Swiss FOPH for pilot projects**; claims 10M+ plants tracked, 150+ clients. Explicit "KCanG-compliant Reports" in the Dispensing module. |
| **Herb Hub** | Cloud, DE servers | **€12/month** | |
| **420MEMBERS** | On-prem | **from €10/month** | |
| Others listed | | | Cannabis Club Systems, localeaf, edelcrowd, cannaflow, Canbase, HerbTrack, HelloHanf (**US servers**), CannaCash Solutions, Club*Soul, cannabees.cloud, LeafConnect, 420+ App, WeedWallet, CannaDesk |

Practitioner guides also put the realistic software line item at **€50–100/month for a 100-member club**,
which matches €0.50–1.00/member.

Spreadsheets: explicitly called out as **not acceptable** by a Berlin data-protection lawyer —
*"Excel oder Google Tabellen"* are rejected as lacking protocol logging and access controls.

### 3.2 The reference data model — Cannanas' public OpenAPI

This is the single most useful artefact found. `https://api.cannanas.club/docs` (Swagger UI; spec at
`/docs/cannanas-api-docs.yaml`, also reconstructable from `/docs/swagger-ui-init.js`).

- **OpenAPI 3.0.0**, `v1`, **185 paths**, **96 request schemas**, 22 tags:
  Authentication, API-Health, Carts, Chat, Clubs, Contacts, **Events**, Feed, Finances, **Grow**,
  Inquiries, **Inventory**, Locations, **Member Journals**, Members, Products, Public Data, Registration,
  **Reports**, **Roles**, Tags, **Transports**.
- **Auth: `Authorization: Bearer <API_KEY>`**, personal API keys generated at
  `https://app.cannanas.club/user/api-keys`; test endpoint `GET https://api.cannanas.club/v1/auth/test`
  (returns 401 unauthenticated). Licence: proprietary, "Einsen und Nullen UG (haftungsbeschränkt)".
  **No rate limits and no webhooks documented.** No `servers[]` block.
- **No sensor-ingestion endpoint exists in the public API** — the IoT integration is not exposed. That is
  an opening.

Selected paths that map 1:1 onto § 26 KCanG:

```
GET  /v1/clubs/{clubId}/events                       # audit trail, filter by event_types,user_id,date range
GET  /v1/clubs/{clubId}/member-limits?limitDate=     # per-member daily/monthly used vs remaining, junior flag
GET  /v1/clubs/{clubId}/member-journals              # participation/duty logs (§ 17 Abs. 2)
POST /v1/clubs/{clubId}/diaries                      # grow diary entry w/ 40 measurement fields
POST /v1/clubs/{clubId}/batches/{id}/cultivation-mass-logs
POST /v1/clubs/{clubId}/harvests/{id}/drying-logs
POST /v1/clubs/{clubId}/inventory/{id}/dispose
POST /v1/clubs/{clubId}/waste-disposals
POST /v1/clubs/{clubId}/transports/{id}/pdf-export
POST /v1/clubs/{clubId}/exports/reports/annual/{year}/pdf
POST /v1/clubs/{clubId}/exports/reports/csv | /xlsx | /xlsx/validations
POST /v1/clubs/{clubId}/exports/reports/report-compliance-review
```

Details worth stealing:

- **`anonymizationType: NONE | PSEUDONYMIZED | ANONYMIZED`** on every report export — a first-class
  privacy control, exactly implementing § 26 Abs. 2 ("in anonymisierter Form" for the 31 January filing
  vs. full data only "auf Verlangen").
- The annual report request carries per-table `disabled…` arrays named in German after the § 26 Abs. 1
  categories: `disabledErhaltenesVermehrungsmaterial`, `disabledGelagertesCannabis`,
  `disabledAngebautesCannabis`, `disabledVernichtetesCannabis`, `disabledWeitergegebenesCannabis`,
  `disabledWeitergegebenesVermehrungsmaterialNichtmitglieder`, `disabledTransportiertesCannabis`, …
- **`authority_id` enum with 23 values** proves reporting is per-Land and sometimes per-Bezirk:
  `authority:baden_wuerttemberg`, `authority:bayern`, `authority:berlin` **plus
  `authority:berlin:marzahn|pankow|lichtenberg`**, `authority:brandenburg`, `authority:bremen`,
  `authority:hamburg`, `authority:hessen`, `authority:mecklenburg_vorpommern`, `authority:niedersachsen`,
  **`authority:nordrhein_westfalen:arnsberg|detmold|düsseldorf|köln|münster`**, `authority:rheinland_pfalz`,
  `authority:saarland`, `authority:sachsen`, `authority:sachsen_anhalt`, `authority:schleswig_holstein`,
  `authority:thueringen`. **There is no single national submission format.**
- **Cultivation status enum** (used on both batches and plants):
  `SEED, GERMINATION, CUTTING, VEGETATIVE, FLOWERING, HARVEST, CURING, DRYING, QUARANTINE, DESTROYED`,
  with a matching set of per-plant date fields (`cultivation_seed_date`, `…_germination_date`,
  `…_cutting_date`, `…_vegetative_date`, `…_flowering_date`, `…_harvest_date`, `…_drying_date`,
  `…_curing_date`, `…_destroyed_date`).
- **Batch propagation lineage**: `mother_plants: [{plant_id, cutting_count 1..100}]`, `parent_plant_id`,
  `plant_count ≤ 1000`, plus `is_mother` on plants.
- **`CreateDiaryRequest.measurements` has 40 numeric fields** — this is the environmental schema a club
  platform expects, and it is almost exactly a grow controller's telemetry:
  `air_temperature, air_humidity, air_co2, air_throughput, water_temperature, soil_temperature,
  water_ph, wastewater_ph, soil_ph, water_ec, wastewater_ec, soil_ec, water_ppm, wastewater_ppm,
  soil_ppm, soil_humidity, nutrition_n, nutrition_p, nutrition_k, light_lux, light_lumen, light_candela,
  light_ppfd, light_temperature, light_distance, thc, cbd, plant_height, plant_weight, plant_bud_size,
  plant_stem_diameter, plant_leaf_count, plant_leaf_size, plant_leaf_color, plant_root_development,
  plant_trichome_development, plant_infestation, plant_sickness, plant_nutrition_deficit,
  plant_watering_problem` — and a diary entry can be attached to `zone_id`, `strain_id`, `plant_id`,
  `batch_id` or `harvest_id`, with file attachments.
- **Zones carry `streams.video[].url`** — club software already expects a **camera stream URL per grow
  room**. Terp Control has a webcam; this is a ready-made integration point.
- **Inventory transaction type enum** (the traceability ledger):
  `initial, borrow:out, borrow:in, plant:out, plant:in, transfer:out, transfer:in, transfer:planned,
  adjustment, transformation, reservation, dispense, dispense:storno, merge:out, merge:in, disposal,
  transaction` — with `received_by`, `received_from`, `related_transaction_id`, `occurred_at`.
  Note **`dispense:storno`**: corrections are *new compensating entries*, not edits. That is how
  tamper-evidence is achieved in practice.
- **Waste disposal carries `disposed_by_user_ids`** — destruction is attributed to named people.
- **Member journal**: `type: CLUB_DUTY`, `status: PLANNED | PENDING_APPROVAL | COMPLETED | REJECTED`,
  `regulatory_relevance: "kcang"`, `started_at`/`ended_at`, `duty_notes`, `template_id` (task template),
  `location_id`. Plus a dedicated permission `member:journals:self-checkin`.
  → **This is the "who watered what, when" primitive, and it exists because § 17 Abs. 2 requires it.**
- The compliance-review endpoint is candid about its own limits: *"Rebuilds the full anonymized KCanG §26
  XLSX tables (names and addresses masked; always ANONYMIZED regardless of request) … Requires club
  HAS_AI and user HAS_AI_CONSENT. **Not legal advice.**"*

### 3.3 The 70-permission role model (verbatim, from `CreateRoleRequest.permissions`)

Roles are **custom, named, coloured, with a permission array and a user list** — not fixed
admin/member tiers:

```
club:manage, club:read, club:data:manage, club:billing:manage,
posts:read, posts:manage, announcements:manage,
members:invite, members:read, members:manage,
member:journals:read, member:journals:manage, member:journals:self-checkin,
strains:read, strains:manage, strains:rate, ratings:read, ratings:manage,
plants:read, plants:manage, harvests:read, harvests:manage, rooms:read, rooms:manage,
club:roles:read, club:roles:manage,
subscriptions:manage, subscriptions:read, credits:manage, credits:read,
contingents:manage, contingents:read,
charges:create:self, credits:create:self, charges:manage, charges:read,
ledger:manage, ledgers:read, payment:methods:manage,
tse:manage, tse:operate, bank-connections:manage, bank-connections:read,
channels:public:read, channels:messages:send, channels:public:create,
channels:private:create, channels:private:manage,
inventory:read, inventory:manage, transports:read, transports:manage,
products:read, pos:read, carts:read, carts:manage, carts:create:reserved,
discounts:manage, pos:members:verify, pos:charges:mark-paid,
contacts:read, contacts:manage, wiki:read, wiki:manage,
locations:read, locations:manage, reports:manage,
recalls:read, recalls:manage, tags:manage, calendar:view, calendar:manage
```

Observations for Terp Control:
- The grow-relevant slice is tiny: **`plants:*`, `harvests:*`, `rooms:*`, `strains:*`,
  `member:journals:*`, `locations:*`** — ~12 of 70. Everything else is money, membership and POS.
- Note the `:self` suffix pattern (`charges:create:self`, `credits:create:self`,
  `member:journals:self-checkin`) — a member can act on their own record without seeing anyone else's.
  **That is the single most reusable idea for a multi-user grow diary.**
- Note `recalls:*` — § 26 Abs. 4 recall handling is a permission of its own.

### 3.4 Named hardware/partner integrations (cannanas.club/integrationen)

| Partner | Purpose |
|---|---|
| **DATEV** | accounting/tax-advisor export |
| **easySecure** | member registration + physical access control |
| **GrowControl** (German controller vendor, growcontrol.de: GrowBase / GrowBase Pro / GrowBase Lite, FanBase EC+, IRCube leaf-temp sensor for VPD, "GrowControl Industrial" multi-zone) | indoor environment monitoring — "optimierte Kontrolle von Umgebungsbedingungen" |
| **TrolMaster** | environmental control systems |
| plus **Siemens PLC** and "DIY solutions" named on the IoT feature page | |
| **Cannanas REST API** | CRM, back-office, dashboards, custom AI workflows; `integration@cannanas.club` invites new integrations |

420cloud's own article ranks the same three: TrolMaster ("extremely modular … suitable for large
operations serving up to 500 club members"), GrowControl ("less modular but significantly more
differentiated data processing, German manufacturing quality"), Siemens PLC ("most professional
large-scale operations use custom-configured Siemens systems"). Notably, **growcontrol.de's own site
mentions neither multi-user access, data export, KCanG nor Anbauvereinigungen** — the club platforms
integrated *to* them, not the other way round.

**This is the competitive picture in one line: the club software vendors have already decided that grow
controllers are a data source they want, they have named three, and neither Terp Control nor any
controller vendor currently owns that interface.**

---

## 4. Multi-user requirements, distilled

### 4.1 Roles

Minimum viable role set for a club-shaped grow deployment, derived from KCanG duties + the Cannanas model:

| Role | Legal anchor | Needs |
|---|---|---|
| **Vorstand / operator** | § 11, § 12 (Zuverlässigkeit; personally liable) | everything, incl. role management and export |
| **Grower / member on duty** | § 17 Abs. 2 (must participate "eigenhändig") | log work on the rooms/plants they are assigned; self-check-in; cannot see other members' data |
| **Prevention officer** | § 23 Abs. 4 | read-only on member-facing material; **must not** need grow-room telemetry |
| **Auditor / authority** | § 27–29 | time-boxed, read-only, export-only, every access logged |
| **Non-member contractor** | § 17 Abs. 1 (may only do work *not* directly connected to cultivation/dispensing) | must be *excludable* from cultivation records by design |

The `:self` permission suffix is the important pattern: most club members should be able to write their
own participation and read the room, and see nothing else.

### 4.2 Attribution ("who watered what, when")

- Legally required in Germany only for: **participation in cultivation** (§ 17 Abs. 2),
  **destruction** (§ 26 Abs. 1 Nr. 4 — the club must record it; Cannanas attributes it via
  `disposed_by_user_ids`), **transport** (§ 26 Abs. 1 Nr. 7 names the transporting member), and
  **dispensing** (§ 26 Abs. 1 Nr. 5/6 names the receiving member).
- **Not legally required**: who adjusted the VPD setpoint, who topped up the reservoir, who changed a
  light schedule. Those are *operational* attribution — valuable for teams, but they are a **choice**,
  and therefore should be an **opt-in per-installation setting**, not a default.

### 4.3 Audit trail / tamper-evidence

- The real-world pattern is: **append-only event log** (`GET /events` with `event_types`, `user_id`,
  `created_at_start/end`, `offset`, `limit`) + **compensating entries instead of edits**
  (`dispense:storno`, `charges/{id}/correction`, `charges/{id}/reversal`, `cultivation-mass-logs`
  as dated rows rather than a mutable weight field).
- Nothing in the KCanG demands cryptographic immutability. Germany's only hard tamper-evidence
  requirement in this space is fiscal, not cannabis: the **TSE / KassenSichV / DSFinV-K** requirement on
  the cash register (Cannanas uses Cloud-TSE via fiskaly; permissions `tse:manage`, `tse:operate`).
- **Implication: hash-chaining a grow log is optional engineering polish, and it cuts both ways — an
  immutable log the user cannot delete is a liability in a prohibition jurisdiction.**

### 4.4 Export for authorities

- Formats actually shipped: **PDF** (annual report, transport certificate, stock list, dispensing
  labels, membership export), **CSV**, **XLSX** (+ an `xlsx/validations` pre-check).
- Two distinct modes: **on request → full data**; **31 January → anonymised**. Build both, and default
  to the anonymised one.
- **There is no standardised nationwide schema.** 23 authority identifiers, five separate NRW
  Bezirksregierungen, three Berlin district offices. Anyone promising "one-click authority export"
  is shipping 23 templates.

---

## 5. GDPR — what actually applies

### 5.1 Is member cannabis data Art. 9 health data?

Contested, and the safe answer is yes.

- Art. 9(1) GDPR prohibits processing of, inter alia, **Gesundheitsdaten**. Exceptions are the ten
  grounds in Art. 9(2)(a)–(j) — for a club the plausible ones are **(a) explicit consent** and
  **(g) substantial public interest** / a member-organisation carve-out under **(d)**.
- A German law firm (Nimrod Rechtsanwälte) states plainly that *"data on consumption behaviour could
  constitute a special category of personal data — health data — under Art. 9(1) GDPR, where processing
  is fundamentally prohibited"*, citing **Recital 35** (broad definition of health data) and **CJEU
  C-184/20** (which read "data revealing" special categories expansively).
- Cannanas' own GDPR explainer is more cautious: it relies on **Art. 6(1)(b)** (contract) and
  **Art. 6(1)(c)** (legal obligation — § 26 KCanG) and calls the data "sensibel" without formally
  classifying it under Art. 9.
- Practical reading: **§ 26 KCanG is itself the Art. 6(1)(c) legal obligation**, so the *club* is on
  firm ground for the statutory minimum; anything beyond the statutory minimum has no such cover.

### 5.2 DPO and DPIA

Reported thresholds diverge and neither cites the statute cleanly — treat as **contested**:

- Cannanas: DPO required *"wenn mindestens 20 Personen … regelmäßig mit der Datenverarbeitung beschäftigt
  sind"* (that is § 38(1) BDSG, correctly stated).
- krautinvest: DPO *"mandatory when processing occurs for 20+ members or involves special data categories
  per Article 9"* (that conflates § 38 BDSG with Art. 37(1)(c) GDPR).
- One practitioner source says enquiries to Land supervisory authorities generally **affirm** both the
  need for a **DSFA (Art. 35)** and consequently a DPO, because member lists + dispensing documentation
  are a *core activity* involving special-category data at scale.
- Both agree a **DSFA is required at minimum where there is video surveillance** of the facility —
  which almost every club has, because § 22 Abs. 1 demands physical security.
- Liability angle: a Berlin lawyer notes that **without a designated DPO the Vorstand personally carries
  the exposure**, incl. Art. 82 damages claims, and that a board member cannot be the DPO (conflict of
  interest). Appointing an **external** DPO is sold as liability offloading.

### 5.3 The rest of the GDPR checklist as clubs are actually told to implement it

- **Art. 30 Verarbeitungsverzeichnis** — mandatory, covering member management, accounting, dispensing,
  website.
- **Art. 28 AVV** with every processor — including the software vendor. *"Dann seid ihr verpflichtet …
  einen Auftragsverarbeitungsvertrag (AVV) abzuschließen."*
- **Art. 32 TOMs** — TLS everywhere, transport-encrypted mail, end-to-end from device to server, **2FA**,
  prompt patching, tested backups + DR at multiple sites, mandatory staff training.
- **Art. 25 Privacy by design + data minimisation** — collect only names, addresses, individual
  dispensing quantities, and health data *only where operationally necessary*.
- **Art. 33 breach notification** — *"unverzüglich und möglichst binnen 72 Stunden."*
- **Retention** — delete when the purpose ends, subject to the KCanG's own **5-year** period. Data of
  departed members must be deleted after the statute's period.
- **Software selection red flags** published for clubs: servers outside Europe, no AVV, no audit logs,
  no security certifications, opacity about subprocessors.
  → **HelloHanf is listed on a comparison site as US-hosted; that is the sort of thing German clubs are
  being told to reject.**

### 5.4 The public-policy criticism, which is the honest framing

German press coverage of § 26 characterises it as resembling **"einer Vorratsdatenspeicherung"** (data
retention). Authorities may access and copy records containing consumption data, keep personal data
**two years**, and pass it to other agencies for prosecution — **without prior judicial approval and
without a restriction on which officials may access it**. And the sharpest point, which is directly a
product argument:

> **"Der Schwarzmarkt kennt keinen Datenschutz."** — the illegal dealer creates no record, which is
> exactly what makes him attractive. A compliance regime that logs consumers can push them back to the
> black market.

Independently reported precedents of clubs' member data leaking: a **"CanGuard software breach" said to
have exposed thousands of member records** (asserted by wetzel.berlin; I could not corroborate it from a
second source — **UNVERIFIED**). Likewise the frequently cited **GrowDiaries exposure** — **UNVERIFIED**,
I could not reach any primary source from this host.

---

## 6. What Terp Control must NOT do

### 6.1 The product itself is not the legal risk — the data is

Two things I checked precisely, because they are the usual fear:

- **21 U.S.C. § 863** (US federal drug paraphernalia): defines paraphernalia as equipment *"primarily
  intended or designed for use in manufacturing, compounding, converting, concealing, producing,
  processing, preparing, injecting, ingesting, inhaling, or otherwise introducing into the human body a
  controlled substance"*, and the enumerated list (d)(1)–(15) is pipes, water pipes, bongs, roach clips,
  freebase kits etc. **It contains no language about cultivation, planting or growing equipment.**
- **Misuse of Drugs Act 1971 s.9A** (UK): supplying articles for the **administration** or **preparation
  for administration** of a controlled drug. **Cultivation equipment and software fall outside its scope.**

So: an environmental controller and a grow diary are not contraband in either regime. What creates
jeopardy is a **cloud-held, timestamped, attributed, geo-locatable record of an illegal cultivation
operation** — obtainable by subpoena/MLAT, by seizure (§ 28 Abs. 2 KCanG allows the authority to
"digitale Daten sicherstellen"), or by breach.

Compare Grow With Jane, the market-leading consumer grow diary, as an example of the *wrong* posture:
data processed in the **US and Ireland via Google Firebase**, **Google AdSense behavioural tracking with
IP addresses**, Google Analytics + Firebase Analytics, and a policy stating the operator *"may be
required to reveal personal data upon request of public authorities"* and may use data *"in Court or in
the stages leading to possible legal action."* Its terms push all risk to the user — *"You accept
personal responsibility for any liability, injury … criminal arrest or prosecution"* — with liability
capped at **$5**. That is a legally defensible position for the vendor and a bad one for the grower.

### 6.2 Hard "do not build" list

1. **Do not store per-person consumption or dispensing records.** § 26 Abs. 1 Nr. 5/6 data — name, first
   name, year of birth, grams, THC %, date — is the single most sensitive dataset in the sector, is
   arguably Art. 9 GDPR, triggers DPO/DSFA obligations, and is the thing police want. A grow controller
   has no reason to touch it. **Leave it entirely to the club platform.**
2. **Do not become the club's system of record for § 26.** The moment Terp Control is the place a
   Behörde looks for the § 26 file, it inherits: 23 authority formats, 5-year retention obligations,
   Art. 28 AVV with every club, DSFA, audit obligations, and liability when the export is wrong. The
   incumbents charge €0.50–1.00/member/month for exactly that misery.
3. **Do not require identity to use a device.** Anything that binds a real name to a grow room is a
   deanonymisation vector. Pseudonymous accounts, no phone number, no real-name enforcement.
4. **Do not collect or infer location.** No GPS, no IP-geolocation logging, no "find growers near you",
   no default timezone-from-IP that gets persisted. Room-level location naming must be free text the
   user chooses.
5. **Do not build a public/social grow feed with real identities.** GrowDiaries-style community + real
   accounts is how a hobby becomes a target list.
6. **Do not make the audit log undeletable for the *account owner*.** Tamper-evidence protects a
   *regulated* club against its own staff; it victimises an unregulated grower. Immutability must be a
   deliberate, opt-in, club-scoped mode — never global.
7. **Do not retain telemetry indefinitely by default.** Long, unbounded time series are the richest
   evidence in the system (a light schedule flipping 18/6 → 12/12 is a legible harvest calendar).
8. **Do not ship analytics/ad SDKs.** No AdSense, no third-party crash/analytics tools that see grow
   content. This is table stakes given what the German market is being told to look for.
9. **Do not host outside the EU for EU users**, and say so plainly. "German/EU servers" is an explicit
   purchasing criterion for Anbauvereinigungen; US hosting is on the published red-flag list.
10. **Do not claim compliance.** Even Cannanas' own AI compliance endpoint says **"Not legal advice."**
    Any "KCanG-konform" badge on a controller is a warranty you cannot honour across 23 authorities.

### 6.3 The line between "useful shared diary" and "self-incrimination database"

The distinction that survives scrutiny:

| Keep (device-observed, thing-scoped) | Refuse (person-scoped, product-scoped) |
|---|---|
| Room/zone climate time series (temp, RH, VPD, CO₂, PPFD) | Who consumed what, when |
| Setpoints, schedules, actuator states, alarms | Member identity, DOB, address, membership number |
| Irrigation events, EC/pH readings | Per-member dispensing quantities and THC content |
| Photos of a plant/room the user chose to take | Payments, credits, quotas, POS |
| A task record: "flush done", optionally with an actor | A permanent, non-deletable inventory of grams |
| Harvest wet/dry weight — **if the user opts in** | Anything requiring a real name |

Three rules make it concrete:

- **Scope data to things, not people.** A Terp Control record answers *"what did room 2 do"*. Attribution
  is an optional overlay the account owner enables, not a property of the data model.
- **Every retention window is user-set and short by default.** Offer e.g. 90 days default for high-
  resolution telemetry, with explicit opt-in to longer retention "because my club must keep records for
  five years". Make deletion instant, complete and self-service — including a visible **panic delete**
  for the whole account.
- **Export beats storage.** Terp Control should be very good at *handing data to the club platform*
  (push a diary entry, hand over a CSV, hand over a camera URL) and deliberately mediocre at *keeping*
  it. The place the five-year record lives should be the club's chosen compliance system, on the club's
  legal basis, under the club's AVV.

### 6.4 A jurisdiction switch is not optional

A single default is wrong for both audiences:

- **DE / MT club mode:** attribution on, participation logging on, longer retention, export tooling,
  audit log visible to Vorstand — because the law *requires* it.
- **DE private (3 plants) and prohibition-jurisdiction mode:** attribution off, no per-plant weights
  prompted, short retention, no cross-device history, no community, one-tap wipe — because the law
  *punishes* it.

Ship the second as the default. Make the first an explicit, informed opt-in with a plain-language
explanation of what changes and why.

---

## 7. Where Terp Control can actually win

1. **Be the sensor layer the club platforms already want.** 420cloud states it is "working on the
   appropriate API" for TrolMaster/GrowControl/Siemens. Cannanas already lists GrowControl and TrolMaster
   as integrations but exposes **no sensor endpoint in its public API** — the ingestion is private.
   A Terp Control → Cannanas integration is a business-development conversation
   (`integration@cannanas.club`), not a compliance project.
2. **Speak their diary schema.** `POST /v1/clubs/{clubId}/diaries` with `zone_id` + a `measurements`
   object is a near-perfect target for Terp Control telemetry: `air_temperature`, `air_humidity`,
   `air_co2`, `air_throughput`, `water_temperature`, `water_ph`, `water_ec`, `soil_*`, `light_ppfd`,
   `light_lux`, `light_temperature`. Terp Control could emit a **daily or per-event diary entry with
   sensor-attested values** where clubs currently type numbers in by hand.
3. **Map Terp Control devices to `zones`, and publish the camera as `zones.streams.video[].url`.** The
   club data model already has a slot for a per-room video stream; Terp Control already has a camera and
   timelapses.
4. **Own "device-attested" as the differentiator.** A hand-typed diary measurement is worth little in an
   inspection; a value the device recorded, with the device's own clock and identity, is worth more.
   That is a claim no spreadsheet-driven competitor can make, and it does **not** require storing a
   single person's data.
5. **Multi-user primitives worth building, in priority order:**
   - room/device-scoped roles with a `:self` tier (a member can log their own work, see the room, see
     nothing else)
   - a **participation/duty log** (`PLANNED → PENDING_APPROVAL → COMPLETED → REJECTED`) — directly
     serves § 17 Abs. 2 and is the one *legally motivated* multi-user feature a controller can own
   - append-only event log with compensating corrections rather than edits
   - time-boxed read-only "auditor link" that expires and logs its own access
   - CSV/XLSX/PDF export of a date range, with a **pseudonymise/anonymise toggle** copied straight from
     `anonymizationType: NONE | PSEUDONYMIZED | ANONYMIZED`
6. **Pricing reality check.** Clubs pay **€0.50–1.00/member/month** for the whole compliance stack, i.e.
   **€50–100/month for 100 members**. Cannavigia's Cultivation module at **€599/month** shows the ceiling
   for a serious cultivation-only product, but that is a GACP/EU-GMP audience, not a 500-member CSC. A
   controller subscription must sit *alongside* one of these, not attempt to replace it.

---

## 8. Confidence and gaps

**High confidence (primary or near-primary sources fetched today):**
KCanG §§ 3, 9, 11, 12, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 28, 34; Cannanas' full OpenAPI (185 paths,
96 schemas, permission enum, authority enum, measurement fields — extracted from the live spec); Cannanas,
420cloud, casoma, Die Hanf-App, Cannavigia pricing pages; Metrc endpoint groups + auth scheme + state
list; 21 U.S.C. § 863; MDA 1971 s.9A; Art. 9 GDPR.

**Medium confidence (secondary but consistent):**
Metrc's exact rate limits (50/150 GET/s, 10/30 concurrent) — corroborated across integrator write-ups but
Metrc's own docs decline to state numbers; German approval statistics (397/836, March 2026) — single
practitioner source; Malta figures (19 → 22 CHRAs, quarterly member registers, tamper-evident records) —
single industry blog; Swiss trial participant numbers.

**UNVERIFIED / do not cite as fact:**
- BioTrack's current government contracts and which states it serves (site 403; no encyclopaedia entry).
- The "CanGuard" CSC software breach; the GrowDiaries exposure.
- Spanish Supreme Court case numbers and the precise current doctrine.
- Whether the § 17 Abs. 4 BMEL ordinance on maximum residue levels has been issued.
- Czech "psychomodulatory substances" amendment content.
- Verbatim Art. 8a BetmG and the Swiss pilot-trial ordinance's data-collection duties.
- Whether any German authority has published a machine-readable § 26 submission schema (I found none;
  the 23-value `authority_id` enum suggests strongly that none exists).
- Cannanas rate limits and webhook support (absent from the spec).
- 2026 German political items (April 2026 interim evaluation, MedCanG vote status) — trade press only.
