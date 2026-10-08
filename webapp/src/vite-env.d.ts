/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API this build talks to, written by `scripts/set-env.mjs` or passed by the image build. */
  readonly VITE_API_URL?: string;
  /** An install's own links below the sign-in form. */
  readonly VITE_CUSTOM_LINKS_HTML?: string;
  /** The install's privacy statement, which signing up asks agreement to. */
  readonly VITE_PRIVACY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The app's own version, as `package.json` states it; `vite.config.ts` defines it, and the vitest configs share that. */
declare const __APP_VERSION__: string;
