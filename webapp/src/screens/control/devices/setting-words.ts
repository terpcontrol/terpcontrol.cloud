import type { Device } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { fieldValue, heldSetting, type FieldValue } from '@/ui/advanced/field-values';
import { decimalFigure, unbroken } from '@/ui/figures';
import { fieldOf, type PendingItem } from '../climate/figures';
import type { Settings } from '../climate/saved';

/**
 * How a setting is said - on its line, in its toast and in the note on what
 * the device has not been handed - so the three never differ.
 */

/** "15 Min", "28,0 °C": a figure with its unit, as its line and its toast write it. */
export const figureSaid =
  (unit: string, decimals = 0) =>
  (value: FieldValue): string =>
    typeof value === 'number' ? unbroken(`${decimalFigure(value, decimals)} ${unit}`.trim()) : '';

/** "an" or "aus", as a switch is read and as its toast says it. */
export const onOff = (t: Translate, on: FieldValue | boolean): string => t(`climateControl.state.${on === true ? 'on' : 'off'}`);

/**
 * What a block's device has not been handed, for the block's note: each
 * setting by the name its line carries, what is stored and - where the cloud
 * knows it - what the device still holds, both written as the line writes them.
 */
export const pendingOf = (
  device: Device,
  settings: Settings,
  said: readonly { name: string; label: string; say: (value: FieldValue) => string }[],
): PendingItem[] =>
  said.flatMap(({ name, label, say }) => {
    const held = settings.held(name);
    const field = fieldOf(device, name);
    if (!held || !field) return [];
    const stored = fieldValue(device, name);
    const before = heldSetting(field, held.held);

    return [
      {
        name: label,
        value: stored === null ? '' : say(stored),
        held: before === null ? null : say(before),
        savedAt: held.savedAt,
        one: field.kind !== 'number',
      },
    ];
  });
