import { logger } from '@utils/logger';
import { derivedId, growIdOf } from './ids';
import { LEGACY, LegacyDevice, LegacyDeviceLog, textOf } from './legacy';
import { MigrationContext } from './migration';
import { DeviceFacts } from './device-facts';

/**
 * The grows the old database never stored, read back out of the lifecycle
 * entries that did get stored.
 *
 * The rule is the one the grow report draws with today
 * (`webapp/.../grow-report.component.ts`): a cycle runs until a lifecycle entry
 * goes back in stage order or names a different plant, and the entries in
 * between are its phases. It is restated here rather than shared, because the
 * webapp's copy goes with the Angular app and this one describes what the old
 * data meant.
 *
 * Three migrations need the same answer - the grows themselves, the entries that
 * have to name the grow they happened in, and the photos that reach their grow
 * through an entry - so it is computed the same way in all three instead of read
 * back out of what was written. That is also what lets a dry run resolve a grow
 * it never wrote.
 */

/** The six stages, in the order a grow runs through them. Going back is what ends a cycle. */
const STAGE_ORDER = ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing'];

/** Both category slugs a lifecycle entry has been written under. */
const LIFECYCLE_CATEGORIES = ['diary-plant-lifecycle', 'plant-lifecycle'];

export interface ReconstructedPhase {
  id: string;
  stage: string;
  startedAt: Date;
  /** `human` for what somebody logged, `plan` for what the plan engine wrote when a step carried a stage. */
  source: 'human' | 'plan';
}

export interface ReconstructedGrow {
  id: string;
  deviceId: string;
  name: string;
  startedAt: Date;
  /** Where the next cycle began; null while the grow is the running one. */
  endedAt: Date | null;
  phases: ReconstructedPhase[];
}

export type GrowsByDevice = Map<string, ReconstructedGrow[]>;

/**
 * `report` is the one migration that writes the grows saying so: the other two
 * ask the same question only to resolve a grow they point at, and a rejection
 * counted three times would say three things went wrong where one did.
 */
export const reconstructGrows = async (
  context: MigrationContext,
  facts: Map<string, DeviceFacts>,
  { report = false }: { report?: boolean } = {},
): Promise<GrowsByDevice> => {
  const byDevice: GrowsByDevice = new Map();

  for (const [deviceId, entries] of await lifecycleEntries(context)) {
    // A grow belongs to somebody, and a device nobody has ever claimed has
    // nobody to give one to.
    if (!facts.get(deviceId)?.ownerId) continue;
    const cycles = cyclesOf(deviceId, entries);
    if (cycles.length > 0) byDevice.set(deviceId, cycles);
  }

  for (const grow of await planGrows(context, facts, byDevice, report)) {
    byDevice.set(grow.deviceId, [grow]);
  }

  return byDevice;
};

/** Which grow a moment on a device falls into, for an entry or a picture that has to name one. */
export const growAt = (grows: ReconstructedGrow[] | undefined, when: Date): ReconstructedGrow | null =>
  grows?.find(grow => when >= grow.startedAt && (grow.endedAt === null || when < grow.endedAt)) ?? null;

const lifecycleEntries = async (context: MigrationContext): Promise<Map<string, LegacyDeviceLog[]>> => {
  const logs = await context.source(LEGACY.deviceLogs);
  const byDevice = new Map<string, LegacyDeviceLog[]>();

  // Deleted entries included, because that is what the grow report reads: what
  // `deleted` meant on a lifecycle entry was never "this stage did not happen".
  const cursor = logs.find<LegacyDeviceLog>({ categories: { $in: LIFECYCLE_CATEGORIES } }).sort({ time: 1 });
  for await (const log of cursor) {
    const deviceId = textOf(log.device_id);
    if (!deviceId || !(log.time instanceof Date)) continue;
    byDevice.set(deviceId, [...(byDevice.get(deviceId) ?? []), log]);
  }

  return byDevice;
};

const cyclesOf = (deviceId: string, entries: LegacyDeviceLog[]): ReconstructedGrow[] => {
  const cycles: ReconstructedGrow[] = [];
  let previousOrder: number | undefined;
  let current: ReconstructedGrow | null = null;

  for (const entry of entries) {
    const stage = textOf(entry.data?.newLifecycleStage as string | undefined);
    const order = stage ? STAGE_ORDER.indexOf(stage) : -1;
    if (!stage || order < 0) continue;

    const at = entry.time as Date;
    const name = textOf(entry.data?.lifecycleName as string | undefined);
    const renamed = current !== null && current.name.length > 0 && name !== null && name !== current.name;
    const wentBack = previousOrder !== undefined && order < previousOrder;

    if (current === null || renamed || wentBack) {
      if (current) current.endedAt = at;
      current = { id: growIdOf(deviceId, at.getTime()), deviceId, name: name ?? '', startedAt: at, endedAt: null, phases: [] };
      cycles.push(current);
    }

    if (current.name.length === 0 && name !== null) current.name = name;

    // Every lifecycle entry is a phase, not only the last one of its stage: the
    // day counter and the timeline are read off `phases[]`, and a stage logged
    // twice happened twice.
    current.phases.push({ id: derivedId('phase', String(entry._id)), stage, startedAt: at, source: 'human' });
    previousOrder = order;
  }

  return cycles.map((cycle, index) => (cycle.name.length > 0 ? cycle : { ...cycle, name: `My Strain ${index + 1}` }));
};

/**
 * A device running a plan and never logged into a stage still has a grow - the
 * plan is the only record that something is growing there - so it becomes one
 * that starts with the step that is running.
 *
 * A plan whose steps carry no stage at all says nothing about what is growing,
 * so it becomes nothing. That is counted rather than rejected, because it is a
 * decision this transform makes rather than a row it cannot read: no stage is
 * the ordinary shape of a plan - only the guided onboarding's reference plans
 * ever wrote one, and the expert plan editor never has - so a refusal here is a
 * boot that stops on the normal case, with no fix an operator could make short
 * of asserting a stage nobody chose. The device, its space, its plan and its
 * diary all migrate; what it does not get is a grow, which is exactly what it
 * had before the upgrade: the old app wrote a lifecycle entry only for a step
 * that carried a stage, so these plans ran for years and produced no grow at
 * all. The first climate preset applied to that space offers to start one.
 */
const planGrows = async (
  context: MigrationContext,
  facts: Map<string, DeviceFacts>,
  already: GrowsByDevice,
  report: boolean,
): Promise<ReconstructedGrow[]> => {
  const devices = await context.source(LEGACY.devices);
  const grows: ReconstructedGrow[] = [];
  const withoutStage: string[] = [];

  const cursor = devices.find<LegacyDevice>({ 'recipe.activeSince': { $gt: 0 } });
  for await (const device of cursor) {
    const deviceId = textOf(device.device_id);
    const fact = deviceId ? facts.get(deviceId) : undefined;
    if (!deviceId || !fact || already.has(deviceId) || fact.ownerId === null) continue;

    const startedAt = new Date(device.recipe?.activeSince as number);
    const steps = device.recipe?.steps ?? [];
    const activeIndex = Math.min(Math.max(device.recipe?.activeStepIndex ?? 0, 0), Math.max(steps.length - 1, 0));
    // The running step's stage, or the nearest one before it that has one: a
    // plan whose later steps left the stage out is still in the last one set.
    const stage = steps
      .slice(0, activeIndex + 1)
      .reverse()
      .map(step => textOf(step.stage))
      .find(candidate => candidate !== null && STAGE_ORDER.includes(candidate));

    if (!stage) {
      if (report) {
        context.count('grows.planWithoutStage');
        withoutStage.push(deviceId);
      }
      continue;
    }

    grows.push({
      id: growIdOf(deviceId, startedAt.getTime()),
      deviceId,
      name: fact.name ?? deviceId,
      startedAt,
      endedAt: null,
      phases: [{ id: derivedId('phase', deviceId, startedAt.getTime()), stage, startedAt, source: 'plan' }],
    });
  }

  // Named rather than counted alone: the number goes into the step's record, and
  // which devices it was about is the thing somebody reading that record later
  // would otherwise have to work out again.
  if (withoutStage.length > 0) {
    logger.info(`Migration 010-grows: no grow for ${withoutStage.length} device(s) whose running plan carries no stage: ${withoutStage.join(', ')}`);
  }

  return grows;
};

/** A stable, readable address for a grow that never had one. Unique per grow, because the id is. */
export const slugOf = (grow: ReconstructedGrow): string => {
  const words = grow.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return `${words.length > 0 ? words.slice(0, 40) : 'grow'}-${grow.id.slice(0, 8)}`;
};

/** Whether one log line is a lifecycle entry, for the migration that walks every line. */
export const isLifecycleEntry = (log: LegacyDeviceLog): boolean => (log.categories ?? []).some(category => LIFECYCLE_CATEGORIES.includes(category));
