---
name: feeding-schemes
description: Re-create or update the feeding schemes the app ships as JSON assets from the manufacturers' current charts. Finds the published chart, reads it into the contract's week grid, bumps the asset's version and checks the result against the contract. Trigger via `/feeding-schemes [<scheme-id>|<manufacturer>]`, or whenever a shipped scheme is out of date or a new one is wanted.
---

# feeding-schemes

## Purpose

The app offers a new grow a feeding scheme to start from: `webapp/public/assets/schemes/`, one
`<id>.json` per scheme plus an `index.json` that lists them. They are assets rather than rows in the
database because the server never reads one - a grow stores the grid it was started with - so
shipping them is a matter of editing files in the webapp and nothing else.

A chart is a published document that changes. This skill is how the assets are brought back in line
with one, or a new scheme added.

## Argument handling

- `/feeding-schemes` → check every asset in the folder against the manufacturer's current chart.
- `/feeding-schemes <scheme-id>` → that one asset, e.g. `biobizz-light-mix`.
- `/feeding-schemes <manufacturer>` → add or update that manufacturer's schemes.

Adding a scheme nobody publishes is out of scope. Every figure in an asset has to be traceable to a
chart that can be linked to; a grid assembled from forum lore does not go in.

## Finding the chart

1. Look on the manufacturer's own site first - the schedules are usually a PDF under a downloads
   page (`biobizz.com`, `canna-uk.com`, `canna.com`). A retailer's copy is a last resort and is
   usually a scan of an older edition.
2. Prefer the current **English European** sheet. Regional editions of the same chart do differ; when
   two agree, say so in the asset's notes and link the one that was read.
3. The charts are drawings, not text, so `WebFetch` will not read one. Download it and look at it:

   ```sh
   curl -sSL -o chart.pdf "<url>"
   gs -q -dNOPAUSE -dBATCH -sDEVICE=png16m -r300 -sOutputFile=chart-%d.png chart.pdf
   ```

   Read the PNG with the Read tool. At 300 dpi a page is too large to take in at once - crop the
   table out of it before reading, and read the numbers off the crop rather than off the whole page.
   A misread digit is the one kind of mistake nothing downstream can catch.

## Reading a chart into the grid

The grid is `SchemeWeek[]` from the contract (`shared-types/src/v1/common.ts`), and the arithmetic
that reads it is `shared-types/src/v1/feeding.ts`. Both ends of the app go through that arithmetic,
so the grid has to suit it:

- **Weeks are the grow's own weeks**, counted from day 1, contiguous and starting at 1. A chart
  numbered from the flip has to be laid out against a vegetative period first, and `flipWeek` then
  says where its own week 1 begins.
- **A week's `stage`** is the botanical stage that week is in: `seedling` while it roots,
  `vegetative`, then `flowering` from the flip. It is what the sheet groups the grid by, and
  `flipWeek` is therefore the first week the grid calls `flowering` - a scheme whose flip falls
  anywhere else has the grow's feeding tab contradicting its own rows, and the test refuses it.
  When a chart's own light row and its bloom nutrient disagree about where the change is, believe
  the nutrient: the flip is the week the bloom feed starts.
- **Every product appears in every week**, with `value: null` where the chart prints no figure for
  it. Null is "not this week" and is what lets the sheet grey a row out rather than dose it at zero.
  A product that never appears at all is left out of the scheme entirely.
- **Figures are per litre.** `dosesFor` multiplies a value by the litres in the can whatever the unit
  says, so a chart printed in ml per 10 litres is divided by ten and the unit written as `ml/l`.
  That division is the only conversion allowed; the figure itself is copied as published. Units are
  `ml/l` or `g/l` - anything else, and the sheet draws a dose nobody can measure.
- **A printed range is taken at its middle**, and the asset's `notes` say so with the range in it.
- **A footnote that names a standard is not a range.** "20 ml standard, up to 40 for extra flowering
  power" is a standard of 20 with an option; ship the standard and write the footnote into the notes.
- **A period printed as a span of weeks** ("2 - 4 weeks") is laid out at the middle of its span,
  halves rounded up, and the notes say which length each period was given.
- **The EC target is carried, per week, as `ecTarget`.** It is the only figure of the grid that is
  not a dose: the scheme editor draws it as its own row and adds the grower's own water EC to it, so
  it is the chart's value on water of no EC that goes in - a chart that prints an "EC total" for an
  example tap water prints its EC+ as well, and EC+ is the one to take. Ranges are taken at the
  middle like any other figure, and a chart that publishes no EC states `null` in every week, which
  is what leaves the row undrawn. The pH target stays out: there is no row for it.
- **Leave out what is not part of the schedule**: a product the chart offers as a *replacement* for
  another (both rows would dose the can twice), and a supplement given only conditionally or as week
  ranges rather than per week.

## The files

`<id>.json` carries `id`, `name`, `manufacturer`, `version`, `plantTypes`, `defaultPlantType`,
`flipWeek`, `source { title, url, readAt }`, `notes` and `grid`. `index.json` repeats all of that
except `notes` and `grid`, and adds `weeks`; the reader derives a scheme's file name from its id, so
an asset the index does not name is not shipped.

- `name` is what the new-grow sheet puts on a chip, in the manufacturer's own spelling.
- `plantTypes` are the media or plant types this one grid is published for; `plantType` on a grow is
  one of their keys. **A column with different figures is a scheme of its own**, with its own id and
  its own file - never a second grid inside one asset.
- `notes` is prose for whoever reads the asset next: how the columns became weeks, which figure of a
  range was taken, what was deliberately left out. It is never shown on a screen, so it stays out of
  the catalogues and is written in English only.
- `productKey` is a stable `snake_case` key and `name` is the product as printed. A key that changes
  loses the thread between a grow's grid and the asset it came from.

Write the files with a small script rather than by hand - JSON with two-space indent, the unicode
kept as it is, and a trailing newline - and keep the script out of the repository.

## The version

`version` is the year and month of the chart the figures were read from, `2025-05`. The app prints
it as `v2025-05` beside a grow's scheme.

**A version is never edited in place.** A grow stores `origin.version` beside the grid it took, and
that is the whole point of it: a grow already running keeps the numbers it was started on, whatever
happens to the asset afterwards. So when a chart changes, change the figures *and* the version in
the same edit. If a mistake has to be corrected rather than a chart followed, bump the version too -
a grow that took the wrong figures is a grow somebody has been feeding, and rewriting its grid from
under it is worse than leaving it.

An id is never reused for a different scheme, and a scheme that a manufacturer withdraws is left in
place rather than deleted: grows point at it.

## Afterwards

From `webapp/`, each read on its own:

```sh
npx vitest run test/schemes.test.ts
npx tsc --noEmit -p tsconfig.json --pretty false 2>&1 | grep -c "error TS"   # must print 0
npm run lint
npm run build
```

`test/schemes.test.ts` is the check that matters: it parses every asset with the contract's own zod
schemas, holds the index against the assets, insists the weeks are contiguous and the units drawable,
and sends what the new-grow sheet would build through `GrowCreate`. It also holds a few figures of
each chart in place, so a grid edited by accident fails rather than ships - when a chart really has
changed, those expectations are updated with it and the commit says which chart said so.

Then look at it: start a grow on the scheme in the app and read the feed sheet for a week in the
middle and a week near the end, where a product has stopped.
