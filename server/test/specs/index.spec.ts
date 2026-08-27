import { anonymous, context, loginAsAdmin } from '../support/api';

describe('service endpoints', () => {
  it('answers the liveness probe', async () => {
    await anonymous().get('/').expect(200);
  });

  it('reports ready once the admin account exists', async () => {
    await anonymous().get('/readycheck').expect(200);
  });

  it('bootstraps the configured admin account', async () => {
    const admin = await loginAsAdmin();
    expect(admin.isAdmin).toBe(true);
    expect(admin.username).toBe(context.admin.username);
  });

  it('serves the OpenAPI document', async () => {
    const response = await anonymous().get('/swagger.json').expect(200);
    expect(response.body.openapi ?? response.body.swagger).toBeDefined();
    expect(Object.keys(response.body.paths).length).toBeGreaterThan(10);
  });

  it('documents the endpoints that need no token as needing none', async () => {
    const response = await anonymous().get('/swagger.json').expect(200);

    // The document asks for the bearer everywhere, so an endpoint anyone may
    // call has to say so - otherwise logging in reads as impossible without
    // having logged in.
    for (const [path, method] of [
      ['/login', 'post'],
      ['/signup', 'post'],
      ['/refresh', 'post'],
      ['/reset', 'post'],
      ['/device/register', 'post'],
      ['/device/firmware/{firmware_id}/{binary}', 'get'],
      ['/share/resolve/{share_id}', 'get'],
      ['/readycheck', 'get'],
    ]) {
      expect(response.body.paths[path]?.[method]?.security).toEqual([]);
    }

    // And one that does need it says nothing, inheriting the requirement.
    expect(response.body.paths['/users'].get.security).toBeUndefined();
  });
});
