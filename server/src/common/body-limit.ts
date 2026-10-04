import { RouteConfig } from '@nestjs/platform-fastify';
import { FastifyInstance } from 'fastify';

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
 */
const CONFIG_KEY = 'bodyLimit';

export const BodyLimit = (bytes: number): MethodDecorator => RouteConfig({ [CONFIG_KEY]: bytes });

/**
 * Has to run before the routes are registered, which Nest does in `init()` -
 * and `listen()` is what calls that. A route registered earlier keeps the
 * default limit.
 */
export const applyRouteBodyLimits = (fastify: FastifyInstance): void => {
  fastify.addHook('onRoute', route => {
    const limit = (route.config as Record<string, unknown> | undefined)?.[CONFIG_KEY];
    if (typeof limit === 'number') route.bodyLimit = limit;
  });
};
