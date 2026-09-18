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

  /** The field errors a form shows beside its inputs, keyed by the dotted path into the body. */
  public get fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const error of this.problem.errors) errors[error.field] = error.detail;
    return errors;
  }
}

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
