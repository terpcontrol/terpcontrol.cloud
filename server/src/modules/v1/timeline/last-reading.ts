import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DataService } from '@modules/data/data.service';
import { PANEL_METRICS } from './timeline-series';

/**
 * When anything standing in a place last measured one of the panels' metrics,
 * whenever that was - inside the window, or months before it.
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
 * Timeline of a tent and the Charts view of the grow standing in it are two
 * screens about one silence, and a grower moving between them must not be given
 * two different accounts of when the tent last spoke.
 */
export const lastReadingOf = async (data: DataService, devices: readonly StoredDevice[]): Promise<string | null> => {
  if (devices.length === 0) return null;

  const live = await Promise.all(devices.map(device => data.live(device.id)));
  const measured = live.flatMap(one =>
    PANEL_METRICS.flatMap(metric => {
      const measuredAt = one.metrics[metric]?.measuredAt;
      return measuredAt ? [measuredAt] : [];
    }),
  );

  return measured.length === 0 ? null : measured.reduce((newest, one) => (new Date(one) > new Date(newest) ? one : newest));
};
