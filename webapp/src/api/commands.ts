import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeviceCommand, DeviceCommandResult } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * A command to the device itself rather than to one of its sockets: maintenance,
 * a reboot, a test run. The answer is a receipt - the instant it went out and
 * whether anybody was listening - and never a claim that the device did what it
 * was told. The device list is read again afterwards because what a command
 * changes, such as how long maintenance holds, is reported in the device's own
 * state.
 */
export const useDeviceCommand = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ deviceId, command }: { deviceId: string; command: DeviceCommand }) =>
      api.post<DeviceCommandResult>(`/devices/${deviceId}/commands`, command),
    onSettled: () => client.invalidateQueries({ queryKey: ['devices'], exact: true }),
  });
};
