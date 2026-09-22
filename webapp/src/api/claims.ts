import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Device, DeviceClaimCreate, DeviceClaimResult, Space, SpaceUpdate } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * Claiming a device with the code on its display, and the two reads the steps
 * that follow a claim are answered from.
 *
 * A claim ends in a space whichever way it is made, so it changes the device
 * list, the places and the home cards at once, and all three are read again
 * rather than patched here: what the claim answers is the device as it stood at
 * that instant, and the space it made is not in the answer at all.
 */
const claimChanged = (client: QueryClient): void => {
  for (const key of ['devices', 'spaces', 'home']) void client.invalidateQueries({ queryKey: [key] });
};

export const useClaimDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceClaimCreate) => api.post<DeviceClaimResult>('/devices/claims', body),
    onSuccess: result => {
      // The answer is the device, so the steps after the claim have it before
      // the first read comes back and never stand empty on a claim that worked.
      queryClient.setQueryData(['devices', result.device.id], result.device);
      claimChanged(queryClient);
    },
  });
};

/**
 * How often the device just claimed is read again.
 *
 * Faster than the device list's own beat, because this is the one screen where
 * somebody is standing in front of the hardware waiting for it to say something:
 * a controller that has just been given Wi-Fi reports within a few seconds, and
 * half a minute of "not heard from yet" reads as a box that does not work.
 */
export const CLAIM_REFRESH_MS = 10_000;

/** The claimed device on its own, so that its firmware, its age and its camera are the device's own words. */
export const useClaimedDevice = (deviceId: string | null) =>
  useQuery({
    queryKey: ['devices', deviceId],
    queryFn: ({ signal }) => api.get<Device>(`/devices/${deviceId}`, undefined, signal),
    enabled: deviceId !== null,
    refetchInterval: CLAIM_REFRESH_MS,
  });

/**
 * The name and the kind of the place the device stands in.
 *
 * A claim already made a space and named it after the device, so onboarding
 * corrects that one rather than making a second: a grower who types "Tent 1"
 * here wants the tent renamed, not two tents with one controller between them.
 */
export const useRenameSpace = (spaceId: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SpaceUpdate) => api.patch<Space>(`/spaces/${spaceId}`, body),
    onSuccess: () => {
      claimChanged(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
};

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
