import { ArgumentsHost, Catch, ExceptionFilter, HttpException as NestHttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Error as MongooseError } from 'mongoose';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';

/**
 * A refusal that answers with a bare string rather than the usual JSON body.
 * The device access checks have always answered this way and clients read the
 * text, so the shape is kept as it was.
 */
export class PlainTextException extends NestHttpException {
  constructor(status: number, public readonly text: string) {
    super(text, status);
  }
}

/**
 * One error shape for the whole API: `{ message }` with the status the thrower
 * chose, logged the same way the Express error middleware logged it. Services
 * shared with the Express app throw its HttpException, so both are handled.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    const { status, message } = this.describe(exception);

    // The path without the query string, as the Express error middleware logged
    // it: a picture URL carries the long-lived image token, and the error log is
    // kept for a month.
    const path = request.url.split('?')[0];
    logger.error(`[${request.method}] ${path} >> StatusCode:: ${status}, Message:: ${message}`);

    if (exception instanceof PlainTextException) {
      // Express sent strings as text/html, and one of these repeats the device
      // id out of the URL - so a browser opening a crafted link would have
      // rendered whatever it carried. The text is what clients read; the type
      // says what it is.
      void reply.status(status).type('text/plain; charset=utf-8').send(exception.text);
      return;
    }

    // The route may have declared another content type; an error is JSON.
    void reply.status(status).type('application/json; charset=utf-8').send(this.body(exception, message));
  }

  /**
   * Most of the API answers `{ message }`, but a few routes have always
   * answered `{ error }`. A controller picks the second by throwing with an
   * object body, which is passed through as it is.
   */
  private body(exception: unknown, message: string): Record<string, unknown> {
    if (exception instanceof NestHttpException) {
      const response = exception.getResponse();
      if (response && typeof response === 'object' && !('message' in response)) {
        return response as Record<string, unknown>;
      }
    }

    return { message };
  }

  private describe(exception: unknown): { status: number; message: string } {
    if (exception instanceof HttpException) {
      return { status: exception.status, message: exception.message };
    }

    // An id that is not an id at all is a malformed request, not a failure on
    // this side - and mongoose's own message names the model it tried to load.
    if (exception instanceof MongooseError.CastError) {
      return { status: HttpStatus.BAD_REQUEST, message: `Invalid ${exception.path}` };
    }

    if (exception instanceof NestHttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (response as { message?: unknown; error?: unknown })?.message ?? (response as { error?: unknown })?.error ?? exception.message;

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
  }
}
