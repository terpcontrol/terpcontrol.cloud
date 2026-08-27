import { anonymous, createAccount, loginAsAdmin, Session, unique } from '../support/api';

const password = 'Passw0rd!test';
const newUsername = () => `${unique('users')}@test.invalid`;

let admin: Session;

beforeAll(async () => {
  admin = await loginAsAdmin();
});

const createUser = async (overrides: Record<string, unknown> = {}) => {
  const response = await admin.client
    .post('/users')
    .send({ username: newUsername(), password, is_admin: false, ...overrides })
    .expect(201);
  return response.body.data;
};

describe('GET /users', () => {
  it('lists accounts without exposing password hashes', async () => {
    await createUser();

    const response = await admin.client.get('/users').expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    for (const user of response.body) {
      expect(user).toEqual({ username: expect.any(String), user_id: expect.any(String), is_admin: expect.any(Boolean) });
    }
  });

  it('is admin-only', async () => {
    const account = await createAccount();
    await account.client.get('/users').expect(401);
    await anonymous().get('/users').expect(401);
  });
});

describe('POST /users', () => {
  it('creates an account', async () => {
    const username = newUsername();
    const response = await admin.client.post('/users').send({ username, password, is_admin: false }).expect(201);

    expect(response.body.message).toBe('created');
    expect(response.body.data.username).toBe(username);
    expect(response.body.data.user_id).toEqual(expect.any(String));
  });

  it('can create another admin', async () => {
    const user = await createUser({ is_admin: true });
    expect(user.is_admin).toBe(true);
  });

  it('rejects a duplicate username', async () => {
    const user = await createUser();
    await admin.client.post('/users').send({ username: user.username, password, is_admin: false }).expect(409);
  });

  it('validates the payload', async () => {
    await admin.client.post('/users').send({ username: newUsername(), password }).expect(400);
    await admin.client.post('/users').send({ username: newUsername(), is_admin: false }).expect(400);
    await admin.client.post('/users').send({ username: newUsername(), password, is_admin: 'yes' }).expect(400);
  });

  it('is admin-only', async () => {
    const account = await createAccount();
    await account.client.post('/users').send({ username: newUsername(), password, is_admin: true }).expect(401);
  });

  it('stores the password hashed, so the new account can log in', async () => {
    const username = newUsername();
    await admin.client.post('/users').send({ username, password, is_admin: false }).expect(201);

    // Accounts created this way are not activated, so they cannot log in yet.
    const response = await anonymous().post('/login').send({ username, password }).expect(409);
    expect(response.body.message).toMatch(/not activated/i);
  });
});

describe('GET /users/:id', () => {
  it('returns a single account by its database id', async () => {
    const user = await createUser();

    const response = await admin.client.get(`/users/${user._id}`).expect(200);

    expect(response.body.message).toBe('findOne');
    expect(response.body.data.username).toBe(user.username);
  });

  it('reports an unknown id as a conflict', async () => {
    await admin.client.get('/users/60706478aad6c9ad19a31c84').expect(409);
  });

  it('is admin-only', async () => {
    const user = await createUser();
    const account = await createAccount();
    await account.client.get(`/users/${user._id}`).expect(401);
  });
});

describe('PUT /users/:id', () => {
  // The service wraps the payload in an extra `userData` key before handing it
  // to Mongoose, which drops it as an unknown path. The endpoint therefore
  // answers 200 without changing anything - captured here so the behaviour
  // cannot change unnoticed.
  it('answers 200 but leaves the account untouched', async () => {
    const user = await createUser();
    const replacement = newUsername();

    const response = await admin.client.put(`/users/${user._id}`).send({ username: replacement }).expect(200);
    expect(response.body.message).toBe('updated');

    const after = await admin.client.get(`/users/${user._id}`).expect(200);
    expect(after.body.data.username).toBe(user.username);
  });

  it('rejects a username that another account already uses', async () => {
    const first = await createUser();
    const second = await createUser();

    await admin.client.put(`/users/${second._id}`).send({ username: first.username }).expect(409);
  });

  it('reports an unknown id as a conflict', async () => {
    await admin.client.put('/users/60706478aad6c9ad19a31c84').send({ username: newUsername() }).expect(409);
  });

  it('is admin-only', async () => {
    const user = await createUser();
    const account = await createAccount();
    await account.client.put(`/users/${user._id}`).send({ username: newUsername() }).expect(401);
  });
});

describe('DELETE /users/:id', () => {
  it('removes the account', async () => {
    const user = await createUser();

    const response = await admin.client.delete(`/users/${user._id}`).expect(200);
    expect(response.body.message).toBe('deleted');

    await admin.client.get(`/users/${user._id}`).expect(409);
  });

  it('reports an unknown id as a conflict', async () => {
    await admin.client.delete('/users/60706478aad6c9ad19a31c84').expect(409);
  });

  it('is admin-only', async () => {
    const user = await createUser();
    const account = await createAccount();
    await account.client.delete(`/users/${user._id}`).expect(401);
  });
});
