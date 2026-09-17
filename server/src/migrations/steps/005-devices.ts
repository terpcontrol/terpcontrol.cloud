import { spaceIdOf } from '../ids';
import { LEGACY, LegacyDevice, createdAtOf, instantOf, numberOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';

/**
 * The device document, reduced to what the device is. What a human thinks about
 * it leaves in the three migrations after this one: the plan, the alarm rules,
 * the camera.
 *
 * The decisions the old shape forces:
 *
 * - **`configuration`** is a JSON document stored as the string it arrived as.
 *   Absent or empty becomes `null`, which is a device that has never reported
 *   one. A string that does not parse also becomes `null`, and the original goes
 *   into the reject report: the device reports its configuration again on its
 *   next connection, and keeping a broken string would only mean every reader
 *   has to fail on it.
 * - **Three update settings fold into one channel.** `cloudSettings.firmwareChannel`
 *   wins where it is set, because it is the one an operator still edits. Where it
 *   is not, the two deprecated flags decide: either of them true means the device
 *   was following stable, and neither means it follows nothing and stays where
 *   an operator put it.
 * - **Two pending-firmware fields fold into `firmware.targetId`.** The one on
 *   `cloudSettings` wins, for the same reason.
 * - **`claimedAt` stays null** even for a claimed device. Nothing records when a
 *   device was claimed, and the day it was registered is a different fact.
 * - **The camera's credentials leave `hardware`.** Everything else the device
 *   reported is kept exactly as it reported it, but `webcam_pwd` becomes the
 *   camera's `secret`, which is never served; leaving a copy in a field that
 *   *is* served would hand it out with the sockets. `webcam_url` goes the same
 *   way and nowhere else: a stream URL carries its credentials in it, which is
 *   why the old server redacts the key rather than serving it, and nothing in
 *   the model reads it - a camera is reached by its id or by `cameras.url`.
 */

const HIDDEN_HARDWARE_KEYS = ['webcam_pwd', 'webcam_url'];

const DEFAULT_SETTINGS = { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 };

export const devices: MigrationStep = {
  name: '005-devices',

  async run(context: MigrationContext): Promise<void> {
    await context.renameAside(LEGACY.devices);
    const legacy = await context.source(LEGACY.devices);

    for await (const device of legacy.find<LegacyDevice>({}).sort({ _id: 1 })) {
      context.count('devices.read');

      const id = textOf(device.device_id);
      if (!id) {
        context.reject({ source: LEGACY.devices, id: String(device._id), reason: 'no device_id', dropped: true, detail: null });
        continue;
      }

      const ownerId = textOf(device.owner_id);
      const username = textOf(device.username);
      const password = textOf(device.password);
      const cloud = device.cloudSettings ?? {};

      await context.write('devices', {
        id,
        createdAt: createdAtOf(device),
        type: textOf(device.device_type) ?? 'controller',
        classId: textOf(device.class_id),
        serialNumber: numberOf(device.serialnumber),
        ownerId,
        spaceId: ownerId ? spaceIdOf(id) : null,
        name: textOf(device.name),
        // A device row made by hand has no credentials until it registers.
        mqtt: username && password ? { username, passwordHash: password } : null,
        firmware: {
          channel: channelOf(device),
          targetId: textOf(cloud.pendingFirmware) ?? textOf(device.pending_firmware),
        },
        configuration: configurationOf(context, id, device.configuration),
        settings: {
          vpdLeafOffsetDay: numberOf(cloud.vpdLeafTempOffsetDay) ?? DEFAULT_SETTINGS.vpdLeafOffsetDay,
          vpdLeafOffsetNight: numberOf(cloud.vpdLeafTempOffsetNight) ?? DEFAULT_SETTINGS.vpdLeafOffsetNight,
          ppfdLuxFactor: numberOf(cloud.ppfdLuxFactor) ?? DEFAULT_SETTINGS.ppfdLuxFactor,
        },
        isDemo: device.demoDevice === true,
        state: {
          lastSeenAt: instantOf(device.lastseen),
          claimedAt: null,
          firmwareId: textOf(device.current_firmware),
          updateStartedAt: instantOf(device.fwupdate_start),
          updateEndedAt: instantOf(device.fwupdate_end),
          maintenanceUntil: instantOf(device.maintenance_mode_until),
          hardware: hardwareOf(device.hardwareInfo),
          // Nothing has ever recorded when a socket row last changed state; the
          // ingest stamps it the first time a device reports its table again.
          socketStateChangedAt: {},
        },
      });
    }
  },
};

const channelOf = (device: LegacyDevice): string => {
  const channel = textOf(device.cloudSettings?.firmwareChannel);
  if (channel) return channel;
  return device.cloudSettings?.autoFirmwareUpdate === true || device.firmwareSettings?.autoUpdate === true ? 'stable' : 'manual';
};

const configurationOf = (context: MigrationContext, id: string, stored: string | undefined): Record<string, unknown> | null => {
  const text = textOf(stored);
  if (!text) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Falls through to the reject below, with the string kept there.
  }

  context.reject({
    source: LEGACY.devices,
    id,
    reason: 'the stored configuration is not a JSON object; the device is migrated without one and reports it again on its next connection',
    dropped: false,
    detail: text,
  });
  return null;
};

const hardwareOf = (reported: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(reported ?? {}).filter(([key]) => !HIDDEN_HARDWARE_KEYS.includes(key)));
