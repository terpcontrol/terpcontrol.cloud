import { Model } from 'mongoose';
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
export interface Predecessor {
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

/** The leading device's history with its predecessors' readings in front of it, each over the stretch it held. */
export const withPredecessors = (leading: DeviceHistory, chain: readonly Predecessor[], histories: readonly DeviceHistory[]): DeviceHistory => {
  const earlier = [...chain].reverse().flatMap(link => {
    const history = histories.find(one => one.series.deviceId === link.deviceId);
    return history ? [{ history, until: link.held.endsAt.getTime() }] : [];
  });
  if (earlier.length === 0) return leading;
  // What the leading device measured while another held the place was not this place's air.
  const handedOver = Math.max(...earlier.map(one => one.until));

  return {
    ...leading,
    series: {
      ...leading.series,
      startsAt: earlier[0].history.series.startsAt,
      metrics: leading.series.metrics.map(row => ({
        ...row,
        points: [
          ...earlier.flatMap(({ history, until }) =>
            (history.series.metrics.find(one => one.metric === row.metric)?.points ?? []).filter(point => Date.parse(point.measuredAt) <= until),
          ),
          ...row.points.filter(point => Date.parse(point.measuredAt) > handedOver),
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
