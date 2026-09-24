/**
 * Why the last try at a picture failed, said in a way somebody standing in
 * front of the tent can act on.
 *
 * What the server stores is what the process that reached for the camera said,
 * and for a stream that is a paragraph of ffmpeg: heap addresses, the loopback
 * port the tunnel was opened on, `in#0`. It is the right thing to keep - it is
 * how the one person who can fix a camera finds out what is wrong with it - but
 * it was also the only thing the page said about a camera that had been dark
 * for four days, in English on a German screen, and no grower can do anything
 * with it. The sibling camera reaching its controller over the broker fails
 * with "device aborted the capture", which is the register the whole line
 * belongs in.
 *
 * So the raw string is read for what kind of failure it is and the page says
 * that, with the words themselves one tap below. The reading is deliberately
 * coarse: these are the causes that lead to different moves - check the power
 * and the network, check the login, check the address, wait for the tent's
 * controller to come back - and a cause that cannot be told apart from the
 * others is named as the failure it is rather than guessed at. Nothing here
 * decides whether a camera is working; it only names what was already stored.
 *
 * The order matters, because one failure prints the wording of several: a
 * stream that dies halfway through a frame reports both the end of the file
 * and, a line later, that what arrived was not a video. The first cause that
 * matches is the one the failure began as.
 */

/** One kind of failure, the wording that gives it away, and what the app calls it. */
interface Cause {
  key: string;
  says: RegExp;
}

const CAUSES: Cause[] = [
  // The camera was reached and delivered, and what arrived was not a picture.
  { key: 'damaged', says: /corrupt|truncat|produced no output|size limit/i },
  // The far end gave up on purpose, which is what a Terp Cam says through its controller.
  { key: 'aborted', says: /abort|superseded/i },
  // Reached, opened, and then cut off: the tunnel or the camera dropped it mid-frame.
  { key: 'stoppedEarly', says: /end of file|reading rtsp|econnreset|connection reset|no keyframe|did not accept the session/i },
  { key: 'refusedLogin', says: /401|403|unauthori|forbidden|authenticat/i },
  // Nothing answered at all: no power, no network, or an address that leads nowhere any more.
  {
    key: 'noAnswer',
    says: /econnrefused|connection refused|refused|timed out|timeout|etimedout|unreachable|ehostunreach|enetunreach|no route to host|did not answer/i,
  },
  // The tent's own controller is the way to this camera, and it is not there.
  { key: 'noController', says: /not connected to the broker|nothing is speaking to the devices|answers to no controller/i },
  // Nothing to reach it at, which is a setting rather than a fault.
  { key: 'noAddress', says: /no stream address|no p2p id|not a p2p device id|rendezvous/i },
  // Something answered and it was not a stream: a wrong path, a web page, a closed port behind a proxy.
  { key: 'noStream', says: /invalid data|error opening input|protocol not found|404|no such file/i },
];

/**
 * The translation key for what went wrong, from the words the server stored.
 * Anything this does not recognise is the failure itself, named plainly, which
 * is still more than the paragraph underneath it says to a grower.
 */
export const causeOf = (lastError: string): string => `camera.failure.${CAUSES.find(cause => cause.says.test(lastError))?.key ?? 'unknown'}`;

/**
 * Why a film did not render, read the same way and for the same reason: the
 * render writes its reason in English whatever language the page is in, and a
 * German camera page was drawing "there are not enough pictures in that span to
 * make a film" as its one line of English under a row that said
 * "fehlgeschlagen" above it.
 *
 * The causes are the render's own and not the capture list above, because a
 * render never goes near the camera: it reads pictures that are already stored,
 * so nothing it can fail at is the camera refusing a login or not answering.
 * What it is not one of is ffmpeg talking - kept beside the named cause, the
 * way the capture banner keeps it, for the one person who can act on it.
 */
const FILM_CAUSES: Cause[] = [
  // The span held pictures and the render kept none of them: they were all taken with the light off.
  { key: 'allDark', says: /taken with the light off/i },
  { key: 'tooFew', says: /not enough pictures/i },
  // The camera was unpaired between the request and the render.
  { key: 'cameraGone', says: /camera this was asked of is gone/i },
  { key: 'encodeFailed', says: /could not be made into a film/i },
];

export const filmCauseOf = (error: string): string => `camera.film.failure.${FILM_CAUSES.find(cause => cause.says.test(error))?.key ?? 'unknown'}`;
