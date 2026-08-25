import { NODE_ENV } from '@config';

interface Indizierbar {
  modelName: string;
  createIndexes(): Promise<unknown>;
}

/**
 * Builds a model's declared indexes once, when its module is imported.
 *
 * `createIndexes()` only ever creates: it builds every declaration it can,
 * skips past one it cannot and rejects afterwards with the first failure. That
 * is what makes it safe in a boot path where several instances start at the
 * same moment - a create that is already satisfied is a no-op, and an
 * index whose declaration was *narrowed* since the database last saw it fails
 * on its own without taking the others with it. Narrowing needs the old index
 * dropped first, and a drop in a boot path races the second instance (D3), so
 * that one stays in `npm run migrate:indexes` and is the only thing an operator
 * has to run by hand.
 *
 * Two things this must never do, both of which the bare
 * `void model.createIndexes()` it replaces did.
 *
 * It must not reject into nothing. A floating promise here becomes an
 * unhandled rejection, and a mongo that is briefly away would take the process
 * down for something it should simply retry past.
 *
 * And it must not run under test. There is no connection at import time there,
 * so mongoose buffers the call and answers ten seconds later - long enough to
 * land in the middle of an unrelated test and fail it, which is exactly how
 * `devicelogs.createIndex() buffering timed out` failed the health-check test
 * on a slow runner while passing on a fast one.
 *
 * The returned promise never rejects; it is there so a test can wait for the
 * build instead of guessing how long it takes.
 */
export function baueIndexe(model: Indizierbar): Promise<void> {
  if (NODE_ENV === 'test') {
    return Promise.resolve();
  }

  return Promise.resolve(model.createIndexes()).then(
    () => undefined,
    fehler => {
      console.log(`index build failed for ${model.modelName}:`, fehler);
    },
  );
}
