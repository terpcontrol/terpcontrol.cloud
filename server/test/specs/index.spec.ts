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
});
