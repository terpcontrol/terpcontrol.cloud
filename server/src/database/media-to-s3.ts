import { mongo } from 'mongoose';
import pLimit from 'p-limit';
import { IMAGE_BUCKET_NAME } from './image-store';
import { S3Objects } from './s3-objects';

const PARALLEL = 4;
const PROGRESS_EVERY = 200;

export const size = (bytes: number): string => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);

export interface MoveOutcome {
  files: number;
  /** Copied in this run; a file whose copy was already there is counted in `inS3` only. */
  uploaded: number;
  inS3: number;
  bytes: number;
  failed: string[];
}

/**
 * Copies every file in the GridFS bucket to S3 under the same id, checks the
 * copy's size and then drops the GridFS file - unless `keep`. A file whose copy
 * is already there at the right size is not uploaded again, so a run that
 * stopped is simply started again.
 */
export const moveMediaToS3 = async (
  db: mongo.Db,
  s3: S3Objects,
  { keep, report }: { keep: boolean; report: (line: string) => void },
): Promise<MoveOutcome> => {
  const gridFs = new mongo.GridFSBucket(db, { bucketName: IMAGE_BUCKET_NAME });
  const files = db.collection<{ _id: unknown; length: number }>(`${IMAGE_BUCKET_NAME}.files`);
  const chunks = db.collection(`${IMAGE_BUCKET_NAME}.chunks`);

  // Read up front rather than walked with a cursor: the files are deleted as the
  // run goes, and a cursor left idle while a batch of films uploads would be
  // closed by the server under it.
  const all = await files.find({}, { projection: { _id: 1, length: 1 } }).toArray();
  const outcome: MoveOutcome = { files: all.length, uploaded: 0, inS3: 0, bytes: 0, failed: [] };
  let done = 0;

  const move = async (file: { _id: unknown; length: number }): Promise<void> => {
    const id = String(file._id);
    try {
      if ((await s3.size(id)) !== file.length) {
        await s3.put(id, gridFs.openDownloadStream(file._id as mongo.ObjectId), file.length);
        const stored = await s3.size(id);
        if (stored !== file.length) throw new Error(`the copy holds ${stored} bytes, not ${file.length}`);
        outcome.uploaded++;
      }
      if (!keep) {
        await chunks.deleteMany({ files_id: file._id });
        await files.deleteOne({ _id: file._id as never });
      }
      outcome.inS3++;
      outcome.bytes += file.length;
    } catch (e) {
      outcome.failed.push(id);
      report(`  ${id}: ${e}`);
    }

    if (++done % PROGRESS_EVERY === 0) report(`${done}/${all.length} (${size(outcome.bytes)})`);
  };

  const limit = pLimit(PARALLEL);
  await Promise.all(all.map(file => limit(() => move(file))));
  return outcome;
};
