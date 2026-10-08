import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Error as MongooseError } from 'mongoose';
import { loggablePath } from '@common/log-path';
import { isV1Path } from '@common/route-path';
import { logger } from '@utils/logger';
import { ProblemException, problemOf } from '@common/v1/problem';

/**
 * A refusal that answers with a bare string rather than the usual JSON body.
 * The device access checks have always answered this way and clients read the
 * text, so the shape is kept as it was.
 */
export class PlainTextException extends HttpException {
  constructor(
    status: number,
    public readonly text: string,
  ) {
    super(text, status);
  }
}

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

/**
 * How loud a refusal is in the log. Only a 5xx is the server failing; a 4xx is
 * the answer it meant to give, and a 404 is often the expected one - "this
 * device is not running a plan" is asked several times on every cockpit - so
 * it is left to the request line, which already carries the status.
 */
const levelOf = (status: number): 'error' | 'warn' | 'debug' =>
  status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : status === HttpStatus.NOT_FOUND ? 'debug' : 'warn';

/**
 * The status and the sentence of whatever was thrown.
 *
 * A refusal that named its own status is one wherever it was thrown. The
 * shareable addresses `/g/{slug}` and `/@{handle}` live outside `/v1` because
 * they are what somebody pastes into a message rather than API routes, and
 * they refuse the way the rest of the server does - so a diary that is not
 * public has to answer 404 there rather than becoming a 500 for want of a
 * version in the path.
 */
const describe = (exception: unknown): { status: number; message: string } => {
  if (exception instanceof ProblemException) return { status: exception.problem.status, message: exception.problem.detail };

  // An id that is not an id at all is a malformed request, not a failure on
  // this side - and mongoose's own message names the model it tried to load.
  if (exception instanceof MongooseError.CastError) {
    return { status: HttpStatus.BAD_REQUEST, message: `Invalid ${exception.path}` };
  }

  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : ((response as { message?: unknown; error?: unknown })?.message ?? (response as { error?: unknown })?.error ?? exception.message);

    return {
      status: exception.getStatus(),
      // Nest reports several validation failures as an array; the API has
      // always sent a single string.
      message: Array.isArray(message) ? message.join(', ') : String(message),
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: exception instanceof Error && exception.message ? exception.message : 'Something went wrong',
  };
};

/**
 * Most of the legacy half answers `{ message }`, but a few routes have always
 * answered `{ error }`. A controller picks the second by throwing with an
 * object body, which is passed through as it is.
 */
const body = (exception: unknown, message: string): Record<string, unknown> => {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (response && typeof response === 'object' && !('message' in response)) {
      return response as Record<string, unknown>;
    }
  }

  return { message };
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
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    const v1 = isV1Path(request.url);
    const { status, message } = describe(exception);
    logger.log(v1 ? levelOf(status) : 'error', `[${request.method}] ${loggablePath(request.url)} >> StatusCode:: ${status}, Message:: ${message}`);

    if (v1) {
      // A refusal that named itself is answered as it is; everything else - a
      // Nest exception from a pipe or a guard, a cast that failed, a throw
      // nobody meant - by the status derived for it above.
      const problem =
        exception instanceof ProblemException
          ? exception.problem
          : problemOf(status, CODES[status] ?? CODES[HttpStatus.INTERNAL_SERVER_ERROR], message);
      void reply.status(status).type('application/problem+json; charset=utf-8').send(problem);
      return;
    }

    if (exception instanceof PlainTextException) {
      // Express sent strings as text/html, and one of these repeats the device
      // id out of the URL - so a browser opening a crafted link would have
      // rendered whatever it carried. The text is what clients read; the type
      // says what it is.
      void reply.status(status).type('text/plain; charset=utf-8').send(exception.text);
      return;
    }

    // The route may have declared another content type; an error is JSON.
    void reply.status(status).type('application/json; charset=utf-8').send(body(exception, message));
  }
}
