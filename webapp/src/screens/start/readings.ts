import type { DateTime } from 'luxon';
import type { CardSetpoint, CardValue, Device, DeviceLive, ValueState } from '@fg2/shared-types/v1';
import { timelinePath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import type { OutputLevel } from '@/api/devices';
import { heldWords, lampName, litInTheDark } from '@/screens/control/held-light';
import type { Held } from '@/screens/devices/HandHold';
import { valueAge } from '@/ui/age';
import { type DarkSpell, darkSpellOf } from '@/ui/climate-hardware';
import { decimalFigure } from '@/ui/figures';
import { figure, figureWithUnit } from '@/ui/units';
import {
  halfNowOf,
  judgedOf,
  lightWindowOf,
  rangeVerdictOf,
  setpointOf,
  switchRangeOf,
  valueOf,
  verdictSaid,
  type HumidifierHold,
  type Verdict,
} from './place';

/**
 * What a place reads now, as Start draws it: temperature, humidity, VPD and
 * the lamp - in the camera's picture where there is one, as four tiles where
 * there is none, and as one line on a place's card. One list, so the three
 * never state a different figure for the same tent.
 */
export interface Reading {
  key: 'temperature' | 'humidity' | 'vpd' | 'light';
  label: string;
  figure: string;
  /** Under a tile's figure: the verdict, or for the lamp when it switches next. */
  note: string | null;
  tone: 'good' | 'off' | 'quiet';
  /** Whether the note is a verdict against a band, which the first tile to carry one explains. */
  judged: boolean;
  age: ValueState;
  /** The panel of Verlauf the reading is drawn on; null for one that has none of its own. */
  focus: string | null;
  /** For the lamp: whether it is on. */
  lit?: boolean;
  /** For the lamp: that it is held by hand, in words - "von Hand aus bis 13:05". */
  held?: string | null;
  /** For the lamp: that it burns where the place germinates in the dark, which its note says why. */
  despite?: DarkSpell | null;
  /** For the lamp: the device whose light it is, which tells two lamps of a place apart. */
  deviceId?: string;
}

/** A lamp of the place as it last reported (`useLamp`): what its light output runs at, and whether it is held by hand. */
export interface Lamp {
  device: Device;
  level: OutputLevel;
  /** The device's live read, which says the half of the day it is in; null where only its level was read. */
  live: DeviceLive | null;
  /** Held by hand (`useHeldLight`), which then keeps to no schedule. */
  held: Held | null;
}

interface ReadingsInput {
  values: CardValue[];
  setpoints: CardSetpoint[];
  /** The device holding the climate, whose document says when the light comes on. */
  device: Device | null;
  /** The place's lamps that reported, each named where there are several: each is controlled on its own. */
  lit: readonly Lamp[];
  hold: HumidifierHold | null;
  now: DateTime;
  zone: string | null;
}

const toneOf = (verdict: Verdict): Reading['tone'] =>
  verdict?.kind === 'in' ? 'good' : verdict?.kind === 'high' || verdict?.kind === 'low' ? 'off' : 'quiet';

/** "an bis 20:00": when the lamp switches next, where it keeps to its schedule - a lamp held off by day switches when somebody lets it. */
const lightNote = (t: Translate, { device, live }: Lamp, on: boolean, now: DateTime, zone: string | null): string | null => {
  const window = lightWindowOf(device, now, zone);
  if (!window) return null;
  if (window.always) return on ? t('start.light.always') : null;
  if (window.never) return on ? null : t('start.light.never');
  const half = device.type === 'light' || !live ? null : halfNowOf(device, live, now, false);
  if (on) return half === 'night' ? null : t('start.light.onUntil', { time: window.off });
  return half === 'day' ? null : t('start.light.offUntil', { time: window.on });
};

export const readingsOf = (t: Translate, { values, setpoints, device, lit, hold, now, zone }: ReadingsInput): Reading[] => {
  const readings: Reading[] = [];

  for (const metric of ['temperature', 'humidity', 'vpd'] as const) {
    const value = valueOf(values, metric);
    if (!value) continue;
    const setpoint = setpointOf(setpoints, metric);
    // A smart socket standing alone holds its reading between its switch points rather than at a target.
    const range = metric !== 'vpd' && setpoint?.value == null ? switchRangeOf(device, metric, now) : null;
    const verdict = range ? rangeVerdictOf(value, range, now) : judgedOf(value, setpoint, hold, now);
    readings.push({
      key: metric,
      label: t(`home.metric.${metric}`),
      figure: figureWithUnit(value.value!, metric),
      note: verdictSaid(t, verdict, metric, now, zone),
      tone: toneOf(verdict),
      judged: verdict?.kind === 'in' || verdict?.kind === 'high' || verdict?.kind === 'low',
      age: valueAge(value, now),
      focus: metric === 'vpd' ? null : metric,
    });
  }

  const lamps = lit.map(lamp => lamp.device);
  // Germination and drying are dark for every lamp of the place: one off is off for it, and one that burns says why.
  const dark = darkSpellOf(device);
  for (const lamp of lit) {
    const { level, held } = lamp;
    const age = valueAge(level, now);
    const on = level.percent > 0;
    // Held by hand, the lamp switches when the hold ends and not by its schedule.
    const byHand = held && age === 'live' ? heldWords(t, held, now, zone) : null;
    const despite = dark && on && age === 'live' ? litInTheDark(t, dark, lamp.device, held, now, zone) : null;
    readings.push({
      key: 'light',
      label: lampName(t, lamp.device, lamps),
      figure: on ? `${decimalFigure(Math.round(level.percent), 0)} %` : t('start.light.off'),
      note:
        despite ??
        byHand ??
        (age !== 'live'
          ? verdictSaid(t, { kind: 'last', at: level.measuredAt }, 'temperature', now, zone)
          : dark
            ? // The figure says "Aus": the note says why, once.
              t(`start.light.darkWhy.${dark}`)
            : lightNote(t, lamp, on, now, zone)),
      tone: 'quiet',
      judged: false,
      age,
      focus: 'light',
      lit: on,
      held: byHand,
      despite: despite !== null ? dark : null,
      deviceId: lamp.device.id,
    });
  }

  return readings;
};

/** The readings as a place's card states them, fact by fact: "24,3 °C", "66 %", "Licht 80 %". */
export const readingFacts = (t: Translate, readings: Reading[]): string[] =>
  readings
    .filter(reading => reading.key !== 'vpd')
    .map(reading =>
      reading.key !== 'light'
        ? reading.figure
        : reading.held
          ? `${reading.label} ${reading.held}`
          : reading.lit
            ? reading.despite
              ? t(`start.card.lightDespite.${reading.despite}`, { lamp: reading.label, level: reading.figure })
              : t('start.card.light', { lamp: reading.label, level: reading.figure })
            : t('start.card.lightOff', { lamp: reading.label }),
    );

/** Where a reading's curve is drawn: its panel of Verlauf. */
export const curvePath = (spaceId: string, reading: Pick<Reading, 'key' | 'focus'>): string =>
  timelinePath(spaceId, reading.key === 'vpd' ? 'vpd' : reading.focus);

/** One of the further readings: its words and the panel of Verlauf it is drawn on. */
export interface Extra {
  key: 'co2' | 'leaf' | 'lux' | 'ppfd';
  text: string;
  focus: string;
}

/**
 * What only some places measure - CO₂, the leaf, the light that reaches it -
 * each with the panel of Verlauf it opens. While the lamp is dark the two
 * light figures are left out: "0 lx · PPFD 0" says nothing the lamp's own
 * reading has not said. Empty where no such sensor reports.
 */
export const extrasOf = (t: Translate, values: CardValue[], dark: boolean): Extra[] => {
  const co2 = valueOf(values, 'co2');
  const leaf = valueOf(values, 'leafTemperature');
  const lux = dark ? null : valueOf(values, 'lux');
  const ppfd = dark ? null : valueOf(values, 'ppfd');

  return [
    co2 ? { key: 'co2' as const, text: t('start.extra.co2', { value: figureWithUnit(co2.value!, 'co2') }), focus: 'co2' } : null,
    leaf
      ? { key: 'leaf' as const, text: t('start.extra.leaf', { value: figureWithUnit(leaf.value!, 'leafTemperature') }), focus: 'leafTemperature' }
      : null,
    lux ? { key: 'lux' as const, text: t('start.leaf.lux', { value: figure(lux.value!, 'lux') }), focus: 'lux' } : null,
    ppfd ? { key: 'ppfd' as const, text: t('start.leaf.ppfd', { value: decimalFigure(Math.round(ppfd.value!), 0) }), focus: 'ppfd' } : null,
  ].filter((part): part is Extra => part !== null);
};

/** Whether the lamp is dark: by its own reading where the place has one, else by the light that reaches the leaf. */
export const darkOf = (readings: Reading[], values: CardValue[]): boolean => {
  const lamps = readings.filter(reading => reading.key === 'light');
  if (lamps.length > 0) return !lamps.some(lamp => lamp.lit);
  const lux = valueOf(values, 'lux');
  return lux !== null && lux.value! <= 0;
};
