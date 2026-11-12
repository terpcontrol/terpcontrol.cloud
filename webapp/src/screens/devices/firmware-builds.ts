import type { Device, DeviceFirmware } from '@fg2/shared-types/v1';
import { useDeviceFirmwares } from '@/api/devices';
import { buildLabel } from '@/ui/naming';

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
export const useFirmware = (device: Device, enabled = true) => {
  const firmwares = useDeviceFirmwares(device.id, enabled);
  const builds = firmwares.data?.items ?? [];
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
    isPending: firmwares.isPending,
    isError: firmwares.isError,
    refetch: () => void firmwares.refetch(),
  };
};

/** A build by what its container stamped it with, which is the one thing that tells two builds of one class apart. */
export const buildName = (build: DeviceFirmware): string => buildLabel(build) ?? build.id.slice(0, 8);
