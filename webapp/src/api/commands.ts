import type { QueryClient } from '@tanstack/react-query';
import type { DeviceCommand, DeviceCommandResult } from '@fg2/shared-types/v1';
import { api } from './client';
import { useWriteSettled } from './write';

const listChanged = (client: QueryClient) => client.invalidateQueries({ queryKey: ['devices'], exact: true });

/**
 * A command to the device itself rather than to one of its sockets. The answer
 * is a receipt - the instant it went out and whether anybody was listening - and
 * never a claim that the device did what it was told. The device list is read
 * again afterwards because what a command changes, such as how long maintenance
 * holds, is reported in the device's own state.
 */
export const useDeviceCommand = () =>
  useWriteSettled(
    ({ deviceId, command }: { deviceId: string; command: DeviceCommand }) => api.post<DeviceCommandResult>(`/devices/${deviceId}/commands`, command),
    listChanged,
  );

/** One command to every device of a place at once: one receipt per device, in the order they were named. */
export const useDevicesCommand = () =>
  useWriteSettled(
    ({ deviceIds, command }: { deviceIds: string[]; command: DeviceCommand }) =>
      Promise.all(deviceIds.map(deviceId => api.post<DeviceCommandResult>(`/devices/${deviceId}/commands`, command))),
    listChanged,
  );
