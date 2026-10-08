import { DateTime } from 'luxon';
import type { Device, OutputMetric } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { MAINTENANCE_SETTLE_SECONDS, MAINTENANCE_VISIT_SECONDS } from '@fg2/shared-types/v1-schemas/maintenance.js';
import { hasCo2Sensor, outputWord } from './climate-hardware';

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

/**
 * A controller that reports no CO2 sensor holds its CO2 target at zero, so its
 * valve is never driven and there is nothing of it to stop.
 */
export const parkedOutputs = (device: Device): OutputMetric[] =>
  (PARKED_BY[device.type] ?? []).filter(output => output !== 'co2' || hasCo2Sensor(device));

/** How long a step-in parks the hardware, in minutes: the alarms page, the Home chip and the panel all name it. */
export const VISIT_MINUTES = MAINTENANCE_VISIT_SECONDS / 60;

/**
 * The windows a grower picks from: a look and a watering, repotting or
 * defoliating, a harvest. The device takes any length; three are all anybody
 * needs to choose between, and the first is the step-in the diary tile writes.
 */
export const MAINTENANCE_MINUTES = [VISIT_MINUTES, 30, 60] as const;

/** The minutes the cloud goes on holding a device's alarms after its window has run out. */
const SETTLE_MINUTES = MAINTENANCE_SETTLE_SECONDS / 60;

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
    t(`maintenance.output.${outputWord(output, device.type === 'fridge')}`, { defaultValue: t(`alarms.output.${output}`, { defaultValue: output }) }),
  );
  if (names.length < 2) return names[0] ?? '';

  return `${names.slice(0, -1).join(', ')} ${t('maintenance.and')} ${names[names.length - 1]}`;
};

/** What a window stops on this device, as the line beside its name in a list of devices. */
export const parksLine = (t: Translate, device: Device): string =>
  parksAnything(device) ? t('log.visit.parksOutputs', { outputs: parkedLabel(t, device) }) : t('log.visit.parksNothing');

/**
 * How long the alarms really stay held, for a window of this many seconds.
 *
 * The device is let go when its window runs out; the cloud goes on holding its
 * alarms for `MAINTENANCE_SETTLE_SECONDS` after that, so the quiet a grower
 * gets is the sum and not the window. Every screen that names a span names this
 * one, because a quarter of an hour was promised by the chip, by the panel that
 * asks and by the receipt afterwards while the quiet ran for twenty-five
 * minutes - and somebody who stepped back out at the sixteenth had ten more in
 * which a tent going wrong would have raised nothing at all.
 */
const quietMinutes = (windowSeconds: number): number => Math.round(windowSeconds / 60) + SETTLE_MINUTES;

/**
 * The three spans a sentence about a window of so many minutes is written
 * around: the window the device is given, the settling the cloud adds to it,
 * and the quiet a grower actually gets, which is their sum.
 */
export const maintenanceSpans = (minutes: number) => ({ minutes, settle: SETTLE_MINUTES, quiet: quietMinutes(minutes * 60) });

/** The two ends of a quiet: when the hardware is let go, and when an alarm can be raised on it again. */
export interface Quiet {
  /** The device's own window, after which it picks up where it left off. */
  until: string;
  /** That plus the settling, which is when the engine starts turning this device's rules again. */
  alarmsUntil: string;
  /** Whether the hardware is still parked, or whether only the alarms are still being held. */
  parked: boolean;
}

/**
 * What is standing on this device right now, or null while nothing is.
 *
 * No screen read `maintenanceUntil` at all, so the one state that changes what
 * every alarm on a device will do was invisible: Home said "live · 2 s", the
 * rule card drew its armed switch and its triggered dot over an engine that was
 * refusing every turn, and the alert card went on offering a quarter of an hour
 * of maintenance to a device that was already in it. The only evidence a
 * step-in had done anything was a diary line saying when it began, which says
 * nothing about whether it is still in force.
 *
 * The quiet is read to the end of the settling rather than to the window's own
 * edge, because those last minutes are exactly the ones nothing named - and a
 * device whose hardware is running again while its alarms are still held is a
 * state worth telling apart from both of its neighbours.
 */
export const maintenanceQuiet = (device: Device, now: DateTime): Quiet | null => {
  const until = device.state.maintenanceUntil;
  if (!until) return null;
  const window = DateTime.fromISO(until);
  const alarms = window.plus({ minutes: SETTLE_MINUTES });

  return alarms > now ? { until, alarmsUntil: alarms.toISO() ?? until, parked: window > now } : null;
};

/**
 * The window standing on any of these devices that is still parking hardware,
 * or null while none is. The one ending first is the one named, because that is
 * the moment the first of them picks up again.
 */
export const parkedQuiet = (devices: Device[], now: DateTime): Quiet | null =>
  devices
    .map(device => maintenanceQuiet(device, now))
    .filter((quiet): quiet is Quiet => quiet?.parked === true)
    .sort((one, other) => one.until.localeCompare(other.until))[0] ?? null;
