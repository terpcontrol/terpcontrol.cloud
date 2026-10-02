import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Co2Report } from '@fg2/shared-types/v1';
import { api } from './client';
import { diaryChanged, writeEntry } from './entries';
import { useRead } from './read';

/**
 * What the CO2 cylinders of a place lasted, and the refill that starts the
 * next one. A refill is an ordinary measurement line in the place's diary,
 * carrying the two weights the old app's refill sheet wrote under the same
 * keys, so the lines migrated from it and the ones written here are one record.
 */

export const co2ReportKey = (spaceId: string) => ['space', spaceId, 'co2-report'];

/** Read only when asked for: it sums the valve's openings over every cylinder, which is not a read to make on every visit. */
export const useCo2Report = (spaceId: string, enabled: boolean) =>
  useRead({
    queryKey: co2ReportKey(spaceId),
    queryFn: ({ signal }) => api.get<Co2Report>(`/spaces/${spaceId}/co2-report`, undefined, signal),
    enabled,
  });

export interface Refill {
  /** What the new cylinder holds. */
  filledGrams: number;
  /** What was left in the old one, where somebody weighed it; nothing at all is a cylinder that ran empty. */
  restGrams: number | null;
  /** The device that doses from it, which the line is filed under. */
  deviceId: string | null;
}

export const useWriteRefill = (spaceId: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ filledGrams, restGrams, deviceId }: Refill) =>
      writeEntry({
        kind: 'measurement',
        spaceId,
        deviceId,
        values: {
          kind: 'measurement',
          readings: [
            { key: 'co2FillingInitial', value: filledGrams, plantId: null },
            ...(restGrams === null ? [] : [{ key: 'co2FillingRest', value: restGrams, plantId: null }]),
          ],
        },
      }),
    onSuccess: () => diaryChanged(client),
  });
};
