import { useTranslation } from 'react-i18next';
import type { Device, DeviceConfigurationPatch, PendingSetting } from '@fg2/shared-types/v1';
import { useConfigure, useDeviceLive, useHeardAt } from '@/api/devices';
import { useLog } from '@/log/log-context';
import { fieldValue, heldSetting } from '@/ui/advanced/field-values';
import { deviceLiveness } from '@/ui/age';
import { useNow } from '@/ui/useNow';
import { fieldOf, pendingByPath, pendingField } from './figures';

/**
 * How every save of a device's settings is answered, whatever was set and
 * wherever: the toast that names what changed - "… gespeichert", and for a
 * device that is not heard "noch nicht am Gerät", the page's own words for
 * it - with the way to take it back where that is one write. A device
 * acknowledges nothing, so nothing here says that it took anything. `from`
 * names the setting, so saving it again answers in the same toast.
 */
export const useSaved = (device: Device) => {
  const { t } = useTranslation();
  const { tell } = useLog();
  const offline = deviceLiveness(useHeardAt(device), useNow()) === 'offline';

  return {
    offline,
    say: (what: string, undo: (() => Promise<unknown>) | null = null, from?: string) =>
      tell({
        label: t(offline ? 'control.saved.later' : 'control.saved.now', { what }),
        undo,
        from: from === undefined ? undefined : `${device.id}:${from}`,
      }),
  };
};

/**
 * The settings of a device's document beyond its targets, by the names
 * `CONFIGURATION_FIELDS` gives them. One write for all of them - only what is
 * named is sent, and the server keeps every other key - answered as the
 * targets are.
 */
type SettingsSet = DeviceConfigurationPatch['set'];

export const useSettings = (device: Device) => {
  const configure = useConfigure(device.id);
  const saved = useSaved(device);
  const pending = pendingByPath(useDeviceLive(device.id).data?.pending);

  return {
    offline: saved.offline,
    /** The answer alone, for a setting of the device that is written another way. */
    say: saved.say,
    /** What the device has not been handed, by its path in the document. */
    pending,
    busy: configure.isPending,
    error: configure.error,
    /** What is on its way to the server, shown rather than what it replaces. */
    asked: (name: string): SettingsSet[string] | undefined => (configure.isPending ? configure.variables?.[name] : undefined),
    /**
     * What the device has not been handed of a setting. One it holds in another spelling of the same thing - a
     * switch its document kept as `false` and the cloud now stores as 0 - is not a setting it has yet to take.
     */
    held: (name: string): PendingSetting | undefined => {
      const held = pendingField(pending, device, name);
      const field = fieldOf(device, name);
      const before = held && field ? heldSetting(field, held.held) : null;
      return before !== null && JSON.stringify(before) === JSON.stringify(fieldValue(device, name)) ? undefined : held;
    },
    /** Stores `set` and says `what` changed; true once the server has it. Taken back by writing what stood before. */
    write: async (set: SettingsSet, what: string): Promise<boolean> => {
      const before = Object.entries(set).map(([name]) => [name, fieldValue(device, name)] as const);
      try {
        await configure.mutateAsync(set);
        // A setting the document never stated has nothing to go back to.
        const whole = before.every(([, value]) => value !== null);
        saved.say(what, whole ? () => configure.mutateAsync(Object.fromEntries(before) as SettingsSet) : null, Object.keys(set).join(' '));
        return true;
      } catch {
        // Said under the control that asked, from the write that was refused.
        return false;
      }
    },
  };
};

export type Settings = ReturnType<typeof useSettings>;
