import { ArgumentMetadata, BadRequestException, Body, Injectable, PipeTransform } from '@nestjs/common';
import { ApiBody, SchemaObject } from '@nestjs/swagger';
import { z, ZodType } from 'zod';
import { badRequest } from './v1/problem';

/**
 * Validates a payload against a Zod schema and hands the parsed value on.
 *
 * What is validated and how a failure is refused are two questions, so one pipe
 * answers both. `/v1` refuses with a problem document listing the offending
 * fields; the device protocol keeps the shape it has always answered - the
 * reasons joined by a comma under `message` - because firmware in the field
 * reads it.
 */
export type ErrorKey = 'message' | 'problem';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: ZodType<T>,
    private readonly errorKey: ErrorKey = 'message',
  ) {}

  public transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      if (this.errorKey === 'problem') {
        throw badRequest(
          'validation_failed',
          'The request body does not match what this route accepts.',
          result.error.issues.map(issue => ({ field: issue.path.join('.'), code: issue.code, detail: issue.message })),
        );
      }

      const reasons = result.error.issues.map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      const text = reasons.join(', ');

      throw new BadRequestException(text);
    }

    return result.data;
  }
}

/** Keys that describe the document rather than the value, and a generator hint. */
const notPartOfTheShape = new Set(['$schema', '$id', 'tsType']);

/**
 * What a route accepts, for the document, read off the schema that already
 * decides it - a zod schema is a runtime object and can describe itself.
 *
 * `io: 'input'` is what a body is: the shape as it arrives, before a
 * `.transform()` has had it. `unrepresentable: 'any'` lets a value with no JSON
 * Schema of its own - a Date, raw bytes - describe itself through `.meta()`
 * instead of being refused outright, which leaves `tsType` behind: a hint for
 * the type generator in shared-types, and not a JSON Schema keyword.
 */
export const requestSchema = (schema: ZodType): SchemaObject =>
  JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })), (key, value) =>
    notPartOfTheShape.has(key) ? undefined : value,
  ) as SchemaObject;

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
      ApiBody({ schema: requestSchema(schema) })(target, propertyKey as string | symbol, handler);
    }
  };

/** `@ZodBody(Schema) body: Body` - validated against the schema, documented as it. For the device protocol. */
export const ZodBody = <T>(schema: ZodType<T>): ParameterDecorator => validatedBody(schema, 'message');

/** The same for `/v1`, where a body that does not fit is refused as a problem document. */
export const V1Body = <T>(schema: ZodType<T>): ParameterDecorator => validatedBody(schema, 'problem');
