import type { AlarmRule, AlarmRuleCreate, Device, OutputMetric } from '@fg2/shared-types/v1';
import { CRITICAL_REPEAT_SECONDS } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { statesTargets } from '@/ui/climate-hardware';
import { draftOf as targetsOf } from '../targets/targets-draft';
import { createBody, emptyDraft, outputsOf, readingsOf, type Translate } from './rules';

/**
 * The alarms almost everybody with one tent wants, in their words: too warm,
 * too cold, too humid, too dry - and, where the hardware has the part, that the
 * CO2 cylinder has run empty and that a fridge's compressor has not stopped.
 *
 * Each is an ordinary rule with one edge, written in one tap and changed
 * afterwards like any other - the template decides nothing the rule's own
 * sheet could not undo. The climate lines are worked out from the targets the
 * tent is holding, with the margins the stage presets use to tell a failure
 * from weather: five degrees over the warmer target, four under the cooler,
 * ten points of humidity over the higher target and twenty under the lower.
 * A device that has never stated targets is given the figures most tents are
 * safe inside.
 *
 * CO2 under 350 ppm is below outdoor air: with a cylinder dosing, the cylinder
 * is empty. A compressor that runs half an hour without a pause means a door
 * that is open, a seal that has gone or a cabinet too small for its lamp; the
 * firmware rests it between dehumidifying runs, so a run that long is cooling
 * that cannot catch up.
 *
 * All of them are critical, because a rule somebody asked for by name is one
 * they want to hear about, and critical is the severity the account's
 * notification grid sends on and quiet hours let through. Heat and cold are
 * said again every half hour while they last; the rest move slowly or are
 * fixed by a visit, and are said once.
 */

export type TemplateKey = 'warm' | 'cold' | 'humid' | 'dry' | 'co2Empty' | 'running';

type TemplateWatch =
  | { kind: 'reading'; metric: 'temperature' | 'humidity' | 'co2'; edge: 'upper' | 'lower'; value: number }
  | { kind: 'output_running'; output: OutputMetric };

export interface AlarmTemplate {
  key: TemplateKey;
  watch: TemplateWatch;
  forMinutes: number;
  repeatMinutes: number;
}

const FALLBACK: Record<'warm' | 'cold' | 'humid' | 'dry', number> = { warm: 30, cold: 15, humid: 75, dry: 35 };

/** Humidity under this is not a line anybody sets for a plant, whatever the targets say. */
const DRIEST = 25;

/** Below outdoor air, which only a sealed tent with an empty cylinder ever reads. */
const CO2_EMPTY_PPM = 350;

const round = (value: number): number => Math.round(value * 10) / 10;

/** The templates this device can be watched by, with lines worked out from its targets. */
export const templatesFor = (device: Device): AlarmTemplate[] => {
  const readings = readingsOf(device);
  const targets = device.configuration && statesTargets(device.configuration) ? targetsOf(device.configuration) : null;
  const value = (key: keyof typeof FALLBACK, fromTargets: (held: NonNullable<typeof targets>) => number) =>
    targets ? round(fromTargets(targets)) : FALLBACK[key];
  const reading = (metric: 'temperature' | 'humidity' | 'co2', edge: 'upper' | 'lower', at: number): TemplateWatch => ({
    kind: 'reading',
    metric,
    edge,
    value: at,
  });

  const all: AlarmTemplate[] = [
    {
      key: 'warm',
      watch: reading(
        'temperature',
        'upper',
        value('warm', held => Math.max(held.dayTemperature, held.nightTemperature) + 5),
      ),
      forMinutes: 10,
      repeatMinutes: CRITICAL_REPEAT_SECONDS / 60,
    },
    {
      key: 'cold',
      watch: reading(
        'temperature',
        'lower',
        value('cold', held => Math.min(held.dayTemperature, held.nightTemperature) - 4),
      ),
      forMinutes: 15,
      repeatMinutes: CRITICAL_REPEAT_SECONDS / 60,
    },
    {
      key: 'humid',
      watch: reading(
        'humidity',
        'upper',
        value('humid', held => Math.min(95, Math.max(held.dayHumidity, held.nightHumidity) + 10)),
      ),
      forMinutes: 20,
      repeatMinutes: 0,
    },
    {
      key: 'dry',
      watch: reading(
        'humidity',
        'lower',
        value('dry', held => Math.max(DRIEST, Math.min(held.dayHumidity, held.nightHumidity) - 20)),
      ),
      forMinutes: 20,
      repeatMinutes: 0,
    },
    { key: 'co2Empty', watch: reading('co2', 'lower', CO2_EMPTY_PPM), forMinutes: 10, repeatMinutes: 0 },
    { key: 'running', watch: { kind: 'output_running', output: 'dehumidifier' }, forMinutes: 30, repeatMinutes: 0 },
  ];

  return all.filter(({ key, watch }) =>
    watch.kind === 'reading'
      ? readings.includes(watch.metric)
      : // The compressor's run is a fridge's: a controller's dehumidifier is a room machine on a socket that may well run for hours.
        key === 'running' && device.type === 'fridge' && outputsOf(device).includes(watch.output),
  );
};

/**
 * The rule that already does what a template would: the same reading watched
 * over the same edge, or the same output watched for running, whoever wrote it
 * - a stage's "too warm" is the grower's "too warm" too. The cloud's offline
 * rule watches no reading and is never one.
 */
export const ruleFor = (rules: AlarmRule[], template: AlarmTemplate): AlarmRule | null => {
  const { watch } = template;

  return (
    rules.find(rule =>
      rule.origin === 'always'
        ? false
        : watch.kind === 'reading'
          ? rule.watch.kind === 'reading' && rule.watch.metric === watch.metric && rule.watch[watch.edge] !== null
          : rule.watch.kind === 'output_running' && rule.watch.output === watch.output,
    ) ?? null
  );
};

/** The rule a template writes, named in the reader's language as anything typed into the sheet would be. */
export const templateBody = (t: Translate, template: AlarmTemplate): AlarmRuleCreate => {
  const { watch } = template;

  return createBody({
    ...emptyDraft(watch.kind === 'reading' ? { kind: 'reading', metric: watch.metric } : { kind: 'output_running', output: watch.output }),
    name: t(`alarms.template.${template.key}.name`),
    upper: watch.kind === 'reading' && watch.edge === 'upper' ? String(watch.value) : '',
    lower: watch.kind === 'reading' && watch.edge === 'lower' ? String(watch.value) : '',
    forMinutes: template.forMinutes,
    severity: 'critical',
    repeatMinutes: template.repeatMinutes,
  });
};
