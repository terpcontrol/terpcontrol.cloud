import { useMutation, type QueryClient } from '@tanstack/react-query';
import { LIVE_BEAT_MS, useRead, useReadPages } from './read';
import type {
  AdminStats,
  AdminUserCreate,
  AdminUserPage,
  AdminUserUpdate,
  CameraPage,
  DeviceClassPage,
  DeviceClassUpdate,
  DevicePage,
  Firmware,
  FirmwareCreate,
  FirmwarePage,
  FirmwareUpdate,
  Fleet,
  User,
} from '@fg2/shared-types/v1';
import { MAX_PAGE_LIMIT } from '@fg2/shared-types/v1-schemas/pages.js';
import { api } from './client';
import { invalidate, useWriteSettled } from './write';

/**
 * The reads and writes behind `/admin`, which are the only routes of the API
 * that belong to the install rather than to a person.
 *
 * They are kept apart from the rest of `src/api` for that reason: every other
 * module here asks what this account may see, and each of these asks what the
 * whole install holds - every device whoever owns it, every account with its
 * address. Nothing outside the four admin screens imports from this file, so a
 * screen that is not behind the guard cannot start one of these reads by
 * accident.
 *
 * The lists are paged, and the pages are large: an operator looking at the
 * fleet is counting it, and a table that shows the first fifty of three hundred
 * devices answers a different question than the one being asked. Each read asks
 * for `MAX_PAGE_LIMIT`, the most the server gives, so a bigger fleet is followed
 * by its cursor and the screen says what it is showing.
 */

/**
 * The beat the install's own figures are read on. Each read is a dozen counts
 * across every collection, and what they answer moves on the composer's beat
 * and the sweep's rather than the device's: a render takes minutes and the
 * retention pass runs once a night, so a minute is as fresh as the answer can
 * usefully be.
 */
export const STATS_REFRESH_MS = 60_000;

export const fleetKey = ['admin', 'fleet'];
export const adminStatsKey = ['admin', 'stats'];
export const adminCamerasKey = ['admin', 'cameras'];
export const adminDevicesKey = ['admin', 'devices'];
export const adminUsersKey = ['admin', 'users'];
export const deviceClassesKey = ['admin', 'device-classes'];
export const firmwaresKey = (classId: string | null) => ['admin', 'firmwares', classId];

/** What the fleet is running, class by class. The totals on the heading are this answer's, not a count of loaded rows. */
export const useFleet = () =>
  useRead({
    queryKey: fleetKey,
    queryFn: ({ signal }) => api.get<Fleet>('/admin/fleet', undefined, signal),
    refetchInterval: LIVE_BEAT_MS,
  });

/**
 * How the install itself is doing: the figures the health card is drawn from.
 *
 * Two of them are deliberately not what the board drew, and the card says so
 * rather than relabelling them. `devices.online` is devices heard from inside
 * the offline window, not connections on the broker: the broker is RabbitMQ
 * and its socket count is its own to report, and the fleet's liveness is the
 * figure every other screen already uses. `retention` is the sweep's last pass
 * as the running server remembers it, and it is stored nowhere - so a server
 * that has just restarted answers null, which means no pass since it started
 * and not a night on which nothing happened.
 */
export const useAdminStats = () =>
  useRead({
    queryKey: adminStatsKey,
    queryFn: ({ signal }) => api.get<AdminStats>('/admin/stats', undefined, signal),
    refetchInterval: STATS_REFRESH_MS,
  });

/**
 * Every camera on the install. An administrator's session is answered every
 * camera by the route a grower reads their own from, and that list is paged
 * like every other: read as one page it stopped at fifty, and the fleet's cams
 * column and camera count were drawn from those fifty as if they were all of
 * them. It is followed to its end here, as the device list is, so a standalone
 * Terp Cam past the first page has a row and a controller's cams are counted
 * whole.
 */
export const useAdminCameras = () =>
  useReadPages({
    queryKey: adminCamerasKey,
    queryFn: ({ pageParam, signal }) => api.get<CameraPage>('/cameras', { limit: MAX_PAGE_LIMIT, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    refetchInterval: LIVE_BEAT_MS,
  });

/**
 * Every device on the install, whoever owns it. It is the same serialiser the
 * Devices tab reads, so a row here carries exactly what a row there does - the
 * owner's id among it, which is why the user page is read beside this one to
 * turn an id into the handle the board draws.
 */
export const useAdminDevices = () =>
  useReadPages({
    queryKey: adminDevicesKey,
    queryFn: ({ pageParam, signal }) => api.get<DevicePage>('/admin/devices', { limit: MAX_PAGE_LIMIT, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    refetchInterval: LIVE_BEAT_MS,
  });

/**
 * Every account. An address is on each of these rows and is read by nobody but
 * an administrator, so the page is asked for by cursor alone: no name, no
 * address and no handle is ever put into a query string, where it would be
 * written to a log by every proxy between here and the server.
 */
export const useAdminUsers = () =>
  useReadPages({
    queryKey: adminUsersKey,
    queryFn: ({ pageParam, signal }) => api.get<AdminUserPage>('/admin/users', { limit: MAX_PAGE_LIMIT, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
  });

/** The classes a rollout is staged on. There are as many as there are hardware types, so one page holds them. */
export const useDeviceClasses = () =>
  useRead({
    queryKey: deviceClassesKey,
    queryFn: ({ signal }) => api.get<DeviceClassPage>('/admin/device-classes', { limit: MAX_PAGE_LIMIT }, signal),
  });

/** The registered builds, newest first, of one class or of all of them. */
export const useFirmwares = (classId: string | null) =>
  useReadPages({
    queryKey: firmwaresKey(classId),
    queryFn: ({ pageParam, signal }) =>
      api.get<FirmwarePage>('/admin/firmwares', { limit: MAX_PAGE_LIMIT, cursor: pageParam, classId: classId ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
  });

/**
 * Where a build is rolled out.
 *
 * There is one rollout per class and it is the class's own state, so pausing
 * one, staging it at a percentage and pointing a channel at a build are all
 * this single write. The fleet answer is asked for again afterwards, because
 * every figure the rollout cards show is derived from it.
 */
export const useUpdateDeviceClass = () =>
  useWriteSettled(
    ({ classId, body }: { classId: string; body: DeviceClassUpdate }) => api.patch(`/admin/device-classes/${classId}`, body),
    client => void invalidate(client, deviceClassesKey, fleetKey),
  );

const firmwaresChanged = (client: QueryClient): void => void invalidate(client, ['admin', 'firmwares']);

/** Registering a build: the row a binary is then uploaded against, and that a channel can be pointed at. */
export const useCreateFirmware = () => useWriteSettled((body: FirmwareCreate) => api.post<Firmware>('/admin/firmwares', body), firmwaresChanged);

/** Relabelling one. A build's version is the uuid its container stamped it with; the name is how a person tells it apart. */
export const useUpdateFirmware = () =>
  useWriteSettled(
    ({ firmwareId, body }: { firmwareId: string; body: FirmwareUpdate }) => api.patch<Firmware>(`/admin/firmwares/${firmwareId}`, body),
    firmwaresChanged,
  );

/** Deleting a build and its files. The server refuses while a channel still points at it, and the screen says so first. */
export const useDeleteFirmware = () => useWriteSettled((firmwareId: string) => api.delete(`/admin/firmwares/${firmwareId}`), firmwaresChanged);

/**
 * One file of a build, by the name the device asks for it under.
 *
 * The bytes travel base64-encoded because that is what a JSON body can carry,
 * and the encoding is done here in a chunked loop rather than by spreading the
 * array into `String.fromCharCode`: a firmware image is a megabyte or more, and
 * a spread of a million arguments overflows the call stack in every browser.
 */
export const useUploadBinary = () =>
  useMutation({
    mutationFn: async ({ firmwareId, name, file }: { firmwareId: string; name: string; file: File }) =>
      api.put<void>(`/admin/firmwares/${firmwareId}/binaries/${encodeURIComponent(name)}`, { data: base64Of(await file.arrayBuffer()) }),
  });

const CHUNK = 0x8000;

export const base64Of = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let at = 0; at < view.length; at += CHUNK) binary += String.fromCharCode(...view.subarray(at, at + CHUNK));

  return btoa(binary);
};

const usersChanged = (client: QueryClient): void => void invalidate(client, adminUsersKey);

/** A new account, active at once and with no activation code: whoever made it can hand the password over. */
export const useCreateUser = () => useWriteSettled((body: AdminUserCreate) => api.post<User>('/admin/users', body), usersChanged);

/** Changing one, a reset password among the fields, which is what an administrator does for somebody who cannot receive the mail. */
export const useUpdateUser = () =>
  useWriteSettled(({ userId, body }: { userId: string; body: AdminUserUpdate }) => api.patch<User>(`/admin/users/${userId}`, body), usersChanged);

/**
 * Deleting one. It is the same deletion an account starts for itself: the rows
 * go, and the hardware it had claimed becomes claimable again. The account this
 * install is configured with is refused by the server, which says so.
 */
export const useDeleteUser = () =>
  useWriteSettled(
    (userId: string) => api.delete(`/admin/users/${userId}`),
    client => void invalidate(client, adminUsersKey, adminDevicesKey),
  );
