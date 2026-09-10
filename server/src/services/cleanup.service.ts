import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import imageModel from '@models/images.model';
import { imageStore } from '@/databases/imagestore';

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

// Records are only removed once nothing can reach them any more *and* they have
// aged past this grace period: an uploaded picture exists before the diary entry
// that references it, and a device may be re-registered right after being removed.
const ORPHAN_GRACE_MS = 7 * MS_IN_A_DAY;

const CLEANUP_INTERVAL_MS = MS_IN_A_DAY;
const CLEANUP_START_DELAY_MS = 5 * 60 * 1000;
const BATCH_SIZE = 500;

const batches = <T>(items: T[], size = BATCH_SIZE): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

export class CleanupService {
  private timer: ReturnType<typeof setTimeout> | undefined;

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => void this.runPeriodically(), CLEANUP_START_DELAY_MS);
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async runPeriodically(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      console.log('Cleanup of unreachable logs and images failed:', e);
    } finally {
      this.timer = setTimeout(() => void this.runPeriodically(), CLEANUP_INTERVAL_MS);
    }
  }

  public async run(now = Date.now()): Promise<{ deletedLogs: number; deletedImages: number; deletedOrphanedFiles: number }> {
    const cutoff = now - ORPHAN_GRACE_MS;

    // Logs go first: the pictures of a removed device's diary entries become
    // unreferenced by that deletion and are collected by the same run.
    const deletedLogs = await this.deleteLogsOfRemovedDevices(cutoff);
    const deletedImages = (await this.deleteImagesOfRemovedDevices(cutoff)) + (await this.deleteUnreferencedUserImages(cutoff));
    // Last: the sweep below only counts files no image document names, and the
    // deletes above have just removed the documents of everything unreachable.
    const deletedOrphanedFiles = await this.deleteOrphanedImageData(cutoff);

    if (deletedLogs > 0 || deletedImages > 0 || deletedOrphanedFiles > 0) {
      console.log(
        `Cleanup removed ${deletedLogs} unreachable log entries, ${deletedImages} unreachable images ` +
          `and the stored data of ${deletedOrphanedFiles} image(s) that no longer exist`,
      );
    }

    return { deletedLogs, deletedImages, deletedOrphanedFiles };
  }

  private async deleteLogsOfRemovedDevices(cutoff: number): Promise<number> {
    const time = { $lt: new Date(cutoff) };
    const deviceIds: string[] = await deviceLogModel.distinct('device_id', { time });

    let deleted = 0;
    for (const batch of batches(await this.removedDeviceIds(deviceIds))) {
      const result = await deviceLogModel.deleteMany({ device_id: { $in: batch }, time });
      deleted += result?.deletedCount ?? 0;
    }
    return deleted;
  }

  private async deleteImagesOfRemovedDevices(cutoff: number): Promise<number> {
    const timestamp = { $lt: cutoff };
    const deviceIds: string[] = await imageModel.distinct('device_id', { timestamp });

    let deleted = 0;
    for (const batch of batches(await this.removedDeviceIds(deviceIds))) {
      const result = await imageModel.deleteMany({ device_id: { $in: batch }, timestamp });
      deleted += result?.deletedCount ?? 0;
    }
    return deleted;
  }

  // Webcam stills and timelapses belong to their device, but a user picture is
  // only reachable through the log entry listing it in `images` - including a
  // soft-deleted one, which the owner can still restore.
  private async deleteUnreferencedUserImages(cutoff: number): Promise<number> {
    const cursor = imageModel
      .find({ format: 'user/jpeg', timestamp: { $lt: cutoff } })
      .select({ image_id: 1 })
      .cursor();

    let deleted = 0;
    let candidates: string[] = [];
    const flush = async () => {
      if (candidates.length === 0) {
        return;
      }
      const referenced: string[] = await deviceLogModel.distinct('images', { images: { $in: candidates } });
      const unreferenced = candidates.filter(imageId => !referenced.includes(imageId));
      candidates = [];

      if (unreferenced.length > 0) {
        const result = await imageModel.deleteMany({ image_id: { $in: unreferenced } });
        deleted += result?.deletedCount ?? 0;
      }
    };

    for (let image = await cursor.next(); image != null; image = await cursor.next()) {
      candidates.push(image.image_id);
      if (candidates.length >= BATCH_SIZE) {
        await flush();
      }
    }
    await flush();

    return deleted;
  }

  // A picture's bytes are written before the document that points at them, so a
  // crash in between leaves a file nothing can reach - and nothing else collects
  // it, because every other delete works from the document. The grace period is
  // what keeps this from racing a write that is simply still in flight.
  private async deleteOrphanedImageData(cutoff: number): Promise<number> {
    let deleted = 0;
    let candidates: string[] = [];

    const flush = async () => {
      if (candidates.length === 0) {
        return;
      }
      const known: string[] = await imageModel.distinct('image_id', { image_id: { $in: candidates } });
      const orphaned = candidates.filter(imageId => !known.includes(imageId));
      candidates = [];

      if (orphaned.length > 0) {
        await imageStore.delete(orphaned);
        deleted += orphaned.length;
      }
    };

    for await (const imageId of imageStore.listFileIds(cutoff)) {
      candidates.push(imageId);
      if (candidates.length >= BATCH_SIZE) {
        await flush();
      }
    }
    await flush();

    return deleted;
  }

  private async removedDeviceIds(deviceIds: string[]): Promise<string[]> {
    const removed: string[] = [];
    for (const batch of batches(deviceIds)) {
      const existing = await deviceModel.find({ device_id: { $in: batch } }, { device_id: 1 }).lean();
      const known = new Set(existing.map(device => device.device_id));
      removed.push(...batch.filter(deviceId => !known.has(deviceId)));
    }
    return removed;
  }
}

export const cleanupService = new CleanupService();
