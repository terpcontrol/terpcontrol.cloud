/**
 * Black-box integration suite. Boots the API as a real process against a real
 * MongoDB and MQTT broker, with InfluxDB and SMTP replaced by fakes the specs
 * can inspect. See test/README.md.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/specs'],
  testMatch: ['**/*.spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
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
  // MQTT clients keep the event loop alive after a failed assertion skips their
  // cleanup; without this a red run hangs instead of reporting.
  forceExit: true,
};
