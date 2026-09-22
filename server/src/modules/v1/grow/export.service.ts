import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { Model } from 'mongoose';
import type { DeviceSeries, ExportAccepted, ExportScope, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { metric as metricShape, outputMetric } from '@fg2/shared-types/v1-schemas';
import { BackgroundWork } from '@common/background-work';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, SubjectType } from '@common/v1/access.types';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { DataService } from '@modules/data/data.service';
import { MediaService } from '@modules/v1/camera/media.service';
import { logger } from '@utils/logger';
import { READING_KINDS } from '../diary/diary-entries';
import { spacesDuring } from '../diary/grow-places';
import {
  DIARY_COLUMNS,
  Names,
  accountSettingsJson,
  alarmsCsv,
  alertsCsv,
  camerasCsv,
  climateColumns,
  climateRows,
  csvHeader,
  csvOf,
  csvRows,
  devicesCsv,
  diaryRows,
  growCsv,
  measurementsCsv,
  plansCsv,
  plantsCsv,
  spacesCsv,
  stillsCsv,
  tasksCsv,
} from './export-csv';
import { ZipWriter } from './export-zip';

/**
 * Exports: a zip of a grow, or of everything an account has.
 *
 * The ADR settles the shape and this is it. A zip of a season with its pictures
 * in it does not finish inside a request, so the route answers a job and the
 * job is polled; and the job is not a collection of its own but the media row
 * that the finished file will be. That one decision is what makes the rest
 * free: the bytes go in the bucket the pictures use, `GET /media/{id}/content`
 * serves them without knowing what they are, and the daily sweep removes an
 * export nothing points at - which is every export, a week after it was asked
 * for - without being told about exports at all.
 *
 * **Who may have one.** Exporting needs `own`, which is the strictest need
 * there is: this is everything about a grow in one file, weights and plant
 * counts included, and a demo session, a share link and a public address are
 * none of them the owner. The row itself is private the same way - `access()`
 * resolves an export to the account that asked for it and to nobody else - so
 * one person's job id tells another person nothing at all, not even that it
 * exists.
 */

/** How long a finished export stands in for the next request for one. Long enough to survive a double tap, short enough that tomorrow's export is of today. */
const FRESH_MS = 60 * 60 * 1000;

/**
 * The builder's own beat. A queued export wakes it; this is what catches one
 * left behind while the server was down - which is rarely one still saying
 * `queued` and usually one saying `rendering`, because a build that was
 * interrupted had already started.
 */
const DRAIN_INTERVAL_MS = 5 * 60 * 1000;
const QUEUE_WAKE_MS = 2000;
const FIRST_PASS_MS = 60 * 1000;

/**
 * How long a row may say `rendering` before it is taken for a build that will
 * never finish. Two passes: long enough that a season of photos is not given up
 * on half way through, short enough that a restart costs one pass rather than
 * the week it takes the sweep to remove the corpse.
 */
const STALE_BUILD_MS = 2 * DRAIN_INTERVAL_MS;

/** One at a time: a zip is minutes of reading and writing, and two of them would only make each other slower. */
const EXPORTS_PER_PASS = 1;

/** Abandoned builds put back in the queue in one pass. More than the one it then builds, so a restart is not undone a pass at a time. */
const REQUEUE_PER_PASS = 20;

/**
 * How fine the climate file is. A device reports every thirty seconds and the
 * store answers the mean of a window, so this is two samples to the row: fine
 * enough to see a heater cycling, and half the rows of asking for every one.
 */
const CLIMATE_STEP_SECONDS = 60;

/** How much of a grow one read of the store covers, at that step. The reader widens a step that asks for more points than it will answer. */
const CLIMATE_CHUNK_MS = 12 * 60 * 60 * 1000;

/** Everything a device can measure or drive, because an export is not a chart and nobody ticked anything. */
const EXPORTED_METRICS: readonly Metric[] = metricShape.options.filter(name => name !== 'offline');
const EXPORTED_OUTPUTS: readonly OutputMetric[] = outputMetric.options;

@Injectable()
export class ExportService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  /** The exports this process has in hand, so that a long build is not mistaken for an abandoned one and started a second time. */
  private readonly building = new Set<string>();

  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.alarmRule) private readonly alarmRules: Model<StoredAlarmRule>,
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.plan) private readonly plans: Model<StoredPlan>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    private readonly media: MediaService,
    private readonly data: DataService,
    private readonly access: AccessService,
  ) {}

  public onModuleInit(): void {
    this.work.schedule('The first pass of the export builder', () => this.drain(), FIRST_PASS_MS);
    this.work.repeat('The export builder', () => this.drain(), DRAIN_INTERVAL_MS);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the export builder');
    this.work.stop();
  }

  /**
   * The job, whether it was just made or was already there. Asking twice in a
   * minute is one export: a second zip of the same grow would cost what the
   * first cost and say the same thing, so a build in flight and a file still
   * fresh both answer themselves, and only `queued` tells the two apart.
   */
  public async ask(userId: string, scope: ExportScope, growId: string | null, now: Date = new Date()): Promise<ExportAccepted> {
    const standing = await this.media.newestExport(userId, scope, growId);
    if (standing && stillGood(standing, now)) return { media: this.media.serialise(standing), queued: false };

    const row = await this.media.queue({
      kind: 'export',
      mime: 'application/zip',
      uploadedBy: userId,
      // An export belongs to the account and to nothing that is shared, so it
      // names no grow here; what it is of is in the job.
      capturedAt: now,
      exportJob: { status: 'queued', scope, growId, startedAt: null, endedAt: null, error: null },
    });

    this.work.schedule('A freshly asked-for export', () => this.drain(), QUEUE_WAKE_MS);

    return { media: this.media.serialise(row), queued: true };
  }

  /** One pass over the queue. Public so it can be run once, in a test or by hand. */
  public async drain(): Promise<void> {
    await this.requeueAbandoned();

    for (const row of await this.media.queuedExports(EXPORTS_PER_PASS)) {
      if (this.work.isStopped) return;
      if (this.building.has(row.id)) continue;
      await this.build(row);
    }
  }

  /**
   * The builds nobody is building any more. A server stopped mid-zip leaves its
   * row saying `rendering` and no timer looks at those, so they are put back in
   * the queue here rather than waiting for somebody to ask for the same export
   * again - and a row this process is still writing is not one of them,
   * however long it has been taking.
   */
  private async requeueAbandoned(): Promise<void> {
    for (const row of await this.media.stalledExports(REQUEUE_PER_PASS, new Date(Date.now() - STALE_BUILD_MS))) {
      if (!row.exportJob || this.building.has(row.id)) continue;

      logger.warn(`Export ${row.id} was left half-built and is queued again`);
      await this.media.setExportJob(row.id, { ...row.exportJob, status: 'queued', startedAt: null });
    }
  }

  private async build(row: MediaDocument): Promise<void> {
    const job = row.exportJob;
    if (!job) return;

    const startedAt = new Date();
    await this.media.setExportJob(row.id, { ...job, status: 'rendering', startedAt });
    const directory = await mkdtemp(join(tmpdir(), 'export-'));
    const path = join(directory, 'export.zip');
    this.building.add(row.id);

    try {
      await this.writeArchive(path, directory, row);
      await this.media.fill(row.id, path, { exportJob: { ...job, status: 'ready', startedAt, endedAt: new Date(), error: null } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`Building export ${row.id} failed: ${detail}`);
      await this.media.setExportJob(row.id, { ...job, status: 'failed', startedAt, endedAt: new Date(), error: detail });
    } finally {
      this.building.delete(row.id);
      await rm(directory, { recursive: true, force: true });
    }
  }

  /**
   * The archive itself, into a file the caller then hands to the bucket.
   *
   * A write that fails arrives twice: once at the callback the writer is
   * waiting on, and once as an `error` event on the stream. The event is the
   * dangerous half - nothing listens for it, so node raises it as an uncaught
   * exception, and the process answers those by ending and takes every other
   * request down with it. Listening for it and racing it against the writing is
   * what turns a full disk into a job that says so.
   *
   * The listener stays on for the stream's whole life and both sides of the
   * race are caught, because a failure is rarely the only one: the writing goes
   * on for a moment after the stream is gone, and a second event with nobody
   * left to hear it, or a rejection nobody observed, ends the process just as
   * surely as the first would have.
   */
  private async writeArchive(path: string, directory: string, row: MediaDocument): Promise<void> {
    const out = createWriteStream(path);
    const zip = new ZipWriter(out);

    const failed = new Promise<never>((_, reject) => out.on('error', reject));
    const written = (async () => {
      if (row.exportJob?.scope === 'grow' && row.exportJob.growId) await this.writeGrow(zip, row.exportJob.growId, '', directory);
      else await this.writeAccount(zip, row.uploadedBy, directory);

      await zip.close();
      out.end();
      await finished(out);
    })();

    failed.catch(() => undefined);
    written.catch(() => undefined);

    try {
      await Promise.race([written, failed]);
    } finally {
      out.destroy();
    }
  }

  /**
   * One grow, as a folder: what it was, its plants, its diary, its readings,
   * its climate and its pictures.
   */
  private async writeGrow(zip: ZipWriter, growId: string, prefix: string, directory: string): Promise<void> {
    const grow = await this.grows.findOne({ id: growId }).lean<GrowDocument>();
    if (!grow) return;

    const [plants, spaces, people] = await Promise.all([
      this.plants.find({ growId }).sort({ createdAt: 1 }).lean<PlantDocument[]>(),
      this.namesOf(this.spaces.find({}, { id: 1, name: 1 }).lean<Pick<SpaceDocument, 'id' | 'name'>[]>(), space => space.name),
      this.namesOf(this.users.find({}, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>(), user => user.handle),
    ]);
    const labels: Names = new Map(plants.map(plant => [plant.id, plant.label]));

    await zip.add(`${prefix}grow.csv`, grow.startedAt, growCsv(grow, spaces), true);
    await zip.add(`${prefix}plants.csv`, grow.startedAt, plantsCsv(plants), true);
    await zip.add(`${prefix}diary.csv`, grow.startedAt, Readable.from(this.diaryOf({ growId }, grow, people, labels)), true);
    await zip.add(`${prefix}measurements.csv`, grow.startedAt, await this.measurementsOf(grow, labels), true);
    await zip.add(`${prefix}climate.csv`, grow.startedAt, Readable.from(this.climateOf(grow)), true);
    await this.writePictures(zip, prefix, grow, directory);
  }

  /**
   * The whole account, which is what the privacy screen calls "export
   * everything": its settings, the places and the hardware in it, the cameras,
   * the alarms and what they raised, the rhythms the task list comes from, the
   * plans its controllers run, every line it wrote that belongs to no grow,
   * the pictures of those lines, the climate of every device it owns, and a
   * folder per grow.
   *
   * Ownership is the boundary and `access()` draws it. The queries narrow by
   * `ownerId` because something has to - `access()` answers about one subject
   * and there is no asking it about a collection - but every row they find is
   * then put to the same decision every request goes through, with the asking
   * account's own context and nothing else. A grow this account was invited to
   * is therefore not here: a member may read it, log in it and manage it, and
   * `own` is the one need a membership never widens. That is also why an
   * administrator exporting their own account gets their own account: the
   * context is built without `isAdmin`, so the decision is made as the person
   * rather than as the office.
   *
   * What a member wrote inside a grow this account owns *is* here, because the
   * grow is. The diary carries its author, so a line of somebody else's is
   * theirs on the page as well as in the model.
   */
  private async writeAccount(zip: ZipWriter, userId: string | null, directory: string): Promise<void> {
    const user = userId ? await this.users.findOne({ id: userId }).lean<StoredUser>() : null;
    if (!user) return;

    const ctx: AccessContext = { userId: user.id, isAdmin: false, isDemo: false, shareToken: null };
    const [spaces, devices, grows, cameras] = await Promise.all([
      this.owned(ctx, 'space', await this.spaces.find({ ownerId: user.id }).sort({ createdAt: 1 }).lean<SpaceDocument[]>()),
      this.owned(ctx, 'device', await this.devices.find({ ownerId: user.id }).sort({ createdAt: 1 }).lean<StoredDevice[]>()),
      this.owned(ctx, 'grow', await this.grows.find({ ownerId: user.id }).sort({ startedAt: 1 }).lean<GrowDocument[]>()),
      this.owned(ctx, 'camera', await this.cameras.find({ ownerId: user.id }).sort({ createdAt: 1 }).lean<CameraDocument[]>()),
    ]);

    const spaceIds = spaces.map(space => space.id);
    const deviceIds = devices.map(device => device.id);
    const spaceNames: Names = new Map(spaces.map(space => [space.id, space.name]));
    // A device that has never been named is known by its id, which is what the
    // fleet screen falls back to as well.
    const deviceNames: Names = new Map(devices.map(device => [device.id, device.name ?? device.id]));
    const cameraNames: Names = new Map(cameras.map(camera => [camera.id, camera.name]));
    const subjects: Names = new Map([...spaceNames, ...grows.map((grow): [string, string] => [grow.id, grow.name])]);
    const people = await this.namesOf(this.users.find({}, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>(), row => row.handle);

    const [members, rules, alerts, reminders, plans] = await Promise.all([
      this.membersOf(spaceIds, people),
      this.alarmRules
        .find({ deviceId: { $in: deviceIds } })
        .sort({ createdAt: 1 })
        .lean<StoredAlarmRule[]>(),
      this.alerts
        .find({ $or: [{ deviceId: { $in: deviceIds } }, { cameraId: { $in: cameras.map(camera => camera.id) } }] })
        .sort({ startedAt: 1 })
        .lean<StoredAlert[]>(),
      this.reminders
        .find({ 'subject.id': { $in: [...spaceIds, ...grows.map(grow => grow.id)] } })
        .sort({ createdAt: 1 })
        .lean<ReminderDocument[]>(),
      this.plans
        .find({ deviceId: { $in: deviceIds } })
        .sort({ createdAt: 1 })
        .lean<StoredPlan[]>(),
    ]);

    await zip.add('account.json', user.createdAt, accountSettingsJson(user), true);
    await zip.add('account.csv', user.createdAt, accountCsv(user), true);
    await zip.add('spaces.csv', user.createdAt, spacesCsv(spaces, spaceNames, members), true);
    await zip.add('devices.csv', user.createdAt, devicesCsv(devices, spaceNames), true);
    await zip.add('cameras.csv', user.createdAt, camerasCsv(cameras, spaceNames), true);
    await zip.add('alarms.csv', user.createdAt, alarmsCsv(rules, deviceNames), true);
    await zip.add('alerts.csv', user.createdAt, alertsCsv(alerts, deviceNames, cameraNames), true);
    await zip.add('tasks.csv', user.createdAt, tasksCsv(reminders, subjects, people), true);
    await zip.add('plans.csv', user.createdAt, plansCsv(plans, deviceNames), true);

    // The lines that belong to no grow: what happened in a tent, and what the
    // hardware said. Each grow's own diary is in its folder.
    const elsewhere = {
      growId: null,
      $or: [{ spaceId: { $in: spaceIds } }, { deviceId: { $in: deviceIds } }],
    };
    await zip.add('diary.csv', user.createdAt, Readable.from(this.diaryOf(elsewhere, null, people, new Map())), true);

    await this.writeOwnPictures(zip, user, elsewhere, directory);
    await this.writeFilms(zip, cameras, directory, user.createdAt);
    await this.writeStillsInventory(zip, cameras, user.createdAt);
    await zip.add('README.txt', user.createdAt, readmeOf(), true);
    for (const device of devices) await this.writeDeviceClimate(zip, device);
    for (const grow of grows) await this.writeGrow(zip, grow.id, `grows/${grow.slug}/`, directory);
  }

  /**
   * Every finished film of every camera the account owns, in one folder.
   *
   * A film belongs to its camera and to nothing else - no grow, no space - so
   * neither the grow folders nor the diary can reach one, and before this they
   * were the part of "export everything" that was in no export at all. There
   * are a handful per camera: the three rolling ones, which replace themselves,
   * and whatever somebody composed and kept. A film that is still rendering or
   * that failed is left out, because there are no bytes behind it.
   */
  private async writeFilms(zip: ZipWriter, cameras: readonly CameraDocument[], directory: string, listedAt: Date): Promise<void> {
    const films = await this.media.ofCameras(
      cameras.map(camera => camera.id),
      'timelapse',
    );

    const ready = films.filter(film => film.render === null || film.render.status === 'ready');
    await this.writeFiles(
      zip,
      '',
      ready.map(film => film.id),
      directory,
      listedAt,
      'films',
    );
  }

  /**
   * What the zip does not hold, named and counted rather than quietly absent -
   * the rule the missing list beside it already follows.
   *
   * Single stills stay in the app. One camera keeps a picture every thirty
   * seconds and thins them as they age, which still comes to tens of thousands
   * of files and gigabytes over the three years they are kept, so a zip of them
   * is neither buildable nor downloadable. What a grower is owed instead is the
   * difference: how many each camera holds, how much they weigh and which
   * stretch of time they cover, so that nobody has to guess what stayed behind.
   */
  private async writeStillsInventory(zip: ZipWriter, cameras: readonly CameraDocument[], listedAt: Date): Promise<void> {
    const tally = await this.media.tallyOfCameras(
      cameras.map(camera => camera.id),
      'still',
    );

    await zip.add('stills.csv', listedAt, stillsCsv(cameras, tally), true);
  }

  /**
   * The rows of a batch this account really owns. The query that found them
   * said so already; this is the same claim put to the one function that
   * decides it, so that an export cannot be the one place in the server where
   * ownership means something slightly different.
   */
  private async owned<T extends { id: string }>(ctx: AccessContext, type: SubjectType, rows: T[]): Promise<T[]> {
    const allowed: T[] = [];
    for (const row of rows) {
      if (await this.access.access(ctx, subjectRef(type, row.id), 'own')) allowed.push(row);
    }

    return allowed;
  }

  /** Who each place is shared with, by handle: the grower reading this knows their tent by its name and their friend by theirs. */
  private async membersOf(spaceIds: string[], people: Names): Promise<Map<string, string[]>> {
    const rows = await this.memberships.find({ spaceId: { $in: spaceIds } }).lean<MembershipDocument[]>();

    const bySpace = new Map<string, string[]>();
    for (const row of rows) bySpace.set(row.spaceId, [...(bySpace.get(row.spaceId) ?? []), people.get(row.userId) ?? row.userId]);

    return bySpace;
  }

  /**
   * A device's whole climate, whatever it was ever pointed at. The grow folders
   * hold the same readings cut to the seasons they belong to, and this is what
   * is left over: a fridge that has never been part of a grow, and the weeks
   * between two of them, which would otherwise be the one thing an export of
   * everything did not have.
   *
   * It starts where the device does rather than at an arbitrary depth, so an
   * install with years behind it hands over the years.
   */
  private async writeDeviceClimate(zip: ZipWriter, device: StoredDevice): Promise<void> {
    const from = device.state?.claimedAt ?? device.createdAt;
    await zip.add(`climate/${device.id}.csv`, from, Readable.from(this.climateBetween([device.id], from, new Date())), true);
  }

  /**
   * The pictures of the lines that belong to no grow, and the face the account
   * wears. Each grow's own are written with the grow.
   */
  private async writeOwnPictures(zip: ZipWriter, user: StoredUser, elsewhere: Record<string, unknown>, directory: string): Promise<void> {
    const named: string[] = await this.entries.distinct('mediaIds', elsewhere);
    await this.writeFiles(zip, '', [...named, user.avatarMediaId], directory, user.createdAt);
  }

  /**
   * The diary as it comes out of the database, in blocks. A season of a busy
   * tent is hundreds of thousands of lines - a device writes one whenever it has
   * something to say - so it is never held whole in memory on either side.
   */
  private async *diaryOf(filter: Record<string, unknown>, grow: GrowDocument | null, people: Names, plants: Names): AsyncGenerator<Buffer> {
    yield csvHeader(DIARY_COLUMNS);

    let block: EntryDocument[] = [];
    const cursor = this.entries.find(filter).sort({ occurredAt: 1, id: 1 }).lean<EntryDocument>().cursor();
    for (let entry = await cursor.next(); entry != null; entry = await cursor.next()) {
      block.push(entry);
      if (block.length >= 500) {
        yield csvRows(diaryRows(block, grow, people, plants));
        block = [];
      }
    }

    if (block.length > 0) yield csvRows(diaryRows(block, grow, people, plants));
  }

  private async measurementsOf(grow: GrowDocument, plants: Names): Promise<Buffer> {
    const entries = await this.entries
      .find({ growId: grow.id, kind: { $in: READING_KINDS } })
      .sort({ occurredAt: 1, id: 1 })
      .lean<EntryDocument[]>();

    return measurementsCsv(entries, grow.measurements, grow, plants);
  }

  /**
   * The climate of everything that stood where the grow stood, half a day at a
   * time. The store answers a bounded number of points per read, so a season is
   * a few hundred reads rather than one that would be widened until a row was
   * an hour of a heater.
   */
  private async *climateOf(grow: GrowDocument): AsyncGenerator<Buffer> {
    const endsAt = grow.endedAt ?? new Date();
    const spaceIds = spacesDuring(grow, grow.startedAt, endsAt).filter((id): id is string => id !== null);
    const devices = spaceIds.length
      ? await this.devices
          .find({ spaceId: { $in: spaceIds } }, { id: 1 })
          .sort({ createdAt: 1, id: 1 })
          .lean<StoredDevice[]>()
      : [];

    yield* this.climateBetween(
      devices.map(device => device.id),
      grow.startedAt,
      endsAt,
    );
  }

  /** The same file for whatever devices and whatever stretch of time the caller means, which is a grow's place or a device's whole life. */
  private async *climateBetween(deviceIds: readonly string[], startsAt: Date, endsAt: Date): AsyncGenerator<Buffer> {
    yield csvHeader(climateColumns(EXPORTED_METRICS, EXPORTED_OUTPUTS));
    if (deviceIds.length === 0) return;

    for (let from = startsAt.getTime(); from < endsAt.getTime(); from += CLIMATE_CHUNK_MS) {
      const window = { startsAt: new Date(from), endsAt: new Date(Math.min(from + CLIMATE_CHUNK_MS, endsAt.getTime())) };
      const series: DeviceSeries[] = await Promise.all(
        deviceIds.map(deviceId =>
          this.data.series(deviceId, {
            ...window,
            stepSeconds: CLIMATE_STEP_SECONDS,
            metrics: EXPORTED_METRICS,
            outputs: EXPORTED_OUTPUTS,
          }),
        ),
      );

      const rows = climateRows(series, EXPORTED_METRICS, EXPORTED_OUTPUTS).filter(row => row.slice(2).some(value => value !== null));
      if (rows.length > 0) yield csvRows(rows);
    }
  }

  /**
   * The pictures of a grow: what its lines point at, and what it is shown by.
   *
   * Camera stills are not among them and never can be - a season of one camera
   * is tens of thousands of files - and neither are its films, because a film
   * belongs to the camera rather than to the grow it happened to watch. The
   * account export writes those once, under `films/`, which is the only place
   * they belong: a grow folder would copy the same film into every season the
   * camera looked at. `grow.filmMediaId` is carried here because the model has
   * it, not because anything writes one yet.
   */
  private async writePictures(zip: ZipWriter, prefix: string, grow: GrowDocument, directory: string): Promise<void> {
    const named: string[] = await this.entries.distinct('mediaIds', { growId: grow.id });
    const own = await this.media.ofGrow(grow.id);

    await this.writeFiles(zip, prefix, [...own.map(row => row.id), ...named, grow.coverMediaId, grow.filmMediaId], directory, grow.startedAt);
  }

  /**
   * The copying itself, which a grow's folder and the account's own root both
   * do.
   *
   * Each picture is taken out of the bucket onto the disk before it goes into
   * the archive, one at a time. An entry's header is written before its bytes,
   * so a stream that died half way through would leave a truncated entry and an
   * archive that will not open; copying first is what makes a picture whose
   * bytes are gone one picture missing rather than the whole export lost.
   */
  private async writeFiles(
    zip: ZipWriter,
    prefix: string,
    mediaIds: readonly (string | null)[],
    directory: string,
    listedAt: Date,
    folder = 'photos',
  ): Promise<void> {
    const ids = new Set(mediaIds.filter((id): id is string => typeof id === 'string'));

    const unreadable: string[] = [];
    for (const id of ids) {
      const row = await this.media.byId(id);
      // An export of an export would be this week's zip inside next week's.
      if (!row || row.kind === 'export') continue;

      const scratch = join(directory, `picture-${row.id}`);
      try {
        await this.media.copyToFile(row.id, scratch);
      } catch (error) {
        logger.error(`Leaving picture ${row.id} out of an export: ${error}`);
        unreadable.push(row.id);
        continue;
      }

      try {
        await zip.add(`${prefix}${folder}/${fileNameOf(row)}`, row.capturedAt, createReadStream(scratch));
      } finally {
        await rm(scratch, { force: true });
      }
    }

    // What could not be read is named rather than quietly absent: somebody
    // counting their photos back is owed the difference.
    if (unreadable.length > 0) {
      await zip.add(
        `${prefix}${folder}/missing.csv`,
        listedAt,
        csvOf(
          ['mediaId'],
          unreadable.map(id => [id]),
        ),
        true,
      );
    }
  }

  private async namesOf<T extends { id: string }>(rows: Promise<T[]>, name: (row: T) => string): Promise<Names> {
    return new Map((await rows).map(row => [row.id, name(row)]));
  }
}

/**
 * Whether the export that is already there answers the next request for one. A
 * build in flight does while it is still running; a failed one never does; a
 * finished one does until it goes stale, counted from when the file was
 * finished rather than from when it was asked for - a build that took two hours
 * would otherwise be stale the moment it was ready.
 *
 * A build that stopped being a build is the case worth naming: a row left
 * saying `rendering` by a server that went down would otherwise answer every
 * later request with a file of no bytes that nothing is writing.
 */
const stillGood = (row: MediaDocument, now: Date): boolean => {
  const job = row.exportJob;
  if (job?.status === 'queued') return true;
  if (job?.status === 'rendering') return job.startedAt !== null && now.getTime() - job.startedAt.getTime() < STALE_BUILD_MS;

  return job?.status === 'ready' && now.getTime() - (job.endedAt ?? row.createdAt).getTime() < FRESH_MS;
};

/** What the account itself is, on one row. The password hash is the one thing here that is never anybody's to export. */
const accountCsv = (user: StoredUser): Buffer =>
  csvOf(
    ['handle', 'email', 'createdAt', 'isActive', 'isAdmin', 'locale', 'timezone', 'publicProfile', 'userId'],
    [
      [
        user.handle,
        user.email,
        user.createdAt,
        user.isActive,
        user.isAdmin,
        user.preferences.locale,
        user.preferences.timezone,
        user.publicProfile,
        user.id,
      ],
    ],
  );

/** What a picture is called in the archive: the day it was taken, so a folder sorts into the order the grow happened in. */
/**
 * What the zip says about itself.
 *
 * A grower who has just exported everything and is about to delete their
 * account reads this rather than a settings screen, possibly years later and
 * certainly without the app in front of them. So it names what is here, names
 * what is not, and says why - the one thing left out is the single stills, and
 * the reason is a number rather than a policy.
 */
const readmeOf = (): Buffer =>
  Buffer.from(
    [
      'Your Terp Control export',
      '',
      'account.json / account.csv  your settings, as the app holds them',
      'spaces.csv, devices.csv, cameras.csv, alarms.csv, alerts.csv, tasks.csv, plans.csv',
      '                            the places, the hardware and what it was told to do',
      'diary.csv                   every line that belongs to no grow, with its author',
      'photos/                     the pictures those lines point at, and your avatar',
      'films/                      every finished timelapse of every camera you own',
      'climate/<device>.csv        every reading each device ever sent',
      'grows/<grow>/               a folder each: the diary, the plants, the readings',
      '                            and the photos of that season',
      'stills.csv                  how many single stills each camera holds',
      '',
      'The single stills themselves are not in here. A camera keeps a picture every',
      'thirty seconds and thins them as they age; one camera still comes to tens of',
      'thousands of files over the years they are kept, which is not a file anybody',
      'could download. stills.csv says exactly how many each camera has and which',
      'stretch of time they cover, and the films above are made from them.',
      '',
    ].join('\n'),
    'utf8',
  );

const fileNameOf = (row: MediaDocument): string => {
  const extension = row.mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';

  return `${row.capturedAt.toISOString().slice(0, 10)}-${row.id}.${extension}`;
};
