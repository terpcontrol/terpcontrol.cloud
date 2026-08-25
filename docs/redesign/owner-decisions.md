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

## Device claiming — unchanged for now

`claimDevice` still does not check whether a device already has an owner, so a claim code read off a
second-hand box takes it from its current owner. This is known and deliberately left alone; it is not
part of the redesign and should be fixed on its own schedule.
