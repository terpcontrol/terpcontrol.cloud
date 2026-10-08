import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from './infra/app';

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

/** The bytes a file has gained since it was `from` bytes long. */
const readFrom = (file: string, from: number): Buffer => {
  const grown = statSync(file).size - from;
  if (grown <= 0) return Buffer.alloc(0);

  const descriptor = openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(grown);
    return bytes.subarray(0, readSync(descriptor, bytes, 0, grown, from));
  } finally {
    closeSync(descriptor);
  }
};

/**
 * The debug log, which has every line the error log has, as the test
 * environment reads it to show a failing test what the server said meanwhile.
 * A position in it is the size of each of its files: a file only ever grows,
 * and what a test reads is what each one gained since - a file that started
 * meanwhile, the next day's, from its beginning. A day's file that has been
 * zipped away is no longer among them, so it cannot shift what is read from
 * the others, and the earlier days' files are not read at all.
 */
export const debugLog = {
  mark: (): Map<string, number> => new Map(logFiles('debug').map(file => [file, statSync(file).size])),
  since: (mark: Map<string, number>): string[] =>
    Buffer.concat(logFiles('debug').map(file => readFrom(file, mark.get(file) ?? 0)))
      .toString('utf8')
      .split('\n')
      .filter(line => line !== ''),
};
