import { useQuery } from '@tanstack/react-query';
import type { DevicePage } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The first read, and the pattern for every one after it: a key, a route, and a
 * type that comes from the contract rather than from here.
 */
export const useDevices = () =>
  useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => api.get<DevicePage>('/devices', undefined, signal),
  });
