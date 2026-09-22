import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The app is a static bundle served by nginx in front of an API on another
 * origin, so nothing here proxies: `VITE_API_URL` names the API in development
 * and in the image alike, and the server answers CORS for both.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // `public/manifest.webmanifest` is the manifest, linked from index.html.
      // Generating a second one would leave two answers to the same question.
      manifest: false,
      // The worker is written out in `src/sw.ts` rather than generated, because
      // a push is handed to the worker and to nothing else, and a generated one
      // has no handler for it. What it precaches is decided here.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // Offline means the shell and both catalogues. The drawings under
        // `assets/` are megabytes and the onboarding videos tens of them, so
        // they are fetched and kept once they are actually looked at.
        globPatterns: ['**/*.{js,css,html,woff2}', 'assets/i18n/*.json'],
        // The app speaks English and German; the other subsets of the two fonts
        // are downloaded if a name ever needs them, not kept for offline.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // The contract's runtime half is CommonJS, and a linked package is not
    // pre-bundled unless it is named: without this the development server hands
    // the browser a module it cannot take a named export out of, while the
    // production build - which converts it - works. Only the modules that carry
    // no schema are imported this way; the index would bring zod with it.
    include: [
      '@fg2/shared-types/v1-schemas/feeding.js',
      '@fg2/shared-types/v1-schemas/socket-report.js',
      '@fg2/shared-types/v1-schemas/value-age.js',
      '@fg2/shared-types/v1-schemas/climate-presets.js',
      '@fg2/shared-types/v1-schemas/alert-routing.js',
    ],
  },
  server: { port: 4200 },
  preview: { port: 4200 },
  build: { outDir: 'dist', sourcemap: true },
});
