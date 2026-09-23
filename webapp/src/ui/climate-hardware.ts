import type { Device, DeviceConfiguration } from '@fg2/shared-types/v1';

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

export const sectionOf = (configuration: DeviceConfiguration, name: string): Record<string, unknown> => {
  const value = configuration[name];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

/** One figure, nested or flat, as the server reads a setpoint out of the same document. */
export const figureOf = (configuration: DeviceConfiguration, section: string, field: string): number | null => {
  const value = sectionOf(configuration, section)[field] ?? configuration[`${section}.${field}`];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

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
 * What ends that wait is worth stating, because every screen that draws this
 * state has to tell somebody what to do about it, and the obvious answer is
 * wrong. The device publishes its configuration only when a setting is changed
 * on its own menu; on connect it publishes its firmware id and nothing else, and
 * the cloud has no way to ask for the document, so waiting for the next
 * connection is waiting for something that never happens.
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
