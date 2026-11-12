import type { DeviceSeries, GrowDayClimate, GrowDayEvent, Metric, SeriesPoint } from '@fg2/shared-types/v1';
import { Span } from '@common/v1/range';
import { isOffline } from '@common/v1/value-age';
import { DeviceHistory } from '@modules/data/data.service';
import type { RecordedClimate } from '../device/held-targets';
import { verdictOf } from '../overview/climate-verdict';

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
  const slices = devices.map(device => ({ ...device, series: sliceOf(device.history.series, from, to) }));

  const [temperature, humidity] = AVERAGED.map(metric =>
    mean(slices.flatMap(slice => (slice.series.metrics.find(row => row.metric === metric)?.points ?? []).flatMap(valueOf))),
  );

  const verdicts = slices.flatMap(slice => {
    const known = slice.record.filter(row => row.at <= to);
    if (known.length === 0) return [];
    // Before its first row the record says nothing, so the day is judged from there on.
    const since = Math.max(from, known[0].at);
    const window = { startsAt: new Date(since), endsAt: day.endsAt };
    return [verdictOf(since > from ? sliceOf(slice.series, since, to) : slice.series, null, window, null, known, slice.hardware)];
  });
  const judged = verdicts.flatMap(verdict => {
    const seconds = Math.max(0, ...verdict.metrics.map(row => row.inBandSeconds + row.outOfBandSeconds));
    return verdict.inBandFraction === null || seconds === 0 ? [] : [{ fraction: verdict.inBandFraction, seconds }];
  });
  const most = Math.max(0, ...judged.map(one => one.seconds));
  const enough = most >= MIN_JUDGED_SECONDS && most >= ((to - from) / 1000) * JUDGED_SHARE;
  const total = judged.reduce((sum, one) => sum + one.seconds, 0);

  const events: GrowDayEvent[] = [
    ...lightOf(devices, from, to, running),
    ...verdicts.flatMap(verdict =>
      verdict.metrics.flatMap(row =>
        row.excursions.map(excursion => ({
          kind: 'excursion' as const,
          // The verdict stamps a run at the end of its first window; it began where that window did.
          at: new Date(Math.max(from, Date.parse(excursion.startedAt) - verdict.stepSeconds * 1000)).toISOString(),
          endedAt: excursion.endedAt,
          metric: row.metric,
          above: excursion.above,
          extremeValue: excursion.extremeValue,
        })),
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
