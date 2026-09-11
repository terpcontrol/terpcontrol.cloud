import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Document, Model, mongo } from 'mongoose';
import { Image } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { BackgroundWork } from '../../common/background-work';
import { ImageStore } from '../../database/image-store';
import { MODEL } from '../../database/models.module';

/**
 * Moves the payload of the pictures written before the image store existed into
 * the store, under the image_id they already carry.
 *
 * It runs on startup rather than by hand: the read paths ask the store for the
 * bytes of every picture, so a database that still has some in its documents
 * serves those as errors, and nothing but the server itself is guaranteed to
 * reach a deployment. A run that finds nothing costs one query, which is what
 * every start after the first does.
 *
 * The three properties a migration needs, and where each comes from:
 *
 * - *Idempotent*: the work is keyed on the field still being there, so a second
 *   run over a migrated database finds nothing to do - and two server instances
 *   running it at once only duplicate reads, never damage.
 * - *Resumable*: it pages by `_id` in batches instead of holding one cursor over
 *   a collection it walks for minutes, and every document it finishes is
 *   finished for good. A run interrupted halfway - a restart, a shutdown -
 *   continues where it left off the next time round.
 * - *Non-destructive*: the document is the only copy of a picture until the
 *   store has answered with the very same bytes, so the payload is dropped only
 *   after reading the stored file back in full. A picture that lost its bytes
 *   cannot be recovered from anywhere.
 */

const WORK_NAME = 'The migration of pictures written before the image store';

// Late enough to leave the start of the server alone, early enough that a
// picture is only unreadable for moments rather than minutes.
const START_DELAY_MS = 15_000;
const RETRY_INTERVAL_MS = 60 * 60 * 1000;

// Ids per batch. Only the ids: the payloads are read one at a time, because a
// batch of them is a batch of whole pictures in memory.
const BATCH_SIZE = 200;

type LegacyImage = { _id: mongo.ObjectId; image_id: string };

/**
 * The payload as the driver hands it back. It is read through the driver rather
 * than through the model, so the migration does not depend on the schema still
 * describing a field that is on its way out - which also means no schema type
 * has cast it to a Buffer yet.
 */
const inlineBytes = (value: unknown): Buffer | undefined => {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  return value instanceof mongo.Binary ? Buffer.from(value.buffer) : undefined;
};

@Injectable()
export class LegacyImageDataMigration implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.image) private readonly images: Model<Image & Document>,
    private readonly store: ImageStore,
  ) {}

  public onModuleInit(): void {
    this.work.schedule(WORK_NAME, () => this.runUntilNothingIsLeft(), START_DELAY_MS);
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  private async runUntilNothingIsLeft(): Promise<void> {
    // A failed run is the only reason to come back: what a finished one leaves
    // behind is a database nothing writes payloads into any more.
    let leftBehind = true;

    try {
      const { migrated, failed } = await this.run();
      leftBehind = failed > 0;

      if (migrated > 0) {
        logger.info(`Moved the payload of ${migrated} picture(s) written before the image store into it`);
      }
      if (failed > 0) {
        logger.error(`${failed} picture(s) still carry their payload and could not be moved; trying again later`);
      }
    } catch (e) {
      logger.error(`${WORK_NAME} failed: ${e}`);
    } finally {
      if (leftBehind) {
        this.work.schedule(WORK_NAME, () => this.runUntilNothingIsLeft(), RETRY_INTERVAL_MS);
      }
    }
  }

  /** Moves every picture that still carries its payload. Safe to call at any time. */
  public async run(): Promise<{ migrated: number; failed: number }> {
    let migrated = 0;
    let failed = 0;
    let after: mongo.ObjectId | undefined;

    for (;;) {
      const batch = await this.images.collection
        .find<LegacyImage>(
          { data: { $exists: true }, ...(after ? { _id: { $gt: after } } : {}) },
          { projection: { image_id: 1 }, sort: { _id: 1 }, limit: BATCH_SIZE },
        )
        .toArray();

      if (batch.length === 0) {
        return { migrated, failed };
      }

      for (const image of batch) {
        if (this.work.isStopped) {
          return { migrated, failed };
        }

        try {
          if (await this.migrate(image.image_id)) {
            migrated++;
          }
        } catch (e) {
          // The picture keeps its payload and is picked up by a later run; the
          // rest of the collection has nothing to do with it.
          failed++;
          logger.error(`Failed moving the payload of image ${image.image_id} into the store: ${e}`);
        }
      }

      // Past the batch rather than back to the start: a document that failed
      // would otherwise be handed out again for the rest of the run.
      after = batch[batch.length - 1]._id;
    }
  }

  private async migrate(imageId: string): Promise<boolean> {
    const document = await this.images.collection.findOne({ image_id: imageId }, { projection: { data: 1 } });
    const data = inlineBytes(document?.data);

    if (!data) {
      // Gone in the meantime, or already moved by another run.
      return false;
    }

    if (!(await this.storeReadsBack(imageId, data))) {
      // Whatever is in the store is not this picture: an upload that was
      // interrupted leaves chunks behind that no file document names.
      await this.store.delete([imageId]);
      await this.store.upload(imageId, data);

      if (!(await this.storeReadsBack(imageId, data))) {
        throw new Error('the store does not read the same bytes back');
      }
    }

    // The size is what the document was never asked for while it held the
    // picture itself, and what serving a Content-Length or a Range needs now.
    await this.images.collection.updateOne({ image_id: imageId }, { $unset: { data: '' }, $set: { size: data.length } });
    return true;
  }

  /** Whether the store holds this picture, byte for byte, and hands it back. */
  private async storeReadsBack(imageId: string, data: Buffer): Promise<boolean> {
    const stored = createHash('sha256');
    let length = 0;

    try {
      for await (const chunk of this.store.read(imageId)) {
        stored.update(chunk as Buffer);
        length += (chunk as Buffer).length;
      }
    } catch {
      // No file of that id, or one that cannot be read to its end: either way
      // the bytes still have to go in.
      return false;
    }

    return length === data.length && stored.digest('hex') === createHash('sha256').update(data).digest('hex');
  }
}
