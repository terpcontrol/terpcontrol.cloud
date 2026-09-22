import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigType } from '@nestjs/config';
import { Model } from 'mongoose';
import { BackgroundWork } from '@common/background-work';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { DataService } from '@modules/data/data.service';
import { logger } from '@utils/logger';
import { retentionConfig } from '../../config/configuration';
import { chunkOf, climateWindowOf, cutoffOf } from './climate-window';

/**
 * Climate retention: "raw samples · then daily summaries", which is what the
 * privacy screen promises beside the window somebody picks there.
 *
 * The windows have been stored and settable since the account screen was built
 * and nothing acted on them, so a person who asked for a year got for ever.
 * This is the sweep that makes the setting true. A day that has fallen out of a
 * device's window is read back as one figure per field - the mean of that day's
 * samples, which the store works out - written into `status_daily`, and only
 * then dropped from `status`. The charts read both, so the year before the
 * window is still drawn; it is a point a day rather than one every thirty
 * seconds.
 *
 * **It is safe to run twice, and safe on an install with years in it.** Nothing
 * is remembered between passes: where the sweep has got to for a device is
 * simply the oldest raw sample that device still has, so a pass that died half
 * way through costs the next one nothing, and a summary written twice is the
 * same summary - the store replaces a point with the same measurement, tag,
 * instant and field. The two acts are ordered the only way they can be, the
 * write before the delete, so an interruption between them leaves a day both
 * summarised and still raw, which the next pass puts right. Each device is
 * taken a few weeks at a time and only so many devices a pass, so the first
 * sweep of an old install is many small pieces of work rather than one
 * enormous one.
 *
 * **What it does not do.** Camera stills are not climate and are not touched
 * here: deleting a free camera's older pictures is a switch of its own
 * (`PREMIUM_FREE_RETENTION`), off unless an install turns it on, and it lives
 * with the rest of the picture pipeline.
 */

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

/**
 * Three in the morning, which is what the fleet screen says on the health card
 * - "retention jobs ran 03:00" - and what an administrator reads that line
 * against. It is the server's own clock: an install serves one time zone's
 * worth of growers and this is the hour nobody is looking.
 */
const RUNS_AT_HOUR = 3;

/** The first pass waits, like the other sweeps: a server coming up has a queue of devices to answer before it has spare reads for last year. */
const FIRST_PASS_MS = 10 * 60 * 1000;

/**
 * How much of one device's backlog a pass takes. Wide enough that an install
 * with three years behind it catches up in weeks of nightly passes rather than
 * years, narrow enough that one query never covers a season.
 */
const DAYS_PER_PASS = 90;

/** How many devices one pass sweeps. The rest wait for the next one; nothing is lost by waiting a day. */
const DEVICES_PER_PASS = 500;

/** What a pass did, which is what it logs and what a test reads. */
export interface RetentionRun {
  devices: number;
  days: number;
  errors: number;
}

@Injectable()
export class ClimateRetentionService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly data: DataService,
    @Inject(retentionConfig.KEY) private readonly config: ConfigType<typeof retentionConfig>,
  ) {}

  public onModuleInit(): void {
    this.work.schedule('The first climate retention pass', () => this.runPeriodically(), FIRST_PASS_MS);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the climate retention sweep');
    this.work.stop();
  }

  /**
   * A pass, and then the next one at three in the morning. Each run schedules
   * its successor rather than an interval doing it, so a pass that takes an
   * hour is not followed immediately by another - and so a server on its way
   * down refuses the next one rather than only cancelling the timer that
   * happens to be pending.
   */
  private async runPeriodically(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      logger.error(`The climate retention sweep failed: ${error}`);
    } finally {
      this.work.schedule('The climate retention sweep', () => this.runPeriodically(), untilNextRun(new Date()));
    }
  }

  /**
   * One pass over the devices. Public so it can be run once, by a test or by
   * hand.
   *
   * A device that fails is counted and the pass goes on. One camera, one broken
   * query or one store that refuses a delete must not leave every other device
   * unswept - and the count is the point of the line the fleet screen reads:
   * "retention jobs ran 03:00 · 0 errors" is only worth printing if a number
   * other than zero can appear there.
   */
  public async run(now: Date = new Date()): Promise<RetentionRun> {
    const run: RetentionRun = { devices: 0, days: 0, errors: 0 };

    const owners = new Map<string, StoredUser | null>();
    const places = new Map<string, SpaceDocument | null>();

    for (const device of await this.devices.find({}).sort({ createdAt: 1 }).limit(DEVICES_PER_PASS).lean<StoredDevice[]>()) {
      if (this.work.isStopped) break;

      try {
        const space = device.spaceId ? await remember(places, device.spaceId, id => this.spaces.findOne({ id }).lean<SpaceDocument>()) : null;
        const owner = device.ownerId ? await remember(owners, device.ownerId, id => this.users.findOne({ id }).lean<StoredUser>()) : null;

        const days = climateWindowOf(space?.retention ?? null, owner?.retention ?? null, this.config.climateDays);
        if (days === null) continue;

        const summarised = await this.sweep(device.id, cutoffOf(days, now));
        if (summarised > 0) {
          run.devices += 1;
          run.days += summarised;
        }
      } catch (error) {
        run.errors += 1;
        logger.error(`Climate retention left device ${device.id} as it was: ${error}`);
      }
    }

    logger.info(`Climate retention summarised ${run.days} day(s) of ${run.devices} device(s), ${run.errors} error(s)`);

    return run;
  }

  /**
   * One device, up to a chunk's worth. The write comes before the delete, and
   * the delete covers exactly the stretch that was summarised - not the whole
   * backlog - so a chunk that was summarised and a chunk that was dropped are
   * always the same chunk.
   *
   * A stretch that summarises to nothing is still dropped. It is a stretch of
   * raw points the store answered no figure for, and leaving them would stop
   * the sweep dead: the next pass would find the same oldest sample and do the
   * same nothing for ever.
   */
  private async sweep(deviceId: string, cutoff: Date): Promise<number> {
    const oldest = await this.data.oldestSampleBefore(deviceId, cutoff);
    if (oldest === null) return 0;

    const chunk = chunkOf(oldest, cutoff, DAYS_PER_PASS);
    if (chunk.endsAt <= chunk.startsAt) return 0;

    const summaries = await this.data.dailySummariesOf(deviceId, chunk);
    await this.data.writeDailySummaries(deviceId, summaries);
    await this.data.dropRawSamples(deviceId, chunk.startsAt, chunk.endsAt);

    return summaries.length;
  }
}

/** The lookup once per id: a tent holds several devices and an account owns several tents. */
const remember = async <T>(known: Map<string, T | null>, id: string, read: (id: string) => Promise<T | null>): Promise<T | null> => {
  if (!known.has(id)) known.set(id, await read(id));

  return known.get(id) ?? null;
};

/** How long until the next three in the morning, which is never nothing: a pass that finishes at 03:00:01 waits a day rather than running again. */
export const untilNextRun = (now: Date): number => {
  const next = new Date(now);
  next.setHours(RUNS_AT_HOUR, 0, 0, 0);
  if (next <= now) next.setTime(next.getTime() + MS_IN_A_DAY);

  return next.getTime() - now.getTime();
};
