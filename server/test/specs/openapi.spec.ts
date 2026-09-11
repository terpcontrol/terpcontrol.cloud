import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import sharp from 'sharp';
import { anonymous, createAccount, loginAsAdmin, Session, unique } from '../support/api';
import { resetMeasurements, seedMeasurements } from '../support/control';
import { DeviceCredentials, provisionDevice, registerDevice } from '../support/device';

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

/**
 * The response schema a route documents, or undefined where it documents none.
 * A few routes answer 201 - a read among them - and document that status.
 */
const declaredSchema = (path: string, method = 'get', status = '200'): unknown =>
  document.paths[path]?.[method]?.responses?.[status]?.content?.['application/json']?.schema;

const itemSchema = (schema: unknown): unknown => (schema as { items?: unknown }).items ?? schema;

const expectMatches = (schema: unknown, body: unknown, what: string) => {
  // A route that documents nothing spreads into an empty schema, which accepts
  // any answer at all - so the absence has to be the failure, not a free pass.
  if (!schema) {
    throw new Error(`${what} documents no response shape, so there is nothing to check the answer against`);
  }

  const validate: ValidateFunction = ajv.compile({ ...(schema as object), components: document.components } as object);
  if (!validate(body)) {
    throw new Error(`${what} does not match the schema the document declares: ${ajv.errorsText(validate.errors)}`);
  }
};

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

  it('names the status a route answers with, not just 200', () => {
    // Reads that answer 201 - which these two always have - would otherwise
    // document a 200 they never send.
    expect(declaredSchema('/data/latest/{device_id}/{measure}', 'get', '201')).toEqual({ $ref: '#/components/schemas/MeasureValue' });
    expect(declaredSchema('/data/latest/{device_id}/{measure}')).toBeUndefined();
    expect(declaredSchema('/share', 'post', '201')).toEqual({ $ref: '#/components/schemas/ShareLink' });
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
 * The session, measurement and fleet answers, which used to be documented as
 * nothing at all. Each case makes the row it validates, for the reason the file
 * header gives.
 */
describe('what the routes answer that carry no entity of their own', () => {
  it('matches the declared shape for a sign-in', async () => {
    const response = await anonymous().post('/login').send({ username: owner.username, password: owner.password }).expect(200);

    expectMatches(declaredSchema('/login', 'post'), response.body, 'POST /login');
  });

  it('matches the declared shape for a refreshed session', async () => {
    // The tokens alone: the refresh token already said who the caller is.
    const response = await anonymous().post('/refresh').send({ token: owner.refreshToken }).expect(200);

    expect(response.body.user).toBeUndefined();
    expectMatches(declaredSchema('/refresh', 'post'), response.body, 'POST /refresh');
  });

  it('matches the declared shape for a claimed device', async () => {
    const credentials = await registerDevice();
    const code = await anonymous().post('/device/claimcode').send({ device_id: credentials.deviceId }).expect(200);

    const response = await owner.client.post('/device').send({ claim_code: code.body.claim_code }).expect(200);

    expectMatches(declaredSchema('/device', 'post'), response.body, 'POST /device');
  });

  it('matches the declared shape for the latest measurement', async () => {
    await resetMeasurements();
    await seedMeasurements([{ time: Date.now() - 30_000, device_id: device.deviceId, fields: { temperature: 21.5 } }]);

    const response = await owner.client.get(`/data/latest/${device.deviceId}/temperature`).expect(201);

    expect(response.body.value).toBeCloseTo(21.5);
    expectMatches(declaredSchema('/data/latest/{device_id}/{measure}', 'get', '201'), response.body, 'GET /data/latest');
  });

  it('matches the declared shape for a series, empty windows included', async () => {
    await resetMeasurements();
    const alignedNow = Math.floor(Date.now() / 60_000) * 60_000;
    await seedMeasurements([{ time: alignedNow - 90_000, device_id: device.deviceId, fields: { temperature: 19 } }]);

    const response = await owner.client
      .get(`/data/series/${device.deviceId}/temperature`)
      .query({ from: new Date(alignedNow - 300_000).toISOString(), to: new Date(alignedNow).toISOString(), interval: '1m' })
      .expect(201);

    expect(response.body.length).toBeGreaterThan(1);
    expect(response.body.some((point: { _value: number | null }) => point._value === null)).toBe(true);
    expectMatches(declaredSchema('/data/series/{device_id}/{measure}', 'get', '201'), response.body, 'GET /data/series');
  });

  it('matches the declared shape for the fleet listing', async () => {
    const response = await admin.client.get('/device/firmwareversions').expect(200);
    const fridge = response.body.find((entry: { class: { name: string } }) => entry.class.name === 'fridge');

    expect(fridge).toBeDefined();
    // The synthetic row counting devices on a firmware the database no longer
    // knows carries a null id, which is why the listing has a shape of its own.
    expect(fridge.versions.some((version: { fw: { firmware_id: string | null } }) => version.fw.firmware_id === null)).toBe(true);
    expectMatches(itemSchema(declaredSchema('/device/firmwareversions')), fridge, 'GET /device/firmwareversions');
  });

  it('matches the declared shape for an uploaded diary photo', async () => {
    const still = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 90, b: 40 } } })
      .jpeg()
      .toBuffer();

    const response = await owner.client.post(`/image/${device.deviceId}`).attach('image', still, 'still.jpg').expect(201);

    expectMatches(declaredSchema('/image/{device_id}', 'post', '201'), response.body, 'POST /image/:device_id');
  });
});

/** Routes that answer a shape the document already knew, but never named. */
describe('what the routes answer that resemble an entity', () => {
  it("matches the declared shape for a device's access info", async () => {
    const response = await owner.client.get(`/device/cloudsettings/${device.deviceId}`).expect(200);

    expectMatches(declaredSchema('/device/cloudsettings/{device_id}'), response.body, 'GET /device/cloudsettings/:device_id');
  });

  it('matches the declared shape for an alarm it just defined', async () => {
    const alarm = { name: unique('alarm'), sensorType: 'temperature', upperThreshold: 30, actionType: 'info', actionTarget: '' };
    await owner.client
      .post('/device/alarms')
      .send({ device_id: device.deviceId, alarms: [alarm] })
      .expect(200);

    const response = await owner.client.get(`/device/alarms/${device.deviceId}`).expect(200);

    expect(response.body).toHaveLength(1);
    expectMatches(declaredSchema('/device/alarms/{device_id}'), response.body, 'GET /device/alarms/:device_id');
  });

  it('matches the declared shape for a diary entry it just wrote', async () => {
    await owner.client
      .post(`/device/logs/${device.deviceId}`)
      .send({ title: unique('entry'), severity: 0, categories: ['diary'], time: Date.now() })
      .expect(200);

    const response = await owner.client.get(`/device/logs/${device.deviceId}`).expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    expectMatches(declaredSchema('/device/logs/{device_id}'), response.body, 'GET /device/logs/:device_id');
  });

  it('matches the declared shape for a share link it just handed out', async () => {
    const response = await owner.client.post('/share').send({ device_id: device.deviceId, page: 'charts' }).expect(201);

    expectMatches(declaredSchema('/share', 'post', '201'), response.body, 'POST /share');

    const listing = await owner.client.get('/share').expect(200);
    expectMatches(declaredSchema('/share'), listing.body, 'GET /share');
  });

  it('matches the declared shape for a chart preset it just saved', async () => {
    const response = await owner.client
      .post('/chartpresets')
      .send({ name: unique('preset'), query: 'measures=temperature' })
      .expect(201);

    expectMatches(declaredSchema('/chartpresets', 'post', '201'), response.body, 'POST /chartpresets');
  });

  it('matches the declared shape for a plan template it just saved', async () => {
    const step = { name: 'Veg', settings: { day: { temperature: 26 } }, durationUnit: 'days', duration: 14, waitForConfirmation: false };

    const response = await owner.client
      .post('/device/recipes')
      .send({ name: unique('template'), steps: [step] })
      .expect(201);

    expectMatches(declaredSchema('/device/recipes', 'post', '201'), response.body, 'POST /device/recipes');
  });
});
