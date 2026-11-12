import { DateTime } from 'luxon';
import { useState } from 'react';
import type { GrowCreate, GrowthStage, PresetApplicationCreate } from '@fg2/shared-types/v1';
import { useCreateGrow } from '@/api/grows';
import { useAddPhase, useApplyPreset } from '@/api/lifecycle';
import { instantOf } from '@/ui/age';

/**
 * Starting a grow is two writes and sometimes a third: the grow exists from
 * the moment it is sown, its day counter runs from its first phase, and the
 * climate of the place it stands in is written where the form asks for that.
 * Each step is skipped once it has succeeded, so a refusal is retried rather
 * than repeated - a second tap after a refused phase does not make a second
 * grow. `made` says what already stands.
 */
export const useStartGrow = (spaceId: string | null) => {
  const createGrow = useCreateGrow();
  const startingPhase = useAddPhase();
  const applyPreset = useApplyPreset(spaceId ?? '');
  const [made, setMade] = useState<{ growId: string | null; phaseDone: boolean; climateDone: boolean }>({
    growId: null,
    phaseDone: false,
    climateDone: false,
  });

  const start = async ({
    body,
    stage,
    preset = null,
    startedAt,
    climate = null,
  }: {
    body: GrowCreate;
    stage: GrowthStage;
    preset?: string | null;
    startedAt: Date;
    /** The preset application that puts the place on the stage's climate; null where the grow is only recorded. */
    climate?: PresetApplicationCreate | null;
  }): Promise<string> => {
    let growId = made.growId;
    if (growId === null) {
      growId = (await createGrow.mutateAsync(body)).id;
      setMade(state => ({ ...state, growId }));
    }
    if (!made.phaseDone) {
      await startingPhase.mutateAsync({ growId, body: { stage, preset, startedAt: instantOf(DateTime.fromJSDate(startedAt)) } });
      setMade(state => ({ ...state, phaseDone: true }));
    }
    if (climate && !made.climateDone) {
      await applyPreset.mutateAsync(climate);
      setMade(state => ({ ...state, climateDone: true }));
    }
    return growId;
  };

  return {
    start,
    made,
    busy: createGrow.isPending || startingPhase.isPending || applyPreset.isPending,
    refused: createGrow.error ?? startingPhase.error ?? applyPreset.error,
  };
};
