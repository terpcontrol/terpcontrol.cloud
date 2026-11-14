import type { ClimateExcursion, ClimateVerdict, DeviceSeries, GrowDayClimate, GrowDayEvent, Metric, SeriesPoint } from '@fg2/shared-types/v1';
import { Span } from '@common/v1/range';
import { isOffline } from '@common/v1/value-age';
import { DeviceHistory } from '@modules/data/data.service';
import type { RecordedClimate } from '../device/held-targets';
import { BandAt, bandsOverWindows, verdictOf } from '../overview/climate-verdict';

/**
 * How one day of a grow was kept, and what its devices did in it, from a read
 * of the measurement store that covers the day.
 *
 * The share inside the targets is the verdict of a place's last 24 hours
 * (`climate-verdict.ts`) asked of one calendar day: each window is judged by
 * what the device aimed at then, as its target record says. It is stated only
 * where that is known - a day before the record began is not judged by what
 * was saved later, and a day mostly unheard is not graded by its one good
 * hour. Nothing here talks to a database.
 */

/** What one device recorded over a stretch that covers the day, and what is known of it. */
export interface DayDevice {
  history: DeviceHistory;
  /** Its target record as far as it reaches the stretch, oldest first. */
  record: readonly RecordedClimate[];
  hardware: Record<string, string>;
  /** Its raw samples around where its readings left their band and came back (`edgesOf`), by metric, oldest first. */
  samples?: ReadonlyMap<Metric, readonly SeriesPoint[]>;
}

/** A share of a day is stated once at least this much of it was judged, and never for less than an hour. */
const JUDGED_SHARE = 0.5;
const MIN_JUDGED_SECONDS = 3600;

const AVERAGED: readonly Metric[] = ['temperature', 'humidity'];

/** `running` says the day has not ended: it is read up to now, and what is still on then is on. */
export const dayClimateOf = (
  devices: readonly DayDevice[],
  day: Span,
  running = false,
): { climate: GrowDayClimate | null; events: GrowDayEvent[] } => {
  const from = day.startsAt.getTime();
  const to = day.endsAt.getTime();
  const slices = devices.map(device => sliceOf(device.history.series, from, to));

  const [temperature, humidity] = AVERAGED.map(metric =>
    mean(slices.flatMap(series => (series.metrics.find(row => row.metric === metric)?.points ?? []).flatMap(valueOf))),
  );

  const verdicts = devices.flatMap(device => judgedOf(device, day) ?? []);
  const judged = verdicts.flatMap(({ verdict }) => {
    const seconds = Math.max(0, ...verdict.metrics.map(row => row.inBandSeconds + row.outOfBandSeconds));
    return verdict.inBandFraction === null || seconds === 0 ? [] : [{ fraction: verdict.inBandFraction, seconds }];
  });
  const most = Math.max(0, ...judged.map(one => one.seconds));
  const enough = most >= MIN_JUDGED_SECONDS && most >= ((to - from) / 1000) * JUDGED_SHARE;
  const total = judged.reduce((sum, one) => sum + one.seconds, 0);

  const events: GrowDayEvent[] = [
    ...lightOf(devices, from, to, running),
    ...verdicts.flatMap(judging =>
      judging.verdict.metrics.flatMap(row =>
        row.excursions.map(excursion => {
          const { leftAt, backAt } = edgesOfRun(judging, row.metric, excursion);
          return {
            kind: 'excursion' as const,
            // No earlier than its device was read from.
            at: new Date(Math.max(judging.readFrom, leftAt)).toISOString(),
            endedAt: backAt,
            metric: row.metric,
            above: excursion.above,
            extremeValue: excursion.extremeValue,
          };
        }),
      ),
    ),
  ].sort((one, other) => one.at.localeCompare(other.at));

  return {
    climate:
      temperature === null && humidity === null
        ? null
        : {
            temperature,
            humidity,
            inBandFraction: enough ? Math.round((judged.reduce((sum, one) => sum + one.fraction * one.seconds, 0) / total) * 1000) / 1000 : null,
          },
    events,
  };
};

/**
 * The stretches of raw samples that tell where a device's runs outside the
 * band over a stretch began and ended (`edgesOfRun`): the window before each
 * run's first and its first, its last and the one after - joined where they
 * meet, so a read asks for each sample once.
 */
export const edgesOf = (device: DayDevice, stretch: Span): Span[] => {
  const judging = judgedOf(device, stretch);
  const step = (judging?.verdict.stepSeconds ?? 0) * 1000;
  const edges = (judging?.verdict.metrics ?? [])
    .flatMap(row => row.excursions)
    .flatMap(excursion => {
      const first = Date.parse(excursion.startedAt);
      const last = excursion.endedAt === null ? null : Date.parse(excursion.endedAt);
      return [[first - 2 * step, first], ...(last === null ? [] : [[last - step, last + step]])];
    })
    .sort((one, other) => one[0] - other[0]);

  return edges
    .reduce<number[][]>((joined, [startsAt, endsAt]) => {
      const previous = joined[joined.length - 1];
      if (previous && startsAt <= previous[1]) previous[1] = Math.max(previous[1], endsAt);
      else joined.push([startsAt, endsAt]);
      return joined;
    }, [])
    .map(([startsAt, endsAt]) => ({ startsAt: new Date(startsAt), endsAt: new Date(endsAt) }));
};

/** A device's verdict on a stretch, with what it was judged from. */
interface Judging {
  verdict: ClimateVerdict;
  /** Where its stay began: nothing it measured before it came is the stretch's. */
  readFrom: number;
  series: DeviceSeries;
  bandAt: BandAt;
  samples: ReadonlyMap<Metric, readonly SeriesPoint[]>;
}

/** Judged from where its record begins - before its first row the record says nothing - or not at all without one. */
const judgedOf = (device: DayDevice, stretch: Span): Judging | null => {
  const from = stretch.startsAt.getTime();
  const to = stretch.endsAt.getTime();
  const known = device.record.filter(row => row.at <= to);
  if (known.length === 0) return null;

  const since = Math.max(from, known[0].at);
  const series = sliceOf(device.history.series, since, to);
  return {
    verdict: verdictOf(series, null, { startsAt: new Date(since), endsAt: stretch.endsAt }, null, known, device.hardware),
    readFrom: Math.max(from, Date.parse(device.history.series.startsAt)),
    series,
    bandAt: bandsOverWindows(series, null, null, known, device.hardware),
    samples: device.samples ?? new Map(),
  };
};

/**
 * Where a run outside the band began and ended, to the sample. The verdict
 * reads windows of means, and a mean says the window, not the minute: a rise
 * at 17:08 read 17:05, and a humidity that jumped on the same sample, whose
 * first window still averaged inside its band, 17:10. So the raw samples either
 * side of the run's first and last window are judged, each by the band of the
 * window it fell in: the run began at the sample that left after one inside,
 * and ended at the first back inside. Where no such crossing is seen - a run
 * already going where the read began, a gap, a half the metric is not steered
 * in, a day whose samples were summarised away - its window's edge stands: the
 * verdict stamps a run at the end of its first window, and it began where that
 * window did.
 */
const edgesOfRun = (judging: Judging, metric: Metric, excursion: ClimateExcursion): { leftAt: number; backAt: string | null } => {
  const step = judging.verdict.stepSeconds * 1000;
  const points = judging.series.metrics.find(row => row.metric === metric)?.points ?? [];
  const opens = points.length > 0 ? Date.parse(points[0].measuredAt) - step : 0;
  // Outside the band on the run's side, inside it, or not judged where the sample fell.
  const outsideAt = (at: number, value: number): boolean | null => {
    const index = Math.floor((at - opens) / step);
    const stamp = Date.parse(points[index]?.measuredAt ?? '');
    const band = stamp - step <= at && at < stamp ? judging.bandAt(metric, index) : null;
    return band === null ? null : excursion.above ? value > band.high : value < band.low;
  };
  const crossings = (startsAt: number, endsAt: number, outward: boolean): number[] => {
    let previous: boolean | null = null;
    return (judging.samples.get(metric) ?? []).flatMap(sample => {
      const at = Date.parse(sample.measuredAt);
      if (at < startsAt || at >= endsAt || sample.value === null) return [];
      const outside = outsideAt(at, sample.value);
      const crossed = outside === outward && previous === !outward;
      previous = outside;
      return crossed ? [at] : [];
    });
  };

  const first = Date.parse(excursion.startedAt);
  const left = crossings(first - 2 * step, first, true).pop();
  const last = excursion.endedAt === null ? null : Date.parse(excursion.endedAt);
  const back = last === null ? undefined : crossings(last - step, last + step, false)[0];
  return { leftAt: left ?? first - step, backAt: back === undefined ? excursion.endedAt : new Date(back).toISOString() };
};

/**
 * What the lamp did, as far as it is known: when it came on and when it last
 * went off - the first of the one and the last of the other, so a lamp
 * somebody switched five times while working in the tent is still one stretch
 * - and, where it came on again after that and nothing switched it off, that
 * switching too. A stretch that has not ended has no end, and only the day
 * still running, with its device still reporting, says the lamp is `still`
 * lit: after a device fell silent nobody knows.
 *
 * The devices of one place switch one lamp, so the first that reports one
 * speaks for it. The row a read opens with is the state it found, not a
 * switching.
 */
const lightOf = (devices: readonly DayDevice[], from: number, to: number, running: boolean): GrowDayEvent[] => {
  const lamp = devices.find(device => (device.history.outputs.find(output => output.output === 'light')?.switchings ?? []).length > 0);
  const inDay = (lamp?.history.outputs.find(output => output.output === 'light')?.switchings ?? []).slice(1).filter(switching => {
    const at = Date.parse(switching.at);
    return at >= from && at < to;
  });
  const last = inDay[inDay.length - 1];
  if (!lamp || !last) return [];

  const off = [...inDay].reverse().find(switching => !switching.on);
  const on = off ? inDay.find(switching => switching.on && switching.at < off.at) : undefined;
  const open = last.on ? last : undefined;
  // Reporting by the one rule that calls a device offline.
  const still = running && lamp.history.lastSampleAt !== null && !isOffline(new Date(lamp.history.lastSampleAt), new Date(to));

  return [on, off, open].flatMap(switching =>
    switching ? [{ kind: 'light' as const, at: switching.at, on: switching.on, still: switching === open && still }] : [],
  );
};

/** The windows of a series that end inside a stretch: a point is stamped at the end of its window. */
const sliceOf = (series: DeviceSeries, from: number, to: number): DeviceSeries => {
  const inside = (point: SeriesPoint): boolean => {
    const at = Date.parse(point.measuredAt);
    return at > from && at <= to;
  };

  return {
    ...series,
    startsAt: new Date(from).toISOString(),
    endsAt: new Date(to).toISOString(),
    metrics: series.metrics.map(row => ({ ...row, points: row.points.filter(inside) })),
    outputs: series.outputs.map(row => ({ ...row, points: row.points.filter(inside) })),
  };
};

const valueOf = (point: SeriesPoint): number[] => (point.value === null ? [] : [point.value]);

/** One decimal, which is what a card draws. */
const mean = (values: number[]): number | null =>
  values.length > 0 ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
