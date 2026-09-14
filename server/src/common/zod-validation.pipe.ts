import { ArgumentMetadata, BadRequestException, Body, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { ApiBodyShape } from './api-shape';

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
  constructor(
    private readonly schema: ZodType<T>,
    private readonly errorKey: ErrorKey = 'message',
  ) {}

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

/**
 * Both halves of a body from one schema: the pipe that decides what the route
 * accepts, and the description of it the document carries. Naming the schema
 * twice is how the two drift, so `@ZodBody(Schema)` is a body parameter's whole
 * annotation.
 */
const validatedBody =
  (schema: ZodType, errorKey: ErrorKey): ParameterDecorator =>
  (target, propertyKey, parameterIndex) => {
    Body(new ZodValidationPipe(schema, errorKey))(target, propertyKey, parameterIndex);

    // `ApiBody` is a method decorator: it hangs what it records off the method,
    // so it wants the descriptor, which a parameter decorator can look up from
    // the property it belongs to. A route handler has one; a constructor
    // parameter, which this is not for, does not.
    const handler = propertyKey === undefined ? undefined : Object.getOwnPropertyDescriptor(target, propertyKey);
    if (handler) {
      ApiBodyShape(schema)(target, propertyKey as string | symbol, handler);
    }
  };

/** `@ZodBody(Schema) body: Body` - validated against the schema, documented as it. */
export const ZodBody = <T>(schema: ZodType<T>): ParameterDecorator => validatedBody(schema, 'message');

/** For the routes whose refusals carry `error` instead of `message`. */
export const ZodBodyAsError = <T>(schema: ZodType<T>): ParameterDecorator => validatedBody(schema, 'error');
