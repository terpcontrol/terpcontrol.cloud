import type { DateTime } from 'luxon';
import type { Device, DeviceClass, Firmware, FirmwareChannel, FleetClass } from '@fg2/shared-types/v1';
import { deviceLiveness } from '@/ui/age';

/**
 * What a rollout is, in the figures the two admin screens both state.
 *
 * A class is the update unit: each of its three channels names the build the
 * devices on that channel should be running, the staged percentage decides how
 * many of them are told at a time, and pausing stops the sweep where it stands.
 * None of that can be judged from the class alone - what matters is how many
 * devices a change would reach - so every figure here is counted before a
 * control is pressed rather than reported after it.
 */

/** The channels a class hands a build out on. `manual` is the absence of one and is never swept, so it is not here. */
export const CHANNELS: readonly Exclude<FirmwareChannel, 'manual'>[] = ['stable', 'beta', 'alpha'];

export interface ChannelStand {
  channel: Exclude<FirmwareChannel, 'manual'>;
  /** The build this channel points at, or null while it points nowhere and hands out nothing. */
  firmwareId: string | null;
  /** What that build is called: its registered name, or its version, which is a uuid. */
  label: string | null;
  /** How many devices of the class follow this channel, and how many of those are talking. */
  devices: number;
  online: number;
  /** How many devices of the whole class report they are running that build. The server's count, not ours. */
  running: number;
}

/**
 * Which build each channel of a class points at, and how much of the class is
 * behind it. The devices are counted from the fleet's own device list because
 * nothing answers "how many devices are on the beta channel" on its own, and
 * what each build is running on comes from the fleet answer, which counts it
 * against every device of the class rather than against one channel.
 */
export const channelStands = (
  deviceClass: DeviceClass,
  fleetClass: FleetClass | undefined,
  devices: Device[],
  firmwares: Firmware[],
  now: DateTime,
): ChannelStand[] => {
  const ours = devices.filter(device => device.classId === deviceClass.id);
  const builds = new Map(firmwares.map(one => [one.id, one]));

  return CHANNELS.map(channel => {
    const firmwareId = deviceClass.firmwareIds[channel];
    const on = ours.filter(device => device.firmware.channel === channel);
    const build = firmwareId ? builds.get(firmwareId) : undefined;

    return {
      channel,
      firmwareId,
      label: build ? (build.name ?? build.version) : firmwareId,
      devices: on.length,
      online: on.filter(device => deviceLiveness(device.state.lastSeenAt, now) !== 'offline').length,
      running: (firmwareId && fleetClass?.firmwares.find(stats => stats.firmwareId === firmwareId)?.total) || 0,
    };
  });
};

/**
 * How many devices a staged percentage reaches, roughly.
 *
 * Roughly, and said as roughly: the server takes the share from a hash of each
 * device's id rather than by counting, so that a device inside the first ten
 * per cent stays inside it as the stage grows. That makes the exact set
 * knowable only to the server, and the number here what a percentage of a
 * count is - which is what an operator is weighing when they raise it.
 */
export const staged = (percent: number, devices: number): number => Math.round((percent / 100) * devices);

/** Every device of the class, and how many are listening. A paused rollout reaches none of them until it is resumed. */
export const classSize = (deviceClass: DeviceClass, devices: Device[], now: DateTime): { total: number; online: number } => {
  const ours = devices.filter(device => device.classId === deviceClass.id);

  return { total: ours.length, online: ours.filter(device => deviceLiveness(device.state.lastSeenAt, now) !== 'offline').length };
};

/** A build cannot be deleted while a channel still points at it; the server refuses, and the screen says so before it is asked. */
export const pointedAtBy = (
  firmwareId: string,
  classes: DeviceClass[],
): { deviceClass: DeviceClass; channel: Exclude<FirmwareChannel, 'manual'> }[] =>
  classes.flatMap(deviceClass =>
    CHANNELS.filter(channel => deviceClass.firmwareIds[channel] === firmwareId).map(channel => ({ deviceClass, channel })),
  );
