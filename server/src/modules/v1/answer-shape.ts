import { HttpStatus } from '@nestjs/common';
import { ApiResponse, ApiResponseOptions } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { registry } from '@fg2/shared-types/v1-schemas';
import { z, ZodType } from 'zod';
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
 * written into the operation instead. `io: 'output'` is what an answer is: the
 * shape as it leaves, after a schema's own transforms, where a request body is
 * the shape as it arrives. `unrepresentable: 'any'` lets a value with no JSON
 * Schema of its own describe itself through `.meta()`, which leaves `tsType`
 * behind - a hint for the type generator in shared-types, and not a JSON Schema
 * keyword.
 */
const notPartOfTheShape = new Set(['$schema', '$id', 'tsType']);

const inlineSchema = (schema: ZodType): SchemaObject =>
  JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })), (key, value) =>
    notPartOfTheShape.has(key) ? undefined : value,
  ) as SchemaObject;

export const answerSchema = (schema: ZodType): SchemaObject => {
  const name = registry.get(schema)?.id;

  return name && name in V1_SCHEMAS ? ({ $ref: `#/components/schemas/${name}` } as SchemaObject) : inlineSchema(schema);
};

/**
 * `@V1Answer(me)` for a read, `@V1Answer(user, { status: HttpStatus.CREATED })`
 * for anything else. Declaring a shape replaces the status Nest would have
 * documented on its own, so a route that does not answer 200 says which one it
 * does or it describes an answer nobody ever gets.
 */
export const V1Answer = (schema: ZodType, options: ApiResponseOptions = {}) =>
  ApiResponse({ status: HttpStatus.OK, ...options, schema: answerSchema(schema) });
