import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Problem } from '@fg2/shared-types/v1';
import { ApiExceptionFilter } from '@common/http-exception.filter';
import { loggablePath } from '@common/log-path';
import { logger } from '@utils/logger';
import { ProblemException, problemOf } from './problem';

/** Everything under it answers RFC 7807; everything beside it is the Angular app's API. */
export const V1_PREFIX = '/v1';

/**
 * What a status is called when the thrower did not say. A route that wants
 * more than "forbidden" throws a `ProblemException` with its own code, which is
 * what a client should be branching on.
 */
const CODES: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.UNAUTHORIZED]: 'unauthenticated',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'too_large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'unsupported_media_type',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'unprocessable',
  [HttpStatus.TOO_MANY_REQUESTS]: 'too_many_requests',
  [HttpStatus.NOT_IMPLEMENTED]: 'not_implemented',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'internal_error',
};

// Compared the way the router matches, which ignores case: `/V1/devices` reaches
// the same handler, and a refusal answered in the other half's shape there would
// be a way around every promise this filter makes.
const isV1 = (url: string | undefined): boolean => {
  const path = (url ?? '/').split('?')[0].toLowerCase();
  return path === V1_PREFIX || path.startsWith(`${V1_PREFIX}/`);
};

/**
 * One filter for the whole server, answering each half in its own shape: a
 * problem document under `/v1`, and the `{ message }` the Angular app has always
 * read everywhere else. One global filter rather than two, because Nest runs a
 * single global chain and a second one registered beside this would simply never
 * be asked - and because a `/v1` controller that forgot to bind its own filter
 * would answer the wrong shape without anything saying so.
 */
@Catch()
export class ProblemExceptionFilter extends ApiExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();

    if (!isV1(request.url)) {
      super.catch(exception, host);
      return;
    }

    const problem = this.asProblem(exception);
    logger.error(`[${request.method}] ${loggablePath(request.url)} >> StatusCode:: ${problem.status}, Message:: ${problem.detail}`);

    void context.getResponse<FastifyReply>().status(problem.status).type('application/problem+json; charset=utf-8').send(problem);
  }

  /**
   * A refusal that named itself is answered as it is; everything else - a Nest
   * exception from a pipe or a guard, a cast that failed, a throw nobody meant -
   * is described by the status the legacy half already derives for it.
   */
  private asProblem(exception: unknown): Problem {
    if (exception instanceof ProblemException) return exception.problem;

    const { status, message } = this.describe(exception);
    return problemOf(status, CODES[status] ?? CODES[HttpStatus.INTERNAL_SERVER_ERROR], message);
  }
}
