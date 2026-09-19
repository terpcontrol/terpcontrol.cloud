import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceCommand, DeviceCommandResult, DevicePage, FirmwarePage, SocketOverrideUpdate, SocketPage } from '@fg2/shared-types/v1';
import { api, apiRequest } from './client';

/**
 * The first read, and the pattern for every one after it: a key, a route, and a
 * type that comes from the contract rather than from here.
 *
 * The device list and the socket tables are refreshed on the beat a value ages
 * at, because a socket row is the device's own report: nothing changes when a
 * switch is tapped, only when the device next says what it is doing.
 */
export const DEVICES_REFRESH_MS = 30_000;

export const useDevices = () =>
  useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => api.get<DevicePage>('/devices', undefined, signal),
    refetchInterval: DEVICES_REFRESH_MS,
  });

export const socketsKey = (deviceId: string) => ['devices', deviceId, 'sockets'];

/**
 * The socket tables of several devices at once. One read per device: a table is
 * a view of that device's own hardware report, so there is nothing to ask for
 * across devices, and each answer is one document.
 */
export const useSocketTables = (deviceIds: string[]) =>
  useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: socketsKey(deviceId),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<SocketPage>(`/devices/${deviceId}/sockets`, undefined, signal),
      refetchInterval: DEVICES_REFRESH_MS,
    })),
    combine: results => ({
      tables: new Map(deviceIds.map((deviceId, index) => [deviceId, results[index]?.data])),
      isPending: results.some(result => result.isPending),
      isError: results.some(result => result.isError),
    }),
  });

/** The builds of this device's class, which is how the id it reports gets a name. */
export const useDeviceFirmwares = (deviceId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['devices', deviceId, 'firmwares'],
    queryFn: ({ signal }) => api.get<FirmwarePage>(`/devices/${deviceId}/firmwares`, undefined, signal),
    enabled,
  });

/**
 * Forcing a socket, and handing it back to its role.
 *
 * What comes back says when the command went out and whether the device was
 * listening - never that it did what it was told - so the caller keeps the
 * answer and the row goes on showing what the device last reported until it
 * reports again. The table is asked for again all the same: the device re-sends
 * a row within half a minute of it changing.
 */
export interface OverrideRequest extends SocketOverrideUpdate {
  deviceId: string;
  /**
   * The slot of a socket, or the controller's own light output, which is
   * addressed by name rather than by a slot it has none of.
   */
  target: { kind: 'socket'; slot: number } | { kind: 'output'; output: 'light' };
}

export const useSetOverride = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ deviceId, target, state, forSeconds }: OverrideRequest): Promise<DeviceCommandResult> => {
      if (target.kind === 'output') {
        const command: DeviceCommand = { kind: 'socket_override', subject: { type: 'output', id: target.output }, state, forSeconds };
        return api.post<DeviceCommandResult>(`/devices/${deviceId}/commands`, command);
      }

      const route = `/devices/${deviceId}/sockets/${target.slot}/override`;
      // Handing a socket back is the override's deletion, and answers the same
      // receipt every other command does.
      return state === 'auto'
        ? apiRequest<DeviceCommandResult>(route, { method: 'DELETE' })
        : api.put<DeviceCommandResult>(route, { state, forSeconds });
    },
    onSettled: (_result, _error, request) => queryClient.invalidateQueries({ queryKey: socketsKey(request.deviceId) }),
  });
};

/** Switching a socket on for a moment, which is how a person finds out which plug in the tent it is. */
export const useTestSocket = () =>
  useMutation({
    mutationFn: ({ deviceId, slot, forSeconds }: { deviceId: string; slot: number; forSeconds: number }) =>
      api.post<DeviceCommandResult>(`/devices/${deviceId}/sockets/${slot}/tests`, { forSeconds }),
  });
