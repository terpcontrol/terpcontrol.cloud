import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import supertest from 'supertest';
import { anonymous, ApiClient, context, createAccount, loginAsAdmin, Method, Session, unique } from '../support/api';
import { claimCodeOf, DeviceCredentials, provisionDevice, registerDevice } from '../support/device';

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
 *
 * Two cases walk the document instead of the server: every operation has to
 * declare what it answers, so a route added without saying so fails here rather
 * than quietly going undocumented.
 */

const METHODS: Method[] = ['get', 'post', 'put', 'patch', 'delete', 'options'];

interface Content {
  content?: Record<string, { schema?: unknown }>;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
  description?: string;
}

interface Operation {
  responses?: Record<string, Content & { $ref?: string; description?: string }>;
  requestBody?: Content;
  parameters?: Parameter[];
  security?: unknown[];
}

interface OpenApiDocument {
  components?: { schemas?: Record<string, object>; responses?: Record<string, Content & { description?: string }> };
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
let alarmRuleId: string;
let cameraId: string;
let unclaimedCode: string;

/** The response schema a route documents for one status code, or undefined. */
const declaredSchema = (path: string, method: Method = 'get', status = 200, contentType = 'application/json'): unknown =>
  document.paths[path]?.[method]?.responses?.[String(status)]?.content?.[contentType]?.schema;

/**
 * What a route says it refuses with, followed through the shared response it
 * names: the refusals are declared once in `components.responses` and referred
 * to, so a reader of one operation still has to arrive at a problem document.
 */
const declaredRefusal = (path: string, method: Method, status: string): { description?: string; schema: unknown } | undefined => {
  const declared = document.paths[path]?.[method]?.responses?.[status];
  if (!declared) return undefined;

  const named = declared.$ref?.split('/').pop();
  const response = named ? document.components?.responses?.[named] : declared;

  return { description: response?.description, schema: response?.content?.['application/problem+json']?.schema };
};

/** The request body a route documents, or undefined where it documents none. */
const declaredBody = (path: string, method = 'post'): unknown => document.paths[path]?.[method]?.requestBody?.content?.['application/json']?.schema;

/** The query parameters a route documents, by name. */
const declaredQuery = (path: string, method: Method = 'get'): Record<string, Parameter> =>
  Object.fromEntries(
    (document.paths[path]?.[method]?.parameters ?? []).filter(parameter => parameter.in === 'query').map(parameter => [parameter.name, parameter]),
  );

/**
 * The shape of one row of a listing. A list answers a page the document names,
 * so this follows the reference into `components` and takes the item shape out
 * of it.
 */
const itemSchema = (schema: unknown): unknown => {
  const resolved = resolve(schema) as { items?: unknown; properties?: { items?: { items?: unknown } } };
  return resolved.properties?.items?.items ?? resolved.items ?? schema;
};

const resolve = (schema: unknown): unknown => {
  const ref = (schema as { $ref?: string }).$ref;
  if (!ref) return schema;

  const name = ref.split('/').pop() as string;
  return document.components?.schemas?.[name] ?? schema;
};

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

/**
 * What the document declares for a route under the status the answer actually
 * came back with. A shape documented for a status the route never sends
 * describes nothing, and reading the status off the answer is what catches it.
 */
const declaredFor = (response: supertest.Response, path: string, method: Method): { schema: unknown; what: string } => {
  const what = `${method.toUpperCase()} ${path} (${response.status})`;
  const schema = declaredSchema(path, method, response.status);
  if (schema === undefined) {
    throw new Error(`${what} answered a body the document declares no schema for`);
  }
  return { schema, what };
};

/** Checks a whole answer against the shape the document declares for it. */
const expectDocumented = (response: supertest.Response, path: string, method: Method = 'get'): void => {
  const { schema, what } = declaredFor(response, path, method);
  expectMatches(schema, response.body, what);
};

/** The same, for one row a spec picked out of a listing it shares with others. */
const expectRowDocumented = (response: supertest.Response, path: string, row: unknown, method: Method = 'get'): void => {
  const { schema, what } = declaredFor(response, path, method);
  expect(row).toBeDefined();
  expectMatches(itemSchema(schema), row, what);
};

/** An account this spec owns, so deleting or renaming it disturbs nobody. */
const createAccountAsAdmin = (): Promise<supertest.Response> =>
  admin.client
    .post('/v1/admin/users')
    .send({ email: `${unique('openapi-account')}@test.invalid`, handle: unique('openapi'), password: 'Passw0rd!test' })
    .expect(201);

const anAlarmRule = {
  name: 'Too hot',
  watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
  forSeconds: 60,
  severity: 'warning',
  enabled: true,
  cooldownSeconds: 600,
  repeatSeconds: 0,
  delivery: { mode: 'routing', custom: null },
};

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
  const classes = await admin.client.get('/v1/admin/device-classes').expect(200);
  fridgeClassId = classes.body.items.find((entry: { name: string }) => entry.name === 'fridge').id;

  spareUserId = (await createAccountAsAdmin()).body.id;

  const rule = await owner.client.post(`/v1/devices/${device.deviceId}/alarm-rules`).send(anAlarmRule).expect(201);
  alarmRuleId = rule.body.id;

  const camera = await owner.client
    .post('/v1/cameras')
    .send({ kind: 'rtsp', deviceId: device.deviceId, name: 'openapi', url: 'rtsp://127.0.0.1:1/openapi' })
    .expect(201);
  cameraId = camera.body.id;

  unclaimedCode = await claimCodeOf((await registerDevice()).deviceId);
});

describe('the document', () => {
  it('carries the /v1 contract as components', () => {
    const schemas = Object.keys(document.components?.schemas ?? {});

    expect(schemas).toContain('Device');
    expect(schemas).toContain('Camera');
    expect(schemas).toContain('Problem');
    expect(schemas).toContain('DevicePage');
    expect(schemas.length).toBeGreaterThan(100);
  });

  it('leaves no reference dangling', () => {
    const names = Object.keys(document.components?.schemas ?? {});
    const referenced = [...new Set(JSON.stringify(document).match(/#\/components\/schemas\/[A-Za-z0-9_]+/g) ?? [])];
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.map(ref => ref.split('/').pop()).filter(name => !names.includes(name as string))).toEqual([]);
  });

  it('names the shape each route answers by referring to the contract', () => {
    // A reference rather than a copy: the same object spelled out at twenty
    // routes is twenty places for it to stop being the contract.
    expect(declaredSchema('/v1/devices')).toEqual({ $ref: '#/components/schemas/DevicePage' });
    expect(declaredSchema('/v1/devices/{id}')).toEqual({ $ref: '#/components/schemas/Device' });
    expect(declaredSchema('/v1/cameras')).toEqual({ $ref: '#/components/schemas/CameraPage' });
    expect(declaredSchema('/v1/alerts')).toEqual({ $ref: '#/components/schemas/AlertPage' });
    expect(declaredSchema('/v1/admin/fleet')).toEqual({ $ref: '#/components/schemas/Fleet' });
    expect(declaredSchema('/v1/admin/stats')).toEqual({ $ref: '#/components/schemas/AdminStats' });
    expect(declaredSchema('/v1/me')).toEqual({ $ref: '#/components/schemas/Me' });
  });

  it('groups every operation under a tag the document explains', () => {
    const explained = new Set(((document as unknown as { tags?: { name: string }[] }).tags ?? []).map(tag => tag.name));
    expect(explained.size).toBeGreaterThan(0);

    const ungrouped: string[] = [];
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations).filter(key => METHODS.includes(key as Method))) {
        const tags = (operations[method] as { tags?: string[] }).tags ?? [];
        if (!tags.some(tag => explained.has(tag))) ungrouped.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(ungrouped).toEqual([]);
  });

  it('leaves no operation without an answer', () => {
    // What this file is for: an operation that says nothing about what it
    // answers tells a reader nothing, and there is no route left that has an
    // excuse for it. A shape where the route sends a body, and a sentence where
    // it deliberately sends none - Nest fills in a 200 with an empty
    // description for a route that said neither, which is what this catches.
    const unsaid: string[] = [];

    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations).filter(key => METHODS.includes(key as Method))) {
        const answers = Object.entries(operations[method].responses ?? {}).filter(([status]) => status.startsWith('2'));
        const said = answers.some(([, answer]) => Object.keys(answer.content ?? {}).length > 0 || !!(answer as { description?: string }).description);
        if (!said) unsaid.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(unsaid).toEqual([]);
  });

  it('declares each shape under the status its route answers with', () => {
    // A route that answers 201 and documents a 200 describes an answer nobody
    // ever gets; declaring a shape at all replaces the status Nest would have
    // filled in on its own, so the status has to be said out loud.
    expect(declaredSchema('/v1/devices/claims', 'post', 200)).toBeUndefined();
    expect(declaredSchema('/v1/devices/claims', 'post', 201)).toEqual({ $ref: '#/components/schemas/DeviceClaimResult' });

    // A command is accepted rather than done: MQTT hands back no receipt.
    expect(declaredSchema('/v1/devices/{id}/commands', 'post', 202)).toEqual({ $ref: '#/components/schemas/DeviceCommandResult' });
  });

  it('describes the body each validated route accepts', () => {
    // The fields, and which of them a client has to get right. `/v1` bodies
    // strip what they do not name rather than refusing it, so the document does
    // not close them either.
    expect(declaredBody('/v1/sessions')).toMatchObject({
      properties: { email: { type: 'string' }, password: { type: 'string' } },
      required: ['email', 'password'],
    });

    // A command is a union of the things a device understands, so the document
    // says which they are rather than "an object".
    const kinds = (declaredBody('/v1/devices/{id}/commands') as { oneOf: { properties: { kind: { const: string } } }[] }).oneOf.map(
      member => member.properties.kind.const,
    );
    expect(kinds).toEqual(expect.arrayContaining(['reboot', 'maintenance', 'test', 'socket_override', 'socket_set']));
  });

  it('describes the query each validated route accepts', () => {
    // A series cannot be asked for without naming the window, so a document that
    // omits it describes a route nobody can call. The metrics are another
    // matter: a caller after what an output did - the level a dimmable light
    // runs at - names none, and the document says so rather than demanding a
    // reading it would throw away.
    const series = declaredQuery('/v1/devices/{id}/series');
    expect(Object.keys(series).sort()).toEqual(['endsAt', 'metrics', 'outputs', 'startsAt', 'stepSeconds']);
    expect(series.metrics?.required).toBe(false);
    expect(series.startsAt?.required).toBe(true);
    expect(series.endsAt?.required).toBe(true);
    expect(series.stepSeconds?.required).toBe(false);

    // What every list takes, stated once and therefore documented everywhere.
    expect(Object.keys(declaredQuery('/v1/devices')).sort()).toEqual(['cursor', 'limit', 'spaceId']);
    expect(Object.keys(declaredQuery('/v1/alerts'))).toEqual(expect.arrayContaining(['cursor', 'limit']));
  });

  it('states the page size it actually serves, which is the one bound it used to keep to itself', async () => {
    // The document offered `maximum: 9007199254740991` - what zod emits for any
    // integer - while the server answered 200 and said nothing about it.
    const limit = declaredQuery('/v1/entries').limit;
    expect(limit.description).toMatch(/200/);

    // And the figure in that sentence is the figure the route keeps to.
    const cap = Number((limit.description as string).match(/\b(\d+)\b/)?.[1]);
    for (const asked of [cap + 1, cap * 5]) {
      const page = await owner.client.get(`/v1/entries?deviceId=${device.deviceId}&limit=${asked}`).expect(200);
      expect(page.body.items.length).toBeLessThanOrEqual(cap);
    }
  });

  it('leaves no /v1 operation without a refusal', () => {
    // A contract that describes only the happy path is a contract nobody can
    // write a client against: the refusal is half of what a caller has to
    // handle, and every one of them here is a problem document.
    const cannotFail: string[] = [];

    for (const [path, operations] of Object.entries(document.paths)) {
      if (path !== '/v1' && !path.startsWith('/v1/')) continue;

      for (const method of Object.keys(operations).filter(key => METHODS.includes(key as Method))) {
        const refusal = declaredRefusal(path, method as Method, 'default');
        if (!refusal?.schema) cannotFail.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(cannotFail).toEqual([]);
    expect(declaredRefusal('/v1/devices', 'get', 'default')?.schema).toEqual({ $ref: '#/components/schemas/Problem' });
  });

  it('names the refusals the shape of an operation already implies', () => {
    // An id that can name nothing, a credential that can be missing, a query
    // that can fail to parse. Each is read off the operation, so a route added
    // tomorrow carries them without anybody remembering to say so.
    expect(declaredRefusal('/v1/devices/{id}', 'get', '404')?.schema).toEqual({ $ref: '#/components/schemas/Problem' });
    expect(declaredRefusal('/v1/devices/{id}', 'get', '401')?.schema).toEqual({ $ref: '#/components/schemas/Problem' });
    expect(declaredRefusal('/v1/entries', 'get', '400')?.schema).toEqual({ $ref: '#/components/schemas/Problem' });

    // A route that asks for no credential does not claim it can refuse one, and
    // a route with nothing to look up does not claim it can fail to find it.
    expect(declaredRefusal('/v1/sessions', 'post', '401')).toBeUndefined();
    expect(declaredRefusal('/v1/devices', 'get', '404')).toBeUndefined();

    // The routes beside `/v1` answer the other half's shape and are left alone.
    expect(document.paths['/readyz']?.get?.responses?.default).toBeUndefined();
  });

  it('refuses in the shape it declares it refuses in', async () => {
    const problem = declaredRefusal('/v1/devices/{id}', 'get', '404')?.schema;
    expect(problem).toBeDefined();

    const unauthenticated = await anonymous().get('/v1/devices').expect(401);
    expect(unauthenticated.headers['content-type']).toMatch('application/problem+json');
    expectMatches(problem, unauthenticated.body, 'the 401 a list answers without a token');

    const missing = await owner.client.get('/v1/devices/000000000000000000000000').expect(404);
    expectMatches(problem, missing.body, 'the 404 a by-id route answers');

    const invalid = await owner.client.get('/v1/entries?limit=0').expect(400);
    expectMatches(problem, invalid.body, 'the 400 a validated query answers');
    expect(invalid.body.code).toBe('validation_failed');
  });
});

describe('what the sessions and account routes answer', () => {
  const password = 'Passw0rd!test';

  it('matches the declared shapes for a sign-up, the session it leads to, and its renewal', async () => {
    // One client throughout: the routes are rate-limited per address, and every
    // client of this suite is given one of its own.
    const client = anonymous();
    const email = `${unique('openapi-signup')}@test.invalid`;

    const signup = await client
      .post('/v1/users')
      .send({ email, handle: unique('openapi'), password })
      .expect(201);
    expectDocumented(signup, '/v1/users', 'post');

    const session = await client.post('/v1/sessions').send({ email, password }).expect(201);
    expectDocumented(session, '/v1/sessions', 'post');

    const renewed = await client.post('/v1/sessions/refresh').send({ refreshToken: session.body.refreshToken.token }).expect(200);
    expectDocumented(renewed, '/v1/sessions/refresh', 'post');
  });

  it('matches the declared shape for a demo session', async () => {
    expectDocumented(await anonymous().post('/v1/sessions/demo').expect(201), '/v1/sessions/demo', 'post');
  });

  it('matches the declared shape for the session the automation token buys', async () => {
    const response = await anonymous().post('/v1/sessions/automation').send({ token: context.automationToken }).expect(200);

    expectDocumented(response, '/v1/sessions/automation', 'post');
  });

  it('matches the declared shapes for the sessions of an account, and for the account itself', async () => {
    const account = await createAccount('openapi-session');

    expectDocumented(await account.client.get('/v1/sessions').expect(200), '/v1/sessions');
    expectDocumented(await account.client.get('/v1/me').expect(200), '/v1/me');
    expectDocumented(await account.client.patch('/v1/me').send({ bio: 'written by the document spec' }).expect(200), '/v1/me', 'patch');
  });
});

describe('what the device routes answer', () => {
  it('matches the declared shapes for enrolling a device and claiming it', async () => {
    const enrolled = await anonymous()
      .post('/device/register')
      .send({
        registration_password: context.selfRegistrationPassword,
        device_id: unique('sim-fridge'),
        username: unique('device-user'),
        password: unique('device-pass'),
        device_type: 'fridge',
      })
      .expect(201);
    expectDocumented(enrolled, '/device/register', 'post');

    const spare = await registerDevice();
    const code = await anonymous().post('/device/claimcode').send({ device_id: spare.deviceId }).expect(200);
    expectDocumented(code, '/device/claimcode', 'post');

    const claimed = await owner.client.post('/v1/devices/claims').send({ code: code.body.claim_code }).expect(201);
    expectDocumented(claimed, '/v1/devices/claims', 'post');
  });

  it("matches the declared shape for the caller's own devices", async () => {
    // This account was made by this spec, so every row in the listing is its own.
    const response = await owner.client.get('/v1/devices').expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    expectDocumented(response, '/v1/devices');
  });

  it('matches the declared shapes for one device, read and changed', async () => {
    expectDocumented(await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200), '/v1/devices/{id}');

    const renamed = await owner.client.patch(`/v1/devices/${device.deviceId}`).send({ name: 'named by the document spec' }).expect(200);
    expectDocumented(renamed, '/v1/devices/{id}', 'patch');
  });

  it('matches the declared shapes for the configuration document, read and replaced', async () => {
    const configuration = { day: { temperature: 24 } };

    const written = await owner.client.put(`/v1/devices/${device.deviceId}/configuration`).send({ configuration }).expect(200);
    expectDocumented(written, '/v1/devices/{id}/configuration', 'put');

    const read = await owner.client.get(`/v1/devices/${device.deviceId}/configuration`).expect(200);
    expect(read.body.configuration).toEqual(configuration);
    expectDocumented(read, '/v1/devices/{id}/configuration');
  });

  it('matches the declared shape for a command it sent', async () => {
    const response = await owner.client.post(`/v1/devices/${device.deviceId}/commands`).send({ kind: 'reboot' }).expect(202);

    expectDocumented(response, '/v1/devices/{id}/commands', 'post');
  });

  it('matches the declared shapes for what a device measures and what it drives', async () => {
    expectDocumented(await owner.client.get(`/v1/devices/${device.deviceId}/live`).expect(200), '/v1/devices/{id}/live');
    expectDocumented(await owner.client.get(`/v1/devices/${device.deviceId}/sockets`).expect(200), '/v1/devices/{id}/sockets');
    expectDocumented(await owner.client.get(`/v1/devices/${device.deviceId}/firmwares`).expect(200), '/v1/devices/{id}/firmwares');

    const series = await owner.client
      .get(`/v1/devices/${device.deviceId}/series`)
      .query({ startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date().toISOString(), metrics: 'temperature' })
      .expect(200);
    expectDocumented(series, '/v1/devices/{id}/series');
  });
});

describe('what the alarm routes answer', () => {
  it('matches the declared shapes for a rule it made, listed, changed and silenced', async () => {
    const created = await owner.client
      .post(`/v1/devices/${device.deviceId}/alarm-rules`)
      .send({ ...anAlarmRule, name: unique('openapi-rule') })
      .expect(201);
    expectDocumented(created, '/v1/devices/{id}/alarm-rules', 'post');

    // The rules of this device, which is this spec's.
    const listed = await owner.client.get(`/v1/devices/${device.deviceId}/alarm-rules`).expect(200);
    expect(listed.body.items.length).toBeGreaterThan(0);
    expectDocumented(listed, '/v1/devices/{id}/alarm-rules');

    const changed = await owner.client
      .patch(`/v1/alarm-rules/${created.body.id}`)
      .send({ watch: { kind: 'reading', metric: 'temperature', upper: 31, lower: null } })
      .expect(200);
    expectDocumented(changed, '/v1/alarm-rules/{id}', 'patch');

    const silenced = await owner.client.put(`/v1/alarm-rules/${created.body.id}/silence`).send({ forSeconds: 3600 }).expect(200);
    expectDocumented(silenced, '/v1/alarm-rules/{id}/silence', 'put');
  });

  it('matches the declared shape for the alerts inbox', async () => {
    expectDocumented(await owner.client.get('/v1/alerts').query({ deviceId: device.deviceId }).expect(200), '/v1/alerts');
  });
});

describe('what the camera routes answer', () => {
  it('matches the declared shapes for a camera it made, listed, read and changed', async () => {
    const listed = await owner.client.get('/v1/cameras').expect(200);
    expect(listed.body.items.length).toBeGreaterThan(0);
    expectDocumented(listed, '/v1/cameras');

    expectDocumented(await owner.client.get(`/v1/cameras/${cameraId}`).expect(200), '/v1/cameras/{id}');
    expectDocumented(await owner.client.patch(`/v1/cameras/${cameraId}`).send({ name: 'renamed' }).expect(200), '/v1/cameras/{id}', 'patch');
  });

  it('matches the declared shapes for the stills and films of one camera', async () => {
    expectDocumented(await owner.client.get(`/v1/cameras/${cameraId}/frames`).expect(200), '/v1/cameras/{id}/frames');
    expectDocumented(await owner.client.get(`/v1/cameras/${cameraId}/timelapses`).expect(200), '/v1/cameras/{id}/timelapses');
  });
});

describe('what the admin routes answer', () => {
  it('matches the declared shape for this account in the account listing', async () => {
    const response = await admin.client.get('/v1/admin/users').expect(200);
    const mine = response.body.items.find((entry: { email: string }) => entry.email === owner.username);

    expectRowDocumented(response, '/v1/admin/users', mine);
  });

  it('matches the declared shapes for an account it made, read, changed and deleted', async () => {
    const created = await createAccountAsAdmin();
    expectDocumented(created, '/v1/admin/users', 'post');

    expectDocumented(await admin.client.get(`/v1/admin/users/${created.body.id}`).expect(200), '/v1/admin/users/{id}');
    expectDocumented(
      await admin.client.patch(`/v1/admin/users/${created.body.id}`).send({ isAdmin: true }).expect(200),
      '/v1/admin/users/{id}',
      'patch',
    );
    await admin.client.delete(`/v1/admin/users/${created.body.id}`).expect(204);
  });

  it('matches the declared shapes for the device classes and one of them', async () => {
    const listed = await admin.client.get('/v1/admin/device-classes').expect(200);
    expectDocumented(listed, '/v1/admin/device-classes');

    expectDocumented(await admin.client.get(`/v1/admin/device-classes/${fridgeClassId}`).expect(200), '/v1/admin/device-classes/{id}');
  });

  it('matches the declared shapes for a build it registered, relabelled and listed', async () => {
    const created = await admin.client
      .post('/v1/admin/firmwares')
      .send({ classId: fridgeClassId, name: 'fridge', version: unique('openapi-v') })
      .expect(201);
    expectDocumented(created, '/v1/admin/firmwares', 'post');

    const relabelled = await admin.client
      .patch(`/v1/admin/firmwares/${created.body.id}`)
      .send({ name: unique('openapi-label') })
      .expect(200);
    expectDocumented(relabelled, '/v1/admin/firmwares/{id}', 'patch');

    const listed = await admin.client.get('/v1/admin/firmwares').query({ classId: fridgeClassId }).expect(200);
    const mine = listed.body.items.find((entry: { id: string }) => entry.id === created.body.id);
    expectRowDocumented(listed, '/v1/admin/firmwares', mine);

    await admin.client.delete(`/v1/admin/firmwares/${created.body.id}`).expect(204);
  });

  it('matches the declared shape for the fleet', async () => {
    expectDocumented(await admin.client.get('/v1/admin/fleet').expect(200), '/v1/admin/fleet');
  });

  it('matches the declared shape for the install´s own figures', async () => {
    expectDocumented(await admin.client.get('/v1/admin/stats').expect(200), '/v1/admin/stats');
  });

  it('matches the declared shape for a device row it made by hand', async () => {
    const response = await admin.client
      .post('/v1/admin/devices')
      .send({ id: unique('by-hand'), type: 'fridge', classId: fridgeClassId, serialNumber: null })
      .expect(201);

    expectDocumented(response, '/v1/admin/devices', 'post');
  });
});

describe('what the probes and the firmware download answer', () => {
  it('declares them as the bodies they send, not as JSON', () => {
    // Nothing to validate with a schema here; what matters is that the document
    // says these answer bytes and words rather than leaving the body unsaid.
    expect(declaredSchema('/device/firmware/{firmware_id}/{binary}', 'get', 200, 'application/octet-stream')).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect(declaredSchema('/healthz', 'get', 200, 'text/plain')).toEqual({ type: 'string' });
    expect(declaredSchema('/readyz', 'get', 200, 'text/plain')).toEqual({ type: 'string' });
  });

  it('sends the bodies the document declares', async () => {
    const probe = await anonymous().get('/healthz').expect(200);
    expect(probe.headers['content-type']).toMatch(/^text\/plain/);
  });
});

/**
 * One case per body schema the server validates against - a route that shares
 * another's schema shares its body, and is covered with it. Each case names a
 * payload the route takes and one it refuses, and both are sent: a document that
 * agrees with a validator nobody runs proves nothing.
 *
 * "Refused" has to mean refused for the shape, which is all a JSON Schema can
 * describe. A rule a zod schema carries that JSON Schema cannot express is
 * refused by the route and accepted by the document, so the refused payloads
 * here are wrong in a way the document can state. For the same reason a payload
 * the route takes is only asked not to be a 400: a route may still turn down
 * what a well-formed body asks for, and that is not the document's claim.
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
    what: 'POST /v1/users',
    path: '/v1/users',
    url: () => '/v1/users',
    client: anonymous,
    accepted: () => ({ email: `${unique('openapi-signup')}@test.invalid`, handle: unique('openapi'), password: 'Passw0rd!test' }),
    refused: () => ({ email: `${unique('openapi-signup')}@test.invalid`, handle: unique('openapi') }),
  },
  {
    what: 'POST /v1/sessions',
    path: '/v1/sessions',
    url: () => '/v1/sessions',
    client: anonymous,
    accepted: () => ({ email: owner.username, password: owner.password, stayLoggedIn: false }),
    refused: () => ({ email: owner.username }),
  },
  {
    what: 'POST /v1/admin/users',
    path: '/v1/admin/users',
    url: () => '/v1/admin/users',
    client: () => admin.client,
    accepted: () => ({ email: `${unique('openapi-user')}@test.invalid`, handle: unique('openapi'), password: 'Passw0rd!test', isAdmin: false }),
    refused: () => ({ email: `${unique('openapi-user')}@test.invalid`, handle: unique('openapi') }),
  },
  {
    what: 'PATCH /v1/admin/users/{id}',
    path: '/v1/admin/users/{id}',
    method: 'patch',
    url: () => `/v1/admin/users/${spareUserId}`,
    client: () => admin.client,
    // An update carries only what it changes, so every field is optional.
    accepted: () => ({ isAdmin: false }),
    refused: () => ({ isAdmin: 'yes' }),
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
    what: 'POST /v1/devices/claims',
    path: '/v1/devices/claims',
    url: () => '/v1/devices/claims',
    client: () => owner.client,
    accepted: () => ({ code: unclaimedCode }),
    refused: () => ({ code: 42 }),
  },
  {
    what: 'PATCH /v1/devices/{id}',
    path: '/v1/devices/{id}',
    method: 'patch',
    url: () => `/v1/devices/${device.deviceId}`,
    client: () => owner.client,
    accepted: () => ({ name: 'named by the document spec', settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 } }),
    // A channel this cloud does not hand builds out on.
    refused: () => ({ firmware: { channel: 'whenever', targetId: null } }),
  },
  {
    what: 'PUT /v1/devices/{id}/configuration',
    path: '/v1/devices/{id}/configuration',
    method: 'put',
    url: () => `/v1/devices/${device.deviceId}/configuration`,
    client: () => owner.client,
    // The document is the device's own, so its keys are not constrained - but
    // it travels in an envelope, which is.
    accepted: () => ({ configuration: { day: { temperature: 24 } } }),
    refused: () => ({ day: { temperature: 24 } }),
  },
  {
    what: 'POST /v1/devices/{id}/commands',
    path: '/v1/devices/{id}/commands',
    url: () => `/v1/devices/${device.deviceId}/commands`,
    client: () => owner.client,
    accepted: () => ({ kind: 'maintenance', forSeconds: 300 }),
    // A union, so an action the firmware has no name for cannot be published.
    refused: () => ({ kind: 'self-destruct' }),
  },
  {
    what: 'POST /v1/devices/{id}/alarm-rules',
    path: '/v1/devices/{id}/alarm-rules',
    url: () => `/v1/devices/${device.deviceId}/alarm-rules`,
    client: () => owner.client,
    accepted: () => ({ ...anAlarmRule, name: unique('openapi-rule') }),
    // A metric nothing measures cannot be watched for.
    refused: () => ({ ...anAlarmRule, watch: { kind: 'reading', metric: 'moon-phase', upper: 30, lower: null } }),
  },
  {
    what: 'PUT /v1/alarm-rules/{id}/silence',
    path: '/v1/alarm-rules/{id}/silence',
    method: 'put',
    url: () => `/v1/alarm-rules/${alarmRuleId}/silence`,
    client: () => owner.client,
    accepted: () => ({ forSeconds: 3600 }),
    refused: () => ({ forSeconds: 'an hour' }),
  },
  {
    what: 'POST /v1/cameras',
    path: '/v1/cameras',
    url: () => '/v1/cameras',
    client: () => owner.client,
    accepted: () => ({ kind: 'rtsp', deviceId: device.deviceId, name: unique('openapi-cam'), url: 'rtsp://127.0.0.1:1/openapi' }),
    refused: () => ({ kind: 'carrier-pigeon', deviceId: device.deviceId, name: unique('openapi-cam') }),
  },
  {
    what: 'PATCH /v1/cameras/{id}',
    path: '/v1/cameras/{id}',
    method: 'patch',
    url: () => `/v1/cameras/${cameraId}`,
    client: () => owner.client,
    accepted: () => ({ name: 'renamed by the document spec' }),
    refused: () => ({ name: 'renamed by the document spec', stillIntervalSeconds: 'often' }),
  },
  {
    what: 'POST /v1/admin/device-classes',
    path: '/v1/admin/device-classes',
    url: () => '/v1/admin/device-classes',
    client: () => admin.client,
    accepted: () => ({
      name: unique('openapi-class'),
      description: 'A class the document spec made',
      concurrentUpdates: 5,
      maxFailures: 10,
      firmwareIds: { stable: null, beta: null, alpha: null },
      rollout: { paused: false, percent: 100 },
    }),
    refused: () => ({
      name: unique('openapi-class'),
      description: 'A class the document spec made',
      concurrentUpdates: 'five',
      maxFailures: 10,
      firmwareIds: { stable: null, beta: null, alpha: null },
      rollout: { paused: false, percent: 100 },
    }),
  },
  {
    what: 'POST /v1/admin/firmwares',
    path: '/v1/admin/firmwares',
    url: () => '/v1/admin/firmwares',
    client: () => admin.client,
    accepted: () => ({ classId: fridgeClassId, name: 'fridge', version: unique('openapi-fw') }),
    refused: () => ({ classId: fridgeClassId, name: 'fridge' }),
  },
  {
    what: 'POST /v1/admin/devices',
    path: '/v1/admin/devices',
    url: () => '/v1/admin/devices',
    client: () => admin.client,
    accepted: () => ({ id: unique('openapi-by-hand'), type: 'fridge', classId: fridgeClassId, serialNumber: null }),
    refused: () => ({ id: unique('openapi-by-hand'), type: 'fridge', classId: fridgeClassId, serialNumber: 'none' }),
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
