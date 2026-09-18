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
      workbox: {
        // Offline means the shell and both catalogues. The drawings under
        // `assets/` are megabytes and the onboarding videos tens of them, so
        // they are fetched and kept once they are actually looked at.
        globPatterns: ['**/*.{js,css,html,woff2}', 'assets/i18n/*.json'],
        // The app speaks English and German; the other subsets of the two fonts
        // are downloaded if a name ever needs them, not kept for offline.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'assets' },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 4200 },
  preview: { port: 4200 },
  build: { outDir: 'dist', sourcemap: true },
});
