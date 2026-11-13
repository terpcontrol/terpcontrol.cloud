import type { QueryClient } from '@tanstack/react-query';
import { useRead } from './read';
import type { Device, DeviceClaimCreate, DeviceClaimResult } from '@fg2/shared-types/v1';
import { api } from './client';
import { deviceQuery } from './devices';
import { ApiError } from './problem';
import { invalidate, useWrite } from './write';

/**
 * Claiming a device with the code on its display, in one write: the claim
 * says where the device goes - the place the flow was opened from, or the one
 * a fan, a socket or a lamp joins (`joinSpaceId`) - and the server makes a
 * place only for a device that holds a climate, or in an account without one.
 *
 * It changes the device list, the places and the home cards at once, and all
 * three are read again rather than patched: the answer is the device as it
 * stood at that instant, and a place it made is not in the answer at all.
 */
const claimChanged = (client: QueryClient): void => void invalidate(client, ['devices'], ['spaces'], ['home']);

const deviceClaimed = (client: QueryClient, device: Device): void => {
  client.setQueryData(['devices', device.id], device);
  claimChanged(client);
};

export const useClaimDevice = () =>
  useWrite(
    (body: DeviceClaimCreate) => api.post<DeviceClaimResult>('/devices/claims', body),
    // The answer is the device, so the steps after the claim have it before
    // the first read comes back and never stand empty on a claim that worked.
    (client, result) => deviceClaimed(client, result.device),
  );

/**
 * How often the device just claimed is read again: faster than the device
 * list's own beat, because somebody is standing in front of the hardware. A
 * controller just given Wi-Fi reports within seconds, and half a minute of
 * "not heard from yet" reads as a box that does not work.
 */
const CLAIM_REFRESH_MS = 10_000;

/**
 * The claimed device on its own, so that its firmware, its age and its camera
 * are the device's own words. The beat stops once the server has refused the
 * read: an id in the address may be stale or somebody else's, and asking
 * again would not make it readable.
 */
export const useClaimedDevice = (deviceId: string | null) =>
  useRead({
    ...deviceQuery(deviceId!),
    enabled: deviceId !== null,
    refetchInterval: query => (query.state.error ? false : CLAIM_REFRESH_MS),
  });

/**
 * Putting a claimed device in another of the account's places, where the
 * answer to where it hangs is changed: the route puts one device in one space
 * and nothing else, so it carries no name or firmware channel by accident.
 */
export const usePlaceDevice = () =>
  useWrite((to: { deviceId: string; spaceId: string }) => api.put<Device>(`/spaces/${to.spaceId}/devices/${to.deviceId}`), deviceClaimed);

/**
 * Ending a place the flow made that the device does not stand in after all: a
 * second controller hung beside the first, a new place the move into was
 * refused. It holds nothing, so no empty "Zelt 2" is left on Start. A place
 * already gone is what was asked for: an address can name it for longer.
 */
const gone = (error: unknown) => (error instanceof ApiError && error.status === 404 ? undefined : Promise.reject(error));

export const useEndInvented = () => useWrite((spaceId: string) => api.delete(`/spaces/${spaceId}`).catch(gone), claimChanged);

/**
 * What a QR code on the box says. It may carry the code alone or a link that
 * names it, and either way the code is what the claim needs.
 */
export const claimCodeOf = (scanned: string): string => {
  const text = scanned.trim();
  try {
    const url = new URL(text);
    return url.searchParams.get('code') ?? url.pathname.split('/').filter(Boolean).at(-1) ?? text;
  } catch {
    return text;
  }
};
