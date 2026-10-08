import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { hasFailed, isFirstLoad, useRead } from './read';
import type {
  Co2FanCoupling,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceConfiguration,
  DeviceConfigurationEnvelope,
  DeviceConfigurationPatch,
  DeviceLive,
  DevicePage,
  DeviceUpdate,
  DeviceFirmwarePage,
  GerminationChoices,
  SocketOverrideUpdate,
  SocketPage,
  SocketUpdate,
  ValueState,
} from '@fg2/shared-types/v1';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
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

/**
 * Every device this account can see. `enabled` is here for the readers that only
 * want the list under one condition: a sheet that names the hardware of a place
 * for one of its eight tiles should not read the whole fleet for the other
 * seven.
 */
export const useDevices = (enabled = true) =>
  useRead({
    queryKey: ['devices'],
    queryFn: ({ signal }) => api.get<DevicePage>('/devices', undefined, signal),
    refetchInterval: DEVICES_REFRESH_MS,
    enabled,
  });

/**
 * Devices read one at a time, for a reader they do not belong to: support
 * reading a customer's place has none of them in its own list, and the charts
 * still need each one's leaf offsets to draw the VPD band the customer sees.
 */
export const useDevicesById = (deviceIds: readonly string[], enabled = true) =>
  useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: ['devices', deviceId],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Device>(`/devices/${deviceId}`, undefined, signal),
      enabled,
    })),
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
      isPending: results.some(isFirstLoad),
      isError: results.some(hasFailed),
    }),
  });

/**
 * What a device's light output is running at, which is a reading and not a
 * setting: the controller dims its own lamp, so the level is the one thing that
 * says whether the tent is dark, lit, or lit at two fifths.
 *
 * It is read from the device's live answer, beside every sensor it reports,
 * because that is the one read that has no window to pick: it answers the newest
 * value there is with the age and the state the server decided for it. A lamp
 * that has been quiet for four days therefore comes back dimmed and dated - the
 * rule this screen holds every other value to - where a series over the last
 * quarter of an hour used to come back empty and the level vanished from a row
 * that knew it perfectly well.
 */
export interface OutputLevel {
  percent: number;
  measuredAt: string;
  /** The server's verdict on that instant: live, stale or long offline. */
  state: ValueState;
}

/**
 * What each of these devices is reading and driving right now.
 *
 * One read per device, and two things are taken from it: the lamp's level,
 * which is the only word a controller gives on its own light output, and the
 * newest instant anywhere in the answer, which is the proof a row has that the
 * device was heard at all. A device list that judged liveness by `lastSeenAt`
 * alone called a device quiet for four days on the same card as a reading of
 * its own three days old.
 */
export const useLiveReads = (deviceIds: string[]) =>
  useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: ['devices', deviceId, 'live'],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<DeviceLive>(`/devices/${deviceId}/live`, undefined, signal),
      refetchInterval: DEVICES_REFRESH_MS,
    })),
    combine: results => ({
      levels: new Map(deviceIds.map((deviceId, index) => [deviceId, lightLevel(results[index]?.data)])),
      measuredAt: new Map(deviceIds.map((deviceId, index) => [deviceId, newestInstant(results[index]?.data)])),
      isPending: results.some(isFirstLoad),
    }),
  });

/**
 * When one device was last heard, as the Devices row and the server count it:
 * the later of its last message and its newest reading. The Control panels
 * aged `lastSeenAt` alone, which on a migrated device is half a day older, so
 * one silence read "6 d" there and "5 d" on the Devices tab.
 */
export const useHeardAt = (device: { id: string; state: { lastSeenAt: string | null } }): string | null => {
  const reads = useLiveReads([device.id]);
  return heardAt(device.state.lastSeenAt, reads.measuredAt.get(device.id) ?? null);
};

/** A device that has never driven a light output answers none, which is not the same as one at nothing. */
const lightLevel = (live: DeviceLive | undefined): OutputLevel | null => {
  const light = live?.outputs?.light;

  return light && light.value !== null && light.measuredAt !== null
    ? { percent: light.value, measuredAt: light.measuredAt, state: light.state }
    : null;
};

/** The newest thing the device said, over every metric and every output it answers. */
const newestInstant = (live: DeviceLive | undefined): string | null =>
  [...Object.values(live?.metrics ?? {}), ...Object.values(live?.outputs ?? {})].reduce<string | null>(
    (newest, value) => (value.measuredAt && (!newest || value.measuredAt > newest) ? value.measuredAt : newest),
    null,
  );

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
    mutationFn: ({
      deviceId,
      configuration,
      drying,
      germination,
      germinationChoices,
    }: {
      deviceId: string;
      configuration: DeviceConfiguration;
      drying?: boolean;
      germination?: boolean;
      /** What germination does about the humidity, where the page shows it; left out it stands as it was. */
      germinationChoices?: Partial<GerminationChoices>;
    }) => api.put<DeviceConfigurationEnvelope>(`/devices/${deviceId}/configuration`, { configuration, drying, germination, germinationChoices }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
};

/**
 * Settings beyond the targets, by the names `CONFIGURATION_FIELDS` gives them
 * for the device's type: the work mode's three switches, and whatever an
 * Erweitert item offers. It writes on the tap - there is no draft to keep, and
 * nothing else on the screen is waiting to be saved with it.
 *
 * The answer is the device as the server stored it, which is not always what
 * was asked: the work mode is decided from it (a drying device keeps drying,
 * one that is off stays off), so the list is given the answer rather than the
 * request, and the place reads that judge the tent are read again.
 */
export const useConfigure = (deviceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (set: DeviceConfigurationPatch['set']) => api.patch<Device>(`/devices/${deviceId}/configuration`, { set }),
    onSuccess: device => {
      queryClient.setQueryData<DevicePage>(['devices'], page =>
        page ? { ...page, items: page.items.map(one => (one.id === device.id ? device : one)) } : page,
      );
      queryClient.setQueryData(['devices', device.id], device);
      for (const key of ['devices', 'spaces', 'home']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
};

/**
 * What a person decides about a device: what it is called, and where it stands.
 *
 * The route has always taken both - it is the first thing `PATCH /devices/{id}`
 * is documented as doing - and until now nothing in the app called it, so the
 * name every list is built around could only be given by the claim that stored
 * the type as one, and hardware that landed in the wrong tent stayed there.
 *
 * A move is the wider of the two writes and is why the reads below are thrown
 * away rather than patched: the device leaves one place's Devices tab and
 * appears on another's, the home cards of both change, and the camera the
 * controller answers for is moved with it by the server, which no answer here
 * mentions. The device itself is written into its own key as well, because the
 * claim flow reads one device by id and would otherwise go on drawing the place
 * it has just been moved out of.
 */
export const useUpdateDevice = (deviceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: DeviceUpdate) => api.patch<Device>(`/devices/${deviceId}`, body),
    onSuccess: device => {
      queryClient.setQueryData(['devices', device.id], device);
      for (const key of ['devices', 'spaces', 'home', 'cameras']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
};

/**
 * Giving a device up: it leaves this account and can be claimed by whoever
 * stands in front of it next, with the code its display shows.
 *
 * Nothing is read again here. The panel the question was asked in belongs to
 * the device that is going, and reading the list again would take it away
 * before the answer is on it; whoever asked lets go of it with `forget` once
 * the answer has been read.
 */
export const useReleaseDevice = (deviceId: string) => {
  const queryClient = useQueryClient();

  const release = useMutation({ mutationFn: () => api.delete(`/devices/${deviceId}/claim`) });
  const forget = () => {
    for (const key of ['devices', 'spaces', 'home', 'cameras']) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  return { release, forget };
};

/**
 * The AIR fan a stand-alone smart socket slows down while it doses CO2, or
 * none. Two documents change, so both devices are read again.
 */
export const useCo2Fan = (plugId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coupling: Co2FanCoupling) => api.put<Device>(`/devices/${plugId}/co2-fan`, coupling),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
};

/**
 * Pairing a socket by its address, changing one's address, role or timer, and
 * removing one. Each answers a receipt - the device sends the table that shows
 * what it did within half a minute - and the table is read again.
 *
 * `slot` null pairs a socket the table does not hold yet.
 */
export const useSetSocket = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ deviceId, slot, socket }: { deviceId: string; slot: number | null; socket: SocketUpdate }) =>
      api.put<DeviceCommandResult>(`/devices/${deviceId}/sockets/${slot ?? 'new'}`, socket),
    onSettled: (_result, _error, request) => queryClient.invalidateQueries({ queryKey: socketsKey(request.deviceId) }),
  });
};

export const useRemoveSocket = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ deviceId, slot }: { deviceId: string; slot: number }) =>
      apiRequest<DeviceCommandResult>(`/devices/${deviceId}/sockets/${slot}`, { method: 'DELETE' }),
    onSettled: (_result, _error, request) => queryClient.invalidateQueries({ queryKey: socketsKey(request.deviceId) }),
  });
};

/**
 * The builds this device can be put on, which is how the id it reports gets a
 * name: the server always counts the build it runs and the one it is told to
 * run among them.
 */
export const useDeviceFirmwares = (deviceId: string, enabled: boolean) =>
  useRead({
    queryKey: ['devices', deviceId, 'firmwares'],
    queryFn: ({ signal }) => api.get<DeviceFirmwarePage>(`/devices/${deviceId}/firmwares`, undefined, signal),
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
