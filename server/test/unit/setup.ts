import { jest } from '@jest/globals';
import { inspect } from 'node:util';

const logged: string[] = [];

const level = (name: string) =>
  jest.fn((...args: unknown[]) => {
    logged.push(`${name}: ${args.map(arg => (typeof arg === 'string' ? arg : inspect(arg))).join(' ')}`);
  });

/**
 * The logger builds itself as it is imported - it creates a log directory and
 * writes to it, and every service file pulls it in. Replacing the module keeps
 * a spec run from leaving files behind and from burying its own output, and
 * lets a spec assert on what was logged. What a test logs is kept and printed
 * only if that test fails (server-log-environment.mjs).
 *
 * Registered here rather than in each spec because an ES module is linked
 * before the importing file runs: a mock a spec declares in its own body would
 * come too late for the services it imports at the top.
 */
jest.unstable_mockModule('@utils/logger', () => ({
  logger: Object.fromEntries(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].map(name => [name, level(name)])),
  errorText: (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error)),
}));

(globalThis as Record<string, unknown>).__serverLog = {
  mark: () => logged.length,
  since: (mark: number) => logged.slice(mark),
};
