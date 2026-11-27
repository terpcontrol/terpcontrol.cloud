import type { Device, DeviceLive, OutputMetric, Socket, TimelineOutputLane } from '@fg2/shared-types/v1';
import type { Steered } from '@fg2/shared-types/v1-schemas/steering.js';
import type { Translate } from '@/i18n/i18n';
import { hasCo2Sensor, outputWord } from '@/ui/climate-hardware';
import { plugModeOf, plugReadingOf } from '@/screens/control/devices/own-summary';

/**
 * What the hardware of a place is doing about each reading, from the lead
 * device's own newest report: the foot of a tile on the place's Start, and the
 * line under the figures of its card among several.
 */

/**
 * The outputs that move each reading, by kind of hardware, in the order they
 * are listed. A fridge module drives one compressor that both cools and dries,
 * on the output the firmware calls the dehumidifier, so it stands under both
 * readings and is called the compressor under both: one machine, one name. A
 * tent controller cannot cool at all, so its temperature lists the heater and
 * nothing that would promise otherwise.
 */
const MOVERS: Record<string, Partial<Record<Steered, OutputMetric[]>>> = {
  fridge: { temperature: ['dehumidifier', 'heater'], humidity: ['dehumidifier'], co2: ['co2'] },
  controller: { temperature: ['heater'], humidity: ['dehumidifier'], co2: ['co2'] },
};

/** What an output is called on Start (`start.output.*`). */
type OutputWord = 'compressor' | 'heater' | 'dehumidifier' | 'co2' | 'socket' | 'humidifier';

export interface OutputState {
  /** The output, or `humidifier` for the sockets paired as one, which report through the socket table rather than as an output. */
  output: OutputMetric | 'humidifier';
  word: OutputWord;
  on: boolean;
  /** Since when it has been running, where the day's record says so. */
  since: string | null;
}

const wordOf = (device: Device, output: OutputMetric): OutputWord | null =>
  output === 'dehumidifier' || output === 'heater' || output === 'co2' ? outputWord(output, device.type === 'fridge') : null;

/** Since when the newest run of an output has gone on, where it is still going at the end of what was heard. */
const runningSince = (lane: TimelineOutputLane | undefined): string | null => {
  const last = lane?.spans.at(-1);
  return last && lane && last.endsAt === lane.heardUntil ? last.startsAt : null;
};

/**
 * What the hardware is doing about one reading. An output the device has
 * never reported is left out rather than called off, and so is the CO₂ valve
 * of a controller with no sensor, which the firmware never opens. A
 * stand-alone socket moves the reading it switches by with its one relay.
 */
export const outputsFor = (
  device: Device | null,
  live: DeviceLive | undefined,
  lanes: TimelineOutputLane[] | undefined,
  metric: Steered,
): OutputState[] => {
  if (!device || !live) return [];
  const lane = (output: OutputMetric) => lanes?.find(one => one.output === output && (one.deviceId === null || one.deviceId === device.id));
  const mode = plugModeOf(device);
  if (mode) {
    const level = live.outputs.relais?.value;
    if (plugReadingOf(mode) !== metric || level == null) return [];
    return [{ output: 'relais', word: 'socket', on: level > 0, since: level > 0 ? runningSince(lane('relais')) : null }];
  }
  return (MOVERS[device.type]?.[metric] ?? []).flatMap(output => {
    const word = wordOf(device, output);
    const level = live.outputs[output]?.value;
    if (!word || level == null || (output === 'co2' && !hasCo2Sensor(device))) return [];
    return [{ output, word, on: level > 0, since: level > 0 ? runningSince(lane(output)) : null }];
  });
};

/**
 * The humidifier sockets paired at a device, under the humidity they move:
 * one name for all of them, on while any is on, and since when where the one
 * that is on says so. A socket whose state the device has not reported is
 * left out rather than called off.
 */
export const humidifierOutputs = (sockets: readonly Socket[], metric: Steered): OutputState[] => {
  const known = sockets.filter(socket => socket.state !== 'unknown');
  if (metric !== 'humidity' || known.length === 0) return [];
  const running = known.find(socket => socket.state === 'on');
  return [{ output: 'humidifier', word: 'humidifier', on: running !== undefined, since: running?.stateChangedAt ?? null }];
};

/** "Heizung aus", "Kompressor läuft", "CO₂-Ventil zu": an output in words, as a tile's foot and a card's line say it. */
export const outputWords = (t: Translate, state: OutputState, since: string | null = null): string =>
  `${t(`start.output.${state.word}`)} ${t(
    `start.outputs.${state.word === 'co2' ? (state.on ? 'open' : 'closed') : state.on ? (since ? 'runningSince' : 'running') : 'off'}`,
    { age: since ?? '' },
  )}`;

/** Everything the lead device's hardware does about the place's climate, each output once, in the order the tiles stand. */
export const placeOutputs = (device: Device | null, live: DeviceLive | undefined, humidifiers: readonly Socket[]): OutputState[] =>
  [
    ...outputsFor(device, live, undefined, 'temperature'),
    ...outputsFor(device, live, undefined, 'humidity'),
    ...humidifierOutputs(humidifiers, 'humidity'),
    ...outputsFor(device, live, undefined, 'co2'),
  ].filter((state, index, all) => all.findIndex(other => other.output === state.output) === index);
