/**
 * Black-box integration suite. Boots the API as a real process against a real
 * MongoDB and MQTT broker, with InfluxDB and SMTP replaced by fakes the specs
 * can inspect. See test/README.md.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: '<rootDir>/test/server-log-environment.mjs',
  reporters: ['<rootDir>/test/quiet-reporter.mjs', 'summary'],
  rootDir: '.',
  roots: ['<rootDir>/test/specs'],
  testMatch: ['**/*.spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/support/spec-setup.ts'],
  // One app process and one database are shared by every spec; serial execution
  // keeps rate limits, MQTT traffic and admin-visible listings predictable.
  maxWorkers: 1,
  // Its own cache directory. The two suites transpile the same `src/` files with
  // different module settings - this one to CommonJS, the unit suite to ESM -
  // and jest's default cache is one directory shared by both. Two
  // runs at once then read each other's half-written entries, and a spec dies
  // on `Cannot use import statement outside a module` in a file that compiles
  // perfectly well on its own. Keeping them apart costs a little disk and makes
  // a red run mean something.
  cacheDirectory: '<rootDir>/node_modules/.cache/jest-integration',
  testTimeout: 30_000,
  // No forceExit, which jest announces on every run: global-teardown.ts ends a
  // run that what a failed spec left open would keep alive.
};
