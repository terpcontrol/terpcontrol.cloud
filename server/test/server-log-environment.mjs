import { TestEnvironment } from 'jest-environment-node';

/** Enough to see what led up to a failure, without a timeout's worth of polling. */
const SHOWN_LINES = 200;

/** The server writes its log on its own schedule; the lines of a request that just failed may still be on their way. */
const SETTLE_MS = 250;

/**
 * Node's environment, plus what the server logged while each test ran: printed
 * with a test that fails, dropped with one that passes. A green run says
 * nothing, and a red one carries the log that explains it without having to be
 * repeated with more output switched on.
 *
 * A suite's setup file says where the log is, as `globalThis.__serverLog`:
 * `mark()` for a position in it, and `since(mark)` for the lines written after
 * one (unit/setup.ts, support/spec-setup.ts).
 *
 * Plain JavaScript, which jest loads as it is. Written in TypeScript it would
 * go through the unit suite's ts-jest as CommonJS, and that compiler would go
 * on emitting CommonJS for the ES module specs after it.
 */
export default class ServerLogEnvironment extends TestEnvironment {
  mark = 0;

  async handleTestEvent(event) {
    const log = this.global.__serverLog;
    if (!log) return;

    if (event.name === 'test_start') this.mark = log.mark();
    if (event.name !== 'test_done' || event.test.errors.length === 0) return;

    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    const lines = log.since(this.mark);
    if (lines.length === 0) return;

    const skipped = lines.length - SHOWN_LINES;
    const shown = skipped > 0 ? [`… ${skipped} earlier lines`, ...lines.slice(skipped)] : lines;
    this.global.console.log(`What the server logged during "${event.test.name}":\n${shown.join('\n')}`);
  }
}
