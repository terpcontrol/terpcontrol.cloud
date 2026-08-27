import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyRequest } from 'fastify';

/**
 * Two things Express did for us that Fastify does not, and that clients in the
 * field depend on.
 */
export const registerHttpCompatibility = (app: NestFastifyApplication): void => {
  registerTolerantJsonParser(app);

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request: FastifyRequest, _reply, done) => {
      collapseRepeatedQueryParameters(request);
      done();
    });
};

/**
 * `express.json()` read an empty body as `{}`; Fastify's parser refuses it
 * outright. Clients that set the header on a body-less POST - logging out,
 * opening the demo, revoking a share - would get a 400 they never used to,
 * however the request framed that empty body.
 *
 * Registering it here also stops Nest installing its own, and anything that is
 * not empty still goes through Fastify's parser, which is what guards against
 * prototype poisoning.
 */
type BufferParser = (request: unknown, body: Buffer, done: (error: Error | null, value?: unknown) => void) => void;

const registerTolerantJsonParser = (app: NestFastifyApplication): void => {
  const fastify = app.getHttpAdapter().getInstance();
  // Typed for the default HTTP server and a string body; Nest hands it a
  // request type that also allows HTTP/2, which this deployment never serves,
  // and a buffer, which the parser reads as text either way.
  const parseJson = fastify.getDefaultJsonParser('error', 'error') as unknown as BufferParser;

  app.useBodyParser('application/json', { bodyLimit: fastify.initialConfig.bodyLimit }, (request, body: Buffer, done) => {
    if (body.length === 0 || body.toString().trim() === '') {
      done(null, {});
      return;
    }

    parseJson(request, body, done);
  });
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
