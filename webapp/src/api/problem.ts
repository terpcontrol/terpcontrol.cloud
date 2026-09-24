import type { Problem } from '@fg2/shared-types/v1';

/**
 * Every failure the API reports is `application/problem+json`, so the app has
 * one error to catch and one place that knows the field errors a form needs.
 */
export class ApiError extends Error {
  public readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }

  public get status(): number {
    return this.problem.status;
  }

  /** The field errors a form shows beside its inputs, keyed by the dotted path into whatever did not fit: a body, or a query parameter's name. */
  public get fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const error of this.problem.errors) errors[error.field] = error.detail;
    return errors;
  }
}

/**
 * Whether a read failed because its subject is not there for this account any
 * more, rather than because the request never reached an answer.
 *
 * The two are worth telling apart on a page somebody is standing on: a dropped
 * connection is put right by asking again, and being taken out of somebody's
 * tent never is, so a retry button under that one is a button that can only
 * fail. `access()` answers 404 to a reader who may not see a subject at all -
 * it never reports the existence of something somebody may not know about - so
 * a 404 on the page's own read is the whole signal. A *write* that is refused
 * comes back 403 and is a different sentence, said where it was asked for.
 */
export const noLongerThere = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

/** A response that failed, read as a problem - or turned into one when it is not JSON at all. */
export const readProblem = async (response: Response): Promise<Problem> => {
  try {
    const body = (await response.json()) as Partial<Problem>;
    if (typeof body?.status === 'number' && typeof body?.code === 'string') return body as Problem;
  } catch {
    // A proxy or a crash answers HTML; the status line is still the truth.
  }
  return { status: response.status, code: 'unexpected', title: response.statusText || 'Request failed', detail: '', errors: [] };
};
