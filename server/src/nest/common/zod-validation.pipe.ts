import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

/**
 * Validates a payload against a Zod schema and hands the parsed value on.
 *
 * The message format follows the API's existing 400s - the reasons joined by a
 * comma - so clients that show it to a user keep working.
 */
/** Which key the refusal carries; a few routes have always answered `{ error }`. */
export type ErrorKey = 'message' | 'error';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>, private readonly errorKey: ErrorKey = 'message') {}

  public transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const reasons = result.error.issues.map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      const text = reasons.join(', ');

      throw new BadRequestException(this.errorKey === 'error' ? { error: text } : text);
    }

    return result.data;
  }
}

/** `@Body(zodBody(Schema))` reads better at the call site than `new ZodValidationPipe(...)`. */
export const zodBody = <T>(schema: ZodType<T>): ZodValidationPipe<T> => new ZodValidationPipe(schema);

/** For the routes whose refusals carry `error` instead of `message`. */
export const zodBodyAsError = <T>(schema: ZodType<T>): ZodValidationPipe<T> => new ZodValidationPipe(schema, 'error');
