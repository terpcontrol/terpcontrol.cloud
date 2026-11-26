import { useDevices, useDevicesById, useHeardAt } from '@/api/devices';
import { noLongerThere } from '@/api/problem';
import type { Device } from '@fg2/shared-types/v1';
import type { DateTime } from 'luxon';
import { deviceLiveness } from '@/ui/age';
import { standingWith } from '@/ui/naming';

/**
 * One device by its id, for a page about it: out of the account's own list,
 * which every screen already reads, and by itself where the list does not hold
 * it - support reading a customer's device. `gone` is a device the reader
 * cannot open, which the server answers like one that is not there.
 */
export const useDevice = (deviceId: string) => {
  const own = useDevices();
  const mine = own.data?.items.find(one => one.id === deviceId) ?? null;
  const elsewhere = own.data !== undefined && mine === null;
  const [single] = useDevicesById([deviceId], elsewhere);
  const device: Device | null = mine ?? (elsewhere ? (single?.data ?? null) : null);

  return {
    device,
    /** The devices standing where it stands, which say whether its name needs the tail of its id: its page is headed as its card. */
    among: device ? standingWith(device, own.data?.items) : undefined,
    isPending: device === null && (own.isPending || (elsewhere && (single?.isPending ?? false))),
    gone: device === null && elsewhere && noLongerThere(single?.error),
    error: own.error ?? single?.error ?? null,
    isFetching: own.isFetching || (single?.isFetching ?? false),
    refetch: () => {
      void own.refetch();
      if (elsewhere) void single?.refetch();
    },
  };
};

/**
 * How alive a device is, for the pill in the head of its page: when it was
 * last heard and what that makes it. One that was never heard is waiting for
 * its first values, not offline - nothing about it has gone quiet.
 */
export const useDeviceLiveness = (device: Device, now: DateTime) => {
  const heard = useHeardAt(device);
  const liveness = deviceLiveness(heard, now);

  return { heard, liveness, waiting: heard === null, offline: liveness === 'offline' && heard !== null };
};
