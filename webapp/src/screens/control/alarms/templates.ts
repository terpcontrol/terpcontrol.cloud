import type { AlarmRule, AlarmRuleCreate, Device } from '@fg2/shared-types/v1';
import { statesTargets } from '@/ui/climate-hardware';
import { draftOf as targetsOf } from '../targets/targets-draft';
import { createBody, emptyDraft, readingsOf, type Translate } from './rules';

/**
 * The four alarms almost everybody with one tent wants, in their words: too
 * warm, too cold, too humid, too dry.
 *
 * Each is an ordinary rule on one reading with one edge, written in one tap
 * and changed afterwards like any other - the template decides nothing the
 * rule's own sheet could not undo. The line is worked out from the targets the
 * tent is holding, with the margins the stage presets use to tell a failure
 * from weather: five degrees over the warmer target, four under the cooler,
 * ten points of humidity over the higher target and twenty under the lower.
 * A device that has never stated targets is given the figures most tents are
 * safe inside.
 *
 * All four are critical, because a rule somebody asked for by name is one
 * they want to hear about, and critical is the severity the account's
 * notification grid sends on and quiet hours let through. Heat and cold are
 * said again every half hour while they last; humidity moves slowly and is
 * said once.
 */

export type TemplateKey = 'warm' | 'cold' | 'humid' | 'dry';

export interface AlarmTemplate {
  key: TemplateKey;
  metric: 'temperature' | 'humidity';
  edge: 'upper' | 'lower';
  value: number;
  forMinutes: number;
  repeatMinutes: number;
}

const FALLBACK: Record<TemplateKey, number> = { warm: 30, cold: 15, humid: 75, dry: 35 };

/** Humidity under this is not a line anybody sets for a plant, whatever the targets say. */
const DRIEST = 25;

const round = (value: number): number => Math.round(value * 10) / 10;

/** The templates this device can be watched by, with lines worked out from its targets. */
export const templatesFor = (device: Device): AlarmTemplate[] => {
  const readings = readingsOf(device);
  const targets = device.configuration && statesTargets(device.configuration) ? targetsOf(device.configuration) : null;
  const value = (key: TemplateKey, fromTargets: (held: NonNullable<typeof targets>) => number) =>
    targets ? round(fromTargets(targets)) : FALLBACK[key];

  const all: AlarmTemplate[] = [
    {
      key: 'warm',
      metric: 'temperature',
      edge: 'upper',
      value: value('warm', held => Math.max(held.dayTemperature, held.nightTemperature) + 5),
      forMinutes: 10,
      repeatMinutes: 30,
    },
    {
      key: 'cold',
      metric: 'temperature',
      edge: 'lower',
      value: value('cold', held => Math.min(held.dayTemperature, held.nightTemperature) - 4),
      forMinutes: 15,
      repeatMinutes: 30,
    },
    {
      key: 'humid',
      metric: 'humidity',
      edge: 'upper',
      value: value('humid', held => Math.min(95, Math.max(held.dayHumidity, held.nightHumidity) + 10)),
      forMinutes: 20,
      repeatMinutes: 0,
    },
    {
      key: 'dry',
      metric: 'humidity',
      edge: 'lower',
      value: value('dry', held => Math.max(DRIEST, Math.min(held.dayHumidity, held.nightHumidity) - 20)),
      forMinutes: 20,
      repeatMinutes: 0,
    },
  ];

  return all.filter(template => readings.includes(template.metric));
};

/**
 * The rule that already does what a template would: the same reading, watched
 * over the same edge, whoever wrote it - a stage's "too warm" is the grower's
 * "too warm" too. The cloud's offline rule watches no reading and is never one.
 */
export const ruleFor = (rules: AlarmRule[], template: AlarmTemplate): AlarmRule | null =>
  rules.find(
    rule => rule.origin !== 'always' && rule.watch.kind === 'reading' && rule.watch.metric === template.metric && rule.watch[template.edge] !== null,
  ) ?? null;

/** The rule a template writes, named in the reader's language as anything typed into the sheet would be. */
export const templateBody = (t: Translate, template: AlarmTemplate): AlarmRuleCreate =>
  createBody({
    ...emptyDraft({ kind: 'reading', metric: template.metric }),
    name: t(`alarms.template.${template.key}.name`),
    upper: template.edge === 'upper' ? String(template.value) : '',
    lower: template.edge === 'lower' ? String(template.value) : '',
    forMinutes: template.forMinutes,
    severity: 'critical',
    repeatMinutes: template.repeatMinutes,
  });
