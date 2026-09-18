import { anonymous, context, loginAsAdmin } from '../support/api';

describe('service endpoints', () => {
  it('answers the liveness probe', async () => {
    await anonymous().get('/healthz').expect(200);
  });

  it('reports ready once the admin account exists', async () => {
    await anonymous().get('/readyz').expect(200);
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

  it('serves the documentation page, with or without the trailing slash', async () => {
    const page = await anonymous().get('/api-docs').expect(200);
    expect(page.text).toContain('swagger-ui');

    // The page links its assets relative to the URL it came from, so the
    // slashed form is sent to the one that works rather than rendering blank.
    const slashed = await anonymous().get('/api-docs/').expect(301);
    expect(slashed.headers.location).toBe('/api-docs');

    // The router ignores case and takes a query string, so those reach the page
    // too and need the same treatment.
    const shouted = await anonymous().get('/API-Docs/').expect(301);
    expect(shouted.headers.location).toBe('/api-docs');

    const withQuery = await anonymous().get('/api-docs/?filter=device').expect(301);
    expect(withQuery.headers.location).toBe('/api-docs?filter=device');
  });

  it('documents the endpoints that need no token as needing none', async () => {
    const response = await anonymous().get('/swagger.json').expect(200);

    // The document asks for the bearer everywhere, so an endpoint anyone may
    // call has to say so - otherwise logging in reads as impossible without
    // having logged in.
    for (const [path, method] of [
      ['/v1/sessions', 'post'],
      ['/v1/sessions/refresh', 'post'],
      ['/v1/users', 'post'],
      ['/v1/password-resets', 'post'],
      ['/device/register', 'post'],
      ['/device/claimcode', 'post'],
      ['/device/firmware/{firmware_id}/{binary}', 'get'],
      ['/healthz', 'get'],
      ['/readyz', 'get'],
    ]) {
      expect(response.body.paths[path]?.[method]?.security).toEqual([]);
    }

    // And one that does need it says nothing, inheriting the requirement.
    expect(response.body.paths['/v1/devices'].get.security).toBeUndefined();
  });
});
