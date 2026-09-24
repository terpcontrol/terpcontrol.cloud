import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Readable } from 'node:stream';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ExportScope, Media, MediaKind, MediaQuality, MediaWindow } from '@fg2/shared-types/v1';
import { AccessRange } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { ImageStore } from '@database/image-store';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { picturesTheWayBackHolds } from '@/migrations/way-back';

/**
 * The `media` collection: one row per picture and per film, and the bytes of it.
 *
 * The bytes live in the GridFS bucket they have always lived in, under the id of
 * the row that indexes them - so a still, a film, a diary photo and an avatar are
 * one kind of thing to everything downstream, and the migration moved no file.
 *
 * Deleting a row deletes its bytes: the `media` schema hangs the store off its
 * own delete hooks, which is what keeps half a dozen callers - retention,
 * thinning, a film replacing its predecessor, a removed camera, somebody
 * deleting a photo - from each having to remember.
 */

/** What a picture is of, beside the bytes. The writer owns the id, the size and when the row was made. */
export interface MediaDraft {
  kind: MediaKind;
  mime: string;
  cameraId?: string | null;
  growId?: string | null;
  spaceId?: string | null;
  uploadedBy?: string | null;
  capturedAt: Date;
  endsAt?: Date | null;
  window?: MediaWindow | null;
  quality?: MediaQuality | null;
  lengthSeconds?: number | null;
  render?: MediaDocument['render'];
  exportJob?: MediaDocument['exportJob'];
}

/** What a camera holds of one kind, which is what an export says about the stills it cannot carry. */
export interface MediaTally {
  count: number;
  bytes: number;
  from: Date;
  until: Date;
}

/** Where a picture sits in its camera's history, which is all a sweep or a film needs of it. */
export interface MediaPosition {
  id: string;
  capturedAt: Date;
}

export interface MediaFilter {
  cameraId?: string;
  kind?: MediaKind;
  window?: MediaWindow | null;
  /** The window every read clamps to, as `access()` decided it. Both ends count as inside. */
  range?: AccessRange;
  /** A half-open span `[from, before)`, which is how the periods a film covers are cut so none shares a frame. */
  from?: Date;
  before?: Date;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly store: ImageStore,
  ) {}

  public byId(id: string): Promise<MediaDocument | null> {
    return this.media.findOne({ id }).lean<MediaDocument>();
  }

  /**
   * Whether a grow is told under this picture: it is somebody's chosen cover, or
   * the film of the whole run.
   *
   * Those two are reached because a grow names them and not because of when the
   * shutter closed, so they are the one thing a reader's window does not narrow.
   * A cover picked from week twelve is what a diary looks like on every page of
   * it, including the page a link that was sent week three opens on - which is
   * the same exemption the public page's own picture route makes, for the same
   * reason.
   */
  public async isAGrowsOwnPicture(mediaId: string): Promise<boolean> {
    return (await this.grows.countDocuments({ $or: [{ coverMediaId: mediaId }, { filmMediaId: mediaId }] })) > 0;
  }

  /** Every picture a grow carries, which is what an export of that grow takes with it. */
  public ofGrow(growId: string): Promise<MediaDocument[]> {
    return this.media.find({ growId }).sort({ capturedAt: 1 }).lean<MediaDocument[]>();
  }

  /**
   * The rows of a kind belonging to a set of cameras, oldest first. A still and
   * a film carry their camera and nothing else - no grow, no space - so this is
   * the only way to ask for an account's pictures, and it is what the export
   * takes its films from.
   */
  public ofCameras(cameraIds: readonly string[], kind: MediaKind): Promise<MediaDocument[]> {
    if (cameraIds.length === 0) return Promise.resolve([]);

    return this.media
      .find({ cameraId: { $in: [...cameraIds] }, kind })
      .sort({ capturedAt: 1 })
      .lean<MediaDocument[]>();
  }

  /**
   * How many pictures of a kind each of these cameras holds, and how many bytes
   * they come to. Counted rather than listed because the answer to "how many
   * stills have I got" is a number, and the rows it is a number of run into six
   * figures for one camera over a season.
   */
  public async tallyOfCameras(cameraIds: readonly string[], kind: MediaKind): Promise<Map<string, MediaTally>> {
    if (cameraIds.length === 0) return new Map();

    const rows = await this.media.aggregate<{ _id: string; count: number; bytes: number; from: Date; until: Date }>([
      { $match: { cameraId: { $in: [...cameraIds] }, kind } },
      { $group: { _id: '$cameraId', count: { $sum: 1 }, bytes: { $sum: '$bytes' }, from: { $min: '$capturedAt' }, until: { $max: '$capturedAt' } } },
    ]);

    return new Map(rows.map(row => [row._id, { count: row.count, bytes: row.bytes, from: row.from, until: row.until }]));
  }

  /** The newest row of a kind, which is what a card shows and what a film is built up to. */
  public newest(filter: MediaFilter): Promise<MediaDocument | null> {
    return this.media.findOne(where(filter)).sort({ capturedAt: -1 }).lean<MediaDocument>();
  }

  public async page(filter: MediaFilter, page: PageQuery): Promise<CursorPage<Media>> {
    const limit = pageLimit(page.limit);
    const rows = await this.media
      .find({ ...where(filter), ...afterCursor('capturedAt', page.cursor) })
      .sort({ capturedAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<MediaDocument[]>();

    // Row by row rather than by handing `serialise` to `map`, which would feed it
    // the index as its second argument. Nothing is held back here: this lists a
    // camera's own stills and films, and neither carries a space or an uploader.
    return pageOf(
      rows.map(row => serialise(row)),
      limit,
      row => ({ at: new Date(row.capturedAt), id: row.id }),
    );
  }

  /**
   * One picture: the bytes into the bucket, the row into the collection. Two
   * writes rather than one, and in that order, so a row never points at bytes
   * that are not there - and the bytes are dropped again when the row is refused.
   */
  public storeBytes(draft: MediaDraft, data: Buffer): Promise<MediaDocument> {
    return this.write(draft, id => this.store.upload(id, data).then(() => data.length));
  }

  /** The same for a file that is already on disk, which is how a freshly encoded film gets in. */
  public storeFile(draft: MediaDraft, path: string): Promise<MediaDocument> {
    return this.write(draft, id => this.store.uploadFile(id, path));
  }

  private async write(draft: MediaDraft, upload: (id: string) => Promise<number>): Promise<MediaDocument> {
    const id = uuidv4();
    const bytes = await upload(id);

    try {
      return await this.row(id, draft, bytes);
    } catch (e) {
      await this.store.delete([id]).catch(() => undefined);
      throw e;
    }
  }

  /** A row for a film nobody has rendered yet; the composer fills in the bytes later. */
  public queue(draft: MediaDraft): Promise<MediaDocument> {
    return this.row(uuidv4(), draft, 0);
  }

  private async row(id: string, draft: MediaDraft, bytes: number): Promise<MediaDocument> {
    const row: MediaDocument = {
      id,
      createdAt: new Date(),
      kind: draft.kind,
      mime: draft.mime,
      bytes,
      cameraId: draft.cameraId ?? null,
      growId: draft.growId ?? null,
      spaceId: draft.spaceId ?? null,
      uploadedBy: draft.uploadedBy ?? null,
      capturedAt: draft.capturedAt,
      endsAt: draft.endsAt ?? null,
      window: draft.window ?? null,
      quality: draft.quality ?? null,
      lengthSeconds: draft.lengthSeconds ?? null,
      render: draft.render ?? null,
      exportJob: draft.exportJob ?? null,
    };

    await this.media.create(row);
    return row;
  }

  /** The rendered film, onto the row that was queued for it. */
  public async fill(id: string, path: string, filled: Partial<MediaDocument>): Promise<void> {
    const bytes = await this.store.uploadFile(id, path);
    await this.media.updateOne({ id }, { $set: { ...filled, bytes } });
  }

  public queued(limit: number): Promise<MediaDocument[]> {
    return this.media.find({ 'render.status': 'queued' }).sort({ createdAt: 1 }).limit(limit).lean<MediaDocument[]>();
  }

  public async setRender(id: string, render: MediaDocument['render']): Promise<void> {
    await this.media.updateOne({ id }, { $set: { render } });
  }

  /**
   * The newest export of a scope that one account asked for. An export belongs
   * to the person who asked and to nothing else, so `uploadedBy` is what it is
   * found by - a second person asking about the same grow finds none of it.
   */
  public newestExport(uploadedBy: string, scope: ExportScope, growId: string | null): Promise<MediaDocument | null> {
    return this.media
      .findOne({ kind: 'export', uploadedBy, 'exportJob.scope': scope, 'exportJob.growId': growId })
      .sort({ createdAt: -1 })
      .lean<MediaDocument>();
  }

  /** The exports waiting to be built, oldest first, which is what the worker drains. */
  public queuedExports(limit: number): Promise<MediaDocument[]> {
    return this.media.find({ 'exportJob.status': 'queued' }).sort({ createdAt: 1 }).limit(limit).lean<MediaDocument[]>();
  }

  /**
   * The exports that say they are being built and have said so for too long,
   * which is what a server stopped mid-zip leaves behind. A row that never
   * recorded when it started counts as one of them: nothing is going to finish
   * it either.
   */
  public stalledExports(limit: number, before: Date): Promise<MediaDocument[]> {
    return this.media
      .find({ 'exportJob.status': 'rendering', $or: [{ 'exportJob.startedAt': null }, { 'exportJob.startedAt': { $lt: before } }] })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean<MediaDocument[]>();
  }

  public async setExportJob(id: string, exportJob: MediaDocument['exportJob']): Promise<void> {
    await this.media.updateOne({ id }, { $set: { exportJob } });
  }

  /** The whole picture in memory. A film is served and encoded from a stream instead. */
  public download(id: string): Promise<Buffer> {
    return this.store.download(id);
  }

  public read(id: string, range?: { start: number; end: number }): Readable {
    return this.store.read(id, range);
  }

  public copyToFile(id: string, path: string): Promise<void> {
    return this.store.copyToFile(id, path);
  }

  public async delete(id: string): Promise<boolean> {
    const result = await this.media.deleteOne({ id });
    return (result?.deletedCount ?? 0) > 0;
  }

  /** In batches, for the sweeps: one round trip per batch rather than per picture. */
  public async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await this.media.deleteMany({ id: { $in: ids } });
    return result?.deletedCount ?? 0;
  }

  /** Of these pictures, the ones the previous release still holds a row for, which no sweep of ours may remove yet. */
  public carriedOverAndStillHeld(ids: string[]): Promise<Set<string>> {
    return picturesTheWayBackHolds(this.media.db.db, ids);
  }

  /**
   * Ids and instants, oldest first, as a cursor: a sweep walks a camera's whole
   * history and needs neither the rest of the row nor all of it at once.
   */
  public positions(filter: MediaFilter): AsyncIterable<MediaPosition> {
    return this.media.find(where(filter)).select({ id: 1, capturedAt: 1, _id: 0 }).sort({ capturedAt: 1 }).lean<MediaPosition>().cursor();
  }

  /** The newest rows of a kind, as positions - what a film is built from. */
  public latestPositions(filter: MediaFilter, limit: number): Promise<MediaPosition[]> {
    return this.media.find(where(filter)).select({ id: 1, capturedAt: 1, _id: 0 }).sort({ capturedAt: -1 }).limit(limit).lean<MediaPosition[]>();
  }

  /**
   * The row on the wire, as much of it as this reader may have.
   *
   * `redacted` is the grant's own flag, and it is what `serialiseDiaryEntry`
   * reads as `hide.authors`: for a stranger, a link holder or a public reader it
   * is true, and for the owner and the people they share the tent with it is
   * false. A photo is the one kind that carries the two ids it turns off, and
   * the diary line that names that very photo has been answering them as null
   * since the redaction was written - so the route that answers the picture had
   * been handing back the tent and the account the diary beside it withheld.
   */
  public serialise(row: MediaDocument, redacted = false): Media {
    return serialise(row, redacted);
  }
}

const where = (filter: MediaFilter): FilterQuery<MediaDocument> => {
  const capturedAt = {
    ...(filter.range?.startsAt ? { $gte: filter.range.startsAt } : {}),
    ...(filter.range?.endsAt ? { $lte: filter.range.endsAt } : {}),
    ...(filter.from ? { $gte: filter.from } : {}),
    ...(filter.before ? { $lt: filter.before } : {}),
  };

  return {
    ...(filter.cameraId ? { cameraId: filter.cameraId } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.window !== undefined ? { window: filter.window } : {}),
    ...(Object.keys(capturedAt).length > 0 ? { capturedAt } : {}),
  };
};

const serialise = (row: MediaDocument, redacted = false): Media => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  kind: row.kind,
  mime: row.mime,
  bytes: row.bytes,
  cameraId: row.cameraId,
  growId: row.growId,
  // Which corner of somebody's flat the picture was taken in, and the account
  // that took it. A reader outside the tent is shown what the picture is of and
  // told neither, exactly as the diary line carrying it already has it; a still
  // and a film carry neither to begin with.
  spaceId: redacted ? null : row.spaceId,
  uploadedBy: redacted ? null : row.uploadedBy,
  capturedAt: row.capturedAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  window: row.window,
  quality: row.quality,
  lengthSeconds: row.lengthSeconds,
  exportJob: row.exportJob
    ? { ...row.exportJob, startedAt: row.exportJob.startedAt?.toISOString() ?? null, endedAt: row.exportJob.endedAt?.toISOString() ?? null }
    : null,
  render: row.render
    ? {
        ...row.render,
        startedAt: row.render.startedAt?.toISOString() ?? null,
        endedAt: row.render.endedAt?.toISOString() ?? null,
      }
    : null,
});
