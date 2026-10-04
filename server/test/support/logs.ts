import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = join(__dirname, '..', '.tmp', 'logs');

// Sorted, so the log reads in the order it was written when a run spans more
// than one day's file.
const logFiles = (level: string): string[] => {
  const directory = join(LOG_DIR, level);

  return readdirSync(directory)
    .filter(file => file.endsWith('.log'))
    .sort()
    .map(file => join(directory, file));
};

/**
 * Everything the server has written this run, debug and error alike. The files
 * are what an operator reads, so a spec that cares what the server says reads
 * the same thing rather than the process output.
 */
export const serverLog = (): string =>
  ['debug', 'error']
    .flatMap(logFiles)
    .map(file => readFileSync(file, 'utf8'))
    .join('\n');

/** How often the log says this - the way to see that a line is *new*. */
export const serverLogMentions = (needle: string): number => serverLog().split(needle).length - 1;

/**
 * The debug log, which has every line the error log has, as the test
 * environment reads it to show a failing test what the server said meanwhile.
 * Its files only ever grow, so a byte count is a position in it.
 */
export const debugLog = {
  mark: (): number => logFiles('debug').reduce((size, file) => size + statSync(file).size, 0),
  since: (mark: number): string[] =>
    Buffer.concat(logFiles('debug').map(file => readFileSync(file)))
      .subarray(mark)
      .toString('utf8')
      .split('\n')
      .filter(line => line !== ''),
};
