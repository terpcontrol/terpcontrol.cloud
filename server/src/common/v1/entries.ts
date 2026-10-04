import type { Entry } from '@fg2/shared-types/v1';
import { EntryDocument } from '@database/schemas/v1/entries.schema';

/** Field by field, because `_id` rides on a stored document and never leaves the server. */
export const serialiseEntry = (entry: EntryDocument): Entry => ({
  id: entry.id,
  createdAt: entry.createdAt.toISOString(),
  kind: entry.kind,
  occurredAt: entry.occurredAt.toISOString(),
  source: entry.source,
  authorId: entry.authorId,
  growId: entry.growId,
  spaceId: entry.spaceId,
  deviceId: entry.deviceId,
  plantIds: entry.plantIds,
  cameraId: entry.cameraId,
  taskId: entry.taskId,
  alertId: entry.alertId,
  severity: entry.severity,
  text: entry.text,
  message: entry.message,
  values: entry.values,
  mediaIds: entry.mediaIds,
  undoUntil: entry.undoUntil?.toISOString() ?? null,
});
