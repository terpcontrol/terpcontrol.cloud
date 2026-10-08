import type { z } from 'zod';
import type { valueState } from './common.js';
type ValueState = z.infer<typeof valueState>;
/**
 * The one place the ages of a value are stated. The server decides `valueState`
 * from these and its own clock, and that verdict is the only one anything acts
 * on: no client works out a state the server will be told or asked about.
 *
 * A client does judge what it is drawing. The verdict on an answer was true when
 * the answer was made, and a screen keeps drawing that answer while the reader
 * looks at it and while a refresh fails, so it re-reads these same seconds
 * against the server-corrected clock to decide how old the figure in front of
 * somebody now is. That is a client aging a value it holds, never a second
 * opinion about one: it can only agree with the server or call the reading
 * older, never fresher.
 *
 * A device's own liveness is in no answer - `lastSeenAt` is the raw instant -
 * so the screens that draw a device rather than a reading judge it by these
 * same seconds. That is why this is a module of its own rather than a line in
 * `common.ts`: it carries no schema, so a client can import it without pulling
 * zod and the whole contract into its bundle.
 */
export declare const VALUE_AGE: {
    readonly liveSeconds: 120;
    readonly staleSeconds: 600;
};
/**
 * The state of a value this many seconds old, by the seconds above. A value
 * from the future is `live`: a device's clock running ahead is not a reason to
 * call the reading it just sent stale.
 */
export declare const valueStateOfAge: (seconds: number) => ValueState;
/**
 * How many of its own stills a camera may miss. A reading is live for two
 * minutes because that is how often a device reports; a camera reports every
 * `stillIntervalSeconds`, which a person sets, so it is judged against its own
 * promise instead: two missed is stale, ten is a camera that has stopped.
 */
export declare const CAMERA_STILLS: {
    readonly staleAfter: 2;
    readonly offlineAfter: 10;
};
/**
 * When a device was really last heard, from everything that proves it.
 *
 * `lastSeenAt` is the cloud's own note of the last message it took, and the
 * ingest stamps it on every one, so on a device claimed into this cloud the
 * note and the readings can never part. The devices carried over from the old
 * cloud were given the last *connection* that cloud recorded, and that fleet
 * went on writing samples for another half day afterwards - so for them the
 * note is simply older than the truth, and a silence counted from it is longer
 * than the one the stored readings show.
 *
 * A stored reading is proof the device was heard, so the later of the two is
 * the answer. It can only shorten a silence and never invent one: no device is
 * made to look present by a reading older than the last message from it. The
 * alarm that says how long a device has been quiet and the row that dates it go
 * by this one rule, so the sentence never contradicts the chart beside it.
 */
export declare const heardAt: <T extends string | Date>(lastSeenAt: T | null, sampleAt: T | null) => T | null;
export {};
