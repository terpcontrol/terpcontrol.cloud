import { useTranslation } from 'react-i18next';
import type { Device, DeviceConfigurationPatch, PendingSetting } from '@fg2/shared-types/v1';
import { useConfigure, useDeviceLive, useHeardAt } from '@/api/devices';
import { useLog, type Back } from '@/log/log-context';
import { fieldValue, heldSetting } from '@/ui/advanced/field-values';
import { deviceLiveness } from '@/ui/age';
import { useNow } from '@/ui/useNow';
import { fieldOf, pendingByPath, pendingField } from './figures';

/** What a save did beyond storing its figures - a plan paused, control switched on - and what the way back does about it. */
export interface Also {
  now: string;
  back?: string;
}

/**
 * How every save of a device's settings is answered, whatever was set and
 * wherever: the toast that names what changed, in one form - "Temperatur am
 * Tag 26,0 °C gespeichert", and for a device that is not heard "…, noch nicht
 * am Gerät", the page's own words for it - then whatever else the save did
 * ("· Plan pausiert"), with the way to take it back where that is one write,
 * and what then holds again, said the same way. A device acknowledges
 * nothing, so nothing here says that it took anything. `from` names the
 * setting, so saving it again answers in the same toast. A state switched
 * (`state`: "Regelung aus", "Trocknung beendet") is said as the state, and
 * stored only where the device is not heard to take it.
 */
export const useSaved = (device: Device) => {
  const { t } = useTranslation();
  const { tell } = useLog();
  const offline = deviceLiveness(useHeardAt(device), useNow()) === 'offline';

  return {
    offline,
    say: (what: string, back: Back | null = null, from?: string, also?: Also, state = false) => {
      const saved = (said: string, more?: string) =>
        [state && !offline ? said : t(offline ? 'control.saved.later' : 'control.saved.now', { what: said }), more].filter(Boolean).join(' · ');
      tell({
        label: saved(what, also?.now),
        ...(back ? { undo: back.undo, undone: saved(back.undone, also?.back) } : { undo: null }),
        from: from === undefined ? undefined : `${device.id}:${from}`,
      });
    },
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
    /**
     * Stores `set` and says what holds, in the words `says` gives a set of values; true once the server has it.
     * Taken back by writing what stood before, which is then said the same way.
     */
    write: async <S extends SettingsSet>(set: S, says: (values: S) => string): Promise<boolean> => {
      const before = Object.fromEntries(Object.keys(set).map(name => [name, fieldValue(device, name)])) as S;
      try {
        await configure.mutateAsync(set);
        // A setting the document never stated has nothing to go back to.
        const whole = Object.values(before).every(value => value !== null);
        saved.say(says(set), whole ? { undo: () => configure.mutateAsync(before), undone: says(before) } : null, Object.keys(set).join(' '));
        return true;
      } catch {
        // Said under the control that asked, from the write that was refused.
        return false;
      }
    },
  };
};

export type Settings = ReturnType<typeof useSettings>;
