import { logger } from '@utils/logger';
import { derivedId, planIdOf } from '../ids';
import { LEGACY, LegacyDevice, LegacyDeviceLog, createdAtOf, fromTable, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';
import { DeviceFacts, loadDeviceFacts } from '../device-facts';
import { GrowsByDevice, growAt, isLifecycleEntry, reconstructGrows } from '../grow-cycles';
import { readingsOf } from '../measurements';

/**
 * Every log line becomes an entry on the one timeline, told apart by `kind` and
 * `source` rather than by the second element of `categories`.
 *
 * What `categories` does not say outright, decided here:
 *
 * - **Who wrote it.** The app writes `['diary', <slug>]` and the plan engine
 *   writes the slug alone, which is the only thing that tells a stage somebody
 *   picked from one a plan step applied. That difference becomes `source:
 *   human` against `source: plan` on the phase the entry carries.
 * - **An entry with no categories at all** is read by its title, which is the
 *   same `message-<slug>` the app would have put in `categories`.
 * - **Anything that carries readings is a `measurement`**, whatever its slug
 *   said. A `note` has nowhere to keep numbers, and the CO2 refill sheet is a
 *   pair of readings under a name of its own.
 * - **`text` against `message`.** A value that is a `message-<key>[:<param>]`
 *   line is the device's own vocabulary and is parsed into `message`; anything
 *   else is what a person wrote and stays in `text`. Both the title and the body
 *   are read that way, so a free-form title is kept rather than dropped.
 * - **`severity`** is the number the old entry always carried: 0 is `info`, 1 is
 *   `warning`, anything above is `critical`.
 * - **A `plan` entry's step index** is the number the engine wrote into its own
 *   message, which is 1-based there; an entry whose message has none is the
 *   first step.
 *
 * **`deleted` says nothing about whether a line was deleted.** Deleting one
 * really removed the row, and the app sets the flag on every diary entry it
 * writes - so on a human line it marks "not interesting on the device card" and
 * carries no other information at all. Every row that is still in the collection
 * is therefore a line somebody kept, and every one of them is migrated; the flag
 * itself has nothing to carry into a model whose diary is filtered by kind.
 *
 * **Two device lines are thinned**, and they are the only ones. A controller
 * that cannot read its external sensor says so on every cycle, and the same for
 * one whose two sensors disagree - which is not a diary of anything, it is one
 * fault repeated until somebody fixes it. They are the great majority of the
 * collection, they say nothing a hundred of them do not, and carrying them makes
 * the timeline of every affected tent unreadable as well as slow. So the newest
 * hundred per device are kept for each of the two and the rest are left behind,
 * counted per device and in total, and named in the log - the firmware stops
 * repeating them at the same time.
 */

const SEVERITY = ['info', 'warning', 'critical'];

/** The diary slugs the app writes, and what each one is about. */
const DIARY_KIND: Record<string, string> = {
  'diary-plant-log': 'note',
  'diary-fridge-log': 'note',
  'diary-measurement': 'measurement',
  'diary-co2-refill': 'measurement',
};

const STAGES = ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing'];

/** The two lines a controller repeats until the fault behind them is fixed. */
const REPEATED = ['message-ext-sensor-fail', 'message-ext-sensor-deviate'];

/** How many of each a device keeps: enough to see when it started and how often, and no diary of it. */
const KEEP_NEWEST = 100;

export const entries: MigrationStep = {
  name: '011-entries',
  moves: [LEGACY.devices, LEGACY.deviceLogs],

  async run(context: MigrationContext): Promise<void> {
    const facts = await loadDeviceFacts(context);
    const grows = await reconstructGrows(context, facts);
    const devicesWithPlans = await planned(context);
    const thinned = await thinRepeatedLines(context);
    const legacy = await context.source(LEGACY.deviceLogs);

    for await (const log of legacy.find<LegacyDeviceLog>({}).sort({ _id: 1 })) {
      context.count('entries.read');

      // Left behind before anything else is asked of it: an older repeat is not
      // carried over at all, whatever it names.
      if (thinned.leftBehind(log)) {
        context.count('entries.repeatedLeftBehind');
        continue;
      }

      const deviceId = textOf(log.device_id);
      const fact = deviceId ? facts.get(deviceId) : undefined;
      const occurredAt = log.time instanceof Date ? log.time : null;

      if (!deviceId || !fact || !occurredAt) {
        context.reject({
          source: LEGACY.deviceLogs,
          id: String(log._id),
          reason: !occurredAt ? 'the entry has no time' : 'the entry names a device that is not in the database',
          dropped: true,
          detail: deviceId,
        });
        continue;
      }

      await migrateEntry(context, log, fact, grows, devicesWithPlans, occurredAt);
    }
  },
};

const migrateEntry = async (
  context: MigrationContext,
  log: LegacyDeviceLog,
  fact: DeviceFacts,
  grows: GrowsByDevice,
  devicesWithPlans: Set<string>,
  occurredAt: Date,
): Promise<void> => {
  const slugs = slugsOf(log);
  const source = sourceOf(slugs);
  const readings = readingsOf(log.data);
  const grow = growAt(grows.get(fact.id), occurredAt);
  const kind = kindOf(slugs, log, readings.length > 0, devicesWithPlans.has(fact.id), grow !== null);

  // A phase line already says what it is in `values.stage`, so the heading the
  // old app put on it is dropped: the title of a lifecycle line was written by
  // that app and never by the grower - it is either the key or its English
  // rendering, the same sentence for every stage - while what somebody typed
  // went into the body. Keeping it would put "Plant phase change" in front of
  // the stage on every migrated phase row, in every language.
  const said = kind === 'phase' ? [freeText(log.message)] : [freeText(log.title), freeText(log.message)];
  const message = kind === 'phase' ? null : (messageOf(log.message) ?? messageOf(log.title));
  const text = said.filter(part => part !== null).join('\n\n');

  await context.write('entries', {
    id: derivedId('entry', String(log._id)),
    createdAt: createdAtOf(log),
    kind,
    occurredAt,
    source,
    authorId: source === 'human' ? fact.ownerId : null,
    growId: grow?.id ?? null,
    spaceId: fact.spaceId,
    deviceId: fact.id,
    plantIds: [],
    // Nothing on an old log line names a camera, but a controller answered for
    // exactly one, so what the camera pipeline wrote is about that one.
    cameraId: slugs.includes('webcam') ? fact.cameraId : null,
    taskId: null,
    alertId: null,
    severity: SEVERITY[Math.min(Math.max(log.severity ?? 0, 0), SEVERITY.length - 1)],
    text: text.length > 0 ? text : null,
    message,
    values: valuesOf(kind, log, fact, readings),
    mediaIds: log.images ?? [],
    undoUntil: null,
  });
};

/** What the entry says about itself: its categories, or its title where a client saved none. */
const slugsOf = (log: LegacyDeviceLog): string[] => {
  const categories = (log.categories ?? []).filter(category => category.length > 0);
  if (categories.length > 0) return categories;

  const title = textOf(log.title);
  return title?.startsWith('message-') ? [title.slice('message-'.length)] : [];
};

const sourceOf = (slugs: string[]): string => {
  if (slugs.includes('alarm')) return 'alarm';
  if (slugs.includes('recipe')) return 'plan';
  if (slugs.includes('diary') || slugs.some(slug => fromTable(DIARY_KIND, slug) !== undefined)) return 'human';
  // A lifecycle entry without the app's `diary` beside it was written by the
  // plan engine as it moved the device into a step's stage.
  return slugs.some(slug => slug.endsWith('plant-lifecycle')) ? 'plan' : 'device';
};

/**
 * A `phase` entry names the phase it wrote, and a `plan` entry names the plan it
 * is about, so neither kind survives without the thing it points at: a lifecycle
 * entry outside any reconstructed grow, and a plan line on a device whose plan
 * had no steps, keep their words as a plain entry instead.
 */
const kindOf = (slugs: string[], log: LegacyDeviceLog, hasReadings: boolean, hasPlan: boolean, hasGrow: boolean): string => {
  if (slugs.includes('alarm')) return 'alarm';
  if (slugs.includes('recipe')) return hasPlan ? 'plan' : 'system';
  if (hasGrow && isLifecycleEntry(log) && STAGES.includes(textOf(log.data?.newLifecycleStage as string | undefined) ?? '')) return 'phase';
  if (hasReadings) return 'measurement';

  const diary = slugs.map(slug => fromTable(DIARY_KIND, slug)).find(candidate => candidate !== undefined);
  return diary ?? (slugs.includes('diary') ? 'note' : 'system');
};

const valuesOf = (
  kind: string,
  log: LegacyDeviceLog,
  fact: DeviceFacts,
  readings: { key: string; value: number; plantId: null }[],
): Record<string, unknown> => {
  switch (kind) {
    case 'phase':
      return {
        kind,
        // The phase this entry became, which the grow reconstruction derived
        // from the same `_id`.
        phaseId: derivedId('phase', String(log._id)),
        stage: textOf(log.data?.newLifecycleStage as string | undefined),
        preset: null,
      };
    case 'plan':
      return { kind, planId: planIdOf(fact.id), stepIndex: stepIndexOf(log.message), transition: null };
    case 'measurement':
      return { kind, readings };
    default:
      return { kind };
  }
};

/** The engine writes the step number into its own message, counted from one. */
const stepIndexOf = (message: string | undefined): number => {
  const parameter = messageOf(message)?.params[0];
  const number = parameter ? Number.parseInt(parameter, 10) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number - 1 : 0;
};

/** A `message-<key>[:<param>]` line, parsed once. The colon splits the key from the whole of the rest. */
const messageOf = (value: string | undefined): { key: string; params: string[] } | null => {
  const text = textOf(value);
  if (!text?.startsWith('message-')) return null;

  const separator = text.indexOf(':');
  return separator < 0 ? { key: text, params: [] } : { key: text.slice(0, separator), params: [text.slice(separator + 1)] };
};

/** Whatever is not one of the device's message keys is what a person wrote. */
const freeText = (value: string | undefined): string | null => {
  const text = textOf(value);
  return text === null || text.startsWith('message-') ? null : text;
};

/**
 * Which repeated sensor line a log entry is, by the same rule the transform
 * reads its message by: the message where it is one of the device's own keys,
 * and the title where a client saved none.
 */
const repeatedKeyOf = (log: LegacyDeviceLog): string | null => {
  const message = textOf(log.message);
  const key = (message?.startsWith('message-') ? message : textOf(log.title))?.split(':')[0] ?? null;
  return key !== null && REPEATED.includes(key) ? key : null;
};

/**
 * The newest hundred of each repeated line per device, and what that leaves
 * behind.
 *
 * Counted and chosen in one aggregation rather than by reading the rows here:
 * these are most of the collection, and the answer is a few ids per device
 * either way. `time` descending is what "newest" means, with `_id` behind it so
 * that two lines written in the same millisecond are ordered the same way on
 * every run - a repeated run has to keep the same hundred.
 */
const thinRepeatedLines = async (context: MigrationContext): Promise<{ leftBehind: (log: LegacyDeviceLog) => boolean }> => {
  const logs = await context.source(LEGACY.deviceLogs);
  const looksLike = new RegExp(`^\\s*(${REPEATED.join('|')})(:|$)`, 'u');

  // The message the transform would read, derived in the pipeline the same way
  // `repeatedKeyOf` derives it, so the rows chosen here are exactly the rows
  // recognised below.
  const spoken = { $trim: { input: { $ifNull: ['$message', ''] } } };
  const raw = { $cond: [{ $eq: [{ $indexOfCP: [spoken, 'message-'] }, 0] }, spoken, { $trim: { input: { $ifNull: ['$title', ''] } } }] };

  const groups = await logs
    .aggregate<{ _id: { deviceId: string | null; key: string }; keep: unknown[]; total: number }>(
      [
        { $match: { $or: [{ message: looksLike }, { title: looksLike }] } },
        { $set: { repeatedKey: { $arrayElemAt: [{ $split: [raw, ':'] }, 0] } } },
        { $match: { repeatedKey: { $in: REPEATED } } },
        {
          $group: {
            _id: { deviceId: '$device_id', key: '$repeatedKey' },
            keep: { $topN: { n: KEEP_NEWEST, sortBy: { time: -1, _id: -1 }, output: '$_id' } },
            total: { $sum: 1 },
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const keep = new Set<string>();
  const perDevice = new Map<string, number>();
  let total = 0;

  for (const group of groups) {
    for (const id of group.keep) keep.add(String(id));

    const left = group.total - group.keep.length;
    if (left === 0) continue;

    const deviceId = textOf(group._id.deviceId) ?? '(no device)';
    perDevice.set(deviceId, (perDevice.get(deviceId) ?? 0) + left);
    total += left;
  }

  if (total > 0) {
    const where = [...perDevice].sort((left, right) => right[1] - left[1]);
    logger.info(
      `Migration 011-entries: leaving ${total} repeated sensor line(s) behind on ${where.length} device(s), ` +
        `keeping the newest ${KEEP_NEWEST} of ${REPEATED.join(' and ')} each`,
    );
    for (const [deviceId, left] of where) logger.info(`Migration 011-entries:   ${deviceId}: ${left} left behind`);
  }

  return { leftBehind: log => repeatedKeyOf(log) !== null && !keep.has(String(log._id)) };
};

const planned = async (context: MigrationContext): Promise<Set<string>> => {
  const devices = await context.source(LEGACY.devices);
  const withPlans = await devices.find<LegacyDevice>({ 'recipe.steps.0': { $exists: true } }, { projection: { device_id: 1 } }).toArray();
  return new Set(withPlans.map(device => textOf(device.device_id)).filter((id): id is string => id !== null));
};
