/**
 * Black-box integration suite. Boots the API as a real process against a real
 * MongoDB and MQTT broker, with InfluxDB and SMTP replaced by fakes that the
 * specs can inspect. TARGET selects the implementation under test, so the same
 * suite is the contract for both the legacy Express app and its NestJS
 * replacement.
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
};
