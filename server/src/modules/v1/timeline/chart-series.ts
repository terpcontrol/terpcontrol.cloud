import { Model } from 'mongoose';
import type { Metric, OutputMetric, SpaceSeries } from '@fg2/shared-types/v1';
import { Grant } from '@common/v1/access.types';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { DataService } from '@modules/data/data.service';
import { recordOf } from '../phase/target-record';
import { CHART_FRAME_SLOTS, framesOf } from './frames';
import { lastReadingOf } from './last-reading';
import { chartPartsOf, panelsOf } from './timeline-series';
import { TimelineWindow, steeringOf, stretchesOf } from './timeline-window';

/** Where a chart is read from. */
interface ChartSources {
  data: DataService;
  targetRecord: Model<StoredTargetChange>;
  media: Model<MediaDocument>;
}

/**
 * The body a place's charts page and a grow's Charts view share: the curves
 * that were ticked, banded by what the steering device aimed at, with the
 * lanes, the night and the camera frames around them. Each screen picks its own
 * window, devices and cameras, and adds what is its own.
 *
 * The store is not read where neither a metric nor an output was asked for.
 */
export const chartSeriesOf = async (
  sources: ChartSources,
  grant: Grant,
  grow: GrowDocument | null,
  devices: StoredDevice[],
  cameras: CameraDocument[],
  window: TimelineWindow,
  asked: { metrics: readonly Metric[]; outputs: readonly OutputMetric[] },
  now: Date,
): Promise<Omit<SpaceSeries, 'spaceId'>> => {
  const { metrics, outputs } = asked;
  const read = metrics.length > 0 || outputs.length > 0;

  const [histories, aimed, frames] = await Promise.all([
    Promise.all(
      (read ? devices : []).map(device =>
        sources.data.history(
          device.id,
          { startsAt: window.startsAt, endsAt: window.endsAt, stepSeconds: window.stepSeconds, metrics, outputs },
          true,
        ),
      ),
    ),
    recordOf(sources.targetRecord, steeringOf(devices)?.id ?? null, window),
    framesOf(sources.media, cameras, window, CHART_FRAME_SLOTS),
  ]);
  const climate = panelsOf(
    histories.map(one => one.series),
    stretchesOf(grow, devices, window, now, aimed),
    metrics,
  );

  return {
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    climate,
    // Only a window that drew no curve has a silence to date, and only a caller
    // that asked about the climate at all can have been wondering about one.
    lastReadingAt: climate.length === 0 && metrics.length > 0 ? await lastReadingOf(sources.data, devices) : null,
    ...chartPartsOf({ histories, devices, window, redacted: grant.redacted, aimed, cameras, frames }),
  };
};
