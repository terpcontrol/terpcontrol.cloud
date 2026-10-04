import { captureFailureOf } from '@fg2/shared-types/v1-schemas/capture.js';

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
 * that, with the words themselves one tap below. The reading is the contract's
 * (`capture.ts`), because the server names a failed test picture by the same
 * kinds; nothing here decides whether a camera is working, it only names what
 * was already stored.
 */

/** The translation key for what went wrong, from the words the server stored. */
export const causeOf = (lastError: string): string => `camera.failure.${captureFailureOf(lastError)}`;

/** One kind of failure, the wording that gives it away, and what the app calls it. */
interface Cause {
  key: string;
  says: RegExp;
}

/**
 * Why a film did not render, read the same way and for the same reason: the
 * render writes its reason in English whatever language the page is in, and a
 * German camera page was drawing "there are not enough pictures in that span to
 * make a film" as its one line of English under a row that said
 * "fehlgeschlagen" above it.
 *
 * The causes are the render's own and not a capture's, because a
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
