import type { DeviceConfiguration, OperatingMode, ProblemError } from '@fg2/shared-types/v1';
import { configurationFieldsOf, type ConfigurationField } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { unprocessable } from '@common/v1/problem';
import type { WriteIntent } from './work-modes';

/**
 * A change to named settings, checked against what the device's type offers
 * (`CONFIGURATION_FIELDS`) and turned into what is written: figures at their
 * place in the document, and what is said about the work mode, which the server
 * decides rather than writes as given.
 */

export interface FieldChanges {
  figures: [path: string, value: number | string][];
  intent: Extract<WriteIntent, { kind: 'fields' }>;
}

type Value = number | boolean | string;

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
      if (name === 'energySaving') changes.intent.energySaving = value as boolean;
      if (name === 'mode') changes.intent.mode = value as OperatingMode;
    } else {
      changes.figures.push([field!.path, typeof value === 'boolean' ? (value ? 1 : 0) : value]);
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
  }
};

const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The document with each figure put at its dotted place, every section on the way kept as it was. */
export const withFigures = (configuration: DeviceConfiguration, figures: FieldChanges['figures']): DeviceConfiguration =>
  figures.reduce<DeviceConfiguration>((document, [path, value]) => put(document, path.split('.'), value), configuration);

const put = (document: Record<string, unknown>, [key, ...rest]: string[], value: unknown): Record<string, unknown> => ({
  ...document,
  [key]: rest.length === 0 ? value : put(isSection(document[key]) ? document[key] : {}, rest, value),
});
