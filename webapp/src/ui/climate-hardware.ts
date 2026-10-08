import type { Device, DeviceConfiguration, OutputMetric } from '@fg2/shared-types/v1';
import { figureAt, workModeOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';

/**
 * Whether a climate could land anywhere in a tent, asked of the hardware in it:
 * the server writes a preset or a hand-set target only into the sections of a
 * device's document that state day and night figures, so counting devices is
 * not the answer. Every screen that offers a climate asks it here.
 */

/** One figure, nested or flat, as the server reads a setpoint out of the same document. */
export const figureOf = (configuration: DeviceConfiguration, section: string, field: string): number | null =>
  figureAt(configuration, `${section}.${field}`);

/**
 * Whether a document is one a climate could be written to. A plug, a fan or a
 * light states none of the day and night targets, and writing a temperature
 * into a socket's document would be a figure nobody reads.
 */
export const statesTargets = (configuration: DeviceConfiguration | null): boolean =>
  configuration !== null &&
  (['temperature', 'humidity'] as const).some(
    field => figureOf(configuration, 'day', field) !== null || figureOf(configuration, 'night', field) !== null,
  );

/**
 * The hardware whose document states a climate, by type: a device that has sent
 * nothing yet cannot be asked, and this tells a controller whose settings are on
 * their way from a plug that will never have any. An unknown type is believed
 * once its document arrives.
 */
export const HOLDS_A_CLIMATE = ['controller', 'fridge', 'fan'];

/**
 * A device that has never sent its document but whose kind says it will state a
 * climate: its next connection sends it (older firmware only on a change at its
 * own menu). Nothing is written meanwhile, because the firmware rebuilds its
 * settings from the document it is handed and would reset every key left out.
 */
export const awaitingClimate = (device: Device): boolean => device.configuration === null && HOLDS_A_CLIMATE.includes(device.type);

/**
 * Where a climate written for this device would land. `document`: its own
 * document states targets, and the merge keeps every other key. `awaited`: the
 * document has not arrived, so nothing can be written (see `awaitingClimate`).
 * `nowhere`: a plug or a lamp, whose `day` and `night` hold a schedule.
 */
export type ClimateLanding = 'document' | 'awaited' | 'nowhere';

export const climateLanding = (device: Device): ClimateLanding =>
  statesTargets(device.configuration) ? 'document' : awaitingClimate(device) ? 'awaited' : 'nowhere';

/**
 * Whether the device may have a CO2 sensor, without which the firmware zeroes the
 * CO2 target. Read as the server's `common/v1/sentinels.ts` reads it: only an
 * explicit `off` means none, while a missing key is firmware too old to say.
 */
export const hasCo2Sensor = (device: Device): boolean => device.state.hardware.co2 !== 'off';

/** The hardware fitted with a CO2 sensor beside its valve unless it says otherwise; a plug's sensor is an extra it has to announce. */
export const CO2_HOLDERS: readonly string[] = ['controller', 'fridge'];

/**
 * Why a device keeps its lamp dark whatever its window says, or null: switched
 * off, drying, or germinating in the dark. The window is then no promise, and
 * "08:00–20:00" over a dark fridge read as a lamp that had failed.
 */
type DarkReason = 'off' | 'drying' | 'germination';

export const darkReasonOf = (device: Device | null): DarkReason | null => {
  const control = device?.control;
  if (!control) return null;
  if (!control.running) return 'off';
  const mode = workModeOf(control);
  return mode === 'drying' || mode === 'germination' ? mode : null;
};

/** Whether a device germinates in the dark now. */
export const germinates = (device: Device | null): boolean => darkReasonOf(device) === 'germination';

/**
 * What an output is called on this kind of hardware: one name per machine
 * wherever it is met. A fridge module drives one compressor that both cools and
 * dries, on the output the firmware calls the dehumidifier, so on a fridge that
 * output is the compressor - on the cockpit, the charts, the Timeline, the
 * alarms and the maintenance sheet alike - and never an "Entfeuchter" the
 * cabinet does not have.
 */
export const outputWord = <O extends OutputMetric>(output: O, fridge: boolean): O | 'compressor' =>
  fridge && output === 'dehumidifier' ? 'compressor' : output;
