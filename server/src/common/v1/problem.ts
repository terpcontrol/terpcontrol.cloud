import { HttpStatus } from '@nestjs/common';
import { Problem, ProblemError } from '@fg2/shared-types/v1';

/**
 * Every refusal of `/v1` is one shape: RFC 7807, `application/problem+json`,
 * with a `code` a client branches on and `errors[]` for the fields a body got
 * wrong. Thrown as an exception so a service refuses where it decides rather
 * than handing a failure back up through everything that called it.
 */
export class ProblemException extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail);
  }
}

/** What each status is called. A status nothing here names is a bug, not a shape to invent at runtime. */
const TITLES: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthenticated',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Too large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported media type',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests',
  [HttpStatus.NOT_IMPLEMENTED]: 'Not implemented',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Something went wrong',
};

export const problemOf = (status: number, code: string, detail: string, errors: ProblemError[] = []): Problem => ({
  status,
  code,
  title: TITLES[status] ?? TITLES[HttpStatus.INTERNAL_SERVER_ERROR],
  detail,
  errors,
});

const refusal =
  (status: number) =>
  (code: string, detail: string, errors: ProblemError[] = []): ProblemException =>
    new ProblemException(problemOf(status, code, detail, errors));

/**
 * The refusals a route reaches for. `code` is the machine-readable half and is
 * the caller's to choose - `device_not_claimed` says more than a status ever
 * does - so it is asked for rather than derived from the status.
 */
export const badRequest = refusal(HttpStatus.BAD_REQUEST);
export const unauthenticated = refusal(HttpStatus.UNAUTHORIZED);
export const forbidden = refusal(HttpStatus.FORBIDDEN);
export const notFound = refusal(HttpStatus.NOT_FOUND);
export const conflict = refusal(HttpStatus.CONFLICT);
export const unprocessable = refusal(HttpStatus.UNPROCESSABLE_ENTITY);
export const serviceUnavailable = refusal(HttpStatus.SERVICE_UNAVAILABLE);
