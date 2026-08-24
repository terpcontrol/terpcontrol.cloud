# Terp Control webapp — design system, i18n, UX conventions

Ground-truth map of `webapp/` as it exists on branch `claude/controller-software-user-types-wc1jxn`.
Every path is relative to the repo root `/home/user/terpcontrol.cloud/`.
Legend: **EXISTS** = present and working, **MISSING** = not there, **AWKWARD** = present but legacy/broken/inconsistent.

---

## 1. Stack, versions, and how new UI must be written

### Exact versions (from `webapp/package-lock.json`, lockfileVersion 2 — these are the resolved installs, not the `^` ranges)

| Package | Declared (`webapp/package.json`) | Resolved |
| --- | --- | --- |
| `@angular/core` | `^15.0.0` | **15.1.1** |
| `@ionic/angular` | `^6.1.9` | **6.5.0** |
| `ionicons` | `^6.0.3` | 6.1.1 |
| `@ngx-translate/core` | `^14.0.0` | 14.0.0 |
| `@ngx-translate/http-loader` | `^7.0.0` | 7.0.0 |
| `highcharts` | `^10.3.3` | 10.3.3 |
| `highcharts-angular` | `^3.0.0` | 3.0.0 |
| `ng2-charts` | `^4.1.1` | 4.1.1 (pulls `chart.js` 4.2.0) |
| `chartjs-adapter-luxon` | `^1.3.0` | — |
| `luxon` | `^3.2.1` | 3.2.1 |
| `date-fns` | `2.30` | 2.30.0 |
| `javascript-time-ago` | `^2.5.9` | 2.5.9 |
| `rxjs` | `~7.5.0` | 7.5.7 |
| `typescript` | `~4.8.4` | 4.8.4 |
| `@capacitor/core` | `4.6.2` | 4.6.2 |
| `p-limit` | `^7.2.0` | 7.2.0 |

Dev/test: `karma` 6.4, `jasmine-core` 4.3, `karma-jasmine` 5.1, `@angular-eslint/*` 14, `eslint` ^7.6.

### Component style: **100% NgModule. Zero standalone components.**

Verified: `grep -rn "standalone" webapp/src/app --include=*.ts` returns only two hits in
`webapp/src/app/services/pwa-install.service.ts:34-35` (`display-mode: standalone` media query),
i.e. **no `standalone: true` component anywhere**.

Consequences for new UI:
- A new page = folder with `x.page.ts` / `.html` / `.scss` + `x.module.ts` + `x-routing.module.ts`, lazy-loaded via `loadChildren` in `webapp/src/app/app-routing.module.ts`.
- A new shared component gets declared **and exported** in `webapp/src/app/components/components.module.ts` (`webapp/src/app/components/components.module.ts:19-49`).
- Angular 15.1 *does* support standalone, but mixing it in would be the first instance in the codebase. `@angular/cli` schematics are still wired to `@ionic/angular-toolkit` (`webapp/angular.json:157-163`), which generates NgModule pages.
- `tsconfig.json` is **strict** (`strict: true`, `noPropertyAccessFromIndexSignature: true`, `strictTemplates: true`, `noImplicitOverride`, `noImplicitReturns`) — `webapp/tsconfig.json:5-33`. Note: many older files sidestep this with `any` (e.g. `ValuedisplayComponent` uses `any` for every field).

### Lint rules that constrain naming — `webapp/.eslintrc.json`
- `@angular-eslint/component-class-suffix`: only `Page` or `Component` suffixes allowed.
- `@angular-eslint/component-selector`: **element, kebab-case, prefix `app`**.
  **AWKWARD:** most existing selectors violate this and lint apparently tolerates it as configured/legacy — real selectors in use include `value-display`, `stage-preset-picker`, `setup-wizard`, `grow-assistant-card`, `aux-devices`, `value-edit-row`, `delete-device-row`, `smart-sockets`, `webcam-config`, `alarms`, `fridge-overview`, `fridge-settings`, `plug-settings`, `fridge-simple-settings`, `simple-alarms-card`. Only newer/log components use the prefix (`app-log-entry-viewer`, `app-log-entry-item`, `app-log-category-selector`, `app-diary-entry-modal`, `app-grow-report`, `app-co2-report`, `app-diary-entries-report`, `app-share-link-modal`, `app-image-viewer-modal`).
- `@angular-eslint/directive-selector`: attribute, camelCase, prefix `app`. **AWKWARD:** `RangeGuardDirective` uses `ion-range[rangeGuard]` (`webapp/src/app/components/range-guard.directive.ts:10`) — no `app` prefix.
- CI runs **lint + build only, never tests** (`.github/workflows/build.yml:69,91` run `npm run lint:fix` and fail if it produced a diff).

### Build wiring
- `webapp/angular.json` global styles: `src/theme/variables.scss` then `src/global.scss` (which `@import`s `theme/brand.scss` at line 35).
- `src/environments/environment.ts` is **generated** by `webapp/scripts/set-env.js` from the repo-root `.env` (`API_URL_EXTERNAL`), run via `prestart`/`prebuild`/`prelint`. `environment.prod.ts` has the literal `#API_URL_EXTERNAL#` placeholder that the Dockerfile substitutes with perl (`webapp/Dockerfile:15-20`) — it also substitutes `#CUSTOM_LINKS_HTML#` **into `src/app/login/login.page.html`** (line 222 of that template).
- Production budgets: initial 2 MB warn / 5 MB error; `anyComponentStyle` **2 kB warn / 4 kB error** (`webapp/angular.json:39-49`). Component SCSS files must stay small — `grow-report.component.scss` is 253 lines and is close to that ceiling.

---

## 2. Complete navigation map

### Routes — `webapp/src/app/app-routing.module.ts`

| Path | Guard | Module | What it shows |
| --- | --- | --- | --- |
| `''` | — | redirect → `/list` | |
| `/list` | `AuthGuard` | `ListPageModule` | Device list **or**, when exactly one device is claimed, that device's dashboard (`ListPage.singleDevice`, `list.page.ts:32-34`). Empty account → onboarding hero + claim-code input. Hosts the setup-wizard modal. |
| `/device/:device_id/charts` | `AuthGuard` (+ share-token bypass) | `ChartsPageModule` | Highcharts stockChart, measure toggles, chart presets, webcam still/timelapse, log side panel |
| `/device/:device_id/diary` | `AuthGuard` (+ share) | `DiaryPageModule` | Report switcher: `entries` \| `growreport` \| `co2report` |
| `/device/:device_id/settings` | `AuthGuard` | `SettingsPageModule` | `ngSwitch` on `device_type` → `fan-settings` / `fridge-settings` / `light-settings` / `plug-settings` / `dryer-settings` |
| `/device/:device_id/testmode` | `AuthGuard` | `TestmodePageModule` | Admin-only raw output toggles (**untranslated, German warning text**) |
| `/diagnostics` | `IsAdminGuard` | `DiagnosticsPageModule` | Lookup device by serial, dump settings + logs + charts |
| `/login` | — | `LoginPageModule` | Login / register / password recovery / activation, 5 modes in one page |
| `/demo` | — | `DemoPageModule` | Spinner page; calls `auth.loginAsDemo()` then `navigateRoot('/list')` |
| `/link-expired` | — | `LinkExpiredPageModule` | Share link dead-end |
| `/connection-error` | — | `ConnectionErrorPageModule` | Server unreachable + retry |
| `/account` | `AuthGuard` | `AccountPageModule` | Change password, logout. That's all. |
| `/shares` | `AuthGuard` | `SharesPageModule` | Active/inactive share links, copy, revoke, delete |
| `/classes` | **none** | `ClassesPageModule` | Admin fleet/firmware management — **AWKWARD: no guard at all** while the menu entry is admin-gated |
| `**` | — | `NotFoundPageModule` | 404 |

Preloading: `PreloadAllModules`.

### Navigation model — `webapp/src/app/app.component.html` + `.ts`

- `<ion-app><ion-split-pane contentId="main-content">` with an `<ion-menu type="overlay">` that renders **only when authenticated**.
- **No tab bar, no FAB anywhere in the app.** `grep '<ion-fab'` → 0 hits; `<ion-tab-bar>` → 0 hits.
- Menu entries built in `app.component.ts:15-24`:
  - `publicPages`: `menu.devices` → `/list` (icon `hardware-chip`), `menu.shares` → `/shares` (`share-social`), `menu.account` → `/account` (`person`)
  - `adminPages` (appended when `user.is_admin`): `menu.diagnostics` → `/diagnostics`, `menu.fleet` → `/classes` — **both use icon `mail`** (copy-paste leftover).
  - Demo session (`user.is_demo`) → only `/list`.
- Below the links, fixed rows: demo-mode indicator, **dark-mode toggle** (`ion-toggle` bound to `ThemeService`), **Install app** (hidden when `pwa.isStandalone`), Logout.
- Icons use the Ionic ios/md dual-binding convention: `[ios]="p.icon + '-outline'" [md]="p.icon + '-sharp'"`.
- The install-help modal (iOS/Android add-to-home-screen instructions) lives directly in `app.component.html:44-79`.

### In-page navigation
There is **no breadcrumb, no back button, and no device switcher**. Every page just has `<ion-menu-button>` in `slot="start"`. Cross-navigation happens through:
- The device overview action row — 6 outline buttons (`webapp/src/app/devices/fridge/overview/overview.component.html:219-248`): Charts, Settings, Testmode (admin+offline-workmode only), Maintenance, Diary, Setup.
- `grow-assistant-card` deep links: `[routerLink]="['/device', device_id, 'charts']" [queryParams]="chartQueryParams"` and `.../settings`.
- Grow report → charts links with cycle/phase ranges.

---

## 3. Theming system

### Token files
- `webapp/src/theme/variables.scss` (244 lines) — the whole palette, light in `:root`, dark in `body.dark`.
- `webapp/src/theme/brand.scss` (271 lines) — the reusable `tc-*` utility classes.
- `webapp/src/global.scss` — Ionic core CSS imports, font, four global overlay classes.

### Colour tokens — `webapp/src/theme/variables.scss`

Brand: blue `#2d4b95` (structure/chrome) + green `#50a030` (actions/growth).

| Ionic role | Light (`:root`) | Dark (`body.dark`) |
| --- | --- | --- |
| `--ion-color-primary` | `#2d4b95` | `#7396dd` |
| `--ion-color-secondary` (main CTA) | `#50a030` | `#6fbe4a` |
| `--ion-color-tertiary` | `#4870c0` | `#9db8f0` |
| `--ion-color-success` | `#50a030` | `#6fbe4a` |
| `--ion-color-warning` | `#c89b3c` | `#e3b95f` |
| `--ion-color-danger` | `#d0344f` | `#f06a7e` |
| `--ion-color-dark` | `#1a1d29` | `#e7ecf5` |
| `--ion-color-medium` | `#5a6275` | `#8a92a5` |
| `--ion-color-light` | `#f5f7fb` | `#232a38` |
| `--ion-background-color` | `#f5f7fb` | `#12151d` |
| `--ion-text-color` | `#1a1d29` | `#e7ecf5` |
| `--ion-border-color` | `#e3e7ef` | `#313a4a` |
| `--ion-item-background` / `--ion-card-background` | `#ffffff` | `#1a1f2b` |
| `--ion-toolbar-background` / `--ion-tab-bar-background` | `#ffffff` | `#171c26` |

Full blue-tinted `--ion-color-step-50 … -950` scale defined for both themes (`variables.scss:92-111` and `:210-228`).

### Custom `--tc-*` brand tokens (`variables.scss:113-133`, dark overrides `:230-242`)
```
--tc-radius-sm: 6px      --tc-radius-md: 12px     --tc-radius-lg: 20px
--tc-shadow-sm / -md / -lg          (blue-tinted in light, black in dark)
--tc-gradient-panel      linear-gradient(135deg, #1f3a6e, #2d4b95 55%, #50a030 135%)
--tc-gradient-step       linear-gradient(135deg, #2d4b95, #50a030)
--tc-halo                two radial-gradients (green top-left, blue top-right)
--tc-surface-subtle      #fafbfd / #171c26
--tc-text-danger  #b0293f / #f06a7e
--tc-text-warning #8a6318 / #e3b95f
--tc-text-success #35701f / #6fbe4a
--tc-text-info    #2d4b95 / #7396dd
```
The `--tc-text-*` set exists because the `--ion-color-*` fills are tuned as solid backgrounds behind white text and are unreadable as text on a light surface — documented in the comment at `variables.scss:127-129`.

### Dark-mode mechanics
- `ThemeService` (`webapp/src/app/services/theme.service.ts`, 39 lines) toggles `document.body.classList.toggle('dark', enabled)`.
- Persistence key: `localStorage['app-dark-mode']` (`'true'`/`'false'`). If unset, it follows `prefers-color-scheme` **and keeps following it live** via a `matchMedia` change listener.
- Instantiated by `AppComponent`'s constructor (injected as `public theme`), so it applies on boot.
- **Selector convention for component SCSS: `:host-context(body.dark) { … }`.** Used in `app.component.scss:12`, `valuedisplay.component.scss:39`, `charts.page.scss`, `simple-settings.component.scss:113,117`, `login.page.scss:44`, `brand.scss:248`.
- Dark-mode logo/icon trick: brand PNG logo → `filter: brightness(0) invert(1)`; black line-art preset SVGs → `filter: invert(0.88)`.
- `index.html` declares `<meta name="color-scheme" content="light dark">` and two `theme-color` metas (`#2D4B95` light, `#12151d` dark).
- **Charts do not inherit CSS variables.** `ChartsPage` hardcodes two full Highcharts colour objects in `getChartTheme()` (`webapp/src/app/device/charts/charts.page.ts:309-380`) and re-applies them via a `MutationObserver` on `document.body`'s `class` attribute (`charts.page.ts:504-508`). Dark mode also has a `measureColorOverrides` map (temperature `#ff7a6b`, humidity `#8fb0ff`, vpd `#6fbe4a`, co2 `#b7a6e8`, ppfd `#f3c24b`, …) and `logColors` `{info, warning, critical}`. **AWKWARD:** any new chart must duplicate this or refactor it out.

### Reusable `tc-*` classes — `webapp/src/theme/brand.scss` (this is the actual design-system vocabulary)

| Class | What it is | Used in |
| --- | --- | --- |
| `.tc-hero` | Centred panel with the green/blue radial halo, card background, `--tc-radius-lg`, `--tc-shadow-md`, 32/24 padding | list page onboarding (`list.page.html:26`), wizard "done" (`setup-wizard.component.html:119`) |
| `.tc-panel` | Dark gradient CTA panel, white text | defined, **currently unused** |
| `.tc-eyebrow` | Uppercase green section label, `letter-spacing: .12em` | list page, wizard |
| `.tc-step-badge` | 36px circular blue→green gradient numeral | onboarding steps, wizard done steps |
| `.tc-pill`, `.tc-pill--green`, `.tc-pill--warning`, `.tc-pill--muted` | Rounded tinted chips | grow-assistant status pills, shares page status, fridge overview workmode pill |
| `.tc-preset-card` (+ `__title`, `__subtitle`, `.active`) | Selectable option card, 2px border, green when active, 44px icon | `stage-preset-picker`, wizard plan choices, webcam/socket model grids |
| `.tc-lift` | Hover translateY(-2px) + bigger shadow, `@media (hover: hover)` only | defined, sparsely used |
| `.tc-field-hint` | Small muted help text under a control | forms |
| `.tc-text-danger/-warning/-success/-info` | Readable status text colours | `log-entry-item.component.html:4` severity colouring |

Also global element overrides in `brand.scss`:
- Headings, `ion-card-title`, `ion-title` → `font-weight: 700; letter-spacing: -0.02em`.
- `html ion-card` → `--tc-radius-md`, `--tc-shadow-sm`, 1px `--ion-border-color`.
- `html ion-card.ion-color` → tinted surface + 4px accent left border instead of Ionic's solid fill (so `<ion-card color="danger">` stays readable) — this is why the login/account status cards look the way they do.
- `html ion-button` → `--border-radius: var(--tc-radius-sm)`, `font-weight: 600`, `text-transform: none !important`, `letter-spacing: 0 !important`.
- `html ion-modal` → `--border-radius: var(--tc-radius-lg)`; `html ion-popover` → `--box-shadow: var(--tc-shadow-lg)`.
- `html ion-badge` → pill (`border-radius: 999px`).
- `html ion-segment-button` → no uppercase, `min-height: 36px`.
- `ion-range.range-guard` / `.range-guard-armed` — the guarded-slider styling (see §5).

### Typography
- `webapp/src/global.scss:12` `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')` then `--ion-font-family: Inter, -apple-system, …`.
- **AWKWARD:** `webapp/src/assets/fonts/` ships `OpenSans-Light/Regular.ttf`, `BalooBhaina-Regular.ttf`, and the full `icomoon` set (~700 KB) with **no `@font-face` declaration anywhere**. `valuedisplay.component.html` sets `font-family="Open Sans"` on 8 SVG `<text>` nodes and `valuedisplay.component.scss:11` sets `font-family: 'Open Sans'` — all silently fall back. `<i class="icon-heating">` / `icon-temperature` in `testmode.page.html:28,39` and `diagnostics.page.html` reference icomoon classes that do not exist → invisible icons.

### How a new screen inherits styling
1. Put it under `ion-content` inside a page component; global styles from `variables.scss` + `global.scss` (which pulls `brand.scss`) apply automatically.
2. Use `ion-card` for every content block — cards are the universal container (86 `<ion-card>` in the app).
3. Reference only `var(--ion-*)` / `var(--tc-*)` tokens in component SCSS; never literal hex. This is what makes dark mode free.
4. If you need a dark-specific tweak (image inversion), use `:host-context(body.dark)`.
5. Keep the component SCSS under 2 kB or the production build warns.

---

## 4. i18n: mechanism, conventions, and the actual drift

### Mechanism
- `@ngx-translate/core` 14 + `@ngx-translate/http-loader` 7.
- Loader in `webapp/src/app/app.module.ts:44-46`: `new TranslateHttpLoader(http, "./assets/i18n/", ".json")` → fetches `assets/i18n/<lang>.json` at runtime (not bundled).
- Language selection, `app.component.ts:79-89`: `setDefaultLang('en')` then `translate.use(translate.getBrowserLang())`. **There is no language switcher in the UI** and no persisted language preference.
- Angular `LOCALE_ID` is provided from `resolveAppLocale()` (`webapp/src/app/util/locale.ts`) which maps browser language → `de-DE` / `en-US`, registering both locale data sets. So `| date` and `| number` follow the same language as translations.
- Highcharts is localised separately by `applyHighchartsLocale()` (`webapp/src/app/util/highcharts-locale.ts`) — month/weekday names via `Intl.DateTimeFormat`, decimal/thousands separators via `Intl.NumberFormat`, plus `noData` / `resetZoom` / `loading` strings; `credits: {enabled:false}`.
- Relative times: `javascript-time-ago` wrapped by `webapp/src/app/util/time-ago.ts` + `TimeAgoPipe`.
- Module import style is **inconsistent**: most feature modules use `TranslateModule.forChild()`, but `login.module.ts`, `share-link.module.ts`, `diary.module.ts`, `log-entry-viewer.module.ts` import bare `TranslateModule`. Both work; pick `forChild()` for new modules to match the majority.

### File shape
- `webapp/src/assets/i18n/en.json` — 53,143 bytes, **885 leaf keys**, 93 top-level entries.
- `webapp/src/assets/i18n/de.json` — 57,048 bytes, **883 leaf keys**.
- Structure: nested objects for UI sections + a **flat block of 69 top-level `message-*` keys** for device log/diary messages.

Top-level sections by leaf-key count:
```
devices 170 · settings 116 · diary 83 · simpleSettings 73 · auxDevices 63 · share 42 ·
login 42 · wizard 40 · assistant 26 · misc 21 · growPresets 21 · webhookTargets 19 ·
charts 18 · chartPresets 13 · alarmPresets 13 · onboarding 11 · menu 8 · account 8 ·
install 8 · device-list 7 · connection-error 5 · demo 4 · notFound 3 · diagnostics 2
+ 69 flat `message-*` keys
```

### The `message-*` convention (documented in `CLAUDE.md`, implemented in `LogTranslateService`)

`webapp/src/app/services/log-translate.service.ts` resolves a log entry's `title`/`message` field:
1. `<full message>-<suffix>` where suffix is `title` or `text` → e.g. `message-device-booted:PANIC-text`
2. else split on the first `:` → `<base>-<suffix>` translated with `{ value: <part after colon> }` → e.g. `message-maintenance-mode-activated-text` with `{{value}}` = minutes
3. else `translateLegacyText()` — 7 regexes (`LEGACY_LOG_TEXTS`, lines 100-117) that recognise the pre-i18n English wordings (`"Plant phase change"`, `"Recipe step #N awaiting confirmation"`, …) and map them onto keys
4. else the raw string verbatim

Entries flagged `raw: true` bypass translation entirely — **except** `LogEntryItemComponent.getEntryTitle/getEntryMessage` deliberately force `raw: false` because legacy diary logs were mis-saved with `raw: true` (comment at `log-entry-item.component.ts:82-85`).

Log categories resolve through `getCategoryLabel()` → `diary.categories.<slug>`, falling back to the raw slug so unknown categories never leak a key.

Interpolation is ICU-less mustache: `{{value}}`, `{{count}}`, `{{current}}`, `{{target}}`, `{{days}}`, `{{minutes}}`, `{{date}}`, `{{name}}`, `{{vpd}}`, `{{humidity}}`. **No pluralisation support** — the codebase hand-rolls it, e.g. `summary.durationDays === 1 ? ('diary.day'|translate) : ('diary.days'|translate)` in `grow-report.component.html:88`.

### en ↔ de sync: **almost in sync, 2 keys drift**

Missing in `de.json` (present in `en.json`):
- `diagnostics.serialnumber` = `"Device serial number"`
- `diagnostics.show` = `"Show data"`

Missing in `en.json`: **none**.

40 leaf values are byte-identical between the two files; most are legitimately identical (product names `Terp Control FRIDGE GROW`, `Discord`, `Telegram`, `ntfy.sh`, `Home Assistant`, `Webhook`, `POST`, `Autoflower`, `Alarm`, `Firmware`, `Curing`, `Timer`, `{{value}}` passthroughs). Genuine untranslated-German candidates in that set: `misc.ok = "Okay"`, `settings.alarms.name = "Alarm Name"`, `devices.device-log = "Logs"`.

### Dangling translate keys (rendered as the raw key in the UI) — **real bugs**

Found by scanning 625 literal `'key' | translate` / `.instant('key')` occurrences against `en.json`:

| Key | Used at |
| --- | --- |
| `buttons.on`, `buttons.off` | `webapp/src/app/device/testmode/testmode.page.html` (whole `buttons` section is missing from both files) |
| `buttons.revert` | `webapp/src/app/devices/dryer/settings/settings.component.html` (commented-out sibling exists in fridge) |
| `outputs.heating`, `outputs.dehumidify`, `outputs.lights`, `outputs.fan`, `outputs.co2` | dryer/fan/fridge overview templates (`outputs` section missing from both files — mostly inside HTML comments in fridge, live in dryer/fan) |
| `simpleSettings.light.floatingNote` | `webapp/src/app/devices/fridge/settings/simple/simple-settings.component.html:157` — **live, user-visible when floating day cycle is active** |
| `devices.plug.settings.heater-day`, `…heater-night` | `webapp/src/app/devices/plug/settings/settings.component.html:154` (only `heater-name-day`/`-night` exist) |
| `settings.limits.overtemperature.enabled`, `settings.limits.undertemperature.enabled`, `settings.limits.time.enabled` | `webapp/src/app/devices/plug/settings/settings.component.html:525,552,…` — inside `<ion-checkbox>` labels; the whole `settings.limits` subtree does not exist. The sibling `devices.plug.settings.limits.*` keys do. |

### Hardcoded, untranslated UI text

- `webapp/src/app/login/login.page.html:186-216` — the entire "legacy Plantalytix migration" instruction block is **German prose hardcoded in the template**, including a `github.com/novazer/fg2` link and the `#API_URL_EXTERNAL#` build placeholder.
- `webapp/src/app/device/testmode/testmode.page.html` — `Test Mode`, `Test outputs`, `Heater`, `Lights`, `Fans internal/external/backwall`, `Reboot`, `Reboot device`, `Test remote devices`, plus a German safety warning at lines 19-22.
- `webapp/src/app/diagnostics/diagnostics.page.html` — every label (`Diagnostics`, `Device Settings`, `Workmode`, `Day Temperature`, …).
- `webapp/src/app/classes/classes.page.html` — every label (`Fleet/Firmware Management`, `Name:`, `Description:`, `Concurrent Upgrades:`, `Max Failes:` [sic]).
- `"Testmode"` button label in fridge/dryer/plug overviews.
- `"NOT YET IMPLEMENTED"` at `webapp/src/app/devices/plug/settings/settings.component.html:608`.
- `"Smart Grow Automation"` eyebrow is intentionally untranslated brand copy (`list.page.html:27`, `setup-wizard.component.html:120`).
- `webapp/src/app/device/diary/diary-entry-modal/diary-entry-modal.component.ts:213` — `confirm('You have unsaved changes. Are you sure you want to discard them?')` — a **native browser `confirm()` with an English literal**, breaking both the i18n and the Ionic-alert conventions.

### Static help pages
`webapp/src/assets/i18n/help/index_en.html` + `index_de.html` + `styles.css` exist, titled "Fridge Grow Help". **Nothing in the app links to them** (`grep 'i18n/help'` in `app/` → 0 hits). Dead content, still branded with the old product name.

---

## 5. Reusable component inventory

### `webapp/src/app/components/` — declared in `components.module.ts`

| Selector | File | LOC (ts/html) | What it does |
| --- | --- | --- | --- |
| `value-display` | `components/valuedisplay/valuedisplay.component.*` | 266 / 133 | **The signature gauge.** 500×500 SVG dial: 190r value arc + 175r limit arc, needle polygon, big value text, `Ø 1h:` average line, `Ziel:`/target line, unit, 120px measure icon, min/max limit labels rotated onto the ring. Colour interpolates in HSL from green (`#67BE59`) toward blue (`#4bb7e9`) below the limit and red (`#e94b4b`) above. Inputs: `name`, `icon`, `unit`, `scale-min`, `scale-max`, `limit-min`, `limit-max`, `value`, `average-value`, `target-value`, `target-label`. Renders `—` (`NO_VALUE`) instead of NaN. **AWKWARD:** the `target-label` default is the German literal `'Ziel'`, all internals typed `any`, the icon `<image>` sits below the value, gauge track uses `--ion-color-step-100`. |
| `stage-preset-picker` | `components/stage-preset-picker/…` | 30 / 25 | Grid of `.tc-preset-card`s from `GROW_STAGE_PRESETS`, with optional `showCustom` / `showOff` cards. Two-way `[(selected)]`. Subtitle line renders `24/21 °C · 70 % · 18 h` + `VPD 0.4–0.8 kPa`. |
| `setup-wizard` | `components/setup-wizard/…` | 289 / 163 | Full onboarding wizard — see §6. |
| `grow-assistant-card` | `components/grow-assistant/…` | 222 / 68 | Compact strip on the device overview: running-plan header (stage icon, "day X of Y", `ion-progress-bar`, next step, confirm link), **live range check** producing `.tc-pill--green` "All in the green" or `.tc-pill--warning` deviation pills (tolerances: temp ±1.5 °C, humidity ±7 %), an `ion-accordion-group` with 4 stage tips + a link to the matching chart preset, and a dismissible "start a grow plan" banner (`localStorage['assistant-dismissed-<device_id>']`). Uses `KeyedCache` to keep object identity stable across change detection. |
| `aux-devices` | `components/aux-devices/aux-devices.component.*` | 23 / 14 | "Connected devices" card wrapping the next two. `supportsSockets` = `controller`/`fridge`/`fridge2`. |
| `webcam-config` | `components/aux-devices/webcam-config.component.*` | 264 / 145 | Camera model grid + RTSP URL config + test-image button |
| `smart-sockets` | `components/aux-devices/smart-sockets.component.*` | 207 / 153 | Per-role socket pairing/removal/testing |
| `value-edit-row` | `components/value-edit-row/…` | 68 / 63 | **The canonical numeric-setting row.** Tap the row → it expands into `[−] ion-range [+]`. Inputs: `label` (already-translated text, not a key), `display` (formatted with unit), `[(value)]`, `min`/`max`/`step`, optional `helpKey` (renders a `?` `ion-popover`), `disabled`. Emits `valueChange` + `changed`. Fully ARIA-annotated (`aria-expanded`, composed `aria-label`s, `role="group"`), and rounds by the step's decimal count to avoid float debris. |
| `delete-device-row` | `components/delete-device-row/…` | 67, inline template+styles | The one delete-device action: translated **double** confirm via `AlertController`, `devices.unclaim()`, `navigateByUrl('/list', {replaceUrl:true})`. Only component in the repo using an inline `template`/`styles`. |
| `rangeGuard` (directive) | `components/range-guard.directive.ts` | 74 | `ion-range[rangeGuard]` — keeps a slider `pointer-events: none` + 0.6 opacity until its parent row is tapped, then arms it (green knob halo) and disarms 8 s after the last interaction. Prevents accidental value changes while scrolling on mobile. |
| `app-outputdisplay` | `components/outputdisplay/…` | 17 / 6 | **DEAD/BROKEN.** Not exported from `ComponentsModule`, not used anywhere, and its template binds `onicon`, `officon`, `name` — none of which exist on the class. Its SCSS file is empty. |

### `webapp/src/app/components/share-link/` — separate `ShareLinkModule`
`app-share-link-modal` (99 / 91) — presented via `ModalController`. View-only vs interactive radio group, optional "include charts" for diary links, expiry `ion-datetime` inside a nested `ion-modal`, create → readonly input + copy button with a 2 s "copied" state.

### `webapp/src/app/device/log-entry-viewer/` — `LogEntryViewerModule` (**the most reusable feature module**)
| Selector | File | What it does |
| --- | --- | --- |
| `app-log-entry-viewer` | `log-entry-viewer.component.*` (95/31) | Paginated list, 100 entries/page (`LOGS_MAX_DISPLAY_COUNT`), prev/next chevrons + `n / m`. Inputs `logs`, `selectedCategories`, `showCategories`, `showEdit`, `showDelete`, `editable`; outputs `showAll`, `edit`, `delete`. Exports the pure helpers `collectLogCategories()`, `matchesLogCategory()`, `filterLogsByCategory()` and the type `LogEntryViewerLog = DeviceLog & { count?, editable? }`. |
| `app-log-entry-item` | `log-entry-item.component.*` (97/86) | One entry: severity-coloured `<h3>` (`tc-text-warning`/`-danger`/`-info`), `(Nx)` repeat count + "show all" link, `date:'medium'` (or `'shortTime'` with `timeOnly`), pre-wrapped message, a `<ul>` of `entry.data` measurements with units from `getDiaryDataFieldUnit()`, 100px image thumbnails opening a fullscreen `ImageViewerModalComponent`, category `ion-chip`s, and edit/delete icon buttons. |
| `app-log-category-selector` | `log-category-selector.component.*` (25/11) | `ion-select multiple` of categories with translated labels. |
| `app-image-viewer-modal` | `../diary/image-viewer-modal/…` (75/26) | Fullscreen image pager. |

### Pipes — `webapp/src/app/pipes/pipes.module.ts`
| Pipe | File | Behaviour |
| --- | --- | --- |
| `round` | `round.pipe.ts` | `parseFloat` → `toFixed(precision ?? 1)` + optional unit; returns `NO_VALUE` (`—`) for non-finite |
| `nofract` | `nofract.pipe.ts` | `toFixed(0)` + unit only when finite |
| `onoff` | `onoff.pipe.ts` | returns a **translation key** (`misc.on`/`misc.off`/`misc.noValue`) — always chain `| onoff | translate` |
| `multiply` | `multiplay.pipe.ts` *(sic, misspelled filename)* | `value * factor` |
| `daytime` | `timestamp.pipe.ts` | seconds-since-midnight → `HH:MM` with timezone offset applied |
| `timestamp` | `timestamp.pipe.ts` | **DEAD: `return 0;`** with the real moment.js implementation commented out |
| `verbosity` | `verbosity.pipe.ts` | 1-4 → `INFO`/`DEBUG`/`WARNING`/`ERROR`, untranslated, `undefined` for anything else |
| `timeAgo` | `timeago.pipe.ts` | `formatTimeAgo()` from `util/time-ago.ts` |

### `webapp/src/app/util/`
| File | Contents |
| --- | --- |
| `grow-presets.ts` (401) | `GROW_STAGE_PRESETS` (seedling/vegetative/flowering/late_flowering/drying with day+night temp/rH, lightHours, lightLimit, co2Enriched/Ambient, `vpdRange`, `icon`), `applyStagePreset()`, `detectActiveStagePreset()`, `GROW_PLAN_TEMPLATES` (photoperiod 14/28/42/21/10 d, autoflower 10/18/28/14/10 d with `waitForConfirmation` gates), `buildRecipeFromTemplate()`, `deviceHasCo2()`, `deviceControlCapability()` → `'full' | 'light_only' | 'monitor'` |
| `alarm-presets.ts` (134) | `ALARM_PRESETS` — id, ionicon, sensorType, stage-aware thresholds (`humidity_high` = 60 in flowering, else 75) |
| `chart-presets.ts` (28) | `CURATED_CHART_PRESETS` — `climate`, `vpd`, `co2`, `light`, `drying`; each = measures + timespan + icon; `availableCuratedPresets()` filters by what the device reports |
| `webhook-targets.ts` (177) | Discord / Telegram / ntfy / Home Assistant / custom, with guided field defs, `apply`, `matches`, `parse`, and a `tunnel` policy |
| `webcam-models.ts` (107) | `terp_cam` / `tapo_c200` / `reolink` / `hikvision` / `custom` with placeholder RTSP URLs |
| `no-value.ts` (7) | `NO_VALUE = '—'`, `isMissingValue()` |
| `keyed-cache.ts` (18) | Single-slot memoization for template getters — **important**: without it, getters returning fresh arrays make `ngFor` rebuild the DOM every change-detection cycle |
| `ui-mode.ts` (6) | `EXPERT_MODE_STORAGE_KEY = 'app-settings-expert'` |
| `locale.ts`, `time-ago.ts`, `highcharts-locale.ts`, `calculateVpd.ts`, `socket-info.ts` | as described above |

### `webapp/src/app/services/`
| Service | File | Role |
| --- | --- | --- |
| `AuthService` | `auth/auth.service.ts` | `authenticated`/`current_user`/`sessionState` BehaviorSubjects, token refresh with 8 s timeout, `restoreSession()`, `loginAsDemo()`, `isDemo` |
| `DeviceService` | `services/devices.service.ts` (336) | The API surface: `devices` + `loadState` BehaviorSubjects, `claim`/`unclaim`, `getConfig`/`setSettings`, `getAlarms`/`setAlarms`, `getCloudSettings`/`setCloudSettings`, `getRecipe`/`setRecipe`, `getLogs`/`addLog`/`updateLog`/`deleteLog`/`clearLogs`, `uploadDeviceImage`/`getDeviceImageUrl`, `sendAuxCommand`, `activateMaintenanceMode`, `rebootDevice`, `resolveDeviceAccessInfo` (owner → share-token fallback). Also `DeviceAdminService` in the same file. |
| `DataService` | `services/data.service.ts` (138) | Live measurements. `measure(device, name)` and `measureAvg(...)` return `BehaviorSubject<number>`, polled every 10 s; a 50 ms deferred sweep batches the burst of subjects created during one render pass. Plus `getSeries()` / `getLatest()` / `latest()`. |
| `ThemeService`, `PwaInstallService`, `LogTranslateService`, `ShareService`, `ChartPresetsService`, `RecipeService`, `MaintenanceModeService`, `UsersService` | as described |

### What a new diary/chart feature can reuse today
- `app-log-entry-viewer` + `app-log-entry-item` + `app-log-category-selector` (pagination, images, categories, severity colours, edit/delete — all done)
- `LogTranslateService` for anything log-shaped
- `DeviceService.getLogs/addLog/updateLog/deleteLog` + `uploadDeviceImage`/`getDeviceImageUrl`
- `getDiaryDataFieldUnit()` exported from `diary-entry-modal.component.ts` (units for `co2FillingRest` g, `lightMeasurement` ppfd, `distanceMeasurement` cm, `tdsMeasurement` ppm, `ecMeasurement` mS/cm, `outsideTemperatureMeasurement` °C)
- `defaultDiaryEntries` — the category→editable-fields map that drives the entry form
- `value-edit-row`, `stage-preset-picker`, `value-display`, `grow-assistant-card`
- `ShareLinkModule` (share any page by adding a `SharePage` value)
- `mergeDiaryQueryParams()` / `parseDiaryReport()` in `device/diary/diary-query-params.ts` — the URL-state convention
- `CURATED_CHART_PRESETS` + `ChartPresetsService` (server-stored user presets)
- `KeyedCache` — mandatory for any derived-array getter used in a template

---

## 6. Existing onboarding

Two distinct pieces.

### A. Empty-account hero — `webapp/src/app/device/list/list.page.html:26-74`
Renders only when `loadState === 'loaded' && all_devices.length === 0` (an explicit `DevicesLoadState` so a failed fetch never looks like an empty account). `.tc-hero` + `.tc-eyebrow "Smart Grow Automation"` + 3 numbered `.tc-step-badge` steps (`onboarding.step1/2/3Title/Text`) + a large uppercase, letter-spaced claim-code input + a link to `terpcontrol.com/so-funktioniert-es.html`. Claim failure shows a red top toast (`onboarding.claimFailed`). **A successful claim opens the setup wizard immediately** (`list.page.ts:60-64`).

### B. `setup-wizard` — `webapp/src/app/components/setup-wizard/setup-wizard.component.ts` (289 lines)

Presented as a modal from two places:
- `list.page.html:160-164` (`class="wizard-modal"`, `--width: min(680px, 96vw)`, `--height: min(720px, 94vh)`, `backdropDismiss: false`)
- `devices/fridge/settings/settings.component.html:318-322` with `[startAt]="'stage'"` ("start grow plan")

**Adaptive step sequence** (`steps` getter, lines 66-75):
- non-climate device → `['name', 'done']`
- controller → `['name', 'connections', …]`, fridge → `['name', …]`
- if the controller is `monitor`-capable (no climate/light sockets paired) and not opened via `startAt:'stage'` → stop after the head → `[…, 'done']`
- otherwise → `[…, 'stage', 'plan', 'done']`

**Steps:**
1. `name` — floating-label `ion-input`, max 40 chars, Enter advances.
2. `connections` (controllers only) — lists paired socket roles from `hardwareInfo.sockets` with a green `flash-outline` icon, states the derived capability (`wizard.connections.detected-full|light_only|monitor`), and offers a **refresh** button that re-fetches devices so you can pair a socket mid-wizard.
3. `stage` — `<stage-preset-picker>`.
4. `plan` — `.tc-preset-card` grid: "just targets" vs the two `GROW_PLAN_TEMPLATES`; then per-phase day-count inputs **for the remaining phases only** (`planStartIndex` = index of the chosen stage), a total days/weeks line, and an inline `ion-item color="danger"` error row that shows `HTTP <status> — <path> — <message>` so support tickets carry a cause.
5. `done` — `.tc-hero` with eyebrow, three `.tc-step-badge` next-steps, an aux-devices hint, and a green close button.

**Chrome:** `ion-header`/`ion-toolbar` with title + Close; a dot progress indicator (`.wizard-dot`, grey → `--ion-color-primary` active → `--ion-color-secondary` completed); `ion-footer` with Back / Next-or-Apply, the primary button `color="secondary" fill="solid"` with an inline `ion-spinner name="crescent"` while saving.

**On finish** (`finish()`, lines 219-288): sets the name if changed; for "targets" applies `applyStagePreset()` + `setSettings()` **and stops any running recipe** (a running plan would overwrite the manual targets); for a plan, builds a recipe via `buildRecipeFromTemplate()`, starts it at `planStartIndex`, and immediately pushes the active step's settings so offline devices are covered too. Then `refetchDevices()` and **forces `localStorage['app-settings-expert'] = 'false'`** so a guided setup lands the user in guided settings.

**How good it is — honest assessment**
- Strong: hardware-aware branching, monitor-only devices are respected, resume-mid-grow (`planStartIndex`), editable durations, real error surfacing, cannot be dismissed by backdrop, hands off to the guided settings mode.
- Weak: only reachable on claim or via one settings button — **there is no "re-run setup" from the menu**, and the fridge overview's `sparkles-outline` "Setup" button (`overview.component.html:243-247`) is the only other entrance; it is not discoverable as onboarding.
- Weak: **no illustrations.** `webapp/src/assets/wizard/` contains 23 `.mp4` files (~30 MB: `connect.mp4`, `teachin.mp4`, `sockettype_*.mp4`, `overview.mp4`, …) plus `poster.png`, and **not one is referenced anywhere in `src/app/`**. The `angular.json` asset glob copies all of them into every production build. Dead weight and an obvious missed opportunity.
- Weak: no "skip", no progress persistence — closing loses everything.
- Weak: the wizard never touches alarms, notifications, webcam, or sockets pairing; it only points at them (`wizard.done.auxHint`).

---

## 7. UX conventions a new screen must follow to look native here

**Page skeleton** (every authenticated page, verbatim):
```html
<ion-header [translucent]="true">
  <ion-toolbar>
    <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
    <ion-title>{{'section.title' | translate}}</ion-title>
    <ion-buttons slot="end"> <!-- optional: share / theme-toggle icon buttons --> </ion-buttons>
  </ion-toolbar>
</ion-header>
<ion-content> … </ion-content>
```
Toolbar end-slot actions are **icon-only** `ion-button`s with `[title]` (share = `share-social-outline`; on public/share views a theme toggle = `sunny-outline`/`moon-outline`).

**Containers.** `ion-card` is the universal block: `<ion-card><ion-card-header><ion-card-title>{{key|translate}}</ion-card-title></ion-card-header><ion-card-content>…</ion-card-content></ion-card>`. Status blocks use `<ion-card color="danger|success">` which `brand.scss:34-39` re-styles into a tinted surface with an accent left border. 86 cards vs 7 `ion-list` — cards win.

**Buttons.**
- Primary action → `color="secondary"` (brand green), usually `expand="block"`.
- Secondary → `fill="outline"`, often `color="medium"` for neutral actions.
- Tertiary/inline → `fill="clear" size="small"`, `color="medium"` for icon actions, `color="danger"` for destructive.
- Never uppercase (enforced globally in `brand.scss:69-74`).
- Loading state = an inline `<ion-spinner name="crescent">` swapped in via `*ngIf`, with the button `[disabled]`.

**Forms.**
- Text: `<ion-item><ion-label position="floating">…</ion-label><ion-input …></ion-item>`; numbers often use `class="ion-text-right"`.
- Numeric settings: **`<value-edit-row>`**, not a bare `ion-range`.
- Any bare `ion-range` on a settings page: add the **`rangeGuard`** attribute.
- Select: `<ion-select [interfaceOptions]="{cssClass: 'wider-popover'}">` — see the caveat in §"Awkward" below.
- Date/time: `ion-datetime` inside an `ion-modal` (either `ion-datetime-button` + `[keepContentsMounted]="true"`, or a `trigger="…"` id).
- Help text: `<div class="section-hint">` (0.82 rem, `--ion-color-medium`) or the global `.tc-field-hint`; contextual help = a `help-circle-outline` `fill="clear" size="small"` button with a matching `<ion-popover [trigger]="id" [dismissOnSelect]="true">`.
- Group heading inside a card: `<h3 class="group-title">`.

**Overlays.**
- Two competing patterns: **declarative** `<ion-modal [isOpen]="flag" (willDismiss)="flag=false">` with `<ng-template>` (wizard, device log, share expiry) and **imperative** `ModalController.create({component, componentProps, cssClass})` (diary entry, share link, image viewer, alarm presets). Both are current; the imperative one is the pattern for modals that return data (`await modal.onDidDismiss()` → check `result.role`).
- Modal chrome: `ion-header`/`ion-toolbar` with title + a `misc.close` text button in `slot="end"`; footer actions in `ion-footer`.
- Short forms use `cssClass: 'auto-height-modal'` (`global.scss:69-88`) — the body must be a plain `<div class="modal-body">`, **not** `ion-content`.
- Confirmations → `AlertController` with translated `misc.cancel` + a `role: 'destructive'` button (see `DeleteDeviceRowComponent`). Destructive actions worth two confirms use two sequential alerts.
- Errors after an action → `ToastController` `{ duration: 4000, position: 'top', color: 'danger' }`.

**Empty / loading / error, in that order.** Every list page distinguishes three states:
`loading` (centred `ion-spinner name="crescent"`, or an `ion-item` with `ion-spinner name="dots"` + `misc.loading`), `error` (`<ion-card color="danger">` with a retry button), `empty` (a card or hero with copy). The device list uses an explicit `DevicesLoadState` union precisely so "fetch failed" never renders as "no devices".

**Missing values.** Never let `NaN` reach the DOM — pipe through `round`/`nofract` (both emit `—`) or use `NO_VALUE`/`isMissingValue`.

**Offline.** The device overview overlays a blurred `.offline-overlay` with a "last seen" line, click-to-dismiss (`overview.component.html:1-8`).

**Read-only / share / demo modes.** New screens must handle three restrictions:
- `isPublic` / `share` → `locked` (view-only; URL params ignored in favour of the stored `share.query`), `canEdit`, `webcamAllowed`, `chartsAllowed` — see `diary.page.ts:53-77`.
- demo session → `auth.isDemo`, save buttons disabled with `demo.saveButton` / `demo.saveNotSupported` copy.
- Public views swap the menu button for a theme toggle.

**URL as state.** Charts and diary put view state in query params (`measures`, `timespan`, `report`, `share`) via `mergeDiaryQueryParams()`; deep links from the assistant and grow report rely on it. Follow this for anything shareable.

**Local preferences in `localStorage`** — existing keys: `app-dark-mode`, `app-settings-expert` (`EXPERT_MODE_STORAGE_KEY`), `assistant-dismissed-<device_id>`.

**Simple vs Expert.** The fridge/controller settings page puts an `<ion-segment>` at the top (`.ui-mode-switch`, max-width 340px, centred) toggling guided (`fridge-simple-settings` + `simple-alarms-card`) vs the full expert form. This is the **only `ion-segment` in the app** — if a new feature needs progressive disclosure, this is the precedent.

**Accessibility conventions already established** (do not regress): composed `[attr.aria-label]` on compound rows, `aria-expanded` on expand/collapse rows, `role="group"` around a labelled editor, `aria-hidden="true"` on decorative icons, real `<button>` elements (not `ion-chip` click handlers) for keyboard-reachable sub-actions with `:focus-visible` outlines (`charts.page.scss:212-216`), `(keydown.enter)`/`(keydown.space)` on `ion-chip`s used as buttons.

**Responsive.** Breakpoints are ad-hoc, not tokenised: `575px`/`576px` (device overview tile layout), `340px` (tiny phones), `480px` (login/account width), `600px` (charts overlay + Highcharts navigator enable), `320px or height 600px` (charts control shrink). Grids use Ionic `size`/`size-sm`/`size-md`/`size-xl` on `ion-col`, or CSS Grid `repeat(auto-fill, minmax(130-150px, 1fr))` for card grids. Centred narrow pages use the `.outer` (flex, fixed 400px → 480px ≥480px) / `.inner` (100%) pattern from `login.page.scss` and `account.page.scss`. Single-device dashboard caps at `max-width: 860px`.

**PWA.** `src/manifest.webmanifest` (standalone, `theme_color #2D4B95`, SVG + maskable PNG icons 192/512/1024), apple-touch-icon and `apple-mobile-web-app-*` metas, and `PwaInstallService` capturing `beforeinstallprompt` with an iOS instructions fallback. **MISSING: there is no service worker** — `@angular/service-worker` is not a dependency and `grep ServiceWorker/ngsw` finds nothing. It is installable, not offline-capable. `nginx.conf` sends `no-store` for everything except hashed bundles.

**Capacitor** is a dependency (`@capacitor/app|core|haptics|keyboard|status-bar` 4.x) but `capacitor.config.ts` still has the untouched scaffold (`appId: 'io.ionic.starter'`, `appName: 'customer-app'`) and there are no `android/`/`ios/` folders. Web-only in practice.

---

## 8. Test setup

- **Framework:** Karma 6.4 + Jasmine 4.3, Chrome launcher, `karma-jasmine-html-reporter`, coverage to `coverage/app`. Config: `webapp/karma.conf.js`, bootstrap: `webapp/src/test.ts`, builder: `@angular-devkit/build-angular:karma` (`angular.json` `test` target). `npm test` → `ng test`.
- **29 spec files, 38 `it()` blocks total.** 24 of the 29 files contain exactly **one** `it('should create')`.
- The only files with real assertions:
  - `webapp/src/app/device/diary/grow-report/grow-report.component.spec.ts` — **5 tests**, the best test in the repo: constructs `GrowReportComponent` with 6 hand-rolled stubs and exercises the private `convertEventsToGrowCycles()` against lifecycle-log fixtures (skipped stages, rollbacks, incomplete final cycle).
  - `webapp/src/app/pipes/round.pipe.spec.ts` — **4 tests**, pure-function tests of `RoundPipe`/`NoFractPipe` including the `NO_VALUE` behaviour.
  - `webapp/src/app/app.component.spec.ts` — **3 tests, and 2 of them are stale Ionic scaffold** asserting `menuItems.length === 12`, `textContent` contains `'Inbox'`/`'Outbox'`, and `routerLink === '/folder/Inbox'`. None of that exists. **These tests cannot pass.**
- **Component test pattern** (the boilerplate everything copies):
  ```ts
  TestBed.configureTestingModule({ declarations: [X], imports: [IonicModule.forRoot()] }).compileComponents();
  ```
  No `TranslateModule`, no `HttpClientTestingModule`, no `RouterTestingModule` in most — meaning any component that injects `TranslateService`/`HttpClient` would fail to instantiate. This works only because most of these specs were never run.
- **CI does not run tests.** `.github/workflows/build.yml` runs `npm run lint:fix` and fails on a resulting diff, then builds; there is no `ng test` step, and `README.md`'s "Before committing" section lists only `lint:fix` and `build`.
- **Conclusion:** the test suite is decorative and currently red. For a new feature, follow the `grow-report.component.spec.ts` pattern — plain-class construction with stubs, testing pure logic — rather than the `should create` TestBed boilerplate. Do not assume `ng test` currently passes.

---

## 9. AWKWARD / legacy inventory (things a redesign should know or fix)

1. **`app.component.spec.ts` asserts Inbox/Outbox** — stale scaffold, guaranteed failing (`webapp/src/app/app.component.spec.ts:26-45`).
2. **Overlay CSS classes defined inside component SCSS.** `.wider-popover .popover-content` is declared in `devices/fridge/settings/settings.component.scss:23`, `devices/dryer/…:23`, `devices/plug/…:23` — three copies — and `.dialog-fullscreen` in `device/diary/image-viewer-modal/image-viewer-modal.component.scss:1`. Ionic renders popovers/modals at the app root outside the component's view encapsulation, so **these rules never apply**. The classes that do work (`fullwidth`, `wide-firmware-select`, `auto-height-modal`) live in `global.scss`. Any new overlay class must go in `global.scss`.
3. **`app-outputdisplay` is dead and broken** — template references non-existent members, not exported, empty SCSS.
4. **`TimestampPipe` returns `0`** unconditionally (`pipes/timestamp.pipe.ts:11`).
5. **`multiplay.pipe.ts`** — misspelled filename for the `multiply` pipe.
6. **~30 MB of unused wizard videos** in `webapp/src/assets/wizard/`, copied into every build.
7. **~700 KB of unused fonts** (`OpenSans`, `BalooBhaina`, `icomoon`) with no `@font-face`; two templates reference icomoon classes that render nothing.
8. **`/classes` (admin fleet management) has no route guard** while the menu link is admin-only.
9. **Hardcoded German legacy-migration prose in `login.page.html`**, with a build-time `#API_URL_EXTERNAL#` substitution into a template file.
10. **`diary-entry-modal` uses native `confirm()`** with an untranslated English string.
11. **`diagnostics.page.html` puts an `<ion-card>` before `<ion-header>`**, outside `ion-content` — a layout bug.
12. **Dangling i18n keys** listed in §4 render raw keys in the UI, most visibly `settings.limits.*.enabled` inside plug-settings checkboxes and `simpleSettings.light.floatingNote`.
13. **Chart theming is a hardcoded duplicate palette** synced to CSS tokens only by hand, kept in step by a `MutationObserver`.
14. **Two chart libraries are installed** — Highcharts (used, in charts page + grow report) and `ng2-charts`/`chart.js` + `chartjs-adapter-luxon` (imported by `diary.module.ts:7,27` and `charts.module.ts:8,22`; `chartjs-adapter-luxon` is imported for side effects in `diary.page.ts:2`). Both ship in the bundle.
15. **Component selector prefixes are inconsistent** — old components have no `app-` prefix despite the eslint rule; new ones do.
16. **`ValuedisplayComponent`** — 266 lines of untyped colour maths with a German default label `'Ziel'`, and gauge colours hardcoded as RGB literals rather than tokens.
17. **No language switcher**, no persisted language; browser language wins unconditionally.
18. **No service worker / offline support** despite being marketed and installed as an app.
19. **`capacitor.config.ts` is untouched scaffold** (`io.ionic.starter` / `customer-app`); `package.json` still says `"author": "Ionic Framework"`, `"name": "customer-app"`.
20. **No global "back" affordance** — deep pages (charts/diary/settings) can only be left via the hamburger menu.
