import { queryOptions, useQuery } from '@tanstack/react-query';
import { FOLLOWED, LIVE_BEAT_MS, useRead } from './read';
import type { HomeAnswer } from '@fg2/shared-types/v1';
import { api } from './client';

const homeQuery = queryOptions({ queryKey: ['home'], queryFn: ({ signal }) => api.get<HomeAnswer>('/home', undefined, signal) });

/**
 * The home is one read, refreshed on the live beat. A refresh that fails leaves
 * the last answer in place - every value on it carries its own age, which is
 * what tells the person how old what they see is.
 */
export const useHome = () => useRead({ ...homeQuery, refetchInterval: LIVE_BEAT_MS });

/** The home as some screen last read it, for the navigation and the hints over it. */
export const useHomeShape = (enabled = true) => useQuery({ ...homeQuery, ...FOLLOWED, enabled });
