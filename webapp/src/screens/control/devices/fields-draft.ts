import { useCallback, useState } from 'react';
import type { Device } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { fieldValue, type FieldValue } from '@/ui/advanced/field-values';

/**
 * A draft of a device's settings by the names `CONFIGURATION_FIELDS` gives
 * them, saved together: what a smart socket, an AIR fan or a LIGHT is set to
 * under Steuerung, where several figures belong together and one Save sends
 * them, as the targets do.
 *
 * Only what was changed is sent, and the server merges it into the document
 * the device runs, so every key the panel does not know is kept. The draft
 * holds until the stored values of its own fields move: a save in flight does
 * not snap the figures back, a change made on the device itself takes them
 * over, and a change to another part of the document leaves them where they
 * were put.
 */
export const useFieldsDraft = (device: Device, names: readonly string[]) => {
  const configure = useConfigure(device.id);
  const stored: Record<string, FieldValue | null> = Object.fromEntries(names.map(name => [name, fieldValue(device, name)]));
  const against = JSON.stringify(stored);
  const [edit, setEdit] = useState<{ changes: Record<string, FieldValue>; against: string } | null>(null);
  const changes = edit && edit.against === against ? edit.changes : {};
  const discard = useCallback(() => setEdit(null), [setEdit]);

  const changed = Object.entries(changes).filter(([name, value]) => JSON.stringify(value) !== JSON.stringify(stored[name]));

  return {
    value: <T extends FieldValue>(name: string, fallback: T): T => ((name in changes ? changes[name] : stored[name]) ?? fallback) as T,
    stored: (name: string): FieldValue | null => stored[name] ?? null,
    set: (name: string, value: FieldValue) => setEdit({ changes: { ...changes, [name]: value }, against }),
    dirty: changed.length > 0,
    discard,
    /** Sends what changed; true once the server has stored it. */
    save: async (): Promise<boolean> => {
      try {
        await configure.mutateAsync(Object.fromEntries(changed));
        return true;
      } catch {
        // Shown under the bar, from the mutation that refused.
        return false;
      }
    },
    isPending: configure.isPending,
    error: configure.error,
  };
};

export type FieldsDraft = ReturnType<typeof useFieldsDraft>;
