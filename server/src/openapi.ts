import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  ResponseObject,
  SecurityRequirementObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import v1Schemas from '@fg2/shared-types/openapi-schemas.json';
import { appConfig } from './config/configuration';
import { V1_PREFIX } from './common/v1/problem.filter';

/**
 * Spread into the `@ApiOperation` of a route that needs no token: the document
 * asks for the bearer everywhere, and an operation that does not say otherwise
 * inherits it. Signing in, registering a device and downloading a firmware
 * image would then be documented as impossible without one.
 */
export const PUBLIC_OPERATION = { security: [] };

/**
 * Spread into the `@ApiOperation` of a read a share link reaches. Besides a
 * session it takes the link's token - in a header, or in the query where the
 * reader is an `<img>` that cannot set one - and for a public diary no
 * credential at all. Inheriting the bearer requirement documented all of
 * them as member-only, and a client generated from the document could not
 * read a shared diary or know that it may.
 */
const SHARED_READ: SecurityRequirementObject[] = [{ bearerAuth: [] }, { shareToken: [] }, { shareQuery: [] }, {}];
export const SHARED_READ_OPERATION: Pick<OperationObject, 'security'> = { security: SHARED_READ };

/** The same for a picture's own two routes, which also take the picture token a picture URL carries. */
export const PICTURE_READ_OPERATION: Pick<OperationObject, 'security'> = { security: [...SHARED_READ, { pictureToken: [] }] };

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
  { name: 'home', description: 'What the app opens on: one card per space, with everything the home screen shows.' },
  { name: 'spaces', description: 'The places a person grows in, the rooms that group them, and what stands in one.' },
  { name: 'grows', description: 'What is growing: its plants, the phases it has been through and where they stand.' },
  { name: 'diary', description: 'The timeline: what a person, a device and an alarm each wrote, as one list under one scope.' },
  { name: 'devices', description: 'Claiming a device, what it is, what it measures and what it is told to do.' },
  { name: 'plans', description: 'The grow plan a controller is run by, the moves a person makes in one, and the templates one is started from.' },
  { name: 'cameras', description: 'The cameras of a tent, and the stills and films of one camera.' },
  { name: 'media', description: 'One picture or film: what is known about it, and its bytes.' },
  { name: 'alarms', description: 'The rules that watch a device, and the alerts they open.' },
  { name: 'members', description: 'Who is in a space besides its owner, and the invite codes that let somebody become one.' },
  { name: 'sharing', description: 'The links a grower hands out, and the public diaries they follow.' },
  { name: 'public', description: 'What is readable without a session: a public diary, a public profile, and the card a link is drawn as.' },
  { name: 'admin', description: 'Accounts, the fleet and the builds it runs. Every route here needs an administrator.' },
  {
    name: 'device-protocol',
    description: 'What firmware in the field calls. Frozen: paths, bodies and status codes are what deployed devices expect.',
  },
  { name: 'service', description: 'The liveness and readiness probes a load balancer reads.' },
];

/**
 * The refusals, written once and referenced everywhere.
 *
 * Every refusal of `/v1` is one shape - RFC 7807, `application/problem+json`,
 * with a `code` that `problem.ts` calls the caller's to choose and a client's to
 * branch on. The document said that once, in a sentence in its own description,
 * and then declared not a single refusal on any of its operations: a reader
 * generating a client from it got routes that cannot fail, and no type to catch
 * what comes back when they do.
 *
 * Four responses rather than four hundred copies, so that what a status means
 * here is said in one place - which is the same reason a route names a contract
 * schema instead of spelling one out.
 */
const refusal = (description: string): ResponseObject => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});

const REFUSALS: Record<string, ResponseObject> = {
  Problem: refusal(
    'A refusal. `code` is the stable name to branch on, `detail` is a sentence for a person, and `errors` names the fields of a body or a query that were wrong.',
  ),
  BadRequest: refusal(
    'The body or the query is not what this route accepts. `validation_failed` with the offending fields in `errors`, unless the route names a reason of its own.',
  ),
  Unauthenticated: refusal('No credential, or one this route does not take. The bearer is the user token from `POST /v1/sessions`.'),
  NotFound: refusal(
    'There is nothing with that id, or nothing this caller may see: a refusal that said "that one exists but not like this" would tell a stranger there was something there.',
  ),
};

const refers = (name: string): ReferenceObject => ({ $ref: `#/components/responses/${name}` });

/** Only `/v1` answers problem documents; the routes beside it answer the shape the Angular app has always read. */
const isV1 = (path: string): boolean => path === V1_PREFIX || path.startsWith(`${V1_PREFIX}/`);

/**
 * Which refusals an operation declares, read off the operation itself rather
 * than off a list kept beside the controllers.
 *
 * A list would be wrong within a release, and it could not be right to begin
 * with: a `ProblemException` is thrown in the service layer, so a controller
 * does not know which codes its route reaches. What the document can state
 * truthfully is what the shape of the operation already implies - a credential
 * that can be missing, an id that can name nothing, a body or a query that can
 * fail to parse - and `default` for everything else, which is where a rate
 * limit, a conflict and an unprocessable request come back.
 */
const declareRefusals = (document: OpenAPIObject): void => {
  document.components = { ...document.components, responses: { ...REFUSALS, ...document.components?.responses } };

  for (const [path, item] of Object.entries(document.paths)) {
    if (!isV1(path)) continue;

    const byName = /\{[^}]+\}/.test(path);
    for (const operation of Object.values(item) as OperationObject[]) {
      if (typeof operation !== 'object' || operation === null || !('responses' in operation)) continue;

      const validated =
        operation.requestBody !== undefined ||
        (operation.parameters ?? []).some(parameter => 'in' in parameter && parameter.in === 'query' && parameter.schema !== undefined);

      // An operation without `security` of its own inherits the document's
      // bearer requirement; `PUBLIC_OPERATION` is the empty list that opts out,
      // and a read that also takes no credential at all - a public diary's -
      // answers a caller without one rather than refusing them for it.
      const secured =
        operation.security === undefined ||
        (operation.security.length > 0 && !operation.security.some(requirement => Object.keys(requirement).length === 0));

      const answers = operation.responses;
      if (validated) answers['400'] ??= refers('BadRequest');
      if (secured) answers['401'] ??= refers('Unauthenticated');
      // A list filter that names something is refused exactly as a path that
      // names it is, when it is nothing this caller may see.
      const filtersByName = (operation.parameters ?? []).some(
        parameter => 'in' in parameter && parameter.in === 'query' && parameter.name.endsWith('Id'),
      );
      if (byName || filtersByName) answers['404'] ??= refers('NotFound');
      answers.default ??= refers('Problem');
    }
  }
};

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
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Share-Token',
        description: 'The token of a share link (`ShareLink.token`). Opens the reads the link reaches, clamped to its window.',
      },
      'shareToken',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'query',
        name: 'share',
        description: 'The same share-link token in the query string, for a reader that cannot set a header.',
      },
      'shareQuery',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'query',
        name: 'token',
        description:
          'The picture token (`imageToken` from `POST /v1/sessions`), for an `<img>` that cannot set a header. It opens `GET /v1/media/{id}` and its content and nothing else.',
      },
      'pictureToken',
    )
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

  // And what each of them answers when it refuses, which until now no operation
  // said anything about at all.
  declareRefusals(document);

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
