import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DeviceCommand,
  DeviceCommandResult,
  DeviceConfiguration,
  DeviceConfigurationEnvelope,
  DevicePage,
  DeviceSeries,
  FirmwarePage,
  SeriesPoint,
  SocketOverrideUpdate,
  SocketPage,
} from '@fg2/shared-types/v1';
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

/**
 * What a device's light output is running at, which is a reading and not a
 * setting: the controller dims its own lamp, so the level is the one thing that
 * says whether the tent is dark, lit, or lit at two fifths.
 *
 * No read answers an output's newest value on its own, so it is read as the
 * shortest series there is and the last window that holds one is taken. The
 * window is a quarter of an hour because a device reports every five seconds and
 * one that fell silent should still be answered with its last level and its age
 * rather than with nothing at all.
 */
const LEVEL_WINDOW_MINUTES = 15;
const LEVEL_STEP_SECONDS = 30;

export interface OutputLevel {
  percent: number;
  measuredAt: string;
}

export const useLightLevels = (deviceIds: string[]) =>
  useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: ['devices', deviceId, 'light-level'],
      // The window is worked out per fetch rather than in the key: a key that
      // carried the current instant would be a new query every render.
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const endsAt = new Date();
        return api.get<DeviceSeries>(
          `/devices/${deviceId}/series`,
          {
            outputs: 'light',
            startsAt: new Date(endsAt.getTime() - LEVEL_WINDOW_MINUTES * 60_000).toISOString(),
            endsAt: endsAt.toISOString(),
            stepSeconds: LEVEL_STEP_SECONDS,
          },
          signal,
        );
      },
      refetchInterval: DEVICES_REFRESH_MS,
    })),
    combine: results => ({
      levels: new Map(deviceIds.map((deviceId, index) => [deviceId, newestLevel(results[index]?.data)])),
      isPending: results.some(result => result.isPending),
    }),
  });

/** The last window that holds a reading. A window with none is a gap in the series and says nothing about the lamp. */
const newestLevel = (series: DeviceSeries | undefined): OutputLevel | null => {
  const points: SeriesPoint[] = series?.outputs.find(output => output.output === 'light')?.points ?? [];
  const last = [...points].reverse().find(point => point.value !== null);

  return last ? { percent: last.value as number, measuredAt: last.measuredAt } : null;
};

/**
 * The device's own configuration document, written back whole.
 *
 * It is the only way to set a level: the firmware takes no command that carries
 * one, and the brightness a controller runs its lamp at is a key of the document
 * it parses at every connect. What comes back is what was stored and sent, never
 * what the device is now running - it sends no acknowledgement at all.
 */
export const useSaveConfiguration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ deviceId, configuration }: { deviceId: string; configuration: DeviceConfiguration }) =>
      api.put<DeviceConfigurationEnvelope>(`/devices/${deviceId}/configuration`, { configuration }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
};

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
