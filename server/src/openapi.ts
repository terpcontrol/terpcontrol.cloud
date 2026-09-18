import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import v1Schemas from '@fg2/shared-types/openapi-schemas.json';
import { appConfig } from './config/configuration';

/**
 * Spread into the `@ApiOperation` of a route that needs no token: the document
 * asks for the bearer everywhere, and an operation that does not say otherwise
 * inherits it. Signing in, registering a device and downloading a firmware
 * image would then be documented as impossible without one.
 */
export const PUBLIC_OPERATION = { security: [] };

/**
 * The shapes of the `/v1` contract, generated from the zod schemas in
 * shared-types and registered here once. Every `/v1` route references one by
 * name (see `modules/v1/answer-shape.ts`), so what the document says a route
 * answers is the contract itself rather than a description kept beside it.
 */
export const V1_SCHEMAS: Record<string, object> = v1Schemas;

/**
 * How the operations are grouped, in the order a reader wants them: how to get
 * in, then what the screens are built from, then what an operator does, and last
 * the two surfaces that are not the app at all.
 */
const TAGS: readonly { name: string; description: string }[] = [
  { name: 'sessions', description: 'Signing in, renewing, listing and revoking a session.' },
  { name: 'account', description: 'The account this session belongs to, and the recovery links that lead back into one.' },
  { name: 'devices', description: 'Claiming a device, what it is, what it measures and what it is told to do.' },
  { name: 'cameras', description: 'The cameras of a tent, and the stills and films of one camera.' },
  { name: 'media', description: 'One picture or film: what is known about it, and its bytes.' },
  { name: 'alarms', description: 'The rules that watch a device, and the alerts they open.' },
  { name: 'admin', description: 'Accounts, the fleet and the builds it runs. Every route here needs an administrator.' },
  {
    name: 'device-protocol',
    description: 'What firmware in the field calls. Frozen: paths, bodies and status codes are what deployed devices expect.',
  },
  { name: 'service', description: 'The liveness and readiness probes a load balancer reads.' },
];

/**
 * The API description, built from the controllers themselves rather than from
 * comments kept alongside them, so it cannot drift from what the server serves.
 */
export const setupOpenApi = (app: NestFastifyApplication): void => {
  const { apiUrlExternal } = app.get(appConfig.KEY);

  const builder = new DocumentBuilder()
    .setTitle('Terp Control API')
    .setVersion('1.0.0')
    .setDescription(
      'The Terp Control cloud server. Everything an app calls is under `/v1`; the `device-protocol` routes sit beside it ' +
        'because the base URL is compiled into firmware that has already shipped. Errors are `application/problem+json`.',
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The user token from `POST /v1/sessions`.' }, 'bearerAuth')
    .addCookieAuth('Authorization', { type: 'apiKey', description: 'The session cookie the browser gets from `POST /v1/sessions`.' })
    .addSecurityRequirements('bearerAuth');

  for (const tag of TAGS) builder.addTag(tag.name, tag.description);

  if (apiUrlExternal) {
    builder.addServer(apiUrlExternal, 'Current server');
  }

  const document = SwaggerModule.createDocument(app, builder.build());

  // The contract's own shapes, so a route can name one instead of carrying a
  // copy of it. Nest reads response schemas off runtime metadata, and a shared
  // TypeScript interface leaves none, which is why they are registered here.
  document.components = { ...document.components, schemas: { ...V1_SCHEMAS, ...document.components?.schemas } };

  // The router ignores a trailing slash, so `/api-docs/` reaches the same
  // handler - but the page links its assets relative to the URL it was fetched
  // from, and from `/api-docs/` those resolve one level too deep and 404. The
  // page comes back blank, so the slash is sent to the form that works.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      // Compared the way the router matches: it ignores case and a trailing
      // slash, so `/API-docs/?foo` reaches the page too and needs the same.
      const [path, query] = request.url.split('?');
      if (path.toLowerCase() === '/api-docs/') {
        void reply.redirect(query ? `/api-docs?${query}` : '/api-docs', 301);
        return;
      }
      done();
    });

  SwaggerModule.setup('api-docs', app, document, { jsonDocumentUrl: 'swagger.json', explorer: true });
};
