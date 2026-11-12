import { DateTime } from 'luxon';
import { useState } from 'react';
import type { GrowCreate, GrowthStage } from '@fg2/shared-types/v1';
import { useCreateGrow } from '@/api/grows';
import { useChooseDiary, useDiaryDeclined } from '@/api/layers';
import { useAddPhase } from '@/api/lifecycle';
import { instantOf } from '@/ui/age';

/**
 * Starting a grow is two writes: the grow exists from the moment it is sown,
 * and its day counter runs from its first phase - which, where the form asks
 * for that, puts the place on the stage's climate as it is written. Each step
 * is skipped once it has succeeded, so a refusal is retried rather than
 * repeated: a second tap after a refused phase does not make a second grow.
 */
export const useStartGrow = () => {
  const createGrow = useCreateGrow();
  const startingPhase = useAddPhase();
  const declined = useDiaryDeclined();
  const chooseDiary = useChooseDiary();
  const [made, setMade] = useState<string | null>(null);

  const start = async ({
    body,
    stage,
    startedAt,
    climate,
  }: {
    body: GrowCreate;
    stage: GrowthStage;
    startedAt: Date;
    /** Whether the controllers of the place are put on the stage's climate; a stage that is only recorded moves nothing. */
    climate: boolean;
  }): Promise<string> => {
    let growId = made;
    if (growId === null) {
      growId = (await createGrow.mutateAsync(body)).id;
      setMade(growId);
      // A grow lives in the diary: starting one switches it back on for an account that had switched it off. Where
      // that is refused the grow stands all the same, and Ich › Darstellung switches the diary.
      if (declined) await chooseDiary.mutateAsync('on').catch(() => undefined);
    }
    await startingPhase.mutateAsync({
      growId,
      body: { stage, preset: null, ...(climate ? { climate: true } : {}), startedAt: instantOf(DateTime.fromJSDate(startedAt)) },
    });
    return growId;
  };

  return { start, busy: createGrow.isPending || startingPhase.isPending, refused: createGrow.error ?? startingPhase.error };
};
