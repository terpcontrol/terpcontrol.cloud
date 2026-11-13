import type { QueryClient } from '@tanstack/react-query';
import type { DeviceCommand, DeviceCommandResult } from '@fg2/shared-types/v1';
import { api } from './client';
import { useWriteSettled } from './write';

const listChanged = (client: QueryClient) => client.invalidateQueries({ queryKey: ['devices'], exact: true });

/**
 * A command to the devices themselves rather than to one of their sockets, to
 * every device named at once. The answer is a receipt per device, in the order
 * they were named - the instant it went out and whether anybody was listening -
 * and never a claim that a device did what it was told. The device list is
 * read again afterwards because what a command changes, such as how long
 * maintenance holds, is reported in the device's own state.
 */
export const useDevicesCommand = () =>
  useWriteSettled(
    ({ deviceIds, command }: { deviceIds: string[]; command: DeviceCommand }) =>
      Promise.all(deviceIds.map(deviceId => api.post<DeviceCommandResult>(`/devices/${deviceId}/commands`, command))),
    listChanged,
  );
