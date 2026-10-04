import { RouteConfig } from '@nestjs/platform-fastify';
import { FastifyInstance, FastifyRequest, onRequestHookHandler } from 'fastify';

/**
 * A body limit of one route's own, above the one every other route keeps.
 *
 * Fastify refuses a body over 1 MiB unless the route says otherwise, and that is
 * the right answer for nearly every route here: nothing a person sends the API
 * comes near it, and a larger limit everywhere is a larger buffer anybody can
 * make the server hold. The exception is a route that carries a file inside
 * JSON, where base64 makes the body a third larger than the file.
 *
 * Fastify reads the limit from the route's options, but Nest builds those
 * itself and passes on only `config`, `constraints` and `schema`. So the limit
 * travels in the route's config, and `applyRouteBodyLimits` moves it to where
 * Fastify reads it as each route is registered.
 *
 * A raised limit is for administrators only. Fastify reads and parses a body
 * before any of Nest's guards is asked, so the route's own guard would refuse a
 * stranger only once the server had held and parsed all of what they sent; the
 * administrator check is made first instead, before a byte of it is read.
 */
const CONFIG_KEY = 'bodyLimit';

export const BodyLimit = (bytes: number): MethodDecorator => RouteConfig({ [CONFIG_KEY]: bytes });

/**
 * Has to run before the routes are registered, which Nest does in `init()` -
 * and `listen()` is what calls that. A route registered earlier keeps the
 * default limit. `admit` throws for a caller who may not send that much, and
 * what it throws is the answer.
 */
export const applyRouteBodyLimits = (fastify: FastifyInstance, admit: (request: FastifyRequest) => Promise<unknown>): void => {
  fastify.addHook('onRoute', route => {
    const limit = (route.config as Record<string, unknown> | undefined)?.[CONFIG_KEY];
    if (typeof limit !== 'number') return;

    route.bodyLimit = limit;
    const first: onRequestHookHandler = async request => void (await admit(request));
    route.onRequest = [...[route.onRequest ?? []].flat(), first];
  });
};
