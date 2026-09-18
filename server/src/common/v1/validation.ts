import { Query } from '@nestjs/common';
import { ApiQuery, SchemaObject } from '@nestjs/swagger';
import { z, ZodType } from 'zod';
import { requestSchema, ZodValidationPipe } from '@common/zod-validation.pipe';

/**
 * What a `/v1` route accepts, checked against the contract itself: the schemas
 * in `@fg2/shared-types/v1-schemas` are objects at run time, so a route names the
 * shape where it is defined instead of restating it. A body is `@V1Body(schema)`
 * from `common/zod-validation.pipe`; this is the rest of the request.
 *
 * A failure is refused as a problem document with the offending fields listed,
 * which is the one thing the contract says about a bad request.
 */

/**
 * Validated and documented from the one schema, the way a body is. A query
 * parameter that only the pipe knows about is a parameter a client reading the
 * document cannot discover - and some of them are required, so the route cannot
 * be called at all without them.
 *
 * The schema describes the whole query string, so its top-level properties are
 * the parameters; anything that is not an object of them documents nothing,
 * because there is no parameter name to hang a description on.
 */
export const V1Query = <T>(schema: ZodType<T>): ParameterDecorator => {
  const query = Query(new ZodValidationPipe(schema, 'problem'));

  return (target, propertyKey, parameterIndex) => {
    query(target, propertyKey, parameterIndex);

    const handler = propertyKey === undefined ? undefined : Object.getOwnPropertyDescriptor(target, propertyKey);
    if (!handler) {
      return;
    }

    const described = requestSchema(schema);
    const required = new Set(described.required ?? []);

    for (const [name, property] of Object.entries(described.properties ?? {})) {
      ApiQuery({
        name,
        required: required.has(name),
        schema: property as SchemaObject,
        ...('description' in (property as SchemaObject) ? { description: (property as SchemaObject).description } : {}),
      })(target, propertyKey as string | symbol, handler);
    }
  };
};

/**
 * What every list accepts. The contract names each list's answer and says lists
 * take `limit` and `cursor`, but it describes no query shapes at all - a query
 * string is not a shape a client has to hold - so the parameters are stated
 * here, once, and a route that filters extends this.
 *
 * Coerced, because a query string carries numbers as text.
 */
export const pageQuery = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

export type PageQuery = z.infer<typeof pageQuery>;
