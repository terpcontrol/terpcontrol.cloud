import { anonymous, createAccount, loginAsAdmin, Session } from '../support/api';

/**
 * `GET /v1/admin/stats`: how the install itself is doing.
 *
 * It is the answer the fleet screen's health card is drawn from, and the card
 * exists for one reason - to show an operator that something here has quietly
 * stopped working. So what is asserted is that every figure it promises is
 * present and is a number, that the one figure this server may not have yet
 * says so rather than being invented, and that none of it is readable by
 * somebody who merely has an account.
 */

let admin: Session;
let member: Session;

beforeAll(async () => {
  admin = await loginAsAdmin();
  member = await createAccount('stats-member');
});

describe('the install´s own figures', () => {
  it('answers every figure the health card names, each of them a number', async () => {
    const stats = (await admin.client.get('/v1/admin/stats').expect(200)).body;

    expect(Date.parse(stats.collectedAt)).not.toBeNaN();
    expect(stats.users).toMatchObject({ total: expect.any(Number), active: expect.any(Number), admins: expect.any(Number) });
    expect(stats.devices).toMatchObject({
      total: expect.any(Number),
      claimed: expect.any(Number),
      online: expect.any(Number),
      updating: expect.any(Number),
    });
    expect(stats.cameras).toMatchObject({ total: expect.any(Number), entitled: expect.any(Number), stale: expect.any(Number) });
    expect(stats.content).toMatchObject({ spaces: expect.any(Number), grows: expect.any(Number), mediaBytes: expect.any(Number) });
    expect(stats.renders).toMatchObject({ queued: expect.any(Number), rendering: expect.any(Number), failed: expect.any(Number) });

    // At least the administrator who just asked, and at least this account.
    expect(stats.users.admins).toBeGreaterThan(0);
    expect(stats.users.total).toBeGreaterThan(0);
  });

  /**
   * The retention sweep's first pass waits ten minutes after boot, so a server
   * this young has run none. It says so rather than printing an hour nothing
   * happened at, which is the whole reason the field is nullable.
   */
  it('says plainly that no retention pass has run on a server that has not run one', async () => {
    const stats = (await admin.client.get('/v1/admin/stats').expect(200)).body;

    expect(stats.retention).toBeNull();
  });

  it('is the office´s and nobody else´s', async () => {
    await member.client.get('/v1/admin/stats').expect(403);
    await anonymous().get('/v1/admin/stats').expect(401);
  });
});
