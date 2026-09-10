/**
 * Black-box integration suite. Boots the API as a real process against a real
 * MongoDB and MQTT broker, with InfluxDB and SMTP replaced by fakes the specs
 * can inspect. See test/README.md.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  // One app process and one database are shared by every spec; serial execution
  // keeps rate limits, MQTT traffic and admin-visible listings predictable.
  maxWorkers: 1,
  testTimeout: 30_000,
  // MQTT clients keep the event loop alive after a failed assertion skips their
  // cleanup; without this a red run hangs instead of reporting.
  forceExit: true,
};
