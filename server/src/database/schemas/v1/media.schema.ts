import { Query, Schema } from 'mongoose';
import { Media, MediaExportJob, MediaOverlays, MediaRender } from '@fg2/shared-types/v1';
import { logger } from '@utils/logger';
import { exportScope, mediaAspect, mediaKind, mediaQuality, mediaRenderStatus, mediaWindow } from '@fg2/shared-types/v1-schemas';
import { deleteStoredImages } from '../../image-store';

/**
 * A picture or a film. The bytes stay in the GridFS bucket, whose file id is this
 * document's `id`, so the two collections are joined by nothing but that id.
 *
 * A picture belongs to a camera, a grow or a space, never to a device. What is
 * about none of them is `null` there and never missing: the sweeps below and the
 * cleanup delete by `$in` over a list of ids, and a `$in` holding `null` also
 * matches every document where the field is absent.
 */
type MediaRenderDocument = Omit<MediaRender, 'startedAt' | 'endedAt'> & {
  startedAt: Date | null;
  endedAt: Date | null;
};

type MediaExportDocument = Omit<MediaExportJob, 'startedAt' | 'endedAt'> & {
  startedAt: Date | null;
  endedAt: Date | null;
};

export type MediaDocument = Omit<Media, 'createdAt' | 'capturedAt' | 'endsAt' | 'render' | 'exportJob'> & {
  createdAt: Date;
  capturedAt: Date;
  endsAt: Date | null;
  render: MediaRenderDocument | null;
  exportJob: MediaExportDocument | null;
};

const overlaysSchema = new Schema<MediaOverlays>(
  {
    dayCounter: { type: Boolean, required: true, default: false },
    climate: { type: Boolean, required: true, default: false },
    entries: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

/**
 * What the composer was asked for and how far it has got. Null for a picture
 * nobody renders.
 *
 * Everything the composer added has a default, which is the plain film: a job
 * queued before there was a composer at all reads as what it was asked for
 * rather than as a document missing half its fields.
 */
const renderSchema = new Schema<MediaRenderDocument>(
  {
    status: { type: String, enum: mediaRenderStatus.options, required: true },
    framesPerSecond: { type: Number, required: true },
    watermark: { type: Boolean, required: true },
    aspect: { type: String, enum: mediaAspect.options, required: true, default: '16_9' },
    overlays: { type: overlaysSchema, required: true, default: () => ({}) },
    includeLightsOff: { type: Boolean, required: true, default: false },
    secondCameraId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
);

/**
 * An export, and how far it has got. It sits beside `render` rather than inside
 * it because the two jobs have nothing in common but their four states: what a
 * film is rendered at says nothing about a zip, and a zip of a grow would have
 * to carry a frame rate to pretend otherwise.
 */
const exportSchema = new Schema<MediaExportDocument>(
  {
    status: { type: String, enum: mediaRenderStatus.options, required: true },
    scope: { type: String, enum: exportScope.options, required: true },
    growId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
);

export const mediaSchema = new Schema<MediaDocument>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    kind: { type: String, enum: mediaKind.options, required: true },
    mime: { type: String, required: true },
    bytes: { type: Number, required: true },
    cameraId: { type: String, default: null },
    growId: { type: String, default: null },
    spaceId: { type: String, default: null },
    uploadedBy: { type: String, default: null },
    capturedAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    window: { type: String, enum: mediaWindow.options, default: null },
    quality: { type: String, enum: mediaQuality.options, default: null },
    lengthSeconds: { type: Number, default: null },
    render: { type: renderSchema, default: null },
    exportJob: { type: exportSchema, default: null },
  },
  { collection: 'media', versionKey: false },
);

// One picture per camera, kind, window and instant: it is what makes a still
// arriving twice one row, and what lets two cameras in one tent each keep a
// daily film. Partial, because a photo and an avatar belong to no camera and
// several of them share the same nulls.
mediaSchema.index({ cameraId: 1, kind: 1, window: 1, capturedAt: 1 }, { unique: true, partialFilterExpression: { cameraId: { $type: 'string' } } });
// The frames and the timelapses of one camera, newest first, which is both the
// read of `/frames` and how thinning and retention walk a camera's history.
mediaSchema.index({ cameraId: 1, kind: 1, capturedAt: -1 });
// The pictures of a grow and of a space, for the week cards and the public page.
mediaSchema.index({ growId: 1, capturedAt: -1 });
mediaSchema.index({ spaceId: 1, capturedAt: -1 });
// The composer's queue: the hourly builder drains what is queued, oldest first.
mediaSchema.index({ 'render.status': 1, createdAt: 1 });
// The same for the export worker, and what answers "is there one already?" -
// the newest export of a scope belonging to the account that asked for it.
mediaSchema.index({ uploadedBy: 1, kind: 1, createdAt: -1 });
mediaSchema.index({ 'exportJob.status': 1, createdAt: 1 });

/**
 * Pictures are deleted from half a dozen places - retention, thinning, the
 * timelapse that replaces its predecessor, the cleanup of a removed camera,
 * somebody deleting a photo from the diary. Hanging the store off the delete
 * itself is what keeps every one of them from leaving the bytes behind.
 */
type PurgingQuery = Query<unknown, unknown> & { _mediaIdsToPurge?: string[] };

async function collectMediaIds(this: PurgingQuery) {
  const doomed = await this.model.find(this.getFilter()).select({ id: 1, _id: 0 }).lean<{ id: string }[]>();
  this._mediaIdsToPurge = doomed.map(media => media.id);
}

async function purgeStoredMedia(this: PurgingQuery) {
  const mediaIds = this._mediaIdsToPurge ?? [];
  this._mediaIdsToPurge = undefined;

  // The documents are already gone; failing here would only strand the bytes,
  // which the caller can do nothing about and which must not fail its delete.
  try {
    // A delete has just run on this connection, so it carries the driver's handle.
    await deleteStoredImages(this.model.db.db!, mediaIds);
  } catch (e) {
    logger.error(`Failed deleting the stored data of ${mediaIds.length} media document(s): ${e}`);
  }
}

for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  mediaSchema.pre(operation, { query: true, document: false }, collectMediaIds);
  mediaSchema.post(operation, { query: true, document: false }, purgeStoredMedia);
}
