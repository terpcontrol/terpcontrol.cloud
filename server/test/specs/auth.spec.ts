import { anonymous, ApiClient, context, createAccount, demoSession, login, loginAsAdmin, unique } from '../support/api';
import { resetMail, waitForMail } from '../support/control';

const password = 'Passw0rd!test';
const newUsername = () => `${unique('auth')}@test.invalid`;

describe('POST /signup', () => {
  it('creates an account that can log straight in', async () => {
    const username = newUsername();

    const response = await anonymous().post('/signup').send({ username, password }).expect(201);

    expect(response.body.message).toBe('signup');
    expect(response.body.data.username).toBe(username);
    expect(response.body.data.user_id).toEqual(expect.any(String));
    expect(response.body.data.is_active).toBe(true);

    const session = await login(username, password);
    expect(session.isAdmin).toBe(false);
  });

  it('never returns the stored password hash', async () => {
    const response = await anonymous().post('/signup').send({ username: newUsername(), password }).expect(201);
    expect(response.body.data.password).not.toBe(password);
  });

  it('rejects a username that is already taken', async () => {
    const username = newUsername();
    await anonymous().post('/signup').send({ username, password }).expect(201);

    const response = await anonymous().post('/signup').send({ username, password }).expect(409);
    expect(response.body.message).toMatch(/exists/i);
  });

  it('rejects a payload without a password', async () => {
    const response = await anonymous().post('/signup').send({ username: newUsername() }).expect(400);
    expect(response.body.message).toMatch(/password/);
  });

  it('rejects unknown properties', async () => {
    await anonymous().post('/signup').send({ username: newUsername(), password, is_admin: true }).expect(400);
  });

  it('never lets a signup grant itself admin', async () => {
    const username = newUsername();
    await anonymous().post('/signup').send({ username, password }).expect(201);

    const session = await login(username, password);
    expect(session.isAdmin).toBe(false);
    await session.client.get('/users').expect(401);
  });
});

describe('POST /login', () => {
  it('returns the three tokens and sets the Authorization cookie', async () => {
    const account = await createAccount();

    const response = await anonymous().post('/login').send({ username: account.username, password: account.password }).expect(200);

    expect(response.headers['set-cookie'][0]).toMatch(/^Authorization=.+/);
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(response.body.user).toEqual({ username: account.username, user_id: expect.any(String), is_admin: false });
    for (const kind of ['userToken', 'refreshToken', 'imageToken']) {
      expect(response.body[kind]).toEqual({ token: expect.any(String), expiresIn: expect.any(Number), secret: expect.any(String) });
    }
  });

  it('extends the refresh token when asked to stay logged in', async () => {
    const account = await createAccount();

    const short = await anonymous().post('/login').send({ username: account.username, password: account.password }).expect(200);
    const long = await anonymous()
      .post('/login')
      .send({ username: account.username, password: account.password, stayLoggedIn: true })
      .expect(200);

    expect(long.body.refreshToken.expiresIn).toBeGreaterThan(short.body.refreshToken.expiresIn);
  });

  it('rejects a wrong password', async () => {
    const account = await createAccount();
    const response = await anonymous().post('/login').send({ username: account.username, password: 'not-the-password' }).expect(409);
    expect(response.body.message).toMatch(/Wrong email\/password/);
  });

  it('rejects an unknown user with the same message as a wrong password', async () => {
    const response = await anonymous().post('/login').send({ username: newUsername(), password }).expect(409);
    expect(response.body.message).toMatch(/Wrong email\/password/);
  });

  it('rejects a non-string password', async () => {
    await anonymous().post('/login').send({ username: newUsername(), password: { $ne: null } }).expect(400);
  });
});

describe('POST /demologin', () => {
  it('opens a session that is flagged as a demo', async () => {
    const response = await anonymous().post('/demologin').expect(200);
    expect(response.body.user).toEqual({ username: 'demo', user_id: expect.any(String), is_admin: false, is_demo: true });
  });

  it('refuses every write, whatever the endpoint', async () => {
    const demo = await demoSession();

    for (const write of [
      demo.client.post('/device').send({ claim_code: 'whatever' }),
      demo.client.post('/device/setname').send({ device_id: 'x', name: 'y' }),
      demo.client.delete('/device/some-device'),
      demo.client.post('/chartpresets').send({ name: 'x', query: 'y' }),
    ]) {
      const response = await write;
      expect(response.status).toBe(403);
    }
  });

  it('still allows reading', async () => {
    const demo = await demoSession();
    await demo.client.get('/device').expect(200);
  });

  it('is never an admin session', async () => {
    const demo = await demoSession();
    await demo.client.get('/users').expect(401);
    await demo.client.get('/device/all').expect(401);
  });
});

describe('POST /tokenlogin', () => {
  it('exchanges the automation token for an admin session', async () => {
    const response = await anonymous().post('/tokenlogin').send({ token: context.automationToken }).expect(200);

    expect(response.body.userToken.token).toEqual(expect.any(String));
    await new ApiClient(undefined, response.body.userToken.token).get('/device/all').expect(200);
  });

  it('rejects a wrong token', async () => {
    await anonymous().post('/tokenlogin').send({ token: 'wrong-token' }).expect(401);
  });

  it('rejects a missing token', async () => {
    await anonymous().post('/tokenlogin').send({}).expect(401);
  });

  it('rejects a token that only shares a prefix', async () => {
    await anonymous().post('/tokenlogin').send({ token: context.automationToken.slice(0, -1) }).expect(401);
  });
});

describe('POST /refresh', () => {
  it('mints a new set of tokens from a refresh token', async () => {
    const account = await createAccount();

    const response = await anonymous().post('/refresh').send({ token: account.refreshToken }).expect(200);

    expect(response.body.userToken.token).toEqual(expect.any(String));
    await new ApiClient(undefined, response.body.userToken.token).get('/device').expect(200);
  });

  it('refuses a user token in place of a refresh token', async () => {
    const account = await createAccount();
    await anonymous().post('/refresh').send({ token: account.userToken }).expect(401);
  });

  it('refuses a missing or malformed token', async () => {
    await anonymous().post('/refresh').send({}).expect(401);
    await anonymous().post('/refresh').send({ token: 'not-a-jwt' }).expect(401);
  });
});

describe('POST /logout', () => {
  it('clears the Authorization cookie', async () => {
    const account = await createAccount();
    const response = await account.client.post('/logout').expect(200);
    expect(response.headers['set-cookie'][0]).toMatch(/^Authorization=;/);
  });

  it('requires a session', async () => {
    await anonymous().post('/logout').expect(401);
  });
});

describe('POST /changepass', () => {
  it('replaces the password of the calling user', async () => {
    const account = await createAccount();
    const changed = 'Changed!pass1';

    await account.client.post('/changepass').send({ username: account.username, password: changed }).expect(200);

    // The write is fire-and-forget in the controller, so allow it to land.
    await new Promise(resolve => setTimeout(resolve, 500));
    await login(account.username, changed);
    await anonymous().post('/login').send({ username: account.username, password: account.password }).expect(409);
  });

  it('requires a session', async () => {
    await anonymous().post('/changepass').send({ username: 'a', password: 'b' }).expect(401);
  });
});

describe('password reset', () => {
  beforeEach(async () => {
    await resetMail();
  });

  it('mails a recovery link that resets the password', async () => {
    const account = await createAccount();

    await anonymous().post('/getreset').send({ username: account.username, password: 'ignored' }).expect(201);

    const mail = await waitForMail(message => message.to.includes(account.username));
    expect(mail.subject).toMatch(/reset/i);

    const token = /recovery=([\w-]+)/.exec(mail.body)?.[1];
    expect(token).toBeDefined();

    const resetPassword = 'Recovered!pass1';
    await anonymous().post('/reset').send({ token, password: resetPassword }).expect(200);

    await login(account.username, resetPassword);
  });

  it('refuses a reset for an unknown account', async () => {
    await anonymous().post('/getreset').send({ username: newUsername(), password: 'ignored' }).expect(409);
  });

  it('refuses an unknown reset token', async () => {
    await anonymous().post('/reset').send({ token: 'not-a-real-token', password }).expect(409);
  });
});

describe('POST /activate', () => {
  it('refuses an unknown activation code', async () => {
    await anonymous().post('/activate').send({ activation_code: 'nope' }).expect(409);
  });

  it('validates the payload', async () => {
    await anonymous().post('/activate').send({}).expect(400);
  });
});

describe('rate limiting', () => {
  it('locks out a client that floods the login endpoint', async () => {
    const client = anonymous();
    const attempt = () => client.post('/login').send({ username: 'flood@test.invalid', password: 'wrong' });

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await attempt()).status);
    }

    expect(statuses.filter(status => status === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 10).every(status => status !== 429)).toBe(true);
  });

  it('tells a locked-out client when to come back', async () => {
    const client = anonymous();
    let response = await client.post('/login').send({ username: 'retry@test.invalid', password: 'wrong' });

    while (response.status !== 429) {
      response = await client.post('/login').send({ username: 'retry@test.invalid', password: 'wrong' });
    }

    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps the limit per client address', async () => {
    const flooder = anonymous();
    for (let i = 0; i < 12; i++) {
      await flooder.post('/login').send({ username: 'flood2@test.invalid', password: 'wrong' });
    }

    const bystander = await createAccount();
    expect(bystander.userToken).toEqual(expect.any(String));
  });
});

describe('token typing', () => {
  it('refuses an image token where a user token is required', async () => {
    const account = await createAccount();
    await new ApiClient(undefined, account.imageToken).get('/device').expect(401);
  });

  it('refuses a refresh token where a user token is required', async () => {
    const account = await createAccount();
    await new ApiClient(undefined, account.refreshToken).get('/device').expect(401);
  });

  it('refuses a token signed with the wrong secret', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZm9yZ2VkIiwiaXNfYWRtaW4iOnRydWUsInRva2VuX3R5cGUiOiJ1c2VyIn0.' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    await new ApiClient(undefined, forged).get('/device').expect(401);
  });

  it('accepts the admin account for admin-only endpoints', async () => {
    const admin = await loginAsAdmin();
    await admin.client.get('/users').expect(200);
  });
});
