import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyRequest } from 'fastify';

/**
 * Two things Express did for us that Fastify does not, and that clients in the
 * field depend on. Both are done on the request before routing, which keeps
 * them out of the way of the parsers Nest installs.
 */
export const registerHttpCompatibility = (app: NestFastifyApplication): void => {
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request: FastifyRequest, _reply, done) => {
      dropEmptyJsonBody(request);
      collapseRepeatedQueryParameters(request);
      done();
    });
};

/**
 * `express.json()` read an empty body as `{}`; Fastify's parser refuses it
 * outright. Clients that set the header on a body-less POST - logging out,
 * opening the demo, revoking a share - would get a 400 they never used to.
 * Dropping the header leaves the request with no body at all, which every one
 * of those handlers already copes with.
 */
const dropEmptyJsonBody = (request: FastifyRequest): void => {
  const contentType = request.headers['content-type'];

  if (contentType?.startsWith('application/json') && request.headers['content-length'] === '0') {
    delete request.headers['content-type'];
  }
};

/**
 * `hpp()` collapsed a repeated query parameter to its last value; Fastify hands
 * over an array, which every reader here would reject. A duplicated `?token=`
 * or `?share=` comes out of a client building its URL badly, not an attack, and
 * used to work.
 */
const collapseRepeatedQueryParameters = (request: FastifyRequest): void => {
  const query = request.query as Record<string, unknown> | undefined;
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value) && value.length > 0) {
      query[key] = value[value.length - 1];
    }
  }
};
