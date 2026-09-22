import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { Model } from 'mongoose';
import type { DeviceSeries, ExportAccepted, ExportScope, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { metric as metricShape, outputMetric } from '@fg2/shared-types/v1-schemas';
import { BackgroundWork } from '@common/background-work';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
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
  climateColumns,
  climateRows,
  csvHeader,
  csvOf,
  csvRows,
  diaryRows,
  growCsv,
  measurementsCsv,
  plantsCsv,
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

/** The builder's own beat. A queued export wakes it; this is what catches one that was queued while the server was down. */
const DRAIN_INTERVAL_MS = 5 * 60 * 1000;
const QUEUE_WAKE_MS = 2000;
const FIRST_PASS_MS = 60 * 1000;

/** One at a time: a zip is minutes of reading and writing, and two of them would only make each other slower. */
const EXPORTS_PER_PASS = 1;

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

  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly media: MediaService,
    private readonly data: DataService,
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
    for (const row of await this.media.queuedExports(EXPORTS_PER_PASS)) {
      if (this.work.isStopped) return;
      await this.build(row);
    }
  }

  private async build(row: MediaDocument): Promise<void> {
    const job = row.exportJob;
    if (!job) return;

    const startedAt = new Date();
    await this.media.setExportJob(row.id, { ...job, status: 'rendering', startedAt });
    const directory = await mkdtemp(join(tmpdir(), 'export-'));
    const path = join(directory, 'export.zip');

    try {
      await this.writeArchive(path, row);
      await this.media.fill(row.id, path, { exportJob: { ...job, status: 'ready', startedAt, endedAt: new Date(), error: null } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`Building export ${row.id} failed: ${detail}`);
      await this.media.setExportJob(row.id, { ...job, status: 'failed', startedAt, endedAt: new Date(), error: detail });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async writeArchive(path: string, row: MediaDocument): Promise<void> {
    const out = createWriteStream(path);
    const zip = new ZipWriter(out);

    if (row.exportJob?.scope === 'grow' && row.exportJob.growId) await this.writeGrow(zip, row.exportJob.growId, '');
    else await this.writeAccount(zip, row.uploadedBy);

    await zip.close();
    out.end();
    await finished(out);
  }

  /**
   * One grow, as a folder: what it was, its plants, its diary, its readings,
   * its climate and its pictures.
   */
  private async writeGrow(zip: ZipWriter, growId: string, prefix: string): Promise<void> {
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
    await this.writePictures(zip, prefix, grow);
  }

  /**
   * The whole account: its own row, the places and the hardware in it, every
   * line it wrote that belongs to no grow, and a folder per grow.
   */
  private async writeAccount(zip: ZipWriter, userId: string | null): Promise<void> {
    const user = userId ? await this.users.findOne({ id: userId }).lean<StoredUser>() : null;
    if (!user) return;

    const [spaces, devices, grows] = await Promise.all([
      this.spaces.find({ ownerId: user.id }).sort({ createdAt: 1 }).lean<SpaceDocument[]>(),
      this.devices.find({ ownerId: user.id }).sort({ createdAt: 1 }).lean<StoredDevice[]>(),
      this.grows.find({ ownerId: user.id }).sort({ startedAt: 1 }).lean<GrowDocument[]>(),
    ]);
    const people: Names = new Map([[user.id, user.handle]]);

    await zip.add('account.csv', user.createdAt, accountCsv(user), true);
    await zip.add(
      'spaces.csv',
      user.createdAt,
      csvOf(
        ['name', 'kind', 'room', 'archivedAt', 'createdAt', 'spaceId'],
        spaces.map(space => [space.name, space.kind, space.roomId, space.archivedAt, space.createdAt, space.id]),
      ),
      true,
    );
    await zip.add(
      'devices.csv',
      user.createdAt,
      csvOf(
        ['name', 'type', 'space', 'lastSeenAt', 'firmwareId', 'deviceId'],
        devices.map(device => [
          device.name,
          device.type,
          spaces.find(space => space.id === device.spaceId)?.name ?? device.spaceId,
          device.state?.lastSeenAt ?? null,
          device.state?.firmwareId ?? null,
          device.id,
        ]),
      ),
      true,
    );

    // The lines that belong to no grow: what happened in a tent, and what the
    // hardware said. Each grow's own diary is in its folder.
    const elsewhere = {
      growId: null,
      $or: [{ spaceId: { $in: spaces.map(space => space.id) } }, { deviceId: { $in: devices.map(device => device.id) } }],
    };
    await zip.add('diary.csv', user.createdAt, Readable.from(this.diaryOf(elsewhere, null, people, new Map())), true);

    for (const grow of grows) await this.writeGrow(zip, grow.id, `grows/${grow.slug}/`);
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
    yield csvHeader(climateColumns(EXPORTED_METRICS, EXPORTED_OUTPUTS));

    const endsAt = grow.endedAt ?? new Date();
    const spaceIds = spacesDuring(grow, grow.startedAt, endsAt).filter((id): id is string => id !== null);
    if (spaceIds.length === 0) return;

    const devices = await this.devices
      .find({ spaceId: { $in: spaceIds } }, { id: 1 })
      .sort({ createdAt: 1, id: 1 })
      .lean<StoredDevice[]>();

    for (let from = grow.startedAt.getTime(); from < endsAt.getTime(); from += CLIMATE_CHUNK_MS) {
      const window = { startsAt: new Date(from), endsAt: new Date(Math.min(from + CLIMATE_CHUNK_MS, endsAt.getTime())) };
      const series: DeviceSeries[] = await Promise.all(
        devices.map(device =>
          this.data.series(device.id, {
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
   * The pictures: what the grow is of, and what its lines point at. Camera
   * stills are not among them - a season of one is a hundred thousand files and
   * the films made from them are what anybody keeps - but a film the grow itself
   * names is, because it is the grow's own.
   */
  private async writePictures(zip: ZipWriter, prefix: string, grow: GrowDocument): Promise<void> {
    const named: string[] = await this.entries.distinct('mediaIds', { growId: grow.id });
    const own = await this.media.ofGrow(grow.id);
    const ids = new Set(
      [...own.map(row => row.id), ...named, grow.coverMediaId, grow.filmMediaId].filter((id): id is string => typeof id === 'string'),
    );

    for (const id of ids) {
      const row = own.find(picture => picture.id === id) ?? (await this.media.byId(id));
      // An export of an export would be this week's zip inside next week's.
      if (!row || row.kind === 'export') continue;

      await zip.add(`${prefix}photos/${fileNameOf(row)}`, row.capturedAt, this.media.read(row.id));
    }
  }

  private async namesOf<T extends { id: string }>(rows: Promise<T[]>, name: (row: T) => string): Promise<Names> {
    return new Map((await rows).map(row => [row.id, name(row)]));
  }
}

/**
 * Whether the export that is already there answers the next request for one. A
 * build in flight always does; a failed one never does; a finished one does
 * until it goes stale, counted from when the file was finished rather than from
 * when it was asked for - a build that took two hours would otherwise be stale
 * the moment it was ready.
 */
const stillGood = (row: MediaDocument, now: Date): boolean => {
  const job = row.exportJob;
  if (job?.status === 'queued' || job?.status === 'rendering') return true;

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
const fileNameOf = (row: MediaDocument): string => {
  const extension = row.mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';

  return `${row.capturedAt.toISOString().slice(0, 10)}-${row.id}.${extension}`;
};
