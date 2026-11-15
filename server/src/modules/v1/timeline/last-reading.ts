import { arrivalOf } from '@common/v1/device-placements';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DataService } from '@modules/data/data.service';
import { PANEL_METRICS } from './timeline-series';

/**
 * When each device standing in a place last measured one of the panels' metrics
 * there, whenever that was - inside the window, or months before it.
 *
 * A screen with no curves has two sentences to choose between and no way of its
 * own to choose: a place where nothing measures, and a place that measures and
 * has been quiet across this window. The answer is empty in both cases, by
 * design - a metric every point of which is null has no panel - and the window
 * holds nothing that could tell them apart, because the fact that decides it
 * lies outside the window. So the store is asked, and asked only where there is
 * nothing to draw: a window with curves in it has already answered the question
 * by having them, and this costs a read per device that neither screen would
 * otherwise pay.
 *
 * A space holding only a plug, a light or a fan measures none of these metrics
 * in any window and answers nothing, which is what keeps "nothing measures
 * here" the right sentence for such a place rather than telling its owner the
 * hardware went quiet.
 *
 * It lives beside the arithmetic rather than inside either service because the
 * Timeline of a tent and the series of the grow standing in it are two
 * reads about one silence, and a grower moving between them must not be given
 * two different accounts of when the tent last spoke.
 */
export const lastReadingsOf = async (data: DataService, devices: readonly StoredDevice[], spaceId: string): Promise<Map<string, string | null>> => {
  const live = await Promise.all(devices.map(device => data.live(device.id)));
  return new Map(
    devices.map((device, index) => {
      // A device that came from another place speaks here from when it came: what it measured before is the other
      // place's, and a "last reading" from there would point the page at an instant in which this place shows nothing.
      const came = arrivalOf(device.placements, spaceId)?.at.getTime() ?? -Infinity;
      const measured = PANEL_METRICS.flatMap(metric => {
        const measuredAt = live[index].metrics[metric]?.measuredAt;
        return measuredAt && Date.parse(measuredAt) >= came ? [measuredAt] : [];
      });
      return [device.id, newestOf(measured)];
    }),
  );
};

/** The newest of these instants, or null where there is none. */
export const newestOf = (instants: readonly (string | null)[]): string | null =>
  instants.reduce<string | null>((newest, one) => (one !== null && (newest === null || Date.parse(one) > Date.parse(newest)) ? one : newest), null);
