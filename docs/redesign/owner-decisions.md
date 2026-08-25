# Owner decisions

Answers to §22 of [the specification](C51-spezifikation.md). Where a decision differs from what the spec
assumed, this file wins.

## Video codec — switch to libx264 everywhere, and delete the existing timelapses

`image.service.ts` encodes with `libx265`, which neither Chrome nor Firefox will play. The feature has
therefore been invisible to most of its audience since it shipped.

All rendering moves to `libx264` with `yuv420p` and `+faststart`. The existing files are **deleted rather
than re-encoded**, because they are derived data: the source frames are still stored, and the hourly
builder rebuilds each window on its next pass.

Two constraints on how that deletion is done, since it destroys rows:

- It runs as an explicit one-shot script, never at boot. A boot-time delete races two pm2 instances and
  runs again on every restart.
- It matches `format: 'mp4'` only. Stills and user photographs share the collection and must not be
  touched. The script reports what it will delete before deleting it.

## Photo storage — build the quota, keep the storage layer swappable

Photographs stay in MongoDB for now behind the 1 000-per-Zelt quota. Reads and writes go through one
storage interface with a single Mongo-backed implementation, so moving to object storage later is a new
implementation rather than a change to every call site. Object storage remains undecided; the quota is
what stops the bill growing in the meantime.

## Sign-up — unactivated accounts may write, with hard rate limits

An unactivated account can log in and start a diary immediately; the activation notice is one dismissible
row. The email round trip cost conversions the free tier cannot afford.

Because that opens a spam surface, it ships with limits rather than after them: per-IP account creation
limits and a cap on how many Zelte an unactivated account may create. An account that never activates
stays bounded.

## Device claiming — intentional, and to be left alone

`claimDevice` does not check whether a device already has an owner, and `getClaimCode` only demands a
password from devices that report `claimcode_auth`. **This is deliberate backward compatibility, not an
oversight.** Firmware old enough to predate the flag still has to be able to pair.

It has now been raised twice by review. The code says so at both sites, so the next reader — human or
otherwise — finds the reason where the behaviour is rather than re-reporting it.

## Flux interpolation — fix it in this work

`/data/series` and `/data/latest` interpolate `measure`, `from`, `to` and `interval` straight into the
query, and the `limit` guard sits after `yield()` where it bounds nothing. The specification had this as
later work; it moves into this change instead, since the redesign widens the vocabulary of measures these
endpoints accept and doing it afterwards means doing it under a larger surface.
