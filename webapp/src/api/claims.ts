import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRead } from './read';
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

/**
 * The claimed device on its own, so that its firmware, its age and its camera
 * are the device's own words.
 *
 * The beat stops once the server has refused the read: an id carried in the
 * address may be stale or somebody else's, and asking again every ten seconds
 * would not make it any more readable.
 */
export const useClaimedDevice = (deviceId: string | null) =>
  useRead({
    queryKey: ['devices', deviceId],
    queryFn: ({ signal }) => api.get<Device>(`/devices/${deviceId}`, undefined, signal),
    enabled: deviceId !== null,
    refetchInterval: query => (query.state.error ? false : CLAIM_REFRESH_MS),
  });

/**
 * Naming the place a claim has just made.
 *
 * It is the same write the second step's rename makes, with the space named in
 * the call rather than in the hook, because at the instant a claim answers
 * there is no space on the screen to bind one to. The word is the app's to
 * choose and not the server's: a name has to be in the language the grower
 * reads, and the server has no language.
 */
export const useNameNewPlace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ spaceId, name }: { spaceId: string; name: string }) => api.patch<Space>(`/spaces/${spaceId}`, { name }),
    onSuccess: () => claimChanged(queryClient),
  });
};

/**
 * The name and the kind of the place the device stands in.
 *
 * A claim already made a space and gave it a name to be corrected, so
 * onboarding corrects that one rather than making a second: a grower who types
 * "Flower tent" here wants the tent renamed, not two tents with one controller
 * between them.
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
 * Moving the device into a place the account already has.
 *
 * It is the narrower of the two ways to say it: the route puts one device in
 * one space and answers nothing else, so a correction made here cannot carry a
 * name or a firmware channel with it by accident. Hardware that was plugged in
 * before anybody decided where it stands is the ordinary reason - a claim has
 * to end in some space, and the one it invents is a guess.
 */
export const usePlaceDevice = (deviceId: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (spaceId: string) => api.put<Device>(`/spaces/${spaceId}/devices/${deviceId}`),
    onSuccess: device => {
      queryClient.setQueryData(['devices', device.id], device);
      claimChanged(queryClient);
    },
  });
};

/**
 * Archiving the place a claim invented, once the device has been moved out of
 * it. It is a tombstone rather than a deletion, so nothing that ever named the
 * space loses its name; what it buys is a list that does not grow an empty
 * "Tent 1" every time somebody corrects where a controller stands.
 */
export const useArchiveSpace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (spaceId: string) => api.put<Space>(`/spaces/${spaceId}/archive`),
    onSuccess: () => claimChanged(queryClient),
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
