import { NODE_ENV } from '@config';

interface Indizierbar {
  modelName: string;
  createIndexes(): Promise<unknown>;
}

/**
 * Builds a model's declared indexes once, when its module is imported.
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
 */
export function baueIndexe(model: Indizierbar): void {
  if (NODE_ENV === 'test') {
    return;
  }
  void model.createIndexes().catch(fehler => {
    console.log(`index build failed for ${model.modelName}:`, fehler);
  });
}
