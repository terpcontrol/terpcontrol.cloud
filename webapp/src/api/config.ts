/**
 * What this build knows about itself and about the install it belongs to.
 *
 * None of it is answered by a request: the API has no route that says which
 * app is talking to it, and an install's own links are written by whoever
 * builds the image. So every fact here is compiled in, and the About page
 * reads them from this one place rather than each screen asking the
 * environment on its own.
 */

/**
 * The API this build talks to. `scripts/set-env.mjs` writes it from the root
 * `.env` for a developer; the image build passes it as `VITE_API_URL`. The
 * fallback is the local stack, which is what a checkout without either has.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:5081';

export const v1 = (path: string): string => `${API_URL}/v1${path}`;

/**
 * An install's own links - an imprint, its terms, a privacy statement. It is
 * markup because whoever builds the image writes it: it is configuration of
 * that build, not anything a request can reach. Empty where the install has
 * none, and then nothing draws it.
 */
export const CUSTOM_LINKS_HTML: string = (import.meta.env.VITE_CUSTOM_LINKS_HTML as string | undefined) ?? '';

/**
 * Where this install's privacy statement is published. Signing up links it as
 * information - a privacy statement informs, nobody agrees to it; an install
 * that publishes none links the app's own page of what the software keeps
 * (`/privacy`).
 */
export const PRIVACY_URL: string = (import.meta.env.VITE_PRIVACY_URL as string | undefined)?.trim() ?? '';

/**
 * Where this install's terms of use are published; empty where it has none.
 * Signing up asks for them to be accepted, together with being of age, and the
 * server records it. Which terms an account that exists still has to accept is
 * the server's answer (`Me.termsToAccept`), not this.
 */
export const TERMS_URL: string = (import.meta.env.VITE_TERMS_URL as string | undefined)?.trim() ?? '';

/** The version the app's own package states, put into the bundle at build time. */
export const APP_VERSION: string = __APP_VERSION__;

/**
 * Which kind of build this is - `production` from the image, `development` under the dev server, `public` under
 * the dev server that `npm run start:public` opens to other machines.
 */
export const BUILD_MODE: string = import.meta.env.MODE;
