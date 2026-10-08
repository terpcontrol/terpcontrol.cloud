/**
 * Reading one picture from a camera: how long it may take, what a failed one
 * is called and when it goes through the camera's device - and the sentences a
 * failed render stores.
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
/** Whether reading the camera goes through its device, so it only works while that device is online. */
export declare const readsThroughDevice: (camera: {
    kind: string;
    tunnel: boolean;
}) => boolean;
/**
 * Why a film did not render, in the words the render stores. The causes are
 * the render's own and not a capture's: a render never goes near the camera -
 * it reads pictures that are already stored - so nothing it fails at is the
 * camera refusing a login or not answering. The screen names the cause by these
 * words in the language the page is in; anything else a render stores, such as
 * an encoder's own message, is `unknown`.
 */
export declare const RENDER_FAILURE_TEXT: {
    readonly allDark: "every picture in that span was taken with the light off";
    readonly tooFew: "there are not enough pictures in that span to make a film";
    readonly cameraGone: "the camera this was asked of is gone";
    readonly encodeFailed: "the pictures in that span could not be made into a film";
};
type RenderFailure = keyof typeof RENDER_FAILURE_TEXT;
/** What kind of failure the words a failed render left behind describe. */
export declare const renderFailureOf: (error: string) => RenderFailure | "unknown";
export {};
