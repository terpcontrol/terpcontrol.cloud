import { Model } from 'mongoose';
import type { GrowDayEvent } from '@fg2/shared-types/v1';
import { Stood } from '@common/v1/device-placements';
import { notFound } from '@common/v1/problem';
import { Span } from '@common/v1/range';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { DeviceHistory } from '@modules/data/data.service';
import { targetsOf } from '../phase/phase-targets';
import { recordOf } from '../phase/target-record';

/**
 * A place's curve across a change of the device that keeps its climate.
 *
 * A panel is one device's readings and never a mean of two. But a place whose
 * controller was replaced a week ago has a month to show all the same: over the
 * part of a window before the device its curves are of came, the curve is that
 * of the climate device that held the place then, and so on back through the
 * window - each over its own stay, so no two of them speak for the same hour.
 */

/**
 * One device of a place, where a reader asked for one climate of several:
 * every reading, band and lane is then that device's alone. A device that did
 * not stand here inside the window is answered as one that does not exist,
 * whoever asks.
 */
export const narrowedToDevice = (stood: Stood[], deviceId: string | undefined): Stood[] => {
  if (!deviceId) return stood;
  const one = stood.filter(({ device }) => device.id === deviceId);
  if (one.length === 0) throw notFound('device_not_here', 'That device does not stand in this space.');
  return one;
};

/** A climate device that held a place before another, with the part of the window that is its own. */
interface Predecessor {
  deviceId: string;
  held: Span;
}

/**
 * The devices that held the place's climate before the leading one came,
 * newest first: each a device with targets that has since left, over the part
 * of its stay nobody after it speaks for. A climate still standing beside the
 * leading one is another climate of the place and never its past.
 */
export const predecessorsOf = (stood: readonly Stood[], leadingId: string | null, here: readonly string[]): Predecessor[] => {
  const leading = stood.find(({ device }) => device.id === leadingId);
  if (!leading) return [];

  const gone = stood
    .filter(
      ({ device }) =>
        device.id !== leadingId && !(device.spaceId !== null && here.includes(device.spaceId)) && targetsOf(device.configuration) !== null,
    )
    .sort((one, other) => other.stay.endsAt.getTime() - one.stay.endsAt.getTime());
  const chain: Predecessor[] = [];
  // From when the leading device was put there, not from where its first placement is read back to.
  let until = leading.since;
  for (const { device, stay } of gone) {
    if (stay.startsAt >= until) continue;
    const endsAt = stay.endsAt < until ? stay.endsAt : until;
    chain.push({ deviceId: device.id, held: { startsAt: stay.startsAt, endsAt } });
    until = stay.startsAt;
  }

  return chain;
};

/** A change of the device that measures, as a day of the diary and a window of Verlauf tell it. */
export type DeviceChange = Extract<GrowDayEvent, { kind: 'device' }>;

/**
 * When the place's climate passed to another device, oldest first: who took
 * over, at the moment it was put there. Read off the chain and so off the
 * placements - a move taken back within its five minutes leaves no placement,
 * and no change to tell.
 */
export const changesOf = (stood: readonly Stood[], leadingId: string | null, chain: readonly Predecessor[]): DeviceChange[] =>
  chain
    .flatMap((_link, index): DeviceChange[] => {
      const next = stood.find(({ device }) => device.id === (index === 0 ? leadingId : chain[index - 1].deviceId));
      const at = index === 0 ? next?.since : chain[index - 1].held.startsAt;
      return next && at ? [{ kind: 'device', at: at.toISOString(), name: next.device.name ?? null, type: next.device.type }] : [];
    })
    .reverse();

/**
 * What the leading device said from the hand-over on. What it measured and
 * switched while another device held the place was not this place's air: a
 * first placement is read from before it began, and a controller fresh out of
 * its box had been running on a desk for the hour before it replaced the old
 * one.
 */
export const fromHandover = (leading: DeviceHistory, chain: readonly Predecessor[]): DeviceHistory => {
  if (chain.length === 0) return leading;

  const handedOver = Math.max(...chain.map(link => link.held.endsAt.getTime()));
  const since = <T extends { measuredAt: string }>(points: readonly T[]): T[] => points.filter(point => Date.parse(point.measuredAt) > handedOver);

  return {
    ...leading,
    series: {
      ...leading.series,
      startsAt: new Date(Math.max(handedOver, Date.parse(leading.series.startsAt))).toISOString(),
      metrics: leading.series.metrics.map(row => ({ ...row, points: since(row.points) })),
      outputs: leading.series.outputs.map(row => ({ ...row, points: since(row.points) })),
    },
    outputs: leading.outputs.map(output => (output.figures ? { ...output, figures: since(output.figures) } : output)),
  };
};

/** The samples per window of the histories a curve is joined from, each up to where the next one takes over. */
const samplesAcross = (parts: readonly { history: DeviceHistory; until: number }[]): Pick<DeviceHistory, 'samples'> =>
  parts.some(part => part.history.samples)
    ? { samples: new Map(parts.flatMap(({ history, until }) => [...(history.samples ?? [])].filter(([stamp]) => stamp <= until))) }
    : {};

/** The leading device's history - from the hand-over on - with its predecessors' readings in front of it, each over the stretch it held. */
export const withPredecessors = (leading: DeviceHistory, chain: readonly Predecessor[], histories: readonly DeviceHistory[]): DeviceHistory => {
  const earlier = [...chain].reverse().flatMap(link => {
    const history = histories.find(one => one.series.deviceId === link.deviceId);
    return history ? [{ history, until: link.held.endsAt.getTime() }] : [];
  });
  if (earlier.length === 0) return leading;

  return {
    ...leading,
    ...samplesAcross([...earlier, { history: leading, until: Number.POSITIVE_INFINITY }]),
    series: {
      ...leading.series,
      startsAt: earlier[0].history.series.startsAt,
      metrics: leading.series.metrics.map(row => ({
        ...row,
        points: [
          ...earlier.flatMap(({ history, until }) =>
            (history.series.metrics.find(one => one.metric === row.metric)?.points ?? []).filter(point => Date.parse(point.measuredAt) <= until),
          ),
          ...row.points,
        ],
      })),
    },
  };
};

/**
 * What the place's climate device aimed at over a window, as one record: the
 * leading device's own over its stay, and before that each predecessor's over
 * the stretch it held - all under the leading device's id, which is whose band
 * the window draws. A row standing when a stretch begins is dated to that
 * beginning wherever the stretch begins inside the window, so the rows stay in
 * the order the stretches are in.
 */
export const recordAcross = async (
  record: Model<StoredTargetChange>,
  leading: Stood | null,
  chain: readonly Predecessor[],
  window: Span,
): Promise<StoredTargetChange[]> => {
  if (!leading) return [];

  const own = chain.length > 0 ? { startsAt: leading.since, endsAt: leading.stay.endsAt } : leading.stay;
  const links = [...[...chain].reverse(), { deviceId: leading.device.id, held: own }];
  const rows = await Promise.all(
    links.map(async ({ deviceId, held }) =>
      (await recordOf(record, deviceId, held)).map(row => ({
        ...row,
        deviceId: leading.device.id,
        at: held.startsAt > window.startsAt && row.at < held.startsAt ? held.startsAt : row.at,
      })),
    ),
  );

  return rows.flat();
};
