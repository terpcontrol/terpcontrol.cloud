import type { PlanStep } from '@fg2/shared-types/v1';
import { MigrationContext, MigrationStep } from '../migration';

const PLANS = 'plans';
const PLAN_TEMPLATES = 'planTemplates';
const GROWS = 'grows';
const ENTRIES = 'entries';

type WithSteps = { id?: unknown; deviceId?: unknown; steps?: unknown };
type StoredPhase = { id?: unknown; stage?: unknown; source?: unknown; deviceId?: unknown };
type GrowRow = { id?: unknown; phases?: unknown };

const isDocument = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A step that germinates in the dark of its own accord: the old app's recipes could carry the firmware's mode in their settings. */
const germinatesInTheDark = (step: PlanStep): boolean => isDocument(step.settings) && step.settings.workmode === 'breed';

/**
 * Gives "germination" the one meaning it has from now on: seeds germinating in
 * the dark, the firmware's `breed` mode. Until now the stage wrote the seedling
 * climate with eighteen hours of light, and the dark mode was a switch of its
 * own under the fridge's Erweitert. What was stored under the old meaning and
 * ran the light becomes what it really was, the seedling stage, so that no
 * device goes dark because a word changed:
 *
 * - A plan step or a template step in germination becomes a seedling step,
 *   unless it carries the dark mode itself - that one was germination in the
 *   dark all along. A running plan sends its step again every hour, and a
 *   germination step now switches the light off.
 * - A grow's germination phase that a climate preset or a plan step wrote
 *   becomes a seedling phase, and the diary line that announced it says so: the
 *   place ran the seedling climate with light meanwhile. A plan's phase stays
 *   germination where that device's plan germinates in the dark. A phase a
 *   person entered without a climate is the record of seeds sprouting, wrote
 *   nothing to any device and keeps its name.
 *
 * Reads the new collections and moves nothing aside. A row already in the new
 * shape is left alone, so a repeated run writes nothing.
 */
export const darkGermination: MigrationStep = {
  name: '022-dark-germination',

  async run(context: MigrationContext): Promise<void> {
    // Read before any step is renamed: the devices whose plan germinates in the dark.
    const dark = new Set<string>();

    for (const [collection, counter] of [
      [PLANS, 'plans.germinationAsSeedling'],
      [PLAN_TEMPLATES, 'planTemplates.germinationAsSeedling'],
    ] as const) {
      for await (const row of context.db
        .collection<WithSteps>(collection)
        .find({ 'steps.stage': 'germination' }, { projection: { id: 1, deviceId: 1, steps: 1 } })) {
        if (!Array.isArray(row.steps) || typeof row.id !== 'string') continue;
        const steps = row.steps as PlanStep[];
        if (typeof row.deviceId === 'string' && steps.some(step => step.stage === 'germination' && germinatesInTheDark(step))) dark.add(row.deviceId);

        const renamed = seedlingSteps(steps);
        if (renamed === null) continue;
        context.count(counter);
        await context.write(collection, { id: row.id, steps: renamed });
      }
    }

    for await (const grow of context.db.collection<GrowRow>(GROWS).find({ 'phases.stage': 'germination' }, { projection: { id: 1, phases: 1 } })) {
      if (typeof grow.id !== 'string' || !Array.isArray(grow.phases)) continue;

      const moved: string[] = [];
      const phases = (grow.phases as StoredPhase[]).map(phase => {
        if (!ranTheLight(phase, dark)) return phase;
        if (typeof phase.id === 'string') moved.push(phase.id);
        return { ...phase, stage: 'seedling' };
      });
      if (moved.length === 0) continue;

      context.count('grows.germinationAsSeedling', moved.length);
      await context.write(GROWS, { id: grow.id, phases });

      const lines = context.db
        .collection(ENTRIES)
        .find({ growId: grow.id, kind: 'phase', 'values.phaseId': { $in: moved } }, { projection: { id: 1 } });
      for await (const line of lines) {
        if (typeof line.id !== 'string') continue;
        context.count('entries.germinationAsSeedling');
        await context.write(ENTRIES, { id: line.id, 'values.stage': 'seedling' });
      }
    }

    await context.flushAll();
  },
};

/** The steps with every germination that ran the light named a seedling step, or null where none did. */
const seedlingSteps = (steps: PlanStep[]): PlanStep[] | null => {
  const lit = (step: PlanStep) => step.stage === 'germination' && !germinatesInTheDark(step);
  return steps.some(lit) ? steps.map(step => (lit(step) ? { ...step, stage: 'seedling' } : step)) : null;
};

/** Whether a germination phase put a device on the seedling climate: a preset's always did, a plan's unless its plan germinates in the dark. */
const ranTheLight = (phase: StoredPhase, dark: ReadonlySet<string>): boolean => {
  if (phase.stage !== 'germination') return false;
  if (phase.source === 'preset') return true;
  return phase.source === 'plan' && !(typeof phase.deviceId === 'string' && dark.has(phase.deviceId));
};
