import { defineConfig } from 'vitest/config';
import { shared } from './vite.config.ts';

/**
 * The contract tests: they run against a stack that is up, in node rather than
 * in jsdom, so a failure is the API's and not a browser shim's. Kept out of
 * `npm test` so a checkout without a stack still has a green test run.
 */
export default defineConfig({
  ...shared,
  test: {
    globals: true,
    environment: 'node',
    include: ['test/live/**/*.test.ts'],
    // A cold stack answers the first request slowly.
    testTimeout: 30_000,
  },
});
