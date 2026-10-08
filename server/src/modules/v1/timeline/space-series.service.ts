import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Metric, OutputMetric, SpaceSeries } from '@fg2/shared-types/v1';
import { Grant } from '@common/v1/access.types';
import { badRequest } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { DataService } from '@modules/data/data.service';
import { SpaceLiveService } from '../space/space-live.service';
import { SpacesService } from '../space/spaces.service';
import { chartSeriesOf } from './chart-series';
import { shownCameras } from './frames';
import { narrowedTo } from './timeline-window';

/** What the route was asked for, after the query string has been checked against the contract. */
export interface SpaceSeriesQuery {
  from: Date;
  to: Date;
  stepSeconds?: number;
  metrics?: readonly Metric[];
  outputs?: readonly OutputMetric[];
}

/**
 * The charts page of a place: whatever stands in it, over any two instants and
 * at any step somebody chose.
 *
 * It reads through the Timeline's own arithmetic - the same pooled panels, the
 * same band from the target record of the device that steers, the same lanes
 * and nights - so a curve drawn here and on the place's Timeline is the same
 * curve. What a grow adds, its day counter and its own measurements, is the
 * grow's answer and not this one.
 *
 * **What it costs.** The space, the devices standing in it, two or three reads
 * of the steering device's target record, the cameras and one aggregation of
 * their stills, and two time-series reads per device. The step decides the
 * size of a curve and is widened before a window would build more than one
 * read holds.
 */
@Injectable()
export class SpaceSeriesService {
  constructor(
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.targetChange) private readonly targetRecord: Model<StoredTargetChange>,
    private readonly places: SpacesService,
    private readonly live: SpaceLiveService,
    private readonly data: DataService,
  ) {}

  public async read(grant: Grant, spaceId: string, asked: SpaceSeriesQuery, now: Date = new Date()): Promise<SpaceSeries> {
    // A range whose end comes before its start is refused as the query is read.
    if (asked.to.getTime() === asked.from.getTime()) {
      throw badRequest('range_required', 'A range ends after it begins.', [
        { field: 'to', code: 'too_small', detail: 'A chart over one instant has nothing to draw; `to` comes after `from`.' },
      ]);
    }

    const [space, devices, cameras] = await Promise.all([
      this.places.require(spaceId),
      this.live.devicesIn([spaceId]),
      shownCameras(this.cameras, [spaceId], grant.includeCameras),
    ]);
    const window = narrowedTo({ startsAt: asked.from, endsAt: asked.to }, grant, null, now, asked.stepSeconds);
    const charts = await chartSeriesOf(
      { data: this.data, targetRecord: this.targetRecord, media: this.media },
      grant,
      null,
      devices,
      cameras,
      window,
      { metrics: asked.metrics ?? [], outputs: asked.outputs ?? [] },
      now,
    );

    return { spaceId: space.id, ...charts };
  }
}
