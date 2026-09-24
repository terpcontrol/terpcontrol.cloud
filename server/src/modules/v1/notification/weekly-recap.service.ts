import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BackgroundWork } from '@common/background-work';
import { appConfig } from '@config/configuration';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { periodAround, periodBefore } from '@modules/v1/camera/film-periods';
import { logger } from '@utils/logger';
import { weeklyTimelapseAnnouncement } from './notification-messages';
import { NotificationService } from './notification.service';
import { RecipientsService } from './recipients.service';

/**
 * The loop that hands somebody their week.
 *
 * The timelapse builder keeps a rolling day, week and month per camera and says
 * nothing about any of them; this notices that a week has closed and offers the
 * film of it to everybody who keeps the camera. It sits here rather than in the
 * builder because the builder's pass is ffmpeg for minutes at a time and knows
 * nothing of people, while everything about who hears what already lives beside
 * this file.
 *
 * Only the week that has just ended is ever looked at. That is what keeps a
 * fresh install from announcing a month of history on its first pass, and it is
 * also the only week whose film stands still: the open one is rebuilt every few
 * hours under a new id, and a recap of it would arrive again with every rebuild.
 */

const TICK_MS = 60 * 60 * 1000;

/** Far enough into the run that the first pass does not land in the middle of a boot. */
const FIRST_PASS_MS = 60 * 1000;

@Injectable()
export class WeeklyRecapService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    private readonly notifications: NotificationService,
    private readonly recipients: RecipientsService,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
  ) {}

  public onModuleInit(): void {
    this.work.schedule('The first pass of the weekly recap', () => this.run(), FIRST_PASS_MS);
    this.work.repeat('The weekly recap', () => this.run(), TICK_MS);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the weekly recap');
    this.work.stop();
  }

  /** One pass over the cameras. Public so it can be run once, in a test or by hand. */
  public async run(now: Date = new Date()): Promise<void> {
    for (const camera of await this.cameras.find({ removedAt: null }).lean<CameraDocument[]>()) {
      if (this.work.isStopped) return;

      // The builder cuts its weeks on the owner's calendar - Monday to Monday
      // where the account is - so the week that has just ended is worked out
      // the same way, per camera, and the push arrives on the owner's Monday.
      const zone = await this.zoneOf(camera.ownerId);
      const last = periodBefore('week', periodAround('week', now, zone), zone);
      const film = await this.filmOfTheWeek(camera.id, { from: last.startsAt, before: last.endsAt });
      if (!film) continue;

      const message = weeklyTimelapseAnnouncement(film, camera, this.linkTo(camera.id, film.id), zone);
      for (const userId of await this.recipients.forCamera(camera.id)) await this.notifications.tellOnce(userId, message);
    }
  }

  /**
   * The finished film of that week, or nothing.
   *
   * A film the builder still counts as stale is one it is about to replace with
   * another under another id, and announcing that one would mean announcing the
   * week twice. So the builder's own test is read from this end: a film covers
   * its week once it reaches the last picture taken in it.
   */
  private async filmOfTheWeek(cameraId: string, week: { from: Date; before: Date }): Promise<MediaDocument | null> {
    const capturedAt = { $gte: week.from, $lt: week.before };
    const film = await this.media.findOne({ cameraId, kind: 'timelapse', window: 'week', capturedAt }).lean<MediaDocument>();
    if (!film) return null;

    const newest = await this.media.findOne({ cameraId, kind: 'still', capturedAt }).sort({ capturedAt: -1 }).lean<MediaDocument>();
    const settled = !newest || (film.endsAt !== null && film.endsAt >= newest.capturedAt);

    return settled ? film : null;
  }

  private async zoneOf(ownerId: string): Promise<string | null> {
    const owner = await this.users.findOne({ id: ownerId }, { 'preferences.timezone': 1 }).lean<Pick<StoredUser, 'preferences'>>();
    return owner?.preferences?.timezone || null;
  }

  /** Where the film is watched. An install that has not said where its app is served links nowhere. */
  private linkTo(cameraId: string, mediaId: string): string | null {
    return this.app.appUrlExternal ? `${this.app.appUrlExternal}/cameras/${cameraId}?film=${mediaId}` : null;
  }
}
