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
export const CAPTURE_BUDGET_SECONDS = 3 * 60;

/**
 * Which words give each failure away. The order matters, because one failure
 * prints the wording of several: a stream that dies halfway through a frame
 * reports both the end of the file and, a line later, that what arrived was not
 * a video. The first cause that matches is the one the failure began as.
 */
const SAYS = [
  // Not tried at all: the device the camera is read through was offline. First,
  // because the instant it names may carry digits a status code is read from.
  ['deviceOffline', /read through is offline/i],
  // The camera was reached and delivered, and what arrived was not a picture.
  ['damaged', /corrupt|truncat|produced no output|size limit/i],
  // The far end gave up on purpose, which is what a Terp Cam said through its device before the relay.
  ['aborted', /abort|superseded/i],
  // Before the login, because the id it names may carry digits a status code is read from.
  ['otherCamera', /belongs to a different camera/i],
  // Turned away once, the camera is left alone for a while rather than asked on every poll.
  ['refusedRecently', /refused this server recently/i],
  // Reached, opened, and then cut off: the tunnel or the camera dropped it mid-frame.
  ['stoppedEarly', /end of file|reading rtsp|econnreset|connection reset|no keyframe|did not accept the session|did not say which camera/i],
  ['refusedLogin', /401|403|unauthori|forbidden|authenticat|rejected the password/i],
  // The device was asked to open the way to its Terp Cam and did not: busy, not finding the cam on its network, or gone.
  ['relayNotOpened', /did not open the relay/i],
  // Nothing answered at all: no power, no network, or an address that leads nowhere any more.
  ['noAnswer', /econnrefused|connection refused|refused|timed out|timeout|etimedout|unreachable|ehostunreach|enetunreach|no route to host|did not answer/i],
  // The tent's own device is the way to this camera, and it is not there.
  ['noDevice', /not connected to the broker|nothing is speaking to the devices|answers to no (controller|device)|could not ask the controller/i],
  // Nothing to reach it at, which is a setting rather than a fault.
  ['noAddress', /no stream address|no p2p id|not a p2p device id|rendezvous|no relay configured|has not reported a camera/i],
  // Something answered and it was not a stream: a wrong path, a web page, a closed port behind a proxy.
  ['noStream', /invalid data|error opening input|protocol not found|404|no such file/i],
] as const;

/** Every kind of failure a read is named as, `unknown` included. */
export const CAPTURE_FAILURES = [...SAYS.map(([key]) => key), 'unknown'] as const;

/** What kind of failure the words a failed read left behind describe. */
export const captureFailureOf = (error: string): (typeof CAPTURE_FAILURES)[number] =>
  SAYS.find(([, says]) => says.test(error))?.[0] ?? 'unknown';

/** Whether reading the camera goes through its device, so it only works while that device is online. */
export const readsThroughDevice = (camera: { kind: string; tunnel: boolean }): boolean =>
  camera.kind === 'terpcam_controller' || (camera.kind === 'rtsp' && camera.tunnel);

/**
 * Why a film did not render, in the words the render stores. The causes are
 * the render's own and not a capture's: a render never goes near the camera -
 * it reads pictures that are already stored - so nothing it fails at is the
 * camera refusing a login or not answering. The screen names the cause by these
 * words in the language the page is in; anything else a render stores, such as
 * an encoder's own message, is `unknown`.
 */
export const RENDER_FAILURES = {
  // The span held pictures and the render kept none of them: they were all taken with the light off.
  allDark: 'every picture in that span was taken with the light off',
  tooFew: 'there are not enough pictures in that span to make a film',
  // The camera was unpaired between the request and the render.
  cameraGone: 'the camera this was asked of is gone',
  encodeFailed: 'the pictures in that span could not be made into a film',
} as const;

type RenderFailure = keyof typeof RENDER_FAILURES;

/** What kind of failure the words a failed render left behind describe. */
export const renderFailureOf = (error: string): RenderFailure | 'unknown' =>
  (Object.keys(RENDER_FAILURES) as RenderFailure[]).find(cause => error.includes(RENDER_FAILURES[cause])) ?? 'unknown';
