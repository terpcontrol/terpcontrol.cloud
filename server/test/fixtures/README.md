# Fixtures

`legacy-database.ts` builds a whole database in the shapes this server writes **today**: every collection, the
GridFS bucket the pictures live in, and one document for each case a transform has to answer for — an unclaimed
device, a configuration that is not JSON, a running plan and a stopped one, a triggered alarm, a picture whose
bytes are still in its own document, two plan templates with one name. It is what the migration test seeds before
it runs the migrations and asserts what came out; `seedLegacyDatabase` returns the ids and counts it wrote, so a
spec asserts against the handle rather than reading the fixture again.

Nothing here reads the clock or invents an id: the caller passes the instant the fixture is dated against, and
every id says what it is, so two runs produce the same database and a failing assertion names a document a reader
can find.

## The rule

**This file describes the old shapes, so it is never updated to follow the new model.** It is the input side of
the migration, and a fixture that drifts towards the target asserts nothing. When a legacy shape changes here —
because a legacy shape is found that was missed, or because one is corrected — the migration under test changes
with it. A new field of the new model never appears in this file at all.
