# Feeding Schedules as a Built-In Feature — Research Findings

**For:** Terp Control (terpcontrol.cloud) — IoT grow controller + Angular/Ionic webapp, Node/Express + MongoDB, ESP32/MQTT
**Date:** 2026-08-24
**Scope:** Manufacturer feed-chart landscape, data structures, machine-readability, copyright/trademark risk, EC/pH/flush domain facts, schedule-follow UX requirements.

---

## 0. Verification status — read this first

Everything below is tagged:

- **[VERIFIED-PRIMARY]** — I pulled it from the manufacturer's own PDF, own web calculator, or own JS bundle and extracted the numbers myself.
- **[VERIFIED-SECONDARY]** — from a retailer/reseller transcription or search result; directionally right, numbers may be stale or wrong.
- **[UNVERIFIED]** — could not confirm; stated as such.

Several manufacturer sites actively block automated fetching (Advanced Nutrients returns HTTP 202 with an empty body to non-browser clients; GrowDiaries and feedschedules.com sit behind Cloudflare; Google Play truncates). Where I could not get primary data I say so rather than guessing.

**Local artefacts produced during this research** (all under `/tmp/claude-0/-home-user/c9195cd0-e115-5ec0-916e-15e03b9d32d0/scratchpad/`):

| File | What it is |
| --- | --- |
| `pdftxt.py` | Minimal FlateDecode PDF text extractor (stream-order, no layout) |
| `pdfgrid.py` | **Coordinate-aware** PDF extractor — reconstructs table rows from `Tm`/`Td` text matrices. This is the one that actually works on feed charts. |
| `hg_calc.js` / `hg_calc.html` | House & Garden's own nutrient calculator — full feed chart as JS arrays |
| `mills_main.js` | Mills Nutrients' own bundle — full feed chart as a JS module |
| `remo_calc.html` | Remo Nutrients' calculator — full chart as HTML with `data-litres`/`data-gallons` attributes |
| `gh_prog.html` | General Hydroponics Flora Series 13-week program, server-rendered HTML |
| `athena_blended.pdf`, `Feed-Schedule-Athena-Pro.pdf`, `MILLS_HC_A5-SCHEMA-FLYER_EN-182.pdf`, `Dutchpro_Feedchart_Soil_Hardwater.pdf` | Official PDFs, downloaded |

---

## 1. Executive summary

1. **There is no such thing as "the feed chart" for a brand.** Every major brand publishes a *matrix* of charts, cross-cut by 3–6 independent axes (substrate, water hardness, feed strength, run length, region/units, CO₂). Mills alone publishes an EU flyer in **ml per 1 L** keyed to tap-water EC 0.7 vs RO EC 0.0, *and* a US web calculator in **ml per US gallon** keyed to light/medium/heavy. Same brand, same products, incompatible numbers.

2. **Week-indexed is the wrong primitive.** CANNA's official schedules are **phase-indexed with variable-length phases** ("Vegetative phase II — up to growth stagnation", "Cultivation period in weeks: 2–4"). A rigid `week[1..12]` model cannot represent CANNA correctly. GH uses *both* absolute week (W1–W13) and phase-relative index (Bloom — Week 3 = W7 = P3). House & Garden stores **seven different dose arrays**, one per flower length 6…12 weeks — the schedule is *reshaped*, not truncated, when the run is shorter.

3. **Three brands ship their charts as machine-readable data already**, on their own public sites, no scraping tricks required:
   - **Mills** — `millsnutrients.com/wp-content/themes/mills/dist/scripts/main_bbbe0412.js` exports `{product: {light|medium|heavy: {weekCount: [dose…]}}}` plus a pseudo-product `EC`. PPM500/PPM700 are computed client-side as `EC×500` / `EC×700`.
   - **House & Garden** — `house_garden_nutrient_calculator_grocery.js` holds plain JS arrays (`hydroGroupNormalFlowerDoseArray` etc.), doses in ml/US-gal.
   - **Remo** — the calculator page is a static HTML table where every cell carries both `data-gallons` and `data-litres` (dual-unit at source).
   The rest are PDFs, and PDF quality varies from "text layer, extractable with a coordinate-aware parser" (CANNA, BioBizz, Athena, Mills EU) to **"pure raster image, needs OCR"** (Dutchpro's soil chart is a 3.4 MB image-only PDF).

4. **Copyright: the numbers are almost certainly free; the chart is almost certainly not; and in the EU there is a third right that bites.** Under *Feist* (US) raw facts are uncopyrightable and only original *selection/coordination/arrangement* is protected. But Terp Control is EU-based, and the **EU sui generis database right (Directive 96/9/EC)** protects the *contents* of a database on proof of substantial investment alone — no originality needed — for 15 years, against extraction/re-utilisation of a substantial part. Systematically ingesting 20 brands' complete charts is the textbook "substantial part". This is the real exposure, and it is bigger than the copyright question everyone asks about.

5. **The market has already split into two risk postures, and both are visible in live products.** GrowBro (Google Play, `com.pascalotti.growtracker`) advertises verbatim: *"Built-in feeding schedules for popular brands (Hesi, BioBizz, Advanced Nutrients)"* — reproduce-and-name. FeedSchedules.com states the opposite policy verbatim: *"We link directly to each brand's official source… **We don't reproduce the charts themselves.**"* Grow with Jane takes a third route: users add their own nutrient brands and mixes. No licensing programme exists for plant-nutrient feed data anywhere I could find.

6. **The domain facts growers get wrong are exactly the ones a "schedule follow" UI can fix**: the 500-vs-700 PPM scale (same solution reads 900 or 1260), and — the big one — **CANNA's published EC is "EC+", an EC to be *added* to your source water**, not a final target. That is stated in the official PDF and ignored by most third-party transcriptions.

---

## 2. Brand-by-brand

### 2.1 CANNA [VERIFIED-PRIMARY]

Extracted from the official `canna.ca` COCO grow schedule PDF.

- **Lines / media:** TERRA (soil), COCO (coco), AQUA (recirculating hydro), HYDRO in **Soft** and **Hard** water variants, COGr (coco slab), BIOCANNA in **Indoor** and **Outdoor** variants. Eight downloadable schedules at `https://other.canna.com/downloads/71` (`/node/2658` Terra, `/node/2660` Coco, `/node/2659` Aqua, `/node/2661` Hydro Hard, `/node/2904` Hydro Soft, `/node/2775` COGr, `/node/2905` BIOCANNA Indoor, `/node/2906` BIOCANNA Outdoor).
- **Structure — this is the important part.** Columns are **7 named growth phases, not weeks**:
  1. Start / rooting (3–5 days) — "Aqua substrate wet"
  2. Vegetative phase I — plants develop in volume
  3. Vegetative phase II — up to growth stagnation after fructification / appearance of flower formation
  4. Generative Period I — flowers develop in *length*; height growth achieved
  5. Generative period II — development of *volume (breadth)*
  6. Generative Period III — development of *mass (weight)*
  7. Generative Period IV — ripening
  Rows: `Cultivation period in weeks` (a **range** per phase), `Light / Day in hours` (18, 18, 12, 12, 12, 12), then one row per product in `ml/10 litres`, then `EC + in mS/cm`.
- **Verbatim dose rows (COCO):** COCO A and COCO B each `10–12, 15–25, 20–30, 25–35, 30–40, 30–40, 20–30`; RHIZOTONIC XP `20, 20, 5, 5, 5, –, –`; CANNAZYM `25` throughout, `50` at the end; CANNABOOST `–, 20, 20–40, 20–40, 20–40, 20–40`; PK 13/14 `15` in one phase only. `EC+`: `0.7–1.1, 0.9–1.3, 1.1–1.5, 1.4–1.8, 1.6–2.0, 1.0–1.4, 0.0`.
- **Footnotes that change the semantics:**
  - *"EC+ value is based in mS/cm when EC water = 0.0 at 25 °C, pH 6.0. **Add the EC of the tap water that is used to the recommended EC.**"* → **The chart EC is a delta, not a target.**
  - *"The EC total in the example is with tap water with an EC of 0.4."*
  - *"Recommended pH is between 5.5 and 6.2. Adding pH- can increase EC."*
  - *"Double CANNAZYM dosage to 50 ml/10 litres, if substrate is reused."*
  - *"20 ml/10 litres standard. Increase to a maximum of 40 ml/10 litres"* (CANNABOOST)
  - *"The guidelines in the table aren't an iron law, but can help novice growers… The optimum fertilization strategy is further determined by factors such as: temperature, humidity, plant species, root volume, moisture percentage in substrate, water dosage strategy, etc."*
- **Official calculator:** yes — the **CANNA Grow Guide** (`canna-uk.com/growguide`, `canna.ca/growguide`, `cannagardening.com/growguide`). Inputs: product line; flowering time in weeks; tank size (L or gal); Vegetative Phase I duration 0–20 days; **water quality EC** (soft ≤0.2, normal ~0.4, hard ≥0.6, R.O.); schedule type **light / normal / heavy**. Output: a personalised schedule. The PDF itself points at it: *"Make your personal feeding grow schedule at www.canna.ca"*. No public API or JSON endpoint found. [VERIFIED-PRIMARY]
- **Terra numbers** (from hyjo.co.uk, ml/10 L): veg wk1–2 Terra Vega 30–50, Rhizotonic 20, Cannazym 25, EC 1.1–1.5; veg wk3–4 Terra Vega 35–55 + Boost 20, EC 1.3–1.7, pH 6.2; flower wk1–6 Terra Flores 40–70, Rhizotonic 5, Cannazym 25, Boost 20–40, PK 13/14 15 (wk3–4), EC 1.4–2.3, pH 6.2; wk7–8 taper to EC 0.4; then Canna Flush 20 ml/10 L for a week, then water. [VERIFIED-SECONDARY]
- **⚠ Transcription divergence:** veridiangrow.com publishes a "CANNA Terra" table with Terra Vega at 10–30 ml/10 L in veg. hyjo.co.uk and the official chart put it at 30–55. **These third-party tables are not reliable.** Do not seed a product database from them.
- **Legal posture:** CANNA's disclaimer (`other.canna.com/disclaimer`, Article 3) is explicit: rights in "text, streaming videos, images, design, **data files**, photographs… formats, software, brands" are held by CANNA; *"It is not allowed to put the website, or any part thereof, at the disposal of third parties in any way whatsoever and/or to duplicate it other than by downloading and viewing on a single computer and/or printing a hard copy."* [VERIFIED-PRIMARY]

### 2.2 Advanced Nutrients [VERIFIED-SECONDARY — site blocks bots]

- **Lines:** pH Perfect Sensi Grow/Bloom A&B (soil and coco variants), pH Perfect Connoisseur Grow/Bloom A&B (soil/coco), pH Perfect Grow–Micro–Bloom (3-part), Jungle Juice Grow/Micro/Bloom (value 3-part), Sensi Professional, OG Organics (Iguana base), Cultivator Series (incl. an **LED-specific** chart).
- **Structure:** week-based. Veg 4 weeks, bloom 8 weeks; extended by *repeating* week 4 of the relevant phase. Recipe tiers are marketed as **Top-Shelf** vs **Master** (older material also uses Classic / Hobbyist). Charts published in **Global (ml/L)** and **USA (ml/gallon)** editions.
- **Additive layering is the whole product**: Voodoo Juice / Piranha / Tarantula (root, early), B-52, Bud Ignitor (first bloom weeks), Big Bud (mid bloom, **stop after bloom week 5**), Bud Candy (all bloom), Overdrive (late bloom), Flawless Finish (flush). Most additives run at 2 ml/L; max additive ratio stated as 2 ml/L. Base pH Perfect Sensi ~4 ml/L each part at peak.
- **Official app/calculator:** **BudLabs** (iOS `id1174388506`, Android `com.advancednutrients.budlabs`) + a web nutrient calculator at `/nutrient-calculator/`. Inputs: grow or bloom phase, base nutrient line, grower experience level, reservoir size (gal **and** L). Outputs a week-distributed schedule; lets you add/remove products manually; multiple virtual crops; task scheduler with watering / res-change / pH reminders. Advanced Nutrients also holds a **"CANNABIS CALCULATOR" trademark** (filed 2019-08-21) for downloadable calculating software. [VERIFIED-SECONDARY]
- **Legal posture:** Terms of Use assert that using the site confers no ownership in IP and waives no rights; **deep linking to internal pages is "expressly prohibited without prior written consent."** (That last clause is of doubtful enforceability in the EU post-*Svensson*, but it signals posture.) [VERIFIED-SECONDARY]
- **Machine-readable?** No public JSON found. Their site returns HTTP 202 + empty body to non-browser user agents, so PDFs were not retrievable in this session. **UNVERIFIED** whether BudLabs has an unauthenticated backend API — worth a 30-minute check with a proxy before deciding anything.

### 2.3 BioBizz [VERIFIED-PRIMARY]

Extracted from `biobizz.com/wp-content/uploads/2020/03/Nutrient-Schedule-EN-2020.pdf` with the coordinate-aware parser.

- **Two schedules on one sheet**, each `WK 1 … WK 12`, selected by substrate: one for **Light·Mix / Coco / low-nutrient soil**, one for **All·Mix** (heavily pre-fertilised — first weeks need nothing).
- **Units:** `ml/L water` throughout. Doses are small integers (1–5).
- **No EC row at all.** This is an organic line; the chart gives **pH only**: *"A pH-value between 6.2 and 6.5 is ideal"*, *"Controlled pH-value between 6.2 and 6.3"*.
- **Phase bands under the week columns:** `VEGETATIVE PHASE | FLOWERING PHASE | FLUSH WITH WATER | HARVEST`.
- **Verbatim guidance rows on the sheet** (these are as important as the numbers, and are the "coaching" a follow-UI would surface):
  - *"Before you start make a warm bed by using Biobizz substrates"*
  - *"Water 2-3 times a week, no need to water till run-off"*
  - *"You can mix several fertilizers in the same feeding water"*
  - *"Start using fertilizers when your baby plant is 10-15 cm or has 2-4 leaves"*
  - *"It is always better to be modest than to add more. A plant will not die from too little nutrients, but it won't survive an overdose"*
  - *"We recommend to use our Calmag supplement every watering when growing with RO or very soft water, or once a week in case of noticing Ca/Mg deficiency signs"*
- **Products:** Root·Juice (4 ml/L, weeks 1–2 only), Bio·Grow, Bio·Bloom, Top·Max, Alg·A·Mic, Bio·Heaven, Acti·Vera, Fish·Mix, Bio·Up/Bio·Down, CalMag. Typical ramps: `1,2,2,3,3,4,4,4` and `2,2,2,2,3,4,4,5,5,5`.
- **Footnote markers `*`, `**`, `***`** on rows encode application frequency/conditions — a data model that ignores them loses meaning.
- **No official calculator found.** [UNVERIFIED whether BioBizz has since launched one.]

### 2.4 Athena [VERIFIED-PRIMARY]

Extracted from the official metric PDFs (mirrored at easy-grow.co.uk; identical content is on `support.athenaag.com`).

**Blended Line — "BLENDED PROGRAM METRIC FEED PROGRAM, all measurements are ml per 10 L":**

| Row | Values |
| --- | --- |
| Columns | Mixing Order · Clone Pre-Soak · Clone Feed · Veg W1–W4 · Flower W1–W9 · FLUSH |
| Balance | "Use as pH up" (recommended for batch tank mixing and Dosatron; **do not use with NetaFlex**) |
| Cleanse | 3, 3, then 5–13 across, 13–26, 26 |
| CaMg | 8–13 throughout |
| Grow A / Grow B | 29 / 29 (veg W1–W4) |
| Bloom A / Bloom B | 13, 26, 32, 32, 32, 32, 26, 24, 13, 11 |
| PK | 11, 11, 16, 24, 26, 32, 26 |
| **EC** | 1.5, 2.0, 2.1, 2.1, 2.1, 2.1, 2.3, 2.3, 2.5, 2.6, 2.4, 2.3, 1.7, 1.5, **<0.1** |
| **PPM 500** | 750, 1000, 1050×4, 1150, 1150, 1250, 1300, 1200, 1150, 850, 750, **<50** |
| **PPM 700** | 1050, 1400, 1470×4, 1610, 1610, 1750, 1820, 1680, 1610, 1190, 1050, **<70** |
| **pH** | 5.6 (clone) · **5.5–5.8 (Coco/Rockwool) / 5.9–6.2 (Peat-based mediums)** in veg · 5.8–6.2 / 6.0–6.4 in flower · 6.0–6.4 (All) in flush |

Plus a separate **SPRAY PROGRAM (IPM)** table: Preventative 2×/week 158–238 ml/10 L; Pressure 3×/week 238–317; Stack 2×/week 18. Note on the sheet: *"Adjust feed chart according to weeks needed to complete a run. Strain dependent."*

**Pro Line — "Pro Line is in grams per 10 L, Cleanse is ml per 10 L":** Pro Core 11.4 g/10 L flat (4.0 at finish); Pro Grow 19.0 (veg W1–4); Pro Bloom 19.0 (flower W1–8), 6.6 at finish; Cleanse 3.0 then 5.0–13.0, 26.0. **EC 3.0 flat** for the whole run, then 1.5, then <0.1; PPM500 1500 flat / 750 / <50; PPM700 2100 flat / 1050 / <70. Same pH banding as Blended. Coco Prep Presoak at pH 5.5–5.8.

**Structural take:** Athena is the *cleanest* schema in the industry — fixed 13-week grid, explicit EC **and both PPM scales** on the sheet, explicit **per-medium pH split inside a single column**, mixed units (g vs ml) within one chart, and a parallel IPM spray program. It is also the strongest counter-example to "a dose is a scalar": `5–13`, `8–13`, `13–26` are ranges. **Legal posture:** Athena's terms claim IP in "information, data, software… and **compilations**", "all rights not granted… are expressly reserved". [VERIFIED-SECONDARY for terms]

### 2.5 Mills Nutrients [VERIFIED-PRIMARY — two incompatible official charts]

**(a) EU A5 flyer** `mills-nutrients.com/.../MILLS_HC_A5-SCHEMA-FLYER_EN-182.pdf`, extracted:

- **Two full charts on the sheet**, chosen by water source: **"BASED ON TAP WATER WITH AN EC OF 0.7"** and **"BASED ON OSMOSIS WATER WITH AN EC OF 0.0"**.
- **"VALUES PER 1 LITER OF WATER."** Marked **"HIGH CONCENTRATED"** and **"Caution:"**.
- Growth phase weeks 1–2, Bloom phase weeks 1–9. Products: START-R, BASIS A, VITALIZE, BASIS B, C4, ULTIMATE PK. Header note: *"Add Vitalize to every feed."*
- Tap-water chart (ml/L): Growth W1 `Start-R 0.4, Basis A 0.2, Vitalize 0.2, Basis B 0.2`; W2 `0.7 / 0.4 / 0.4 / 0.4` + `C4 0.2`, `PK 0.4`. Bloom W1 `Basis A 0.9, Vitalize 0.2, Basis B 0.9`; W3 `1.4 / 0.2 / 1.4` + `C4 0.4`, `PK 0.2`; W5–6 `1.4 / 0.1 / 1.4` + `C4 0.6`, `PK 1`; W7 `1.4 / 1.4 / 1.5`; W9 `1.4 / 0.9 / 1.4 / 0.9 / 1.5 / 1`.
- Osmosis chart is a **different, higher set**: W1 `0.5 / 0.6 / 0.3 / 0.6`; bloom peaks at `2 ml`.
- Shared **EC** ladder: `1.8–2.0, 2.4–2.6, 2.5–2.7, 2.6–2.8, 2.6–2.8, 2.4–2.6, 2.3–2.5, 2.1–2.3, 1.9–2.1, 1.7–1.9, 1.3–1.5`.
- Multi-language PDF (text tagged `nl-NL`, `fr-FR`). Includes a numbered mixing procedure starting *"1 - Fill the reservoir with water."* Points to `/NUTRIENT-CALCULATOR`.

**(b) US web calculator** `millsnutrients.com/nutrient-calculator/` — the data lives in `main_bbbe0412.js` as a webpack module exporting **four tables**: `TC` and `sT` (chart type "CropSteering", growth and bloom) and `W4`/`H9` (the other chart type). Shape:

```js
TC = {
  "Basis A": {
    light:  { 4:[12,14,16,18], 5:[12,14,16,18,18], 6:[…], 7:[…], 8:[…] },
    medium: { 4:[16,18,20,22], … },
    heavy:  { 4:[22,24,26,28], … }
  },
  "Vitalize": {…}, "Start-R": {…}, "C-4": {…}, "Ultimate PK": {…},
  EC: { light:{4:[1.4,1.6,1.8,2],…}, medium:{4:[1.8,2,2.2,2.4],…}, heavy:{4:[2.4,2.6,2.8,3],…} }
}
```

Growth phase lengths 4–8 weeks; bloom phase lengths 8–11 weeks. **Doses are ml per US gallon** — the code does `n = (units=="liters") ? 0.264172*n : n` on the reservoir before multiplying. Dose cells may be **strings containing an en-dash range** (`"12–18"`), parsed into `[min,max]` and accumulated into a min/max total. `PPM 500` and `PPM 700` are *derived*: `round(EC*500*100)/100` and `round(EC*700*100)/100`. The calculator emits a **shareable deep link**: `?t=<chartType>fl=<level>&gpl=<growWeeks>&bpl=<bloomWeeks>&rs=<size>&ru=<units>#table`.

**This is the single best schema reference in the industry, and it is a public static file.**

### 2.6 House & Garden [VERIFIED-PRIMARY]

`house-garden.us/wp-content/themes/gcc-block-theme-v3/assets/js/house_garden_nutrient_calculator_grocery.js`.

- **UI inputs:** Veg length 1–8 weeks · Flower length 6–12 weeks · Base nutrient {AQUA FLAKES, COCOS, **HYDRO (commented out in the HTML)**, SOIL, BIO 1-COMPONENT} · Feeding level {NORMAL, AGGRESSIVE} · Bloom enhancer {SHOOTING POWDER, TOP SHOOTER} · Feed water per week (gal/L) · Foliar volume (gal/L).
- **Data shape:** base doses are arrays keyed by flower length — `hydroGroupNormalFlowerDoseArray` is an **array of 7 arrays** for 6,7,8,9,10,11,12-week flowers, e.g. the 8-week entry is `[6.5,7.5,8.5,9.5,9,7.5,7.5,7.5]` and the 12-week entry is `[6.5,7.5,7.5,8.5,9.5,10.5,10.5,10,7.5,7.5,7.5,7.5]`. **The peak moves; it is not a truncation.** Dirt group (Cocos/Soil) is a separate, higher set: normal veg `[2.5,8,9,9.5,10.5,11,12,12.5,13.5]`, aggressive `[2.5,9,10.5,12.5,14,16,18,18.5,19]`.
- **Additives are flat scalars for the whole phase**, not per week: Roots Excelurator 1.0, Amino Treatment 2.5, Multi Zen 3.8, Algen Extract 1.0, Drip Clean 0.4, PH Osmosis 2.0, Magic Green 10.0, Bud XL 3.8, Top Booster 4.0, Shooting Powder 1, Top Shooter 5.7. **All ml per US gallon.**
- **Output includes a "grocery list"** — it converts total ml into a count of real bottle sizes to buy. That is a genuinely good UX idea worth stealing.
- **pH targets** (from H&G material): Hydro 5.5–6.0 · Aqua Flakes/Cocos 5.6–6.2 · Soil 5.8–6.5. Mix order: A, then B, then additives. [VERIFIED-SECONDARY]

### 2.7 General Hydroponics [VERIFIED-PRIMARY]

`generalhydroponics.com/pages/flora-series-3-part-feed-program` — server-rendered from Shopify metafields (`data-schedule-handle`, `data-schedule-index`), fully extractable from HTML.

- **Feed Charts Hub** (`/pages/feedcharts/feed-charts-hub`) distinguishes **"feedcharts" (printable PDFs)** from **"feed programs" (interactive web)**. Lines: Flora Series 3-Part / 6-Part / 10-Part; FloraPro Powder (Standard and High-EC stock solution) and FloraPro Liquids (commercial); FloraNova 1-/4-/8-Part with Light / Medium / Aggressive intensities; Maxi Series (MaxiGro/MaxiBloom, 1-part outdoor / 2-part indoor); standalone Purpinator and Terpinator charts.
- **Flora Series 3-Part, "General Use" tab — the full 13-week grid, verbatim** (ml/gal, PPM on the 500 scale, N in ppm):

| Abs | Phase-rel | Stage | Photoperiod | N | EC | PPM500 | Micro | Gro | Bloom |
|---|---|---|---|---|---|---|---|---|---|
| W1 | Grow W1 (P1) | Seedling/Clone | 18H | 45 | 0.4–0.5 | 200–300 | 1.8 | 1.8 | 1.8 |
| W2 | Grow W2 (P2) | Early Growth | 18H | 95 | 0.9–1.1 | 400–550 | 3.6 | 3.4 | 2.6 |
| W3 | Grow W3 (P3) | Early Growth | 18H | 125 | 1.2–1.4 | 550–750 | 4.9 | 4.6 | 3.4 |
| W4 | Grow W4 (P4) | Late Growth | 18H | 150 | 1.4–1.7 | 700–900 | 6.0 | 5.6 | 4.2 |
| W5 | Bloom W1 (P1) | Early Bloom | 12H | 180 | 2.0–2.4 | 1000–1200 | 7.6 | 6.6 | 8.5 |
| W6 | Bloom W2 (P2) | Early Bloom | 12H | 180 | 2.0–2.4 | 1000–1200 | 7.6 | 6.6 | 8.5 |
| W7–W9 | Bloom W3–5 (P3–5) | Mid Bloom | 12H | 115 | 1.4–1.7 | 700–850 | 4.6 | 4.6 | 6.6 |
| W10–W11 | Bloom W6–7 (P6–7) | Late Bloom | 12H | 80 | 0.9–1.1 | 450–600 | 3.3 | 3.3 | 4.0 |
| W12 | Bloom W8 (P8) | Ripen | 12H | 60 | 0.6–0.8 | 300–400 | 2.0 | 2.0 | 3.2 |
| W13 | Bloom W9 (P9) | **Flush** | 12H | — | — | — | — | — | **Flush only (water)** |

- **Three schedule tabs, and they are *irrigation strategies*, not feed strengths:** "High Irrigation / Fast Dryback", "General Use", "Low Irrigation / Heavy Feeding". This is crop-steering-aware and a different axis from Mills' light/medium/heavy.
- Instruction on the page: *"Always add nutrients one at a time, mix thoroughly between products, and check pH/EC after mixing."* Mix order is **FloraMicro → FloraGro → FloraBloom**.
- **Lucas Formula** (community, not GH): drop FloraGro entirely, run FloraMicro:FloraBloom at 1:2. `0-5-10` (ml/gal Gro-Micro-Bloom) for low light / veg 18-6, `0-8-16` for 400 W+ / flower 12-12. Originally designed for RO water, where it self-buffers to a workable pH. Community targets ~1100–1300 ppm, pH 5.7–6.2. Rationale: FloraMicro already carries enough N. **This is a folk schedule with no manufacturer owner — which makes it uniquely safe to ship.** [VERIFIED-SECONDARY]

### 2.8 Remo Nutrients [VERIFIED-PRIMARY]

`remonutrients.com/calculator/` — HTML table, no JS data needed.

- **Inputs:** Grow Medium · Units · **Batches Per Week** · Vegetation Weeks · Flower Cycle Weeks · **Flush Weeks**.
- **Every cell carries both units**: `<td class="week" data-gallons="8" data-litres="2.1" data-base="ressize" data-title="Week4">`. Some cells carry `data-flush`.
- Veg (Micro, Grow, VeloKelp, MagNifiCal): `5,6,7,8,8,8,8,8` ml/gal = `1.3,1.5,1.8,2.1,…` ml/L.
- Bloom (Micro, Bloom, VeloKelp, Nature's Candy, AstroFlower): `8,8,8,8,10,10,10` ml/gal = `2.1…2.7` ml/L. **MagNifiCal is the odd row**: `8,8,8,8,8,0,0,water` — it *stops*, then the final column is the literal string `"water"`.
- **"Batches Per Week" is the right primitive** for consumption maths, and their in-app explanation is worth copying verbatim: *"If you use the whole thing every time you feed and you feed 4 times per week, it's 4 batches per week. If you mix it on Sunday and then feed it throughout the week… that would be 1 batch per week."*

### 2.9 Plagron [VERIFIED-PRIMARY for the tool, SECONDARY for numbers]

- **Lines:** 100% Terra (Terra Grow / Terra Bloom), 100% Coco (Coco A&B), 100% Hydro (Hydro A&B + Hydro Roots), 100% Natural/Alga (Alga Grow / Alga Bloom), plus additives Power Roots, Pure Zym, Sugar Royal, Green Sensation, Power Buds, Vita Race, Pure Enzym.
- **Units:** ml per 10 L. Hydro weeks 1–2: Hydro A&B 14 ml/10 L, Hydro Roots 10 ml/10 L, pH 5.5–6.5.
- **Official calculator:** `plagron.com/en/tools/grow-schedule-calculator` → flow at `/grow-schedule-calculator-flow`. Server-side POST wizard (no client JSON). **The first question is "Which substrate do you plan to use?"** with 15 *named Plagron products*, not generic media: `batmix, cocos-brix, cocos-premium, cocos-slab, euro-pebbles, growmix, lightmix, plagron-allmix, plagron-cocos-perlite-7030, plagron-hydro-cocos-6040, premium-growbag, promix, royalmix, rockwool, substrate-none`. It emails a personal schedule **plus a shopping list**. Also localised (`/es/tools/calculadora-de-tabla-de-cultivo`, `/it/…`, `/nl/kweekschema-calculator`) and paired with a separate **Substrate Selector** tool.
- Structural lesson: **substrate is the primary key, and it is brand-specific.** "Coco" is not one thing to Plagron.

### 2.10 Hesi [VERIFIED-SECONDARY]

- **Three charts**: Soil, Coco, Hydro. Units **ml/10 L**. Products: TNT Complex (veg N), Bloom Complex / Hesi Coco / Hydro Grow & Hydro Bloom, Root Complex, SuperVit, Boost, PowerZym, Phosphorus Plus.
- **Soil:** wk1–2 TNT 15–25, Root Complex 20, SuperVit 1 drop/10 L 1–2×/wk. wk3–4 TNT 25–50, Root Complex 20 (until end of wk5). wk5 Bloom Complex 50, Boost 20, PowerZym, SuperVit. wk6–7 Bloom 50 + PowerZym + SuperVit (no Boost). wk8–10 Bloom 50, Boost 1×/wk, Phosphorus Plus, PowerZym, SuperVit. **wk11–12 flush with pure water, stop everything including SuperVit.**
- **Hydro** carries EC targets: wk1 1.4–1.6, wk2 1.6–1.8, wk3 1.8–2.0 mS/cm.
- **SuperVit is dosed in *drops*** ("1 drop/10 L", "1 drop/5 L") — a unit no other brand uses and one a naive `{value, unit}` model will mangle.
- Notable: Bloom Complex at 50 ml/10 L *"approximately with every second watering, recommended 1–2× a week"* — **dose is coupled to an irrigation frequency, not to a week.**
- Official PDFs are distributed via resellers (e.g. `growland.biz/mediafiles/pdf/Hesi/EN_COCO_Grow_schedule.pdf`, `EN_SOIL_Grow_schedule.pdf`); that host 403s automated clients.

### 2.11 Terra Aquatica (ex-GHE) [VERIFIED-SECONDARY]

- 2019 rebrand of the GHE Flora Series. **TriPart** Grow / Bloom / Micro = FloraGro / FloraBloom / FloraMicro. Also DualPart (Grow/Bloom, Coco, Hydro), TriPart in **hard-water and soft-water Micro** variants, Seipro/Pro Organic, plus additives (Mineral Magic, Diamond Nectar, Final Part, Bioponic mix).
- **Water-hardness rule is quantitative and explicit:** *"If your analysis shows a calcium content of greater than 70 ppm (mg/litre), use TriPart Micro or DualPart Grow (hard water) formulas"* — otherwise soft water / RO.
- **Chart split into an "elemental chart" and an "expert chart"** (basic vs professional).
- Stage-based ml/L: TriPart Grow — 1st roots 0.5, 1st true leaves 1, growing 1.8, preflowering 2, flowering 0.8. TriPart Bloom — 0.5, 1, 0.6, 1.5, 2.4.
- **No official online calculator found.** [UNVERIFIED]

### 2.12 Fox Farm [VERIFIED-SECONDARY]

- `foxfarm.com/feeding-schedules/` hosts **~16–21 distinct schedule PDFs**: Soil, Hydroponic, Happy Frog, Cultivation Nation 3-Part Soil, Cultivation Nation 3-Part Hydroponic — each republished in **English (Imperial), Spanish (Metric), Vietnamese (Metric), Hmong (Metric)**, plus a combined English & Spanish imperial+metric sheet.
- **Units are the problem: teaspoons and tablespoons per US gallon.** e.g. Soil wk2 "2 tsp Grow Big + 2 tbsp Big Bloom"; wk4 "3 tsp Grow Big + ¼ tsp Open Sesame"; wk9 "2 tsp Tiger Bloom + 1 tbsp Big Bloom + ¼ tsp Cha Ching". Fractional teaspoons (¼, ½) are common. Powders (Open Sesame, Beastie Bloom, Cha Ching) are dosed by volume, not mass.
- Structure is week-based (12-week soil chart), but the hydro chart is **event-based** ("4 days before 12/12", "Day 1 of 12/12", "Week 3 of 12/12") rather than calendar-week based.

### 2.13 Botanicare [VERIFIED-SECONDARY]

- Lines: Pure Blend Pro Grow/Bloom (soil and coco/hydro variants), CNS17 Grow/Bloom/Ripe (one-part, hydro and coco formulations), KIND Base A&B + KIND Grow/Bloom.
- **Stage-based, not week-based**: Clones/Seedlings · Vegetative · Transition · Early Bloom · Mid Bloom · Late Bloom · Pre-Harvest.
- Units **ml/gallon**, with a conversion legend printed on the chart: *"1 teaspoon = 5 ml, 1 tablespoon = 15 ml, 1 ounce = 30 ml."*
- Conditional rule on the sheet: *"When growing plants with reverse osmosis water or in coco media use a minimum of 5 ml of Cal-Mag Plus during the first 2 weeks."* Foliar guidance: 7 ml/gal PBP, Liquid Karma 10–15 ml/gal.

### 2.14 Emerald Harvest [VERIFIED-SECONDARY]

- Lines: **Cali Pro** (2-part: Grow A&B, Bloom A&B) and **Grow–Micro–Bloom** (3-part), plus Emerald Goddess, King Kola, Honey Chome, Root Wizard, Sturdy Stalk, Cal-Mag.
- Charts at `emeraldharvest.co/downloads/feed-charts/`; separate gal and metric PDFs (`EH-Feed-Chart-2-3-pt-ENG-gal.pdf`).
- On-sheet operating conditions: **ideal water temp 60–72 °F (16–22 °C)**, **pH after mixing 5.8–6.3**, "suitable for all growing media in recirculating or drain-to-waste".

### 2.15 Aptus Plant Tech [VERIFIED-SECONDARY]

- Positioned as an *additive* line layered on any base: All-In-One Liquid/Pellets, Regulator, Startbooster, Topbooster, Bloombastic-style finishers, Enzym+, Fasilitor, CaMg-Boost, Micromix soil/spray.
- **Dilution-ratio semantics** rather than a week grid: Regulator 1.5 ml/10 L; Startbooster 2.5 ml/10 L (pregrowth + first week of flower); Topbooster **2 ml/10 L (stated as 1:5000)** from flower week 2 to the last week, increasing to 4 ml/10 L.
- Their master document is the **APTUS MANUAL** (`aptus-holland.com/wp-content/uploads/2021/08/Manual_AH20_UK.pdf`), not a one-page chart. A combined all-products week chart could not be found. **UNVERIFIED whether one exists.**

### 2.16 Green House Feeding / Powder Feeding [VERIFIED-SECONDARY]

- **Powder, one-component, dosed in g/L** — a completely different unit family from every liquid line.
- Variants are keyed to **flowering length and plant type, not medium**: Short Flowering (fast indicas/autos), Long Flowering (~12 weeks), Hybrids, Mother Plant, plus BioGrow/BioBloom/BioEnhancer and a Cocos variant.
- Dosing is **EC-target-driven, not table-driven**: *"add 0.5 to 2 g/L … until the appropriate EC level is reached (usually between 1.5 to 1.8 mS/cm)"*. Beginner ramp: start 0.25 g/L 2–4 weeks after planting → up to 0.7 g/L in veg → ~1 g/L in flower. Short Flowering: do not exceed 1.5 g/L if used every watering.
- Event-based additive rules: BioBloom 3 g/L at the start of flowering, second application 1 g/L around week 5 for very long-flowering varieties. BioEnhancer 3–5 g per 2.5 US gal, once every two weeks in veg.
- Coco example: `0.65 g/L "Coco" + 1.0 g/L Calcium`.

### 2.17 Dutch Pro [VERIFIED-PRIMARY for the format problem]

- **Charts are cross-cut four ways**: medium (Soil / Hydro-Coco) × water (**Hard Water** vs **RO/Soft Water**) × the base line (Original vs Explode-era) × **"WITHOUT EXTRA CO₂" vs with CO₂** — the CO₂ split is printed in the PDF title (`FEED CHART Soil-Per 1 L water WITHOUT EXTRA CO2`).
- Units **per 1 L water**. Products: Original Grow A&B, Original Bloom A&B, Take Root, Multi Total, Explode, Keep It Clean.
- Explode ramp: wk3–4 0.5 ml/L, wk5–6 1 ml/L, wk7(–8) 1.5 ml/L. Original Grow Hydro/Coco A&B HW: 2.5–3.5 ml/L each part.
- **⚠ Machine-readability worst case:** `Dutchpro_Feedchart_Soil_Hardwater.pdf` is 3.4 MB and contains **no text layer at all** — it is an Adobe "Image Conversion Plug-in" raster. **OCR is the only option.** Dutchpro USA claims a nutrient calculator in their app. [UNVERIFIED]

### 2.18 Metrop [VERIFIED-SECONDARY]

- **Units: ml per 100 litres** — a third unit basis, and the only brand using it.
- **Two charts: "Soft Water & Reverse Osmosis" and "Hard Water"** (`metropnutrients.co.uk/wp-content/uploads/2023/06/Metrop-Feed-Charts.pdf`).
- Products: MR1 (veg + early bloom), MR2 (late bloom), Root+, AminoXtrem, Calgreen, Amino Root, Elements.
- Sequence: veg MR1 40 ml/100 L, Root+ 80, AminoXtrem 90, Calgreen 20 → flower wk1–2 MR1 50 → wk3 MR1 75, drop Root+ → wk4 switch to MR2 75 → wk5–6 MR2 100. Calgreen once weekly through flower.
- Extremely concentrated; the whole line is built around the assumption of a large recirculating tank.

### 2.19 BAC [VERIFIED-SECONDARY]

- Three distinct programmes: **Organic** (soil/coco), **1-component soil**, and **mineral coco/hydro**. Products: Organic Grow, Organic Bloom, Bloom Stimulator, Root Stimulator, Funky Fungi, Final Solution.
- Dosing frequently expressed as **"bottle treats N litres"** rather than ml/L: Final Solution 60 ml → 600 L; 120 ml → 1200 L; 300 ml → 3000 L; 1 L → 10 000 L (i.e. 1:10 000).
- Final Solution is a **last-week substrate cleanse** — a "flush product", equivalent to CANNA Flush / Athena Cleanse-at-26 / Flawless Finish.
- Full ml/L week tables are in the printed kit insert / site downloads. **UNVERIFIED** against a primary source in this session.

### 2.20 Brands worth adding that I found along the way

hyjo.co.uk indexes feed charts across Water / Soil / Coco / Organic for 18 brands, several of which are not on the brief and are common in the EU/UK: **Atami (B'Cuzz), Growth Technology / Ionic, Vitalink, Plant Magic, Hydrotops, Grotek, FloraMax, CX Horticulture, Bio Nova, BioTabs, Gold Label, Guanokalong, Ecothrive, RAW, Dragonfly Earth Medicine, COMPO**. Also seen: Jack's Nutrients (321 / Part A+B+Epsom), Front Row Ag, NPK Industries, Roots Organics, Future Harvest, Lotus, Cronk, GreenPlanet, Suite Leaf, Rx Green.

---

## 3. The structural taxonomy — what a data model actually has to represent

Boiled down from all of the above. This is the part that will kill a naive implementation.

**Axis 1 — Time index. Four incompatible schemes in the wild:**
| Scheme | Brands | Note |
|---|---|---|
| Absolute weeks 1..N | BioBizz (12), GH (13), Athena (13), Fox Farm soil (12) | easiest |
| Phase-relative weeks (Veg W1–4, Bloom W1–9) | Athena, Mills, House & Garden, Advanced Nutrients | needs a phase boundary |
| **Named phases with variable-length week ranges** | **CANNA** ("2–4 weeks"), Botanicare, Terra Aquatica | week index is *derived*, not stored |
| Event-triggered | Fox Farm hydro ("4 days before 12/12"), Green House ("around week 5 of flowering for long-flowering varieties"), Hesi ("every second watering") | needs a rules layer |

**Axis 2 — Run-length adaptation.** Three different manufacturer answers to "my flower is 10 weeks, not 8":
- **Repeat a week** — Advanced Nutrients ("extend by repeating week 4 of bloom").
- **Reshape the curve** — House & Garden stores a separate array per flower length 6–12; the peak position changes.
- **Just adjust it yourself** — Athena: *"Adjust feed chart according to weeks needed to complete a run. Strain dependent."*

**Axis 3 — Feed strength / strategy.** `light | medium | heavy` (Mills, CANNA, FloraNova); `normal | aggressive` (House & Garden); `High Irrigation-Fast Dryback | General Use | Low Irrigation-Heavy Feeding` (GH — an *irrigation* axis); `Top-Shelf | Master` (Advanced Nutrients); `elemental | expert` (Terra Aquatica).

**Axis 4 — Water source.** Not optional. Mills ships two entire charts (tap EC 0.7 / RO EC 0.0). Metrop ships two (hard / soft-RO). CANNA's Grow Guide takes an EC band (≤0.2 / ~0.4 / ≥0.6 / RO) and CANNA HYDRO ships as separate Soft and Hard products. Terra Aquatica switches product SKU at **70 ppm Ca**. Botanicare adds a conditional Cal-Mag rule for RO. BioBizz recommends CalMag every watering on RO.

**Axis 5 — Substrate.** And it is *brand-specific product names*, not generic media — Plagron's calculator lists 15 named Plagron substrates. BioBizz splits All·Mix vs Light·Mix. CANNA splits Terra / Coco / COGr / Aqua / Hydro.

**Axis 6 — Units.** All of these are real and all appear in charts on the brief:
`ml/L` · `ml/10 L` · `ml/100 L` · `ml/US gal` · `g/L` · `g/10 L` · `tsp/US gal` · `tbsp/US gal` · **`drops/10 L`** (Hesi SuperVit) · **dilution ratio `1:5000`** (Aptus) · **"bottle treats N litres"** (BAC).

**Axis 7 — Dose value type.** Not a scalar.
- Scalar: `29`
- **Range**: `5–13`, `8–13`, `30–40`, `12–18` (Athena, CANNA, Mills)
- Zero-that-means-stop: MagNifiCal `…8, 8, 0, 0`
- **Literal string**: Remo's `"water"`; GH's `"Flush only"`; Athena's Balance = `"Use as pH up"`
- Conditional/footnoted: BioBizz `*`/`**`/`***`; CANNA *"Double CANNAZYM to 50 if substrate is reused"*
- Frequency-qualified: `"1-2x a week"`, `"every second watering"`, `"once every two weeks"`

**Axis 8 — Targets attached to a step.** `EC` (as **absolute** or as **EC+ delta over source water** — CANNA), `PPM 500`, `PPM 700`, `pH` (often **split per medium inside one cell** — Athena's "5.5–5.8 Coco/Rockwool, 5.9–6.2 Peat"), `N ppm` (GH), photoperiod hours (CANNA, GH), water temperature (Emerald Harvest).

**Axis 9 — Non-dose rows that carry meaning.** Mixing order (Athena has an explicit "Mixing Order" column; GH says Micro→Gro→Bloom; H&G says A→B→additives; the community consensus is Silica → base A/B → Cal-Mag → other additives → **pH last**). Equipment caveats (Athena Balance: *"Do not use with NetaFlex"*). Parallel programmes (Athena's IPM spray table).

---

## 4. Machine-readability — what you can actually get, ranked

| Tier | Source | Brands | Effort |
|---|---|---|---|
| **A — structured, public, static** | Brand's own calculator JS/HTML | **Mills** (JS module, incl. EC and both PPM scales), **House & Garden** (JS arrays), **Remo** (HTML with `data-litres`/`data-gallons`), **General Hydroponics** (server-rendered HTML with EC/PPM/N/photoperiod per week) | hours |
| **B — PDF with a text layer** | Official PDFs | CANNA, BioBizz, Athena (Blended + Pro), Mills EU flyer, Emerald Harvest, Botanicare | needs `pdfgrid.py`-style **coordinate-aware** extraction — plain text extraction returns the cells in stream order and is useless |
| **C — server-side wizard, no client data** | Plagron flow, CANNA Grow Guide, Advanced Nutrients calculator | would require driving the form; CANNA/Plagron are POST wizards | days, and legally the most aggressive |
| **D — raster PDF** | **Dutch Pro** soil charts (3.4 MB, image only) | OCR + manual verification | manual |
| **E — no public data** | Aptus (manual, not a chart), BAC (kit insert), Hesi (reseller-hosted, 403s) | manual transcription from the printed sheet | manual |

**No plant-nutrient brand offers an API, data feed, or licensing programme.** I searched specifically for one and found none. The closest analogue in another industry is FatSecret's "Brand Tools", where food brands submit and manage their own product data into a third-party database — that model exists for food nutrition and does **not** exist for plant nutrition. That is a gap, and it is also an opportunity (see §9).

**Do not seed from third-party transcriptions.** Concrete proof: for CANNA Terra veg, hyjo.co.uk says Terra Vega 30–50 ml/10 L and veridiangrow.com says 10–30 ml/10 L for the same stage. One of them is wrong by a factor of ~3. A grower following the wrong one nutrient-burns or starves the crop.

---

## 5. Legal — the honest assessment

I am not a lawyer and this is not legal advice. It is a synthesis of what I could verify, with the uncertainty left in.

### 5.1 Copyright over the numbers (US framing)

*Feist Publications v. Rural Telephone Service*, 499 U.S. 340 (1991) is the controlling case for factual compilations. Its holdings, as they apply here:
- **Facts are never copyrightable**, no matter how much labour went into collecting them ("sweat of the brow" is rejected).
- A compilation is protectable **only** in its original **selection, coordination, and arrangement** — and that protection is **"thin"**.
- The underlying facts *"may be copied at will."*

Applied: *"CANNA Coco A at 30–40 ml/10 L in Generative Period II"* is a fact about a product. **Reproducing the numbers is very likely fine under US copyright.** Reproducing the *chart* — its phase names as coined by CANNA, its layout, its ordering, its prose footnotes, its icons and colours — is copying expression and is **not** fine.

The dividing line in practice: **re-express, don't reproduce.** Numbers + product names + your own stage taxonomy + your own layout ≈ safe. A pixel-alike or text-alike of the sheet ≈ infringing.

Nuance that cuts against you: some of these charts contain genuinely expressive text that is clearly copyrightable on its own — CANNA's *"Vegetative phase II — up to growth stagnation after fructification"*, BioBizz's *"A plant will not die from too little nutrients, but it won't survive an overdose."* **Never ship those strings.**

### 5.2 The EU sui generis database right — this is the real exposure

Terp Control is EU-based (`.cloud`, German operator), so **Directive 96/9/EC** applies and it is materially harsher than US copyright:

- Protects the **contents** of a database, not just the arrangement.
- **No originality requirement.** The trigger is proof of **substantial investment** (financial, material and/or human) in *obtaining*, *verifying*, or *presenting* the contents. Every one of these brands runs trials to produce these charts; verification investment is easy for them to evidence.
- Term: **15 years** from creation or first publication (and effectively renewable on substantial revision — charts get revised, e.g. BioBizz's is dated 2020, Mills' flyer is dated 2025-10).
- Restricted acts: **extraction and/or re-utilisation of the whole or a substantial part**. Also — repeated and systematic extraction of *insubstantial* parts that conflicts with normal exploitation is caught.
- Permitted: extraction/re-utilisation of **insubstantial** parts.

Applied honestly: **shipping one brand's complete chart is extraction of a substantial part of that brand's database.** Shipping twenty brands' complete charts is twenty counts of it. The *Feist* "facts are free" argument that works in the US **does not save you in the EU** — that is precisely the gap the sui generis right was created to fill.

I found **no litigated case about fertiliser feed charts specifically**. That is a genuine absence of precedent, not evidence of safety.

### 5.3 Contractual terms — verified, and they are restrictive

| Brand | Verbatim posture |
|---|---|
| **CANNA** | Disclaimer Art. 3: rights in "text… **data files**… formats, software, brands" held by CANNA; *"It is not allowed to put the website, or any part thereof, at the disposal of third parties in any way whatsoever and/or to duplicate it other than by downloading and viewing on a single computer and/or printing a hard copy."* **[VERIFIED-PRIMARY]** |
| **Athena** | All site content including "information, **data**, software… and **compilations**" are IP and copyrighted works of Athena Ag; "All rights not granted to you… are expressly reserved"; nothing on the site confers a licence. **[VERIFIED-SECONDARY]** |
| **Advanced Nutrients** | Use of the site grants no ownership and waives no rights; **"Deep linking to internal pages of this Site is expressly prohibited without prior written consent."** **[VERIFIED-SECONDARY]** |

Note the sting in the AN clause: it would forbid even the *link-only* model that FeedSchedules uses. (Deep-linking prohibitions are widely regarded as unenforceable in the EU after *Svensson* C-466/12 for freely-available pages, but you would be litigating that, not relying on it.)

### 5.4 Trademark — this part is genuinely manageable

Using "CANNA", "BioBizz", "Advanced Nutrients" as *names of the thing you are referring to* is **nominative fair use** (US) / **referential or informative use** (EU, **Art. 14(1)(c) EUTMR**, following CJEU *Gillette v LA-Laboratories*, C-228/03, 2005).

The test you must satisfy:
1. The product is **not readily identifiable** without using the mark. (True — you cannot describe a CANNA schedule without saying CANNA.)
2. You use **only as much of the mark as is reasonably necessary**. → **Word marks only. No logos, no brand colours, no bottle photography, no trade dress.** This is the rule most apps break.
3. You do **nothing to suggest sponsorship or endorsement**. → explicit disclaimer, neutral typography, no "official", no "partner", no co-branded look.
4. EU adds: the use must be **in accordance with honest practices in industrial or commercial matters**.

Direct precedent from an adjacent industry: restaurant-nutrition calculators run exactly this playbook, e.g. *"NOT affiliated with, endorsed by, or sponsored by Moe's Southwest Grill; brand names, trademarks, menu references, and logos belong to their respective owners and are used only for informational, editorial, and identification purposes"*, and *"…used solely to identify the menus described under nominative fair use, and no affiliation or endorsement is implied."* That is the disclaimer template to adapt.

**Separate risk: don't let the brand name creep into *your* branding.** Naming the feature "CANNA Mode" or putting brand names in the app title/keywords/store listing moves you from referential use toward trademark use.

### 5.5 What competitors actually do — three live, observable postures

| Product | Posture | Evidence |
|---|---|---|
| **GrowBro** (Google Play `com.pascalotti.growtracker`) | **Reproduce and name.** Store listing verbatim: *"Built-in feeding schedules for popular brands (Hesi, BioBizz, Advanced Nutrients)"* + *"Offline micro AI-powered recommendations for when to use which nutrients / additives"* + *"Custom additive library with 7 additives free, unlimited in Pro"*. It is monetised (Pro tier). **[VERIFIED-PRIMARY]** No visible licensing or disclaimer in the listing. It is shipping today; I found no evidence of enforcement against it. |
| **FeedSchedules.com** | **Index and link, never reproduce.** Verbatim FAQ: *"We link directly to each brand's official source — their own PDF, webpage, or feed chart tool. **We don't reproduce the charts themselves.** Always verify directly with the brand before use."* They normalise **metadata only**: medium & substrate, system type (DTW / recirculating / DWC-RDWC), EC & pH targets "where provided by the brand", feed strength variants, stage coverage, regional variants, and a **last-verified date** per entry. **[VERIFIED-PRIMARY]** |
| **Grow with Jane** | **User-generated.** No shipped brand schedules; the app's own marketing is *"adding your own nutrient brands is now easier than ever"*, and its nutrient guide tells users to *"read every product label and follow the measure guides and schedules"* and *"always follow the manufacturer's instructions."* Users build "nutrient mixes" and attach them to reminders. **[VERIFIED-SECONDARY]** |
| **GrowDiaries** | **Manufacturer-opted-in.** Hosts "official feeding schemes from nutrient producers" and has brands with **official accounts** on the platform (Gold Label, Green House Feeding, Bio Tabs, Living Soils are named). This is the closest thing to a licensing model that exists — it is relationship-based, not contractual-data-feed-based. Site is Cloudflare-protected; **[VERIFIED-SECONDARY]**, could not confirm terms. |
| **Nutrient brands' own apps** | BudLabs (Advanced Nutrients), House & Garden calculator, Mills calculator, Remo calculator, Plagron Grow Schedule Calculator, CANNA Grow Guide, Dutchpro app. Every serious brand already ships the calculator you would be competing with — **for their own line only.** The cross-brand comparison is the gap. |
| **Third-party calculators** | HydroCalc (`com.k4y.hydrocalc`) advertises working "with any nutrient brand" and being offline/no-account. Grower Calc, hydroponiccalculator.com, GreenPlanet, Lotus all run brand-name-referencing calculators. None found with a licence. |

**Bottom line on precedent: everyone in this niche either reproduces without a licence and has not (visibly) been sued, or deliberately does not reproduce.** The absence of enforcement is weak evidence of safety — nutrient companies have historically had bigger problems than app developers, and a German company is a more attractive and reachable defendant than an anonymous Play Store developer.

### 5.6 Risk tiers, concretely

| Approach | Copyright | EU DB right | Trademark | Data quality | Verdict |
|---|---|---|---|---|---|
| **A. Ship all 20 brands' full charts as built-in data** | Low-medium (facts) but medium-high if layout/prose copied | **HIGH** — systematic extraction of substantial parts, 20× | Manageable with word-marks-only + disclaimer | High risk from transcription error | **Highest reward, highest risk.** What GrowBro does. |
| **B. Ship a small number of charts, sourced only from the brand's own machine-readable calculator, with per-brand opt-out** | Low-medium | Medium-high, but far smaller "substantial part" surface and a fast takedown path | Manageable | Good (primary sources) | **Recommended.** |
| **C. Index metadata + deep-link to the brand's PDF; the app models the *user's* schedule, not the brand's** | Very low | Low (metadata is arguably insubstantial; links are not extraction) | Very low | N/A | **Safest, and materially less useful.** What FeedSchedules does. AN's deep-link clause is the only friction. |
| **D. User-generated + community sharing: users enter their own schedules, optionally publish templates** | Zero for you; you become a host (DSA/Art. 6 hosting safe harbour with notice-and-action) | Zero for you | Zero | Variable, but crowd-corrected | **Safe, and it is a real product.** What Grow with Jane does. |
| **E. Ship only ownerless/generic schedules** — Lucas Formula, a generic soil/coco/hydro EC-ladder, Jack's 321 | Zero | Zero | Zero | Good | **Free win. Do this regardless.** |
| **F. Seek written permission per brand** | Zero | Zero | Zero (you'd get logo rights too) | Best | Slow, but a **real differentiator** — nobody has it. |

**My honest recommendation: D + E as the foundation, B layered on top, F pursued in parallel.**

Concretely:
1. Build the **schedule engine** so it is brand-agnostic and user-editable. That is the durable asset and it carries zero IP risk.
2. Seed it with **E** (Lucas, generic EC ladders per medium) so it is useful on day one with nothing borrowed.
3. Add brand schedules under **B**, in a **separate, versioned, hot-swappable content collection** — not baked into the app bundle. Source each one from the brand's own calculator or PDF, record `source_url` + `retrieved_at` + `chart_version` per entry, and be able to remove one brand in a single DB update. Ship a visible per-schedule "Source: <brand>'s official chart, retrieved <date>" with a link.
4. Publish a **takedown address and a documented notice-and-action policy** before you ship. A brand that can email you and get a removal in 48 hours sends an email; a brand that can't sends a lawyer.
5. Trademark hygiene: **word marks only, never logos or brand colours**, never in the app/product name, never "official"/"partner", plus a standing disclaimer: *"Brand and product names are trademarks of their respective owners. Terp Control is not affiliated with, endorsed by, or sponsored by any nutrient manufacturer. Schedules are reproduced for reference; always verify against the manufacturer's current official chart."*
6. **Liability disclaimer is separate from IP and equally necessary.** You are telling people to put chemicals on a crop. Adopt CANNA's own framing — their chart says the guidelines *"aren't an iron law"* and outcomes depend on temperature, humidity, species, root volume, substrate moisture and watering strategy. Restate that in your own words, prominently, and never present a computed dose as an instruction without an "always verify / start low" affordance.
7. **F is worth a week of effort.** Send a one-paragraph email to each brand: "we display your official schedule, attributed and linked, in a grow-controller app; here's a screenshot; may we?" Some will say yes enthusiastically — brand-locked schedules drive bottle sales, which is exactly why they all built calculators. GrowDiaries already has brands with official accounts, which proves brands will engage. A written yes from even three brands turns your biggest risk into your biggest moat.

**What I could not verify, stated plainly:**
- No cease-and-desist, DMCA notice, takedown, or lawsuit involving a feed chart and an app was found. Absence of evidence, not evidence of absence — I searched several phrasings.
- No brand licensing programme for feed data was found.
- I could not read GrowDiaries' or feedschedules.com's terms (Cloudflare), so their exact legal framing is **UNVERIFIED**.
- German-law specifics (UWG §4 Nr. 3 supplementary protection against imitation, §87a–87e UrhG implementing the DB right) were not researched in depth. **Get a German IP lawyer to review before shipping approach A or B.** This is the one place where a couple of hours of professional advice is clearly worth it.

---

## 6. Domain reference the feature must get right

### 6.1 EC / TDS / PPM

`EC` (mS/cm at 25 °C) is the physical measurement. "PPM" is EC multiplied by a **scale factor that depends on the meter brand**, and there are three in circulation:

| Scale | Factor | Reference salt | Typical meters |
|---|---|---|---|
| **500 ("Hanna scale")** | `ppm = EC × 500` | NaCl | Hanna, Eutech, Milwaukee — most North American meters |
| **640** | `ppm = EC × 640` | KCl | European agricultural / greenhouse meters |
| **700 ("Truncheon scale")** | `ppm = EC × 700` | KCl | Bluelab (incl. the Truncheon) |

At EC 1.4: **700 ppm₅₀₀ / 896 ppm₆₄₀ / 980 ppm₇₀₀**. At EC 1.8: a Bluelab Truncheon reads 1260 and a Hanna HI98318 reads 900 — *for the same liquid*. This is repeatedly cited as the number-one cause of accidental over/under-feeding.

Athena publishes **both** PPM500 and PPM700 rows on the sheet (verified above); Mills computes both client-side; GH labels its column "500". **Terp Control should store EC as canonical and render PPM with an explicit, user-selected scale label — never a bare "ppm" number.**

**The CANNA trap, again, because it is the most important single fact in this document:** CANNA publishes **`EC +`** — *"EC+ value is based in mS/cm when EC water = 0.0 … Add the EC of the tap water that is used to the recommended EC."* If your source water is EC 0.4 and the chart says 1.4–1.8, your meter should read **1.8–2.2**. A UI that shows CANNA's 1.4–1.8 as a target and alarms against measured 2.0 is actively wrong. The data model needs `ec_basis: "absolute" | "delta_over_source"`.

### 6.2 pH targets by medium

| Medium | Consensus range | Tight target |
|---|---|---|
| Soil | 6.0–7.0 | 6.2–6.8 |
| Coco | 5.5–6.3 | 5.8–6.2 (CANNA: 5.5–6.2; Athena: 5.5–5.8 veg / 5.8–6.2 flower) |
| Rockwool | 5.5–6.0 | pre-soak at 5.5; rockwool is alkaline from manufacture and will spike the root zone otherwise |
| Hydro / DWC | 5.5–6.1 | 5.8–6.0 |
| Peat-based | — | Athena: 5.9–6.2 veg / 6.0–6.4 flower |
| BioBizz organic soil | 6.2–6.5 | 6.2–6.3 |

Why it matters: pH gates *availability*, not presence. Fe and Mn availability falls sharply above ~7.0; P solubility falls below ~6.0. Lockout looks **visually identical** to a true deficiency — yellowing, brown spots, purple stems, interveinal chlorosis — which is why a schedule-follow UI that logs pH alongside the feed is worth more than the dose numbers themselves.

Coco has far lower buffering than amended soil and behaves closer to hydro; corrections show up within one or two irrigations. Athena is the only brand I found that **splits the pH target by medium inside a single chart column** — a good pattern to copy.

### 6.3 Flush — what it means, and the awkward science

"Flush" means three different things in these charts and the UI must not conflate them:
1. **Pre-harvest flush** — plain water (or a flush product) for the last 1–2 weeks, intended to strip stored salts. CANNA: `EC 0.0` final phase + a separate 1-week `Canna Flush 20 ml/10 L`. Athena: `EC < 0.1`, `PPM500 < 50`, `PPM700 < 70`, with `Cleanse` **raised** to 26 ml/10 L. GH: W13 "Flush only". Hesi: weeks 11–12, pure water, stop even SuperVit. BAC: Final Solution at 1:10 000 in the last week.
2. **Corrective flush** — running 3× pot volume of pH'd water through a medium to clear a salt build-up or fix nutrient burn. Event-driven, not scheduled.
3. **Routine leaching** in coco — irrigating to run-off every feed so `EC in ≈ EC out`. BioBizz explicitly says the *opposite* for its organic soil programme: *"Water 2-3 times a week, no need to water till run-off."*

**The honest science on (1):** the Rx Green Technologies trial (2019, first formal study; Colorado commercial cultivator, one variety, flush periods of **0 / 7 / 10 / 14 days**) found **no significant difference in terpenes, THC, yield or mineral content** across flush lengths — and taste panels **statistically preferred the un-flushed** samples. One trial, one cultivar, one facility — not settled science. But it means a product should present flush as *"your chosen brand's schedule calls for this"*, not as *"this is necessary"*. Every major brand still schedules it, so you ship it; you just don't editorialise in favour of it.

### 6.4 Runoff / substrate EC

- Rule of thumb: runoff EC slightly above input EC is normal; **more than ~20 % above input signals salt accumulation, over-fertilisation, insufficient irrigation volume, or poor drainage.**
- Coco DTW target is often stated as `EC in = EC out` — reset the root zone each irrigation.
- The professional distinction (Athena's own guidance): **input EC is what you deliver; substrate/pore-water EC is what the plant experiences and is the actual control point; runoff EC is a *reference* used to interpret and validate**, because runoff is biased by channelling and by the last-in solution.
- Crop steering: generative steering = larger shots (6 %+) and longer drybacks (2–3 % between irrigations), with the aim of driving substrate EC to its daily minimum during the light/temperature peak.

### 6.5 Reservoir management

- Top-offs restore **volume**, not **balance** — they don't remove accumulated salts, spent fractions, or microbial load.
- Full change cadence: DWC **7–14 days**; general home recirculating **14–21 days**; RDWC commonly **7–10 days**.
- Trigger rule worth encoding as an alert: **once you have topped off more than 20–30 % of reservoir volume, do a full change** — ratios have drifted too far for correction.

### 6.6 Mixing order (community + manufacturer consensus)

`Silica → base A → base B (or Micro → Gro → Bloom) → Cal-Mag → other additives → pH LAST`

- **Never combine concentrates without water in between** — immediate precipitation.
- Silica is strongly alkaline as a concentrate and reacts with phosphate and calcium; add first, circulate 10–15 min (up to ~30 min in large tanks).
- Cal-Mag + sulphate-bearing Part B / Epsom → **gypsum precipitation**; separate them by stirring time.
- CANNA states it as a hard rule: *"A into the water first, mix, then B — never mix the concentrates together."*
- **pH adjusters change EC** — CANNA: *"Adding pH- can increase EC."* Measure EC after pH adjustment, not before.

### 6.7 Autoflowers

Autos need roughly **25–50 % of photoperiod strength**, because they are smaller, faster, and have smaller root systems. Common pattern: plain water weeks 1–2, ~2 ml/L veg nutrients from week 3, 2–3 ml/L weeks 4–5, switch to bloom at 1.5 ml/L from weeks 6–7. **Essentially no manufacturer chart on the brief has an auto column** — every brand formulates for photoperiod. A `×0.25–0.5` global strength multiplier plus a "no 12/12 flip event" variant handles it, and it is genuinely useful because the manufacturers don't provide it.

### 6.8 What growers actually get wrong (ranked by how often it comes up)

1. **Over-feeding.** Cited as the single most common beginner error alongside over-watering. BioBizz's own sheet says it best.
2. **PPM scale confusion** (§6.1) — comparing a 500-scale number to a 700-scale chart.
3. **Treating chart EC as absolute when it is a delta** (CANNA).
4. **Following the wrong substrate column** — All·Mix guidance in Light·Mix causes deficiencies by weeks 4–5.
5. **Cal-Mag with RO water.** RO is ~0 ppm; label Cal-Mag rates assume that. Growers on hard tap water who add label-rate Cal-Mag overdose; growers on RO who skip it under-dose. Mg deficiency (interveinal yellowing, veins stay green) is routinely misdiagnosed as nutrient burn (tip burn), and the two need opposite responses.
6. **pH lockout misread as deficiency** — identical symptoms.
7. **Mixing order / precipitation** (§6.6), and adjusting pH before adding everything.
8. **Topping off forever instead of changing the reservoir.**
9. **Running the photoperiod chart on autos at full strength.**
10. **Not adapting run length** — following an 8-week bloom chart on a 10-week cultivar and finishing the schedule two weeks before the plant does.

---

## 7. What a "schedule follow" UX must handle

Derived from the manufacturer calculators (which are, collectively, a decent requirements document) plus the failure modes above.

**Setup (once per grow):**
- Brand + line + **substrate** (brand-specific where the brand is) + **water source** (tap EC, or hard/soft/RO) + **feed strength / strategy** + **veg length** + **flower length** + **flush length** (Remo has all six as explicit inputs).
- **Units**: ml/L vs ml/gal, EC vs PPM-500 vs PPM-700 — set once, honoured everywhere.
- Source water EC and pH as first-class stored values (needed for CANNA-style EC+, for Cal-Mag rules, and for RO chart selection).

**Per-feed (the actual daily job):**
- **Batch volume**, not "reservoir size". Remo's framing is right: `batches per week` × `batch volume` is what determines both the mix and the consumption. A hand-waterer with a 10 L can and a DWC grower with a 100 L res are the same maths with different numbers.
- **Output a mix card, in mixing order**, with a checkbox per product and the running total volume — because mixing order is a real failure mode and a checklist fixes it.
- **Partial feeds**: "I only need 6 L today" must rescale everything without the user doing arithmetic; and "I'm feeding water-only today" must be a first-class logged event that doesn't break the schedule position.
- **Plant-count / pot-size scaling**: growers think in "2 L per plant per watering × 6 plants". Offer that as an alternative way to arrive at batch volume, then convert.
- **Runoff logging**: input EC/pH and runoff EC/pH as a pair, with the ≥20 % rule surfaced as a warning, not a silent chart line.
- **Top-off tracker**: accumulate topped-off volume against reservoir volume, fire the "≥20–30 %, change it" prompt.

**Schedule mechanics:**
- **Where am I?** Terp Control already knows the photoperiod from the device's light output. **The 18/6 → 12/12 flip is the single most reliable automatic anchor for "flower week 1"** — CANNA and GH both put photoperiod hours directly in the chart. Auto-detecting the flip from `out_light` history and offering "looks like you flipped 12 days ago — start Bloom Week 2?" is a differentiator no bottle-brand calculator can do, because they have no device.
- **Run-length adaptation** must be explicit and must match what the brand says: repeat-a-week (AN), reshape (H&G), or "adjust yourself" (Athena). Don't silently truncate.
- **Skipping and drifting**: growers feed on Tue/Fri, not on schedule weeks. Model the schedule as "step N of M" advanced by *feed events*, with a soft calendar mapping, and let the user slip a week without penalty.
- **Deviation is normal.** Let a user override a dose for a step and keep the override (or not) for the rest of the phase — Athena's own note is *"adjust according to weeks needed… strain dependent"*.
- **Shopping list.** Both House & Garden and Plagron emit one, and H&G converts totals into actual bottle sizes. This is the highest-value non-obvious feature in the whole space and it is a natural affiliate hook.
- **Deep link / share.** Mills emits `?t=…&fl=…&gpl=…&bpl=…&rs=…&ru=…#table`. A shareable schedule URL is cheap and drives acquisition.

**Integration with what Terp Control already has:**
- Feed events → **diary entries** (the app already has a diary/log with `message-*` keys).
- EC/pH targets per step → **alarm thresholds that move with the schedule** rather than being set once. This is the strongest product argument for the feature existing in a *controller* rather than in a standalone app: nobody else can auto-retarget the alarm bands as the plant moves through bloom.
- Target-vs-actual EC/pH overlay on the existing **charts** page.
- Schedule step + "feed due" as a **reminder/notification**.
- Simulated devices (`./simulate-device.sh send --set ...`) make this testable end-to-end without hardware.

---

## 8. Concrete schema sketch

Distilled from Mills' JS module, Remo's dual-unit cells, GH's dual week index, and CANNA's variable-length phases. Every field below exists because a real chart needs it.

```jsonc
{
  "id": "canna-coco-2021",
  "brand": { "name": "CANNA", "trademark_notice": "CANNA is a trademark of its owner" },
  "line": "COCO",
  "source": { "url": "https://www.canna.ca/sites/canada/files/2021-09/downloads_grow-schedule_coco.pdf",
              "retrieved_at": "2026-08-24", "chart_version": "2021-09", "kind": "official_pdf" },
  "media": ["coco"],
  "systems": ["dtw", "hand_water"],
  "dose_unit": "ml_per_10L",          // ml_per_L | ml_per_10L | ml_per_100L | ml_per_usgal
                                       // | g_per_L | g_per_10L | tsp_per_usgal | drops_per_10L | ratio
  "ec_basis": "delta_over_source",    // absolute | delta_over_source   <-- CANNA
  "ppm_scale_published": null,        // 500 | 640 | 700 | null
  "variants": {                        // the cross-product of axes this chart covers
    "water": ["any"],                  // or ["tap_ec_0.7","ro"] for Mills
    "strength": ["normal"],            // or ["light","medium","heavy"]
    "strategy": null                   // or ["high_irrigation","general","low_irrigation"]  <-- GH
  },
  "steps": [
    {
      "index": 3,
      "kind": "phase",                        // phase | week | event
      "name": "Generative Period I",
      "description_own_words": "Flowers stretch; height growth finished.",   // NEVER copy brand prose
      "duration_weeks": { "min": 2, "max": 4 },   // <-- CANNA's variable-length phases
      "phase_relative": { "stage": "bloom", "n": 1 },
      "absolute_week_hint": 6,
      "photoperiod_hours": 12,
      "doses": [
        { "product": "COCO A", "min": 25, "max": 35 },
        { "product": "COCO B", "min": 25, "max": 35 },
        { "product": "RHIZOTONIC XP", "value": 5 },
        { "product": "CANNAZYM", "value": 25,
          "conditional": { "if": "substrate_reused", "value": 50 } },
        { "product": "CANNABOOST", "min": 20, "max": 40 },
        { "product": "PK 13/14", "value": 15, "applies_to_steps": [4] }
      ],
      "targets": {
        "ec": { "min": 1.4, "max": 1.8, "basis": "delta_over_source" },
        "ph": [ { "media": ["coco"], "min": 5.5, "max": 6.2 } ]
      },
      "flags": []                             // "flush" | "water_only" | "stop_all"
    }
  ],
  "mixing_order": ["silica", "COCO A", "COCO B", "additives", "ph_adjust"],
  "notes_own_words": [
    "Chart EC is added on top of your source water EC.",
    "Add A to the water and mix before adding B; never combine concentrates."
  ],
  "disclaimer_required": true
}
```

Non-obvious requirements this encodes, each traceable to a real chart:
- `min`/`max` on doses (Athena `5–13`, CANNA `30–40`, Mills `"12–18"`)
- `ec_basis` (CANNA EC+)
- `duration_weeks` range (CANNA phases)
- both `phase_relative` and `absolute_week_hint` (GH)
- `conditional` doses (CANNA Cannazym-on-reused-substrate, Botanicare Cal-Mag-on-RO)
- `applies_to_steps` (PK 13/14 in two phases only)
- per-medium `ph` array (Athena)
- `flags` for `water_only` / `flush` (Remo's literal `"water"`, GH's `"Flush only"`)
- `source` block with `retrieved_at` — required for the legal posture *and* for the "last verified" honesty that FeedSchedules makes a feature

---

## 9. Product angle worth flagging

Every serious nutrient brand has already built a calculator for **its own line** and none of them can see your grow. Terp Control has the two things they don't: **live EC/pH/environment telemetry** and **the photoperiod schedule the device itself is running**. That means Terp Control can do things no bottle-brand calculator can:

- infer the 12/12 flip from `out_light` history and place the grower on the correct bloom week automatically;
- move EC/pH alarm bands as the schedule advances instead of being set once at the start;
- show target-vs-measured EC per schedule step on the existing charts page;
- warn on runoff-vs-input EC divergence and on cumulative top-off volume.

That is the defensible feature. **The chart data is the commodity; the closed loop is the product.** Which is also the strategic argument for taking the low-risk data posture (§5.6 D+E+B) rather than the maximal one — the charts are not where the value is, and they are where all of the legal risk is.

---

## 10. Sources

Manufacturer primary:
[CANNA COCO grow schedule PDF](https://www.canna.ca/sites/canada/files/2021-09/downloads_grow-schedule_coco.pdf) ·
[CANNA Terra grow schedule PDF](https://www.canna.ca/sites/canada/files/2021-09/downloads_grow-schedule_terra.pdf) ·
[CANNA downloads index](https://other.canna.com/downloads/71) ·
[CANNA Grow Guide (UK)](https://www.canna-uk.com/growguide) ·
[CANNA disclaimer](https://other.canna.com/disclaimer) ·
[BioBizz Nutrient Schedule EN 2020](https://www.biobizz.com/wp-content/uploads/2020/03/Nutrient-Schedule-EN-2020.pdf) ·
[Athena Blended metric feed schedule](https://www.easy-grow.co.uk/wp-content/uploads/2022/08/Feed-Schedule-Athena-Blended.pdf) ·
[Athena Pro metric feed schedule](https://www.easy-grow.co.uk/wp-content/uploads/2022/08/Feed-Schedule-Athena-Pro.pdf) ·
[Athena feed schedules hub](https://support.athenaag.com/hc/en-us/sections/13724267250971-Feed-Schedules) ·
[Mills EU schedule flyer PDF](https://mills-nutrients.com/wp-content/uploads/2025/10/MILLS_HC_A5-SCHEMA-FLYER_EN-182.pdf) ·
[Mills nutrient calculator](https://millsnutrients.com/nutrient-calculator/) ·
[House & Garden nutrient calculator](https://house-garden.us/nutrient-calculator/) ·
[General Hydroponics Flora Series 3-Part feed program](https://generalhydroponics.com/pages/flora-series-3-part-feed-program) ·
[General Hydroponics Feed Charts Hub](https://generalhydroponics.com/pages/feedcharts/feed-charts-hub) ·
[Remo nutrient calculator](https://www.remonutrients.com/calculator/) ·
[Plagron Grow Schedule Calculator](https://plagron.com/en/tools/grow-schedule-calculator) ·
[Dutchpro soil hard-water feed chart PDF](https://dutchprousa.com/wp-content/uploads/2022/10/Dutchpro_Feedchart_Soil_Hardwater.pdf) ·
[Dutchpro feed charts](https://dutchprousa.com/feed-charts/) ·
[FoxFarm feeding schedules](https://foxfarm.com/feeding-schedules/) ·
[Emerald Harvest feed charts](https://emeraldharvest.co/downloads/feed-charts/) ·
[Botanicare feed sheets](https://www.botanicare.com/category/feed-sheet/) ·
[Aptus manual](https://aptus-holland.com/wp-content/uploads/2021/08/Manual_AH20_UK.pdf) ·
[Green House Feeding FAQ](https://www.greenhousefeeding.com/en/content/11-faq) ·
[Metrop feed charts PDF](https://metropnutrients.co.uk/wp-content/uploads/2023/06/Metrop-Feed-Charts.pdf) ·
[Terra Aquatica TriPart](https://www.terraaquatica.com/mineral-fertiliser-solutions/tripart/) ·
[Advanced Nutrients feeding charts](https://www.advancednutrients.com/feeding/) ·
[Advanced Nutrients nutrient calculator](https://www.advancednutrients.com/nutrient-calculator/) ·
[BudLabs](https://budlabsapp.com/)

Competitors / precedent:
[FeedSchedules.com](https://feedschedules.com/) ·
[GrowBro on Google Play](https://play.google.com/store/apps/details?id=com.pascalotti.growtracker) ·
[Grow with Jane — nutrients](https://growithjane.com/nutrients-cannabis-plants/) ·
[GrowDiaries feeding schemes](https://growdiaries.com/journal/feeding-scheds) ·
[HydroCalc](https://play.google.com/store/apps/details?id=com.k4y.hydrocalc) ·
[hyjo feed charts index](https://hyjo.co.uk/feedcharts) ·
[Growmart nutrient schedules](https://www.growmart.eu/Nutrient-Schedules) ·
[Alchimia feed charts](https://www.alchimiaweb.com/blogen/cannabis-growing-guide/feed-charts/)

Legal:
[Feist v. Rural Telephone, 499 U.S. 340 (1991)](https://ocw.mit.edu/courses/6-912-introduction-to-copyright-law-january-iap-2006/286e15d6ab1daa9dc77bbd4c58279919_feist.pdf) ·
[EU database protection — Your Europe](https://europa.eu/youreurope/business/running-business/intellectual-property/database-protection/index_en.htm) ·
[EU database protection — Digital Strategy](https://digital-strategy.ec.europa.eu/en/policies/protection-databases) ·
[INTA — fair use of trademarks](https://www.inta.org/fact-sheets/fair-use-of-trademarks-intended-for-a-non-legal-audience/) ·
[Novagraaf — informative use (Gillette/LA Laboratories)](https://www.novagraaf.com/en/insights/informative-use-necessity-or-trademark-infringement) ·
[Wikipedia — nominative use](https://en.wikipedia.org/wiki/Nominative_use) ·
[Advanced Nutrients Terms of Use](https://www.advancednutrients.com/terms-of-use/) ·
[Athena terms](https://www.athenaag.com/terms)

Agronomy:
[Bluelab — conductivity scales](https://support.bluelab.com/hc/en-us/articles/205237090-what-are-the-different-conductivity-scales-what-do-they-mean-) ·
[500 vs 700 PPM scale](https://www.hydrogrowlab.com/blog/500-vs-700-ppm-scale) ·
[Science in Hydroponics — EC to ppm](https://scienceinhydroponics.com/2021/04/the-ultimate-ec-to-ppm-chart-and-calculator.html) ·
[Rx Green Technologies flushing trial report](https://www.rxgreentechnologies.com/wp-content/uploads/2019/11/FlushingTimes_TrialReport.pdf) ·
[Rx Green flushing trial press release](https://www.prnewswire.com/news-releases/rx-green-technologies-researches-flushing-cannabis-before-harvest-300998975.html) ·
[Athena — understanding EC](https://www.athenaag.com/blog/understanding-ec-electrical-conductivity-in-cannabis) ·
[Trym — EC advanced guide](https://trym.io/ec-cannabis-management/) ·
[Bluelab — nutrient burn](https://blog.bluelab.com/nutrient-burn) ·
[Hydrobuilder — mixing plant nutrients](https://learn.hydrobuilder.com/mixing-plant-nutrients/) ·
[Growee — DWC water change](https://getgrowee.com/dwc-water-change/) ·
[Fast Buds — autoflower feeding schedule](https://2fast4buds.com/news/best-feeding-schedule-for-autoflowering-plants)
