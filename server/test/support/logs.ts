import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = join(__dirname, '..', '.tmp', 'logs');

/**
 * Everything the server has written this run, debug and error alike. The files
 * are what an operator reads, so a spec that cares what the server says reads
 * the same thing rather than the process output.
 */
export const serverLog = (): string => {
  const parts: string[] = [];

  for (const level of ['debug', 'error']) {
    const directory = join(LOG_DIR, level);
    // Sorted, so the log reads in the order it was written when a run spans
    // more than one day's file.
    for (const file of readdirSync(directory).sort()) {
      if (file.endsWith('.log')) parts.push(readFileSync(join(directory, file), 'utf8'));
    }
  }

  return parts.join('\n');
};

/** How often the log says this - the way to see that a line is *new*. */
export const serverLogMentions = (needle: string): number => serverLog().split(needle).length - 1;
