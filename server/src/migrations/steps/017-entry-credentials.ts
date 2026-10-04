import { mongo } from 'mongoose';
import { URL_CREDENTIALS_PATTERN, withoutCredentials } from '@common/log-path';
import { MigrationContext, MigrationStep } from '../migration';

const ENTRIES = 'entries';

/** One line as this step needs to read it: what it says, and nothing else. */
interface StoredLine {
  _id: mongo.ObjectId;
  text?: string | null;
  message?: { key: string; params: string[] } | null;
}

/** How many are rewritten per round trip, which is also how many are held in memory at once. */
const BATCH = 500;

// A line whose words carry a `user:password@` - in what a person or the old app
// wrote, or in the parameter of a device's keyed message. The pattern is the
// redaction's own, so this finds exactly the rows the rewrite changes and no
// others.
const CARRYING_A_CREDENTIAL = {
  $or: [
    { text: { $regex: URL_CREDENTIALS_PATTERN, $options: 'i' } },
    { 'message.params': { $elemMatch: { $regex: URL_CREDENTIALS_PATTERN, $options: 'i' } } },
  ],
};

/**
 * Takes the camera passwords out of the diary.
 *
 * An RTSP camera is opened with its credentials in the address, `rtsp://
 * user:password@host/stream1`, and a capture that failed put ffmpeg's whole
 * command line into the line it wrote about it. The old app kept that line as
 * it came, so the migrated diary holds the password of every stream that ever
 * failed - 15,110 lines in the production database this was written for, 706 of
 * them on one grower's fridge - and the diary is read in the rail, on a week
 * card, in the report and in the export's `diary.csv`.
 *
 * That contradicts a decision the code states out loud elsewhere: the camera
 * row answers its own `url` with the credentials struck out, because they are
 * the server's to keep and the owner is no more entitled to read them back than
 * anybody else. What arrives from here on is redacted as it is written, in the
 * one place an entry is written; this is for what is already stored.
 *
 * It is a step of its own rather than a correction to `011-entries` because
 * every install that has already upgraded has run that step and would never run
 * it again - and because the fix has to hold for the databases that were
 * migrated before anybody noticed, which is all of them. Run over a database
 * that is being migrated for the first time it does the same work one step
 * later: `011` writes the lines as they were written, and this rewrites them
 * before the server has served anything at all.
 *
 * It reads the new `entries` collection and moves nothing aside. A row it has
 * rewritten no longer matches, which is how the batches end and why a second
 * run finds nothing to do.
 */
export const entryCredentials: MigrationStep = {
  name: '017-entry-credentials',

  async run(context: MigrationContext): Promise<void> {
    const entries = context.db.collection(ENTRIES);
    const carrying = await entries.countDocuments(CARRYING_A_CREDENTIAL);
    context.count('entries.credentialsRedacted', carrying);
    if (context.dryRun || carrying === 0) return;

    // Read and rewritten a batch at a time rather than through one cursor: the
    // rows being changed are the rows being read, and a cursor held open over
    // them would be reading a collection moving underneath it.
    for (;;) {
      const batch = await entries
        .find<StoredLine>(CARRYING_A_CREDENTIAL, { projection: { _id: 1, text: 1, message: 1 } })
        .limit(BATCH)
        .toArray();
      if (batch.length === 0) return;

      const written = await entries.bulkWrite(
        batch.map(line => ({ updateOne: { filter: { _id: line._id }, update: { $set: redactionOf(line) } } })),
        { ordered: false },
      );

      // Nothing changed although the rows still match: a line this cannot carry
      // would otherwise be read and rewritten for ever. It is left as it is and
      // said out loud, which is what a reject is for.
      if (written.modifiedCount === 0) {
        for (const line of batch) {
          context.reject({
            source: ENTRIES,
            id: String(line._id),
            reason: 'the credential in this line is in a shape the redaction does not change',
            dropped: false,
            detail: null,
          });
        }
        return;
      }
    }
  },
};

/** The two fields that hold words, each rewritten only where the line has one. */
const redactionOf = (line: StoredLine): Record<string, unknown> => {
  const redaction: Record<string, unknown> = {};
  if (typeof line.text === 'string') redaction.text = withoutCredentials(line.text);
  // Set by path rather than as a whole `message`, so a line that has none keeps
  // none: writing `{ params: [] }` onto a null message would invent one.
  if (line.message) redaction['message.params'] = line.message.params.map(parameter => withoutCredentials(parameter));

  return redaction;
};
