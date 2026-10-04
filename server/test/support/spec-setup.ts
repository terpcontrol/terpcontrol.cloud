import { takeDownCameras } from './fixtures';
import { debugLog } from './logs';

/**
 * A spec's cameras end with it. The poller goes on reading every camera that
 * stands for the rest of the run, starting one a second in each pass, and each
 * spec leaves a few: a camera the next spec adds would wait its turn behind all
 * of theirs, in passes that grow with every spec, and a case waiting for the
 * poller to read its camera would time out on how many specs ran before it.
 */
afterAll(() => takeDownCameras());

// What a failing test prints of the server's log (server-log-environment.mjs).
(globalThis as Record<string, unknown>).__serverLog = debugLog;
