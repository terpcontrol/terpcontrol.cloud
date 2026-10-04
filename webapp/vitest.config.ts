import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The tests that need nothing but the checkout. `test/live/` is excluded here
 * and run by `npm run test:live`, because it talks to a running stack.
 */
/** The same version the app is built with, so a test of the About page sees what the bundle would. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['test/live/**'],
    // A file's own teardown - the language put back, the session signed out -
    // has to find the screen already unmounted, or everything still mounted
    // re-renders outside act(). Testing Library registers its cleanup when it
    // is imported, ahead of any hook of the file's, so run hooks in that order
    // rather than the default reverse one.
    sequence: { hooks: 'list' },
  },
});
