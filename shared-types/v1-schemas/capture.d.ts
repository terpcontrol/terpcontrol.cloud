/**
 * Reading one picture from a camera: how long it may take, and what a failed
 * one is called.
 *
 * One read has `CAPTURE_BUDGET_SECONDS` from the moment it is asked for until
 * the camera has delivered or it is given up - every attempt it makes, and the
 * wait for its turn, inside it. The poller and the test button run the very
 * same read, so the server keeps the number and the screens promise it: the
 * button asks after its picture for this long, and says so when nothing came.
 *
 * What a read that failed said is whatever the process that reached for the
 * camera said - for a stream a paragraph of ffmpeg - and it is kept, because it
 * is how the one person who can fix a camera finds out what is wrong with it.
 * What a grower is shown is the kind of failure it was, read off those words
 * here, so the server answering a test picture and the screen drawing the last
 * failure of a camera name it alike. The reading is deliberately coarse: these
 * are the causes that lead to different moves - check the power and the
 * network, check the login, check the address, wait for the tent's controller
 * to come back - and a cause that cannot be told apart from the others is
 * `unknown` rather than guessed at.
 *
 * No schema, so a client can import it without pulling zod and the whole
 * contract into its bundle.
 */
export declare const CAPTURE_BUDGET_SECONDS: number;
/** Every kind of failure a read is named as, `unknown` included. */
export declare const CAPTURE_FAILURES: readonly [...("deviceOffline" | "damaged" | "aborted" | "otherCamera" | "refusedRecently" | "stoppedEarly" | "refusedLogin" | "relayNotOpened" | "noAnswer" | "noDevice" | "noAddress" | "noStream")[], "unknown"];
/** What kind of failure the words a failed read left behind describe. */
export declare const captureFailureOf: (error: string) => (typeof CAPTURE_FAILURES)[number];
