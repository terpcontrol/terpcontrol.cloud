import { captureFailureOf, renderFailureOf } from '@fg2/shared-types/v1-schemas/capture.js';

/**
 * Why the last try at a picture failed, said in a way somebody standing in
 * front of the tent can act on. What the server stores is what the process
 * that reached for the camera said - for a stream a paragraph of ffmpeg, which
 * only the person who can fix the camera can use. So the raw string is read
 * for what kind of failure it is and the page says that, with the words
 * themselves one tap below. The reading is the contract's (`capture.ts`),
 * because the server names a failed test picture by the same kinds.
 */

/** The translation key for what went wrong, from the words the server stored. */
export const causeOf = (lastError: string): string => `camera.failure.${captureFailureOf(lastError)}`;

/**
 * Why a film did not render, read the same way: the render writes its reason
 * in English whatever language the page is in. What ffmpeg said is kept
 * beside the named cause for the one person who can act on it.
 */
export const filmCauseOf = (error: string): string => `camera.film.failure.${renderFailureOf(error)}`;
