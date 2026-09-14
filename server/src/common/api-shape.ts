import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiResponseOptions } from '@nestjs/swagger';
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
 *
 * A route that answers something other than 200 says so - `ApiShape('ShareLink',
 * { status: HttpStatus.CREATED })`. Declaring a shape at all replaces the status
 * Nest would have documented on its own, so a 201 route left at the default
 * would describe an answer it never sends.
 */
export const ApiShape = (shape: SharedShape | [SharedShape], options: ApiResponseOptions = {}) =>
  applyDecorators(
    ApiResponse({
      status: HttpStatus.OK,
      ...options,
      schema: Array.isArray(shape) ? { type: 'array', items: ref(shape[0]) } : ref(shape),
    }),
  );

/**
 * `{ "status": "ok" }` - what a route answers when it has nothing to report but
 * that it did the thing. Not a shared shape: it says nothing about the domain,
 * and naming it in shared-types would put it in front of every consumer that
 * imports a type from there.
 */
export const ApiStatusOk = (options: ApiResponseOptions = {}) =>
  applyDecorators(
    ApiOkResponse({
      description: 'Done.',
      ...options,
      schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } },
    }),
  );
