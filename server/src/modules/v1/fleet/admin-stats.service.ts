import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminRetentionRun, AdminStats } from '@fg2/shared-types/v1';
import { onlineSince } from '@common/v1/value-age';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { ClimateRetentionService } from '@modules/retention/climate-retention.service';
import { UPGRADE_TIMEOUT_MS } from './firmware-rollout.service';

/**
 * How the install itself is doing: the figures the fleet screen's health card
 * is drawn from.
 *
 * Every one of them is either a count or one grouping, and each is named as
 * what this server can honestly say rather than as what a dashboard usually
 * shows. Two are worth spelling out.
 *
 * `devices.online` is devices heard from inside the offline window, not
 * sockets open on the broker. The broker is RabbitMQ and its connection count
 * is the broker's to answer, not this server's; what an operator actually wants
 * to know - how much of the fleet is talking - is the same question asked of
 * the data that arrived, and it is the figure every other screen here already
 * uses.
 *
 * `retention` is the sweep's last pass, which is the only background job on an
 * install that deletes a grower's raw samples. It is null until this server has
 * run one, because the pass is the running process's own memory of its night;
 * a screen says so rather than printing an hour nothing happened at.
 *
 * The answer carries `collectedAt` because it is a dozen counts and not an
 * instant, and a card that says "now" about figures gathered over a second is
 * the sort of small lie the rest of this app refuses.
 */

/** Two pictures missed is late; ten is a camera that has stopped, which is the verdict the camera rows are drawn with. */
const OFFLINE_AFTER_STILLS = 10;

@Injectable()
export class AdminStatsService {
  constructor(
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    private readonly retention: ClimateRetentionService,
  ) {}

  public async stats(now: Date = new Date()): Promise<AdminStats> {
    const [users, devices, cameras, content, renders] = await Promise.all([
      this.userStats(),
      this.deviceStats(now),
      this.cameraStats(now),
      this.contentStats(),
      this.renderStats(),
    ]);

    return { collectedAt: now.toISOString(), users, devices, cameras, content, renders, retention: lastRunOf(this.retention) };
  }

  private async userStats(): Promise<AdminStats['users']> {
    const [total, active, admins] = await Promise.all([
      this.users.countDocuments({}),
      this.users.countDocuments({ isActive: true }),
      this.users.countDocuments({ isAdmin: true }),
    ]);

    return { total, active, admins };
  }

  /**
   * `updating` is the same reading the rollout takes: told to install a build,
   * not yet reporting it, and still inside the window a device is given to
   * come back. Past that window it is a failure rather than a device that is
   * busy, which is what the fleet table says about the same rows.
   */
  private async deviceStats(now: Date): Promise<AdminStats['devices']> {
    const partway = { 'firmware.targetId': { $ne: null }, $expr: { $ne: ['$firmware.targetId', '$state.firmwareId'] } };

    const [total, claimed, online, updating] = await Promise.all([
      this.devices.countDocuments({}),
      this.devices.countDocuments({ ownerId: { $ne: null } }),
      this.devices.countDocuments({ 'state.lastSeenAt': { $gte: onlineSince(now) } }),
      this.devices.countDocuments({ ...partway, 'state.updateStartedAt': { $gte: new Date(now.getTime() - UPGRADE_TIMEOUT_MS) } }),
    ]);

    return { total, claimed, online, updating };
  }

  /**
   * A removed camera is not part of the install any more, so none of the three
   * figures counts one. `stale` is judged against each camera's own promise
   * rather than against one threshold: a camera asked for a picture every hour
   * and a camera asked for one every thirty seconds are late at very different
   * ages, which is why the comparison is against `stillIntervalSeconds` and has
   * to be an expression rather than a range.
   */
  private async cameraStats(now: Date): Promise<AdminStats['cameras']> {
    const live = { removedAt: null };

    const [total, entitled, stale] = await Promise.all([
      this.cameras.countDocuments(live),
      this.cameras.countDocuments({ ...live, 'entitlement.validUntil': { $gt: now } }),
      this.cameras.countDocuments({
        ...live,
        $expr: {
          $or: [
            { $eq: ['$state.lastStillAt', null] },
            {
              $gt: [{ $subtract: [now, '$state.lastStillAt'] }, { $multiply: [OFFLINE_AFTER_STILLS, 1000, { $max: [1, '$stillIntervalSeconds'] }] }],
            },
          ],
        },
      }),
    ]);

    return { total, entitled, stale };
  }

  /** What is being grown and written here, and what the pictures of it weigh - which is nearly all of the disk. */
  private async contentStats(): Promise<AdminStats['content']> {
    const [spaces, grows, publicGrows, plants, entries, media, weight] = await Promise.all([
      this.spaces.countDocuments({}),
      this.grows.countDocuments({}),
      this.grows.countDocuments({ visibility: 'public' }),
      this.plants.countDocuments({}),
      this.entries.countDocuments({}),
      this.media.countDocuments({}),
      this.media.aggregate<{ bytes: number }>([{ $group: { _id: null, bytes: { $sum: '$bytes' } } }]),
    ]);

    return { spaces, grows, publicGrows, plants, entries, media, mediaBytes: weight[0]?.bytes ?? 0 };
  }

  /**
   * The composer's queue. A film that failed stays counted rather than being
   * cleared, because each of them is a picture somebody asked for and did not
   * get, and a queue that is quietly failing every night looks exactly like an
   * empty one from every other screen.
   */
  private async renderStats(): Promise<AdminStats['renders']> {
    const [queued, rendering, failed] = await Promise.all([
      this.media.countDocuments({ 'render.status': 'queued' }),
      this.media.countDocuments({ 'render.status': 'rendering' }),
      this.media.countDocuments({ 'render.status': 'failed' }),
    ]);

    return { queued, rendering, failed };
  }
}

const lastRunOf = (retention: ClimateRetentionService): AdminRetentionRun | null => {
  const run = retention.lastRun;

  return run ? { ranAt: run.ranAt.toISOString(), reached: run.reached, devices: run.devices, days: run.days, errors: run.errors } : null;
};
