import type { Device } from '@fg2/shared-types/v1';
import { configurationFieldsOf, type TimerWindow } from '@fg2/shared-types/v1-schemas/configuration-fields.js';

export type FieldValue = number | boolean | string | TimerWindow[];

const valueAt = (configuration: Device['configuration'], path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | null | undefined)?.[key], configuration);

/**
 * The value a setting has now. The four that make up the work mode are read
 * from what the server says the device is doing, never from the firmware's word
 * for it; a switch the firmware keeps as 1 or 0 reads as on or off.
 */
export const fieldValue = (device: Device, name: string): FieldValue | null => {
  const field = configurationFieldsOf(device.type)[name];
  if (!field) return null;
  if (field.path === null) {
    const control = device.control;
    if (!control) return null;
    if (name === 'control') return control.running;
    if (name === 'drying') return control.drying;
    return name === 'energySaving' ? control.energySaving : name === 'mode' ? control.mode : null;
  }

  const value = valueAt(device.configuration, field.path);
  if (field.kind === 'switch') return typeof value === 'number' ? value > 0 : typeof value === 'boolean' ? value : null;
  if (field.kind === 'windows') return Array.isArray(value) ? value.filter(isWindow).map(({ ontime, duration }) => ({ ontime, duration })) : null;
  // A choice the firmware keeps as a number is read back as the word for it.
  if (field.kind === 'choice' && field.codes) return typeof value === 'number' ? (field.options[field.codes.indexOf(value)] ?? null) : null;
  return typeof value === 'number' || typeof value === 'string' ? value : null;
};

const isWindow = (value: unknown): value is TimerWindow =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as TimerWindow).ontime === 'number' &&
  typeof (value as TimerWindow).duration === 'number';
