import type { Co2Report } from '@fg2/shared-types/v1';
import { api } from './client';
import { diaryChanged, writeEntry } from './entries';
import { useRead } from './read';
import { useWrite } from './write';

/**
 * What the CO2 cylinders of a place lasted, and the refill that starts the
 * next one. A refill is an ordinary measurement line in the place's diary,
 * carrying the two weights the old app's refill sheet wrote under the same
 * keys, so the lines migrated from it and the ones written here are one record.
 */

const co2ReportKey = (spaceId: string) => ['space', spaceId, 'co2-report'];

/** It sums the valve's openings over every cylinder: a read for the page that shows it, not for every visit to the device. */
export const useCo2Report = (spaceId: string) =>
  useRead({
    queryKey: co2ReportKey(spaceId),
    queryFn: ({ signal }) => api.get<Co2Report>(`/spaces/${spaceId}/co2-report`, undefined, signal),
  });

interface Refill {
  /** What the new cylinder holds. */
  filledGrams: number;
  /** What was left in the old one, where somebody weighed it; nothing at all is a cylinder that ran empty. */
  restGrams: number | null;
  /** The device that doses from it, which the line is filed under. */
  deviceId: string | null;
}

export const useWriteRefill = (spaceId: string) =>
  useWrite(
    ({ filledGrams, restGrams, deviceId }: Refill) =>
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
    diaryChanged,
  );
