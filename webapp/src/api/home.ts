import { useQuery } from '@tanstack/react-query';
import { useRead } from './read';
import type { HomeAnswer } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The home is one read, refreshed on the beat a live value ages at. A refresh
 * that fails leaves the last answer in place - every value on it carries its
 * own age, which is what tells the person how old what they see is.
 */
export const HOME_REFRESH_MS = 30_000;

export const useHome = () =>
  useRead({
    queryKey: ['home'],
    queryFn: ({ signal }) => api.get<HomeAnswer>('/home', undefined, signal),
    refetchInterval: HOME_REFRESH_MS,
  });

/**
 * The home as some screen last read it, for the parts of the app around every
 * screen - the navigation, the hints over it - that need its shape and not its
 * figures. It is read once where nothing has read it yet and otherwise follows
 * whichever screen keeps it fresh, so it adds no beat of its own to a screen
 * that never asks for the home.
 */
export const useHomeShape = (enabled = true) =>
  useQuery({
    queryKey: ['home'],
    queryFn: ({ signal }) => api.get<HomeAnswer>('/home', undefined, signal),
    refetchInterval: false,
    staleTime: 5 * 60_000,
    enabled,
  });
