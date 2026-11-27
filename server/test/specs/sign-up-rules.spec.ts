import { anonymous, createAccount, demoSession, loginAsAdmin, unique } from '../support/api';
import { waitForMail } from '../support/control';

/**
 * What an account has to bring along: a new password of eight characters or
 * more wherever one is set, and - on an install that publishes terms of use -
 * their acceptance. The suite's install publishes none, so this is the side of
 * the terms every self-hosted install sees; the other side is the unit spec's.
 */

const SHORT = 'Sh0rt!x';

const tooShort = (body: { code: string; errors: { field: string }[] }, field: string) => {
  expect(body.code).toBe('password_too_short');
  expect(body.errors.map(error => error.field)).toEqual([field]);
};

describe('a new password', () => {
  it('is refused under eight characters on sign-up', async () => {
    const answer = await anonymous()
      .post('/v1/users')
      .send({ email: `${unique('short')}@test.invalid`, handle: unique('short'), password: SHORT })
      .expect(422);

    tooShort(answer.body, 'password');
  });

  it('is refused under eight characters when the account changes it, and the old one goes on working', async () => {
    const user = await createAccount('short-change');

    const answer = await user.client.put('/v1/me/password').send({ currentPassword: user.password, newPassword: SHORT }).expect(422);

    tooShort(answer.body, 'newPassword');
    await user.client.get('/v1/me').expect(200);
  });

  it('is refused under eight characters when a recovery code sets it', async () => {
    const user = await createAccount('short-reset');
    await anonymous().post('/v1/password-resets').send({ email: user.username }).expect(202);
    const code = (await waitForMail(one => one.to.includes(user.username))).body.match(/^([0-9a-f-]{36})$/m)?.[1];

    const answer = await anonymous().post(`/v1/password-resets/${code}/redemptions`).send({ password: SHORT }).expect(422);

    tooShort(answer.body, 'password');
    await anonymous().get(`/v1/password-resets/${code}`).expect(204);
  });
});

describe('the terms of use on an install that publishes none', () => {
  it('are asked of nobody', async () => {
    const user = await createAccount('no-terms');

    expect((await user.client.get('/v1/me').expect(200)).body.termsToAccept).toBeNull();
  });

  it('cannot be accepted, because there are none', async () => {
    const user = await createAccount('no-terms-accept');

    const answer = await user.client.post('/v1/me/terms-acceptances').send({ url: 'https://example.test/terms' }).expect(409);
    expect(answer.body.code).toBe('no_terms');
  });

  it('are accepted by an account alone, never by a demo session', async () => {
    const demo = await demoSession();

    await anonymous().post('/v1/me/terms-acceptances').send({ url: 'https://example.test/terms' }).expect(401);
    await demo.client.post('/v1/me/terms-acceptances').send({ url: 'https://example.test/terms' }).expect(403);
  });

  it('let a sign-up say it accepts them all the same', async () => {
    await anonymous()
      .post('/v1/users')
      .send({ email: `${unique('accepts')}@test.invalid`, handle: unique('accepts'), password: 'Passw0rd!test', acceptTerms: true })
      .expect(201);
  });
});

describe('activating an account', () => {
  it('is rate-limited like the other doors without a session', async () => {
    const client = anonymous();
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await client.post('/v1/users/activations').send({ activationCode: unique('code') })).status);
    }

    expect(statuses.slice(0, 10).every(status => status === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('an administrator', () => {
  it("may give an account a short password, which is the operator's call", async () => {
    const admin = await loginAsAdmin();

    await admin.client
      .post('/v1/admin/users')
      .send({ email: `${unique('short-admin')}@test.invalid`, handle: unique('short-admin'), password: SHORT })
      .expect(201);
  });
});
