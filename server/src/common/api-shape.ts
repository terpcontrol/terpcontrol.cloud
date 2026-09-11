import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiResponseOptions, SchemaObject } from '@nestjs/swagger';
import { core, z, ZodType } from 'zod';
import sharedSchemas from '@fg2/shared-types/openapi-schemas.json';

/**
 * The shapes the API answers with, named once in `shared-types/src/schemas.ts`
 * and generated from there. They are registered on the document as
 * `components.schemas` (see openapi.ts) and referenced by name here.
 *
 * Nest builds response schemas from runtime metadata - an `@ApiProperty` on a
 * class, or its CLI plugin - and a shared TypeScript interface leaves neither,
 * which is why every operation used to document its answer as nothing at all.
 * A reference to a generated schema needs no class to exist.
 */
export type SharedShape = keyof typeof sharedSchemas;

export const SHARED_SCHEMAS: Record<string, object> = sharedSchemas;

const ref = (shape: SharedShape) => ({ $ref: `#/components/schemas/${shape}` });

/**
 * What a route answers with. `ApiShape('Device')` for one, `ApiShape(['Device'])`
 * for a list of them. The name is checked against the generated schemas, so a
 * shape that is renamed or gone fails the build rather than the document.
 */
export const ApiShape = (shape: SharedShape | [SharedShape], options: ApiResponseOptions = {}) =>
  applyDecorators(
    ApiOkResponse({
      ...options,
      schema: Array.isArray(shape) ? { type: 'array', items: ref(shape[0]) } : ref(shape),
    }),
  );

/** Keys that describe the document rather than the value, and a generator hint. */
const notPartOfTheShape = new Set(['$schema', '$id', 'tsType']);

/**
 * What a route accepts, read off the schema that already decides it.
 *
 * A zod schema is a runtime object and can describe itself, so a request body
 * needs no shape authored alongside it the way a response did - `ZodBody` hands
 * the one schema to the pipe and to the document together.
 *
 * Three things the generator in shared-types learned apply here as well.
 * `io: 'input'` is what a body is: the shape as it arrives, before a
 * `.transform()` has had it. `unrepresentable: 'any'` lets a value with no JSON
 * Schema of its own - a Date, raw bytes - describe itself through `.meta()`
 * instead of being refused outright, which leaves `tsType` behind: a hint for
 * the type generator, and not a JSON Schema keyword. And `additionalProperties:
 * false` stays, where the generated response shapes drop it - an answer may
 * carry more than a schema names, but a closed request body is precisely what
 * the server enforces, so the document says so.
 */
export const requestSchema = (schema: ZodType): SchemaObject =>
  JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })), (key, value) =>
    notPartOfTheShape.has(key) ? undefined : value,
  ) as SchemaObject;

/** What a route accepts, for the document. The counterpart of `ApiShape`. */
export const ApiBodyShape = (schema: ZodType) => ApiBody({ schema: requestSchema(schema) });

/**
 * The same shapes, with the references between them pointed at a `$defs` of the
 * whole set. They are written for the document, where OpenAPI resolves a
 * reference against `components`; zod resolves one against the schema it is
 * handed, so a shape built from another would otherwise have nowhere to look.
 */
const resolvable: Record<string, core.JSONSchema.BaseSchema> = JSON.parse(
  JSON.stringify(sharedSchemas).replaceAll('#/components/schemas/', '#/$defs/'),
);

/**
 * A shape from shared-types as something the server can validate against.
 *
 * The zod schemas themselves cannot be imported: the package is linked with
 * `file:`, so node resolves what it imports beside the package rather than
 * beside the server, and zod does not live there. What does travel is the JSON
 * Schema generated from those same schemas, and zod reads it back - so a body
 * that carries a shared shape still names it where it is defined instead of
 * restating it. The type is named alongside because JSON carries none; both
 * come from the one definition, so they cannot describe different things.
 */
export const sharedShape = <T>(shape: SharedShape): ZodType<T> => z.fromJSONSchema({ ...resolvable[shape], $defs: resolvable }) as ZodType<T>;
