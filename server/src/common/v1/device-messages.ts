import { EntryKind, EntryMessage, EntryValues, Severity } from '@fg2/shared-types/v1';

/**
 * A device's log line, read once.
 *
 * The firmware sends `{ severity, message }` and nothing else, and `message` is
 * either a `message-key:param` line from the catalogue the webapp translates or
 * free text. What each key is about is a table rather than a chain of
 * conditions, so a key the firmware gains is a row.
 *
 * `hardware-info:` rides the same topic and is not a diary line at all; it is
 * recognised here so that no reader of the log has to remember it.
 */

const MESSAGE_PREFIX = 'message-';

export const HARDWARE_INFO_PREFIX = 'hardware-info:';

/**
 * What a log key is worth beyond its words: the entry it becomes, and whether it
 * is about the camera the device answers for rather than about the device.
 *
 * Every key sends a `system` entry today - a device reports what happened to
 * itself, and the diary shows those below what a person wrote. The kind is a
 * column all the same, because a firmware that one day logs something else says
 * so with a row here rather than with a branch somewhere.
 */
interface DeviceMessageFact {
  kind: EntryKind;
  aboutCamera: boolean;
}

const OF_THE_DEVICE: DeviceMessageFact = { kind: 'system', aboutCamera: false };
const OF_THE_CAMERA: DeviceMessageFact = { kind: 'system', aboutCamera: true };

/** Every key current firmware sends. What is not here is still an entry, about the device. */
const DEVICE_MESSAGES: Readonly<Record<string, DeviceMessageFact>> = {
  'message-device-booted': OF_THE_DEVICE,
  // Emitted the moment the device is *told* to install a build, from inside the
  // firmware's subscribe handler and before the download runs - not when one
  // finishes. The rollout republishes the owed build on a doubling backoff until
  // the device comes back, so a device that cannot take the update writes one of
  // these per attempt. A finished update is a different key entirely
  // (`message-firmware-update-complete-with-ids`, written by the server once the
  // device reports the new build), and the two must not be worded alike.
  'message-device-firmware-update': OF_THE_DEVICE,
  'message-buffer-overflow': OF_THE_DEVICE,
  'message-co2-low': OF_THE_DEVICE,
  'message-ext-sensor-fail': OF_THE_DEVICE,
  'message-ext-sensor-deviate': OF_THE_DEVICE,
  'message-maintenance-mode-activated': OF_THE_DEVICE,
  'message-maintenance-mode-activated-remote': OF_THE_DEVICE,
  'message-smart-socket-connected': OF_THE_DEVICE,
  'message-smart-socket-disconnected': OF_THE_DEVICE,
  'message-smart-socket-tested': OF_THE_DEVICE,
  'message-smart-socket-readdressed': OF_THE_DEVICE,
  'message-smart-socket-address-lost': OF_THE_DEVICE,
  'message-smart-socket-cmd-failed': OF_THE_DEVICE,
  'message-aux-command-failed': OF_THE_DEVICE,
  'message-terp-cam-connected': OF_THE_CAMERA,
  'message-terp-cam-found': OF_THE_CAMERA,
  'message-terp-cam-not-found': OF_THE_CAMERA,
  'message-cam-reset': OF_THE_CAMERA,
  'message-cam-capture': OF_THE_CAMERA,
};

export const deviceMessageFact = (key: string | null): DeviceMessageFact => (key && DEVICE_MESSAGES[key]) || OF_THE_DEVICE;

/**
 * What a device wrote, as the timeline keeps it: a key with its parameter, or a
 * line nobody has a translation for, which is shown as it came.
 *
 * The parameter is everything after the **first** colon and stays whole. Both
 * the catalogue and the migrated entries read it that way - a key takes one
 * value, and `message-smart-socket-cmd-failed:heater:off` names the socket and
 * what failed in that one value - so splitting on every colon here would make
 * live entries and migrated ones read differently.
 */
export const parseDeviceMessage = (line: string): { message: EntryMessage | null; text: string | null } => {
  const value = line.trim();
  if (!value.startsWith(MESSAGE_PREFIX)) return { message: null, text: value.length > 0 ? value : null };

  const separator = value.indexOf(':');
  if (separator < 0) return { message: { key: value, params: [] }, text: null };

  return { message: { key: value.slice(0, separator), params: [value.slice(separator + 1)] }, text: null };
};

/** A line the device sends on the log topic that is a hardware report and never a diary entry. */
export const isHardwareInfo = (line: string): boolean => line.trimStart().startsWith(HARDWARE_INFO_PREFIX);

const SEVERITIES: readonly Severity[] = ['info', 'warning', 'critical'];

/** The number the firmware sends, as the model names it. Anything above the list is its worst value. */
export const severityOf = (severity: number | null | undefined): Severity =>
  SEVERITIES[Math.min(Math.max(Math.trunc(severity ?? 0), 0), SEVERITIES.length - 1)];

/**
 * A device's line records no numbers, so its `values` is its kind and nothing
 * else. The assertion is what the union cannot express: the kind comes out of
 * the table as one of several literals, and each of them names a `values` shape
 * that holds the kind alone.
 */
export const deviceEntryValues = (kind: EntryKind): EntryValues => ({ kind }) as EntryValues;
