import { useQueryClient } from '@tanstack/react-query';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import { meKey, useUpdateMe } from '@/api/account';
import { useLog } from '@/log/log-context';

/**
 * The settings a write moves, by their paths ("privacy.hideCounts"): the write carries a whole object, and the
 * toast is its one setting's - the next answer of the same switch takes its place, another switch's stands beside it.
 */
export const moved = (before: unknown, change: unknown, path = ''): string[] =>
  change !== null && typeof change === 'object' && !Array.isArray(change) && before !== null && typeof before === 'object'
    ? Object.entries(change).flatMap(([key, value]) => moved((before as Record<string, unknown>)[key], value, path ? `${path}.${key}` : key))
    : JSON.stringify(before) === JSON.stringify(change)
      ? []
      : [path];

/**
 * How a setting of the account is saved: written on the tap and answered by
 * the toast that names what holds now, with the way back. `back` is asked of
 * the account as it stands when it is taken back - `PATCH /me` replaces each
 * object it is given, so the way back puts the one field back into the object
 * of that moment and a setting saved in between stays.
 */
export const useSaveAccount = () => {
  const update = useUpdateMe();
  const client = useQueryClient();
  const { tell } = useLog();

  return {
    error: update.error,
    save: (change: MeUpdate, label: string, back: ((now: Me) => MeUpdate) | null = null, changed?: () => void) => {
      const before = client.getQueryData<Me>(meKey);
      update.mutate(change, {
        onSuccess: () => {
          changed?.();
          tell({
            label,
            from: `me:${moved(before, change).join(' ')}`,
            undo: back ? () => update.mutateAsync(back(client.getQueryData<Me>(meKey)!)).then(changed) : null,
          });
        },
      });
    },
  };
};
