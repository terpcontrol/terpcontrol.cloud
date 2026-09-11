import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import supertest from 'supertest';
import { anonymous, context, createAccount, loginAsAdmin, Method, Session, unique } from '../support/api';
import { waitForMail } from '../support/control';
import { DeviceCredentials, provisionDevice } from '../support/device';

/**
 * The API document, and whether it tells the truth.
 *
 * The shapes come from the zod schemas in shared-types, generated into the
 * document's `components.schemas` and referenced by the routes. That makes every
 * annotated route a claim about what the server answers with, so the claims are
 * checked here against what it actually answers.
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

interface OpenApiDocument {
  components?: { schemas?: Record<string, object> };
  paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>;
}

let document: OpenApiDocument;
let ajv: Ajv;
let owner: Session;
let admin: Session;
let device: DeviceCredentials;

/** The response schema a route documents for one status code, or undefined. */
const declaredSchema = (path: string, method: Method = 'get', status = 200): unknown =>
  document.paths[path]?.[method]?.responses?.[String(status)]?.content?.['application/json']?.schema;

const itemSchema = (schema: unknown): unknown => (schema as { items?: unknown }).items ?? schema;

const expectMatches = (schema: unknown, body: unknown, what: string) => {
  const validate: ValidateFunction = ajv.compile({ ...(schema as object), components: document.components } as object);
  if (!validate(body)) {
    throw new Error(`${what} does not match the schema the document declares: ${ajv.errorsText(validate.errors)}`);
  }
};

/**
 * Checks one answer against what the document declares for the route - under
 * the status the answer actually came back with. A shape documented for a
 * status the route never sends describes nothing, and reading the status from
 * the answer is what catches it.
 */
const expectDocumented = (response: supertest.Response, path: string, method: Method = 'get'): void => {
  const schema = declaredSchema(path, method, response.status);
  const what = `${method.toUpperCase()} ${path} (${response.status})`;
  if (schema === undefined) {
    throw new Error(`${what} answered a body the document declares no schema for`);
  }
  expectMatches(schema, response.body, what);
};

/** The same, for one row a spec picked out of a listing it shares with others. */
const expectRowDocumented = (response: supertest.Response, path: string, row: unknown, method: Method = 'get'): void => {
  const schema = declaredSchema(path, method, response.status);
  const what = `${method.toUpperCase()} ${path} (${response.status})`;
  if (schema === undefined) {
    throw new Error(`${what} answered a body the document declares no schema for`);
  }
  expect(row).toBeDefined();
  expectMatches(itemSchema(schema), row, what);
};

/** An account this spec owns, so deleting or renaming it disturbs nobody. */
const createAccountAsAdmin = (): Promise<supertest.Response> =>
  admin.client
    .post('/users')
    .send({ username: `${unique('openapi-account')}@test.invalid`, password: 'Passw0rd!test', is_admin: false })
    .expect(201);

beforeAll(async () => {
  const response = await anonymous().get('/swagger.json').expect(200);
  document = response.body as OpenApiDocument;

  ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  owner = await createAccount('openapi-owner');
  admin = await loginAsAdmin();
  device = await provisionDevice(owner);
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

  it('declares each shape under the status its route answers with', () => {
    // A route that answers 201 and documents a 200 describes an answer nobody
    // ever gets; declaring a shape at all replaces the status Nest would have
    // filled in on its own, so the status has to be said out loud.
    expect(declaredSchema('/device/create', 'post', 200)).toBeUndefined();
    expect(declaredSchema('/device/create', 'post', 201)).toEqual({ $ref: '#/components/schemas/Device' });
  });
});

describe('what the routes actually answer', () => {
  it("matches the declared shape for the caller's own devices", async () => {
    // This account was made by this spec, so every row in the listing is its own.
    const response = await owner.client.get('/device').expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    expectDocumented(response, '/device');
  });

  it('matches the declared shape for a device in the admin listing', async () => {
    const response = await admin.client.get('/device/all').expect(200);
    const mine = response.body.find((entry: { device_id: string }) => entry.device_id === device.deviceId);

    expectRowDocumented(response, '/device/all', mine);
  });

  it('matches the declared shape for a device it just created', async () => {
    const fridge = await admin.client.get('/device/class/find/fridge').expect(200);
    const response = await admin.client.post('/device/create').send({ class_id: fridge.body.class_id, device_type: 'fridge' }).expect(201);

    expectDocumented(response, '/device/create', 'post');
  });

  it('matches the declared shape for this account in the account listing', async () => {
    const response = await admin.client.get('/users').expect(200);
    const mine = response.body.find((entry: { username: string }) => entry.username === owner.username);

    expectRowDocumented(response, '/users', mine);
  });

  it('matches the declared shape for a firmware it just created', async () => {
    const version = unique('openapi-v');
    const created = await admin.client.post('/device/firmware').send({ name: 'fridge', version }).expect(200);

    const response = await admin.client.get('/device/firmware').expect(200);
    const mine = response.body.find((entry: { firmware_id: string }) => entry.firmware_id === created.body.firmware_id);

    expectRowDocumented(response, '/device/firmware', mine);
  });

  it('matches the declared shape for an account it just created', async () => {
    const response = await createAccountAsAdmin();

    expectDocumented(response, '/users', 'post');
  });

  it('matches the declared shape for one account read by its id', async () => {
    const created = await createAccountAsAdmin();

    const response = await admin.client.get(`/users/${created.body.data._id}`).expect(200);

    expectDocumented(response, '/users/{id}');
  });

  it('matches the declared shape for an account it just changed', async () => {
    const created = await createAccountAsAdmin();

    const response = await admin.client.put(`/users/${created.body.data._id}`).send({ is_admin: true }).expect(200);

    expectDocumented(response, '/users/{id}', 'put');
  });

  it('matches the declared shape for an account it just deleted', async () => {
    const created = await createAccountAsAdmin();

    const response = await admin.client.delete(`/users/${created.body.data._id}`).expect(200);

    expectDocumented(response, '/users/{id}', 'delete');
  });

  it('matches the declared shape for a device class', async () => {
    const response = await admin.client.get('/device/class').expect(200);
    const fridge = response.body.find((entry: { name: string }) => entry.name === 'fridge');

    expectRowDocumented(response, '/device/class', fridge);
  });
});

describe('what the authentication routes answer', () => {
  const password = 'Passw0rd!test';

  it('matches the declared shapes for a sign-up, the session it leads to, and its renewal', async () => {
    // One client throughout: the routes are rate-limited per address, and every
    // client of this suite is given one of its own.
    const client = anonymous();
    const username = `${unique('openapi-signup')}@test.invalid`;

    const signup = await client.post('/signup').send({ username, password }).expect(201);
    expectDocumented(signup, '/signup', 'post');

    const session = await client.post('/login').send({ username, password }).expect(200);
    expectDocumented(session, '/login', 'post');

    const renewed = await client.post('/refresh').send({ token: session.body.refreshToken.token }).expect(200);
    expectDocumented(renewed, '/refresh', 'post');
  });

  it('matches the declared shape for a demo session', async () => {
    expectDocumented(await anonymous().post('/demologin').expect(200), '/demologin', 'post');
  });

  it('matches the declared shape for the session the automation token buys', async () => {
    const response = await anonymous().post('/tokenlogin').send({ token: context.automationToken }).expect(200);

    expectDocumented(response, '/tokenlogin', 'post');
  });

  it('matches the declared shapes for changing a password and signing out', async () => {
    const account = await createAccount('openapi-session');

    expectDocumented(await account.client.post('/changepass').send({ username: '', password }).expect(200), '/changepass', 'post');
    expectDocumented(await account.client.post('/logout').expect(200), '/logout', 'post');
  });

  it('matches the declared shapes for a password recovery', async () => {
    const account = await createAccount('openapi-recovery');

    const requested = await anonymous().post('/getreset').send({ username: account.username, password: '' }).expect(201);
    expectDocumented(requested, '/getreset', 'post');

    const mail = await waitForMail(message => message.to.includes(account.username));
    const token = mail.body.match(/recovery=([\w-]+)/)?.[1];

    const reset = await anonymous().post('/reset').send({ token, password: 'Recovered!pass1' }).expect(200);
    expectDocumented(reset, '/reset', 'post');
  });
});

describe('what the chart preset and share routes answer', () => {
  it('matches the declared shapes for a chart preset it created, listed and deleted', async () => {
    const created = await owner.client
      .post('/chartpresets')
      .send({ name: unique('openapi-preset'), query: 'measures=temperature' })
      .expect(201);
    expectDocumented(created, '/chartpresets', 'post');

    // The listing is the caller's own, and this account is this spec's.
    const listed = await owner.client.get('/chartpresets').expect(200);
    expect(listed.body.length).toBeGreaterThan(0);
    expectDocumented(listed, '/chartpresets');

    expectDocumented(await owner.client.delete(`/chartpresets/${created.body.preset_id}`).expect(200), '/chartpresets/{preset_id}', 'delete');
  });

  it('matches the declared shapes for a share link through its whole life', async () => {
    const created = await owner.client
      .post('/share')
      .send({ device_id: device.deviceId, page: 'charts', editable: false, webcam: false })
      .expect(201);
    expectDocumented(created, '/share', 'post');

    const listed = await owner.client.get('/share').expect(200);
    expect(listed.body.length).toBeGreaterThan(0);
    expectDocumented(listed, '/share');

    const shareId = created.body.share_id;
    expectDocumented(await anonymous().get(`/share/resolve/${shareId}`).expect(200), '/share/resolve/{share_id}');
    expectDocumented(await owner.client.post(`/share/${shareId}/revoke`).expect(200), '/share/{share_id}/revoke', 'post');
    expectDocumented(await owner.client.delete(`/share/${shareId}`).expect(200), '/share/{share_id}', 'delete');
  });

  it('matches the declared shape for a sweep of inactive share links', async () => {
    const created = await owner.client.post('/share').send({ device_id: device.deviceId, page: 'diary', editable: false, webcam: false }).expect(201);
    await owner.client.post(`/share/${created.body.share_id}/revoke`).expect(200);

    const response = await owner.client.delete('/share/inactive').expect(200);

    expect(response.body.deleted).toBeGreaterThan(0);
    expectDocumented(response, '/share/inactive', 'delete');
  });
});
