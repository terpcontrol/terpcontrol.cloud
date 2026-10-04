import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The contract tests: they run against a stack that is up, in node rather than
 * in jsdom, so a failure is the API's and not a browser shim's. Kept out of
 * `npm test` so a checkout without a stack still has a green test run.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/live/**/*.test.ts'],
    // A cold stack answers the first request slowly.
    testTimeout: 30_000,
  },
});
