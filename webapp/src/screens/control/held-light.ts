import type { DateTime } from 'luxon';
import type { Device } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSocketTables } from '@/api/devices';
import type { Translate } from '@/i18n/i18n';
import type { Held } from '@/screens/devices/HandHold';
import { isLightRole, useLightHold } from '@/screens/devices/lights';
import { inSentence } from '@/screens/space/members/people';
import { lightWindowOf } from '@/screens/start/place';
import { sinceLabel } from '@/ui/age';
import { outputsOf } from '@/ui/climate-hardware';
import { deviceName, deviceTitle, givenName } from '@/ui/naming';

/**
 * A device's lamp held by hand, for every place that says what the light is
 * doing: its own light output as this browser last asked for it (the device
 * reports no hold of it, see `useLightHold`), else a light socket its table
 * says is held. Null for a lamp that keeps to its schedule.
 */
export const useHeldLight = (device: Device | null, now: DateTime): Held | null => {
  const hosts = device !== null && SOCKET_HOST_TYPES.includes(device.type);
  const output = useLightHold(hosts ? device.id : '', now);
  const table = useSocketTables(hosts ? [device.id] : []).tables.get(device?.id ?? '');
  const socket = table?.items.find(one => isLightRole(one.role) && one.override && one.override.state !== 'auto')?.override;

  return output ?? (socket && socket.state !== 'auto' ? { state: socket.state, until: socket.validUntil } : null);
};

/** "von Hand aus bis 13:05". */
export const heldWords = (t: Translate, held: Held, now: DateTime, zone: string | null): string =>
  t(`devices.lightOutput.holding.${held.state}`, { until: sinceLabel(held.until, now, zone) });

/** The devices among these that light the place: a controller's or a fridge module's light output, a lamp module. */
export const lampsAmong = (devices: readonly Device[]): Device[] => devices.filter(device => outputsOf(device).includes('light'));

/**
 * What one lamp is called where its light is shown or set. Each lamp of a place is controlled on its own, so where
 * `lamps` holds more than one each is named alike - "Licht · Controller", "Licht · Lampenmodul" -, and one alone is
 * the place's "Licht".
 */
export const lampName = (t: Translate, device: Device, lamps: readonly Device[]): string =>
  lamps.length < 2 ? t('control.rows.light') : t('control.light.of', { device: deviceTitle(device, t, [...lamps]) });

/**
 * "Es setzt das Licht des Controllers": whose light a climate sets, by the device's type where it has no name of its
 * own - German says a type in the genitive - and by its name, quoted, where it has one.
 */
const lampSetWords = (t: Translate, device: Device): string => {
  const name = givenName(device);
  return name
    ? t('control.preset.lampSetNamed', { device: name })
    : t(`control.preset.lampSetOf.${device.type}`, { defaultValue: t('control.preset.lampSetNamed', { device: deviceName(device, t) }) });
};

/**
 * What a climate written to `device` does to each lamp of its place, where there is more than one: whose light it
 * sets and what each other lamp keeps, or - germination being dark for every lamp of the place (ADR 0007), a lamp
 * module's too - that all of them stay off until it ends. Null where `device` is the place's one lamp, or none.
 */
export const lampsSaid = (
  t: Translate,
  device: Device,
  lamps: readonly Device[],
  germination: boolean,
  now: DateTime,
  zone: string | null,
  language: string,
): string | null => {
  if (lamps.length < 2 || !lamps.some(one => one.id === device.id)) return null;
  if (germination)
    return t('control.preset.lampsDark', {
      lamps: inSentence(
        lamps.map(one => lampName(t, one, lamps)),
        language,
      ),
    });
  return [lampSetWords(t, device), ...lampsLeft(t, device, lamps, now, zone)].join(' ');
};

/**
 * Why a lamp burns where its place germinates in the dark (ADR 0007) - held on by hand, set bright on its own since,
 * or not yet handed the dark -, so that no screen shows a lit lamp under "dunkel" without saying it is lit and why:
 * "trotz Keimung · von Hand an bis 13:05".
 */
export const litInTheDark = (t: Translate, lamp: Device, held: Held | null, now: DateTime, zone: string | null): string => {
  const limit = lamp.type === 'light' ? lamp.configuration?.limit : undefined;
  const why = held
    ? heldWords(t, held, now, zone)
    : typeof limit === 'number' && limit > 0
      ? t('control.light.inGermination.own')
      : t('control.light.inGermination.coming');
  return t('control.light.inGermination.lit', { why });
};

/**
 * "Lampenmodul bleibt bei 07:00 bis 23:00": the other lamps of a place, each with its window, which a climate written
 * to `device` leaves burning as they do. Empty where `device` is the place's one lamp.
 */
export const lampsLeft = (t: Translate, device: Device, lamps: readonly Device[], now: DateTime, zone: string | null): string[] =>
  lamps
    .filter(one => one.id !== device.id)
    .map(one => {
      const light = lightWindowOf(one, now, zone);
      const window = !light
        ? null
        : light.always
          ? t('start.light.always')
          : light.never
            ? t('start.light.never')
            : t('start.targets.window', { on: light.on, off: light.off });
      return t(window ? 'control.preset.lampLeft' : 'control.preset.lampLeftAsIs', { lamp: lampName(t, one, lamps), window });
    });
