import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse, ApiResponseOptions } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { registry } from '@fg2/shared-types/v1-schemas';
import { ZodType } from 'zod';
import { jsonSchemaOf } from '@common/zod-validation.pipe';
import { V1_SCHEMAS } from '../../openapi';

/**
 * What a `/v1` route answers, for the document, taken from the contract schema
 * that already describes it rather than from a shape authored beside it.
 *
 * A schema the contract names is referenced by that name: the whole contract is
 * registered as `components.schemas` (see `openapi.ts`), so the document says
 * `Device` where the route answers a device, and a reader follows one link
 * instead of reading the same object spelled out at twenty routes.
 *
 * A schema the contract does not name - one a route builds out of others - is
 * written into the operation instead, as the shape it leaves in.
 */
const answerSchema = (schema: ZodType): SchemaObject => {
  const name = registry.get(schema)?.id;

  return name && name in V1_SCHEMAS ? ({ $ref: `#/components/schemas/${name}` } as SchemaObject) : jsonSchemaOf(schema, 'output');
};

/**
 * `@V1Answer(me)` for a read, `@V1Answer(user, { status: HttpStatus.CREATED })`
 * for anything else. Declaring a shape replaces the status Nest would have
 * documented on its own, so a route that does not answer 200 says which one it
 * does or it describes an answer nobody ever gets.
 */
export const V1Answer = (schema: ZodType, options: ApiResponseOptions = {}) =>
  ApiResponse({ status: HttpStatus.OK, ...options, schema: answerSchema(schema) });

/** What the store holds: stills and photos as they were taken, films as they were rendered. */
const PICTURE_BYTES = {
  'image/jpeg': { schema: { type: 'string', format: 'binary' } },
  'image/png': { schema: { type: 'string', format: 'binary' } },
  'video/mp4': { schema: { type: 'string', format: 'binary' } },
};

/**
 * What a route that hands out stored bytes answers: the file, the range a
 * player asked for, or - for a range that starts past the end of the file - a
 * refusal like every other rather than an empty body.
 */
export const ApiPictureBytes = () =>
  applyDecorators(
    ApiResponse({ status: HttpStatus.OK, description: 'The file itself, in the type it was stored as.', content: PICTURE_BYTES }),
    ApiResponse({ status: HttpStatus.PARTIAL_CONTENT, description: 'The byte range a <video> element asked for.', content: PICTURE_BYTES }),
    ApiResponse({
      status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      description: 'The byte range asked for starts past the end of the file. `Content-Range` says how long it is.',
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
    }),
  );
