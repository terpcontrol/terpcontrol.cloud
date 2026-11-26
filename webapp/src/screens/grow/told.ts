import { useLog } from '@/log/log-context';

interface Write<V> {
  mutate: (change: V, options?: { onSuccess?: () => void }) => void;
  mutateAsync: (change: V) => Promise<unknown>;
}

/**
 * A write that answers: once it has landed the toast says what holds now (`label`) and offers what stood before
 * (`back.to`, one write away: a grow's scheme or its measurements, a plant's name, a scheme on the shelf) with what
 * holds again once that is taken (`back.undone`). `back` is null where no one write brings it back; `then` runs first.
 */
export const useAnswered = <V>(write: Write<V>, from: string) => {
  const { tell } = useLog();

  return (change: V, label: string, back: { to: V; undone: string } | null, then?: () => void) =>
    write.mutate(change, {
      onSuccess: () => {
        then?.();
        tell({ label, from, ...(back ? { undo: () => write.mutateAsync(back.to), undone: back.undone } : { undo: null }) });
      },
    });
};
