import type { DateTime } from 'luxon';
import type { CardSetpoint, CardValue, Device, DeviceLive, ValueState } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { valueAge } from '@/ui/age';
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
}

interface ReadingsInput {
  values: CardValue[];
  setpoints: CardSetpoint[];
  /** The device holding the climate, whose document says when the light comes on. */
  device: Device | null;
  /** What the device with the place's lamp last reported, and that device. */
  lit: { device: Device; live: DeviceLive } | null;
  hold: HumidifierHold | null;
  now: DateTime;
  zone: string | null;
}

const toneOf = (verdict: Verdict): Reading['tone'] =>
  verdict?.kind === 'in' ? 'good' : verdict?.kind === 'high' || verdict?.kind === 'low' ? 'off' : 'quiet';

/** "an bis 20:00": when the lamp switches next, where it keeps to its schedule - a lamp held off by day switches when somebody lets it. */
const lightNote = (
  t: Translate,
  { device, live }: { device: Device; live: DeviceLive },
  on: boolean,
  now: DateTime,
  zone: string | null,
): string | null => {
  const window = lightWindowOf(device, now, zone);
  if (!window) return null;
  if (window.always) return on ? t('start.light.always') : null;
  if (window.never) return on ? null : t('start.light.never');
  const half = device.type === 'light' ? null : halfNowOf(device, live, now, false);
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

  const level = lit?.live.outputs.light ?? null;
  if (lit && level?.value != null) {
    const age = valueAge(level, now);
    const on = level.value > 0;
    readings.push({
      key: 'light',
      label: t('start.metric.light'),
      figure: on ? `${decimalFigure(Math.round(level.value), 0)} %` : t('start.light.off'),
      note: age === 'live' ? lightNote(t, lit, on, now, zone) : verdictSaid(t, { kind: 'last', at: level.measuredAt }, 'temperature', now, zone),
      tone: 'quiet',
      judged: false,
      age,
      focus: 'light',
    });
  }

  return readings;
};

/** The readings in one line, as a place's card states them: "24,3 °C · 66 % · Licht 80 %". */
export const readingsLine = (t: Translate, readings: Reading[]): string =>
  readings
    .filter(reading => reading.key !== 'vpd')
    .map(reading =>
      reading.key === 'light'
        ? reading.figure.endsWith('%')
          ? t('start.card.light', { level: reading.figure })
          : t('start.card.lightOff')
        : reading.figure,
    )
    .join(' · ');

/**
 * What only some places measure - CO₂, the leaf, the light that reaches it -
 * in one line under the readings, and the panel of Verlauf it opens. Null
 * where no such sensor reports.
 */
export const extrasOf = (t: Translate, values: CardValue[]): { text: string; focus: string } | null => {
  const co2 = valueOf(values, 'co2');
  const leaf = valueOf(values, 'leafTemperature');
  const lux = valueOf(values, 'lux');
  const ppfd = valueOf(values, 'ppfd');
  const parts = [
    co2 ? t('start.extra.co2', { value: figureWithUnit(co2.value!, 'co2') }) : null,
    leaf ? t('start.extra.leaf', { value: figureWithUnit(leaf.value!, 'leafTemperature') }) : null,
    lux ? t('start.leaf.lux', { value: figure(lux.value!, 'lux') }) : null,
    ppfd ? t('start.leaf.ppfd', { value: decimalFigure(Math.round(ppfd.value!), 0) }) : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : { text: parts.join(' · '), focus: co2 ? 'co2' : leaf ? 'leafTemperature' : 'lux' };
};
