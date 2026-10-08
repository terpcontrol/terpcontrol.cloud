import { captureFailureOf, renderFailureOf } from '@fg2/shared-types/v1-schemas/capture.js';

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

/**
 * Why a film did not render, read the same way and for the same reason: the
 * render writes its reason in English whatever language the page is in, and a
 * German camera page was drawing "there are not enough pictures in that span to
 * make a film" as its one line of English under a row that said
 * "fehlgeschlagen" above it. What ffmpeg said is kept beside the named cause,
 * the way the capture banner keeps it, for the one person who can act on it.
 */
export const filmCauseOf = (error: string): string => `camera.film.failure.${renderFailureOf(error)}`;
