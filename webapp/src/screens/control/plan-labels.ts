import type { DeviceConfiguration, GrowthStage, StepDuration } from '@fg2/shared-types/v1';
import { stepLightHours, stepLightsOn } from './plan-edit';
import { hoursWritten } from './targets/schedule-words';
import { wallClock } from './targets/targets-draft';

/**
 * What a step says about itself in one line, wherever it is drawn.
 *
 * The plan screen and the editor show the same list twice - once as what the
 * tent is going through and once as what is being written - and a step that
 * read differently in the two would be two steps. So the line is written here
 * and nowhere else.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The words a length is written in - "3 wk", "10 d" - or what a step with no length really is. */
export const durationLabel = (t: Translate, duration: StepDuration): string =>
  duration.value > 0 ? t(`space.control.unit.${duration.unit}`, { count: duration.value }) : t('space.control.openEnded');

/** The facts of a step that its line is made of, which a saved step and one being written both have. */
export interface StepFacts {
  stage: GrowthStage | null;
  preset: string | null;
  duration: StepDuration;
  settings: Record<string, unknown>;
  lightHours?: number | null;
  waitForConfirmation: boolean;
}

/**
 * "Flower · late flower · 3 wk · 12 h light · waits for you". A step that writes
 * nothing says so, because a step that only marks time is a deliberate thing to
 * write and would otherwise look like one whose figures had been forgotten. A
 * step that brings its own light-on time - a recipe from the old app - says
 * from when, on the account's clock (`offset` seconds ahead of UTC), where
 * that is known: it moves the light every hour it runs.
 */
export const stepMeta = (t: Translate, step: StepFacts, offset: number | null = null): string => {
  const settings = step.settings as DeviceConfiguration;
  const hours = stepLightHours({ settings, lightHours: step.lightHours ?? null });
  const own = stepLightsOn(settings);
  return [
    step.stage ? t(`home.stage.${step.stage}`) : t('space.control.noStage'),
    step.preset ? t(`grow.presetName.${step.preset}`, { defaultValue: step.preset }) : null,
    durationLabel(t, step.duration),
    hours !== null
      ? own !== null && offset !== null
        ? t('planLight.shortFrom', { hours: hoursWritten(hours), time: wallClock(own, offset) })
        : t('planLight.short', { hours: hoursWritten(hours) })
      : null,
    step.waitForConfirmation ? t('space.control.waits') : null,
    Object.keys(step.settings).length === 0 && step.lightHours == null ? t('space.control.step.writesNothingShort') : null,
  ]
    .filter(Boolean)
    .join(' · ');
};
