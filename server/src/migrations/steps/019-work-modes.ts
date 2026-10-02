import type { DeviceConfiguration, PlanStep } from '@fg2/shared-types/v1';
import { heldTo, stepSettingsHeld } from '@modules/device-protocol/class-rules';
import { baseFromUpload, hasWorkModes } from '@modules/device-protocol/work-modes';
import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';
const PLANS = 'plans';
const PLAN_TEMPLATES = 'planTemplates';

type Row = { id?: unknown; type?: unknown; configuration?: unknown; baseWorkmode?: unknown };
type WithSteps = { id?: unknown; deviceId?: unknown; steps?: unknown };

const isDocument = (value: unknown): value is DeviceConfiguration => typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (one: unknown, other: unknown): boolean => JSON.stringify(one) === JSON.stringify(other);

/**
 * Puts what the server now decides about a fridge's and a controller's work
 * into the documents it stored before it decided it.
 *
 * - Every device row gets the work mode it goes back to (`baseWorkmode`): the
 *   one it runs, where that is its own mode, and none where it is off or drying
 *   - which is read as the standard. A fridge on `full` keeps it, and that is
 *   its energy-saving switch on.
 * - A fridge's document is held to what the server holds it to on every write
 *   from now on: the dehumidifier tuned from its day humidity, the day and
 *   night gliding into each other, no CO2 while the light goes down, and a
 *   compressor that rests at least four minutes.
 * - A plan step loses the `small` or `full` the old app copied into it, and a
 *   fridge's step the figures the server now writes itself, because a running
 *   plan re-sends its step every hour and would put each of them back.
 *   Templates are cleared the same way; one is started on either kind of
 *   hardware, and a controller keeps its own tuning either way.
 *
 * Reads the new collections and moves nothing aside. A row that already says
 * what this writes is left alone, so a repeated run writes nothing.
 */
export const workModes: MigrationStep = {
  name: '019-work-modes',

  async run(context: MigrationContext): Promise<void> {
    const types = new Map<string, string>();
    const devices = context.db.collection<Row>(DEVICES).find({}, { projection: { id: 1, type: 1, configuration: 1, baseWorkmode: 1 } });

    for await (const device of devices) {
      if (typeof device.id !== 'string' || typeof device.type !== 'string') continue;
      types.set(device.id, device.type);

      const configuration = isDocument(device.configuration) ? device.configuration : null;
      const held = configuration ? heldTo(device.type, configuration) : null;
      const base = configuration && hasWorkModes(device.type) ? baseFromUpload(device.type, configuration) : null;
      const changed = held !== null && !same(held, configuration);
      if (!changed && device.baseWorkmode !== undefined && (base === null || device.baseWorkmode === base)) continue;

      if (changed) context.count('devices.heldTo');
      await context.write(DEVICES, { id: device.id, baseWorkmode: base ?? device.baseWorkmode ?? null, ...(changed ? { configuration: held } : {}) });
    }

    const plans = context.db.collection<WithSteps>(PLANS).find({}, { projection: { id: 1, deviceId: 1, steps: 1 } });
    for await (const plan of plans) {
      const steps = cleared(plan.steps, types.get(String(plan.deviceId)) === 'fridge');
      if (typeof plan.id !== 'string' || steps === null) continue;
      context.count('plans.stepsCleared');
      await context.write(PLANS, { id: plan.id, steps });
    }

    const templates = context.db.collection<WithSteps>(PLAN_TEMPLATES).find({}, { projection: { id: 1, steps: 1 } });
    for await (const template of templates) {
      const steps = cleared(template.steps, true);
      if (typeof template.id !== 'string' || steps === null) continue;
      context.count('planTemplates.stepsCleared');
      await context.write(PLAN_TEMPLATES, { id: template.id, steps });
    }

    await context.flushAll();
  },
};

/** The steps with their settings cleared, or null where none of them carried anything to clear. */
const cleared = (steps: unknown, fridge: boolean): PlanStep[] | null => {
  if (!Array.isArray(steps)) return null;

  const next = (steps as PlanStep[]).map(step => (isDocument(step.settings) ? { ...step, settings: stepSettingsHeld(step.settings, fridge) } : step));
  return same(next, steps) ? null : next;
};
