import { useQuery } from '@tanstack/react-query';
import type { HomeAnswer } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The home is one read, refreshed on the beat a live value ages at. A refresh
 * that fails leaves the last answer in place - every value on it carries its
 * own age, which is what tells the person how old what they see is.
 */
export const HOME_REFRESH_MS = 30_000;

export const useHome = () =>
  useQuery({
    queryKey: ['home'],
    queryFn: ({ signal }) => api.get<HomeAnswer>('/home', undefined, signal),
    refetchInterval: HOME_REFRESH_MS,
  });
