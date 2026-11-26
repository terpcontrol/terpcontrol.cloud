import type { DateTime } from 'luxon';
import type { Device } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSocketTables } from '@/api/devices';
import type { Translate } from '@/i18n/i18n';
import type { Held } from '@/screens/devices/HandHold';
import { isLightRole, useLightHold } from '@/screens/devices/lights';
import { lightWindowOf } from '@/screens/start/place';
import { sinceLabel } from '@/ui/age';
import { type DarkSpell, outputsOf } from '@/ui/climate-hardware';
import { type Called, deviceName, deviceTitle, givenName } from '@/ui/naming';
import { figureText } from './climate/figures';

/**
 * A device's lamp held by hand, for every place that says what the light is
 * doing: its own light output as the device reports it, or as this browser
 * last asked for it where its build does not (`useLightHold`), else a light socket its table
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
export const lampName = (t: Translate, device: Called, lamps: readonly Called[]): string =>
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
 * sets and what each other lamp keeps, or - germination and drying being dark for every lamp of the place (ADR 0007),
 * a lamp module's too - that all of them stay off while it lasts. Null where `device` is the place's one lamp, or none.
 */
export const lampsSaid = (
  t: Translate,
  device: Device,
  lamps: readonly Device[],
  dark: DarkSpell | null,
  now: DateTime,
  zone: string | null,
): string | null => {
  if (lamps.length < 2 || !lamps.some(one => one.id === device.id)) return null;
  if (dark)
    return t(`control.preset.lampsDark.${dark}`, {
      lamps: lamps.length === 2 ? t('control.preset.lampsBoth') : t('control.preset.lampsAll', { count: lamps.length }),
    });
  return [lampSetWords(t, device), ...lampsLeft(t, device, lamps, now, zone)].join(' ');
};

/**
 * Why a lamp burns where its place germinates or dries in the dark (ADR 0007) - held on by hand, set bright since the
 * spell darkened it (it keeps the brightness from before, `limitBeforeDark`), or not yet handed the dark -, so that no
 * screen shows a lit lamp under "dunkel" without saying it is lit and why: "trotz Keimung · von Hand an bis 13:05".
 */
export const litInTheDark = (t: Translate, spell: DarkSpell, lamp: Device, held: Held | null, now: DateTime, zone: string | null): string => {
  const limit = lamp.type === 'light' ? lamp.configuration?.limit : undefined;
  const why = held
    ? heldWords(t, held, now, zone)
    : typeof limit === 'number' && limit > 0 && typeof lamp.state.limitBeforeDark === 'number'
      ? t('control.light.inTheDark.own')
      : t('control.light.inTheDark.coming');
  return t(`control.light.inTheDark.lit.${spell}`, { why });
};

/**
 * "Das Lampenmodul", "„Bluetooth-Lampe“": a lamp as the subject of a sentence - a tile's "Licht · Lampenmodul" is a
 * label, not a noun -, by its name where it has one, else by its type, with the tag that tells two alike apart.
 */
const lampSubject = (t: Translate, device: Device, lamps: readonly Device[]): string => {
  const name = givenName(device);
  if (name) return t('control.preset.lampNamed', { device: name });
  const tag = deviceTitle(device, t, [...lamps]).slice(deviceName(device, t).length);
  return `${t(`control.preset.theLamp.${device.type}`, { defaultValue: deviceName(device, t) })}${tag}`;
};

/** The brightness a lamp module darkened by its place's spell gets back when the spell ends; null for one not darkened. */
const keptBrightness = (lamp: Device): number | null => {
  const kept = lamp.state.limitBeforeDark;
  return lamp.type === 'light' && lamp.configuration?.limit === 0 && typeof kept === 'number' && kept > 0 ? kept : null;
};

/**
 * A lamp module where its place germinates or dries (ADR 0007), said where the lamp itself is shown - its page, its
 * card, a move into such a place: "dunkel, solange der Ort keimt · danach wieder 100 %", or lit, how bright and why -
 * "5 % trotz Keimung · …", as Ausgänge says it.
 */
export const lampInTheDark = (t: Translate, spell: DarkSpell, lamp: Device, now: DateTime, zone: string | null, held: Held | null = null): string => {
  const limit = lamp.configuration?.limit;
  const lit = typeof limit === 'number' && limit > 0;
  if (held || lit) return [lit ? figureText('lightLimit', limit) : null, litInTheDark(t, spell, lamp, held, now, zone)].filter(Boolean).join(' ');
  const kept = keptBrightness(lamp);
  return [t(`control.light.darkened.${spell}`), kept === null ? null : t('control.light.darkenedBack', { level: figureText('lightLimit', kept) })]
    .filter(Boolean)
    .join(' · ');
};

/** "Das Lampenmodul bekommt wieder 100 %": each lamp module of `lamps` a spell darkened, and what it gets back when it ends. */
export const lampsBack = (t: Translate, lamps: readonly Device[], among: readonly Device[] = lamps): string[] =>
  lamps.flatMap(one => {
    const kept = keptBrightness(one);
    return kept === null ? [] : [t('control.preset.lampBack', { lamp: lampSubject(t, one, among), level: figureText('lightLimit', kept) })];
  });

/**
 * "Das Lampenmodul bleibt bei 07:00 bis 23:00": the other lamps of a place, each with its window, which a climate
 * written to `device` leaves burning as they do - and one its place's spell darkened, the brightness it gets back
 * (`lampsBack`). Empty where `device` is the place's one lamp.
 */
export const lampsLeft = (t: Translate, device: Device, lamps: readonly Device[], now: DateTime, zone: string | null): string[] =>
  lamps
    .filter(one => one.id !== device.id)
    .map(one => {
      const [back] = lampsBack(t, [one], lamps);
      if (back) return back;
      const light = lightWindowOf(one, now, zone);
      const window = !light
        ? null
        : light.always
          ? t('start.light.always')
          : light.never
            ? t('start.light.never')
            : t('start.targets.window', { on: light.on, off: light.off });
      return t(window ? 'control.preset.lampLeft' : 'control.preset.lampLeftAsIs', { lamp: lampSubject(t, one, lamps), window });
    });
