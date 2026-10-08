---
summary: The mechanics behind every time, date, figure and translated word in the web app - the server's clock, the account's time zone, the shared date formats, the age helpers, i18next setup, device-message keys, the figure writers, help topics - and the source-reading tests that enforce them
updated: 2026-10-08
source: React rewrite sessions 2026-09..10 (clock, zone and figure passes 2026-09-23..10-04); Chris (help texts, 2026-09-24); codebase cleanup (2026-10-08); checked against webapp/ on 2026-10-08
paths:
  - webapp/src/**
  - webapp/public/assets/i18n/**
---
# Time and language in the web app

Part of [webapp.md](webapp.md). This is the machinery; the rules it serves - what a value's age looks like, how a
date or a figure reads in each language, which words to use - are in [app-ux.md](app-ux.md) §4 and
[app-wording.md](app-wording.md). Most of what follows is enforced by tests that read the source, so breaking it fails
`npm test`.

## The server's clock

- `src/api/clock.ts` learns the browser-server offset from the `Date` header of every answer: stamp + 500 ms minus
  the midpoint of the round trip; the shortest round trip wins; a jump beyond round trip / 2 + 5 s (sleep, a clock
  change) resets it. The server exposes `Date` through CORS (`EXPOSED_HEADERS` in `server/src/main.ts`); without it
  the offset stays 0, the browser's clock.
- Age everything against `serverNow()` or `useNow()` (`src/ui/useNow.ts`, a 10 s beat that also redraws when the
  offset changes). A browser-noted instant such as React Query's `dataUpdatedAt` is restated with `fetchedAt()`
  before it is aged - raw, it is off by the offset, and a fast browser read "0 s ago" forever. Only stopwatches with
  both ends in the browser stay on its clock (the 5 s undo window).
- Why: a skewed browser clock misjudged liveness, compared token expiry with the wrong now and fetched the wrong
  camera day ("no picture today" on a working camera).

## The account's time zone

- Clock times and day boundaries are drawn in `me.preferences.timezone` through `src/ui/zone.ts` (`useZone`,
  `zoned`, `zonedAt`, `clock`, `calendarDay`, `nowThere`; an hour with its day when not today's is `sinceLabel` in
  `ui/age.ts`). Date fields read and write their day through `src/ui/days.ts` (`dayOf`, `momentOn`, `startOfDayOn`,
  `endOfDayOn`, `dayEdgeInstant`) in the same zone; reading it browser-local filed backdated lines a grow day early.
  Ages need no zone.
- A device document's times of day are seconds past midnight UTC
  ([ADR 0005](../adr/0005-device-times-on-the-wall-clock.md)): they are shown and taken on the account's wall clock
  through `src/ui/wall-clock.ts` (`offsetOf`, `wallClock`, `secondsOf`) and the one time field,
  `screens/control/TimeInput.tsx`, never formatted as instants.
- Public pages (`src/screens/public/`) use the reader's zone: the public API does not tell a stranger the owner's.
  `useZone()` reads no account for the demo or a signed-out reader.
- Migrated accounts are on UTC (the old cloud knew no zone). `src/app/shell/ZoneAdoption.tsx` takes the browser's
  zone once for an account whose `timezoneChosen` is not set and says so; a chosen zone, UTC included, is never
  overridden. The zone picker adds UTC by hand: `Intl.supportedValuesOf('timeZone')` has none.

## Date formats

- Only the constants in `ui/zone.ts`: `CLOCK` (`HH:mm`), `NARROW_DAY`, and `DAY`, `DAY_IN_YEAR`, `WEEKDAY_DAY`,
  `DATED_CLOCK`, `DATED_CLOCK_WITH_YEAR`, which are live bindings re-set on every language change
  (`followDateLanguage`), so an imported format follows the switch.
- The month token is `LLL`. German spells `MMM` differently for eleven months (`Sept.`, `Jan.`), and mixing them put
  two spellings on one screen.
- No Luxon presets (`DATE_MED`, `TIME_SIMPLE`, ...): they follow the language rather than the zone and write the US
  `Oct 23, 2026` or `11:38 AM`.
- Luxon's locale is the app language: `Settings.defaultLocale` is set in `src/i18n/i18n.ts` (`initI18n`, and in
  `setLanguage` before `changeLanguage`, so the switch's own render already formats right).

## Ages

- `src/ui/age.ts`: `ageLabel` and `spanLabel` floor an elapsed span, `countdownLabel` and `leftLabel` round a span
  still to run up, `durationLabel` writes a length somebody chose in its coarsest whole unit (a plan step's length
  is `stepLengthLabel`, `screens/control/plan-labels.ts`); unit symbols come from the catalogue's `units` block
  (`unitSymbol`).
- `valueAge()` re-judges a value's `MetricValue.state` at the server's now and keeps the worse verdict. A device's
  liveness is in no answer: `deviceLiveness(lastSeenAt)`, with `heardAt()` taking the later of `lastSeenAt` and the
  newest reading; silence is worded by `offlineLabel()`. The boundaries (`valueStateOfAge`) and `heardAt` are
  `shared-types/src/v1/value-age.ts`, as on the server and in the simulator.
- An offline alert's `value` is the seconds of silence, not a reading; the silence began at `silentSince(alert)`
  (`startedAt` minus `value`).
- `useReportFreshness(at)` (`src/ui/freshness.ts`) feeds the shell's "updated N ago" line: a server-stamped instant
  (a camera's `lastStillAt`) or a fetch instant restated with `fetchedAt()`, never a raw `dataUpdatedAt`.

## The sweep: `test/zone.test.ts`

It reads every file in `src/` and fails when

- a file writes an hour or a date (format tokens, Luxon presets, `.toLocaleString(`, the shared constants,
  `DateTime.fromMillis(`) without importing `ui/zone`; Luxon presets fail anywhere;
- `MMM` or `MMMM` appears outside `ui/zone.ts` - it greps text, so not even a comment may spell it;
- a zone helper is called with a literal `null` outside `ui/zone.ts`, `ui/days.ts` and `screens/public/`;
- `new Date()`, `Date.now()` or `DateTime.now()` (`local()`, `utc()`) appears outside `api/clock.ts`,
  `api/client.ts` and the undo stopwatch (`log/LogProvider.tsx`, `log/Toasts.tsx`), or `.toISOString()` without an
  `api/clock` import;
- a `Date` calendar getter or setter (`getFullYear`, `setDate`, ...) is used anywhere.

It also round-trips days across browser and account zones. Known offenders sit in `NOT_YET`
(`screens/space/members/invites.ts`); the test fails once a listed file stops offending, so whoever fixes one deletes
its line.

## Translations

- i18next (`src/i18n/i18n.ts`). `public/assets/i18n/{en,de}.json` (about 300 KB each) are fetched before the first
  render, not bundled; English is always loaded beside the active language as the fallback; `nsSeparator: false`
  because keys contain colons. The language is `terp.language` in `localStorage`, else the browser's;
  `setLanguage()` (Me › Appearance) loads the catalogue before switching. The shell also stores it in
  `me.preferences.locale` (`src/app/shell/ZoneAdoption.tsx`), because the server writes some text itself - the day
  counter burnt into a film, exports - in the language the account was last used in.
- Counts use i18next plurals, `key_one` / `key_other`, called with `count`. German du-forms are the context `you`
  (`t(key, { context: 'you' })` finds `key_you`; English has none and falls back to the plain key). Apart from those
  `_you` keys both catalogues hold the same keys, and no test checks that beyond help topics and device messages: a
  key goes into both files, written by script in their own format
  ([development-workflow.md](development-workflow.md#worktrees-and-parallel-agents)).
- A key can be read where no literal names it, so grep for its prefix before deleting one as unread: keys built in
  a template (`` t(`home.entryKind.${kind}`) ``, `` `help.${topic}.title` ``, `` `units.${unit}` ``), the `message-*`
  keys, and the pause reasons below, compared rather than drawn.
- Never rename a `message-*` key: devices, the plan and the server store keys, not words. Change the words in both
  catalogues and every stored line reads the new way (as when "Recipe" became "Plan").
- A plan's pause reason is the exception: it is stored as words, in the language of whoever paused the plan
  (`plan.state.pauseReason`). The app recognises its own pauses by comparing them with `climateControl.pauseReason`
  (`screens/devices/switch-on.ts`) and `devices.lightOutput.pauseReason` (`LightOutputRow.tsx`) in the loaded
  catalogues - English and the active language - so rewording either string orphans the plans paused before it.
- `src/i18n/device-message.ts` resolves a stored `{ key, params }`: `<key>:<params>-title|text` first, then
  `<key>-title|text` with `{{value}}`, else the key as it came, so a key a newer firmware invents is readable.
  Alarm lines (`alarm-line.ts`) and settings changes (`configuration-change.ts`, which names a place by the device
  type the line carries where that type holds something else there) are reworded from their parameters;
  migrated machine lines without a key are split at their first blank line into headline and detail
  (`machineLineParts`); a person's own words are never translated.
- `test/device-message.test.ts` runs against the shipped catalogues and requires a title and a text in both
  languages for every key the firmware sends, so renaming a key fails CI instead of emptying diary lines.

## Figures

- A figure for a reader is written by `decimalFigure` / `looseFigure` (`src/ui/figures.ts`, `Intl.NumberFormat` in
  the app language, grouping off), a reading by `figure(value, metric)` / `targetFigure` (`figureWithUnit`,
  `targetWithUnit` with the unit) in `src/ui/units.ts`, which holds each metric's decimals and unit; `asWritten()`
  rounds a reading the way it is printed, so a verdict agrees with the figure beside it. A figure a reader typed is
  read back by `typedFigure` (`ui/figures.ts`), which takes either decimal mark.
- Machine output stays on `toFixed` and plain strings: CSV cells, SVG path coordinates, the `yyyy-MM-dd` a date
  field speaks, ids, firmware versions.
- `test/figures.test.ts` allows `.toFixed(` only in `ui/units.ts`, `ui/figures.ts` and the machine files
  (`charts/series.ts`, `screens/cockpit/MiniCurve.tsx`, `ui/days.ts`), and keeps the localisers out of the machine
  files.

## Help topics

The primitive and when to use it are in [app-ux.md](app-ux.md) §6. Mechanics: topics are listed in `HELP_TOPICS`
(`src/ui/explain.ts`), each a `help.<topic>` entry with `title` and `text` in both catalogues; an Erweitert item uses
`help.advanced.<name>` and needs no entry in the list. `test/help.test.tsx` fails on a topic without words in either
language and on words no topic opens.
