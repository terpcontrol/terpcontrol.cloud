/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** The API this build talks to, written by `scripts/set-env.mjs` or passed by the image build. */
  readonly VITE_API_URL?: string;
  /** An install's own links below the sign-in form. */
  readonly VITE_CUSTOM_LINKS_HTML?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
