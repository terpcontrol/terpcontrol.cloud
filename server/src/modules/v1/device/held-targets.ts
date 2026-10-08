import type { Metric, PhaseTargets, TargetBand } from '@fg2/shared-types/v1';
import { TARGET_BAND } from '@fg2/shared-types/v1-schemas';
import { cycleAt, SETTLE_SECONDS, type Cycle } from '@fg2/shared-types/v1-schemas/day-night.js';
import { reportsNoSensor } from '@common/v1/sentinels';

/**
 * What a device held at an instant of its past, from one row of its target
 * record (`target-record.ts`): which figures, in which half, and what counted
 * as on target meanwhile.
 *
 * The verdict over the last day, the bands of the Timeline and the live card's
 * hour after a change all ask it of the record rather than of the document as
 * it stands now. Judged by the document of now, a light moved from eight to
 * one o'clock turned the morning that had been a day into a night after the
 * fact, and the cockpit said "4.7 °C too high since 08:12" about a fridge that
 * had been on its day's target all morning.
 */

export type Figures = Partial<Record<Metric, number>>;

/** What a work mode holds of the targets, where it does not hold all of them. */
export interface Held {
  metrics: readonly Metric[];
  /** Whether it knows no day: drying and germination hold the night's figures round the clock. */
  nightOnly: boolean;
}

/**
 * Switched off the firmware holds nothing. Drying and germination know no day
 * - the firmware calls neither one - and hold the night's figures: drying its
 * temperature and humidity without CO2, germination the temperature alone. The
 * greenhouse mode holds no humidity. A figure a mode does not hold is not one
 * the tent can be judged by, however it reads.
 */
export const HELD: Readonly<Record<string, Held>> = {
  off: { metrics: [], nightOnly: false },
  dry: { metrics: ['temperature', 'humidity'], nightOnly: true },
  breed: { metrics: ['temperature'], nightOnly: true },
  temp: { metrics: ['temperature', 'co2'], nightOnly: false },
};

/** The modes that hold every figure: the standard one, energy saving or not. A word the firmware does not know is run as off. */
const holdsAll = (workmode: string | null): boolean => workmode === null || workmode === 'small' || workmode === 'full';

const heldBy = (workmode: string | null): Held | null => (holdsAll(workmode) ? null : (HELD[workmode!] ?? HELD.off));

/**
 * The figures a recorded climate holds in each half, by the work mode it ran:
 * the day's CO2 and no night's, the night's alone where the mode knows no day,
 * nothing switched off, and nothing a sensor the device does not have would
 * measure.
 */
export const halvesHeld = (targets: PhaseTargets | null, workmode: string | null, hardware: Record<string, string> = {}) =>
  halvesHeldBy(targets, heldBy(workmode), hardware);

/** The figures held in each half by what a mode holds (`null`: every figure). */
export const halvesHeldBy = (
  targets: PhaseTargets | null,
  held: Held | null,
  hardware: Record<string, string> = {},
): { day: Figures; night: Figures } => {
  if (!targets) return { day: {}, night: {} };

  const pick = (half: 'day' | 'night'): Figures => {
    const source: [Metric, number | null][] = [
      ['temperature', targets[half].temperature],
      ['humidity', targets[half].humidity],
      ['co2', half === 'day' ? targets.co2 : null],
    ];
    return Object.fromEntries(
      source.filter(([metric, value]) => value !== null && !reportsNoSensor(hardware, metric) && (held === null || held.metrics.includes(metric))),
    ) as Figures;
  };

  return { day: held?.nightOnly ? {} : pick('day'), night: pick('night') };
};

/** The band around a figure, or none where there is no figure or no band for the metric. */
export const bandAround = (metric: Metric, value: number | undefined): TargetBand | null => {
  const tolerance = TARGET_BAND[metric];
  return value === undefined || tolerance === undefined ? null : { low: value - tolerance, high: value + tolerance };
};

/**
 * Bands as one, from the lowest to the highest: what is on target while a
 * device is on its way from one to another. None where any of them is none,
 * since there is no telling what it should have read.
 */
export const unionOf = (bands: readonly (TargetBand | null)[]): TargetBand | null => {
  if (bands.length === 0 || bands.some(band => band === null)) return null;
  const known = bands as TargetBand[];
  return { low: Math.min(...known.map(band => band.low)), high: Math.max(...known.map(band => band.high)) };
};

/** A row of the record as the arithmetic reads it: from when it stood, what it aimed at, and the cycle that decided the half. */
export interface RecordedClimate {
  /** Epoch milliseconds. */
  at: number;
  targets: PhaseTargets | null;
  cycle: Cycle | null;
}

/**
 * What counted as on target for one metric at an instant, by one recorded
 * climate: its half's band, both halves' while its schedule changed between
 * them, and none for a figure the half does not hold. `lampHalf` stands in for
 * a row recorded before cycles were, which says nothing of its half, and
 * `lampChanging` for the hour after its lamp switched - the same hour a
 * schedule gives the climate after each switch.
 */
export const recordedBandAt = (
  row: RecordedClimate,
  metric: Metric,
  at: number,
  lampHalf: 'day' | 'night',
  hardware: Record<string, string> = {},
  lampChanging = false,
): TargetBand | null => {
  const halves = halvesHeld(row.targets, row.cycle?.workmode ?? null, hardware);
  const day = bandAround(metric, halves.day[metric]);
  const night = bandAround(metric, halves.night[metric]);
  if (!row.cycle) return lampChanging ? unionOf([day, night]) : lampHalf === 'day' ? day : night;

  const moment = cycleAt(row.cycle, at);
  if (moment.kind === 'off') return null;
  if (moment.transition) return unionOf([day, night]);
  return moment.active === 'day' ? day : night;
};

/**
 * What counted as on target at an instant over a whole record, oldest row
 * first: the band of the row standing then, reaching over what the rows before
 * it held at the moment each was replaced, for the hour after each change
 * (`SETTLE_SECONDS`). A fridge set from 25 °C to 20 °C takes most of that hour
 * to get there, and called "too warm" from the second the change was saved it
 * was told off for doing exactly what it was told. Before the first row the
 * first row is the nearest thing known.
 */
export const bandOverRecordAt = (
  record: readonly RecordedClimate[],
  metric: Metric,
  at: number,
  lampHalf: 'day' | 'night',
  hardware: Record<string, string> = {},
  lampChanging = false,
): TargetBand | null => {
  if (record.length === 0) return null;
  let index = record.length - 1;
  while (index > 0 && record[index].at > at) index -= 1;

  const bands = [recordedBandAt(record[index], metric, at, lampHalf, hardware, lampChanging)];
  for (let change = index; change > 0 && at - record[change].at < SETTLE_SECONDS * 1000 && at >= record[change].at; change -= 1) {
    bands.push(recordedBandAt(record[change - 1], metric, record[change].at - 1, lampHalf, hardware));
  }
  return unionOf(bands);
};

/**
 * The hour after a change, as the live card is told it: until when, which
 * half held just before, and per metric what held before - one band reaching
 * over every climate the device was told in that hour. Null where nothing
 * changed in the last hour.
 */
export interface Settling {
  /** Epoch milliseconds: the newest change plus `SETTLE_SECONDS`. */
  until: number;
  /** The half that held just before the first of the changes. */
  from: 'day' | 'night';
  /** What held before the changes, per metric; null where a climate before held no target for it. */
  bands: Partial<Record<Metric, TargetBand | null>>;
}

/**
 * The settling a device is in at `at`, from its newest rows: the ones written
 * in the last hour and the one standing before them. A row written while the
 * record was first filled, or one that moved nothing the device holds, settles
 * nothing worth saying - that is decided where the figures of now are known.
 */
export const settlingOf = (
  rows: readonly RecordedClimate[],
  at: number,
  metrics: readonly Metric[],
  hardware: Record<string, string> = {},
): Settling | null => {
  const sorted = [...rows].sort((one, other) => one.at - other.at);
  // A row that only added the cycle to a record written before cycles were is
  // the record being filled in, not anybody changing anything.
  const filledIn = (index: number): boolean =>
    sorted[index - 1].cycle === null && JSON.stringify(sorted[index - 1].targets) === JSON.stringify(sorted[index].targets);
  const recent = sorted.flatMap((row, index) =>
    index > 0 && row.at <= at && at - row.at < SETTLE_SECONDS * 1000 && !filledIn(index) ? [index] : [],
  );
  if (recent.length === 0) return null;

  const first = recent[0];
  const beforeFirst = sorted[first - 1];
  const fromMoment = beforeFirst.cycle ? cycleAt(beforeFirst.cycle, sorted[first].at - 1) : null;
  const bands = Object.fromEntries(
    metrics.map(metric => [
      metric,
      unionOf(recent.map(index => recordedBandAt(sorted[index - 1], metric, sorted[index].at - 1, fromMoment?.active ?? 'day', hardware))),
    ]),
  ) as Partial<Record<Metric, TargetBand | null>>;

  return { until: sorted[recent[recent.length - 1]].at + SETTLE_SECONDS * 1000, from: fromMoment?.active ?? 'day', bands };
};
