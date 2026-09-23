import type { Device, OutputMetric } from '@fg2/shared-types/v1';

/**
 * What a maintenance window actually does, on the hardware it is sent to.
 *
 * The cloud's half of it is the same for every device: the alarm engine skips
 * one that is being worked on, whatever kind of thing it is. The hardware's
 * half is not. Only the two types whose firmware carries a maintenance branch -
 * the tent controller and the fridge - park anything at all; a plug, a fan, a
 * lamp and a camera have empty command handlers, and `docs/device-protocol.md`
 * §8 says what becomes of an action a device does not know: it is dropped
 * without a word, with no reply of any kind to tell a caller apart from one
 * that worked.
 *
 * So the app spent a while promising a grower who was standing in front of a
 * fan that its heater, its dehumidifier and its CO2 valve were about to stop -
 * three things that fan does not have, in answer to an order it never reads.
 * Everything here exists so that the sentence over a device names that device.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The outputs a device stops driving while somebody is working on it, by type.
 *
 * Both types that honour the command pause the same three loops - the heater
 * PID, the dehumidifier and the CO2 valve all sit behind `isPaused()` - and
 * neither parks its light: that one is dimmed to a working brightness instead,
 * which is not a thing to warn anybody about. A type that is not named here
 * drops the command, and that is the honest answer for it rather than the
 * first entry of some default.
 */
const PARKED_BY: Record<string, OutputMetric[]> = {
  controller: ['heater', 'dehumidifier', 'co2'],
  fridge: ['heater', 'dehumidifier', 'co2'],
};

export const parkedOutputs = (device: Device): OutputMetric[] => PARKED_BY[device.type] ?? [];

/** Whether the hardware itself changes anything, or whether the quiet is the cloud's alone. */
export const parksAnything = (device: Device): boolean => parkedOutputs(device).length > 0;

/**
 * "the heater, the dehumidifier and the CO₂ valve": what this device will stop,
 * written to stand inside a sentence.
 *
 * The joining word comes from the catalogue rather than from `Intl.ListFormat`,
 * which writes English with the serial comma the rest of this app's prose does
 * not use, and which would make one sentence read differently from every other.
 *
 * The words are the maintenance catalogue's own too, because a German sentence
 * needs them in the case its verb governs and the chip labels elsewhere are not
 * written in it; anything the catalogue has no in-sentence form for falls back
 * to the name the alarm screen uses.
 */
export const parkedLabel = (t: Translate, device: Device): string => {
  const names = parkedOutputs(device).map(output =>
    t(`maintenance.output.${output}`, { defaultValue: t(`alarms.output.${output}`, { defaultValue: output }) }),
  );
  if (names.length < 2) return names[0] ?? '';

  return `${names.slice(0, -1).join(', ')} ${t('maintenance.and')} ${names[names.length - 1]}`;
};
