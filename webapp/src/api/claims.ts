import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeviceClaimCreate, DeviceClaimResult } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * Claiming a device with the code on its display. The claim always ends in a
 * space, so the device list is what changes and what is refetched.
 */
export const useClaimDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceClaimCreate) => api.post<DeviceClaimResult>('/devices/claims', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
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
