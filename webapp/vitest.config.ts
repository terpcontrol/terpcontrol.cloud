import { defineConfig } from 'vitest/config';
import { shared } from './vite.config.ts';

/**
 * The tests that need nothing but the checkout. `test/live/` is excluded here
 * and run by `npm run test:live`, because it talks to a running stack.
 */
export default defineConfig({
  ...shared,
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
    // Read at a terminal, a run keeps vitest's live view. Read afterwards - a CI
    // log, an agent's transcript - it prints only what failed, with each failed
    // test's own output, and the count of what passed. Console output from a
    // passing test is printed either way: a test that passes while React or a
    // library complains is hiding a fault, so that output has to be fixed, not
    // filtered.
    reporters: process.stdout.isTTY
      ? ['default']
      : [['minimal', { silent: false }], ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : [])],
    // The performance hints suggest a vm pool or `isolate: false` on every run.
    // Vitest calls its vm pools unstable with ES modules, and sharing one jsdom
    // across files would let one file's globals reach the next, so the suite
    // keeps a fresh environment per file and the hints are off.
    experimental: { diagnostics: false },
  },
});
