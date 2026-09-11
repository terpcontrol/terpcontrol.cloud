import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse, ApiResponseOptions } from '@nestjs/swagger';
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
 * The status defaults to 200; a route that answers 201 has to say so
 * (`ApiShape('ShareLink', { status: HttpStatus.CREATED })`), or the document would
 * describe a response the route never sends.
 */
export const ApiShape = (shape: SharedShape | [SharedShape], options: ApiResponseOptions = {}) =>
  applyDecorators(
    ApiResponse({
      status: HttpStatus.OK,
      ...options,
      schema: Array.isArray(shape) ? { type: 'array', items: ref(shape[0]) } : ref(shape),
    }),
  );
