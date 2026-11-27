import { config as readEnvFile } from 'dotenv';
import { createConnection } from 'mongoose';
import { ENV_FILE, databaseConfig, storageConfig } from '../config/configuration';
import { IMAGE_BUCKET_NAME } from './image-store';
import { size, moveMediaToS3 } from './media-to-s3';
import { mongoConnectionSettings } from './mongo-connection';
import { S3Objects, s3Client } from './s3-objects';

/**
 * `npm run media:to-s3` (`./move-media-to-s3.sh` on a stack): moves the files in
 * the GridFS bucket to the configured S3 bucket. `--keep` copies and deletes
 * nothing, `--dry-run` only counts.
 *
 * The server may run meanwhile, on either setting: with the bucket configured it
 * reads from S3 and falls back to GridFS, so a picture is served from wherever
 * it is at that moment.
 */

const report = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const main = async (): Promise<void> => {
  readEnvFile({ path: ENV_FILE });

  const settings = storageConfig().s3;
  if (!settings) throw new Error('S3_BUCKET is not set: there is no bucket to move the pictures to.');

  const keep = process.argv.includes('--keep');
  const s3 = new S3Objects(s3Client(settings), settings);
  await s3.verifyBucket();

  const { uri, ...options } = mongoConnectionSettings(databaseConfig());
  const connection = await createConnection(uri, options).asPromise();

  try {
    const db = connection.db!;

    if (process.argv.includes('--dry-run')) {
      const [stats] = await db
        .collection(`${IMAGE_BUCKET_NAME}.files`)
        .aggregate<{ files: number; bytes: number }>([{ $group: { _id: null, files: { $sum: 1 }, bytes: { $sum: '$length' } } }])
        .toArray();
      report(`${stats?.files ?? 0} file(s), ${size(stats?.bytes ?? 0)} in GridFS. Dry run: nothing was copied.`);
      return;
    }

    const outcome = await moveMediaToS3(db, s3, { keep, report });
    if (outcome.files === 0) {
      report('Nothing in GridFS: every picture is in S3 already.');
      return;
    }
    report(
      `\n${outcome.inS3} of ${outcome.files} file(s) are in S3 (${outcome.uploaded} uploaded now, ${size(outcome.bytes)})` +
        (keep ? '; GridFS was left as it was.' : ' and gone from GridFS.'),
    );

    if (outcome.failed.length > 0) {
      report(`${outcome.failed.length} file(s) failed and stay in GridFS; run again to retry them.`);
      process.exitCode = 1;
    } else if (!keep) {
      report('MongoDB gives the space back to the disk only once imagedata.chunks is compacted (docs/knowledge/data-operations.md, Disk space).');
    }
  } finally {
    await connection.close();
  }
};

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
