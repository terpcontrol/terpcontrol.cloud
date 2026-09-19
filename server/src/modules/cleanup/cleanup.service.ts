import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { logger } from '@utils/logger';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { picturesTheWayBackHolds } from '@/migrations/way-back';
import { BackgroundWork } from '../../common/background-work';
import { ImageStore } from '../../database/image-store';

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

// Records are only removed once nothing can reach them any more *and* they have
// aged past this grace period: an uploaded picture exists before the diary entry
// that references it, and a device may be re-registered right after being removed.
const ORPHAN_GRACE_MS = 7 * MS_IN_A_DAY;

const CLEANUP_INTERVAL_MS = MS_IN_A_DAY;
const CLEANUP_START_DELAY_MS = 5 * 60 * 1000;
const BATCH_SIZE = 500;

/** A device reports the outcome of every capture it takes, under this key. */
const CAM_CAPTURE_KEY = 'message-cam-capture';

const batches = <T>(items: T[], size = BATCH_SIZE): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

/**
 * The ids a document names, without the ones it does not. Every reference in the
 * model is `null` when it means nothing, and a `$in` carrying that `null` matches
 * every document whose field is absent - so a sweep that deletes by a list of ids
 * has to be given ids and nothing else.
 */
const named = (...ids: (string | null | undefined)[]): string[] => [...new Set(ids.filter((id): id is string => typeof id === 'string'))];

/** What a batch of ids answers with: the ones that are still there. */
type Lookup = (ids: string[]) => Promise<{ id: string }[]>;

@Injectable()
export class CleanupService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    private readonly store: ImageStore,
  ) {}

  public onModuleInit(): void {
    this.work.schedule('The cleanup of unreachable entries and media', () => this.runPeriodically(), CLEANUP_START_DELAY_MS);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the cleanup sweep');
    this.work.stop();
  }

  private async runPeriodically(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      logger.error(`Cleanup of unreachable entries and media failed: ${e}`);
    } finally {
      // Each run schedules the next, so a stopped server has to refuse it rather
      // than only cancel the timer that happens to be pending.
      this.work.schedule('The cleanup of unreachable entries and media', () => this.runPeriodically(), CLEANUP_INTERVAL_MS);
    }
  }

  public async run(
    now = Date.now(),
  ): Promise<{ deletedEntries: number; deletedMedia: number; deletedOrphanedFiles: number; deletedCamDiagnostics: number }> {
    const cutoff = new Date(now - ORPHAN_GRACE_MS);

    // Entries go first: a picture only its entry listed becomes unreferenced by
    // that deletion and is collected by the same run.
    const deletedCamDiagnostics = await this.deleteSucceededCamCaptureEntries();
    const deletedEntries = await this.deleteUnreachableEntries(cutoff);
    const deletedMedia = await this.deleteUnreachableMedia(cutoff);
    // Last: the sweep below only counts files no media document names, and the
    // deletes above have just removed the documents of everything unreachable.
    const deletedOrphanedFiles = await this.deleteOrphanedMediaData(cutoff);

    if (deletedEntries > 0 || deletedMedia > 0 || deletedOrphanedFiles > 0 || deletedCamDiagnostics > 0) {
      logger.info(
        `Cleanup removed ${deletedEntries} unreachable entries, ${deletedCamDiagnostics} camera capture diagnostics, ` +
          `${deletedMedia} unreachable media and the stored data of ${deletedOrphanedFiles} picture(s) that no longer exist`,
      );
    }

    return { deletedEntries, deletedMedia, deletedOrphanedFiles, deletedCamDiagnostics };
  }

  /**
   * A camera reports the outcome of every capture, which is one line every 30
   * seconds. Successful ones are diagnostics rather than diary material and are
   * no longer written, so the ones firmware in the field still sends - and the
   * ones an earlier build stored - are collected here.
   */
  private async deleteSucceededCamCaptureEntries(): Promise<number> {
    const result = await this.entries.deleteMany({ 'message.key': CAM_CAPTURE_KEY, 'message.params.0': { $regex: '^ok' } });
    return result?.deletedCount ?? 0;
  }

  /**
   * An entry lives on the timeline of everything it names - a grow, a space, a
   * device - so it is unreachable only once every one of them is gone. An entry
   * that names none of them is somebody's own line about nothing in particular
   * and is theirs to delete.
   */
  private async deleteUnreachableEntries(cutoff: Date): Promise<number> {
    const cursor = this.entries
      .find({
        createdAt: { $lt: cutoff },
        $or: [{ growId: { $ne: null } }, { spaceId: { $ne: null } }, { deviceId: { $ne: null } }],
      })
      .select({ id: 1, growId: 1, spaceId: 1, deviceId: 1 })
      .cursor();

    let deleted = 0;
    let candidates: Pick<EntryDocument, 'id' | 'growId' | 'spaceId' | 'deviceId'>[] = [];

    const flush = async () => {
      if (candidates.length === 0) return;

      const grows = await this.stillThere(
        ids => this.grows.find({ id: { $in: ids } }, { id: 1 }).lean(),
        candidates.map(entry => entry.growId),
      );
      const spaces = await this.stillThere(
        ids => this.spaces.find({ id: { $in: ids } }, { id: 1 }).lean(),
        candidates.map(entry => entry.spaceId),
      );
      const devices = await this.stillThere(
        ids => this.devices.find({ id: { $in: ids } }, { id: 1 }).lean(),
        candidates.map(entry => entry.deviceId),
      );

      const doomed = candidates
        .filter(
          entry =>
            !named(entry.growId).some(id => grows.has(id)) &&
            !named(entry.spaceId).some(id => spaces.has(id)) &&
            !named(entry.deviceId).some(id => devices.has(id)),
        )
        .map(entry => entry.id);
      candidates = [];

      deleted += await this.deleteByIds(this.entries, doomed);
    };

    for (let entry = await cursor.next(); entry != null; entry = await cursor.next()) {
      candidates.push(entry);
      if (candidates.length >= BATCH_SIZE) await flush();
    }
    await flush();

    return deleted;
  }

  /**
   * A picture is reachable two ways, and either is enough: it belongs to a
   * camera, a grow or a space that still exists, or something names it - a diary
   * entry lists it, a grow made it its cover or its film, an account wears it.
   */
  private async deleteUnreachableMedia(cutoff: Date): Promise<number> {
    const cursor = this.media
      .find({ createdAt: { $lt: cutoff } })
      .select({ id: 1, cameraId: 1, growId: 1, spaceId: 1 })
      .cursor();

    let deleted = 0;
    let candidates: Pick<MediaDocument, 'id' | 'cameraId' | 'growId' | 'spaceId'>[] = [];

    const flush = async () => {
      if (candidates.length === 0) return;

      const cameras = await this.stillThere(
        ids => this.cameras.find({ id: { $in: ids } }, { id: 1 }).lean(),
        candidates.map(media => media.cameraId),
      );
      const grows = await this.stillThere(
        ids => this.grows.find({ id: { $in: ids } }, { id: 1 }).lean(),
        candidates.map(media => media.growId),
      );
      const spaces = await this.stillThere(
        ids => this.spaces.find({ id: { $in: ids } }, { id: 1 }).lean(),
        candidates.map(media => media.spaceId),
      );
      const referenced = await this.referencedPictures(candidates);
      const spokenFor = await picturesTheWayBackHolds(
        this.media.db.db,
        candidates.map(media => media.id),
      );

      const doomed = candidates
        .filter(
          media =>
            !named(media.cameraId).some(id => cameras.has(id)) &&
            !named(media.growId).some(id => grows.has(id)) &&
            !named(media.spaceId).some(id => spaces.has(id)) &&
            !referenced.has(media.id) &&
            !spokenFor.has(media.id),
        )
        .map(media => media.id);
      candidates = [];

      // The delete hook on the schema drops the bytes of every document it removes.
      deleted += await this.deleteByIds(this.media, doomed);
    };

    for (let media = await cursor.next(); media != null; media = await cursor.next()) {
      candidates.push(media);
      if (candidates.length >= BATCH_SIZE) await flush();
    }
    await flush();

    return deleted;
  }

  /** The pictures of this batch something still names: a diary entry, a grow's cover or film, an account's avatar. */
  private async referencedPictures(candidates: Pick<MediaDocument, 'id'>[]): Promise<Set<string>> {
    const referenced = new Set<string>();

    for (const batch of batches(candidates.map(media => media.id))) {
      const inEntries: string[] = await this.entries.distinct('mediaIds', { mediaIds: { $in: batch } });
      const inGrows = await this.grows
        .find({ $or: [{ coverMediaId: { $in: batch } }, { filmMediaId: { $in: batch } }] }, { coverMediaId: 1, filmMediaId: 1 })
        .lean();
      const inUsers: (string | null)[] = await this.users.distinct('avatarMediaId', { avatarMediaId: { $in: batch } });

      for (const id of [...inEntries, ...inGrows.flatMap(grow => named(grow.coverMediaId, grow.filmMediaId)), ...named(...inUsers)]) {
        referenced.add(id);
      }
    }

    return referenced;
  }

  /**
   * A picture's bytes are written before the document that points at them, so a
   * crash in between leaves a file nothing can reach - and nothing else collects
   * it, because every other delete works from the document. The grace period is
   * what keeps this from racing a write that is simply still in flight.
   */
  private async deleteOrphanedMediaData(cutoff: Date): Promise<number> {
    let deleted = 0;
    let candidates: string[] = [];

    const flush = async () => {
      if (candidates.length === 0) return;

      const known: string[] = await this.media.distinct('id', { id: { $in: candidates } });
      const spokenFor = await picturesTheWayBackHolds(this.media.db.db, candidates);
      const orphaned = candidates.filter(mediaId => !known.includes(mediaId) && !spokenFor.has(mediaId));
      candidates = [];

      if (orphaned.length > 0) {
        await this.store.delete(orphaned);
        deleted += orphaned.length;
      }
    };

    for await (const mediaId of this.store.listFileIds(cutoff.getTime())) {
      candidates.push(mediaId);
      if (candidates.length >= BATCH_SIZE) await flush();
    }
    await flush();

    return deleted;
  }

  private async stillThere(lookup: Lookup, ids: (string | null)[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const batch of batches(named(...ids))) {
      for (const row of await lookup(batch)) found.add(row.id);
    }
    return found;
  }

  private async deleteByIds<T extends { id: string }>(model: Model<T>, ids: string[]): Promise<number> {
    let deleted = 0;
    for (const batch of batches(ids)) {
      const result = await model.deleteMany({ id: { $in: batch } } as FilterQuery<T>);
      deleted += result?.deletedCount ?? 0;
    }
    return deleted;
  }
}
