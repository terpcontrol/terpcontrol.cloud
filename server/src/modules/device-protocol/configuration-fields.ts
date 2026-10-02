import type { DeviceConfiguration, OperatingMode, ProblemError } from '@fg2/shared-types/v1';
import {
  configurationFieldsOf,
  type ConfigurationField,
  type FieldSetting,
  type TimerWindow,
} from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { unprocessable } from '@common/v1/problem';
import type { WriteIntent } from './work-modes';

/**
 * A change to named settings, checked against what the device's type offers
 * (`CONFIGURATION_FIELDS`) and turned into what is written: figures at their
 * place in the document, and what is said about the work mode, which the server
 * decides rather than writes as given.
 */

export interface FieldChanges {
  figures: [path: string, value: number | string | TimerWindow[]][];
  intent: Extract<WriteIntent, { kind: 'fields' }>;
}

type Value = FieldSetting;

/** Every value that does not fit is named at once, so a form learns all of what it has to correct in one answer. */
export const fieldChangesOf = (type: string, set: Record<string, Value>): FieldChanges => {
  const fields = configurationFieldsOf(type);
  const errors: ProblemError[] = [];
  const changes: FieldChanges = { figures: [], intent: { kind: 'fields' } };

  for (const [name, value] of Object.entries(set)) {
    const field: ConfigurationField | undefined = fields[name];
    const refused = field ? refusalOf(field, value) : `A ${type} has no setting called ${name}.`;
    if (refused) {
      errors.push({ field: `set.${name}`, code: field ? 'out_of_range' : 'unknown_field', detail: refused });
      continue;
    }

    if (field!.path === null) {
      if (name === 'control') changes.intent.control = value as boolean;
      if (name === 'drying') changes.intent.drying = value as boolean;
      if (name === 'energySaving') changes.intent.energySaving = value as boolean;
      if (name === 'mode') changes.intent.mode = value as OperatingMode;
    } else {
      changes.figures.push([field!.path, stored(field!, value)]);
    }
  }

  if (Object.keys(set).length === 0) errors.push({ field: 'set', code: 'required', detail: 'Name at least one setting to change.' });
  if (errors.length > 0) throw unprocessable('setting_refused', 'A setting could not be changed as asked.', errors);

  return changes;
};

const refusalOf = (field: ConfigurationField, value: Value): string | null => {
  switch (field.kind) {
    case 'switch':
      return typeof value === 'boolean' ? null : 'This setting is on or off: true or false.';
    case 'choice':
      return typeof value === 'string' && field.options.includes(value) ? null : `This setting is one of ${field.options.join(', ')}.`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max
        ? null
        : `This setting is a number from ${field.min} to ${field.max}.`;
    case 'windows':
      return Array.isArray(value) && value.length <= field.most && value.every(window => fitsWindow(window, field.longest))
        ? null
        : `This setting is a list of at most ${field.most} windows, each starting at a second of the day and running from 1 to ${field.longest} minutes.`;
  }
};

const DAY_SECONDS = 24 * 60 * 60;

const fitsWindow = (window: TimerWindow, longest: number): boolean =>
  Number.isInteger(window.ontime) &&
  window.ontime >= 0 &&
  window.ontime < DAY_SECONDS &&
  Number.isInteger(window.duration) &&
  window.duration >= 1 &&
  window.duration <= longest;

/**
 * A value as the document keeps it: a switch as 1 or 0, which the firmware
 * reads as true and false; a choice by its code where the firmware keeps one;
 * a list of windows as fresh objects of the two keys the firmware reads.
 */
const stored = (field: ConfigurationField, value: Value): number | string | TimerWindow[] => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return value.map(({ ontime, duration }) => ({ ontime, duration }));
  if (field.kind === 'choice' && field.codes) return field.codes[field.options.indexOf(value as string)];

  return value as number | string;
};

const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The document with each figure put at its dotted place, every section on the way kept as it was. */
export const withFigures = (configuration: DeviceConfiguration, figures: FieldChanges['figures']): DeviceConfiguration =>
  figures.reduce<DeviceConfiguration>((document, [path, value]) => put(document, path.split('.'), value), configuration);

const put = (document: Record<string, unknown>, [key, ...rest]: string[], value: unknown): Record<string, unknown> => ({
  ...document,
  [key]: rest.length === 0 ? value : put(isSection(document[key]) ? document[key] : {}, rest, value),
});
