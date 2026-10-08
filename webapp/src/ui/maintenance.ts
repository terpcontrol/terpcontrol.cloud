import { DateTime } from 'luxon';
import type { Device, OutputMetric } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { MAINTENANCE_SETTLE_SECONDS, MAINTENANCE_VISIT_SECONDS } from '@fg2/shared-types/v1-schemas/maintenance.js';
import { hasCo2Sensor, outputWord } from './climate-hardware';

/**
 * What a maintenance window does on the hardware it is sent to. The cloud holds
 * the alarms of any device, but only the controller and the fridge carry a
 * maintenance branch; every other type drops the command without a reply
 * (`docs/device-protocol.md` §8), so what a sentence says is stopped is per device.
 */

/**
 * The outputs a device stops driving while somebody works on it, by type: the
 * heater PID, the dehumidifier and the CO2 valve sit behind `isPaused()`, while
 * the light is dimmed to a working brightness. A type not named here drops the command.
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
 * written to stand inside a sentence. The joining word and the in-sentence names
 * are the catalogue's - `Intl.ListFormat` adds a serial comma, and German needs
 * the case the verb governs - falling back to the alarm screen's names.
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
 * How long the alarms really stay held for a window of this many seconds: the
 * window plus `MAINTENANCE_SETTLE_SECONDS`, which is the span every screen names.
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
 * What is standing on this device right now, or null while nothing is. The quiet
 * runs to the end of the settling rather than the window's edge, so a device
 * running again while its alarms are still held is told apart from both.
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
