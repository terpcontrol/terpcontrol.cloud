import { jest } from '@jest/globals';

/**
 * The logger builds itself as it is imported - it creates a log directory and
 * writes to it, and every service file pulls it in. Replacing the module keeps
 * a spec run from leaving files behind and from burying its own output, and
 * lets a spec assert on what was logged.
 *
 * Registered here rather than in each spec because an ES module is linked
 * before the importing file runs: a mock a spec declares in its own body would
 * come too late for the services it imports at the top.
 */
jest.unstable_mockModule('@utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), http: jest.fn(), verbose: jest.fn(), debug: jest.fn(), silly: jest.fn() },
}));
