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
import { figure, figureWithUnit, UNIT } from '@/ui/units';
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
  type SwitchRange,
  type Verdict,
} from './place';

/**
 * What a place reads now, as Start draws it: temperature, humidity, VPD and
 * CO₂, and each lamp - the tiles of a place's own Start and the figures and the
 * light line of its card among several. One list, so the two never state a
 * different figure for the same tent.
 */
export interface Reading {
  key: 'temperature' | 'humidity' | 'vpd' | 'co2' | 'light';
  label: string;
  /** The figure with its unit, "25,1 °C", as a sentence or a line states it. */
  figure: string;
  /** The figure alone and its unit, which a big figure sets smaller beside it; the unit is null for a lamp. */
  number: string;
  unit: string | null;
  /** The verdict, said to a screen reader with the figure; for the lamp when it switches next. */
  note: string | null;
  tone: 'good' | 'off' | 'quiet';
  /** What the reading is judged to be against its target, or the points a socket switches it between. */
  verdict?: Verdict;
  /** For a reading a stand-alone socket holds: the two points it switches at, which stand in for a target. */
  range?: SwitchRange | null;
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
  /** For the lamp: what a card's line says of it, "Licht aus bis 07:00", "Licht 80 % · an bis 20:00". */
  said?: string;
  /** For the lamp keeping to its schedule: when it switches next, as its tile says it - "aus um 19:00". */
  switches?: string | null;
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

/**
 * When the lamp switches next, where it keeps to its schedule - a lamp held off by day switches when somebody lets it:
 * "an bis 20:00" for a line, "aus um 20:00" for its tile, whose figure already says it is on.
 */
const lightNote = (
  t: Translate,
  { device, live }: Lamp,
  on: boolean,
  now: DateTime,
  zone: string | null,
): { note: string; at: string | null } | null => {
  const window = lightWindowOf(device, now, zone);
  if (!window) return null;
  if (window.always) return on ? { note: t('start.light.always'), at: null } : null;
  if (window.never) return on ? null : { note: t('start.light.never'), at: null };
  const half = device.type === 'light' || !live ? null : halfNowOf(device, live, now, false);
  if (on) return half === 'night' ? null : { note: t('start.light.onUntil', { time: window.off }), at: t('start.light.offAt', { time: window.off }) };
  return half === 'day' ? null : { note: t('start.light.offUntil', { time: window.on }), at: t('start.light.onAt', { time: window.on }) };
};

export const readingsOf = (t: Translate, { values, setpoints, device, lit, hold, now, zone }: ReadingsInput): Reading[] => {
  const readings: Reading[] = [];

  for (const metric of ['temperature', 'humidity', 'vpd', 'co2'] as const) {
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
      number: figure(value.value!, metric),
      unit: UNIT[metric] ?? null,
      note: verdictSaid(t, verdict, metric, now, zone),
      tone: toneOf(verdict),
      verdict,
      range,
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
    const label = lampName(t, lamp.device, lamps);
    const shown = on ? `${decimalFigure(Math.round(level.percent), 0)} %` : t('start.light.off');
    // When a lamp that keeps to its schedule switches next.
    const next = byHand || despite || age !== 'live' || dark ? null : lightNote(t, lamp, on, now, zone);
    const window = next?.note ?? null;
    const note =
      despite ??
      byHand ??
      (age !== 'live'
        ? verdictSaid(t, { kind: 'last', at: level.measuredAt }, 'temperature', now, zone)
        : dark
          ? // The figure says "Aus": the note says why, once.
            t(`start.light.darkWhy.${dark}`)
          : window);
    const reading: Reading = {
      key: 'light',
      label,
      figure: shown,
      number: shown,
      unit: null,
      note,
      tone: 'quiet',
      age,
      focus: 'light',
      lit: on,
      held: byHand,
      despite: despite !== null ? dark : null,
      deviceId: lamp.device.id,
      switches: next?.at ?? null,
    };
    // "Licht aus bis 07:00" and "Licht aus · Keimung" read as one phrase; a level and what goes with it as two.
    reading.said = byHand
      ? `${label} ${byHand}`
      : despite
        ? `${t('start.card.light', { lamp: label, level: shown })} · ${despite}`
        : !on && dark && age === 'live'
          ? `${label} ${t(`start.light.dark.${dark}`)}`
          : !on && window
            ? `${label} ${window}`
            : [readingFacts(t, [reading])[0], note].filter(Boolean).join(' · ');
    readings.push(reading);
  }

  return readings;
};

/** The readings as facts of a line, "24,3 °C", "66 %", "Licht 80 %": what the line under the figures starts a lamp with. */
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

/** Whether the lamp is dark: by its own reading where the place has one, else by the light that reaches the leaf. */
export const darkOf = (readings: Reading[], values: CardValue[]): boolean => {
  const lamps = readings.filter(reading => reading.key === 'light');
  if (lamps.length > 0) return !lamps.some(lamp => lamp.lit);
  const lux = valueOf(values, 'lux');
  return lux !== null && lux.value! <= 0;
};
