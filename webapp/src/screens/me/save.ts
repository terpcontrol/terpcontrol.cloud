import { useQueryClient } from '@tanstack/react-query';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import { meKey, useUpdateMe } from '@/api/account';
import { useLog } from '@/log/log-context';

/**
 * The settings a write moves, by their paths ("privacy.hideCounts"): the write carries a whole object, and the
 * toast is its one setting's - the next answer of the same switch takes its place, another switch's stands beside it.
 */
const moved = (before: unknown, change: unknown, path = ''): string[] =>
  change !== null && typeof change === 'object' && !Array.isArray(change) && before !== null && typeof before === 'object'
    ? Object.entries(change).flatMap(([key, value]) => moved((before as Record<string, unknown>)[key], value, path ? `${path}.${key}` : key))
    : JSON.stringify(before) === JSON.stringify(change)
      ? []
      : [path];

/**
 * How a setting of the account is saved, the notification settings included:
 * written on the tap and answered by the toast that names what holds now, with
 * the way back - also on the page the person has gone on to, so the answer
 * hangs on the write and not on the row; a refusal is the row's to say
 * (`error`). `back` is asked of the account as it stands when it is taken
 * back - `PATCH /me` replaces each object it is given, so the way back puts
 * the one field back into the object of that moment and a setting saved in
 * between stays, and `undone` is what the toast then says holds again. `from`
 * names the control where several fields are one.
 */
type AccountBack = { to: (now: Me) => MeUpdate; undone: string };

export const useSaveAccount = () => {
  const update = useUpdateMe();
  const client = useQueryClient();
  const { tell } = useLog();
  /** The toast of a write that landed, by this hook or by another route that wrote the account. */
  const answer = (label: string, from: string, back: AccountBack | null, changed?: () => void) =>
    tell({
      label,
      from: `me:${from}`,
      ...(back ? { undo: () => update.mutateAsync(back.to(client.getQueryData<Me>(meKey)!)).then(changed), undone: back.undone } : { undo: null }),
    });

  return {
    error: update.error,
    pending: update.isPending,
    answer,
    save: (change: MeUpdate, label: string, back: AccountBack | null = null, changed?: () => void, from?: string) => {
      const before = client.getQueryData<Me>(meKey);
      const landed = () => {
        changed?.();
        answer(label, from ?? moved(before, change).join(' '), back, changed);
      };
      update.mutateAsync(change).then(landed, () => undefined);
    },
  };
};
