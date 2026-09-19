import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SeriesPoint } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { logger } from '@utils/logger';
import { SERIES_READER, SeriesReader } from './series-reader';

/**
 * What a composed film knows beyond its frames: which day of the grow each one
 * is, how the tent was kept while they were taken, what somebody wrote, and
 * when the light was off.
 *
 * All four are read once per render rather than per frame - a film of a week is
 * a few thousand frames and four queries. Every one of them may come back
 * empty: a camera on a balcony has no controller, a tent has no grow in it, a
 * span holds no diary line. An overlay with nothing to draw draws nothing, and
 * the render goes on - a person asked for a film, not for a reason.
 */

/** A caption, and the instant it belongs to; the frames around it carry it. */
export interface TimelapseCaption {
  at: Date;
  text: string;
}

export interface TimelapseContext {
  /** Day one of the grow these frames are of; null where no grow stood here. */
  growStartedAt: Date | null;
  temperature: SeriesPoint[];
  humidity: SeriesPoint[];
  /** The light output over the span, which is what says a frame was taken in the dark. */
  light: SeriesPoint[];
  captions: TimelapseCaption[];
}

/** Enough points for a curve a thumb-sized chart can draw, whatever the span. */
const CURVE_POINTS = 240;

/** No more than this many lines are drawn; a busy week would otherwise be nothing but captions. */
const MAX_CAPTIONS = 60;

export interface TimelapseSpan {
  startsAt: Date;
  endsAt: Date;
}

@Injectable()
export class TimelapseContextService {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @Optional() @Inject(SERIES_READER) private readonly series: SeriesReader | null,
  ) {}

  /**
   * Everything the overlays of one render draw from. What is not asked for is
   * not read, so a plain film costs nothing here - except the light, which a
   * render reads whenever the dark frames are to be left out.
   */
  public async contextFor(
    camera: Pick<CameraDocument, 'spaceId' | 'deviceId'>,
    span: TimelapseSpan,
    wants: { dayCounter: boolean; climate: boolean; captions: boolean; light: boolean },
  ): Promise<TimelapseContext> {
    const grow = wants.dayCounter || wants.captions ? await this.growIn(camera.spaceId, span) : null;
    const [climate, captions] = await Promise.all([
      this.climateOf(camera, span, wants.climate, wants.light),
      wants.captions ? this.captionsOf(grow, camera.spaceId, span) : Promise.resolve([]),
    ]);

    return {
      growStartedAt: grow?.phases[0]?.startedAt ?? grow?.startedAt ?? null,
      ...climate,
      captions,
    };
  }

  /** The grow that stood in this space while the frames were taken. */
  private async growIn(spaceId: string | null, span: TimelapseSpan): Promise<GrowDocument | null> {
    if (spaceId === null) return null;

    const candidates = await this.grows.find({ 'placements.spaceId': spaceId }).sort({ startedAt: -1 }).limit(10).lean<GrowDocument[]>();

    return (
      candidates.find(grow =>
        grow.placements.some(
          placement =>
            placement.spaceId === spaceId && placement.startedAt < span.endsAt && (placement.endedAt === null || placement.endedAt > span.startsAt),
        ),
      ) ?? null
    );
  }

  /**
   * The temperature, the humidity and the light of the span, from the
   * controller that steers the place the camera is in - its own where it hangs
   * off one, otherwise whatever device stands in the same space.
   */
  private async climateOf(
    camera: Pick<CameraDocument, 'spaceId' | 'deviceId'>,
    span: TimelapseSpan,
    climate: boolean,
    light: boolean,
  ): Promise<Pick<TimelapseContext, 'temperature' | 'humidity' | 'light'>> {
    const empty = { temperature: [], humidity: [], light: [] };
    if (!this.series || (!climate && !light)) return empty;

    const deviceId = camera.deviceId ?? (await this.controllerIn(camera.spaceId));
    if (deviceId === null) return empty;

    try {
      const answer = await this.series.series(deviceId, {
        metrics: climate ? ['temperature', 'humidity'] : [],
        outputs: light ? ['light'] : [],
        startsAt: span.startsAt,
        endsAt: span.endsAt,
        stepSeconds: Math.max(Math.round((span.endsAt.getTime() - span.startsAt.getTime()) / 1000 / CURVE_POINTS), 60),
      });

      return {
        temperature: answer.metrics.find(series => series.metric === 'temperature')?.points ?? [],
        humidity: answer.metrics.find(series => series.metric === 'humidity')?.points ?? [],
        light: answer.outputs.find(series => series.output === 'light')?.points ?? [],
      };
    } catch (e) {
      // A film is worth more than its curve: a store that will not answer costs
      // the overlay and not the render.
      logger.error(`No climate for a timelapse of device ${deviceId}: ${e}`);
      return empty;
    }
  }

  private async controllerIn(spaceId: string | null): Promise<string | null> {
    if (spaceId === null) return null;

    const device = await this.devices.findOne({ spaceId }, { id: 1 }).sort({ createdAt: 1 }).lean();
    return device?.id ?? null;
  }

  /**
   * The lines somebody wrote in the span. A device's line carries a message key
   * rather than words - the translations are the client's - so only what a
   * person typed becomes a caption.
   */
  private async captionsOf(grow: GrowDocument | null, spaceId: string | null, span: TimelapseSpan): Promise<TimelapseCaption[]> {
    const of = grow ? { growId: grow.id } : spaceId ? { spaceId } : null;
    if (of === null) return [];

    const rows = await this.entries
      .find({ ...of, occurredAt: { $gte: span.startsAt, $lte: span.endsAt }, text: { $ne: null } })
      .sort({ occurredAt: 1 })
      .limit(MAX_CAPTIONS)
      .lean<EntryDocument[]>();

    return rows.flatMap(entry => (entry.text ? [{ at: entry.occurredAt, text: entry.text }] : []));
  }
}
