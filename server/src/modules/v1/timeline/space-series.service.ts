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
import { cyclesOf, recordOf } from '../phase/target-record';
import { SpaceLiveService } from '../space/space-live.service';
import { SpacesService } from '../space/spaces.service';
import { CHART_FRAME_SLOTS, framesOf } from './frames';
import { lastReadingOf } from './last-reading';
import { fridgesOf, lanesOf, nightsOf, panelsOf, transitionsOf } from './timeline-series';
import { narrowedTo, steeringOf, stretchesOf } from './timeline-window';

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

    const [space, devices] = await Promise.all([this.places.require(spaceId), this.live.devicesIn([spaceId])]);
    const window = narrowedTo({ startsAt: asked.from, endsAt: asked.to }, grant, null, now, asked.stepSeconds);
    const metrics = asked.metrics ?? [];
    const outputs = asked.outputs ?? [];
    const read = metrics.length > 0 || outputs.length > 0;

    const [series, aimed, cameras] = await Promise.all([
      Promise.all(
        (read ? devices : []).map(device =>
          this.data.history(device.id, { startsAt: window.startsAt, endsAt: window.endsAt, stepSeconds: window.stepSeconds, metrics, outputs }, true),
        ),
      ),
      recordOf(this.targetRecord, steeringOf(devices)?.id ?? null, window),
      grant.includeCameras
        ? this.cameras.find({ spaceId, removedAt: null }).sort({ createdAt: 1, id: 1 }).lean<CameraDocument[]>()
        : Promise.resolve([] as CameraDocument[]),
    ]);
    const frames = await framesOf(this.media, cameras, window, CHART_FRAME_SLOTS);
    const climate = panelsOf(
      series.map(one => one.series),
      stretchesOf(null, devices, window, now, aimed),
      metrics,
    );

    return {
      spaceId: space.id,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      stepSeconds: series.length === 0 ? 0 : window.stepSeconds,
      deviceIds: grant.redacted ? null : devices.map(device => device.id),
      climate,
      lastReadingAt: climate.length === 0 && metrics.length > 0 ? await lastReadingOf(this.data, devices) : null,
      outputs: lanesOf(series, window, grant.redacted, fridgesOf(devices)),
      nights: nightsOf(series, window, cyclesOf(aimed, window)),
      transitions: transitionsOf(cyclesOf(aimed, window)),
      cameras: cameras.map(camera => ({ cameraId: camera.id, name: camera.name, frames: frames.get(camera.id) ?? [] })),
    };
  }
}
