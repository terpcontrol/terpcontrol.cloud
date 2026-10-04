import type { DeviceConfiguration, PlanStep } from '@fg2/shared-types/v1';
import { cycleOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { withHeldWindow } from '@modules/device-protocol/class-rules';
import { withWindowAsHours } from '@modules/v1/plan/plan-steps';
import { targetsOf } from '@modules/v1/phase/phase-targets';
import { derivedId } from '../ids';
import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';
const PLANS = 'plans';
const PLAN_TEMPLATES = 'planTemplates';
const TARGET_CHANGES = 'targetChanges';

/** The hardware whose light schedule the firmware runs day and night by. */
const WITH_SCHEDULE = ['fridge', 'controller'];

/** The work modes a plan step may name that run no day at all, so its light window says nothing. */
const DARK_MODES = ['dry', 'breed', 'off'];

type Row = { id?: unknown; type?: unknown; configuration?: unknown };
type WithSteps = { id?: unknown; steps?: unknown };

const isDocument = (value: unknown): value is DeviceConfiguration => typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (one: unknown, other: unknown): boolean => JSON.stringify(one) === JSON.stringify(other);

/**
 * Puts the light schedules the server stored before it worked them out in one
 * place (`day-night.ts`) into the shape it writes them in now.
 *
 * - **Devices.** A fridge's or a controller's light that went off at midnight
 *   UTC on the dot goes off a second before it, which keeps its evening ramp;
 *   24 hours of light written one second short of a day becomes a day that
 *   never ends, which loses the daily half-hour dip the firmware made of it.
 *   The device is sent the new document the next time it asks for one, as it
 *   always is.
 * - **Plan steps and templates.** The old app copied its whole document into
 *   every step of a recipe, the two times of day included, and a running plan
 *   re-sends its step every hour - so a grower who moved the light-on time under
 *   the targets had it put back within the hour, by a step whose editor showed
 *   no time at all. A step's window becomes the hours it means (`lightHours`).
 *   The hour the light comes on is kept only where the recipe really sets it:
 *   where its steps that run a day do not all switch the light on at the same
 *   time. A recipe that kept one hour throughout only ever carried the hour its
 *   author's device happened to have, and leaves the hour to the grower now.
 *   A step that runs no day - drying, germination, switched off - loses the
 *   window and names no hours: its light schedule did nothing.
 * - **The target record.** Every fridge and controller is given a row with the
 *   cycle it runs now, so its nights are drawn from the schedule from this
 *   instant on; what came before is drawn from the lamp, as it always was.
 *
 * Reads the new collections and moves nothing aside. A row that already says
 * what this writes is left alone, so a repeated run writes nothing.
 */
export const lightWindows: MigrationStep = {
  name: '021-light-windows',

  async run(context: MigrationContext): Promise<void> {
    const devices = context.db.collection<Row>(DEVICES).find({ type: { $in: WITH_SCHEDULE } }, { projection: { id: 1, type: 1, configuration: 1 } });
    for await (const device of devices) {
      if (typeof device.id !== 'string' || typeof device.type !== 'string' || !isDocument(device.configuration)) continue;

      const held = withHeldWindow(device.configuration);
      if (!same(held, device.configuration)) {
        context.count('devices.windowHeld');
        await context.write(DEVICES, { id: device.id, configuration: held });
      }
      await recordCycle(context, device.id, device.type, held);
    }

    for (const [collection, counter] of [
      [PLANS, 'plans.windowsAsHours'],
      [PLAN_TEMPLATES, 'planTemplates.windowsAsHours'],
    ] as const) {
      for await (const row of context.db.collection<WithSteps>(collection).find({}, { projection: { id: 1, steps: 1 } })) {
        const steps = asHours(row.steps);
        if (typeof row.id !== 'string' || steps === null) continue;
        context.count(counter);
        await context.write(collection, { id: row.id, steps });
      }
    }

    await context.flushAll();
  },
};

/** A row with the cycle a device runs now, unless its newest row already says so. */
const recordCycle = async (context: MigrationContext, deviceId: string, type: string, configuration: DeviceConfiguration): Promise<void> => {
  const cycle = cycleOf(type, configuration);
  const targets = targetsOf(configuration);
  const [newest] = await context.db.collection(TARGET_CHANGES).find({ deviceId }).sort({ at: -1, _id: -1 }).limit(1).toArray();
  if (!cycle || (newest && same(newest.cycle ?? null, cycle) && same(newest.targets ?? null, targets))) return;

  context.count('targetChanges.cycleRecorded');
  await context.write(TARGET_CHANGES, { id: derivedId('targetCycle', deviceId), deviceId, at: context.at, targets, cycle });
};

const windowOf = (step: PlanStep): { day: number; night: number } | null => {
  const daynight = isDocument(step.settings) && isDocument(step.settings.daynight) ? step.settings.daynight : null;
  return daynight && typeof daynight.day === 'number' && typeof daynight.night === 'number' ? { day: daynight.day, night: daynight.night } : null;
};

/** Whether a step runs no day at all, so the light window it carries does nothing while it runs. */
const runsNoDay = (step: PlanStep): boolean =>
  step.stage === 'drying' || (isDocument(step.settings) && typeof step.settings.workmode === 'string' && DARK_MODES.includes(step.settings.workmode));

/** The steps with their light windows as hours, or null where none carried one. */
const asHours = (steps: unknown): PlanStep[] | null => {
  if (!Array.isArray(steps)) return null;

  const all = steps as PlanStep[];
  const lit = all.filter(step => windowOf(step) !== null && !runsNoDay(step));
  const setsTime = new Set(lit.map(step => windowOf(step)!.day)).size > 1;

  const next = all.map(step => {
    if (windowOf(step) === null) return step;
    if (!runsNoDay(step)) return withWindowAsHours({ ...step, lightHours: step.lightHours ?? null }, setsTime);

    const { day: _day, night: _night, ...rest } = step.settings.daynight as Record<string, unknown>;
    const { daynight: _old, ...others } = step.settings;
    return { ...step, settings: Object.keys(rest).length > 0 ? { ...others, daynight: rest } : others };
  });
  return same(next, steps) ? null : next;
};
