import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { anonymous, ApiClient, context, createAccount, loginAsAdmin, Method, Session, unique } from '../support/api';
import { DeviceCredentials, provisionDevice, registerDevice } from '../support/device';

/**
 * The API document, and whether it tells the truth.
 *
 * The shapes come from the zod schemas in shared-types, generated into the
 * document's `components.schemas` and referenced by the routes. That makes every
 * annotated route a claim about what the server answers with, so the claims are
 * checked here against what it actually answers.
 *
 * A request body is a claim of the same kind, made by the schema the route
 * validates against. It is checked from both sides: a body the server takes has
 * to match what the document declares, or the document is stricter than the
 * route and a client is told its payload is wrong; a body the server refuses has
 * to fail it, or the document is looser and a client is told the wrong payload
 * will do.
 *
 * The document is fetched over HTTP like everything else in this suite; nothing
 * here imports the server's code or the schemas the document was built from, or
 * the check would be comparing a thing to itself.
 *
 * Each case validates rows this spec created. The database is shared by the
 * whole run, and the listings are global: validating whatever else happens to be
 * in them makes the result depend on which specs ran first, and on documents
 * written by a spec that was testing something else. What that leaves uncovered
 * is the shape of older rows - a field a schema calls required that a document
 * written long ago does not carry would pass here and still be a wrong claim.
 */

interface Content {
  content?: Record<string, { schema?: unknown }>;
}

interface Operation {
  responses?: Record<string, Content>;
  requestBody?: Content;
}

interface OpenApiDocument {
  components?: { schemas?: Record<string, object> };
  paths: Record<string, Record<string, Operation>>;
}

let document: OpenApiDocument;
let ajv: Ajv;
let owner: Session;
let admin: Session;
let device: DeviceCredentials;

/** What the bodies below need to name something that exists: see `beforeAll`. */
let fridgeClassId: string;
let spareUserId: string;
let diaryEntryId: string;
let unclaimedCode: string;

/** The response schema a route documents, or undefined where it documents none. */
const declaredSchema = (path: string, method = 'get'): unknown =>
  document.paths[path]?.[method]?.responses?.['200']?.content?.['application/json']?.schema;

/** The request body a route documents, or undefined where it documents none. */
const declaredBody = (path: string, method = 'post'): unknown => document.paths[path]?.[method]?.requestBody?.content?.['application/json']?.schema;

const itemSchema = (schema: unknown): unknown => (schema as { items?: unknown }).items ?? schema;

const compile = (schema: unknown): ValidateFunction => ajv.compile({ ...(schema as object), components: document.components } as object);

const expectMatches = (schema: unknown, body: unknown, what: string) => {
  const validate = compile(schema);
  if (!validate(body)) {
    throw new Error(`${what} does not match the schema the document declares: ${ajv.errorsText(validate.errors)}`);
  }
};

const expectRefuses = (schema: unknown, body: unknown, what: string) => {
  if (compile(schema)(body)) {
    throw new Error(`${what} matches the schema the document declares, so the document is looser than the route`);
  }
};

/** Sample payloads the cases below build on, and the fixtures in `beforeAll`. */
const anAlarm = { name: 'Too hot', sensorType: 'temperature', upperThreshold: 30, lowerThreshold: null, actionType: 'info', actionTarget: '' };

const aDiaryEntry = { title: 'openapi note', message: 'written by the document spec', severity: 0, categories: ['note'] };

beforeAll(async () => {
  const response = await anonymous().get('/swagger.json').expect(200);
  document = response.body as OpenApiDocument;

  ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  owner = await createAccount('openapi-owner');
  admin = await loginAsAdmin();
  device = await provisionDevice(owner);

  // A body that has to name a row names one this spec made, or one the stack is
  // seeded with; nothing here depends on what another spec left behind.
  fridgeClassId = (await admin.client.get('/device/class/find/fridge').expect(200)).body.class_id;

  const spare = await admin.client
    .post('/users')
    .send({ username: `${unique('openapi-spare')}@test.invalid`, password: 'Passw0rd!test', is_admin: false })
    .expect(201);
  spareUserId = spare.body.data._id;

  await owner.client
    .post(`/device/logs/${device.deviceId}`)
    .send({ ...aDiaryEntry, time: Date.now() })
    .expect(200);
  diaryEntryId = (await owner.client.get(`/device/logs/${device.deviceId}`).expect(200)).body[0]._id;

  const unclaimed = await registerDevice();
  unclaimedCode = (await anonymous().post('/device/claimcode').send({ device_id: unclaimed.deviceId }).expect(200)).body.claim_code;
});

describe('the document', () => {
  it('carries the shared shapes as components', () => {
    const schemas = Object.keys(document.components?.schemas ?? {});
    expect(schemas).toContain('Device');
    expect(schemas).toContain('DeviceLog');
    expect(schemas).toContain('CloudSettings');
    expect(schemas.length).toBeGreaterThan(20);
  });

  it('leaves no reference dangling', () => {
    const names = Object.keys(document.components?.schemas ?? {});
    const referenced = [...new Set(JSON.stringify(document).match(/#\/components\/schemas\/[A-Za-z0-9_]+/g) ?? [])];
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.map(ref => ref.split('/').pop()).filter(name => !names.includes(name as string))).toEqual([]);
  });

  it('names the shape each annotated route answers with', () => {
    // The owner's own listing is a projection, so it names the narrower shape;
    // the admin listing answers the whole document.
    expect(declaredSchema('/device')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/DeviceListEntry' } });
    expect(declaredSchema('/device/all')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Device' } });
    expect(declaredSchema('/device/class')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/DeviceClass' } });
    expect(declaredSchema('/users')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/UserAccount' } });
    expect(declaredSchema('/device/firmware')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/FirmwareListEntry' } });
  });

  it('describes the body each validated route accepts', () => {
    // A schema that refuses an unknown property says so. The generated response
    // shapes drop that, because an answer may carry more than it names; a
    // request body is the direction the server closes.
    expect(declaredBody('/signup')).toEqual({
      type: 'object',
      properties: { username: { type: 'string' }, password: { type: 'string' } },
      required: ['username', 'password'],
      additionalProperties: false,
    });

    // The body as it arrives, not as the handler receives it: the route turns a
    // missing duration into 0, which would make this a plain required number.
    expect(declaredBody('/device/maintenancemode')).toMatchObject({
      properties: { duration_minutes: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] } },
      required: ['device_id'],
    });

    // An alarm is shared-types' shape rather than "an object", so the fields a
    // client has to get right are in the document.
    const alarms = (declaredBody('/device/alarms') as { properties: { alarms: { items: { properties: object; required: string[] } } } }).properties
      .alarms;
    expect(Object.keys(alarms.items.properties)).toEqual(expect.arrayContaining(['alarmId', 'sensorType', 'upperThreshold', 'webhookHeaders']));
    // The id is the server's to assign, so a new alarm arrives without one.
    expect(alarms.items.required).not.toContain('alarmId');
  });
});

describe('what the routes actually answer', () => {
  it("matches the declared shape for the caller's own devices", async () => {
    // This account was made by this spec, so every row in the listing is its own.
    const response = await owner.client.get('/device').expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    expectMatches(declaredSchema('/device'), response.body, 'GET /device');
  });

  it('matches the declared shape for a device in the admin listing', async () => {
    const response = await admin.client.get('/device/all').expect(200);
    const mine = response.body.find((entry: { device_id: string }) => entry.device_id === device.deviceId);

    expect(mine).toBeDefined();
    expectMatches(itemSchema(declaredSchema('/device/all')), mine, 'GET /device/all');
  });

  it('matches the declared shape for this account in the account listing', async () => {
    const response = await admin.client.get('/users').expect(200);
    const mine = response.body.find((entry: { username: string }) => entry.username === owner.username);

    expect(mine).toBeDefined();
    expectMatches(itemSchema(declaredSchema('/users')), mine, 'GET /users');
  });

  it('matches the declared shape for a firmware it just created', async () => {
    const version = unique('openapi-v');
    const created = await admin.client.post('/device/firmware').send({ name: 'fridge', version }).expect(200);

    const response = await admin.client.get('/device/firmware').expect(200);
    const mine = response.body.find((entry: { firmware_id: string }) => entry.firmware_id === created.body.firmware_id);

    expect(mine).toBeDefined();
    expectMatches(itemSchema(declaredSchema('/device/firmware')), mine, 'GET /device/firmware');
  });

  it('matches the declared shape for a device class', async () => {
    const response = await admin.client.get('/device/class').expect(200);
    const fridge = response.body.find((entry: { name: string }) => entry.name === 'fridge');

    expect(fridge).toBeDefined();
    expectMatches(itemSchema(declaredSchema('/device/class')), fridge, 'GET /device/class');
  });
});

/**
 * One case per body schema the server validates against - a route that shares
 * another's schema shares its body, and is covered with it. Each case names a
 * payload the route takes and one it refuses, and both are sent: a document that
 * agrees with a validator nobody runs proves nothing.
 *
 * "Refused" has to mean refused for the shape, which is all a JSON Schema can
 * describe. A rule a zod schema carries that JSON Schema cannot express - the
 * diary's "a title or a message", a claim code that names no device - is refused
 * by the route and accepted by the document, so the refused payloads here are
 * wrong in a way the document can state. For the same reason a payload the route
 * takes is only asked not to be a 400: a route may still turn down what a
 * well-formed body asks for, and that is not the document's claim.
 */
interface BodyCase {
  /** How the case reads in the run. */
  what: string;
  /** The path as the document names it, with its parameters unfilled. */
  path: string;
  /** The URL to send to, once the spec has made the device and the accounts. */
  url: () => string;
  method?: Method;
  /** A fresh client where the route is public: signup and login budget per address. */
  client: () => ApiClient;
  accepted: () => unknown;
  refused: () => unknown;
}

const bodyCases = (): BodyCase[] => [
  {
    what: 'POST /signup',
    path: '/signup',
    url: () => '/signup',
    client: anonymous,
    accepted: () => ({ username: `${unique('openapi-signup')}@test.invalid`, password: 'Passw0rd!test' }),
    // A closed body: a field the schema does not name is a mistake, not an extra.
    refused: () => ({ username: `${unique('openapi-signup')}@test.invalid`, password: 'Passw0rd!test', is_admin: true }),
  },
  {
    what: 'POST /login',
    path: '/login',
    url: () => '/login',
    client: anonymous,
    accepted: () => ({ username: owner.username, password: owner.password, stayLoggedIn: false }),
    refused: () => ({ username: owner.username }),
  },
  {
    what: 'POST /users',
    path: '/users',
    url: () => '/users',
    client: () => admin.client,
    accepted: () => ({ username: `${unique('openapi-user')}@test.invalid`, password: 'Passw0rd!test', is_admin: false }),
    refused: () => ({ username: `${unique('openapi-user')}@test.invalid`, password: 'Passw0rd!test' }),
  },
  {
    what: 'POST /chartpresets',
    path: '/chartpresets',
    url: () => '/chartpresets',
    client: () => owner.client,
    accepted: () => ({ name: 'openapi preset', query: 'measures=temperature&timespan=day' }),
    refused: () => ({ name: 'openapi preset' }),
  },
  {
    what: 'POST /share',
    path: '/share',
    url: () => '/share',
    client: () => owner.client,
    accepted: () => ({ device_id: device.deviceId, page: 'charts', expires_at: null }),
    refused: () => ({ device_id: device.deviceId, page: 'somewhere-else' }),
  },
  {
    what: 'POST /device/claimcode',
    path: '/device/claimcode',
    url: () => '/device/claimcode',
    client: anonymous,
    // Deliberately open: firmware has sent fields this does not know before now.
    accepted: () => ({ device_id: device.deviceId, password: null, firmware_version: '1.2.3' }),
    refused: () => ({ device_id: '' }),
  },
  {
    what: 'POST /device/alarms',
    path: '/device/alarms',
    url: () => '/device/alarms',
    client: () => owner.client,
    accepted: () => ({ device_id: device.deviceId, alarms: [anAlarm] }),
    // An alarm is a shape now, so a channel the server cannot act on is refused.
    refused: () => ({ device_id: device.deviceId, alarms: [{ ...anAlarm, actionType: 'carrier-pigeon' }] }),
  },
  {
    what: 'POST /device/maintenancemode',
    path: '/device/maintenancemode',
    url: () => '/device/maintenancemode',
    client: () => owner.client,
    accepted: () => ({ device_id: device.deviceId, duration_minutes: null }),
    refused: () => ({ device_id: device.deviceId, duration_minutes: -1 }),
  },
  {
    what: 'POST /device/test/{device_id}',
    path: '/device/test/{device_id}',
    url: () => `/device/test/${device.deviceId}`,
    client: () => owner.client,
    accepted: () => ({ heater: 1, dehumidifier: 0, co2: 0, lights: 1, fanint: 0, fanext: 0, fanbw: 0 }),
    refused: () => ({ heater: 'on', dehumidifier: 0, co2: 0, lights: 1, fanint: 0, fanext: 0, fanbw: 0 }),
  },
  {
    what: 'POST /device/firmware',
    path: '/device/firmware',
    url: () => '/device/firmware',
    client: () => admin.client,
    accepted: () => ({ name: 'fridge', version: unique('openapi-fw') }),
    refused: () => ({ name: 'fridge' }),
  },
  {
    what: 'POST /device/recipes',
    path: '/device/recipes',
    url: () => '/device/recipes',
    client: () => owner.client,
    accepted: () => ({ name: 'openapi template', steps: [], public: false }),
    refused: () => ({ name: 42 }),
  },
  {
    what: 'POST /device/logs/{device_id}',
    path: '/device/logs/{device_id}',
    url: () => `/device/logs/${device.deviceId}`,
    client: () => owner.client,
    accepted: () => ({ ...aDiaryEntry, time: Date.now() }),
    // A time that names no moment; the entry is otherwise the accepted one.
    refused: () => ({ ...aDiaryEntry, time: {} }),
  },
  {
    what: 'POST /activate',
    path: '/activate',
    url: () => '/activate',
    client: anonymous,
    // A code no account carries is turned down as a conflict, not as a bad body.
    accepted: () => ({ activation_code: unique('openapi-code') }),
    refused: () => ({ activation_code: 1234 }),
  },
  {
    what: 'POST /reset',
    path: '/reset',
    url: () => '/reset',
    client: anonymous,
    accepted: () => ({ password: 'Passw0rd!test', token: unique('openapi-token') }),
    refused: () => ({ password: 'Passw0rd!test', token: unique('openapi-token'), username: 'someone' }),
  },
  {
    what: 'PUT /users/{id}',
    path: '/users/{id}',
    method: 'put',
    url: () => `/users/${spareUserId}`,
    client: () => admin.client,
    // An update carries only what it changes, so every field is optional.
    accepted: () => ({ is_admin: false }),
    refused: () => ({ is_admin: 'yes' }),
  },
  {
    what: 'POST /device/create',
    path: '/device/create',
    url: () => '/device/create',
    client: () => admin.client,
    accepted: () => ({ class_id: fridgeClassId, device_type: 'fridge' }),
    refused: () => ({ class_id: fridgeClassId, device_type: 'fridge', name: 'named on creation' }),
  },
  {
    what: 'POST /device/register',
    path: '/device/register',
    url: () => '/device/register',
    client: anonymous,
    accepted: () => ({
      registration_password: context.selfRegistrationPassword,
      device_id: unique('openapi-sim'),
      username: unique('openapi-device-user'),
      password: unique('openapi-device-pass'),
      device_type: 'fridge',
    }),
    refused: () => ({
      registration_password: context.selfRegistrationPassword,
      device_id: unique('openapi-sim'),
      username: unique('openapi-device-user'),
      password: unique('openapi-device-pass'),
    }),
  },
  {
    what: 'POST /device',
    path: '/device',
    url: () => '/device',
    client: () => owner.client,
    accepted: () => ({ claim_code: unclaimedCode }),
    refused: () => ({ claim_code: null }),
  },
  {
    what: 'POST /device/configure',
    path: '/device/configure',
    url: () => '/device/configure',
    client: () => owner.client,
    // The configuration is a JSON document the device owns, sent as a string.
    accepted: () => ({ device_id: device.deviceId, configuration: '{"day":{"temperature":24}}' }),
    refused: () => ({ device_id: device.deviceId, configuration: { day: { temperature: 24 } } }),
  },
  {
    what: 'POST /device/setname',
    path: '/device/setname',
    url: () => '/device/setname',
    client: () => owner.client,
    accepted: () => ({ device_id: device.deviceId, name: 'named by the document spec' }),
    refused: () => ({ device_id: device.deviceId, name: 'named by the document spec', nickname: 'and again' }),
  },
  {
    what: 'POST /device/cloudsettings',
    path: '/device/cloudsettings',
    url: () => '/device/cloudsettings',
    client: () => owner.client,
    accepted: () => ({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'stable' } }),
    refused: () => ({ device_id: device.deviceId, cloud_settings: 'stable' }),
  },
  {
    what: 'POST /device/class',
    path: '/device/class',
    url: () => '/device/class',
    client: () => admin.client,
    // A class with no pre-release build round-trips through the admin page as an
    // explicit null, which means the same as leaving the field out.
    accepted: () => ({
      name: unique('openapi-class'),
      description: 'A class the document spec made',
      firmware_id: '',
      concurrent: 5,
      maxfails: 10,
      beta_firmware_id: null,
    }),
    refused: () => ({
      name: unique('openapi-class'),
      description: 'A class the document spec made',
      firmware_id: '',
      concurrent: 'five',
      maxfails: 10,
    }),
  },
  {
    what: 'POST /device/recipe',
    path: '/device/recipe',
    url: () => '/device/recipe',
    client: () => owner.client,
    accepted: () => ({ device_id: device.deviceId, recipe: { steps: [], activeStepIndex: 0, activeSince: Date.now() } }),
    refused: () => ({ device_id: device.deviceId, recipe: { steps: 'none' } }),
  },
  {
    what: 'PUT /device/logs/{device_id}/{log_id}',
    path: '/device/logs/{device_id}/{log_id}',
    method: 'put',
    url: () => `/device/logs/${device.deviceId}/${diaryEntryId}`,
    client: () => owner.client,
    // An edit may leave the time alone, which is the one difference from adding.
    accepted: () => ({ ...aDiaryEntry, message: 'edited by the document spec' }),
    refused: () => ({ ...aDiaryEntry, categories: [] }),
  },
];

describe('what the routes actually accept', () => {
  it.each(bodyCases().map(bodyCase => [bodyCase.what, bodyCase] as const))('%s takes the body the document declares', async (what, bodyCase) => {
    const schema = declaredBody(bodyCase.path, bodyCase.method);
    expect(schema).toBeDefined();

    const send = (body: unknown) =>
      bodyCase
        .client()
        .request(bodyCase.method ?? 'post', bodyCase.url())
        .send(body as object);

    const accepted = bodyCase.accepted();
    expectMatches(schema, accepted, `the body ${what} accepts`);
    expect((await send(accepted)).status).not.toBe(400);

    const refused = bodyCase.refused();
    expectRefuses(schema, refused, `the body ${what} refuses`);
    await send(refused).expect(400);
  });
});
