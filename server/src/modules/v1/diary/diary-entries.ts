import { FilterQuery, Model } from 'mongoose';
import type { Entry, EntryKind, EntryReading, GrowDayEvent, GrowReadingNames } from '@fg2/shared-types/v1';
import { entryKind } from '@fg2/shared-types/v1-schemas';
import { AccessRange, Grant, isOutsider } from '@common/v1/access.types';
import { serialiseEntry } from '@common/v1/entries';
import { Span, withinRange } from '@common/v1/range';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { CONFIGURATION_UPDATED, changeOf, linesOf } from '@modules/device-protocol/change-lines';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { demoEntry } from '@utils/demo';
import { Redaction } from '../grow/grow-serialiser';

/**
 * An entry as somebody other than its owner may read it.
 *
 * `access()` decides whether a timeline may be read at all and hands back how
 * much of it: whose privacy applies, and whether pictures of a camera are part
 * of the answer. This is what that comes to line by line, so that one read of
 * the diary cannot leak what the grow screen and the public page both hide.
 */
export const serialiseDiaryEntry = (entry: EntryDocument, hide: Redaction, grant: Pick<Grant, 'grantee' | 'includeCameras'>): Entry => {
  // The demo tour shows a stranger's tent to anybody, and a device's line
  // quotes the URLs it was configured with.
  const told = grant.grantee === 'demo' ? demoEntry(serialiseEntry(entry)) : serialiseEntry(entry);

  return {
    ...told,
    // Who wrote it is the account behind it. A page that names nobody - which is
    // every public page, and a tent somebody was sent a link to - says what was
    // done and leaves the person out, rather than handing over an id that has no
    // handle beside it to make sense of.
    authorId: hide.authors ? null : told.authorId,
    // And where it happened is the place behind it. A day of the diary that answers no
    // `deviceIds` and a report that answers no `spaceIds` would say nothing at
    // all if the lines under them named the tent and the controller anyway -
    // every phase line carries the space it was written in, and every line a
    // device wrote carries the device. A reader outside the tent is told what
    // happened rather than which corner of somebody's flat it happened in.
    spaceId: hide.authors ? null : told.spaceId,
    deviceId: hide.authors ? null : told.deviceId,
    // A list of plants is a count stated the long way round, and an empty one
    // already means "about whatever this is attached to" rather than about
    // single plants - which is what the grow serialiser answers a hidden scope
    // with too.
    plantIds: hide.counts ? [] : told.plantIds,
    // A link that was not made to carry pictures is not told which camera a line
    // was about; the pictures themselves are refused per picture, by the same
    // decision, where they are fetched.
    cameraId: grant.includeCameras ? told.cameraId : null,
    values: valuesOf(told.values, hide),
  };
};

/**
 * What is left of an entry's own values.
 *
 * The weights are the setting they are; the plant a reading is of is the count
 * stated one measurement at a time. A page that answers `plantCount: null` and
 * an empty `plantIds` and then names a real plant inside a reading hands the
 * count back to anybody willing to collect the distinct ids across a diary - so
 * a reading whose scope is hidden is a reading of whatever the line is about,
 * which is what a null `plantId` already means.
 */
const valuesOf = (values: Entry['values'], hide: Redaction): Entry['values'] => {
  // A line whose place is hidden does not spell the place out either.
  if (hide.authors && values.kind === 'move') return { kind: values.kind, placementId: values.placementId, spaceId: values.spaceId };

  const weighed = hide.weights && values.kind === 'harvest' ? { ...values, wetWeightG: null, dryWeightG: null } : values;

  return hide.counts && 'readings' in weighed ? { ...weighed, readings: weighed.readings.map(reading => ({ ...reading, plantId: null })) } : weighed;
};

/**
 * What a device and the plan engine write for themselves. They are entries like
 * any other and are kept like any other, but they are a machine's running
 * commentary rather than a record of the grow, so a day of the diary and a report
 * chapter leave them out and the Timeline reads them under a cap of their
 * own.
 */
export const MACHINE_KINDS: EntryKind[] = entryKind.options.filter(kind => kind === 'system' || kind === 'plan');

/**
 * What a day of the diary or a report chapter is about: everything somebody did to the
 * grow, and everything that happened to it, with a machine's bookkeeping left
 * out. The lines of the Timeline are deliberately not this list - a tent's
 * whole record is what it is scrubbed for.
 */
export const DIARY_KINDS = entryKind.options.filter(kind => !MACHINE_KINDS.includes(kind));

/**
 * When each of these grows was last written in, by its id.
 *
 * What a reader of a diary means by "updated" is that there is something new to
 * read, which is a line somebody wrote - not the moment the grow's own row was
 * last saved. The two are far apart: a diary write never touches the grow
 * document, so its `updatedAt` is whatever last changed the grow itself, and
 * after a migration that is the migration. A device's own lines are left out
 * for the same reason: an alarm every ten minutes would make every silent grow
 * look freshly written.
 */
export const diaryMovedAt = async (entries: Model<EntryDocument>, growIds: string[]): Promise<Map<string, Date>> => {
  if (growIds.length === 0) return new Map();

  const rows = await entries.aggregate<{ _id: string; at: Date }>([
    { $match: { growId: { $in: growIds }, source: 'human', kind: { $in: DIARY_KINDS } } },
    { $group: { _id: '$growId', at: { $max: '$occurredAt' } } },
  ]);

  return new Map(rows.map(row => [row._id, row.at]));
};

/**
 * What of a diary a reader from outside is answered - on a public page, through
 * a link onto a grow or onto a place: what people wrote, and nothing a device,
 * the plan or an alarm did. Not as a line, not as an id, not in a count: an
 * alarm tells a stranger when a tent stood unattended and which rule watches
 * it. A condition for the query rather than a filter over its answer, so the
 * pages, the nets and the counts are of what is served.
 */
export const writtenFor = (grant: Pick<Grant, 'grantee'>): FilterQuery<EntryDocument> => (isOutsider(grant) ? { source: 'human' } : {});

/**
 * The two lines a device writes when somebody puts it into maintenance, at the
 * device or from the app. They are a person's doing and are told as one
 * stretch (`maintenanceRuns`). Whatever else a device logs about itself - a
 * restart, a sensor drifting, a socket it lost - is its own record and stays
 * with the device and in Verlauf.
 */
const MAINTENANCE_LINES = ['message-maintenance-mode-activated', 'message-maintenance-mode-activated-remote'];

/**
 * The line a save writes where it switched a device's regulation off or on:
 * its work mode to `off` or from it ("workmode: small → off"), whoever saved
 * it - the app, a plan, the device's own menu. Like maintenance it is a
 * person's doing that leaves the tent to itself, and it is told as one
 * stretch (`controlOffRuns`); every other figure such a save moved stays with
 * the device.
 */
const CONTROL_LINES: FilterQuery<EntryDocument> = {
  kind: 'system',
  'message.key': CONFIGURATION_UPDATED,
  'message.params.0': { $regex: /^workmode: (off → .+|.+ → off)$/m },
};

/**
 * What a place's machines wrote that a diary tells all the same: the plan's
 * steps, which stand as the lines they are, maintenance going on and off and
 * regulation switched off and on.
 */
const MACHINE_LINES: FilterQuery<EntryDocument>[] = [{ kind: 'plan' }, { kind: 'system', 'message.key': { $in: MAINTENANCE_LINES } }, CONTROL_LINES];
export const TOLD_OF_MACHINES: FilterQuery<EntryDocument> = { $or: MACHINE_LINES };

/**
 * When the devices of a place were in maintenance, from the lines that say it
 * went on - for so many minutes - and off again. Every device of the place
 * writes its own, so runs that touch are one; a run nobody ended is over when
 * its minutes are.
 */
const maintenanceRuns = (lines: readonly EntryDocument[]): Span[] => {
  const runs: Span[] = [];
  let open = null as Span | null;

  for (const line of [...lines].sort((one, other) => one.occurredAt.getTime() - other.occurredAt.getTime())) {
    const minutes = Number(line.message?.params[0] ?? 0);
    if (open && line.occurredAt > open.endsAt) {
      runs.push(open);
      open = null;
    }
    if (minutes > 0) {
      const until = new Date(line.occurredAt.getTime() + minutes * 60_000);
      open = { startsAt: open?.startsAt ?? line.occurredAt, endsAt: open && open.endsAt > until ? open.endsAt : until };
    } else if (open) {
      runs.push({ startsAt: open.startsAt, endsAt: line.occurredAt });
      open = null;
    }
  }

  return open ? [...runs, open] : runs;
};

/** The end of a stretch nobody has ended yet: later than any day it is read against. */
export const STILL_RUNNING = new Date(8.64e15);

/** What a work-mode line says: switched off, switched on again, or neither. */
const switchedBy = (entry: EntryDocument): 'off' | 'on' | null => {
  if (entry.message?.key !== CONFIGURATION_UPDATED) return null;
  const mode = linesOf(entry.message.params[0])
    .map(changeOf)
    .find(change => change?.path === 'workmode');
  return mode?.after === 'off' && mode.before !== 'off' ? 'off' : mode?.before === 'off' && mode.after !== 'off' ? 'on' : null;
};

/**
 * When a device of the place had its regulation switched off, from the lines
 * that say it was and that it was switched on again: each device's own, and
 * stretches of several devices that overlap or touch are one. One nobody has
 * switched on again runs on (`STILL_RUNNING`); a switch on whose switch off
 * lies before what was read says nothing about how long it was.
 */
const controlOffRuns = (lines: readonly EntryDocument[]): Span[] => {
  const open = new Map<string, Date>();
  const runs: Span[] = [];

  for (const line of [...lines].sort((one, other) => one.occurredAt.getTime() - other.occurredAt.getTime())) {
    const switched = switchedBy(line);
    const device = line.deviceId ?? '';
    const since = open.get(device);
    if (switched === 'off' && !since) open.set(device, line.occurredAt);
    if (switched === 'on' && since) {
      runs.push({ startsAt: since, endsAt: line.occurredAt });
      open.delete(device);
    }
  }

  const all = [...runs, ...[...open.values()].map(startsAt => ({ startsAt, endsAt: STILL_RUNNING }))].sort(
    (one, other) => one.startsAt.getTime() - other.startsAt.getTime(),
  );
  return all.reduce<Span[]>((merged, run) => {
    const last = merged[merged.length - 1];
    if (last && run.startsAt <= last.endsAt) {
      merged[merged.length - 1] = { startsAt: last.startsAt, endsAt: run.endsAt > last.endsAt ? run.endsAt : last.endsAt };
      return merged;
    }
    return [...merged, run];
  }, []);
};

/**
 * Entries read by the diary's rules, as a diary tells them: the lines, newest
 * first, and when maintenance was on and regulation off - the two things of
 * them that are stretches and not lines.
 */
export const toldOf = (entries: readonly EntryDocument[]): { lines: EntryDocument[]; maintenance: Span[]; controlOff: Span[] } => {
  const system = entries.filter(entry => entry.kind === 'system');

  return {
    lines: entries
      .filter(entry => entry.kind !== 'system')
      .sort((one, other) => other.occurredAt.getTime() - one.occurredAt.getTime() || other.id.localeCompare(one.id)),
    maintenance: maintenanceRuns(system.filter(entry => entry.message?.key !== CONFIGURATION_UPDATED)),
    controlOff: controlOffRuns(system),
  };
};

/** A stretch as the day events of a diary carry it, up to `until`: still on where it runs past that. */
export const stretchEvent = (kind: 'maintenance' | 'controlOff', run: Span, until: Date): GrowDayEvent => ({
  kind,
  at: run.startsAt.toISOString(),
  endedAt: run.endsAt > until ? null : run.endsAt.toISOString(),
});

/** How many entries the tail reads for each line it answers: a maintenance is two lines of every device of the place. */
const READ_PER_LINE = 3;

/**
 * The newest of a diary, which is what "Zuletzt" on Start shows of a place and
 * of the grows standing in it (`about`): the same lines by the same rules as
 * a day of the grow's diary - what people wrote, the alarms, the plan's steps -
 * and maintenance and regulation switched off as the stretches they were. One
 * read, newest first.
 */
export const diaryTail = async (
  entries: Model<EntryDocument>,
  about: FilterQuery<EntryDocument>,
  grant: Pick<Grant, 'grantee'>,
  range: AccessRange,
  limit: number,
  now: Date,
): Promise<{ lines: EntryDocument[]; events: GrowDayEvent[] }> => {
  const told = toldOf(
    await entries
      .find({ $and: [about, { $or: [{ kind: { $in: DIARY_KINDS } }, ...MACHINE_LINES] }, withinRange('occurredAt', range), writtenFor(grant)] })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit * READ_PER_LINE)
      .lean<EntryDocument[]>(),
  );
  const lines = told.lines.slice(0, limit);
  // Where the lines fill the list, a maintenance from before the oldest of them is not among the newest either.
  const since = lines.length === limit ? lines[lines.length - 1].occurredAt : null;

  const newest = (run: Span) => since === null || run.startsAt >= since;

  return {
    lines,
    events: [
      ...told.maintenance.filter(newest).map(run => stretchEvent('maintenance', run, now)),
      ...told.controlOff.filter(newest).map(run => stretchEvent('controlOff', run, now)),
    ].sort((one, other) => other.at.localeCompare(one.at)),
  };
};

/** The kinds that carry readings of the grow's own measurements. */
export const READING_KINDS = ['water', 'feed', 'measurement'] as const;

/** The readings an entry carries, which only the kinds above do. */
export const readingsIn = (entry: Pick<EntryDocument, 'values'>): EntryReading[] => ('readings' in entry.values ? entry.values.readings : []);

/**
 * What each grow calls its own measurements, for the answers whose lines belong
 * to several grows at once.
 *
 * A reading names its measurement by key, and the definition of that key lives
 * on the grow, so a tent's latest lines and its Timeline would otherwise have
 * to be read grow by grow before a figure could be given a name and a unit -
 * and are drawn with the raw key instead. Only the wording travels: the band a
 * measurement is aimed at stays on the grow, because both answers are read
 * through share links as well.
 */
export const readingNamesOf = (grows: readonly Pick<GrowDocument, 'id' | 'measurements'>[]): GrowReadingNames[] =>
  grows.map(grow => ({
    growId: grow.id,
    readings: grow.measurements.map(measurement => ({ key: measurement.key, name: measurement.name, unit: measurement.unit })),
  }));
