import type { Device, DeviceConfiguration, OutputMetric } from '@fg2/shared-types/v1';
import { figureAt, workModeOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';

/**
 * Whether a climate could land anywhere in a tent, asked of the hardware
 * standing in it.
 *
 * The server writes a preset or a hand-set target into a device's own
 * configuration document, and only into the sections of it that state day and
 * night figures. Counting devices therefore answers a different question from
 * the one every screen wants: a tent holding one plug holds one device and
 * nowhere for a temperature to go. This lives beside the other things the whole
 * app needs to know about a reading rather than inside the Control tab, because
 * the tent Overview asks it before offering a preset and the Manual targets tab
 * asks it before drawing a slider, and one fact answered in two places is how
 * two screens come to say opposite things about the same tent.
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
 * The hardware whose document states a climate at all, by type rather than by
 * what is in the document: a device that has sent nothing yet cannot be asked
 * what it would hold, and this is the only thing left to tell a controller
 * whose settings are still on their way from a plug that will never have any.
 * A type nobody here knows is left out, which is how this read before: an
 * unknown one that does state a climate is believed the moment its document
 * arrives, and until then no screen promises anything on its behalf.
 */
export const HOLDS_A_CLIMATE = ['controller', 'fridge', 'fan'];

/**
 * A device that has never sent its document, but whose kind says it will state a
 * climate when it does.
 *
 * What ends that wait is the device's next connection: current firmware sends
 * the settings it runs every time it connects, and the cloud keeps them while
 * it has none. Older firmware publishes its document
 * only when a setting is changed on its own menu, so for a device that has not
 * been updated yet that change is still what ends it.
 *
 * Writing a first document from here instead would be worse than waiting. The
 * firmware rebuilds its whole settings struct from the document it is handed and
 * falls back to its compile-time defaults for every key the document leaves out,
 * so a document invented by the app would silently reset the work mode, the
 * dehumidifier's timing and the light's ramps - the tuning somebody set standing
 * at the hardware, which is exactly the tuning the app has never been sent and
 * therefore cannot put back. So these screens say what actually produces a
 * document and write nothing.
 */
export const awaitingClimate = (device: Device): boolean => device.configuration === null && HOLDS_A_CLIMATE.includes(device.type);

/**
 * Where a climate written for this device would land, in the three states the
 * screens that write one have to tell apart.
 *
 * `document` is a device whose own configuration states day and night targets:
 * the figures go into it, and every other key of it - the work mode, the
 * dehumidifier's timing, the ramps - is kept, because the merge is section by
 * section over what is already there.
 *
 * `awaited` is the controller above, whose document has not arrived. Nothing can
 * be written to it, and the reason is the one `awaitingClimate` sets out: what
 * would be published is the fragment on its own, and the firmware rebuilds its
 * whole settings struct from what it is handed. This used to be folded in with
 * `document` under one boolean, which is how the plan screen came to offer six
 * climate fields for a tent the Manual targets page one tap below refused in a
 * sentence - the same six figures that would have taken the tuning with them.
 *
 * `nowhere` is a plug or a lamp, which will never state a climate: its document
 * holds a lamp's on and off times as plain seconds under the same `day` and
 * `night` keys, so a figure written there would be an object over a schedule.
 */
export type ClimateLanding = 'document' | 'awaited' | 'nowhere';

export const climateLanding = (device: Device): ClimateLanding =>
  statesTargets(device.configuration) ? 'document' : awaitingClimate(device) ? 'awaited' : 'nowhere';

/**
 * Whether the device may have a CO2 sensor on it.
 *
 * Without one the firmware forces the CO2 target to zero the moment it reads a
 * document, so a target written for such a controller is a figure the cloud
 * holds and the hardware does not run. The question lives here beside the rest
 * of what is asked of the hardware because three write paths ask it - the manual
 * targets page, a plan's step editor and the preset the server writes - and only
 * the first of them used to, which is how the other two came to offer a figure
 * it drew as a dead row on the same tab.
 *
 * The report is read the way the server reads it in `common/v1/sentinels.ts`:
 * `off` is the firmware saying it looked for an SCD and found none, and a key
 * that is not there at all is a build too old to have been asked - "firmware too
 * old to say" rather than "not fitted". Reading that absence as a no put "needs a
 * CO2 sensor" on a fridge that was streaming 300 ppm at the time, so only an
 * explicit `off` refuses a target.
 */
export const hasCo2Sensor = (device: Device): boolean => device.state.hardware.co2 !== 'off';

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
