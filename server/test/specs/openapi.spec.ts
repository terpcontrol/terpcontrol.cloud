import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import supertest from 'supertest';
import { anonymous, context, createAccount, loginAsAdmin, Method, Session, unique } from '../support/api';
import { seedMeasurements, waitForMail } from '../support/control';
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
 *
 * One case walks the document instead of the server: every operation has to
 * declare a body, so a route added without saying what it answers fails here
 * rather than quietly going undocumented.
 */

const METHODS: Method[] = ['get', 'post', 'put', 'patch', 'delete', 'options'];

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
const declaredSchema = (path: string, method: Method = 'get', status = 200, contentType = 'application/json'): unknown =>
  document.paths[path]?.[method]?.responses?.[String(status)]?.content?.[contentType]?.schema;

const itemSchema = (schema: unknown): unknown => (schema as { items?: unknown }).items ?? schema;

const expectMatches = (schema: unknown, body: unknown, what: string) => {
  const validate: ValidateFunction = ajv.compile({ ...(schema as object), components: document.components } as object);
  if (!validate(body)) {
    throw new Error(`${what} does not match the schema the document declares: ${ajv.errorsText(validate.errors)}`);
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
    // the admin listing answers the whole document. Looking a firmware up by
    // class and version answers the same projection as the firmware listing.
    expect(declaredSchema('/device')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/DeviceListEntry' } });
    expect(declaredSchema('/device/all')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Device' } });
    expect(declaredSchema('/device/class')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/DeviceClass' } });
    expect(declaredSchema('/users')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/UserAccount' } });
    expect(declaredSchema('/device/firmware')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/FirmwareListEntry' } });
    expect(declaredSchema('/device/firmware/find')).toEqual({ $ref: '#/components/schemas/FirmwareListEntry' });
  });

  it('leaves no operation without an answer', () => {
    // What this file is for: an operation that documents no body at all tells a
    // reader nothing, and there is no route left that has an excuse for it.
    const unsaid: string[] = [];

    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations).filter(key => METHODS.includes(key as Method))) {
        const answers = Object.entries(operations[method].responses ?? {}).filter(([status]) => status.startsWith('2'));
        if (!answers.some(([, answer]) => Object.keys(answer.content ?? {}).length > 0)) {
          unsaid.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(unsaid).toEqual([]);
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

describe('what the measurement routes answer', () => {
  /** A window this spec seeded itself, so the points in it are its own. */
  const alignedNow = Math.floor(Date.now() / 60_000) * 60_000;
  const from = new Date(alignedNow - 5 * 60_000).toISOString();
  const to = new Date(alignedNow).toISOString();

  it('matches the declared shape for a series, empty windows and all', async () => {
    await seedMeasurements([{ time: alignedNow - 90_000, device_id: device.deviceId, fields: { temperature: 21 } }]);

    const response = await owner.client
      .get(`/data/series/${device.deviceId}/temperature`)
      .query({ from, to, interval: '1m', method: 'mean' })
      .expect(201);

    // Both halves of the shape have to appear, or the null is never checked.
    expect(response.body.some((point: { _value: number | null }) => point._value === null)).toBe(true);
    expect(response.body.some((point: { _value: number | null }) => point._value !== null)).toBe(true);
    expectDocumented(response, '/data/series/{device_id}/{measure}');
  });

  it('matches the declared shape for the latest reading, and for there being none', async () => {
    await seedMeasurements([{ time: Date.now() - 30_000, device_id: device.deviceId, fields: { humidity: 55 } }]);

    const reading = await owner.client.get(`/data/latest/${device.deviceId}/humidity`).expect(201);
    expect(reading.body.value).toBe(55);
    expectDocumented(reading, '/data/latest/{device_id}/{measure}');

    const nothing = await owner.client.get(`/data/latest/${device.deviceId}/co2`).expect(201);
    expect(nothing.body.value).toBeNull();
    expectDocumented(nothing, '/data/latest/{device_id}/{measure}');
  });
});

describe('what the device diary routes answer', () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    title: unique('openapi-entry'),
    message: 'openapi',
    severity: 1,
    categories: ['diary'],
    time: Date.now(),
    ...overrides,
  });

  it('matches the declared shape for a diary it wrote itself', async () => {
    // The diary is per device, and this device is this spec's.
    expectDocumented(await owner.client.post(`/device/logs/${device.deviceId}`).send(entry()).expect(200), '/device/logs/{device_id}', 'post');

    const response = await owner.client.get(`/device/logs/${device.deviceId}`).expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    expectDocumented(response, '/device/logs/{device_id}');
  });

  it('matches the declared shapes for changing and removing one entry', async () => {
    await owner.client.post(`/device/logs/${device.deviceId}`).send(entry()).expect(200);
    const [written] = await owner.client
      .get(`/device/logs/${device.deviceId}`)
      .expect(200)
      .then(response => response.body.slice(-1));

    const changed = await owner.client
      .put(`/device/logs/${device.deviceId}/${written._id}`)
      .send(entry({ severity: 2 }))
      .expect(200);
    expectDocumented(changed, '/device/logs/{device_id}/{log_id}', 'put');

    const removed = await owner.client.delete(`/device/logs/${device.deviceId}/${written._id}`).expect(200);
    expectDocumented(removed, '/device/logs/{device_id}/{log_id}', 'delete');
  });

  it('matches the declared shape for clearing a whole diary', async () => {
    const spare = await provisionDevice(owner);
    await owner.client.post(`/device/logs/${spare.deviceId}`).send(entry()).expect(200);

    expectDocumented(await owner.client.delete(`/device/logs/${spare.deviceId}`).expect(200), '/device/logs/{device_id}', 'delete');
  });
});

describe('what the grow plan routes answer', () => {
  const step = { name: 'veg', settings: { day: { temperature: 24 } }, durationUnit: 'days', duration: 7, waitForConfirmation: false };

  const createTemplate = () =>
    owner.client
      .post('/device/recipes')
      .send({ name: unique('openapi-plan'), steps: [step], public: false })
      .expect(201);

  it('matches the declared shape for the plan a device is running', async () => {
    const saved = await owner.client
      .post('/device/recipe')
      .send({ device_id: device.deviceId, recipe: { steps: [step], activeStepIndex: 0, activeSince: Date.now() } })
      .expect(200);
    expectDocumented(saved, '/device/recipe', 'post');

    expectDocumented(await owner.client.get(`/device/recipe/${device.deviceId}`).expect(200), '/device/recipe/{device_id}');
  });

  it('matches the declared shapes for a plan template through its whole life', async () => {
    const created = await createTemplate();
    expectDocumented(created, '/device/recipes', 'post');

    const templateId = created.body._id;
    expectDocumented(await owner.client.get(`/device/recipes/${templateId}`).expect(200), '/device/recipes/{template_id}');
    expectDocumented(
      await owner.client.put(`/device/recipes/${templateId}`).send({ public: true }).expect(200),
      '/device/recipes/{template_id}',
      'put',
    );
    expectDocumented(await owner.client.delete(`/device/recipes/${templateId}`).expect(200), '/device/recipes/{template_id}', 'delete');
  });

  it('matches the declared shape for a template in the listing', async () => {
    // The listing carries every public template, so only this one is checked.
    const created = await createTemplate();

    const response = await owner.client.get('/device/recipes').expect(200);
    const mine = response.body.find((template: { _id: string }) => template._id === created.body._id);

    expectRowDocumented(response, '/device/recipes', mine);
  });
});

describe('what the firmware and device class routes answer', () => {
  const registerFirmware = () =>
    admin.client
      .post('/device/firmware')
      .send({ name: 'fridge', version: unique('openapi-v') })
      .expect(200);

  it('matches the declared shapes for a firmware build it registered, relabelled and deleted', async () => {
    const created = await registerFirmware();
    expectDocumented(created, '/device/firmware', 'post');

    const firmwareId = created.body.firmware_id;
    const uploaded = await admin.client
      .post(`/device/firmware/${firmwareId}/firmware.bin`)
      .attach('binary', Buffer.from('an image'), 'firmware.bin')
      .expect(200);
    expectDocumented(uploaded, '/device/firmware/{firmware_id}/{binary}', 'post');

    const relabelled = await admin.client
      .put(`/device/firmware/${firmwareId}`)
      .send({ version: unique('openapi-relabelled') })
      .expect(200);
    expectDocumented(relabelled, '/device/firmware/{firmware_id}', 'put');

    expectDocumented(await admin.client.delete(`/device/firmware/${firmwareId}`).expect(200), '/device/firmware/{firmware_id}', 'delete');
  });

  it('matches the declared shape for a firmware found by class and version', async () => {
    const created = await registerFirmware();
    const listed = await admin.client.get('/device/firmware').expect(200);
    const { version } = listed.body.find((entry: { firmware_id: string }) => entry.firmware_id === created.body.firmware_id);

    const response = await admin.client.get('/device/firmware/find').query({ name: 'fridge', version }).expect(200);

    expectDocumented(response, '/device/firmware/find');
  });

  it('matches the declared shape for the firmwares a device may run', async () => {
    const response = await owner.client.get(`/device/firmwares/${device.deviceId}`).expect(200);

    expectDocumented(response, '/device/firmwares/{device_id}');
  });

  it('matches the declared shapes for a device class it created, read and changed', async () => {
    const firmware = await registerFirmware();
    const name = unique('openapi-class');

    const created = await admin.client
      .post('/device/class')
      .send({ name, description: 'made by the openapi spec', concurrent: 1, maxfails: 1, firmware_id: firmware.body.firmware_id })
      .expect(200);
    expectDocumented(created, '/device/class', 'post');

    const found = await admin.client.get(`/device/class/find/${name}`).expect(200);
    expectDocumented(found, '/device/class/find/{class_name}');

    const classId = found.body.class_id;
    expectDocumented(await admin.client.get(`/device/class/${classId}`).expect(200), '/device/class/{class_id}');

    const changed = await admin.client
      .post(`/device/class/${classId}`)
      .send({ name, description: 'changed', concurrent: 2, maxfails: 1, firmware_id: firmware.body.firmware_id })
      .expect(200);
    expectDocumented(changed, '/device/class/{class_id}', 'post');
  });
});

describe('what the device routes answer', () => {
  const alarm = {
    alarmId: unique('openapi-alarm'),
    sensorType: 'temperature',
    upperThreshold: 40,
    actionType: 'info',
    actionTarget: '',
  };

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

    const claimed = await owner.client.post('/device').send({ claim_code: code.body.claim_code }).expect(200);
    expectDocumented(claimed, '/device', 'post');
  });

  it('matches the declared shape for a device found by its serial number', async () => {
    const listed = await admin.client.get('/device/all').expect(200);
    const mine = listed.body.find((entry: { device_id: string }) => entry.device_id === device.deviceId);

    const response = await admin.client.get('/device/byserial').query({ serialnumber: mine.serialnumber }).expect(200);

    expect(response.body.device_id).toBe(device.deviceId);
    expectDocumented(response, '/device/byserial');
  });

  it('matches the declared shape for the online count of a class this spec has a device in', async () => {
    const response = await admin.client.get('/device/onlinedevices').expect(200);
    const fridge = response.body.find((entry: { class: { name: string } }) => entry.class.name === 'fridge');

    expect(fridge.total).toBeGreaterThan(0);
    expectRowDocumented(response, '/device/onlinedevices', fridge);
  });

  it('matches the declared shape for the fleet listing, including the row for unknown firmware', async () => {
    const response = await admin.client.get('/device/firmwareversions').expect(200);
    const fridge = response.body.find((entry: { class: { name: string } }) => entry.class.name === 'fridge');

    // Devices on a build this server has no record of are counted on a row with
    // no firmware id, which is the half of the shape a real build never covers.
    expect(fridge.versions.some((version: { fw: { firmware_id: string | null } }) => version.fw.firmware_id === null)).toBe(true);
    expectRowDocumented(response, '/device/firmwareversions', fridge);
  });

  it('matches the declared shapes for a device it configured, named and set alarms on', async () => {
    const configuration = JSON.stringify({ day: { temperature: 24 } });

    expectDocumented(
      await owner.client.post('/device/configure').send({ device_id: device.deviceId, configuration }).expect(200),
      '/device/configure',
      'post',
    );

    const read = await owner.client.get(`/device/config/${device.deviceId}`).expect(200);
    expect(read.body).toBe(configuration);
    expectDocumented(read, '/device/config/{device_id}');

    expectDocumented(
      await owner.client
        .post('/device/alarms')
        .send({ device_id: device.deviceId, alarms: [alarm] })
        .expect(200),
      '/device/alarms',
      'post',
    );

    const alarms = await owner.client.get(`/device/alarms/${device.deviceId}`).expect(200);
    expect(alarms.body.length).toBe(1);
    expectDocumented(alarms, '/device/alarms/{device_id}');

    expectDocumented(
      await owner.client.post('/device/setname').send({ device_id: device.deviceId, name: 'openapi' }).expect(200),
      '/device/setname',
      'post',
    );
  });

  it('matches the declared shapes for the cloud settings of a device', async () => {
    expectDocumented(
      await owner.client
        .post('/device/cloudsettings')
        .send({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'stable', betaFeatures: true } })
        .expect(200),
      '/device/cloudsettings',
      'post',
    );

    expectDocumented(await owner.client.get(`/device/cloudsettings/${device.deviceId}`).expect(200), '/device/cloudsettings/{device_id}');
  });

  it('matches the declared shapes for the commands a device is sent', async () => {
    const outputs = { heater: 1, dehumidifier: 0, co2: 0, lights: 0, fanint: 0, fanext: 0, fanbw: 0 };

    expectDocumented(await owner.client.post(`/device/test/${device.deviceId}`).send(outputs).expect(200), '/device/test/{device_id}', 'post');
    expectDocumented(await owner.client.delete(`/device/test/${device.deviceId}`).expect(200), '/device/test/{device_id}', 'delete');
    expectDocumented(
      await owner.client.post('/device/maintenancemode').send({ device_id: device.deviceId, duration_minutes: 5 }).expect(200),
      '/device/maintenancemode',
      'post',
    );
    expectDocumented(await owner.client.post('/device/reboot').send({ device_id: device.deviceId }).expect(200), '/device/reboot', 'post');
    expectDocumented(
      await owner.client.post('/device/auxcommand').send({ device_id: device.deviceId, action: 'socket_test', role: 'heater' }).expect(200),
      '/device/auxcommand',
      'post',
    );
  });

  it('matches the declared shape for releasing a device', async () => {
    const spare = await provisionDevice(owner);

    expectDocumented(await owner.client.delete(`/device/${spare.deviceId}`).expect(200), '/device/{device_id}', 'delete');
  });
});

describe('what the picture routes answer', () => {
  // A one-pixel JPEG: the route re-encodes whatever it is given, so the bytes
  // only have to be a picture.
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );

  it('matches the declared shape for a photo it just added to a diary', async () => {
    const response = await owner.client.post(`/image/${device.deviceId}`).attach('image', jpeg, 'photo.jpg').expect(201);

    expectDocumented(response, '/image/{device_id}', 'post');
  });

  it('matches the declared shape for deleting a picture it added', async () => {
    const added = await owner.client.post(`/image/${device.deviceId}`).attach('image', jpeg, 'photo.jpg').expect(201);

    expectDocumented(await owner.client.delete(`/image/${added.body.image_id}`).expect(200), '/image/{image_id}', 'delete');
  });

  it('declares the picture and probe routes as the bodies they send, not as JSON', async () => {
    // Nothing to validate with a schema here; what matters is that the document
    // says these answer bytes and words rather than leaving the body unsaid.
    expect(declaredSchema('/image/{device_id}', 'get', 200, 'image/jpeg')).toEqual({ type: 'string', format: 'binary' });
    expect(declaredSchema('/image/{device_id}', 'get', 200, 'image/png')).toEqual({ type: 'string', format: 'binary' });
    expect(declaredSchema('/image/{device_id}', 'get', 200, 'video/mp4')).toEqual({ type: 'string', format: 'binary' });
    expect(declaredSchema('/device/firmware/{firmware_id}/{binary}', 'get', 200, 'application/octet-stream')).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect(declaredSchema('/', 'get', 200, 'text/plain')).toEqual({ type: 'string' });
    expect(declaredSchema('/readycheck', 'get', 200, 'text/plain')).toEqual({ type: 'string' });
  });

  it('sends the picture and probe bodies the document declares', async () => {
    const added = await owner.client.post(`/image/${device.deviceId}`).attach('image', jpeg, 'photo.jpg').expect(201);

    const photo = await owner.client.get(`/image/${device.deviceId}`).query({ format: 'user/jpeg', image_id: added.body.image_id }).expect(200);
    expect(photo.headers['content-type']).toMatch(/^image\/jpeg/);

    // Nothing stored for that moment, so the placeholder stands in - and it is
    // a PNG, whichever format was asked for.
    const placeholder = await owner.client.get(`/image/${device.deviceId}`).query({ format: 'jpeg', timestamp: 1 }).expect(200);
    expect(placeholder.headers['content-type']).toMatch(/^image\/png/);

    const probe = await anonymous().get('/').expect(200);
    expect(probe.headers['content-type']).toMatch(/^text\/plain/);
  });
});
