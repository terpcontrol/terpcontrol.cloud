import type { Device, DeviceFirmware } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useQueries } from '@tanstack/react-query';
import { deviceFirmwaresQuery, useDeviceFirmwares, useDevicesShape } from '@/api/devices';
import { FOLLOWED } from '@/api/read';
import { enough, useMayWith } from '@/ui/session-access';
import { buildLabel } from '@/ui/naming';
import { DATED_CLOCK, DATED_CLOCK_WITH_YEAR, DAY, nowThere, useZone, zoned } from '@/ui/zone';

/**
 * What can be said about a device's firmware from the builds it is offered:
 * which one it runs, which one it owes, and whether another one is there.
 *
 * Builds carry no version that could be compared, so "newer" is said only of
 * the stable channel's current build, where the cloud knows the build the
 * device runs and that one was made earlier. A device that follows a release
 * channel is handed such a build by the rollout itself; one whose updates are
 * off is offered it, and nothing installs it until somebody says so.
 */
const buildsOf = (device: Device, builds: readonly DeviceFirmware[]) => {
  const running = builds.find(one => one.id === device.state.firmwareId) ?? null;
  const owedId = device.firmware.targetId && device.firmware.targetId !== device.state.firmwareId ? device.firmware.targetId : null;
  const current = (channel: string): DeviceFirmware | null => builds.find(one => (one.channels as string[]).includes(channel)) ?? null;
  const newer = (build: DeviceFirmware | null): DeviceFirmware | null =>
    build && running && build.id !== running.id && build.id !== owedId && build.createdAt > running.createdAt ? build : null;
  const manual = device.firmware.channel === 'manual';

  return {
    running,
    /** The build the device was told to install and does not report yet. */
    owedId,
    owed: builds.find(one => one.id === owedId) ?? null,
    /** A newer stable build nothing installs by itself: the device's updates are off. */
    offered: manual ? newer(current('stable')) : null,
    /** A newer build of the device's own channel, which the rollout hands it. */
    coming: manual ? null : newer(current(device.firmware.channel)),
  };
};

export const useFirmware = (device: Device, enabled = true) => {
  const zone = useZone();
  const firmwares = useDeviceFirmwares(device.id, enabled);
  const builds = firmwares.data?.items ?? [];

  return {
    builds,
    ...buildsOf(device, builds),
    madeOn: (build: DeviceFirmware): string => buildDay(build, builds, zone),
    isPending: firmwares.isPending,
    isError: firmwares.isError,
    refetch: () => void firmwares.refetch(),
  };
};

/** A device with a build waiting for somebody's word. */
export interface OfferedUpdate {
  device: Device;
  build: DeviceFirmware;
}

/**
 * The updates that wait for a person, across the devices this session may
 * manage: a newer stable build for a device whose updates are off. Only such
 * a device is asked for its builds - every other is handed its update by the
 * rollout and has nothing to say here - so an account that never switched
 * updates off reads nothing. The bell counts them and the inbox lists them;
 * the devices and their builds are followed, not polled - the shell asks this on every page.
 */
export const useOfferedUpdates = (): OfferedUpdate[] => {
  const mayWith = useMayWith();
  const manual = (useDevicesShape().data?.items ?? []).filter(device => device.firmware.channel === 'manual' && enough(mayWith(device), 'manage'));

  return useQueries({
    queries: manual.map(device => ({ ...deviceFirmwaresQuery(device.id), ...FOLLOWED })),
    combine: results =>
      results.flatMap((result, index) => {
        const build = result.data ? buildsOf(manual[index], result.data.items).offered : null;
        return build ? [{ device: manual[index], build }] : [];
      }),
  });
};

/** A build by what its container stamped it with. */
export const buildName = (build: DeviceFirmware): string => buildLabel(build) ?? build.id.slice(0, 8);

/** The day a build was made - with its hour where `among` holds another of that day, in the year's place while the year is this one. */
export const buildDay = (build: DeviceFirmware, among: readonly DeviceFirmware[], zone: string | null): string => {
  const made = zoned(build.createdAt, zone);
  const alone = among.every(other => other.id === build.id || !zoned(other.createdAt, zone).hasSame(made, 'day'));
  return made.toFormat(alone ? DAY : made.hasSame(nowThere(serverNow(), zone), 'year') ? DATED_CLOCK : DATED_CLOCK_WITH_YEAR);
};
