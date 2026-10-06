import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The app is a static bundle served by nginx in front of an API on another
 * origin, so nothing here proxies: `VITE_API_URL` names the API in development
 * and in the image alike, and the server answers CORS for both.
 */
/** The version the app states about itself, read from its own package rather than typed a second time. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The contract's runtime modules are pre-bundled once and cached, and Vite keys
 * that cache on the lockfile and this config - not on the modules, which
 * `npm run generate` rewrites in place behind a linked package. A development
 * server left running then hands the browser yesterday's contract, and a table
 * added since is undefined in it. So this plugin's name carries a hash of the
 * modules, which keys the cache on what they say, and a running server restarts
 * when they change.
 */
const CONTRACT = fileURLToPath(new URL('../shared-types/v1-schemas', import.meta.url));

const contractHash = (): string => {
  if (!existsSync(CONTRACT)) return 'none';
  const hash = createHash('sha1');
  for (const file of readdirSync(CONTRACT)
    .filter(name => name.endsWith('.js'))
    .sort())
    hash.update(file).update(readFileSync(join(CONTRACT, file)));
  return hash.digest('hex').slice(0, 12);
};

const followContract = (): Plugin => ({
  name: `contract-${contractHash()}`,
  apply: 'serve',
  configureServer(server) {
    let restart: ReturnType<typeof setTimeout> | undefined;
    server.watcher.add(CONTRACT);
    server.watcher.on('change', file => {
      if (!file.startsWith(CONTRACT) || !file.endsWith('.js')) return;
      // A generate writes every module at once: one restart for all of them.
      clearTimeout(restart);
      restart = setTimeout(() => void server.restart(), 500);
    });
  },
});

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    followContract(),
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
        // The app speaks English and German; the other subsets of the face
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
      '@fg2/shared-types/v1-schemas/grow-days.js',
      '@fg2/shared-types/v1-schemas/socket-report.js',
      '@fg2/shared-types/v1-schemas/value-age.js',
      '@fg2/shared-types/v1-schemas/climate-presets.js',
      '@fg2/shared-types/v1-schemas/alert-routing.js',
      '@fg2/shared-types/v1-schemas/vpd.js',
      '@fg2/shared-types/v1-schemas/maintenance.js',
      '@fg2/shared-types/v1-schemas/configuration-fields.js',
      '@fg2/shared-types/v1-schemas/day-night.js',
      '@fg2/shared-types/v1-schemas/capture.js',
    ],
  },
  // `npm run start:public` is the development server for other machines too - a phone on the network, a host
  // reached by name - so it listens on every address and answers to whatever name it is reached by. That turns
  // off Vite's guard against DNS rebinding, which is why it is a mode of its own and not what `npm start` does.
  server: mode === 'public' ? { port: 4200, host: true, allowedHosts: true } : { port: 4200 },
  preview: { port: 4200 },
  build: { outDir: 'dist', sourcemap: true },
}));
