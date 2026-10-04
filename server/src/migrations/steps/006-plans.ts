import { derivedId, planIdOf } from '../ids';
import { LEGACY, LegacyDevice, LegacyRecipeStep, createdAtOf, flagOf, fromTable, instantOf, numberOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';

/**
 * The running plan leaves the device document and becomes a resource of its own,
 * one per device that has steps.
 *
 * What the old shape does not say, decided here:
 *
 * - **A plan has no name today.** It takes the device's, because that is the
 *   only thing the screen ever called it by; a device with no name falls back to
 *   its id.
 * - **`additionalInfo` becomes `notify.writeEntries`.** It is the flag that
 *   decided whether the engine wrote a diary line as it advanced, which is
 *   exactly what `writeEntries` now means.
 * - **`state.confirmationNotifiedAt` was a boolean.** `notified` said that the
 *   step had asked for its confirmation, without saying when; the instant it
 *   asked is taken to be when it last applied its settings, and failing that
 *   when the step started. A step that never asked keeps `null`.
 * - **The two per-step flags on inactive steps are dropped**, because the engine
 *   resets them on every step change and they say nothing about a step that is
 *   not running.
 *
 * A step's settings are a fragment of the device's configuration document and
 * are stored as a string on some rows and as an object on others. A string that
 * parses becomes the object; one that does not becomes an empty fragment, which
 * is a step that changes nothing, and the original goes into the reject report.
 */

const NOTIFY_MODE: Record<string, string> = { off: 'off', onStep: 'on_step', onConfirmation: 'on_confirmation' };

const DURATION_UNITS = ['minutes', 'hours', 'days', 'weeks'];

const STAGES = ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing'];

export const plans: MigrationStep = {
  name: '006-plans',
  moves: [LEGACY.devices],

  async run(context: MigrationContext): Promise<void> {
    const legacy = await context.source(LEGACY.devices);

    for await (const device of legacy.find<LegacyDevice>({ 'recipe.steps.0': { $exists: true } }).sort({ _id: 1 })) {
      const deviceId = textOf(device.device_id);
      const recipe = device.recipe;
      if (!deviceId || !recipe?.steps) continue;

      context.count('plans.read');

      const activeSince = instantOf(recipe.activeSince);
      const activeIndex = Math.min(Math.max(numberOf(recipe.activeStepIndex) ?? 0, 0), recipe.steps.length - 1);
      const activeStep = recipe.steps[activeIndex];
      const lastAppliedAt = instantOf(activeStep?.lastTimeApplied);

      await context.write('plans', {
        id: planIdOf(deviceId),
        createdAt: createdAtOf(device),
        deviceId,
        templateId: null,
        name: textOf(device.name) ?? deviceId,
        steps: recipe.steps.map((step, index) => planStep(context, deviceId, step, index)),
        loop: flagOf(recipe.loop),
        notify: {
          mode: fromTable(NOTIFY_MODE, textOf(recipe.notifications)) ?? 'off',
          email: textOf(recipe.email),
          writeEntries: flagOf(recipe.additionalInfo),
        },
        state: {
          // `activeSince` is the whole of what the old shape says about whether a
          // plan is running: a finished or never-started one keeps its steps and
          // zeroes it.
          status: activeSince ? 'running' : 'stopped',
          activeStepIndex: activeSince ? activeIndex : 0,
          stepStartedAt: activeSince,
          pausedElapsedMs: 0,
          pauseReason: null,
          lastAppliedAt: activeSince ? lastAppliedAt : null,
          confirmationNotifiedAt: activeSince && flagOf(activeStep?.notified) ? (lastAppliedAt ?? activeSince) : null,
          // The routing grid is newer than any of these plans, so nobody has
          // been asked on it yet: a plan arriving mid-wait is asked about on the
          // first pass after the migration.
          confirmationAskedAt: null,
          confirmationAskTriedAt: null,
        },
      });
    }
  },
};

export const planStep = (context: MigrationContext, owner: string, step: LegacyRecipeStep, index: number): Record<string, unknown> => {
  const stage = textOf(step.stage);
  const unit = textOf(step.durationUnit);

  return {
    // The step's own id, stable across edits, so a running step survives another
    // being inserted above it. Derived from where it sits, which is all the old
    // shape has.
    id: derivedId('planStep', owner, index),
    name: textOf(step.name) ?? `Step ${index + 1}`,
    stage: stage && STAGES.includes(stage) ? stage : null,
    preset: null,
    duration: { value: numberOf(step.duration) ?? 0, unit: unit && DURATION_UNITS.includes(unit) ? unit : 'days' },
    settings: settingsOf(context, owner, index, step.settings),
    waitForConfirmation: flagOf(step.waitForConfirmation),
    confirmationMessage: textOf(step.confirmationMessage),
  };
};

const settingsOf = (context: MigrationContext, owner: string, index: number, settings: LegacyRecipeStep['settings']): Record<string, unknown> => {
  if (settings !== null && typeof settings === 'object') return settings as Record<string, unknown>;

  const text = textOf(settings);
  if (!text) return {};

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Falls through to the reject below.
  }

  context.reject({
    source: LEGACY.devices,
    id: `${owner}#step${index}`,
    reason: 'the step settings are not a JSON object; the step is migrated as one that changes nothing',
    dropped: false,
    detail: text,
  });
  return {};
};
