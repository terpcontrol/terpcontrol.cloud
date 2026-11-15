import { anonymous, createAccount, login } from '../support/api';
import { waitForMail } from '../support/control';

/**
 * A forgotten password, from the form to the next sign-in.
 *
 * The suite's install names no address for the app, so the mail carries the
 * code alone - which is the half of it that has to work on any install: the
 * app takes it typed as well as followed from a link.
 */

const NEW_PASSWORD = 'Rec0vered!pass';

describe('recovering a password by the code in the mail', () => {
  it('mails a code that sets a new password once, and the old one stops working', async () => {
    const user = await createAccount('recovering');

    await anonymous().post('/v1/password-resets').send({ email: user.username }).expect(202);
    const mail = await waitForMail(one => one.to.includes(user.username));
    const code = mail.body.match(/^([0-9a-f-]{36})$/m)?.[1];

    expect(code).toBeDefined();
    expect(mail.body).not.toMatch(/https?:\/\//);

    // The code is asked about before a new password is chosen: a mistyped one is refused, the right one spends nothing.
    const mistyped = `${code?.slice(0, -1)}${code?.endsWith('0') ? '1' : '0'}`;
    const typo = await anonymous().get(`/v1/password-resets/${mistyped}`).expect(404);
    expect(typo.body.code).toBe('reset_unknown');
    await anonymous().get(`/v1/password-resets/${code}`).expect(204);
    await anonymous().get(`/v1/password-resets/${code}`).expect(204);

    await anonymous().post(`/v1/password-resets/${code}/redemptions`).send({ password: NEW_PASSWORD }).expect(204);

    await expect(login(user.username, NEW_PASSWORD)).resolves.toBeDefined();
    await expect(login(user.username, user.password)).rejects.toThrow();

    const again = await anonymous().post(`/v1/password-resets/${code}/redemptions`).send({ password: 'Th1rd!pass' }).expect(404);
    expect(again.body.code).toBe('reset_unknown');
    expect((await anonymous().get(`/v1/password-resets/${code}`).expect(404)).body.code).toBe('reset_unknown');
  });

  it('answers an address with no account exactly as one that has one', async () => {
    await anonymous().post('/v1/password-resets').send({ email: 'nobody-here@test.invalid' }).expect(202);
  });
});
